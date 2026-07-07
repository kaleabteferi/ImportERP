import { supabase } from './supabase'
import { receiveShipment } from '../api/shipments'

export const DEFAULT_WAREHOUSE_ID = '00000000-0000-0000-0000-000000000001'

export type AssemblyType = 'FULL' | 'SKD' | 'CKD' | 'IMPORTED'

export interface ReceiveItem {
  shipment_item_id: string
  product_id: string
  product_name: string
  quantity: number
  unit_landed_cost_etb: number | null
  assembly_type: AssemblyType
}

export function resolveAssemblyType(product: {
  assembly_type?: string | null
  is_assembled?: boolean
}): AssemblyType {
  if (product.assembly_type === 'SKD' || product.assembly_type === 'CKD' ||
      product.assembly_type === 'FULL' || product.assembly_type === 'IMPORTED') {
    return product.assembly_type
  }
  if (product.is_assembled) return 'FULL'
  return 'IMPORTED'
}

export interface InventoryMovementInput {
  product_id: string
  quantity: number
  unit_cost_etb?: number | null
  movement_type: string
  movement_date?: string
  warehouse_id?: string
  notes?: string | null
  reference_type?: string | null
  reference_id?: string | null
}

export async function postInventoryMovement(input: InventoryMovementInput) {
  const movementDate = input.movement_date ?? new Date().toISOString().split('T')[0]
  const { data, error } = await supabase.from('inventory_ledger').insert({
    product_id: input.product_id,
    quantity: input.quantity,
    unit_cost_etb: input.unit_cost_etb ?? null,
    movement_type: input.movement_type,
    movement_date: movementDate,
    warehouse_id: input.warehouse_id ?? DEFAULT_WAREHOUSE_ID,
    notes: input.notes ?? null,
    reference_type: input.reference_type ?? null,
    reference_id: input.reference_id ?? null,
  }).select('*').maybeSingle()

  if (error) throw error
  return data
}

/** Receive shipment into inventory. Tries RPC first, falls back to direct ledger writes. */
export async function receiveShipmentToInventory(
  shipmentId: string,
  items: ReceiveItem[],
  fxRate: number,
  warehouseId = DEFAULT_WAREHOUSE_ID,
): Promise<void> {
  if (!shipmentId || items.length === 0) return

  const payload = items.map(i => ({
    shipment_item_id: i.shipment_item_id,
    quantity_received: i.quantity,
  }))

  try {
    await receiveShipment(shipmentId, warehouseId, fxRate, payload)
    return
  } catch {
    // Fallback when RPC is not deployed
  }

  for (const item of items) {
    if (!item.product_id || item.quantity <= 0) continue

    const unitCost = item.unit_landed_cost_etb ?? 0
    const notes = `Received from shipment · ${item.assembly_type}`

    if (item.assembly_type === 'CKD' || item.assembly_type === 'SKD') {
      await postInventoryMovement({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost_etb: unitCost,
        movement_type: 'SHIPMENT_RECEIVED',
        movement_date: new Date().toISOString().split('T')[0],
        warehouse_id: warehouseId,
        reference_type: 'shipment',
        reference_id: shipmentId,
        notes: `${notes} — routed to assembly components`,
      })
    } else {
      await postInventoryMovement({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost_etb: unitCost,
        movement_type: 'SHIPMENT_RECEIVED',
        movement_date: new Date().toISOString().split('T')[0],
        warehouse_id: warehouseId,
        reference_type: 'shipment',
        reference_id: shipmentId,
        notes,
      })
    }
  }

  await supabase.from('shipments')
    .update({ status: 'WAREHOUSE_RECEIVED', inventory_received_at: new Date().toISOString() })
    .eq('id', shipmentId)
}
