// src/api/dailyActivity.ts — daily operations feed: production, shipment
// receipts, transfers, sales, damage/loss, stock adjustments, and cash
// in/out, all grouped by day. Built directly on documented tables (no
// dependency on an opaque DB view).
//
// inventory_ledger logs EVERY inventory-affecting event, including ones
// that already get their own dedicated section here (a production run
// writes PRODUCTION_OUTPUT/PRODUCTION_CONSUMED rows, a sale writes SALE
// rows, a transfer writes TRANSFER_IN/TRANSFER_OUT rows). Querying the
// ledger without filtering movement_type — which the previous version of
// this file did — means "today" gets reported three times over: once as
// "5 units produced", once again as an unlabeled "1 in" under a generic
// "stock movement" bucket, and a third time buried in a transfer/sale
// line. Ledger rows are only pulled here for movement_type = 'ADJUSTMENT'
// (manual corrections — the one ledger-only event with no other source
// table of its own).
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
  id: string
  transfer_number: string
  event_date: string // the date this transfer actually belongs under — received_at's date once received, transfer_date (requested) otherwise
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

export interface ShipmentReceivedRow {
  id: string
  shipment_number: string
  supplier_id: string | null
  warehouse_id: string | null
  received_at: string
}

export interface DamageRow {
  id: string
  report_number: string
  report_date: string
  product_id: string | null
  warehouse_id: string | null
  quantity: number
  reason: string | null
}

export interface AdjustmentRow {
  id: string
  movement_date: string
  product_id: string | null
  warehouse_id: string | null
  quantity: number
  notes: string | null
}

export interface PaymentInRow {
  payment_date: string
  amount_etb: number
}

export interface DailyActivityData {
  productionLogs: ProductionLogRow[]
  transfers: TransferRow[]
  sales: SalesRow[]
  shipmentsReceived: ShipmentReceivedRow[]
  damage: DamageRow[]
  adjustments: AdjustmentRow[]
  paymentsIn: PaymentInRow[]
  warehouses: LookupOption[]
  products: LookupOption[]
  suppliers: LookupOption[]
}

export async function fetchDailyActivityData(days = 14): Promise<DailyActivityData> {
  const since = daysAgoIso(days)
  const sinceTs = `${since}T00:00:00Z`

  const [
    prodLogsRes, ordersRes, transfersRes, salesRes, shipmentsRes, damageRes,
    adjustmentsRes, paymentsRes, warehousesRes, productsRes, suppliersRes,
  ] = await Promise.all([
    supabase.from('production_daily_logs').select('log_date, quantity_produced, production_order_id, product_id, warehouse_id').gte('log_date', since),
    supabase.from('production_orders').select('id, warehouse_id, product_id'),
    supabase.from('warehouse_transfers').select('id, transfer_number, transfer_date, received_at, quantity, from_warehouse_id, to_warehouse_id, product_id, purpose, driver_name, truck_plate, status').or(`transfer_date.gte.${since},received_at.gte.${sinceTs}`),
    supabase.from('sales_orders').select('sale_date, warehouse_id, total_etb').gte('sale_date', since),
    supabase.from('shipments').select('id, shipment_number, supplier_id, warehouse_id, inventory_received_at').gte('inventory_received_at', sinceTs),
    supabase.from('damage_reports').select('id, report_number, report_date, product_id, warehouse_id, quantity, reason').gte('report_date', since),
    supabase.from('inventory_ledger').select('id, movement_date, product_id, warehouse_id, quantity, notes').eq('movement_type', 'ADJUSTMENT').gte('movement_date', sinceTs),
    supabase.from('sales_payments').select('payment_date, amount_etb').gte('payment_date', since),
    supabase.from('warehouses').select('id, name'),
    supabase.from('products').select('id, name'),
    supabase.from('suppliers').select('id, name'),
  ])

  const checks = [
    ['production logs', prodLogsRes.error],
    ['production orders', ordersRes.error],
    ['warehouse transfers', transfersRes.error],
    ['sales orders', salesRes.error],
    ['shipments', shipmentsRes.error],
    ['damage reports', damageRes.error],
    ['stock adjustments', adjustmentsRes.error],
    ['payments', paymentsRes.error],
    ['warehouses', warehousesRes.error],
    ['products', productsRes.error],
    ['suppliers', suppliersRes.error],
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

  // A transfer belongs under the day it actually happened: once received,
  // that's the receipt date, not whenever it was originally requested —
  // otherwise a transfer requested on day 1 and received on day 5 only
  // ever shows up under day 1, and day 5's "stock actually arrived" event
  // is invisible.
  const transfers: TransferRow[] = (transfersRes.data ?? [])
    .map((t: any) => ({
      id: t.id,
      transfer_number: t.transfer_number,
      event_date: t.status === 'RECEIVED' && t.received_at ? String(t.received_at).split('T')[0] : t.transfer_date,
      quantity: Number(t.quantity ?? 0),
      from_warehouse_id: t.from_warehouse_id,
      to_warehouse_id: t.to_warehouse_id,
      product_id: t.product_id,
      purpose: t.purpose,
      driver_name: t.driver_name,
      truck_plate: t.truck_plate,
      status: t.status,
    }))
    .filter((t: TransferRow) => t.event_date >= since)

  return {
    productionLogs,
    transfers,
    sales: (salesRes.data ?? []) as SalesRow[],
    shipmentsReceived: (shipmentsRes.data ?? []).map((s: any) => ({
      id: s.id, shipment_number: s.shipment_number, supplier_id: s.supplier_id,
      warehouse_id: s.warehouse_id, received_at: s.inventory_received_at,
    })),
    damage: (damageRes.data ?? []) as DamageRow[],
    adjustments: (adjustmentsRes.data ?? []).map((a: any) => ({
      id: a.id, movement_date: a.movement_date, product_id: a.product_id,
      warehouse_id: a.warehouse_id, quantity: Number(a.quantity ?? 0), notes: a.notes,
    })),
    paymentsIn: (paymentsRes.data ?? []).map((p: any) => ({ payment_date: p.payment_date, amount_etb: Number(p.amount_etb ?? 0) })),
    warehouses: (warehousesRes.data ?? []) as LookupOption[],
    products: (productsRes.data ?? []) as LookupOption[],
    suppliers: (suppliersRes.data ?? []) as LookupOption[],
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
