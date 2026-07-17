// src/lib/productionLogging.ts — single-BOM quick production log, used by
// the mobile Production page. Mirrors Production.tsx's desktop logic
// (validate every component has enough stock BEFORE writing anything,
// prefer an existing open order, upsert the day's log by delta) so mobile
// and desktop can't diverge into different bugs for the same operation.
import { supabase } from './supabase'
import { postInventoryMovement } from './inventoryReceive'

export async function logProductionQuick(
  bomHeaderId: string,
  warehouseId: string,
  quantity: number,
  notes: string | undefined,
  logDate: string,
): Promise<void> {
  if (quantity <= 0) throw new Error('Enter a quantity greater than 0.')

  const { data: bom, error: bomError } = await supabase
    .from('bom_headers')
    .select('id, product_id, finished_product_id, name')
    .eq('id', bomHeaderId)
    .single()
  if (bomError) throw new Error(bomError.message)
  const productId: string = bom.product_id ?? bom.finished_product_id

  const { data: bomLines } = await supabase
    .from('bom_lines')
    .select('component_product_id, quantity_required')
    .eq('bom_header_id', bomHeaderId)

  // Validate every component has enough stock before any write.
  for (const line of bomLines ?? []) {
    const needed = Number(line.quantity_required ?? 0) * quantity
    const { data: ledgerRows } = await supabase
      .from('inventory_ledger')
      .select('quantity')
      .eq('product_id', line.component_product_id)
      .eq('warehouse_id', warehouseId)
    const available = (ledgerRows ?? []).reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
    if (available < needed) {
      throw new Error(`Not enough component stock at this warehouse — have ${available}, need ${needed}.`)
    }
  }

  const { data: order } = await supabase
    .from('production_orders')
    .select('id, order_number, target_quantity, completed_quantity')
    .eq('bom_header_id', bomHeaderId)
    .eq('warehouse_id', warehouseId)
    .in('status', ['DRAFT', 'IN_PROGRESS'])
    .limit(1)
    .maybeSingle()

  let refId: string
  let refType: 'production_order' | 'production_log'
  let label: string

  if (order) {
    refId = order.id
    refType = 'production_order'
    label = order.order_number
    const newCompleted = Math.min(order.target_quantity, order.completed_quantity + quantity)
    const { error: ordErr } = await supabase.from('production_orders').update({
      completed_quantity: newCompleted,
      status: newCompleted >= order.target_quantity ? 'COMPLETED' : 'IN_PROGRESS',
    }).eq('id', order.id)
    if (ordErr) throw new Error(ordErr.message)

    const { data: existingLog } = await supabase.from('production_daily_logs')
      .select('id, quantity_produced').eq('production_order_id', order.id).eq('log_date', logDate).maybeSingle()
    if (existingLog) {
      const { error } = await supabase.from('production_daily_logs')
        .update({ quantity_produced: Number(existingLog.quantity_produced) + quantity, notes: notes || null })
        .eq('id', existingLog.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('production_daily_logs').insert({
        production_order_id: order.id, log_date: logDate, quantity_produced: quantity, notes: notes || null,
      })
      if (error) throw new Error(error.message)
    }
  } else {
    refId = bomHeaderId
    refType = 'production_log'
    label = `${bom.name} (${logDate})`

    const { data: existingLog } = await supabase.from('production_daily_logs')
      .select('id, quantity_produced').eq('bom_header_id', bomHeaderId).eq('warehouse_id', warehouseId)
      .eq('log_date', logDate).is('production_order_id', null).maybeSingle()
    if (existingLog) {
      const { error } = await supabase.from('production_daily_logs')
        .update({ quantity_produced: Number(existingLog.quantity_produced) + quantity, notes: notes || null })
        .eq('id', existingLog.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('production_daily_logs').insert({
        bom_header_id: bomHeaderId, product_id: productId, warehouse_id: warehouseId,
        log_date: logDate, quantity_produced: quantity, notes: notes || null,
      })
      if (error) throw new Error(error.message)
    }
  }

  await postInventoryMovement({
    product_id: productId, quantity, movement_type: 'PRODUCTION_OUTPUT', movement_date: logDate,
    warehouse_id: warehouseId, notes: `Quick log · ${label}`, reference_type: refType, reference_id: refId,
  })

  for (const line of bomLines ?? []) {
    const needed = Number(line.quantity_required ?? 0) * quantity
    await postInventoryMovement({
      product_id: line.component_product_id, quantity: -needed, movement_type: 'PRODUCTION_CONSUMED', movement_date: logDate,
      warehouse_id: warehouseId, notes: `Withdrawn for ${label}`, reference_type: refType, reference_id: refId,
    })
  }
}
