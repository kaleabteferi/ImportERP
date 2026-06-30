import { supabase } from './supabase'
import { receiveShipment } from '../api/shipments'

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

/** Receive shipment into inventory. Tries RPC first, falls back to direct ledger writes. */
export async function receiveShipmentToInventory(
  shipmentId: string,
  items: ReceiveItem[],
  fxRate: number,
  warehouseId = 'main',
): Promise<void> {
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
    const unitCost = item.unit_landed_cost_etb ?? 0
    const notes = `Received from shipment · ${item.assembly_type}`

    if (item.assembly_type === 'CKD' || item.assembly_type === 'SKD') {
      // Parts go to component inventory for assembly line
      await supabase.from('inventory_ledger').insert({
        product_id:     item.product_id,
        quantity:       item.quantity,
        unit_cost_etb:  unitCost,
        movement_type:  'SHIPMENT_RECEIVED',
        movement_date:  new Date().toISOString().split('T')[0],
        reference_type: 'shipment',
        reference_id:   shipmentId,
        notes:          `${notes} — routed to assembly components`,
      })
    } else {
      // FULL or IMPORTED — finished goods warehouse
      await supabase.from('inventory_ledger').insert({
        product_id:     item.product_id,
        quantity:       item.quantity,
        unit_cost_etb:  unitCost,
        movement_type:  'SHIPMENT_RECEIVED',
        movement_date:  new Date().toISOString().split('T')[0],
        reference_type: 'shipment',
        reference_id:   shipmentId,
        notes,
      })
    }
  }

  await supabase.from('shipments')
    .update({ status: 'WAREHOUSE_RECEIVED', inventory_received_at: new Date().toISOString() })
    .eq('id', shipmentId)
}
