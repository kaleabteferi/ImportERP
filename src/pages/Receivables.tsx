import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { recordPayment } from '../api/sales'
import { CreditCard, Loader2, AlertTriangle, ShieldAlert, X } from 'lucide-react'

interface Receivable {
  id: string
  customer_name: string
  order_number: string | null
  total_etb: number
  paid_etb: number
  sale_date: string | null
  status: string
  days_outstanding: number
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'credit', label: 'Credit' },
  { value: 'mobile_money', label: 'Mobile money' },
]

function RecordPaymentForm({ receivable, onDone, onCancel }: {
  receivable: Receivable
  onDone: () => void
  onCancel: () => void
}) {
  const outstanding = receivable.total_etb - receivable.paid_etb
  const [amount, setAmount] = useState(String(outstanding))
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    setSaving(true)
    setError(null)
    try {
      await recordPayment(receivable.id, amt, method, { reference, sensitive, notes })
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
  const [loading, setLoading]     = useState(true)
  const [openFormId, setOpenFormId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
        const [salesRes, paymentsRes] = await Promise.all([
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
        ])

        const paymentMap = new Map<string, number>()
        for (const payment of (paymentsRes.data ?? []) as Array<{ sales_order_id: string; amount_etb: number }>) {
          const key = payment.sales_order_id
          paymentMap.set(key, (paymentMap.get(key) ?? 0) + Number(payment.amount_etb ?? 0))
        }

        const today = new Date()
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

  const totalOutstanding = rows.reduce((s, r) => s + (r.total_etb - r.paid_etb), 0)
  const overdue = rows.filter(r => r.days_outstanding > 30)

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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {rows.map((r, i) => {
            const outstanding = r.total_etb - r.paid_etb
            const isOverdue = r.days_outstanding > 30
            return (
              <div key={r.id} className={i < rows.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{r.customer_name}</p>
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
                  <button
                    onClick={() => setOpenFormId(openFormId === r.id ? null : r.id)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 shrink-0"
                  >
                    {openFormId === r.id ? <X size={12} /> : 'Record payment'}
                  </button>
                </div>
                {openFormId === r.id && (
                  <RecordPaymentForm
                    receivable={r}
                    onCancel={() => setOpenFormId(null)}
                    onDone={() => { setOpenFormId(null); load() }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
