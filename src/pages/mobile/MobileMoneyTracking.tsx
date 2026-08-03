import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { recordQuickIncome, fetchWarehousesList } from '../../api/income'
import { recordCompanyExpense } from '../../api/companyExpenses'
import { fetchCustomers } from '../../api/customers'
import { fetchCreditAccounts } from '../../api/credit'
import { fetchAccounts } from '../../api/accounts'
import type { Account } from '../../api/accounts'
import {
  Banknote, Loader2, ArrowDownLeft, ArrowUpRight, Plus, ChevronLeft, Check, Search, Landmark, WalletCards,
} from 'lucide-react'
import { HawalaFields, emptyHawalaValue } from '../../components/HawalaFields'

type Direction = 'in' | 'out'
interface Txn { id: string; direction: Direction; party: string; amount: number; currency: string; date: string | null; source: string }
interface Option { id: string; name: string }
interface CreditAccount { id: string; customer_id: string; balance: number; credit_limit: number; due_date: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
type IncomeMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'credit' | 'hawala'
type ExpenseMethod = Exclude<IncomeMethod, 'credit'>
interface SalesPaymentRow { id: string; amount_etb: number | null; created_at: string; sales_orders: { customers: { name: string } | { name: string }[] | null } | { customers: { name: string } | { name: string }[] | null }[] | null }
interface ExpenseRow { id: string; amount: number | null; currency: string | null; expense_date: string; vendor_name: string | null; description: string }
interface CreditRow { id: string; balance: number | null; credit_limit: number | null; due_date: string; customers: { id: string } | { id: string }[] | null }
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const METHODS: Array<{ value: IncomeMethod; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Transfer' },
  { value: 'mobile_money', label: 'Mobile money' }, { value: 'credit', label: 'Credit' },
  { value: 'hawala', label: 'Hawala' },
]
const EXPENSE_METHODS: Array<{ value: ExpenseMethod; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Transfer' },
  { value: 'mobile_money', label: 'Mobile money' }, { value: 'hawala', label: 'Hawala' },
]

export function MobileMoneyTracking() {
  const [searchParams] = useSearchParams()
  const [txns, setTxns] = useState<Txn[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [credit, setCredit] = useState<CreditAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<'income' | 'expense' | null>(() => searchParams.get('action') === 'income' ? 'income' : searchParams.get('action') === 'expense' ? 'expense' : null)
  const [direction, setDirection] = useState<'all' | Direction>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // income form
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [incomeAmount, setIncomeAmount] = useState('')
  const [incomeMethod, setIncomeMethod] = useState<IncomeMethod>('cash')
  const [incomeAccountId, setIncomeAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [incomeHawala, setIncomeHawala] = useState(emptyHawalaValue())

  // expense form
  const [expenseDesc, setExpenseDesc] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseAccountId, setExpenseAccountId] = useState('')
  const [expenseMethod, setExpenseMethod] = useState<ExpenseMethod>('cash')
  const [expenseHawala, setExpenseHawala] = useState(emptyHawalaValue())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [salesRes, expenseRes, customerRows, warehouseRows, creditRows, accountRows] = await Promise.all([
        supabase.from('sales_payments').select('id, amount_etb, created_at, sales_orders(customers(name))').order('created_at', { ascending: false }).limit(30),
        supabase.from('company_expenses').select('id, amount, currency, expense_date, vendor_name, description').order('expense_date', { ascending: false }).limit(30),
        fetchCustomers(), fetchWarehousesList(), fetchCreditAccounts(), fetchAccounts(),
      ])
      const salesTxns: Txn[] = ((salesRes.data ?? []) as SalesPaymentRow[]).map(r => {
        const order = one(r.sales_orders); const customer = order ? one(order.customers) : null
        return { id: `sale-${r.id}`, direction: 'in', party: customer?.name ?? 'Customer', amount: Number(r.amount_etb ?? 0), currency: 'ETB', date: r.created_at, source: 'Sale' }
      })
      const expenseTxns: Txn[] = ((expenseRes.data ?? []) as ExpenseRow[]).map(r => ({
        id: `exp-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: Number(r.amount ?? 0), currency: r.currency ?? 'ETB', date: r.expense_date, source: 'Expense',
      }))
      setTxns([...salesTxns, ...expenseTxns].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')))
      setCustomers(((customerRows ?? []) as Option[]).map(c => ({ id: c.id, name: c.name })))
      setWarehouses(((warehouseRows ?? []) as Option[]).map(w => ({ id: w.id, name: w.name })))
      setCredit(((creditRows ?? []) as CreditRow[]).map(c => ({ id: c.id, customer_id: one(c.customers)?.id ?? '', balance: Number(c.balance ?? 0), credit_limit: Number(c.credit_limit ?? 0), due_date: c.due_date })))
      setAccounts(accountRows ?? [])
    } catch (error: unknown) {
      setError(errorMessage(error, 'Failed to load.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  function resetForms() {
    setCustomerId(''); setWarehouseId(warehouses[0]?.id ?? ''); setIncomeAmount(''); setIncomeMethod('cash')
    setIncomeAccountId(''); setCreditAccountId(''); setExpenseDesc(''); setExpenseAmount(''); setExpenseAccountId('')
    setIncomeHawala(emptyHawalaValue()); setExpenseMethod('cash'); setExpenseHawala(emptyHawalaValue())
  }

  const customerCredit = credit.filter(c => c.customer_id === customerId)

  async function submitIncome() {
    const amt = Number(incomeAmount)
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!amt || amt <= 0) { setError('Enter an amount.'); return }
    if (incomeMethod === 'credit' && !creditAccountId) { setError('Choose a credit account.'); return }
    if (incomeMethod !== 'credit' && !incomeAccountId) { setError('Choose which account received it.'); return }
    setSaving(true); setError(null)
    try {
      await recordQuickIncome({
        customerId, warehouseId, amount: amt, method: incomeMethod,
        creditAccountId: incomeMethod === 'credit' ? creditAccountId : undefined,
        accountId: incomeMethod !== 'credit' ? incomeAccountId : undefined,
        date: new Date().toISOString().split('T')[0],
        hawalaRoute: incomeMethod === 'hawala' ? incomeHawala.route.trim() || undefined : undefined,
      })
      setForm(null); resetForms(); load()
    } catch (error: unknown) {
      setError(errorMessage(error, 'Failed to record income.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitExpense() {
    const amt = Number(expenseAmount)
    if (!expenseDesc.trim()) { setError('What was this for?'); return }
    if (!amt || amt <= 0) { setError('Enter an amount.'); return }
    if (!expenseAccountId) { setError('Choose which account paid it.'); return }
    setSaving(true); setError(null)
    try {
      await recordCompanyExpense({
        category: 'other', description: expenseDesc, amount: amt, currency: 'ETB', method: expenseMethod,
        expenseDate: new Date().toISOString().split('T')[0], accountId: expenseAccountId,
        hawalaRoute: expenseMethod === 'hawala' ? expenseHawala.route.trim() || undefined : undefined,
      })
      setForm(null); resetForms(); load()
    } catch (error: unknown) {
      setError(errorMessage(error, 'Failed to record expense.'))
    } finally {
      setSaving(false)
    }
  }

  if (form) {
    return (
      <div className="mobile-money-form fixed inset-0 bg-white z-[80] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={() => setForm(null)} aria-label="Close form"><ChevronLeft size={20} className="text-gray-500" /></button>
          <h1 className="text-base font-medium flex-1">{form === 'income' ? 'Add income' : 'Add expense'}</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          {form === 'income' ? (
            <>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card bg-white">
                <option value="">Which customer?</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card bg-white">
                <option value="">Which warehouse?</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <input type="number" value={incomeAmount} onChange={e => setIncomeAmount(e.target.value)} placeholder="Amount (ETB)"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card" />
              <div className="grid grid-cols-4 gap-1.5">
                {METHODS.map(m => (
                  <button key={m.value} onClick={() => setIncomeMethod(m.value)}
                    className={`py-2 text-[10px] rounded-lg border ${incomeMethod === m.value ? 'bg-accent text-accent-foreground border-accent font-medium' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              {incomeMethod === 'credit' ? (
                <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card bg-white">
                  <option value="">Which credit account?</option>
                  {customerCredit.map(c => <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB</option>)}
                </select>
              ) : (
                <select value={incomeAccountId} onChange={e => setIncomeAccountId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card bg-white">
                  <option value="">Which account received it?</option>
                  {accounts.filter(a => a.currency === 'ETB').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              {incomeMethod === 'hawala' && <HawalaFields value={incomeHawala} onChange={setIncomeHawala} />}
            </>
          ) : (
            <>
              <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="What was this for?"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card" />
              <input type="number" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} placeholder="Amount (ETB)"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card" />
              <div className="grid grid-cols-4 gap-1.5">
                {EXPENSE_METHODS.map(m => (
                  <button key={m.value} onClick={() => setExpenseMethod(m.value)}
                    className={`py-2 text-[10px] rounded-lg border ${expenseMethod === m.value ? 'bg-red-600 text-white border-red-600' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <select value={expenseAccountId} onChange={e => setExpenseAccountId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-card bg-white">
                <option value="">Which account paid it?</option>
                {accounts.filter(a => a.currency === 'ETB').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {expenseMethod === 'hawala' && <HawalaFields value={expenseHawala} onChange={setExpenseHawala} />}
            </>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 shrink-0">
          <button onClick={form === 'income' ? submitIncome : submitExpense} disabled={saving}
            className={`w-full py-3.5 rounded-card text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2 ${form === 'income' ? 'bg-green-600' : 'bg-red-600'}`}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? 'Saving…' : `Record ${form}`}
          </button>
        </div>
      </div>
    )
  }

  const inTotal = txns.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0)
  const outTotal = txns.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0)
  const visibleTxns = txns.filter(t => (direction === 'all' || t.direction === direction) && `${t.party} ${t.source}`.toLowerCase().includes(search.toLowerCase()))

  return <div className="mobile-surface mobile-money">
    <header className="mobile-page-intro"><div><span>Cash control</span><h1>Money movement</h1><p>Thirty latest receipts and payments from real transactions.</p></div><i className="mobile-money-mark"><Banknote /></i></header>
    <section className="mobile-money-balance"><span>Net recorded movement</span><strong className={inTotal - outTotal >= 0 ? 'positive' : 'negative'}>{inTotal - outTotal >= 0 ? '+' : '−'}{N(Math.abs(inTotal - outTotal))}<small> ETB</small></strong><div><span><ArrowDownLeft />Received<b>{N(inTotal)} ETB</b></span><span><ArrowUpRight />Paid out<b>{N(outTotal)} ETB</b></span></div></section>
    <div className="mobile-money-actions"><button onClick={() => { setForm('income'); setError(null); resetForms() }}><ArrowDownLeft /><span><b>Add income</b><small>Customer payment</small></span><Plus /></button><button className="expense" onClick={() => { setForm('expense'); setError(null); resetForms() }}><ArrowUpRight /><span><b>Add expense</b><small>Company payment</small></span><Plus /></button></div>
    <section className="mobile-section">
      <div className="mobile-section-title"><div><span>Activity ledger</span><h2>Recent movement</h2></div><b>{visibleTxns.length}</b></div>
      <div className="mobile-money-tools"><div><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search party or source" /></div><nav>{(['all', 'in', 'out'] as const).map(value => <button key={value} className={direction === value ? 'active' : ''} onClick={() => setDirection(value)}>{value === 'all' ? 'All' : value === 'in' ? 'Received' : 'Paid'}</button>)}</nav></div>
      {loading ? <div className="mobile-state"><Loader2 size={18} className="animate-spin" /> Loading transactions…</div> : txns.length === 0 ? <div className="mobile-state"><WalletCards /><span>No transactions recorded yet.</span></div> : <div className="mobile-transaction-list">{visibleTxns.map(t => <article key={t.id}><i className={t.direction}>{t.direction === 'in' ? <ArrowDownLeft /> : <ArrowUpRight />}</i><div><b>{t.party}</b><span>{t.source} · {(t.date ?? '').slice(0, 10)}</span></div><strong className={t.direction}>{t.direction === 'in' ? '+' : '−'}{N(t.amount)}<small>{t.currency}</small></strong></article>)}{!visibleTxns.length && <div className="mobile-state"><Search /><span>No movement matches this filter.</span></div>}</div>}
    </section>
    <section className="mobile-account-strip"><Landmark /><div><b>{accounts.filter(account => account.currency === 'ETB').length} ETB accounts</b><span>Available for recording cash and bank movement</span></div></section>
  </div>

  /* Legacy mobile view retained in history during the redesign.

  return (
    <div className="p-4 pb-6 max-w-md mx-auto">
      <h1 className="text-lg font-semibold flex items-center gap-2 mb-4"><Banknote size={18} /> Money</h1>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button onClick={() => { setForm('income'); setError(null); resetForms() }}
          className="flex items-center justify-center gap-1.5 py-3 rounded-card bg-green-600 text-white text-sm font-medium">
          <Plus size={15} /> Income
        </button>
        <button onClick={() => { setForm('expense'); setError(null); resetForms() }}
          className="flex items-center justify-center gap-1.5 py-3 rounded-card bg-red-600 text-white text-sm font-medium">
          <Plus size={15} /> Expense
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <div className="bg-gray-50 rounded-card px-3 py-2.5">
          <p className="text-xs text-gray-400">Received</p>
          <p className="text-base font-semibold text-green-700">{N(inTotal)} ETB</p>
        </div>
        <div className="bg-gray-50 rounded-card px-3 py-2.5">
          <p className="text-xs text-gray-400">Paid out</p>
          <p className="text-base font-semibold text-red-700">{N(outTotal)} ETB</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : txns.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No transactions yet.</div>
      ) : (
        <div className="space-y-2">
          {txns.slice(0, 30).map(t => (
            <div key={t.id} className="bg-white shadow-[var(--shadow-card-sm)] rounded-card p-3 flex items-center gap-3">
              {t.direction === 'in' ? <ArrowDownLeft size={16} className="text-green-600 shrink-0" /> : <ArrowUpRight size={16} className="text-red-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.party}</p>
                <p className="text-xs text-gray-400">{t.source} · {(t.date ?? '').slice(0, 10)}</p>
              </div>
              <span className={`font-mono text-sm font-medium ${t.direction === 'in' ? 'text-green-700' : 'text-red-600'}`}>
                {t.direction === 'in' ? '+' : '−'}{N(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) */
}
