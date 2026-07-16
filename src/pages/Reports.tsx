import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BarChart3, Loader2, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, ChevronRight } from 'lucide-react'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

interface PLRow {
  month: string
  revenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  orderCount: number
}

interface CashRow {
  month: string
  cashIn: number
  cashOut: number
}

export function Reports() {
  const [pl, setPL]         = useState<PLRow[]>([])
  const [cash, setCash]     = useState<CashRow[]>([])
  const [payablesEtb, setPayablesEtb] = useState(0)
  const [payablesUsd, setPayablesUsd] = useState(0)
  const [receivablesEtb, setReceivablesEtb] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const sixAgo = new Date()
      sixAgo.setMonth(sixAgo.getMonth() - 5)
      sixAgo.setDate(1)
      const sixAgoIso = sixAgo.toISOString().split('T')[0]

      const [
        salesRes, salesPaymentsRes, creditRepaymentsRes,
        purchasePaymentsRes, expensesRes, shipmentExpensesPaidRes,
        purchaseOrdersRes, shipmentExpensesUnpaidRes, customersRes,
      ] = await Promise.all([
        supabase.from('sales_orders').select('sale_date, total_etb, total_cogs_etb, gross_profit_etb').gte('sale_date', sixAgoIso).in('status', ['INVOICED', 'PAID']).order('sale_date'),
        supabase.from('sales_payments').select('amount_etb, payment_date').gte('payment_date', sixAgoIso),
        supabase.from('credit_transactions').select('amount, transaction_date').eq('type', 'repayment').gte('transaction_date', sixAgoIso),
        supabase.from('purchase_order_payments').select('amount, currency, payment_date').gte('payment_date', sixAgoIso),
        supabase.from('company_expenses').select('amount, currency, expense_date').gte('expense_date', sixAgoIso),
        supabase.from('shipment_expenses').select('amount_etb, currency, paid_at').eq('is_paid', true).gte('paid_at', sixAgoIso),
        supabase.from('purchase_orders').select('total_amount, paid_amount, currency'),
        supabase.from('shipment_expenses').select('amount_etb, currency').eq('is_paid', false),
        supabase.from('customers').select('outstanding_etb'),
      ])

      // ---- P&L (revenue/COGS/margin from invoiced+paid sales orders) ----
      const plMap = new Map<string, PLRow>()
      for (const row of salesRes.data ?? []) {
        const month = row.sale_date.slice(0, 7)
        if (!plMap.has(month)) plMap.set(month, { month, revenue: 0, cogs: 0, grossProfit: 0, grossMarginPct: 0, orderCount: 0 })
        const e = plMap.get(month)!
        e.revenue     += row.total_etb ?? 0
        e.cogs        += row.total_cogs_etb ?? 0
        e.grossProfit += row.gross_profit_etb ?? 0
        e.orderCount  += 1
      }
      setPL([...plMap.values()].map(m => ({ ...m, grossMarginPct: m.revenue > 0 ? (m.grossProfit / m.revenue) * 100 : 0 })))

      // ---- Cash flow — every payment recorded anywhere in the app ----
      // In: sales payments + credit account repayments.
      // Out: supplier PO payments + company expenses + paid shipment expenses
      // (the Payables page's "Mark as paid" flow) — ETB-denominated rows only,
      // matching the same approximation used on the Dashboard.
      const cashMap = new Map<string, CashRow>()
      const bump = (dateStr: string | null, field: 'cashIn' | 'cashOut', amount: number) => {
        if (!dateStr) return
        const month = dateStr.slice(0, 7)
        if (!cashMap.has(month)) cashMap.set(month, { month, cashIn: 0, cashOut: 0 })
        cashMap.get(month)![field] += amount
      }
      for (const r of salesPaymentsRes.data ?? []) bump(r.payment_date, 'cashIn', Number(r.amount_etb ?? 0))
      for (const r of creditRepaymentsRes.data ?? []) bump(r.transaction_date, 'cashIn', Number(r.amount ?? 0))
      for (const r of (purchasePaymentsRes.data ?? []).filter((p: any) => p.currency === 'ETB')) bump(r.payment_date, 'cashOut', Number(r.amount ?? 0))
      for (const r of (expensesRes.data ?? []).filter((e: any) => e.currency === 'ETB')) bump(r.expense_date, 'cashOut', Number(r.amount ?? 0))
      for (const r of (shipmentExpensesPaidRes.data ?? []).filter((e: any) => e.currency === 'ETB')) bump(r.paid_at ? String(r.paid_at).slice(0, 10) : null, 'cashOut', Number(r.amount_etb ?? 0))

      setCash([...cashMap.values()].sort((a, b) => a.month.localeCompare(b.month)))

      // ---- Outstanding today ----
      const poOutstanding = (purchaseOrdersRes.data ?? [])
        .filter((po: any) => po.currency === 'ETB')
        .reduce((s: number, po: any) => s + Math.max(0, Number(po.total_amount ?? 0) - Number(po.paid_amount ?? 0)), 0)
      const shipExpOutstanding = (shipmentExpensesUnpaidRes.data ?? [])
        .filter((e: any) => e.currency === 'ETB')
        .reduce((s: number, e: any) => s + Number(e.amount_etb ?? 0), 0)
      setPayablesEtb(poOutstanding + shipExpOutstanding)
      // Purchase orders run mostly USD-priced — surfaced separately rather
      // than folded into one ETB total, to avoid re-converting and risking
      // the same currency-drift bug fixed elsewhere in this app.
      setPayablesUsd((purchaseOrdersRes.data ?? [])
        .filter((po: any) => po.currency === 'USD')
        .reduce((s: number, po: any) => s + Math.max(0, Number(po.total_amount ?? 0) - Number(po.paid_amount ?? 0)), 0))
      setReceivablesEtb((customersRes.data ?? []).reduce((s: number, c: any) => s + Number(c.outstanding_etb ?? 0), 0))

      setLoading(false)
    }
    load()
  }, [])

  const totalRev    = pl.reduce((s, m) => s + m.revenue, 0)
  const totalProfit = pl.reduce((s, m) => s + m.grossProfit, 0)
  const avgMargin   = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0
  const totalCashIn  = cash.reduce((s, m) => s + m.cashIn, 0)
  const totalCashOut = cash.reduce((s, m) => s + m.cashOut, 0)
  const maxCashFlow = Math.max(1, ...cash.map(m => Math.max(m.cashIn, m.cashOut)))

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="p-5 max-w-4xl mx-auto">

      <div className="mb-5">
        <h1 className="text-lg font-medium">Reports</h1>
        <p className="text-xs text-gray-400 mt-0.5">Last 6 months · every payment recorded across the app</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total revenue',   val: N(totalRev) + ' ETB',    color: 'text-blue-700' },
          { label: 'Gross profit',    val: N(totalProfit) + ' ETB', color: 'text-green-700' },
          { label: 'Cash in (6mo)',   val: N(totalCashIn) + ' ETB', color: 'text-green-700' },
          { label: 'Cash out (6mo)',  val: N(totalCashOut) + ' ETB', color: 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{k.label}</p>
            <p className={`text-xl font-medium ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Outstanding today */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link to="/payables" className="group bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between transition-all hover:border-red-300 hover:shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><Wallet size={16} className="text-red-600" /></div>
            <div>
              <p className="text-xs text-gray-400">Payables outstanding</p>
              <p className="text-lg font-medium text-red-700">
                {N(payablesEtb)} ETB{payablesUsd > 0 && ` · $${N(payablesUsd)}`}
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-red-400 shrink-0" />
        </Link>
        <Link to="/receivables" className="group bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between transition-all hover:border-blue-300 hover:shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><CreditCard size={16} className="text-blue-600" /></div>
            <div>
              <p className="text-xs text-gray-400">Receivables outstanding</p>
              <p className="text-lg font-medium text-blue-700">{N(receivablesEtb)} ETB</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-400 shrink-0" />
        </Link>
      </div>

      {/* Cash flow */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-gray-500">Cash flow by month</div>
        <Link to="/money-tracking" className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
          Every transaction <ChevronRight size={12} />
        </Link>
      </div>
      {cash.length === 0 ? (
        <div className="text-center py-10 mb-6 bg-gray-50 rounded-xl text-xs text-gray-400">
          No payments recorded in the last 6 months.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          {cash.map((m, i) => {
            const net = m.cashIn - m.cashOut
            return (
              <div key={m.month} className={`px-4 py-3 ${i < cash.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">
                    {new Date(m.month + '-01').toLocaleDateString('en-ET', { month: 'short', year: 'numeric' })}
                  </span>
                  <span className={`text-xs font-mono font-medium ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    net {net >= 0 ? '+' : ''}{N(net)} ETB
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs mb-1">
                  <ArrowDownLeft size={11} className="text-green-600 shrink-0" />
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${(m.cashIn / maxCashFlow) * 100}%` }} />
                  </div>
                  <span className="font-mono text-green-700 w-20 text-right shrink-0">{N(m.cashIn)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <ArrowUpRight size={11} className="text-red-500 shrink-0" />
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${(m.cashOut / maxCashFlow) * 100}%` }} />
                  </div>
                  <span className="font-mono text-red-600 w-20 text-right shrink-0">{N(m.cashOut)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* P&L */}
      <div className="text-xs font-medium text-gray-500 mb-2">Profit & loss by month</div>
      {pl.length === 0 ? (
        <div className="text-center py-16">
          <BarChart3 size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No sales data yet</p>
          <p className="text-xs text-gray-400">
            Reports populate automatically once sales orders are created and invoiced.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Month</div>
            <div className="text-right">Orders</div>
            <div className="text-right">Revenue</div>
            <div className="text-right">COGS</div>
            <div className="text-right">Gross profit</div>
            <div className="text-right">Margin</div>
          </div>

          {pl.map((m, i) => {
            const mc = m.grossMarginPct >= 30
              ? 'text-green-700' : m.grossMarginPct >= 20
                ? 'text-amber-700' : 'text-red-600'
            return (
              <div
                key={m.month}
                className={`grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                            items-center text-sm
                            ${i < pl.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="font-medium">
                  {new Date(m.month + '-01').toLocaleDateString('en-ET',
                    { month: 'short', year: 'numeric' })}
                </div>
                <div className="text-right text-gray-500">{m.orderCount}</div>
                <div className="text-right font-mono font-medium text-blue-700">
                  {N(m.revenue / 1000)}K
                </div>
                <div className="text-right font-mono text-gray-500">
                  {N(m.cogs / 1000)}K
                </div>
                <div className="text-right font-mono font-medium text-green-700">
                  {N(m.grossProfit / 1000)}K
                </div>
                <div className={`text-right font-medium ${mc}`}>
                  {Math.round(m.grossMarginPct)}%
                </div>
              </div>
            )
          })}

          {/* Totals */}
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                          bg-gray-50 border-t border-gray-100 font-medium text-sm">
            <div className="text-gray-500">Total</div>
            <div className="text-right text-gray-500">
              {pl.reduce((s, m) => s + m.orderCount, 0)}
            </div>
            <div className="text-right font-mono text-blue-700">
              {N(totalRev / 1000)}K ETB
            </div>
            <div className="text-right font-mono text-gray-500">
              {N(pl.reduce((s, m) => s + m.cogs, 0) / 1000)}K ETB
            </div>
            <div className="text-right font-mono text-green-700">
              {N(totalProfit / 1000)}K ETB
            </div>
            <div className={`text-right ${avgMargin >= 25 ? 'text-green-700' : 'text-red-600'}`}>
              {Math.round(avgMargin)}%
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
