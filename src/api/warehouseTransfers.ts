// src/api/warehouseTransfers.ts — warehouse-to-warehouse (and warehouse-to-
// market) movement, e.g. "DB -> Adisu Bekeya -> Merkato": driver, plate,
// qty, item, purpose. Feeds the daily in/out report.
//
// Also covers the Djibouti forwarder flow: a shipment's items land in the
// forwarder's (Ali's) Djibouti warehouse first, then get dispatched to your
// own warehouses in partial truckloads. Those dispatches go through a
// REQUESTED -> IN_TRANSIT -> RECEIVED lifecycle since the requested,
// actually-dispatched, and actually-received quantities can each differ.
import { supabase } from '../lib/supabase'
import { addExpenseAndRecalculate } from './expenses'

export type TransferPurpose = 'WAREHOUSE_TO_WAREHOUSE' | 'SALES' | 'RETURN' | 'OTHER'
export type TransferStatus = 'REQUESTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'

export interface WarehouseTransfer {
  id: string
  transfer_number: string
  from_warehouse_id: string
  to_warehouse_id: string | null
  product_id: string
  quantity: number
  requested_quantity: number | null
  received_quantity: number | null
  transfer_date: string
  dispatched_at: string | null
  received_at: string | null
  purpose: TransferPurpose
  driver_name: string | null
  truck_plate: string | null
  waybill_number: string | null
  weight_kg: number | null
  trucking_rate_per_kg: number | null
  trucking_cost_etb: number | null
  linked_shipment_id: string | null
  shipment_expense_id: string | null
  status: TransferStatus
  notes: string | null
  created_at: string
}

export interface NewTransferInput {
  fromWarehouseId: string
  toWarehouseId: string | null
  productId: string
  quantity: number
  transferDate: string
  purpose: TransferPurpose
  driverName?: string
  truckPlate?: string
  requestedByEmployeeId?: string
  notes?: string
}

export async function fetchWarehouseTransfers(limit = 100): Promise<WarehouseTransfer[]> {
  const { data, error } = await supabase
    .from('warehouse_transfers')
    .select('*')
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as WarehouseTransfer[]
}

