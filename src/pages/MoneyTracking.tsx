import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { recordQuickIncome, fetchWarehousesList } from '../api/income'
import { recordCompanyExpense, fetchCompaniesList, fetchEmployeesList } from '../api/companyExpenses'
import { fetchCustomers } from '../api/customers'
import { fetchCreditAccounts } from '../api/credit'
import { fetchAccounts } from '../api/accounts'
import { updateTransaction, deleteTransaction } from '../api/transactions'
import { usePageState } from '../lib/pageState'
import { detectAnomalies } from '../lib/anomalyDetection'
import {
  Banknote, Loader2, ShieldAlert, ArrowDownLeft, ArrowUpRight,
  Search, Plus, X, Pencil, Trash2, Sparkles, Copy, TrendingUp, ChevronDown, ChevronRight,
} from 'lucide-react'
import { HawalaFields, emptyHawalaValue, computeHawalaAmount } from '../components/HawalaFields'

type Direction = 'in' | 'out'
interface Txn {
  id: string; direction: Direction; party: string; amount: number; currency: string
  method: string; date: string | null; sensitive: boolean; notes: string | null
  source: 'sale' | 'purchase' | 'credit_repayment' | 'expense' | 'shipment_expense' | 'supplier_payment'
  accountName: string | null
  detail?: string | null
}
interface CreditAccount { id: string; customer_id: string; customer_name: string; credit_limit: number; balance: number; due_date: string; status: string }
interface CreditTxnHistory { id: string; type: 'draw' | 'repayment'; amount: number; date: string | null; orderNumber: string | null; notes: string | null }
interface Option { id: string; name: string }

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank_transfer: 'Transfer', credit: 'Credit', mobile_money: 'Mobile money', hawala: 'Hawala' }
const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const CATEGORIES = ['rent', 'salary', 'fuel', 'supplies', 'utilities', 'maintenance', 'other']

