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
  } catch (rpcError) {
    // Fallback when the receive_shipment RPC isn't deployed yet.
    // Logged (not swallowed) so a missing migration is visible instead
    // of silently producing wrong inventory.
    console.warn(
      '[inventoryReceive] receive_shipment RPC failed, using client-side fallback. ' +
      'Run the latest Supabase migration to fix this properly:',
      rpcError,
    )
  }

  await postReceivedItems(shipmentId, items, warehouseId)

  await supabase.from('shipments')
    .update({ status: 'WAREHOUSE_RECEIVED', inventory_received_at: new Date().toISOString() })
    .eq('id', shipmentId)
}

// Posts a shipment's items into inventory at the given warehouse — used by
// both the legacy direct-receive flow above and the Djibouti forwarder flow
// below. Does not touch shipment status; callers decide that separately.
async function postReceivedItems(shipmentId: string, items: ReceiveItem[], warehouseId: string): Promise<void> {
  for (const item of items) {
    if (!item.product_id || item.quantity <= 0) continue

    const unitCost = item.unit_landed_cost_etb ?? 0
    const movementDate = new Date().toISOString().split('T')[0]

    if (item.assembly_type === 'CKD' || item.assembly_type === 'SKD') {
      // FIX: this used to credit the finished product directly, identical
      // to the FULL/IMPORTED branch below — meaning CKD/SKD kits appeared
      // as sellable finished stock immediately on receipt, before assembly,
      // while the BOM components they're actually made of were never
      // stocked. Now it decomposes into the product's BOM components.
      const { data: bomHeader } = await supabase
        .from('bom_headers')
        .select('id')
        .eq('product_id', item.product_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!bomHeader) {
        console.warn(
          `[inventoryReceive] No active BOM for product ${item.product_id} ` +
          `(${item.assembly_type}) — crediting finished goods directly as a fallback. ` +
          `Add a BOM for this product to fix this.`,
        )
        await postInventoryMovement({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_cost_etb: unitCost,
          movement_type: 'SHIPMENT_RECEIVED',
          movement_date: movementDate,
          warehouse_id: warehouseId,
          reference_type: 'shipment',
          reference_id: shipmentId,
          notes: `NO BOM FOUND for ${item.assembly_type} product "${item.product_name}" — credited as finished goods, please add a BOM.`,
        })
        continue
      }

      const { data: bomLines } = await supabase
        .from('bom_lines')
        .select('component_product_id, quantity_required')
        .eq('bom_header_id', bomHeader.id)

      for (const line of bomLines ?? []) {
        await postInventoryMovement({
          product_id: line.component_product_id,
          quantity: line.quantity_required * item.quantity,
          unit_cost_etb: null, // component cost comes from its own receipt history, not the kit price
          movement_type: 'SHIPMENT_RECEIVED',
          movement_date: movementDate,
          warehouse_id: warehouseId,
          reference_type: 'shipment',
          reference_id: shipmentId,
          notes: `Component from ${item.assembly_type} receipt of "${item.product_name}"`,
        })
      }
    } else {
      await postInventoryMovement({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost_etb: unitCost,
        movement_type: 'SHIPMENT_RECEIVED',
        movement_date: movementDate,
        warehouse_id: warehouseId,
        reference_type: 'shipment',
        reference_id: shipmentId,
        notes: `Received · ${item.assembly_type}`,
      })
    }
  }
}

// Receives a shipment's items into the forwarder's (Ali's) Djibouti
// warehouse. Deliberately skips the receive_shipment RPC (its exact
// server-side behavior around shipment status isn't known/documented) and
// does not touch shipment.status — the user already set it to AT_DJIBOUTI,
// and WAREHOUSE_RECEIVED/COMPLETED are earned later via dispatch + receipt
// confirmations in the Djibouti Forwarder flow, not by this step.
//
// Deliberately does NOT go through postReceivedItems: that helper
// decomposes CKD/SKD products into their BOM components, which is correct
// once a kit reaches the assembly warehouse but wrong here — Ali's
// warehouse just holds sealed kits in transit, so "what's in the
// container" (the product itself) is exactly what should land in his
// stock. Decomposition happens later, when the kit is confirmed received
// at the final warehouse (see confirmDjiboutiReceipt in
// api/warehouseTransfers.ts).
export async function receiveShipmentAtDjibouti(
  shipmentId: string,
  items: ReceiveItem[],
  aliWarehouseId: string,
): Promise<void> {
  if (!shipmentId || items.length === 0) return
  const movementDate = new Date().toISOString().split('T')[0]

  for (const item of items) {
    if (!item.product_id || item.quantity <= 0) continue
    await postInventoryMovement({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost_etb: item.unit_landed_cost_etb ?? 0,
      movement_type: 'SHIPMENT_RECEIVED',
      movement_date: movementDate,
      warehouse_id: aliWarehouseId,
      reference_type: 'shipment',
      reference_id: shipmentId,
      notes: `Landed at Djibouti · ${item.assembly_type}`,
    })
  }

  await supabase.from('shipments')
    .update({ djibouti_received_at: new Date().toISOString() })
    .eq('id', shipmentId)
}