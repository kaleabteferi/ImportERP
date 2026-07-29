import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchCreditAccounts, fetchCustomersForCredit, openCreditAccount, recordCreditTransaction, fetchOutstandingCreditOrders } from '../api/credit'
import type { OutstandingCreditOrder } from '../api/credit'
import { Link } from 'react-router-dom'
import { usePageState } from '../lib/pageState'
import { CreditCard as CardIcon, Loader2, Plus, X, ShieldAlert, ArrowRightLeft, ArrowUpDown } from 'lucide-react'
import { HawalaFields, emptyHawalaValue } from '../components/HawalaFields'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'

interface CreditAccount {
  id: string
  credit_limit: number
  balance: number
  due_date: string
  status: 'active' | 'overdue' | 'settled'
  notes: string | null
  customer_name: string
}

interface Customer { id: string; name: string }

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'hawala', label: 'Hawala' },
]

const STATUS_VARIANT: Record<string, 'info' | 'danger' | 'success' | 'accent'> = {
  active: 'info',
  overdue: 'danger',
  settled: 'success',
  overpaid: 'accent',
}

// The DB only tracks active/overdue/settled — a negative balance ("settled")
// means the customer paid more than they owed, which reads very differently
// from an exact zero. Distinguish it client-side rather than adding a DB enum value.
function displayStatus(status: string, balance: number): string {
  return status === 'settled' && balance < 0 ? 'overpaid' : status
}

