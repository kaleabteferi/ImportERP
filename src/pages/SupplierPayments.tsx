import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAccounts } from '../api/accounts'
import type { Account } from '../api/accounts'
import {
  fetchSupplierPayables, fetchSupplierPayable, createSupplierPayable, deleteSupplierPayable,
  recordSupplierPayment, deleteSupplierPayment,
} from '../api/supplierPayables'
import type { SupplierPayableListRow, SupplierPayableDetail, PayableCurrency, PaymentMethod } from '../api/supplierPayables'
import { SearchableSelect } from '../components/SearchableSelect'
import {
  Landmark, Loader2, Plus, X, Check, ChevronLeft, ArrowRightLeft,
  Banknote, Building2, Receipt,
} from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SwipeToDelete } from '../components/ui/SwipeToDelete'

interface Option { id: string; name: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)
const CURRENCY_SYMBOL: Record<PayableCurrency, string> = { USD: '$', CNY: '¥', ETB: '' }
const METHOD_LABEL: Record<PaymentMethod, string> = { hawala: 'Hawala', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' }
const METHOD_VARIANT: Record<PaymentMethod, 'accent' | 'info' | 'success' | 'neutral'> = {
  hawala: 'accent', bank_transfer: 'info', cash: 'success', other: 'neutral',
}

function NewPayableForm({ suppliers, shipments, onCancel, onCreated }: {
  suppliers: Option[]; shipments: Option[]; onCancel: () => void; onCreated: (id: string) => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [shipmentId, setShipmentId] = useState('')
  const [reference, setReference] = useState('')
  const [currency, setCurrency] = useState<PayableCurrency>('USD')
  const [totalAmount, setTotalAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!supplierId) { setError('Choose a supplier.'); return }
    if (!totalAmount || Number(totalAmount) <= 0) { setError('Enter how much is owed.'); return }
    setSaving(true); setError(null)
    try {
      const id = await createSupplierPayable({
        supplierId, shipmentId: shipmentId || null, reference: reference.trim() || null,
        currency, totalAmount: Number(totalAmount), notes: notes.trim() || null,
      })
      onCreated(id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create payable.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <SearchableSelect
        options={suppliers.map(s => ({ id: s.id, label: s.name }))}
        value={supplierId} onChange={setSupplierId} placeholder="Which supplier do you owe?"
      />
      <SearchableSelect
        options={shipments.map(s => ({ id: s.id, label: s.name }))}
        value={shipmentId} onChange={setShipmentId} placeholder="Link to a shipment (optional)"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={currency} onChange={e => setCurrency(e.target.value as PayableCurrency)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="USD">USD</option><option value="CNY">CNY</option><option value="ETB">ETB</option>
        </select>
        <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} placeholder="Total owed"
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Reference (e.g. PI number, order description)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg resize-none" />
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} icon={<Check size={12} />} onClick={submit}>Create payable</Button>
      </div>
    </Card>
  )
}

function RecordPaymentForm({ payable, accounts, salesOrders, onCancel, onRecorded }: {
  payable: SupplierPayableDetail; accounts: Account[]; salesOrders: Option[]; onCancel: () => void; onRecorded: () => void
}) {
  const outstanding = payable.totalAmount - payable.paidAmount
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [method, setMethod] = useState<PaymentMethod>('hawala')
  const [amount, setAmount] = useState(String(Math.max(0, outstanding)))
  const [etbAmount, setEtbAmount] = useState('')
  const [exchangeRate, setExchangeRate] = useState('')
  const [hawalaRoute, setHawalaRoute] = useState('')
  const [accountId, setAccountId] = useState('')
  const [sourceSalesOrderId, setSourceSalesOrderId] = useState('')
  const [sourceNote, setSourceNote] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isHawala = method === 'hawala'
  const computedAmount = isHawala && Number(etbAmount) > 0 && Number(exchangeRate) > 0
    ? Number(etbAmount) / Number(exchangeRate) : null
  // Only accounts whose currency actually matches what leaves them here —
  // a hawala payment debits the ETB account that paid the dealer, anything
  // else debits an account in the payable's own currency. Picking a
  // mismatched account would silently never count against that account's
  // balance (see fetchAccountBalances), so it's not offered at all.
  const requiredCurrency = isHawala ? 'ETB' : payable.currency
  const eligibleAccounts = useMemo(() => accounts.filter(a => a.currency === requiredCurrency), [accounts, requiredCurrency])
  useEffect(() => {
    if (accountId && !eligibleAccounts.some(a => a.id === accountId)) setAccountId('')
  }, [eligibleAccounts, accountId])

  async function submit() {
    const finalAmount = isHawala ? computedAmount : Number(amount)
    if (!finalAmount || finalAmount <= 0) {
      setError(isHawala ? 'Enter the ETB paid and the exchange rate used.' : 'Enter an amount greater than 0.')
      return
    }
    if (!accountId) { setError('Choose which account/cash pool the money came out of.'); return }
    setSaving(true); setError(null)
    try {
      await recordSupplierPayment(payable.id, {
        paymentDate, method, amount: Math.round(finalAmount * 100) / 100,
        accountId, sourceSalesOrderId: sourceSalesOrderId || null, sourceNote: sourceNote.trim() || null,
        hawalaRoute: isHawala ? (hawalaRoute.trim() || null) : null,
        etbAmount: isHawala ? Number(etbAmount) : null,
        exchangeRate: isHawala ? Number(exchangeRate) : null,
        reference: reference.trim() || null, notes: notes.trim() || null,
      })
      onRecorded()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-3">
      <p className="text-sm font-medium flex items-center gap-1.5"><Banknote size={14} className="text-blue-600" /> Record a payment</p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="hawala">Hawala</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>

      {isHawala ? (
        <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-3 space-y-2">
          <input value={hawalaRoute} onChange={e => setHawalaRoute(e.target.value)} placeholder="Hawala dealer / route (e.g. Ahmed - Merkato to Guangzhou)"
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={etbAmount} onChange={e => setEtbAmount(e.target.value)} placeholder="ETB paid to dealer"
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} placeholder={`Rate (ETB per 1 ${payable.currency})`}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          </div>
          <p className="text-xs text-purple-700">
            {computedAmount != null
              ? <>Supplier receives ≈ <span className="font-mono font-medium">{CURRENCY_SYMBOL[payable.currency]}{N(computedAmount)} {payable.currency}</span></>
              : 'Enter ETB paid and the rate to see how much reaches the supplier.'}
          </p>
        </div>
      ) : (
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Amount (${payable.currency})`}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      )}

      <div>
        <p className="text-xs text-gray-500 mb-1">Where did the money come from? ({requiredCurrency} accounts only)</p>
        <SearchableSelect
          options={eligibleAccounts.map(a => ({ id: a.id, label: a.name, sublabel: a.type }))}
          value={accountId} onChange={setAccountId}
          placeholder={eligibleAccounts.length > 0 ? `Which ${requiredCurrency} account / cash pool paid it?` : `No ${requiredCurrency} account set up yet`}
          disabled={eligibleAccounts.length === 0}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SearchableSelect
          options={salesOrders.map(o => ({ id: o.id, label: o.name }))}
          value={sourceSalesOrderId} onChange={setSourceSalesOrderId} placeholder="Funded by this sale (optional)"
        />
        <input value={sourceNote} onChange={e => setSourceNote(e.target.value)} placeholder="Or a note (e.g. collected cash)"
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Reference / receipt number (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} icon={<Check size={12} />} onClick={submit}>Record payment</Button>
      </div>
    </Card>
  )
}

function PayableDetailView({ payableId, onBack }: { payableId: string; onBack: () => void }) {
  const [payable, setPayable] = useState<SupplierPayableDetail | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [salesOrders, setSalesOrders] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [p, accountRows, orderRes] = await Promise.all([
        fetchSupplierPayable(payableId),
        fetchAccounts(),
        supabase.from('sales_orders').select('id, order_number').order('created_at', { ascending: false }).limit(200),
      ])
      setPayable(p)
      setAccounts(accountRows)
      setSalesOrders((orderRes.data ?? []).map((o: any) => ({ id: o.id, name: o.order_number })))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [payableId])

  useEffect(() => { load() }, [load])

  async function removePayment(id: string) {
    if (!confirm('Delete this payment? The outstanding balance will go back up.')) return
    try {
      await deleteSupplierPayment(id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete payment.')
    }
  }

  if (loading || !payable) {
    return <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  }

  const outstanding = payable.totalAmount - payable.paidAmount
  const sym = CURRENCY_SYMBOL[payable.currency]

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
        <ChevronLeft size={13} /> Back to supplier payments
      </button>

      <PageHeader
        title={payable.supplierName}
        subtitle={`${payable.reference ?? 'No reference'}${payable.shipmentNumber ? ` · ${payable.shipmentNumber}` : ''}`}
        actions={outstanding > 0.005 && (
          <Button icon={showForm ? <X size={12} /> : <Plus size={12} />} onClick={() => setShowForm(v => !v)}>{showForm ? 'Cancel' : 'Record payment'}</Button>
        )}
      />

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Total owed" value={`${sym}${N(payable.totalAmount)} ${payable.currency}`} />
        <StatCard label="Paid so far" value={<span className="text-green-700">{sym}{N(payable.paidAmount)}</span>} />
        <StatCard label="Outstanding" value={<span className={outstanding > 0.005 ? 'text-red-700' : 'text-gray-400'}>{sym}{N(Math.max(0, outstanding))}</span>} />
      </div>

      {payable.notes && <p className="text-xs text-gray-500 mb-4">{payable.notes}</p>}

      {showForm && (
        <RecordPaymentForm payable={payable} accounts={accounts} salesOrders={salesOrders}
          onCancel={() => setShowForm(false)} onRecorded={() => { setShowForm(false); load() }} />
      )}

      <p className="text-xs font-medium text-gray-500 mb-2">Payment history</p>
      {payable.payments.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400 bg-gray-50 rounded-card">No payments recorded yet.</div>
      ) : (
        <Card>
          {payable.payments.map((p, i) => (
            <SwipeToDelete key={p.id} onDelete={() => removePayment(p.id)}>
            <div className={`px-4 py-3 bg-inherit ${i < payable.payments.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-gray-400 w-24">{p.paymentDate}</span>
                <Badge variant={METHOD_VARIANT[p.method]}>{METHOD_LABEL[p.method]}</Badge>
                <span className="flex-1 text-sm font-mono font-medium">{sym}{N(p.amount)} {payable.currency}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                {p.method === 'hawala' && p.hawalaRoute && <span className="flex items-center gap-1"><ArrowRightLeft size={11} /> {p.hawalaRoute}</span>}
                {p.method === 'hawala' && p.etbAmount != null && p.exchangeRate != null && (
                  <span>{N(p.etbAmount)} ETB @ {N(p.exchangeRate)}</span>
                )}
                {p.accountName && <span className="flex items-center gap-1"><Building2 size={11} /> {p.accountName}</span>}
                {p.sourceSalesOrderNumber && <span>from sale {p.sourceSalesOrderNumber}</span>}
                {p.sourceNote && <span>{p.sourceNote}</span>}
                {p.reference && <span className="flex items-center gap-1"><Receipt size={11} /> {p.reference}</span>}
              </div>
              {p.notes && <p className="mt-1 text-xs text-gray-400 italic">{p.notes}</p>}
            </div>
            </SwipeToDelete>
          ))}
        </Card>
      )}
    </div>
  )
}

