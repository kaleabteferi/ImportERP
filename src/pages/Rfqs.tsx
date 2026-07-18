import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAllProducts } from '../api/bom'
import {
  fetchRfqs, fetchRfq, createRfq, deleteRfq, inviteSupplier, removeQuote, saveQuote, awardQuote,
} from '../api/rfq'
import type { RfqListRow, RfqDetail, RfqQuote } from '../api/rfq'
import { SearchableSelect } from '../components/SearchableSelect'
import {
  FileSearch, Loader2, Plus, X, Check, Trash2, ChevronLeft, Award, UserPlus,
  ExternalLink, Info,
} from 'lucide-react'

interface Option { id: string; name: string }
interface ProductOption { id: string; name: string; sku: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-50 text-blue-700',
  awarded: 'bg-green-50 text-green-700', closed: 'bg-gray-100 text-gray-500',
  invited: 'bg-gray-100 text-gray-600', quoted: 'bg-blue-50 text-blue-700', declined: 'bg-red-50 text-red-700',
}

function NewRfqForm({ products, companies, onCancel, onCreated }: {
  products: ProductOption[]; companies: Option[]; onCancel: () => void; onCreated: (id: string) => void
}) {
  const [reference, setReference] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([{ productId: '', quantity: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productOptions = products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))

  function addLine() { setLines(l => [...l, { productId: '', quantity: '' }]) }
  function removeLine(i: number) { setLines(l => l.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, patch: Partial<{ productId: string; quantity: string }>) {
    setLines(l => l.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }

  async function submit() {
    if (!reference.trim()) { setError('Give this RFQ a reference (e.g. "Q3 SKD panels restock").'); return }
    const validLines = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (validLines.length === 0) { setError('Add at least one product line with a quantity.'); return }
    setSaving(true); setError(null)
    try {
      const id = await createRfq({
        reference: reference.trim(), companyId: companyId || null, notes: notes || undefined,
        lines: validLines.map(l => ({ productId: l.productId, quantityRequested: Number(l.quantity) })),
      })
      onCreated(id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create RFQ.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Reference (e.g. Q3 SKD panels restock)"
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        {companies.length > 0 && (
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">No specific company</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">Products to source</p>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 items-center">
            <SearchableSelect className="flex-1" options={productOptions} value={line.productId}
              onChange={id => updateLine(i, { productId: id })} placeholder="Product" />
            <input type="number" value={line.quantity} onChange={e => updateLine(i, { quantity: e.target.value })}
              placeholder="Quantity" className="w-28 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <button onClick={() => removeLine(i)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={addLine} className="text-xs text-blue-600 flex items-center gap-1"><Plus size={12} /> Add product</button>
      </div>

      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg resize-none" />

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Creating…' : 'Create RFQ'}
        </button>
      </div>
    </div>
  )
}

function QuoteColumn({ quote, rfq, onChanged, onAwarded }: {
  quote: RfqQuote; rfq: RfqDetail; onChanged: () => void
  onAwarded: (result: { shipmentId: string; shipmentNumber: string; pricesNeedReview: boolean }) => void
}) {
  const [currency, setCurrency] = useState(quote.currency)
  const [paymentTerms, setPaymentTerms] = useState(quote.paymentTerms ?? '')
  const [leadTimeDays, setLeadTimeDays] = useState(quote.leadTimeDays != null ? String(quote.leadTimeDays) : '')
  const [validUntil, setValidUntil] = useState(quote.validUntil ?? '')
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(rfq.lines.map(l => [l.id, String(quote.lines.find(ql => ql.rfqLineId === l.id)?.unitPrice ?? '')]))
  )
  const [saving, setSaving] = useState(false)
  const [awarding, setAwarding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(() => rfq.lines.reduce((s, l) => s + (Number(prices[l.id]) || 0) * l.quantityRequested, 0), [prices, rfq.lines])
  const isAwarded = rfq.status === 'awarded'
  const canEdit = !isAwarded

  async function save() {
    setSaving(true); setError(null)
    try {
      await saveQuote(quote.id, {
        status: quote.status === 'invited' && Object.values(prices).some(v => Number(v) > 0) ? 'quoted' : quote.status,
        currency, paymentTerms: paymentTerms || null,
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null, validUntil: validUntil || null, notes: null,
        lines: rfq.lines.map(l => ({ rfqLineId: l.id, unitPrice: prices[l.id] ? Number(prices[l.id]) : null, moq: null })),
      })
      onChanged()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save quote.')
    } finally {
      setSaving(false)
    }
  }

  async function award() {
    if (!confirm(`Award this RFQ to ${quote.supplierName}? This creates a new Shipment pre-filled from this quote and declines every other supplier on this RFQ.`)) return
    setAwarding(true); setError(null)
    try {
      const result = await awardQuote(rfq.id, quote.id)
      onAwarded(result)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to award.')
      setAwarding(false)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${quote.supplierName} from this RFQ?`)) return
    setRemoving(true)
    try {
      await removeQuote(quote.id)
      onChanged()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove.')
      setRemoving(false)
    }
  }

  return (
    <div className={`border rounded-xl overflow-hidden shrink-0 w-64 ${quote.status === 'declined' ? 'opacity-50' : ''} ${isAwarded && quote.status !== 'declined' ? 'border-green-300' : 'border-gray-200'}`}>
      <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center justify-between gap-1">
          <p className="text-sm font-medium truncate">{quote.supplierName}</p>
          {canEdit && (
            <button onClick={remove} disabled={removing} className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={12} /></button>
          )}
        </div>
        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CLS[quote.status]}`}>{quote.status}</span>
      </div>

      <div className="p-3 space-y-2">
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <select value={currency} onChange={e => setCurrency(e.target.value)} disabled={!canEdit}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white disabled:bg-gray-50">
            <option value="USD">USD</option><option value="CNY">CNY</option><option value="ETB">ETB</option>
          </select>
          <input type="number" value={leadTimeDays} onChange={e => setLeadTimeDays(e.target.value)} disabled={!canEdit}
            placeholder="Lead days" className="px-2 py-1 text-xs border border-gray-200 rounded-lg disabled:bg-gray-50" />
        </div>
        <input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} disabled={!canEdit}
          placeholder="Payment terms" className="w-full px-2 py-1 text-xs border border-gray-200 rounded-lg disabled:bg-gray-50" />
        <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} disabled={!canEdit}
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded-lg disabled:bg-gray-50" />

        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          {rfq.lines.map(line => (
            <div key={line.id} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500 truncate flex-1" title={line.productName}>{line.productName}</span>
              <input type="number" value={prices[line.id] ?? ''} disabled={!canEdit}
                onChange={e => setPrices(p => ({ ...p, [line.id]: e.target.value }))}
                placeholder="Unit price" className="w-20 px-1.5 py-1 text-xs border border-gray-200 rounded disabled:bg-gray-50 font-mono" />
            </div>
          ))}
        </div>

        <div className="flex justify-between text-xs font-medium border-t border-gray-100 pt-2">
          <span>Est. total</span><span className="font-mono">{N(total)} {currency}</span>
        </div>

        {canEdit && (
          <div className="flex gap-1.5 pt-1">
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
            </button>
            <button onClick={award} disabled={awarding || total <= 0} title={total <= 0 ? 'Enter at least one price first' : undefined}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-green-600 text-white disabled:opacity-40">
              {awarding ? <Loader2 size={11} className="animate-spin" /> : <Award size={11} />} Award
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function RfqDetailView({ rfqId, onBack }: { rfqId: string; onBack: () => void }) {
  const [rfq, setRfq] = useState<RfqDetail | null>(null)
  const [suppliers, setSuppliers] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteId, setInviteId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [awardNotice, setAwardNotice] = useState<{ shipmentNumber: string; pricesNeedReview: boolean; shipmentId: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r, supRes] = await Promise.all([fetchRfq(rfqId), supabase.from('suppliers').select('id, name').eq('is_active', true).order('name')])
      setRfq(r)
      setSuppliers(supRes.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load RFQ.')
    } finally {
      setLoading(false)
    }
  }, [rfqId])

  useEffect(() => { load() }, [load])

  async function invite() {
    if (!inviteId) return
    setInviting(true); setError(null)
    try {
      await inviteSupplier(rfqId, inviteId)
      setInviteId('')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to invite supplier.')
    } finally {
      setInviting(false)
    }
  }

  if (loading || !rfq) {
    return <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  }

  const invitedSupplierIds = new Set(rfq.quotes.map(q => q.supplierId))
  const inviteOptions = suppliers.filter(s => !invitedSupplierIds.has(s.id)).map(s => ({ id: s.id, label: s.name }))

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
        <ChevronLeft size={13} /> Back to RFQs
      </button>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-medium">{rfq.reference}</h1>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CLS[rfq.status]}`}>{rfq.status}</span>
            {rfq.lines.length} product{rfq.lines.length === 1 ? '' : 's'} · {rfq.quotes.length} supplier{rfq.quotes.length === 1 ? '' : 's'} invited
          </p>
        </div>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {(awardNotice || rfq.awardedShipmentId) && (
        <div className="mb-4 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 flex items-start gap-2">
          <Award size={13} className="shrink-0 mt-0.5" />
          <div>
            <p>Awarded — <Link to={`/shipments/${awardNotice?.shipmentId ?? rfq.awardedShipmentId}`} className="underline font-medium inline-flex items-center gap-1">{awardNotice?.shipmentNumber ?? 'View shipment'} <ExternalLink size={11} /></Link></p>
            {awardNotice?.pricesNeedReview && <p className="mt-1 text-amber-700">Some line prices weren't in USD (or weren't set) — double-check unit prices on the shipment before finalizing costs.</p>}
          </div>
        </div>
      )}

      {rfq.notes && <p className="text-xs text-gray-500 mb-4">{rfq.notes}</p>}

      {rfq.status !== 'awarded' && (
        <div className="flex items-center gap-2 mb-4">
          <SearchableSelect className="w-64" options={inviteOptions} value="" onChange={setInviteId} placeholder="Invite a supplier…" />
          <button onClick={invite} disabled={!inviteId || inviting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
            {inviting ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Invite
          </button>
        </div>
      )}

      {rfq.quotes.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400 bg-gray-50 rounded-xl">Invite a supplier above to start collecting quotes.</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {rfq.quotes.map(q => (
            <QuoteColumn key={q.id} quote={q} rfq={rfq} onChanged={load}
              onAwarded={result => { setAwardNotice(result); load() }} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Rfqs() {
  const [rfqs, setRfqs] = useState<RfqListRow[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [companies, setCompanies] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [rfqRows, productRows, companyRows] = await Promise.all([
        fetchRfqs(), fetchAllProducts(),
        supabase.from('companies').select('id, name').eq('is_active', true).order('is_primary', { ascending: false }).order('name'),
      ])
      setRfqs(rfqRows)
      setProducts((productRows ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku })))
      setCompanies(companyRows.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load RFQs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id: string, reference: string) {
    if (!confirm(`Delete RFQ "${reference}"? This removes every invited supplier and quote on it. Any shipment already awarded from it is not affected.`)) return
    try {
      await deleteRfq(id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete.')
    }
  }

  if (activeId) {
    return <div className="p-5 max-w-5xl mx-auto"><RfqDetailView rfqId={activeId} onBack={() => { setActiveId(null); load() }} /></div>
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><FileSearch size={18} /> Supplier RFQs</h1>
          <p className="text-xs text-gray-400 mt-0.5">Collect and compare quotes from multiple suppliers before creating a shipment</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
          {showForm ? <X size={12} /> : <Plus size={12} />} New RFQ
        </button>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {showForm && <NewRfqForm products={products} companies={companies} onCancel={() => setShowForm(false)} onCreated={id => { setShowForm(false); load(); setActiveId(id) }} />}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : rfqs.length === 0 ? (
        <div className="text-center py-16">
          <FileSearch size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No RFQs yet</p>
          <p className="text-xs text-gray-400 mb-4 flex items-center gap-1.5 justify-center"><Info size={12} /> Use this when you want to compare pricing across suppliers before committing to a shipment.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Reference</div><div>Status</div><div>Products</div><div>Suppliers</div><div></div>
          </div>
          {rfqs.map((r, i) => (
            <div key={r.id} className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm cursor-pointer hover:bg-gray-50 ${i < rfqs.length - 1 ? 'border-b border-gray-50' : ''}`}
              onClick={() => setActiveId(r.id)}>
              <div>
                <p className="font-medium">{r.reference}</p>
                {r.companyName && <p className="text-xs text-gray-400">{r.companyName}</p>}
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLS[r.status]}`}>{r.status}</span>
                {r.awardedShipmentNumber && (
                  <Link to={`/shipments/${r.awardedShipmentId}`} onClick={e => e.stopPropagation()} className="ml-2 text-xs text-blue-600 hover:underline">{r.awardedShipmentNumber}</Link>
                )}
              </div>
              <div className="text-xs text-gray-500">{r.lineCount} line{r.lineCount === 1 ? '' : 's'}</div>
              <div className="text-xs text-gray-500">{r.quoteCount} invited</div>
              <div>
                {r.status !== 'awarded' && (
                  <button onClick={e => { e.stopPropagation(); remove(r.id, r.reference) }} className="p-1.5 text-gray-300 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
