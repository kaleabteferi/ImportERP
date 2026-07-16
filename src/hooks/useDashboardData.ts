// src/hooks/useDashboardData.ts — broader dashboard data: headline KPIs
// (revenue, production, cash position, receivables/payables, inventory
// days-of-stock, customer counts) for Day/Week/Month periods, plus trend
// charts and the drill-down advice cards carried over from the original
// advisor dashboard.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export type Period = 'day' | 'week' | 'month'

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d }

const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 }
const TREND_DAYS: Record<Period, number> = { day: 7, week: 28, month: 90 }

export interface DayPoint { date: string; value: number }
export interface TopProduct { name: string; quantity: number; revenue: number }
export interface LowMarginProduct { name: string; marginPct: number }
export interface AdviceItem { text: string; impact: 'high' | 'medium' | 'low' }
export interface TodoItem { text: string; link?: string }

export interface DashboardData {
  // Tier 1 — headline, with period-over-period variance
  revenueEtb: number
  revenuePrevEtb: number
  producedUnits: number
  producedPrevUnits: number
  cashInEtb: number
  cashOutEtb: number
  receivablesEtb: number
  payablesEtb: number
  // Payables run mostly USD-priced (purchase orders quoted to suppliers in
  // USD) — surfaced separately rather than folded into payablesEtb, since
  // there's no reliable ETB-converted total to sum them into without risking
  // the same currency-drift bug fixed elsewhere in this app.
  payablesUsd: number
  inventoryValueEtb: number
  daysOfStock: number | null
  activeCustomers: number
  frequentCustomers: number

  // Tier 2 — trends
  revenueTrend: DayPoint[]
  productionTrend: DayPoint[]

  // Tier 3 — drill-down
  topProducts: TopProduct[]
  lowMarginProducts: LowMarginProduct[]
  topAdvice: AdviceItem | null
  secondaryAdvice: AdviceItem | null
  todoToday: TodoItem[]

  lastUpdated: Date | null
  loading: boolean
  error: string | null
}

