import { supabase } from "../lib/supabase";

// src/api/shipments.ts
export async function receiveShipment(
  shipmentId: string,
  warehouseId: string,
  exchangeRate: number,
  items: Array<{ shipment_item_id: string; quantity_received: number }>,
) {
  const { data, error } = await supabase.rpc('receive_shipment', {
    p_shipment_id: shipmentId,
    p_warehouse_id: warehouseId,
    p_exchange_rate: exchangeRate,
    p_items: items,
  });

  if (error) throw new Error(`Failed to receive shipment: ${error.message}`);
  return data;
}

export interface DeleteShipmentResult {
  shipment_number: string
  deleted_items: number
  deleted_expenses: number
  deleted_transfers: number
  deleted_damage_reports: number
  deleted_inventory_movements: number
}

// Deletes the shipment and every record tied to it (items, expenses, damage
// reports, Djibouti warehouse transfers, and any inventory movements posted
// from it) in one transaction. See delete_shipment_cascade migration for why
// a plain DELETE can't do this — several child tables are RESTRICT/NO ACTION,
// and inventory_ledger's reference to a shipment isn't a real FK.
export async function deleteShipmentCascade(shipmentId: string): Promise<DeleteShipmentResult> {
  const { data, error } = await supabase.rpc('delete_shipment_cascade', { p_shipment_id: shipmentId });
  if (error) throw new Error(`Failed to delete shipment: ${error.message}`);
  return data as DeleteShipmentResult;
}