export function SupplierPayments() {
  const [payables, setPayables] = useState<SupplierPayableListRow[]>([])
  const [suppliers, setSuppliers] = useState<Option[]>([])
  const [shipments, setShipments] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [payableRows, supplierRes, shipmentRes] = await Promise.all([
        fetchSupplierPayables(),
        supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
        supabase.from('shipments').select('id, shipment_number').order('created_at', { ascending: false }).limit(200),
      ])
      setPayables(payableRows)
      setSuppliers((supplierRes.data ?? []).map((s: any) => ({ id: s.id, name: s.name })))
      setShipments((shipmentRes.data ?? []).map((s: any) => ({ id: s.id, name: s.shipment_number })))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load supplier payments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id: string, name: string) {
    if (!confirm(`Delete this payable for ${name}? This also deletes every payment recorded against it.`)) return
    try {
      await deleteSupplierPayable(id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete.')
    }
  }

  const totals = useMemo(() => {
    const byCurrency: Record<PayableCurrency, number> = { USD: 0, CNY: 0, ETB: 0 }
    for (const p of payables) byCurrency[p.currency] += Math.max(0, p.totalAmount - p.paidAmount)
    return byCurrency
  }, [payables])

  if (activeId) {
    return <div className="p-5 max-w-4xl mx-auto"><PayableDetailView payableId={activeId} onBack={() => { setActiveId(null); load() }} /></div>
  }

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <PageHeader
        icon={<Landmark size={18} />}
        title="Supplier Payments"
        subtitle="What you owe each supplier for goods, and every hawala/bank/cash payment made against it"
        actions={<Button icon={showForm ? <X size={12} /> : <Plus size={12} />} onClick={() => setShowForm(v => !v)}>New payable</Button>}
      />

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {showForm && <NewPayableForm suppliers={suppliers} shipments={shipments} onCancel={() => setShowForm(false)} onCreated={id => { setShowForm(false); load(); setActiveId(id) }} />}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Outstanding (USD)" value={<span className="text-red-700">${N(totals.USD)}</span>} />
        <StatCard label="Outstanding (CNY)" value={<span className="text-red-700">¥{N(totals.CNY)}</span>} />
        <StatCard label="Outstanding (ETB)" value={<span className="text-red-700">{N(totals.ETB)}</span>} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : payables.length === 0 ? (
        <div className="text-center py-16">
          <Landmark size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No supplier payables yet</p>
          <p className="text-xs text-gray-400">Add one above whenever you owe a supplier — for a shipment, a combined order, or an open credit line.</p>
        </div>
      ) : (
        <Card>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Supplier</div><div>Total</div><div>Paid</div><div>Outstanding</div>
          </div>
          {payables.map((p, i) => {
            const outstanding = p.totalAmount - p.paidAmount
            const sym = CURRENCY_SYMBOL[p.currency]
            return (
              <SwipeToDelete key={p.id} onDelete={() => remove(p.id, p.supplierName)}>
              <div className={`stagger-row grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-4 py-3 items-center text-sm cursor-pointer hover:bg-gray-50 bg-inherit ${i < payables.length - 1 ? 'border-b border-gray-50' : ''}`}
                style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                onClick={() => setActiveId(p.id)}>
                <div>
                  <p className="font-medium">{p.supplierName}</p>
                  <p className="text-xs text-gray-400">{p.reference ?? '—'}{p.shipmentNumber && ` · ${p.shipmentNumber}`}</p>
                </div>
                <div className="text-xs font-mono text-gray-500">{sym}{N(p.totalAmount)}</div>
                <div className="text-xs font-mono text-green-700">{sym}{N(p.paidAmount)}</div>
                <div className={`text-xs font-mono font-medium ${outstanding > 0.005 ? 'text-red-700' : 'text-gray-400'}`}>{sym}{N(Math.max(0, outstanding))}</div>
              </div>
              </SwipeToDelete>
            )
          })}
        </Card>
      )}
    </div>
  )
}
