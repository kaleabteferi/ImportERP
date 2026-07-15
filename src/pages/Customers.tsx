import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchCustomers, fetchCustomerHistory, createCustomer } from '../api/customers'
import { openCreditAccount } from '../api/credit'
import { usePageState } from '../lib/pageState'
import { Users, Loader2, Plus, X, Search, ChevronDown, ChevronRight, Flame, CreditCard } from 'lucide-react'

interface Customer {
  id: string; name: string; type: string | null; phone: string | null
  address: string | null; is_active: boolean; outstanding_etb: number
  orderCount: number; totalSpentEtb: number; lastOrderDate: string | null; ordersLast30d: number
}
interface Order { id: string; order_number: string; sale_date: string; total_etb: number; paid_amount: number; status: string }
interface CreditAcct { id: string; credit_limit: number; balance: number; due_date: string; status: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

function NewCustomerForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [giveCredit, setGiveCredit] = useState(false)
  const [creditLimit, setCreditLimit] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) { setError('Enter a customer name.'); return }
    if (giveCredit && (!creditLimit || Number(creditLimit) <= 0)) { setError('Enter a credit limit greater than 0.'); return }
    if (giveCredit && !dueDate) { setError('Choose a due date for the credit account.'); return }
    setSaving(true); setError(null)
    try {
      const id = await createCustomer({ name, type: type || undefined, phone: phone || undefined, address: address || undefined })
      if (giveCredit) {
        await openCreditAccount(id, Number(creditLimit), dueDate)
      }
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add customer.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Customer name"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <div className="flex gap-2">
        <input value={type} onChange={e => setType(e.target.value)} placeholder="Type (e.g. retail, agent)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Address (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600 pt-1">
        <input type="checkbox" checked={giveCredit} onChange={e => setGiveCredit(e.target.checked)} />
        <CreditCard size={12} className="text-blue-500" /> Open a credit account for this customer
      </label>
      {giveCredit && (
        <div className="flex gap-2">
          <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="Credit limit (ETB)"
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Add customer'}
        </button>
      </div>
    </div>
  )
}

function OpenCreditForm({ customerId, onDone, onCancel }: { customerId: string; onDone: () => void; onCancel: () => void }) {
  const [creditLimit, setCreditLimit] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!creditLimit || Number(creditLimit) <= 0) { setError('Enter a credit limit greater than 0.'); return }
    if (!dueDate) { setError('Choose a due date.'); return }
    setSaving(true); setError(null)
    try {
      await openCreditAccount(customerId, Number(creditLimit), dueDate)
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to open credit account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="Credit limit (ETB)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Open credit account'}
        </button>
      </div>
    </div>
  )
}

function CustomerDetail({ customerId }: { customerId: string }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [credit, setCredit] = useState<CreditAcct[]>([])
  const [loading, setLoading] = useState(true)
  const [openingCredit, setOpeningCredit] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchCustomerHistory(customerId)
      .then(({ orders, creditAccounts }) => { setOrders(orders as any); setCredit(creditAccounts as any) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [customerId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="px-4 py-3 text-xs text-gray-400">Loading history…</div>

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-gray-500">Credit</p>
          {!openingCredit && (
            <button onClick={() => setOpeningCredit(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <CreditCard size={11} /> {credit.length > 0 ? 'Open another account' : 'Open credit account'}
            </button>
          )}
        </div>
        {credit.map(c => (
          <p key={c.id} className="text-xs text-gray-600">
            {N(c.balance)} / {N(c.credit_limit)} ETB owed · due {c.due_date} · <span className="capitalize">{c.status}</span>
          </p>
        ))}
        {credit.length === 0 && !openingCredit && (
          <p className="text-xs text-gray-400">No credit account.</p>
        )}
        {openingCredit && (
          <div className="mt-2">
            <OpenCreditForm
              customerId={customerId}
              onCancel={() => setOpeningCredit(false)}
              onDone={() => { setOpeningCredit(false); load() }}
            />
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Orders ({orders.length})</p>
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400">No orders yet.</p>
        ) : orders.slice(0, 10).map(o => (
          <div key={o.id} className="flex justify-between text-xs text-gray-600 py-0.5">
            <span>{o.order_number ?? 'Order'} · {o.sale_date}</span>
            <span>{N(o.paid_amount)} / {N(o.total_etb)} ETB · <span className="capitalize">{o.status?.toLowerCase()}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Customers() {
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = usePageState('customers.query', '')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const since30d = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
      const [data, ordersRes] = await Promise.all([
        fetchCustomers(),
        supabase.from('sales_orders').select('customer_id, sale_date, total_etb').not('status', 'eq', 'CANCELLED'),
      ])

      const statsByCustomer = new Map<string, { count: number; total: number; last: string | null; last30d: number }>()
      for (const o of ordersRes.data ?? []) {
        const s = statsByCustomer.get(o.customer_id) ?? { count: 0, total: 0, last: null, last30d: 0 }
        s.count += 1
        s.total += Number(o.total_etb ?? 0)
        if (!s.last || o.sale_date > s.last) s.last = o.sale_date
        if (o.sale_date >= since30d) s.last30d += 1
        statsByCustomer.set(o.customer_id, s)
      }

      setRows((data ?? []).map((r: any) => {
        const s = statsByCustomer.get(r.id)
        return {
          ...r,
          outstanding_etb: Number(r.outstanding_etb ?? 0),
          orderCount: s?.count ?? 0,
          totalSpentEtb: s?.total ?? 0,
          lastOrderDate: s?.last ?? null,
          ordersLast30d: s?.last30d ?? 0,
        }
      }))
    } catch (e) {
      console.error(e); setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() =>
    rows
      .filter(r => r.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.ordersLast30d - a.ordersLast30d || a.name.localeCompare(b.name)),
    [rows, query])

  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding_etb, 0)

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><Users size={18} /> Customers</h1>
          <p className="text-xs text-gray-400 mt-0.5">{rows.length} customers · {N(totalOutstanding)} ETB outstanding</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white flex items-center gap-1">
          {showForm ? <X size={12} /> : <Plus size={12} />} New customer
        </button>
      </div>

      {showForm && <NewCustomerForm onCancel={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}

      <div className="relative max-w-xs mb-3">
        <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customers"
          className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-full" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No customers yet.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filtered.map((c, i) => (
            <div key={c.id} className={i < filtered.length - 1 ? 'border-b border-gray-50' : ''}>
              <button
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {openId === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium">{c.name}</p>
                    {c.ordersLast30d >= 2 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-orange-600">
                        <Flame size={9} /> Frequent
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    {c.type ?? '—'} {c.phone && `· ${c.phone}`}
                    {c.orderCount > 0 && ` · ${c.orderCount} order${c.orderCount === 1 ? '' : 's'} · ${N(c.totalSpentEtb)} ETB total`}
                    {c.lastOrderDate && ` · last ${c.lastOrderDate}`}
                  </p>
                </div>
                {c.outstanding_etb > 0 && (
                  <span className="text-xs font-mono text-amber-700 shrink-0">{N(c.outstanding_etb)} ETB owed</span>
                )}
              </button>
              {openId === c.id && <CustomerDetail customerId={c.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}