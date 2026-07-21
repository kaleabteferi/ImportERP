import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAccounts } from '../api/accounts'
import type { Account } from '../api/accounts'
import { usePageState } from '../lib/pageState'
import { Wallet, Loader2, AlertTriangle, ShieldAlert, X, Search, ArrowRightLeft } from 'lucide-react'

interface Payable {
  id: string
  supplier_name: string
  po_number: string | null
  total_amount: number
  paid_amount: number
  currency: string
  payment_terms: string | null
  due_date: string | null
  status: string
  sensitive: boolean
  kind: 'shipment_expense'
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'credit', label: 'Credit' },
  { value: 'mobile_money', label: 'Mobile money' },
]

function MarkExpensePaidForm({ payable, accounts, onDone, onCancel }: {
  payable: Payable
  accounts: Account[]
  onDone: () => void
  onCancel: () => void
}) {
  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rawId = payable.id.replace(/^expense-/, '')

  async function submit() {
    if (method !== 'credit' && !accountId) { setError('Choose which account paid it.'); return }
    setSaving(true)
    setError(null)
    try {
      const { error } = await supabase
        .from('shipment_expenses')
        .update({ is_paid: true, paid_at: new Date().toISOString(), payment_method: method, sensitive_flag: sensitive, account_id: method !== 'credit' ? accountId : null })
        .eq('id', rawId)
      if (error) throw error
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mark as paid.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-amber-50/50 border-t border-amber-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 items-center">
        <select
          value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
        >
          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
          <ShieldAlert size={12} className="text-amber-500" /> Sensitive
        </label>
      </div>
      {method !== 'credit' && (
        <select
          value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
        >
          <option value="">Which account paid it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">
          Cancel
        </button>
        <button
          onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Mark as paid'}
        </button>
      </div>
    </div>
  )
}

export function Payables() {
  const [rows, setRows]       = useState<Payable[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [openFormId, setOpenFormId] = useState<string | null>(null)
  const [search, setSearch]           = usePageState('payables.search', '')
  const [currencyFilter, setCurrencyFilter] = usePageState('payables.currencyFilter', '')
  const [overdueOnly, setOverdueOnly] = usePageState('payables.overdueOnly', false)
  const [dueFrom, setDueFrom]         = usePageState('payables.dueFrom', '')
  const [dueTo, setDueTo]             = usePageState('payables.dueTo', '')

  const load = useCallback(async () => {
      setLoading(true)
      try {
        const [expenseRes, accountRows] = await Promise.all([
          (async () => {
            try {
              return await supabase
                .from('shipment_expenses')
                .select('id, description, amount, amount_etb, currency, vendor_name, expense_date, notes, is_paid, payment_method, sensitive_flag')
                .eq('is_paid', false)
                .order('expense_date', { ascending: true })
            } catch {
              return { data: [], error: null }
            }
          })(),
          fetchAccounts().catch(() => []),
        ])

        setAccounts(accountRows)

        const expenseRows = (expenseRes.data ?? []).map((r: any) => ({
          id: `expense-${r.id}`,
          supplier_name: r.vendor_name ?? 'Shipment expense',
          po_number: r.description,
          total_amount: Number(r.amount_etb ?? r.amount ?? 0),
          paid_amount: 0,
          currency: r.currency ?? 'ETB',
          payment_terms: r.payment_method ?? 'Shipment cost',
          due_date: r.expense_date,
          status: 'OPEN',
          sensitive: !!r.sensitive_flag,
          kind: 'shipment_expense' as const,
        }))

        setRows([...expenseRows].sort((a, b) => {
          const aDate = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
          const bDate = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
          return aDate - bDate
        }))
      } catch (error) {
        console.error(error)
        setRows([])
      } finally {
        setLoading(false)
      }
  }, [])

  useEffect(() => { load() }, [load])

  const totalUsd = rows
    .filter(r => r.currency === 'USD')
    .reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)

  // FIX: previously only USD was summed here, so ETB shipment expenses —
  // usually the majority of local costs (customs, freight, port handling) —
  // were silently missing from the headline payables total.
  const totalEtb = rows
    .filter(r => r.currency === 'ETB')
    .reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)

  // purchase_orders.currency is a 3-value enum (USD/ETB/CNY) — no live CNY
  // rows today, but silently dropping them from every total if one appears
  // would be a real bug, so it gets its own bucket like USD/ETB.
  const totalCny = rows
    .filter(r => r.currency === 'CNY')
    .reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)

  const overdue = rows.filter(r => r.due_date && new Date(r.due_date) < new Date())

  const filteredRows = useMemo(() => rows
    .filter(r => !currencyFilter || r.currency === currencyFilter)
    .filter(r => !overdueOnly || (r.due_date && new Date(r.due_date) < new Date()))
    .filter(r => !dueFrom || (r.due_date ?? '') >= dueFrom)
    .filter(r => !dueTo || (r.due_date ?? '') <= dueTo)
    .filter(r => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return r.supplier_name.toLowerCase().includes(q) || (r.po_number ?? '').toLowerCase().includes(q)
    }),
    [rows, currencyFilter, overdueOnly, dueFrom, dueTo, search])
  const hasFilters = !!(search || currencyFilter || overdueOnly || dueFrom || dueTo)
  function clearFilters() {
    setSearch(''); setCurrencyFilter(''); setOverdueOnly(false); setDueFrom(''); setDueTo('')
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Wallet size={18} /> Payables
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Unpaid shipment costs (freight, customs, port handling) — for what you owe suppliers for the goods themselves, see{' '}
          <Link to="/supplier-payments" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
            Supplier Payments <ArrowRightLeft size={11} />
          </Link>
        </p>
      </div>

      <div className={`grid gap-3 mb-5 ${totalCny > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total outstanding (USD)</p>
          <p className="text-xl font-medium font-mono text-red-700">${N(totalUsd)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total outstanding (ETB)</p>
          <p className="text-xl font-medium font-mono text-red-700">{N(totalEtb)}</p>
        </div>
        {totalCny > 0 && (
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400">Total outstanding (CNY)</p>
            <p className="text-xl font-medium font-mono text-red-700">¥{N(totalCny)}</p>
          </div>
        )}
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Overdue</p>
          <p className="text-xl font-medium font-mono text-amber-700">{overdue.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No open payables. Unpaid shipment expenses appear here.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search supplier or PO"
                className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-52
                           focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <select value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                         focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">All currencies</option>
              <option value="USD">USD</option>
              <option value="ETB">ETB</option>
              <option value="CNY">CNY</option>
            </select>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              Due
              <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <span>–</span>
              <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">Clear filters</button>
            )}
          </div>
          {filteredRows.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No payables match this filter.</div>
          ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filteredRows.map((r, i) => {
            const outstanding = r.total_amount - r.paid_amount
            const isOverdue = r.due_date && new Date(r.due_date) < new Date()
            return (
              <div key={r.id} className={i < filteredRows.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {r.supplier_name}
                      {r.sensitive && (
                        <ShieldAlert size={12} className="text-amber-500" aria-label="Sensitive" />
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {r.po_number ?? 'PO'} · {r.payment_terms ?? '—'}
                      {r.due_date && ` · due ${r.due_date}`}
                    </p>
                  </div>
                  {isOverdue && (
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  )}
                  <div className="text-right">
                    <p className="text-sm font-mono font-medium">
                      {r.currency === 'USD' ? '$' : r.currency === 'CNY' ? '¥' : ''}{N(outstanding)} {r.currency}
                    </p>
                    <p className="text-xs text-gray-400">
                      of {N(r.total_amount)} paid {N(r.paid_amount)}
                    </p>
                  </div>
                  <button
                    onClick={() => setOpenFormId(openFormId === r.id ? null : r.id)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 shrink-0"
                  >
                    {openFormId === r.id ? <X size={12} /> : 'Mark as paid'}
                  </button>
                </div>
                {openFormId === r.id && (
                  <MarkExpensePaidForm
                    payable={r}
                    accounts={accounts}
                    onCancel={() => setOpenFormId(null)}
                    onDone={() => { setOpenFormId(null); load() }}
                  />
                )}
              </div>
            )
          })}
        </div>
          )}
        </>
      )}
    </div>
  )
}