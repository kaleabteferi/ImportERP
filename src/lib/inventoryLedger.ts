export interface InventoryBalance {
  product_id: string
  product_name: string
  sku: string
  warehouse_id: string | null
  warehouse_name: string
  quantity_on_hand: number
  avg_unit_cost_etb: number
  total_value: number
}

interface InventoryLedgerLike {
  product_id: string | null | undefined
  quantity: number | string | null | undefined
  unit_cost_etb?: number | string | null | undefined
  warehouse_id?: string | null | undefined
  products?: { name?: string | null; sku?: string | null } | Array<{ name?: string | null; sku?: string | null }> | null
  warehouses?: { name?: string | null } | Array<{ name?: string | null }> | null
}

export function calculateInventoryBalances<T extends InventoryLedgerLike>(rows: T[]): InventoryBalance[] {
  const map = new Map<string, InventoryBalance>()

  for (const row of rows) {
    const productId = row.product_id ?? ''
    const warehouseId = row.warehouse_id ?? ''
    const key = `${productId}:${warehouseId}`
    const product = Array.isArray(row.products)
      ? (row.products[0] ?? null)
      : (row.products as { name?: string | null; sku?: string | null } | null)
    const warehouse = Array.isArray(row.warehouses)
      ? (row.warehouses[0] ?? null)
      : (row.warehouses as { name?: string | null } | null)

    if (!map.has(key)) {
      map.set(key, {
        product_id: productId,
        product_name: product?.name ?? '—',
        sku: product?.sku ?? '—',
        warehouse_id: row.warehouse_id ?? null,
        warehouse_name: warehouse?.name ?? 'Main Warehouse',
        quantity_on_hand: 0,
        avg_unit_cost_etb: 0,
        total_value: 0,
      })
    }

    const entry = map.get(key)!
    const qty = Number(row.quantity ?? 0)
    const cost = row.unit_cost_etb == null ? null : Number(row.unit_cost_etb)

    if (qty > 0) {
      const newQty = entry.quantity_on_hand + qty
      const incomingCost = cost ?? entry.avg_unit_cost_etb ?? 0
      const newValue = entry.total_value + qty * incomingCost
      entry.quantity_on_hand = newQty
      entry.total_value = newValue
      entry.avg_unit_cost_etb = newQty > 0 ? newValue / newQty : 0
    } else if (qty < 0) {
      const absQty = Math.abs(qty)
      const currentAvg = entry.quantity_on_hand > 0
        ? entry.total_value / entry.quantity_on_hand
        : (cost ?? entry.avg_unit_cost_etb ?? 0)
      const consumedValue = Math.min(entry.total_value, absQty * currentAvg)
      const newQty = Math.max(0, entry.quantity_on_hand - absQty)
      const newValue = Math.max(0, entry.total_value - consumedValue)
      entry.quantity_on_hand = newQty
      entry.total_value = newValue
      entry.avg_unit_cost_etb = newQty > 0 ? newValue / newQty : 0
    }
  }

  // Do NOT filter out zero-quantity rows: a product that sold out is exactly
  // what an inventory page needs to surface, not hide. Sort out-of-stock
  // items to the bottom (they carry no value) but keep them visible.
  return [...map.values()]
    .sort((a, b) => b.total_value - a.total_value)
}