export function useDashboardData(period: Period): DashboardData {
  const [data, setData] = useState<Omit<DashboardData, 'loading' | 'error' | 'lastUpdated'>>({
    revenueEtb: 0, revenuePrevEtb: 0, producedUnits: 0, producedPrevUnits: 0,
    cashInEtb: 0, cashOutEtb: 0, receivablesEtb: 0, payablesEtb: 0, payablesUsd: 0,
    inventoryValueEtb: 0, daysOfStock: null, activeCustomers: 0, frequentCustomers: 0,
    revenueTrend: [], productionTrend: [],
    topProducts: [], lowMarginProducts: [], topAdvice: null, secondaryAdvice: null, todoToday: [],
  })
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const periodDays = PERIOD_DAYS[period]
      const trendDays = TREND_DAYS[period]
      const periodStart = isoDate(daysAgo(periodDays - 1))
      const prevPeriodStart = isoDate(daysAgo(periodDays * 2 - 1))
      const prevPeriodEnd = isoDate(daysAgo(periodDays))
      const trendStart = isoDate(daysAgo(trendDays - 1))
      const monthAgo = isoDate(daysAgo(29))

      const [
        salesRes, prevSalesRes, prodLogsRes, prevProdLogsRes,
        salesPaymentsRes, purchasePaymentsRes, expensesRes,
        creditRepaymentsRes, shipmentExpensesPaidRes, shipmentExpensesUnpaidRes,
        customersRes, purchaseOrdersRes, inventoryRes,
        productionOrdersRes, bomHeadersRes, monthOrdersRes,
      ] = await Promise.all([
        supabase.from('sales_orders').select('id, sale_date, total_etb, gross_profit_etb, customer_id, status').gte('sale_date', periodStart).in('status', ['INVOICED', 'PAID']),
        supabase.from('sales_orders').select('total_etb').gte('sale_date', prevPeriodStart).lte('sale_date', prevPeriodEnd).in('status', ['INVOICED', 'PAID']),
        supabase.from('production_daily_logs').select('log_date, quantity_produced').gte('log_date', periodStart),
        supabase.from('production_daily_logs').select('quantity_produced').gte('log_date', prevPeriodStart).lte('log_date', prevPeriodEnd),
        supabase.from('sales_payments').select('amount_etb, payment_date').gte('payment_date', periodStart),
        supabase.from('purchase_order_payments').select('amount, currency, payment_date').gte('payment_date', periodStart),
        supabase.from('company_expenses').select('amount, currency, expense_date').gte('expense_date', periodStart),
        // Credit repayments are real cash in — a customer paying down a credit
        // account — but weren't being counted in cashInEtb before.
        supabase.from('credit_transactions').select('amount, transaction_date').eq('type', 'repayment').gte('transaction_date', periodStart),
        // Shipment expenses paid via Payables -> "Mark as paid" are real cash
        // out but were invisible here (only purchase_order_payments and
        // company_expenses were counted).
        supabase.from('shipment_expenses').select('amount_etb, currency, paid_at').eq('is_paid', true).gte('paid_at', periodStart),
        supabase.from('shipment_expenses').select('amount_etb, currency').eq('is_paid', false),
        supabase.from('customers').select('id, outstanding_etb'),
        supabase.from('purchase_orders').select('total_amount, paid_amount, currency'),
        supabase.from('current_inventory').select('quantity_on_hand, avg_unit_cost_etb'),
        supabase.from('production_orders').select('id, target_quantity, planned_start_date').gte('planned_start_date', periodStart),
        supabase.from('bom_headers').select('id, product_id, finished_product_id, is_active').eq('is_active', true),
        // Independent of `period` — "days of stock" needs a real trailing
        // 30-day COGS figure. Reusing the period-filtered `orders` array here
        // was a bug: on the Day/Week views it only ever contains today's or
        // this week's orders, so dividing by 30 wildly overstated days-of-stock.
        supabase.from('sales_orders').select('sale_date, total_etb, gross_profit_etb').gte('sale_date', monthAgo).in('status', ['INVOICED', 'PAID']),
      ])

      const critical = [
        ['sales', salesRes.error], ['production logs', prodLogsRes.error],
        ['sales payments', salesPaymentsRes.error], ['purchase payments', purchasePaymentsRes.error],
        ['expenses', expensesRes.error], ['credit repayments', creditRepaymentsRes.error],
        ['shipment expenses (paid)', shipmentExpensesPaidRes.error], ['shipment expenses (unpaid)', shipmentExpensesUnpaidRes.error],
        ['customers', customersRes.error],
        ['purchase orders', purchaseOrdersRes.error], ['inventory', inventoryRes.error],
        ['30-day sales', monthOrdersRes.error],
      ] as const
      const failed = critical.filter(([, err]) => err)
      if (failed.length > 0) throw new Error(`Failed to load: ${failed.map(([n]) => n).join(', ')}`)

      // ---- Tier 1: headline ----
      const orders = salesRes.data ?? []
      const revenueEtb = orders.reduce((s, o) => s + Number(o.total_etb ?? 0), 0)
      const revenuePrevEtb = (prevSalesRes.data ?? []).reduce((s, o) => s + Number(o.total_etb ?? 0), 0)

      const prodLogs = prodLogsRes.data ?? []
      const producedUnits = prodLogs.reduce((s, r) => s + Number(r.quantity_produced ?? 0), 0)
      const producedPrevUnits = (prevProdLogsRes.data ?? []).reduce((s, r) => s + Number(r.quantity_produced ?? 0), 0)

      // Cash in/out are ETB-only sums where currency=ETB; USD payment rows are
      // rare on these tables in practice (purchases run mostly USD-priced but
      // paid_amount tracked in order currency) — flagged as an approximation.
      const cashInEtb =
        (salesPaymentsRes.data ?? []).reduce((s, p) => s + Number(p.amount_etb ?? 0), 0) +
        (creditRepaymentsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0)
      const cashOutEtb =
        (purchasePaymentsRes.data ?? []).filter((p: any) => p.currency === 'ETB').reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0) +
        (expensesRes.data ?? []).filter((e: any) => e.currency === 'ETB').reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0) +
        (shipmentExpensesPaidRes.data ?? []).filter((e: any) => e.currency === 'ETB').reduce((s: number, e: any) => s + Number(e.amount_etb ?? 0), 0)

      const receivablesEtb = (customersRes.data ?? []).reduce((s, c: any) => s + Number(c.outstanding_etb ?? 0), 0)
      const payablesEtb =
        (purchaseOrdersRes.data ?? [])
          .filter((po: any) => po.currency === 'ETB')
          .reduce((s: number, po: any) => s + Math.max(0, Number(po.total_amount ?? 0) - Number(po.paid_amount ?? 0)), 0) +
        (shipmentExpensesUnpaidRes.data ?? [])
          .filter((e: any) => e.currency === 'ETB')
          .reduce((s: number, e: any) => s + Number(e.amount_etb ?? 0), 0)
      const payablesUsd = (purchaseOrdersRes.data ?? [])
        .filter((po: any) => po.currency === 'USD')
        .reduce((s: number, po: any) => s + Math.max(0, Number(po.total_amount ?? 0) - Number(po.paid_amount ?? 0)), 0)

      const inventoryRows = inventoryRes.data ?? []
      const inventoryValueEtb = inventoryRows.reduce((s: number, r: any) => s + Number(r.quantity_on_hand ?? 0) * Number(r.avg_unit_cost_etb ?? 0), 0)

      // Days of stock: inventory value / average daily COGS over the last 30
      // days — always the trailing 30 days regardless of the selected period.
      const monthCogs = (monthOrdersRes.data ?? [])
        .reduce((s: number, o: any) => s + Math.max(0, Number(o.total_etb ?? 0) - Number(o.gross_profit_etb ?? 0)), 0)
      const avgDailyCogs = monthCogs / 30
      const daysOfStock = avgDailyCogs > 0 ? inventoryValueEtb / avgDailyCogs : null

      const activeCustomers = new Set(orders.map(o => o.customer_id)).size
      const { data: last30dOrders } = await supabase.from('sales_orders').select('customer_id').gte('sale_date', monthAgo)
      const ordersPerCustomer = new Map<string, number>()
      for (const o of last30dOrders ?? []) ordersPerCustomer.set(o.customer_id, (ordersPerCustomer.get(o.customer_id) ?? 0) + 1)
      const frequentCustomers = [...ordersPerCustomer.values()].filter(n => n >= 2).length

      // ---- Tier 2: trends ----
      const { data: trendSales } = await supabase.from('sales_orders').select('sale_date, total_etb').gte('sale_date', trendStart).in('status', ['INVOICED', 'PAID'])
      const { data: trendProd } = await supabase.from('production_daily_logs').select('log_date, quantity_produced').gte('log_date', trendStart)

      const revenueTrend: DayPoint[] = []
      const productionTrend: DayPoint[] = []
      for (let i = trendDays - 1; i >= 0; i--) {
        const d = isoDate(daysAgo(i))
        revenueTrend.push({ date: d, value: (trendSales ?? []).filter((o: any) => o.sale_date === d).reduce((s: number, o: any) => s + Number(o.total_etb ?? 0), 0) })
        productionTrend.push({ date: d, value: (trendProd ?? []).filter((r: any) => r.log_date === d).reduce((s: number, r: any) => s + Number(r.quantity_produced ?? 0), 0) })
      }

      // ---- Tier 3: drill-down (top products, margins, advice, todo) ----
      const orderIds = orders.map(o => o.id)
      let topProducts: TopProduct[] = []
      let lowMarginProducts: LowMarginProduct[] = []

      if (orderIds.length > 0) {
        const { data: lines } = await supabase
          .from('sales_order_lines')
          .select('product_id, quantity, unit_price_etb, unit_cost_etb_snapshot')
          .in('sales_order_id', orderIds)

        const productTotals = new Map<string, { qty: number; revenue: number; cost: number }>()
        for (const l of lines ?? []) {
          const key = l.product_id
          const qty = Number(l.quantity ?? 0)
          const revenue = qty * Number(l.unit_price_etb ?? 0)
          const cost = qty * Number(l.unit_cost_etb_snapshot ?? 0)
          const entry = productTotals.get(key) ?? { qty: 0, revenue: 0, cost: 0 }
          entry.qty += qty; entry.revenue += revenue; entry.cost += cost
          productTotals.set(key, entry)
        }
        const productIds = [...productTotals.keys()]
        const { data: products } = productIds.length > 0
          ? await supabase.from('products').select('id, name').in('id', productIds)
          : { data: [] }
        const productById = new Map((products ?? []).map((p: any) => [p.id, p]))

        topProducts = [...productTotals.entries()]
          .map(([id, t]) => ({ name: productById.get(id)?.name ?? 'Unknown', quantity: t.qty, revenue: t.revenue }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5)

        lowMarginProducts = [...productTotals.entries()]
          .filter(([, t]) => t.revenue > 0)
          .map(([id, t]) => ({ name: productById.get(id)?.name ?? 'Unknown', marginPct: ((t.revenue - t.cost) / t.revenue) * 100 }))
          .sort((a, b) => a.marginPct - b.marginPct)
          .slice(0, 3)
      }

      const todoToday: TodoItem[] = []
      const overduePOs = (purchaseOrdersRes.data ?? []).filter((po: any) => Number(po.paid_amount ?? 0) < Number(po.total_amount ?? 0))
      const outstandingCount = overduePOs.length + (shipmentExpensesUnpaidRes.data ?? []).length
      if (outstandingCount > 0) todoToday.push({ text: `${outstandingCount} supplier payment${outstandingCount > 1 ? 's' : ''} still outstanding.`, link: '/payables' })
      if (receivablesEtb > 0) todoToday.push({ text: `${Math.round(receivablesEtb).toLocaleString()} ETB owed by customers — follow up on overdue accounts.`, link: '/receivables' })
      const draftOrders = (productionOrdersRes.data ?? []).length
      const weeklyTargetTotal = (productionOrdersRes.data ?? []).reduce((s: number, o: any) => s + Number(o.target_quantity ?? 0), 0)
      if (bomHeadersRes.data && bomHeadersRes.data.length === 0) todoToday.push({ text: 'No active BOMs — assembly and sticker stages can\'t be logged yet.', link: '/boms' })

      let topAdvice: AdviceItem | null = null
      let secondaryAdvice: AdviceItem | null = null
      const gapVsTarget = weeklyTargetTotal - producedUnits
      const topProduct = topProducts[0]
      const topShare = topProduct && revenueEtb > 0 ? (topProduct.revenue / revenueEtb) * 100 : 0

      if (draftOrders > 0 && gapVsTarget > 0 && topProduct && topShare > 40) {
        topAdvice = { impact: 'high', text: `Increase ${topProduct.name} production — demand is outpacing output and it drives ${Math.round(topShare)}% of revenue this ${period}.` }
      } else if (lowMarginProducts.length > 0 && lowMarginProducts[0].marginPct < 20) {
        topAdvice = { impact: 'high', text: `Review pricing or cost on "${lowMarginProducts[0].name}" — its margin is only ${lowMarginProducts[0].marginPct.toFixed(0)}%.` }
      } else if (daysOfStock !== null && daysOfStock < 7) {
        topAdvice = { impact: 'high', text: `Only ${daysOfStock.toFixed(0)} days of stock left at current sales pace — plan the next shipment.` }
      } else if (todoToday.length > 0) {
        topAdvice = { impact: 'medium', text: todoToday[0].text }
      } else {
        topAdvice = { impact: 'low', text: `Production and sales both look healthy this ${period} — no urgent action needed.` }
      }
      if (todoToday.length > 1) secondaryAdvice = { impact: 'medium', text: todoToday[1].text }

      setData({
        revenueEtb, revenuePrevEtb, producedUnits, producedPrevUnits,
        cashInEtb, cashOutEtb, receivablesEtb, payablesEtb, payablesUsd,
        inventoryValueEtb, daysOfStock, activeCustomers, frequentCustomers,
        revenueTrend, productionTrend,
        topProducts, lowMarginProducts, topAdvice, secondaryAdvice, todoToday,
      })
      setLastUpdated(new Date())
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Unable to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  return { ...data, lastUpdated, loading, error }
}
