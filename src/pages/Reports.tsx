import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  BarChart3, Loader2, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, ChevronRight,
  Users, Package, Building2, Receipt, Landmark,
} from 'lucide-react'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank_transfer: 'Transfer', credit: 'Credit', mobile_money: 'Mobile money', hawala: 'Hawala' }
const CATEGORY_LABEL: Record<string, string> = { rent: 'Rent', salary: 'Salary', fuel: 'Fuel', supplies: 'Supplies', utilities: 'Utilities', maintenance: 'Maintenance', other: 'Other' }

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

interface NamedAmount { name: string; amount: number }
interface TopProduct { name: string; quantity: number; revenue: number; marginPct: number }
interface AgingBucket { label: string; amount: number; count: number }

export function Reports() {
  const [pl, setPL]         = useState<PLRow[]>([])
  const [cash, setCash]     = useState<CashRow[]>([])
  const [payablesEtb, setPayablesEtb] = useState(0)
  const [payablesUsd, setPayablesUsd] = useState(0)
  const [payablesCny, setPayablesCny] = useState(0)
  const [receivablesEtb, setReceivablesEtb] = useState(0)
  const [creditOutstanding, setCreditOutstanding] = useState(0)
  const [creditOverdueCount, setCreditOverdueCount] = useState(0)
  const [expensesByCategory, setExpensesByCategory] = useState<NamedAmount[]>([])
  const [topCustomers, setTopCustomers] = useState<NamedAmount[]>([])
  const [topSuppliers, setTopSuppliers] = useState<NamedAmount[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [aging, setAging] = useState<AgingBucket[]>([])
  const [methodIn, setMethodIn] = useState<NamedAmount[]>([])
  const [methodOut, setMethodOut] = useState<NamedAmount[]>([])
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
        supplierPaymentsRes, expensesRes, shipmentExpensesPaidRes,
        supplierPayablesRes, shipmentExpensesUnpaidRes, customersRes,
        creditAccountsRes, unpaidOrdersRes,
      ] = await Promise.all([
        // Matches the Dashboard's revenue filter exactly (INVOICED/PAID
        // only) — Reports' P&L, top customers, and top products all derive
        // from this same query, and diverging the status set here would
        // silently disagree with the Dashboard's revenue figure.
        supabase.from('sales_orders').select('id, sale_date, total_etb, total_cogs_etb, gross_profit_etb, customer_id, customers(name)').gte('sale_date', sixAgoIso).in('status', ['INVOICED', 'PAID']).order('sale_date'),
        supabase.from('sales_payments').select('amount_etb, payment_date, method').gte('payment_date', sixAgoIso),
        supabase.from('credit_transactions').select('amount, transaction_date, method').eq('type', 'repayment').gte('transaction_date', sixAgoIso),
        // Replaces purchase_order_payments — that table has never had a row
        // (nothing in the app creates a purchase_orders record); supplier_payments
        // is the real "money paid to a supplier" ledger, including hawala.
        supabase.from('supplier_payments').select('amount, payment_date, method, etb_amount, supplier_payables(currency, suppliers(name))').gte('payment_date', sixAgoIso),
        supabase.from('company_expenses').select('amount, currency, expense_date, category, method').gte('expense_date', sixAgoIso),
        supabase.from('shipment_expenses').select('amount_etb, currency, paid_at').eq('is_paid', true).gte('paid_at', sixAgoIso),
        supabase.from('supplier_payables').select('total_amount, paid_amount, currency'),
        supabase.from('shipment_expenses').select('amount_etb, currency').eq('is_paid', false),
        supabase.from('customers').select('outstanding_etb'),
        supabase.from('credit_accounts').select('balance, status'),
        // Aging is about what's unpaid right now, not scoped to the 6-month
        // report window — an invoice from 8 months ago that's still open is
        // exactly the kind of thing aging exists to surface.
        supabase.from('sales_orders').select('sale_date, total_etb, paid_amount').in('status', ['INVOICED', 'PARTIAL']),
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
      const cashMap = new Map<string, CashRow>()
      const bump = (dateStr: string | null, field: 'cashIn' | 'cashOut', amount: number) => {
        if (!dateStr) return
        const month = dateStr.slice(0, 7)
        if (!cashMap.has(month)) cashMap.set(month, { month, cashIn: 0, cashOut: 0 })
        cashMap.get(month)![field] += amount
      }
      for (const r of salesPaymentsRes.data ?? []) bump(r.payment_date, 'cashIn', Number(r.amount_etb ?? 0))
      for (const r of creditRepaymentsRes.data ?? []) bump(r.transaction_date, 'cashIn', Number(r.amount ?? 0))
      for (const r of (supplierPaymentsRes.data ?? []) as any[]) {
        const payable = Array.isArray(r.supplier_payables) ? r.supplier_payables[0] : r.supplier_payables
        if (r.method === 'hawala' && r.etb_amount != null) bump(r.payment_date, 'cashOut', Number(r.etb_amount))
        else if (payable?.currency === 'ETB') bump(r.payment_date, 'cashOut', Number(r.amount ?? 0))
      }
      for (const r of (expensesRes.data ?? []).filter((e: any) => e.currency === 'ETB')) bump(r.expense_date, 'cashOut', Number(r.amount ?? 0))
      for (const r of (shipmentExpensesPaidRes.data ?? []).filter((e: any) => e.currency === 'ETB')) bump(r.paid_at ? String(r.paid_at).slice(0, 10) : null, 'cashOut', Number(r.amount_etb ?? 0))
      setCash([...cashMap.values()].sort((a, b) => a.month.localeCompare(b.month)))

      // ---- Money in/out by method (6mo) ----
      const inByMethod = new Map<string, number>()
      const outByMethod = new Map<string, number>()
      const bumpMethod = (map: Map<string, number>, method: string | null, amount: number) => {
        const key = method ?? 'cash'
        map.set(key, (map.get(key) ?? 0) + amount)
      }
      for (const r of salesPaymentsRes.data ?? []) bumpMethod(inByMethod, r.method, Number(r.amount_etb ?? 0))
      for (const r of creditRepaymentsRes.data ?? []) bumpMethod(inByMethod, r.method, Number(r.amount ?? 0))
      for (const r of (supplierPaymentsRes.data ?? []) as any[]) {
        const payable = Array.isArray(r.supplier_payables) ? r.supplier_payables[0] : r.supplier_payables
        const etb = r.method === 'hawala' && r.etb_amount != null ? Number(r.etb_amount) : (payable?.currency === 'ETB' ? Number(r.amount ?? 0) : 0)
        if (etb > 0) bumpMethod(outByMethod, r.method, etb)
      }
      for (const r of (expensesRes.data ?? []).filter((e: any) => e.currency === 'ETB')) bumpMethod(outByMethod, r.method, Number(r.amount ?? 0))
      setMethodIn([...inByMethod.entries()].map(([name, amount]) => ({ name: METHOD_LABEL[name] ?? name, amount })).sort((a, b) => b.amount - a.amount))
      setMethodOut([...outByMethod.entries()].map(([name, amount]) => ({ name: METHOD_LABEL[name] ?? name, amount })).sort((a, b) => b.amount - a.amount))

      // ---- Expenses by category (6mo, ETB-only for a single comparable total) ----
      const catMap = new Map<string, number>()
      for (const r of (expensesRes.data ?? []).filter((e: any) => e.currency === 'ETB')) {
        const key = r.category ?? 'other'
        catMap.set(key, (catMap.get(key) ?? 0) + Number(r.amount ?? 0))
      }
      setExpensesByCategory([...catMap.entries()].map(([name, amount]) => ({ name: CATEGORY_LABEL[name] ?? name, amount })).sort((a, b) => b.amount - a.amount))

      // ---- Top customers by revenue (6mo) ----
      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      const custMap = new Map<string, number>()
      for (const r of (salesRes.data ?? []) as any[]) {
        const name = one(r.customers)?.name ?? 'Unknown customer'
        custMap.set(name, (custMap.get(name) ?? 0) + Number(r.total_etb ?? 0))
      }
      setTopCustomers([...custMap.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8))

      // ---- Top suppliers paid (6mo, ETB-equivalent) ----
      const supMap = new Map<string, number>()
      for (const r of (supplierPaymentsRes.data ?? []) as any[]) {
        const payable = one(r.supplier_payables); const supplier = payable ? one((payable as any).suppliers) : null
        const name = supplier?.name ?? 'Unknown supplier'
        const etb = r.method === 'hawala' && r.etb_amount != null ? Number(r.etb_amount) : ((payable as any)?.currency === 'ETB' ? Number(r.amount ?? 0) : 0)
        if (etb > 0) supMap.set(name, (supMap.get(name) ?? 0) + etb)
      }
      setTopSuppliers([...supMap.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8))

      // ---- Top products by revenue + margin (6mo) ----
      const orderIds = (salesRes.data ?? []).map((o: any) => o.id)
      if (orderIds.length > 0) {
        const { data: lines } = await supabase
          .from('sales_order_lines')
          .select('product_id, quantity, unit_price_etb, unit_cost_etb_snapshot, products(name)')
          .in('sales_order_id', orderIds)
        const prodMap = new Map<string, { name: string; qty: number; revenue: number; cost: number }>()
        for (const l of (lines ?? []) as any[]) {
          const name = one(l.products)?.name ?? 'Unknown product'
          const qty = Number(l.quantity ?? 0)
          const revenue = qty * Number(l.unit_price_etb ?? 0)
          const cost = qty * Number(l.unit_cost_etb_snapshot ?? 0)
          const entry = prodMap.get(l.product_id) ?? { name, qty: 0, revenue: 0, cost: 0 }
          entry.qty += qty; entry.revenue += revenue; entry.cost += cost
          prodMap.set(l.product_id, entry)
        }
        setTopProducts([...prodMap.values()]
          .map(p => ({ name: p.name, quantity: p.qty, revenue: p.revenue, marginPct: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0 }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8))
      } else {
        setTopProducts([])
      }

      // ---- Receivables aging (all currently unpaid, regardless of when) ----
      const today = new Date()
      const buckets: AgingBucket[] = [
        { label: '0–30 days', amount: 0, count: 0 },
        { label: '31–60 days', amount: 0, count: 0 },
        { label: '61–90 days', amount: 0, count: 0 },
        { label: '90+ days', amount: 0, count: 0 },
      ]
      for (const r of (unpaidOrdersRes.data ?? []) as any[]) {
        const outstanding = Number(r.total_etb ?? 0) - Number(r.paid_amount ?? 0)
        if (outstanding <= 0) continue
        const days = r.sale_date ? Math.floor((today.getTime() - new Date(r.sale_date).getTime()) / 86400000) : 0
        const idx = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3
        buckets[idx].amount += outstanding
        buckets[idx].count += 1
      }
      setAging(buckets)

      // ---- Outstanding today ----
      const payableOutstanding = (supplierPayablesRes.data ?? [])
        .filter((p: any) => p.currency === 'ETB')
        .reduce((s: number, p: any) => s + Math.max(0, Number(p.total_amount ?? 0) - Number(p.paid_amount ?? 0)), 0)
      const shipExpOutstanding = (shipmentExpensesUnpaidRes.data ?? [])
        .filter((e: any) => e.currency === 'ETB')
        .reduce((s: number, e: any) => s + Number(e.amount_etb ?? 0), 0)
      setPayablesEtb(payableOutstanding + shipExpOutstanding)
      // Supplier payables run mostly USD/CNY-priced — surfaced separately
      // rather than folded into one ETB total, to avoid re-converting and
      // risking the same currency-drift bug fixed elsewhere in this app.
      setPayablesUsd((supplierPayablesRes.data ?? [])
        .filter((p: any) => p.currency === 'USD')
        .reduce((s: number, p: any) => s + Math.max(0, Number(p.total_amount ?? 0) - Number(p.paid_amount ?? 0)), 0))
      setPayablesCny((supplierPayablesRes.data ?? [])
        .filter((p: any) => p.currency === 'CNY')
        .reduce((s: number, p: any) => s + Math.max(0, Number(p.total_amount ?? 0) - Number(p.paid_amount ?? 0)), 0))
      setReceivablesEtb((customersRes.data ?? []).reduce((s: number, c: any) => s + Number(c.outstanding_etb ?? 0), 0))
      setCreditOutstanding((creditAccountsRes.data ?? []).reduce((s: number, c: any) => s + Number(c.balance ?? 0), 0))
      setCreditOverdueCount((creditAccountsRes.data ?? []).filter((c: any) => c.status === 'overdue').length)

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
  const totalAging = aging.reduce((s, b) => s + b.amount, 0)
  const maxNamedAmount = (rows: NamedAmount[]) => Math.max(1, ...rows.map(r => r.amount))

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Link to="/supplier-payments" className="group bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between transition-all hover:border-red-300 hover:shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><Wallet size={16} className="text-red-600" /></div>
            <div>
              <p className="text-xs text-gray-400">Payables outstanding</p>
              <p className="text-lg font-medium text-red-700">
                {N(payablesEtb)} ETB
                {payablesUsd > 0 && ` · $${N(payablesUsd)}`}
                {payablesCny > 0 && ` · ¥${N(payablesCny)}`}
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
        <Link to="/credit-accounts" className="group bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between transition-all hover:border-violet-300 hover:shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0"><Landmark size={16} className="text-violet-600" /></div>
            <div>
              <p className="text-xs text-gray-400">Credit outstanding</p>
              <p className="text-lg font-medium text-violet-700">
                {N(creditOutstanding)} ETB{creditOverdueCount > 0 && <span className="text-red-600"> · {creditOverdueCount} overdue</span>}
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-violet-400 shrink-0" />
        </Link>
      </div>

      {/* Receivables aging */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-gray-500">Receivables aging — what's unpaid right now</div>
        <Link to="/receivables" className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
          All receivables <ChevronRight size={12} />
        </Link>
      </div>
      {totalAging === 0 ? (
        <div className="text-center py-8 mb-6 bg-gray-50 rounded-xl text-xs text-gray-400">Nothing unpaid right now.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {aging.map((b, i) => (
            <div key={b.label} className={`rounded-xl p-3 ${i === 3 && b.amount > 0 ? 'bg-red-50' : i === 2 && b.amount > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-400">{b.label}</p>
              <p className={`text-base font-medium font-mono ${i === 3 && b.amount > 0 ? 'text-red-700' : i === 2 && b.amount > 0 ? 'text-amber-700' : 'text-gray-700'}`}>{N(b.amount)} ETB</p>
              <p className="text-[10px] text-gray-400">{b.count} invoice{b.count === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
      )}

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

      {/* Money in/out by method */}
      <div className="text-xs font-medium text-gray-500 mb-2">How money moved (6mo, ETB)</div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-medium text-green-700 mb-2">In</p>
          {methodIn.length === 0 ? <p className="text-xs text-gray-300">Nothing yet</p> : (
            <div className="space-y-1.5">
              {methodIn.map(m => (
                <div key={m.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-gray-500 shrink-0 truncate">{m.name}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${(m.amount / maxNamedAmount(methodIn)) * 100}%` }} />
                  </div>
                  <span className="font-mono text-green-700 w-16 text-right shrink-0">{N(m.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600 mb-2">Out</p>
          {methodOut.length === 0 ? <p className="text-xs text-gray-300">Nothing yet</p> : (
            <div className="space-y-1.5">
              {methodOut.map(m => (
                <div key={m.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-gray-500 shrink-0 truncate">{m.name}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${(m.amount / maxNamedAmount(methodOut)) * 100}%` }} />
                  </div>
                  <span className="font-mono text-red-600 w-16 text-right shrink-0">{N(m.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expenses by category */}
      <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><Receipt size={12} /> Expenses by category (6mo, ETB)</div>
      {expensesByCategory.length === 0 ? (
        <div className="text-center py-8 mb-6 bg-gray-50 rounded-xl text-xs text-gray-400">No expenses recorded in the last 6 months.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-1.5">
          {expensesByCategory.map(c => (
            <div key={c.name} className="flex items-center gap-2 text-xs">
              <span className="w-24 text-gray-500 shrink-0 truncate">{c.name}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(c.amount / maxNamedAmount(expensesByCategory)) * 100}%` }} />
              </div>
              <span className="font-mono text-gray-700 w-20 text-right shrink-0">{N(c.amount)} ETB</span>
            </div>
          ))}
        </div>
      )}

      {/* Top customers / suppliers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><Users size={12} /> Top customers (6mo revenue)</div>
          {topCustomers.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-xl text-xs text-gray-400">No sales yet.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {topCustomers.map((c, i) => (
                <div key={c.name} className={`flex items-center justify-between px-3 py-2 text-xs ${i < topCustomers.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-gray-700 truncate">{c.name}</span>
                  <span className="font-mono font-medium text-blue-700 shrink-0">{N(c.amount)} ETB</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><Building2 size={12} /> Top suppliers paid (6mo)</div>
          {topSuppliers.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-xl text-xs text-gray-400">No supplier payments yet.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {topSuppliers.map((s, i) => (
                <div key={s.name} className={`flex items-center justify-between px-3 py-2 text-xs ${i < topSuppliers.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-gray-700 truncate">{s.name}</span>
                  <span className="font-mono font-medium text-red-600 shrink-0">{N(s.amount)} ETB</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top products */}
      <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><Package size={12} /> Top products (6mo revenue &amp; margin)</div>
      {topProducts.length === 0 ? (
        <div className="text-center py-8 mb-6 bg-gray-50 rounded-xl text-xs text-gray-400">No sales yet.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Product</div>
            <div className="text-right">Units</div>
            <div className="text-right">Revenue</div>
            <div className="text-right">Margin</div>
          </div>
          {topProducts.map((p, i) => (
            <div key={p.name} className={`grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 text-xs items-center ${i < topProducts.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="text-gray-700 truncate">{p.name}</div>
              <div className="text-right font-mono text-gray-500">{N(p.quantity)}</div>
              <div className="text-right font-mono font-medium text-blue-700">{N(p.revenue)} ETB</div>
              <div className={`text-right font-medium ${p.marginPct >= 30 ? 'text-green-700' : p.marginPct >= 20 ? 'text-amber-700' : 'text-red-600'}`}>
                {Math.round(p.marginPct)}%
              </div>
            </div>
          ))}
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
