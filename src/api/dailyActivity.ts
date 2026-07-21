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

// One row per real money movement — sales payments, credit repayments,
// company expenses, supplier payments (hawala-aware), and paid shipment
// expenses. `etbAmount` is what actually moved through an ETB account:
// for a hawala supplier payment that's etb_amount (what left the till to
// pay the dealer), not `amount` (the payable's own currency, which never
// touches an ETB account) — same convention as the Dashboard/Reports cash
// figures, so a day's net cash here always agrees with those.
export type MoneyCategory = 'sale' | 'credit_repayment' | 'expense' | 'supplier_payment' | 'shipment_expense'
export interface MoneyRow {
  date: string
  direction: 'in' | 'out'
  category: MoneyCategory
  party: string
  amount: number
  currency: string
  etbAmount: number
  detail?: string | null
}

export interface DailyActivityData {
  productionLogs: ProductionLogRow[]
  transfers: TransferRow[]
  sales: SalesRow[]
  shipmentsReceived: ShipmentReceivedRow[]
  damage: DamageRow[]
  adjustments: AdjustmentRow[]
  money: MoneyRow[]
  warehouses: LookupOption[]
  products: LookupOption[]
  suppliers: LookupOption[]
}

export async function fetchDailyActivityData(days = 14): Promise<DailyActivityData> {
  const since = daysAgoIso(days)
  const sinceTs = `${since}T00:00:00Z`
  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const [
    prodLogsRes, ordersRes, transfersRes, salesRes, shipmentsRes, damageRes,
    adjustmentsRes, salesPaymentsRes, creditRepaymentsRes, expensesRes,
    supplierPaymentsRes, shipmentExpensesRes, warehousesRes, productsRes, suppliersRes,
  ] = await Promise.all([
    supabase.from('production_daily_logs').select('log_date, quantity_produced, production_order_id, product_id, warehouse_id').gte('log_date', since),
    supabase.from('production_orders').select('id, warehouse_id, product_id'),
    supabase.from('warehouse_transfers').select('id, transfer_number, transfer_date, received_at, quantity, from_warehouse_id, to_warehouse_id, product_id, purpose, driver_name, truck_plate, status').or(`transfer_date.gte.${since},received_at.gte.${sinceTs}`),
    supabase.from('sales_orders').select('sale_date, warehouse_id, total_etb').gte('sale_date', since),
    supabase.from('shipments').select('id, shipment_number, supplier_id, warehouse_id, inventory_received_at').gte('inventory_received_at', sinceTs),
    supabase.from('damage_reports').select('id, report_number, report_date, product_id, warehouse_id, quantity, reason').gte('report_date', since),
    supabase.from('inventory_ledger').select('id, movement_date, product_id, warehouse_id, quantity, notes').eq('movement_type', 'ADJUSTMENT').gte('movement_date', sinceTs),
    supabase.from('sales_payments').select('payment_date, amount_etb, sales_orders(customers(name))').gte('payment_date', since),
    supabase.from('credit_transactions').select('amount, transaction_date, credit_accounts(customers(name))').eq('type', 'repayment').gte('transaction_date', since),
    supabase.from('company_expenses').select('amount, currency, expense_date, vendor_name, description').gte('expense_date', since),
    supabase.from('supplier_payments').select('amount, method, etb_amount, hawala_route, payment_date, supplier_payables(currency, suppliers(name))').gte('payment_date', since),
    supabase.from('shipment_expenses').select('amount, amount_etb, currency, paid_at, vendor_name, description').eq('is_paid', true).gte('paid_at', sinceTs),
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
    ['sales payments', salesPaymentsRes.error],
    ['credit repayments', creditRepaymentsRes.error],
    ['expenses', expensesRes.error],
    ['supplier payments', supplierPaymentsRes.error],
    ['shipment expenses', shipmentExpensesRes.error],
    ['warehouses', warehousesRes.error],
    ['products', productsRes.error],
    ['suppliers', suppliersRes.error],
  ] as const
  const failed = checks.filter(([, err]) => err)
  if (failed.length > 0) {
    throw new Error(`Failed to load: ${failed.map(([name]) => name).join(', ')}`)
  }

  const money: MoneyRow[] = [
    ...(salesPaymentsRes.data ?? []).map((r: any) => {
      const order = one(r.sales_orders); const customer = order ? one(order.customers) : null
      const amt = Number(r.amount_etb ?? 0)
      return { date: r.payment_date, direction: 'in' as const, category: 'sale' as const, party: customer?.name ?? 'Unknown customer', amount: amt, currency: 'ETB', etbAmount: amt }
    }),
    ...(creditRepaymentsRes.data ?? []).map((r: any) => {
      const acct = one(r.credit_accounts); const customer = acct ? one(acct.customers) : null
      const amt = Number(r.amount ?? 0)
      return { date: r.transaction_date, direction: 'in' as const, category: 'credit_repayment' as const, party: customer?.name ?? 'Unknown customer', amount: amt, currency: 'ETB', etbAmount: amt }
    }),
    ...(expensesRes.data ?? []).map((r: any) => {
      const amt = Number(r.amount ?? 0)
      return { date: r.expense_date, direction: 'out' as const, category: 'expense' as const, party: r.vendor_name ?? r.description ?? 'Expense', amount: amt, currency: r.currency ?? 'ETB', etbAmount: r.currency === 'ETB' ? amt : 0 }
    }),
    ...(supplierPaymentsRes.data ?? []).map((r: any) => {
      const payable = one(r.supplier_payables); const supplier = payable ? one((payable as any).suppliers) : null
      const amt = Number(r.amount ?? 0)
      const isHawala = r.method === 'hawala' && r.etb_amount != null
      const etbAmount = isHawala ? Number(r.etb_amount) : ((payable as any)?.currency === 'ETB' ? amt : 0)
      return {
        date: r.payment_date, direction: 'out' as const, category: 'supplier_payment' as const,
        party: supplier?.name ?? 'Unknown supplier', amount: amt, currency: (payable as any)?.currency ?? 'USD',
        etbAmount, detail: isHawala ? (r.hawala_route ?? 'Hawala') : null,
      }
    }),
    ...(shipmentExpensesRes.data ?? []).map((r: any) => {
      const amt = Number(r.amount ?? 0)
      return {
        date: r.paid_at ? String(r.paid_at).slice(0, 10) : '', direction: 'out' as const, category: 'shipment_expense' as const,
        party: r.vendor_name ?? r.description ?? 'Shipment cost', amount: amt, currency: r.currency ?? 'ETB',
        etbAmount: Number(r.amount_etb ?? 0),
      }
    }).filter((r: MoneyRow) => r.date >= since),
  ]

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
    money,
    warehouses: (warehousesRes.data ?? []) as LookupOption[],
    products: (productsRes.data ?? []) as LookupOption[],
    suppliers: (suppliersRes.data ?? []) as LookupOption[],
  }
}