function AddIncomeForm({ customers, warehouses, creditAccounts, accounts, onDone, onCancel }: {
  customers: Option[]; warehouses: Option[]; creditAccounts: CreditAccount[]; accounts: Option[]
  onDone: () => void; onCancel: () => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customerCreditAccounts = creditAccounts.filter(c => c.customer_id === customerId)

  async function submit() {
    const amt = Number(amount)
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    if (method === 'credit' && !creditAccountId) { setError('Choose which credit account this draws against.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    setSaving(true); setError(null)
    try {
      await recordQuickIncome({
        customerId, warehouseId, amount: amt, method: method as any,
        creditAccountId: method === 'credit' ? creditAccountId : undefined,
        accountId: method !== 'credit' ? accountId : undefined,
        sensitive, notes, date,
        hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record income.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5">
      <p className="text-xs font-medium text-green-700">Add income</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which customer?</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ETB)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      {method === 'credit' && (
        <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which credit account?</option>
          {customerCreditAccounts.map(c => (
            <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB · due {c.due_date}</option>
          ))}
          {customerCreditAccounts.length === 0 && <option value="" disabled>No credit account for this customer — open one first</option>}
        </select>
      )}
      {method !== 'credit' && (
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which account received it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {method === 'hawala' && <HawalaFields value={hawala} onChange={setHawala} />}
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Flag as sensitive
      </label>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Record income'}
        </button>
      </div>
    </div>
  )
}

function AddExpenseForm({ companies, employees, accounts, onDone, onCancel }: {
  companies: Option[]; employees: Option[]; accounts: Option[]; onDone: () => void; onCancel: () => void
}) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'ETB' | 'USD'>('ETB')
  const [method, setMethod] = useState('cash')
  const [companyId, setCompanyId] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isHawala = method === 'hawala'

  // Keep amount in sync with the hawala conversion — same fix as
  // Expenses.tsx, otherwise a stale manually-typed amount could disagree
  // with what the ETB/rate breakdown actually computes.
  useEffect(() => {
    if (!isHawala || currency === 'ETB') return
    const computed = computeHawalaAmount(hawala)
    if (computed != null) setAmount(String(computed))
  }, [isHawala, currency, hawala])

  async function submit() {
    const amt = Number(amount)
    if (!description.trim()) { setError('Add a short description.'); return }
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account paid it.'); return }
    setSaving(true); setError(null)
    try {
      await recordCompanyExpense({
        companyId: companyId || undefined, category, description, amount: amt, currency,
        method: method as "cash" | "bank_transfer" | "credit" | "mobile_money" | "hawala",
        paidBy: paidBy || undefined, expenseDate: date, sensitive, notes,
        accountId: method !== 'credit' ? accountId : undefined,
        hawalaRoute: isHawala ? hawala.route.trim() || undefined : undefined,
        hawalaEtbAmount: isHawala && hawala.etbAmount ? Number(hawala.etbAmount) : undefined,
        hawalaExchangeRate: isHawala && hawala.exchangeRate ? Number(hawala.exchangeRate) : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5">
      <p className="text-xs font-medium text-red-700">Add expense</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <div className="flex gap-2">
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white capitalize">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={currency} onChange={e => setCurrency(e.target.value as 'ETB' | 'USD')}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="ETB">ETB</option><option value="USD">USD</option>
        </select>
      </div>
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <select value={companyId} onChange={e => setCompanyId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which company?</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={paidBy} onChange={e => setPaidBy(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Who paid?</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {method !== 'credit' && (
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which account paid it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {isHawala && <HawalaFields value={hawala} onChange={setHawala} targetCurrency={currency} />}
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Flag as sensitive
      </label>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Record expense'}
        </button>
      </div>
    </div>
  )
}

function EditTxnForm({ txn, onDone, onCancel }: { txn: Txn; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(txn.amount))
  const [method, setMethod] = useState(txn.method)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [sensitive, setSensitive] = useState(txn.sensitive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    setSaving(true); setError(null)
    try {
      await updateTransaction(txn.id, { amount: amt, method, notes, sensitive })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this transaction? This can\'t be undone.')) return
    setSaving(true); setError(null)
    try {
      await deleteTransaction(txn.id)
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Sensitive
      </label>
      <div className="flex gap-2 justify-between">
        <button onClick={remove} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 flex items-center gap-1">
          <Trash2 size={12} /> Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MoneyTracking() {
  const [txns, setTxns] = useState<Txn[]>([])
  const [credit, setCredit] = useState<CreditAccount[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [companies, setCompanies] = useState<Option[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = usePageState<'all' | Direction>('moneyTracking.direction', 'all')
  const [query, setQuery] = usePageState('moneyTracking.query', '')
  const [dateFrom, setDateFrom] = usePageState('moneyTracking.dateFrom', '')
  const [dateTo, setDateTo] = usePageState('moneyTracking.dateTo', '')
  const [methodFilter, setMethodFilter] = usePageState('moneyTracking.methodFilter', '')
  const [activeForm, setActiveForm] = useState<'income' | 'expense' | null>(null)
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null)
  const [insightsOpen, setInsightsOpen] = usePageState('moneyTracking.insightsOpen', false)
  const [expandedCreditId, setExpandedCreditId] = useState<string | null>(null)
  const [creditHistory, setCreditHistory] = useState<Record<string, CreditTxnHistory[]>>({})
  const [creditHistoryLoading, setCreditHistoryLoading] = useState(false)

  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [salesRes, supplierPayRes, creditTxRes, expenseRes, shipExpRes, creditAcctRows, customerRows, warehouseRows, companyRows, employeeRows, accountRows] =
        await Promise.all([
          supabase.from('sales_payments').select('id, amount_etb, method, sensitive_flag, notes, created_at, account_id, sales_orders(order_number, customers(name))').order('created_at', { ascending: false }).limit(200),
          // Replaces purchase_order_payments — nothing in the app has ever
          // created a purchase_orders row, so that table was always empty.
          // supplier_payments is the real "money paid to a supplier" ledger,
          // including hawala (route/rate carried in hawala_route).
          supabase.from('supplier_payments').select('id, amount, method, sensitive_flag, notes, payment_date, account_id, hawala_route, supplier_payables(reference, currency, suppliers(name))').order('payment_date', { ascending: false }).limit(200),
          supabase.from('credit_transactions').select('id, type, amount, method, sensitive_flag, notes, transaction_date, account_id, credit_accounts(customer_id, customers(name))').eq('type', 'repayment').order('transaction_date', { ascending: false }).limit(200),
          supabase.from('company_expenses').select('id, description, amount, currency, method, sensitive_flag, notes, expense_date, vendor_name, account_id').order('expense_date', { ascending: false }).limit(200),
          // Shipment expenses paid via Payables -> "Mark as paid" — otherwise
          // invisible here even though real cash left the business.
          supabase.from('shipment_expenses').select('id, description, amount_etb, currency, payment_method, sensitive_flag, notes, expense_date, vendor_name, account_id, paid_at').eq('is_paid', true).order('paid_at', { ascending: false }).limit(200),
          fetchCreditAccounts(),
          fetchCustomers(),
          fetchWarehousesList(),
          fetchCompaniesList(),
          fetchEmployeesList(),
          fetchAccounts(),
        ])

      if (salesRes.error) throw salesRes.error
      if (supplierPayRes.error) throw supplierPayRes.error
      if (creditTxRes.error) throw creditTxRes.error
      if (expenseRes.error) throw expenseRes.error
      if (shipExpRes.error) throw shipExpRes.error

      const accountNameById = new Map(accountRows.map(a => [a.id, a.name]))

      const salesTxns: Txn[] = (salesRes.data ?? []).map((r: any) => {
        const order = one(r.sales_orders); const customer = order ? one(order.customers) : null
        return { id: `sale-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: Number(r.amount_etb ?? 0), currency: 'ETB', method: r.method ?? 'cash', date: r.created_at, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'sale', accountName: accountNameById.get(r.account_id) ?? null } as Txn
      })
      const supplierPayTxns: Txn[] = (supplierPayRes.data ?? []).map((r: any) => {
        const payable = one(r.supplier_payables); const supplier = payable ? one(payable.suppliers) : null
        return {
          id: `supplierpay-${r.id}`, direction: 'out', party: supplier?.name ?? 'Unknown supplier',
          amount: Number(r.amount ?? 0), currency: payable?.currency ?? 'USD', method: r.method ?? 'cash',
          date: r.payment_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'supplier_payment',
          accountName: accountNameById.get(r.account_id) ?? null,
          detail: r.hawala_route ?? payable?.reference ?? null,
        } as Txn
      })
      const creditTxns: Txn[] = (creditTxRes.data ?? []).map((r: any) => {
        const account = one(r.credit_accounts); const customer = account ? one(account.customers) : null
        return { id: `credit-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: Number(r.amount ?? 0), currency: 'ETB', method: r.method ?? 'cash', date: r.transaction_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'credit_repayment', accountName: accountNameById.get(r.account_id) ?? null } as Txn
      })
      const expenseTxns: Txn[] = (expenseRes.data ?? []).map((r: any) => ({
        id: `expense-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: Number(r.amount ?? 0), currency: r.currency ?? 'ETB', method: r.method ?? 'cash', date: r.expense_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'expense', accountName: accountNameById.get(r.account_id) ?? null,
      } as Txn))
      const shipExpTxns: Txn[] = (shipExpRes.data ?? []).map((r: any) => ({
        id: `shipexp-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: Number(r.amount_etb ?? 0), currency: 'ETB', method: r.payment_method ?? 'cash', date: r.paid_at ?? r.expense_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'shipment_expense', accountName: accountNameById.get(r.account_id) ?? null,
      } as Txn))

      setTxns([...salesTxns, ...supplierPayTxns, ...creditTxns, ...expenseTxns, ...shipExpTxns].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')))
      setCredit((creditAcctRows ?? []).map((r: any) => ({
        id: r.id, customer_id: one(r.customers)?.id ?? '', customer_name: one(r.customers)?.name ?? 'Unknown',
        credit_limit: Number(r.credit_limit ?? 0), balance: Number(r.balance ?? 0), due_date: r.due_date, status: r.status,
      })))
      setCustomers((customerRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setAccounts(accountRows.map(a => ({ id: a.id, name: a.name })))
      setCompanies((companyRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setEmployees((employeeRows ?? []).map((e: any) => ({ id: e.id, name: e.full_name })))
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Unable to load money tracking data.')
      setTxns([]); setCredit([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => txns
    .filter(t => direction === 'all' || t.direction === direction)
    .filter(t => !methodFilter || t.method === methodFilter)
    .filter(t => !dateFrom || (t.date ?? '').slice(0, 10) >= dateFrom)
    .filter(t => !dateTo || (t.date ?? '').slice(0, 10) <= dateTo)
    .filter(t => t.party.toLowerCase().includes(query.toLowerCase())),
    [txns, direction, query, methodFilter, dateFrom, dateTo])
  const hasListFilters = !!(query || methodFilter || dateFrom || dateTo || direction !== 'all')

  // Last 14 days, net cash per day — a quick "is the trend healthy" glance
  // without leaving the page.
  const dailyTrend = useMemo(() => {
    const days: { date: string; net: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const iso = d.toISOString().slice(0, 10)
      const dayTxns = txns.filter(t => t.currency === 'ETB' && (t.date ?? '').slice(0, 10) === iso)
      const net = dayTxns.reduce((s, t) => s + (t.direction === 'in' ? t.amount : -t.amount), 0)
      days.push({ date: iso, net })
    }
    return days
  }, [txns])

  async function toggleCreditHistory(accountId: string) {
    if (expandedCreditId === accountId) { setExpandedCreditId(null); return }
    setExpandedCreditId(accountId)
    if (creditHistory[accountId]) return
    setCreditHistoryLoading(true)
    try {
      const { data } = await supabase
        .from('credit_transactions')
        .select('id, type, amount, transaction_date, notes, sales_orders(order_number)')
        .eq('credit_account_id', accountId)
        .order('transaction_date', { ascending: false })
      const rows: CreditTxnHistory[] = (data ?? []).map((r: any) => ({
        id: r.id, type: r.type, amount: Number(r.amount ?? 0), date: r.transaction_date,
        orderNumber: one(r.sales_orders)?.order_number ?? null, notes: r.notes,
      }))
      setCreditHistory(prev => ({ ...prev, [accountId]: rows }))
    } catch {
      setCreditHistory(prev => ({ ...prev, [accountId]: [] }))
    } finally {
      setCreditHistoryLoading(false)
    }
  }

  const totals = useMemo(() => {
    const inEtb = txns.filter(t => t.direction === 'in' && t.currency === 'ETB').reduce((s, t) => s + t.amount, 0)
    const outEtb = txns.filter(t => t.direction === 'out' && t.currency === 'ETB').reduce((s, t) => s + t.amount, 0)
    const outUsd = txns.filter(t => t.direction === 'out' && t.currency === 'USD').reduce((s, t) => s + t.amount, 0)
    // CNY payments (rare, but a real supplier-payment currency) were silently
    // dropped from every KPI tile before — they still appeared in the list
    // below, just uncounted anywhere in the summary.
    const outCny = txns.filter(t => t.direction === 'out' && t.currency === 'CNY').reduce((s, t) => s + t.amount, 0)
    const sensitiveCount = txns.filter(t => t.sensitive).length
    const outstandingCredit = credit.reduce((s, c) => s + c.balance, 0)
    return { inEtb, outEtb, outUsd, outCny, sensitiveCount, outstandingCredit }
  }, [txns, credit])

  // Statistical anomaly checks (amount outliers + possible duplicates) — no
  // external API, just runs against the transactions already loaded above.
  const anomalies = useMemo(() => detectAnomalies(txns), [txns])
  const anomaliesByTxnId = useMemo(() => {
    const map = new Map<string, typeof anomalies>()
    for (const a of anomalies) {
      if (!map.has(a.txnId)) map.set(a.txnId, [])
      map.get(a.txnId)!.push(a)
    }
    return map
  }, [anomalies])
  const highSeverityCount = anomalies.filter(a => a.severity === 'high').length

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><Banknote size={18} /> Money tracking</h1>
          <p className="text-xs text-gray-400 mt-0.5">Every payment in and out — who, how much, how, and why</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setActiveForm(activeForm === 'income' ? null : 'income')}
            className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white flex items-center gap-1">
            {activeForm === 'income' ? <X size={12} /> : <Plus size={12} />} Add income
          </button>
          <button onClick={() => setActiveForm(activeForm === 'expense' ? null : 'expense')}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white flex items-center gap-1">
            {activeForm === 'expense' ? <X size={12} /> : <Plus size={12} />} Add expense
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {activeForm === 'income' && (
        <AddIncomeForm customers={customers} warehouses={warehouses} creditAccounts={credit} accounts={accounts}
          onCancel={() => setActiveForm(null)} onDone={() => { setActiveForm(null); load() }} />
      )}
      {activeForm === 'expense' && (
        <AddExpenseForm companies={companies} employees={employees} accounts={accounts}
          onCancel={() => setActiveForm(null)} onDone={() => { setActiveForm(null); load() }} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Received (ETB)</p>
              <p className="text-xl font-medium font-mono text-green-700">{N(totals.inEtb)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Paid out</p>
              <p className="text-xl font-medium font-mono text-red-700">
                {N(totals.outEtb)} ETB{totals.outUsd > 0 && ` · $${N(totals.outUsd)}`}{totals.outCny > 0 && ` · ¥${N(totals.outCny)}`}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Credit outstanding</p>
              <p className="text-xl font-medium font-mono text-amber-700">{N(totals.outstandingCredit)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Sensitive flagged</p>
              <p className="text-xl font-medium font-mono text-amber-700">{totals.sensitiveCount}</p>
            </div>
          </div>

          {anomalies.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden mb-5">
              <button onClick={() => setInsightsOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="flex items-center gap-2 text-sm font-medium text-amber-800">
                  <Sparkles size={14} className="text-amber-500" />
                  {anomalies.length} unusual transaction{anomalies.length > 1 ? 's' : ''} flagged
                  {highSeverityCount > 0 && <span className="text-xs font-normal text-red-600">· {highSeverityCount} high</span>}
                </span>
                {insightsOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              </button>
              {insightsOpen && (
                <div className="border-t border-amber-100 divide-y divide-amber-50">
                  {anomalies.slice(0, 20).map((a, i) => {
                    const t = txns.find(x => x.id === a.txnId)
                    return (
                      <div key={`${a.txnId}-${a.type}-${i}`} className="flex items-start gap-2.5 px-4 py-2.5 text-xs bg-amber-50/40">
                        {a.type === 'possible_duplicate'
                          ? <Copy size={13} className={`shrink-0 mt-0.5 ${a.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />
                          : <TrendingUp size={13} className={`shrink-0 mt-0.5 ${a.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />}
                        <div className="min-w-0">
                          <p className="text-gray-700">{a.reason}</p>
                          {t && <p className="text-gray-400 mt-0.5">{t.party} · {t.date ?? '—'}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
            <p className="text-xs font-medium text-gray-500 mb-3">Net cash, last 14 days</p>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {(() => {
                const maxAbs = Math.max(...dailyTrend.map(d => Math.abs(d.net)), 1)
                return dailyTrend.map(d => {
                  const h = Math.max(3, (Math.abs(d.net) / maxAbs) * 56)
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.net >= 0 ? '+' : ''}${N(d.net)} ETB`}>
                      <div className={`w-full rounded-sm ${d.net >= 0 ? 'bg-green-500' : 'bg-red-400'}`} style={{ height: h }} />
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-xs font-medium text-gray-500">Transactions</div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All methods</option>
                {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <span>–</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              </div>
              {hasListFilters && (
                <button onClick={() => { setQuery(''); setMethodFilter(''); setDateFrom(''); setDateTo(''); setDirection('all') }}
                  className="text-xs text-blue-600 hover:underline">Clear filters</button>
              )}
              <div className="flex gap-1">
                {(['all', 'in', 'out'] as const).map(d => (
                  <button key={d} onClick={() => setDirection(d)}
                    className={`px-2.5 py-1 text-xs rounded-lg border capitalize ${direction === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {d === 'all' ? 'All' : d === 'in' ? 'In' : 'Out'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name"
                  className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-32" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-xs text-gray-400 text-center">No transactions found. Use "Add income" or "Add expense" above to record one.</p>
            ) : filtered.slice(0, 50).map((t, i, arr) => (
              <div key={t.id} className={i < arr.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  {t.direction === 'in' ? <ArrowDownLeft size={14} className="text-green-600 shrink-0" /> : <ArrowUpRight size={14} className="text-red-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-1.5">
                      {t.party}
                      {t.sensitive && <ShieldAlert size={11} className="text-amber-500 shrink-0" aria-label="Sensitive" />}
                      {anomaliesByTxnId.has(t.id) && (
                        <Sparkles size={11} className={`shrink-0 ${anomaliesByTxnId.get(t.id)!.some(a => a.severity === 'high') ? 'text-red-500' : 'text-amber-500'}`}
                          aria-label="Flagged as unusual" />
                      )}
                    </p>
                    <p className="text-gray-400">
                      {METHOD_LABEL[t.method] ?? t.method}{t.detail && ` · ${t.detail}`}{t.accountName && ` · ${t.accountName}`} · {t.date ?? '—'}{t.notes && ` · ${t.notes}`}
                    </p>
                  </div>
                  <div className={`font-mono font-medium shrink-0 ${t.direction === 'in' ? 'text-green-700' : 'text-red-600'}`}>
                    {t.direction === 'in' ? '+' : '−'}{N(t.amount)} {t.currency}
                  </div>
                  {/* shipment_expense and supplier_payment are managed on
                      their own pages (Payables / Supplier Payments) — editing
                      amount here wouldn't touch their hawala breakdown or
                      the payable's balance sync correctly, so they're
                      read-only in this feed. */}
                  {t.source !== 'shipment_expense' && t.source !== 'supplier_payment' && (
                    <button onClick={() => setEditingTxnId(editingTxnId === t.id ? null : t.id)}
                      className="p-1 text-gray-300 hover:text-blue-600 shrink-0">
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
                {editingTxnId === t.id && (
                  <EditTxnForm txn={t} onCancel={() => setEditingTxnId(null)} onDone={() => { setEditingTxnId(null); load() }} />
                )}
              </div>
            ))}
          </div>

          <div className="text-xs font-medium text-gray-500 mb-2">Credit — what's owed, and by whom</div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {credit.length === 0 ? (
              <p className="px-4 py-8 text-xs text-gray-400 text-center">No open credit accounts.</p>
            ) : credit.map((c, i, arr) => (
              <div key={c.id} className={i < arr.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer hover:bg-gray-50/70" onClick={() => toggleCreditHistory(c.id)}>
                  {expandedCreditId === c.id ? <ChevronDown size={12} className="text-gray-300 shrink-0" /> : <ChevronRight size={12} className="text-gray-300 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.customer_name}</p>
                    <p className="text-gray-400">Due {c.due_date} · limit {N(c.credit_limit)} ETB</p>
                  </div>
                  {(() => {
                    const overpaid = c.status === 'settled' && c.balance < 0
                    const label = overpaid ? 'overpaid' : c.status
                    const cls = overpaid ? 'bg-violet-50 text-violet-700' : c.status === 'overdue' ? 'bg-red-50 text-red-700' : c.status === 'settled' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
                  })()}
                  <div className={`font-mono font-medium w-24 text-right ${c.balance < 0 ? 'text-violet-700' : ''}`}>
                    {c.balance < 0 ? `+${N(-c.balance)}` : N(c.balance)} ETB
                  </div>
                </div>
                {expandedCreditId === c.id && (
                  <div className="px-4 pb-3 bg-gray-50/50 border-t border-gray-100">
                    {creditHistoryLoading && !creditHistory[c.id] ? (
                      <div className="flex items-center gap-1.5 text-xs text-gray-400 py-3"><Loader2 size={12} className="animate-spin" /> Loading history…</div>
                    ) : (creditHistory[c.id] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400 py-3">No transactions on this account yet.</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {(creditHistory[c.id] ?? []).map(h => (
                          <div key={h.id} className="flex items-center gap-3 py-2 text-xs">
                            {h.type === 'draw' ? <ArrowUpRight size={12} className="text-amber-500 shrink-0" /> : <ArrowDownLeft size={12} className="text-green-600 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-600 capitalize">{h.type}{h.orderNumber && ` · ${h.orderNumber}`}</p>
                              <p className="text-gray-400">{h.date ?? '—'}{h.notes && ` · ${h.notes}`}</p>
                            </div>
                            <span className={`font-mono font-medium ${h.type === 'draw' ? 'text-amber-700' : 'text-green-700'}`}>
                              {h.type === 'draw' ? '+' : '−'}{N(h.amount)} ETB
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}