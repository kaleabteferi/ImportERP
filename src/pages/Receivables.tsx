import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { recordPayment } from '../api/sales'
import { fetchAccounts } from '../api/accounts'
import type { Account } from '../api/accounts'
import { usePageState } from '../lib/pageState'
import { CreditCard, Loader2, AlertTriangle, ShieldAlert, X, Landmark, ArrowUpDown, ExternalLink } from 'lucide-react'
import { HawalaFields, emptyHawalaValue } from '../components/HawalaFields'

interface Receivable {
  id: string
  customer_name: string
  order_number: string | null
  total_etb: number
  paid_etb: number
  sale_date: string | null
  status: string
  days_outstanding: number
  creditAccountId: string | null
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'credit', label: 'Credit' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'hawala', label: 'Hawala' },
]

function RecordPaymentForm({ receivable, accounts, onDone, onCancel }: {
  receivable: Receivable
  accounts: Account[]
  onDone: () => void
  onCancel: () => void
}) {
  const outstanding = receivable.total_etb - receivable.paid_etb
  const [amount, setAmount] = useState(String(outstanding))
  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    setSaving(true)
    setError(null)
    try {
      await recordPayment(receivable.id, amt, method, {
        reference, sensitive, notes, accountId: method !== 'credit' ? accountId : undefined,
        hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-blue-50/50 border-t border-blue-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          type="number" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder="Amount (ETB)"
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
          <option value="">Which account received it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {method === 'hawala' && <HawalaFields value={hawala} onChange={setHawala} />}
      <input
        value={reference} onChange={e => setReference(e.target.value)}
        placeholder="Reference (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
      />
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
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Record payment'}
        </button>
      </div>
    </div>
  )
}

export function Receivables() {
  const [rows, setRows]           = useState<Receivable[]>([])
  const [accounts, setAccounts]   = useState<Account[]>([])
  const [loading, setLoading]     = useState(true)
  const [openFormId, setOpenFormId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
        const [salesRes, paymentsRes, accountRows] = await Promise.all([
          (async () => {
            try {
              return await supabase
                .from('sales_orders')
                .select('id, order_number, total_etb, paid_amount, sale_date, status, customers(name)')
                .in('status', ['INVOICED', 'PARTIAL'])
                .order('sale_date', { ascending: true })
            } catch {
              return { data: [], error: null }
            }
          })(),
          (async () => {
            try {
              // FIX: this previously selected `amount_paid`, a column that
              // doesn't exist — sales.ts writes to `amount_etb`. Selecting
              // a nonexistent column errors, which the surrounding catch
              // silently swallowed, so paymentMap was always empty and
              // this page ran entirely on the cached sales_orders.paid_amount.
              return await supabase
                .from('sales_payments')
                .select('sales_order_id, amount_etb')
            } catch {
              return { data: [], error: null }
            }
          })(),
          fetchAccounts().catch(() => []),
        ])

        setAccounts(accountRows)

        const paymentMap = new Map<string, number>()
        for (const payment of (paymentsRes.data ?? []) as Array<{ sales_order_id: string; amount_etb: number }>) {
          const key = payment.sales_order_id
          paymentMap.set(key, (paymentMap.get(key) ?? 0) + Number(payment.amount_etb ?? 0))
        }

        const today = new Date()
        const orderIds = (salesRes.data ?? []).map((r: any) => r.id)
        // Which of these orders were funded by a credit draw, and which
        // account — paying one down here with a plain cash/bank payment
        // would settle it in this view while leaving Credit Accounts'
        // balance untouched, since that only moves on credit_transactions.
        // Route those to Credit Accounts instead of the risk of desync.
        const creditAccountByOrder = new Map<string, string>()
        if (orderIds.length > 0) {
          const { data: draws } = await supabase
            .from('credit_transactions')
            .select('sales_order_id, credit_account_id')
            .eq('type', 'draw')
            .in('sales_order_id', orderIds)
          for (const d of (draws ?? []) as any[]) {
            if (d.sales_order_id) creditAccountByOrder.set(d.sales_order_id, d.credit_account_id)
          }
        }

        const rowsData = (salesRes.data ?? []).map((r: any) => {
          const saleDate = r.sale_date ? new Date(r.sale_date) : today
          const days = Math.floor((today.getTime() - saleDate.getTime()) / 86400000)
          const paidFromOrders = Number(r.paid_amount ?? 0)
          const paidFromPayments = paymentMap.get(r.id) ?? 0
          // FIX: previously took Math.max() of the two, which meant a stale
          // cached total could never be corrected downward (e.g. after a
          // refund). Now the real payment sum wins whenever it exists.
          const paidEtb = paymentMap.has(r.id) ? paidFromPayments : paidFromOrders

          return {
            id: r.id,
            customer_name: (Array.isArray(r.customers) ? r.customers[0]?.name : r.customers?.name) ?? '—',
            order_number: r.order_number,
            total_etb: Number(r.total_etb ?? 0),
            paid_etb: paidEtb,
            sale_date: r.sale_date,
            status: r.status,
            days_outstanding: days,
            creditAccountId: creditAccountByOrder.get(r.id) ?? null,
          }
        })

        setRows(rowsData.filter((row: Receivable) => row.total_etb > row.paid_etb))
      } catch (error) {
        console.error(error)
        setRows([])
      } finally {
        setLoading(false)
      }
  }, [])

  useEffect(() => { load() }, [load])

  const [dateSort, setDateSort] = usePageState<'newest' | 'oldest'>('receivables.dateSort', 'oldest')
  const [fundingFilter, setFundingFilter] = usePageState<'all' | 'cash' | 'credit'>('receivables.fundingFilter', 'all')

  const totalOutstanding = rows.reduce((s, r) => s + (r.total_etb - r.paid_etb), 0)
  const overdue = rows.filter(r => r.days_outstanding > 30)
  const sortedRows = useMemo(() => rows
    .filter(r => fundingFilter === 'all' || (fundingFilter === 'credit' ? !!r.creditAccountId : !r.creditAccountId))
    .sort((a, b) => dateSort === 'newest' ? (b.sale_date ?? '').localeCompare(a.sale_date ?? '') : (a.sale_date ?? '').localeCompare(b.sale_date ?? '')),
    [rows, dateSort, fundingFilter])

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <CreditCard size={18} /> Receivables
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Customer invoices awaiting payment
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total outstanding</p>
          <p className="text-xl font-medium font-mono text-green-700">{N(totalOutstanding)} ETB</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Over 30 days</p>
          <p className="text-xl font-medium font-mono text-amber-700">{overdue.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No open receivables. Invoiced sales orders appear here.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={fundingFilter} onChange={e => setFundingFilter(e.target.value as any)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="all">All receivables</option>
              <option value="cash">Cash/bank sales only</option>
              <option value="credit">Credit sales only</option>
            </select>
            <button
              onClick={() => setDateSort(s => s === 'newest' ? 'oldest' : 'newest')}
              title="Sort by date"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <ArrowUpDown size={12} className={dateSort === 'oldest' ? 'rotate-180' : ''} /> {dateSort === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
          </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sortedRows.map((r, i) => {
            const outstanding = r.total_etb - r.paid_etb
            const isOverdue = r.days_outstanding > 30
            return (
              <div key={r.id} className={i < sortedRows.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {r.customer_name}
                      {r.creditAccountId && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-700">
                          <Landmark size={9} /> Credit sale
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {r.order_number ?? 'Invoice'} · {r.sale_date ?? '—'} · {r.days_outstanding}d
                    </p>
                  </div>
                  {isOverdue && (
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                  )}
                  <div className="text-right">
                    <p className="text-sm font-mono font-medium text-green-700">
                      {N(outstanding)} ETB
                    </p>
                    <p className="text-xs text-gray-400">
                      of {N(r.total_etb)} · paid {N(r.paid_etb)}
                    </p>
                  </div>
                  {r.creditAccountId ? (
                    <Link
                      to="/credit-accounts"
                      title="This was funded by a credit draw — settle it in Credit Accounts so both the order and the credit line update together"
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 shrink-0"
                    >
                      Settle in Credit <ExternalLink size={11} />
                    </Link>
                  ) : (
                    <button
                      onClick={() => setOpenFormId(openFormId === r.id ? null : r.id)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 shrink-0"
                    >
                      {openFormId === r.id ? <X size={12} /> : 'Record payment'}
                    </button>
                  )}
                </div>
                {openFormId === r.id && (
                  <RecordPaymentForm
                    receivable={r}
                    accounts={accounts}
                    onCancel={() => setOpenFormId(null)}
                    onDone={() => { setOpenFormId(null); load() }}
                  />
                )}
              </div>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}
