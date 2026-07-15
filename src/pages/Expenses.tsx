import { useState, useEffect, useCallback, useMemo } from 'react'
import { recordCompanyExpense, fetchCompanyExpenses, fetchCompaniesList, fetchEmployeesList } from '../api/companyExpenses'
import { usePageState } from '../lib/pageState'
import { Receipt, Loader2, Plus, X, ShieldAlert, Search } from 'lucide-react'

interface ExpenseRow {
  id: string
  category: string
  description: string
  amount: number
  currency: string
  method: string
  vendor_name: string | null
  expense_date: string
  sensitive: boolean
  notes: string | null
  company_name: string | null
  paid_by_name: string | null
}

interface Option { id: string; name: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'credit', label: 'Credit' },
  { value: 'mobile_money', label: 'Mobile money' },
]
const CATEGORIES = ['rent', 'salary', 'fuel', 'supplies', 'utilities', 'maintenance', 'other']

function NewExpenseForm({ companies, employees, onDone, onCancel }: {
  companies: Option[]; employees: Option[]; onDone: () => void; onCancel: () => void
}) {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'ETB' | 'USD'>('ETB')
  const [method, setMethod] = useState('cash')
  const [companyId, setCompanyId] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [vendorName, setVendorName] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10))
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const amt = Number(amount)
    if (!description.trim()) { setError('Add a short description.'); return }
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    setSaving(true)
    setError(null)
    try {
      await recordCompanyExpense({
        companyId: companyId || undefined,
        category, description, amount: amt, currency, method: method as "cash" | "bank_transfer" | "credit" | "mobile_money",
        paidBy: paidBy || undefined, vendorName: vendorName || undefined,
        expenseDate, sensitive, notes,
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
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        value={description} onChange={e => setDescription(e.target.value)}
        placeholder="What was this expense for?"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
      />
      <div className="flex gap-2">
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white capitalize">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="Amount" className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={currency} onChange={e => setCurrency(e.target.value as 'ETB' | 'USD')}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="ETB">ETB</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)}
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
      <input value={vendorName} onChange={e => setVendorName(e.target.value)}
        placeholder="Vendor / paid to (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <input value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)"
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

export function Expenses() {
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [companies, setCompanies] = useState<Option[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = usePageState('expenses.query', '')
  const [category, setCategory] = usePageState('expenses.category', 'all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [expenseRows, companyRows, employeeRows] = await Promise.all([
        fetchCompanyExpenses(), fetchCompaniesList(), fetchEmployeesList(),
      ])
      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      setRows((expenseRows ?? []).map((r: any) => ({
        id: r.id, category: r.category, description: r.description,
        amount: Number(r.amount ?? 0), currency: r.currency, method: r.method,
        vendor_name: r.vendor_name, expense_date: r.expense_date,
        sensitive: !!r.sensitive_flag, notes: r.notes,
        company_name: one(r.companies)?.name ?? null,
        paid_by_name: one(r.employees)?.full_name ?? null,
      })))
      setCompanies((companyRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setEmployees((employeeRows ?? []).map((e: any) => ({ id: e.id, name: e.full_name })))
    } catch (e) {
      console.error(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => rows
    .filter(r => category === 'all' || r.category === category)
    .filter(r => r.description.toLowerCase().includes(query.toLowerCase()) || (r.vendor_name ?? '').toLowerCase().includes(query.toLowerCase())),
    [rows, category, query])

  const totalEtb = filtered.filter(r => r.currency === 'ETB').reduce((s, r) => s + r.amount, 0)
  const totalUsd = filtered.filter(r => r.currency === 'USD').reduce((s, r) => s + r.amount, 0)

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><Receipt size={18} /> Expenses</h1>
          <p className="text-xs text-gray-400 mt-0.5">Every company expense — who paid, how, and where it went</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white flex items-center gap-1">
          {showForm ? <X size={12} /> : <Plus size={12} />} New expense
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total (ETB)</p>
          <p className="text-xl font-medium font-mono text-red-700">{N(totalEtb)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total (USD)</p>
          <p className="text-xl font-medium font-mono text-red-700">${N(totalUsd)}</p>
        </div>
      </div>

      {showForm && (
        <NewExpenseForm companies={companies} employees={employees}
          onCancel={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />
      )}

      <div className="flex items-center gap-2 mb-2">
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white capitalize">
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search description or vendor"
            className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-full" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No expenses recorded yet.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filtered.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 text-xs ${i < filtered.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="font-medium flex items-center gap-1.5">
                  {r.description}
                  {r.sensitive && <ShieldAlert size={11} className="text-amber-500 shrink-0" aria-label="Sensitive" />}
                </p>
                <p className="text-gray-400 capitalize">
                  {r.category} · {r.expense_date} · {METHODS.find(m => m.value === r.method)?.label ?? r.method}
                  {r.paid_by_name && ` · paid by ${r.paid_by_name}`}
                  {r.company_name && ` · ${r.company_name}`}
                  {r.vendor_name && ` · to ${r.vendor_name}`}
                </p>
              </div>
              <div className="font-mono font-medium text-red-600 shrink-0">
                {r.currency === 'USD' ? '$' : ''}{N(r.amount)} {r.currency === 'ETB' ? 'ETB' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}