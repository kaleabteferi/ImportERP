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