function NewAccountForm({ customers, onDone, onCancel }: {
  customers: Customer[]
  onDone: () => void
  onCancel: () => void
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [limit, setLimit] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const lim = Number(limit)
    if (!customerId) { setError('Choose a customer.'); return }
    if (!lim || lim <= 0) { setError('Enter a credit limit greater than 0.'); return }
    if (!dueDate) { setError('Choose a due date.'); return }
    setSaving(true)
    setError(null)
    try {
      await openCreditAccount(customerId, lim, dueDate, notes)
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to open credit account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <select
        value={customerId} onChange={e => setCustomerId(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
      >
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="flex gap-2">
        <input
          type="number" value={limit} onChange={e => setLimit(e.target.value)}
          placeholder="Credit limit (ETB)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
        />
        <input
          type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
        />
      </div>
      <input
        value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} onClick={submit}>{saving ? 'Saving…' : 'Open account'}</Button>
      </div>
    </Card>
  )
}

function RepaymentForm({ account, onDone, onCancel }: {
  account: CreditAccount
  onDone: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outstandingOrders, setOutstandingOrders] = useState<OutstandingCreditOrder[]>([])
  const [orderId, setOrderId] = useState('')

  useEffect(() => {
    fetchOutstandingCreditOrders(account.id).then(setOutstandingOrders).catch(() => setOutstandingOrders([]))
  }, [account.id])

  const selectedOrder = outstandingOrders.find(o => o.id === orderId)

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    setSaving(true)
    setError(null)
    try {
      await recordCreditTransaction(account.id, 'repayment', amt, {
        method, sensitive, notes, salesOrderId: orderId || undefined,
        hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record repayment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-blue-50/50 border-t border-blue-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {outstandingOrders.length > 0 && (
        <div>
          <select
            value={orderId}
            onChange={e => {
              setOrderId(e.target.value)
              const o = outstandingOrders.find(x => x.id === e.target.value)
              if (o) setAmount(String(o.totalEtb - o.paidAmount))
            }}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
          >
            <option value="">General repayment — not tied to one order</option>
            {outstandingOrders.map(o => (
              <option key={o.id} value={o.id}>{o.orderNumber} — {N(o.totalEtb - o.paidAmount)} ETB owed</option>
            ))}
          </select>
          {selectedOrder && (
            <p className="text-xs text-blue-600 mt-1">
              This will mark {selectedOrder.orderNumber} as paid down by this amount, not just the credit line.
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="Amount received (ETB)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
        />
        <select
          value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
        >
          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {method === 'hawala' && <HawalaFields value={hawala} onChange={setHawala} />}
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
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button
          onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Record repayment'}
        </button>
      </div>
    </div>
  )
}

export function CreditAccounts() {
  const [accounts, setAccounts]   = useState<CreditAccount[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading]     = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [openTxnId, setOpenTxnId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [accountRows, customerRows] = await Promise.all([
        fetchCreditAccounts(),
        fetchCustomersForCredit(),
      ])
      setAccounts((accountRows ?? []).map((r: any) => ({
        id: r.id,
        credit_limit: Number(r.credit_limit ?? 0),
        balance: Number(r.balance ?? 0),
        due_date: r.due_date,
        status: r.status,
        notes: r.notes,
        customer_name: (Array.isArray(r.customers) ? r.customers[0]?.name : r.customers?.name) ?? 'Unknown',
      })))
      setCustomers(customerRows ?? [])
    } catch (e) {
      console.error(e)
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const [statusFilter, setStatusFilter] = usePageState<'all' | 'active' | 'overdue' | 'settled'>('creditAccounts.statusFilter', 'all')
  const [dateSort, setDateSort] = usePageState<'soonest' | 'latest'>('creditAccounts.dateSort', 'soonest')

  const totalOutstanding = accounts.reduce((s, a) => s + a.balance, 0)
  const overdueCount = accounts.filter(a => a.status === 'overdue').length
  const sortedAccounts = useMemo(() => accounts
    .filter(a => statusFilter === 'all' || a.status === statusFilter)
    .sort((a, b) => dateSort === 'soonest' ? a.due_date.localeCompare(b.due_date) : b.due_date.localeCompare(a.due_date)),
    [accounts, statusFilter, dateSort])

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <PageHeader
        icon={<CardIcon size={18} />}
        title="Credit accounts"
        subtitle={<span className="flex items-center gap-1 flex-wrap">
          What each customer owes, and where — draws happen automatically when you record a credit sale
          <Link to="/receivables" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
            <ArrowRightLeft size={10} /> Credit-funded sales also show in Receivables until repaid
          </Link>
        </span>}
        actions={<Button icon={showNewForm ? <X size={12} /> : <Plus size={12} />} onClick={() => setShowNewForm(v => !v)}>New account</Button>}
      />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Total outstanding" value={<span className="text-amber-700">{N(totalOutstanding)} ETB</span>} />
        <StatCard label="Overdue accounts" value={<span className="text-red-700">{overdueCount}</span>} />
      </div>

      {showNewForm && (
        <NewAccountForm
          customers={customers}
          onCancel={() => setShowNewForm(false)}
          onDone={() => { setShowNewForm(false); load() }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No credit accounts yet. Open one above to get started.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="overdue">Overdue</option>
              <option value="settled">Settled</option>
            </select>
            <button
              onClick={() => setDateSort(s => s === 'soonest' ? 'latest' : 'soonest')}
              title="Sort by due date"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <ArrowUpDown size={12} className={dateSort === 'latest' ? 'rotate-180' : ''} /> Due {dateSort === 'soonest' ? 'soonest first' : 'latest first'}
            </button>
          </div>
        <Card>
          {sortedAccounts.length === 0 ? (
            <p className="px-4 py-8 text-xs text-gray-400 text-center">No accounts match this filter.</p>
          ) : sortedAccounts.map((a, i) => (
            <div key={a.id} className={i < sortedAccounts.length - 1 ? 'border-b border-gray-50' : ''}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{a.customer_name}</p>
                  <p className="text-xs text-gray-400">
                    Due {a.due_date} · limit {N(a.credit_limit)} ETB
                    {a.notes && ` · ${a.notes}`}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[displayStatus(a.status, a.balance)]}>
                  {displayStatus(a.status, a.balance)}
                </Badge>
                <div className={`font-mono font-medium w-24 text-right text-sm ${a.balance < 0 ? 'text-violet-700' : ''}`}>
                  {a.balance < 0 ? `+${N(-a.balance)}` : N(a.balance)} ETB
                </div>
                <button
                  onClick={() => setOpenTxnId(openTxnId === a.id ? null : a.id)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 shrink-0"
                >
                  {openTxnId === a.id ? <X size={12} /> : 'Record repayment'}
                </button>
              </div>
              {openTxnId === a.id && (
                <RepaymentForm
                  account={a}
                  onCancel={() => setOpenTxnId(null)}
                  onDone={() => { setOpenTxnId(null); load() }}
                />
              )}
            </div>
          ))}
        </Card>
        </>
      )}
    </div>
  )
}