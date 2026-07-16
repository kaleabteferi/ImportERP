import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { recordPurchasePayment } from '../api/purchases'
import { fetchAccounts } from '../api/accounts'
import type { Account } from '../api/accounts'
import { Wallet, Loader2, AlertTriangle, ShieldAlert, X } from 'lucide-react'

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
  kind: 'purchase_order' | 'shipment_expense'
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'credit', label: 'Credit' },
  { value: 'mobile_money', label: 'Mobile money' },
]

function RecordPurchasePaymentForm({ payable, accounts, onDone, onCancel }: {
  payable: Payable
  accounts: Account[]
  onDone: () => void
  onCancel: () => void
}) {
  const outstanding = payable.total_amount - payable.paid_amount
  const [amount, setAmount] = useState(String(outstanding))
  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account paid it.'); return }
    setSaving(true)
    setError(null)
    try {
      await recordPurchasePayment(payable.id, amt, payable.currency as 'USD' | 'ETB' | 'CNY', method, { sensitive, notes, accountId: method !== 'credit' ? accountId : undefined })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-amber-50/50 border-t border-amber-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder={`Amount (${payable.currency})`}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
        />
        <select
          value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
        >
          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
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
      <input
        value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
      />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Flag as sensitive
      </label>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">
          Cancel
        </button>
        <button
          onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Record payment'}
        </button>
      </div>
    </div>
  )
}

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

  const load = useCallback(async () => {
      setLoading(true)
      try {
        const [purchaseRes, expenseRes, accountRows] = await Promise.all([
          (async () => {
            try {
              // purchase_orders has no status column at all — confirmed via
              // information_schema. "Outstanding" is derived from the
              // amounts, not a stored status.
              return await supabase
                .from('purchase_orders')
                .select('id, po_number, total_amount, paid_amount, currency, payment_terms, due_date, suppliers(name)')
                .order('due_date', { ascending: true, nullsFirst: false })
            } catch {
              return { data: [], error: null }
            }
          })(),
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

        const purchaseRows = (purchaseRes.data ?? [])
          .filter((r: any) => Number(r.paid_amount ?? 0) < Number(r.total_amount ?? 0))
          .map((r: any) => ({
            id: r.id,
            supplier_name: (Array.isArray(r.suppliers) ? r.suppliers[0]?.name : r.suppliers?.name) ?? '—',
            po_number: r.po_number,
            total_amount: Number(r.total_amount ?? 0),
            paid_amount: Number(r.paid_amount ?? 0),
            currency: r.currency ?? 'USD',
            payment_terms: r.payment_terms,
            due_date: r.due_date,
            status: Number(r.paid_amount ?? 0) > 0 ? 'PARTIAL' : 'OPEN',
            sensitive: false,
            kind: 'purchase_order' as const,
        }))

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

        setRows([...purchaseRows, ...expenseRows].sort((a, b) => {
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

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Wallet size={18} /> Payables
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Outstanding supplier invoices and shipment expenses
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
          No open payables. Supplier POs and unpaid shipment expenses appear here.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {rows.map((r, i) => {
            const outstanding = r.total_amount - r.paid_amount
            const isOverdue = r.due_date && new Date(r.due_date) < new Date()
            return (
              <div key={r.id} className={i < rows.length - 1 ? 'border-b border-gray-50' : ''}>
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
                    {openFormId === r.id ? <X size={12} /> : r.kind === 'purchase_order' ? 'Record payment' : 'Mark as paid'}
                  </button>
                </div>
                {openFormId === r.id && (
                  r.kind === 'purchase_order' ? (
                    <RecordPurchasePaymentForm
                      payable={r}
                      accounts={accounts}
                      onCancel={() => setOpenFormId(null)}
                      onDone={() => { setOpenFormId(null); load() }}
                    />
                  ) : (
                    <MarkExpensePaidForm
                      payable={r}
                      accounts={accounts}
                      onCancel={() => setOpenFormId(null)}
                      onDone={() => { setOpenFormId(null); load() }}
                    />
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}