async function nextTransferNumber(prefix: string, year: number): Promise<string> {
  const { count } = await supabase
    .from('warehouse_transfers')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01`)
    .lt('created_at', `${year + 1}-01-01`)
  return `${prefix}-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`
}

export async function createWarehouseTransfer(input: NewTransferInput) {
  const year = new Date(input.transferDate).getFullYear()

  let lastError: { message: string; code?: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const transferNumber = await nextTransferNumber('WT', year)
    const { data, error } = await supabase.from('warehouse_transfers').insert({
      transfer_number: transferNumber,
      from_warehouse_id: input.fromWarehouseId,
      to_warehouse_id: input.toWarehouseId,
      product_id: input.productId,
      quantity: input.quantity,
      transfer_date: input.transferDate,
      purpose: input.purpose,
      driver_name: input.driverName || null,
      truck_plate: input.truckPlate || null,
      requested_by_employee_id: input.requestedByEmployeeId || null,
      notes: input.notes || null,
      status: 'IN_TRANSIT',
    }).select('id').single()
    if (!error) return data.id as string
    lastError = error
    if (error.code !== '23505') break
  }
  throw new Error(lastError?.message ?? 'Failed to create transfer')
}

// Marks the transfer received and posts the matching inventory_ledger
// movements (TRANSFER_OUT at source, TRANSFER_IN at destination) so stock
// levels reflect the move. Not run inside a DB transaction — if the second
// insert fails, the transfer is still marked RECEIVED with only the
// TRANSFER_OUT posted; the ledger and transfer status should be reconciled
// manually in that rare case.
export async function receiveWarehouseTransfer(transfer: WarehouseTransfer) {
  const { error: updateError } = await supabase
    .from('warehouse_transfers')
    .update({ status: 'RECEIVED', received_at: new Date().toISOString() })
    .eq('id', transfer.id)
  if (updateError) throw new Error(updateError.message)

  const { error: outError } = await supabase.from('inventory_ledger').insert({
    product_id: transfer.product_id,
    quantity: -Math.abs(transfer.quantity),
    movement_type: 'TRANSFER_OUT',
    movement_date: transfer.transfer_date,
    warehouse_id: transfer.from_warehouse_id,
    reference_type: 'warehouse_transfer',
    reference_id: transfer.id,
    notes: `Transfer ${transfer.transfer_number}`,
  })
  if (outError) throw new Error(outError.message)

  if (transfer.to_warehouse_id) {
    const { error: inError } = await supabase.from('inventory_ledger').insert({
      product_id: transfer.product_id,
      quantity: Math.abs(transfer.quantity),
      movement_type: 'TRANSFER_IN',
      movement_date: transfer.transfer_date,
      warehouse_id: transfer.to_warehouse_id,
      reference_type: 'warehouse_transfer',
      reference_id: transfer.id,
      notes: `Transfer ${transfer.transfer_number}`,
    })
    if (inError) throw new Error(inError.message)
  }
}

export async function cancelWarehouseTransfer(transferId: string) {
  const { error } = await supabase
    .from('warehouse_transfers')
    .update({ status: 'CANCELLED' })
    .eq('id', transferId)
  if (error) throw new Error(error.message)
}

// ── Djibouti forwarder flow ────────────────────────────────────────────

export async function fetchAliWarehouseId(): Promise<string> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id')
    .eq('is_forwarder', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('No forwarder warehouse is set up yet — check Settings → Warehouses.')
  return data.id
}

// "How much of each product is currently sitting with the forwarder" —
// current balance at any is_forwarder warehouse.
export interface AliStockRow { product_id: string; product_name: string; sku: string; quantity: number }

export async function fetchAliStock(): Promise<AliStockRow[]> {
  const aliWarehouseId = await fetchAliWarehouseId()

  const [{ data: ledgerRows, error: ledgerError }, { data: products, error: productsError }] = await Promise.all([
    supabase.from('inventory_ledger').select('product_id, quantity').eq('warehouse_id', aliWarehouseId),
    supabase.from('products').select('id, name, sku'),
  ])
  if (ledgerError) throw new Error(ledgerError.message)
  if (productsError) throw new Error(productsError.message)

  const nameBySku = new Map((products ?? []).map((p: any) => [p.id, { name: p.name, sku: p.sku }]))
  const balances = new Map<string, number>()
  for (const r of ledgerRows ?? []) {
    balances.set(r.product_id, (balances.get(r.product_id) ?? 0) + Number(r.quantity ?? 0))
  }

  return [...balances.entries()]
    .filter(([, qty]) => qty > 0.0001)
    .map(([productId, qty]) => ({
      product_id: productId,
      product_name: nameBySku.get(productId)?.name ?? 'Unknown product',
      sku: nameBySku.get(productId)?.sku ?? '',
      quantity: qty,
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name))
}

export interface DjiboutiRequestInput {
  toWarehouseId: string
  productId: string
  requestedQuantity: number
  requestDate: string
  linkedShipmentId?: string
  requestedByEmployeeId?: string
  notes?: string
}

// Stage 1: log what you're asking Ali to send. No inventory movement yet —
// nothing has left his warehouse.
export async function createDjiboutiRequest(input: DjiboutiRequestInput): Promise<string> {
  const aliWarehouseId = await fetchAliWarehouseId()
  const year = new Date(input.requestDate).getFullYear()

  let lastError: { message: string; code?: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const transferNumber = await nextTransferNumber('DJB', year)
    const { data, error } = await supabase.from('warehouse_transfers').insert({
      transfer_number: transferNumber,
      from_warehouse_id: aliWarehouseId,
      to_warehouse_id: input.toWarehouseId,
      product_id: input.productId,
      quantity: input.requestedQuantity,
      requested_quantity: input.requestedQuantity,
      transfer_date: input.requestDate,
      purpose: 'WAREHOUSE_TO_WAREHOUSE',
      linked_shipment_id: input.linkedShipmentId || null,
      requested_by_employee_id: input.requestedByEmployeeId || null,
      notes: input.notes || null,
      status: 'REQUESTED',
    }).select('id').single()
    if (!error) return data.id as string
    lastError = error
    if (error.code !== '23505') break
  }
  throw new Error(lastError?.message ?? 'Failed to create request')
}

export interface DispatchInput {
  actualQuantity: number
  waybillNumber?: string
  driverName?: string
  truckPlate?: string
  weightKg?: number
  truckingRatePerKg?: number
  truckingCostEtb?: number // used as-is if provided; otherwise computed from weight × rate
  linkedShipmentId?: string // which shipment's cost breakdown the trucking fee should post to
  dispatchDate?: string // defaults to today
}

// Stage 2: Ali has actually loaded a truck. Reduces his warehouse balance
// (TRANSFER_OUT) and — if a shipment is linked and a cost is known —
// creates a TRUCKING expense on that shipment so it flows into the landed
// cost calculation automatically.
export async function recordDjiboutiDispatch(transfer: WarehouseTransfer, input: DispatchInput): Promise<void> {
  const truckingCost = input.truckingCostEtb ??
    (input.weightKg && input.truckingRatePerKg ? input.weightKg * input.truckingRatePerKg : null)
  const dispatchDate = input.dispatchDate ?? new Date().toISOString().split('T')[0]

  let shipmentExpenseId: string | null = null
  if (input.linkedShipmentId && truckingCost) {
    const result = await addExpenseAndRecalculate({
      shipment_id: input.linkedShipmentId,
      category: 'TRUCKING',
      description: `Djibouti → warehouse trucking (${transfer.transfer_number})${input.weightKg ? ` · ${input.weightKg}kg` : ''}`,
      amount: truckingCost,
      currency: 'ETB',
      expense_date: dispatchDate,
      receipt_ref: input.waybillNumber || undefined,
      notes: `Auto-created from dispatch ${transfer.transfer_number}`,
    })
    shipmentExpenseId = result.expense_id
  }

  const { error: updateError } = await supabase
    .from('warehouse_transfers')
    .update({
      quantity: input.actualQuantity,
      waybill_number: input.waybillNumber || null,
      driver_name: input.driverName || null,
      truck_plate: input.truckPlate || null,
      weight_kg: input.weightKg ?? null,
      trucking_rate_per_kg: input.truckingRatePerKg ?? null,
      trucking_cost_etb: truckingCost,
      linked_shipment_id: input.linkedShipmentId || transfer.linked_shipment_id,
      shipment_expense_id: shipmentExpenseId,
      dispatched_at: new Date().toISOString(),
      status: 'IN_TRANSIT',
    })
    .eq('id', transfer.id)
  if (updateError) throw new Error(updateError.message)

  const { error: outError } = await supabase.from('inventory_ledger').insert({
    product_id: transfer.product_id,
    quantity: -Math.abs(input.actualQuantity),
    movement_type: 'TRANSFER_OUT',
    movement_date: dispatchDate,
    warehouse_id: transfer.from_warehouse_id,
    reference_type: 'warehouse_transfer',
    reference_id: transfer.id,
    notes: `Dispatched · ${transfer.transfer_number}${input.waybillNumber ? ` · WB ${input.waybillNumber}` : ''}`,
  })
  if (outError) throw new Error(outError.message)
}

// Stage 3: confirm what actually arrived (may differ from what was
// dispatched). Posts TRANSFER_IN to the destination warehouse for the
// confirmed quantity, not the dispatched one.
export async function confirmDjiboutiReceipt(transfer: WarehouseTransfer, receivedQuantity: number): Promise<void> {
  if (!transfer.to_warehouse_id) throw new Error('This dispatch has no destination warehouse set.')

  const { error: updateError } = await supabase
    .from('warehouse_transfers')
    .update({
      received_quantity: receivedQuantity,
      received_at: new Date().toISOString(),
      status: 'RECEIVED',
    })
    .eq('id', transfer.id)
  if (updateError) throw new Error(updateError.message)

  const { error: inError } = await supabase.from('inventory_ledger').insert({
    product_id: transfer.product_id,
    quantity: Math.abs(receivedQuantity),
    movement_type: 'TRANSFER_IN',
    movement_date: new Date().toISOString().split('T')[0],
    warehouse_id: transfer.to_warehouse_id,
    reference_type: 'warehouse_transfer',
    reference_id: transfer.id,
    notes: `Received · ${transfer.transfer_number}${transfer.waybill_number ? ` · WB ${transfer.waybill_number}` : ''}`,
  })
  if (inError) throw new Error(inError.message)
}
