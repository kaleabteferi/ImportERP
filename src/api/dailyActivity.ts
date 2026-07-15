// src/api/dailyActivity.ts — daily report feed: production, warehouse
// transfers, sales, and stock movement, all grouped by day and warehouse.
// Built directly on documented tables (no dependency on an opaque DB view).
import { supabase } from '../lib/supabase'

function daysAgoIso(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export interface LookupOption { id: string; name: string }

export interface ProductionLogRow {
  log_date: string
  quantity_produced: number
  warehouse_id: string | null
  product_id: string | null
}

export interface TransferRow {
  transfer_date: string
  quantity: number
  from_warehouse_id: string
  to_warehouse_id: string | null
  product_id: string
  purpose: string
  driver_name: string | null
  truck_plate: string | null
  status: string
}

export interface SalesRow {
  sale_date: string
  warehouse_id: string | null
  total_etb: number
}

export interface StockMoveRow {
  movement_date: string
  warehouse_id: string | null
  quantity: number
}

export interface DailyActivityData {
  productionLogs: ProductionLogRow[]
  transfers: TransferRow[]
  sales: SalesRow[]
  stockMoves: StockMoveRow[]
  warehouses: LookupOption[]
  products: LookupOption[]
}

export async function fetchDailyActivityData(days = 14): Promise<DailyActivityData> {
  const since = daysAgoIso(days)

  const [prodLogsRes, ordersRes, transfersRes, salesRes, ledgerRes, warehousesRes, productsRes] = await Promise.all([
    supabase.from('production_daily_logs').select('log_date, quantity_produced, production_order_id, product_id, warehouse_id').gte('log_date', since),
    supabase.from('production_orders').select('id, warehouse_id, product_id'),
    supabase.from('warehouse_transfers').select('transfer_date, quantity, from_warehouse_id, to_warehouse_id, product_id, purpose, driver_name, truck_plate, status').gte('transfer_date', since),
    supabase.from('sales_orders').select('sale_date, warehouse_id, total_etb').gte('sale_date', since),
    supabase.from('inventory_ledger').select('movement_date, warehouse_id, quantity').gte('movement_date', since),
    supabase.from('warehouses').select('id, name'),
    supabase.from('products').select('id, name'),
  ])

  const checks = [
    ['production logs', prodLogsRes.error],
    ['production orders', ordersRes.error],
    ['warehouse transfers', transfersRes.error],
    ['sales orders', salesRes.error],
    ['inventory ledger', ledgerRes.error],
    ['warehouses', warehousesRes.error],
    ['products', productsRes.error],
  ] as const
  const failed = checks.filter(([, err]) => err)
  if (failed.length > 0) {
    throw new Error(`Failed to load: ${failed.map(([name]) => name).join(', ')}`)
  }

  const orderById = new Map((ordersRes.data ?? []).map((o: any) => [o.id, o]))
  const productionLogs: ProductionLogRow[] = (prodLogsRes.data ?? []).map((l: any) => {
    const order = orderById.get(l.production_order_id)
    return {
      log_date: l.log_date,
      quantity_produced: Number(l.quantity_produced ?? 0),
      warehouse_id: l.warehouse_id ?? order?.warehouse_id ?? null,
      product_id: l.product_id ?? order?.product_id ?? null,
    }
  })

  return {
    productionLogs,
    transfers: (transfersRes.data ?? []) as TransferRow[],
    sales: (salesRes.data ?? []) as SalesRow[],
    stockMoves: (ledgerRes.data ?? []) as StockMoveRow[],
    warehouses: (warehousesRes.data ?? []) as LookupOption[],
    products: (productsRes.data ?? []) as LookupOption[],
  }
}

export async function fetchExpensesByDate(dates: string[]) {
  if (dates.length === 0) return []
  const { data, error } = await supabase
    .from('company_expenses')
    .select('expense_date, amount, currency')
    .in('expense_date', dates)
  if (error) throw new Error(error.message)
  return data
}
