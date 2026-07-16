// src/api/forecast.ts — shared data-fetch for demand/stock-out forecasting,
// used by the Dashboard's lightweight "N products at risk" summary. The
// Inventory page's Forecast tab computes this itself from data it already
// has loaded (inventory_ledger + BOMs) rather than calling this a second
// time.
import { supabase } from '../lib/supabase'
import { fetchBoms } from './bom'
import { computeDemandForecast, type SalesLine, type ForecastRow } from '../lib/forecasting'

export async function fetchForecast(): Promise<Map<string, ForecastRow>> {
  const sixtyAgo = new Date(); sixtyAgo.setDate(sixtyAgo.getDate() - 60)
  const sixtyAgoIso = sixtyAgo.toISOString().slice(0, 10)

  const [linesRes, invRes, bomsRaw] = await Promise.all([
    supabase.from('sales_order_lines').select('product_id, quantity, sales_orders(sale_date, status)'),
    supabase.from('current_inventory').select('product_id, warehouse_id, quantity_on_hand'),
    fetchBoms(),
  ])

  const salesLines: SalesLine[] = (linesRes.data ?? [])
    .map((r: any) => {
      const order = Array.isArray(r.sales_orders) ? r.sales_orders[0] : r.sales_orders
      return { product_id: r.product_id, quantity: Number(r.quantity ?? 0), sale_date: order?.sale_date ?? '', status: order?.status ?? '' }
    })
    .filter((r: any) => r.sale_date >= sixtyAgoIso && (r.status === 'INVOICED' || r.status === 'PAID'))
    .map((r: any) => ({ product_id: r.product_id, quantity: r.quantity, sale_date: r.sale_date }))

  const invRows = (invRes.data ?? []) as Array<{ product_id: string; warehouse_id: string | null; quantity_on_hand: number }>
  const stockByKey = new Map<string, number>()
  const onHandByProduct = new Map<string, number>()
  for (const row of invRows) {
    const qty = Number(row.quantity_on_hand ?? 0)
    stockByKey.set(`${row.warehouse_id ?? ''}:${row.product_id}`, qty)
    onHandByProduct.set(row.product_id, (onHandByProduct.get(row.product_id) ?? 0) + qty)
  }

  const boms = (bomsRaw ?? []).filter((b: any) => b.isActive && b.lines.length > 0)
  const warehouseIds = new Set(invRows.map(r => r.warehouse_id ?? ''))
  const buildableByProduct = new Map<string, number>()
  for (const whId of warehouseIds) {
    for (const bom of boms as any[]) {
      let buildable = Infinity
      for (const line of bom.lines) {
        const stock = stockByKey.get(`${whId}:${line.componentProductId}`) ?? 0
        const possible = line.quantityRequired > 0 ? Math.floor(stock / line.quantityRequired) : 0
        buildable = Math.min(buildable, possible)
      }
      if (buildable !== Infinity && buildable > 0) {
        buildableByProduct.set(bom.productId, (buildableByProduct.get(bom.productId) ?? 0) + buildable)
      }
    }
  }

  const stockByProduct = new Map<string, { onHand: number; buildable: number }>()
  for (const [pid, onHand] of onHandByProduct) stockByProduct.set(pid, { onHand, buildable: buildableByProduct.get(pid) ?? 0 })
  for (const [pid, buildable] of buildableByProduct) if (!stockByProduct.has(pid)) stockByProduct.set(pid, { onHand: 0, buildable })

  return computeDemandForecast(salesLines, stockByProduct)
}
