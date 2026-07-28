// src/pages/ProformaInvoices.tsx
import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Plus, FileText, X, Check, Loader2, Search, AlertOctagon } from 'lucide-react'
import { usePageState } from '../lib/pageState'
import { nextPiNumber, createProformaInvoice } from '../api/proformaInvoices'
import { listOpenShortageNotes, resolveShortageNote } from '../api/shortageNotes'
import type { ShortageNote } from '../api/shortageNotes'

interface Row {
  id: string
  pi_number: string
  issue_date: string
  incoterm: string
  status: string
  suppliers: { name: string } | null
  buyer_company: { name: string } | null
  final_company: { name: string } | null
  containers: { id: string }[]
}

interface Supplier { id: string; name: string }
interface Company { id: string; name: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-blue-50 text-blue-700' },
  COMPLETED: { label: 'Completed', cls: 'bg-green-50 text-green-700' },
}

const EMPTY_FORM = {
  supplier_id: '', issue_date: new Date().toISOString().slice(0, 10),
  incoterm: 'FOB', port_of_loading: '', port_of_discharge: 'Djibouti',
  buyer_company_id: '', final_company_id: '', markup_pct: '',
}

export function ProformaInvoices() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = usePageState('proformaInvoices.search', '')
  const [shortages, setShortages] = useState<ShortageNote[]>([])
  const [loadingShortages, setLoadingShortages] = useState(false)

  async function load() {
    setLoading(true)
    const [piRes, supRes, coRes] = await Promise.all([
      supabase.from('proforma_invoices')
        .select('id, pi_number, issue_date, incoterm, status, suppliers(name), buyer_company:buyer_company_id(name), final_company:final_company_id(name), containers(id)')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase.from('companies').select('id, name').eq('is_active', true).order('is_primary', { ascending: false }).order('name'),
    ])
    setRows(((piRes.data ?? []) as any[]).map(r => ({
      ...r,
      suppliers: Array.isArray(r.suppliers) ? r.suppliers[0] ?? null : r.suppliers,
      buyer_company: Array.isArray(r.buyer_company) ? r.buyer_company[0] ?? null : r.buyer_company,
      final_company: Array.isArray(r.final_company) ? r.final_company[0] ?? null : r.final_company,
    })))
    setSuppliers(supRes.data ?? [])
    setCompanies(coRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))

  async function save() {
    if (!form.supplier_id) { setError('Select a supplier'); return }
    if (!form.final_company_id) { setError('Select which company this order is ultimately for'); return }
    setSaving(true)
    setError(null)
    try {
      const piNumber = await nextPiNumber()
      const id = await createProformaInvoice({
        pi_number: piNumber,
        supplier_id: form.supplier_id,
        issue_date: form.issue_date,
        incoterm: form.incoterm,
        port_of_loading: form.port_of_loading || null,
        port_of_discharge: form.port_of_discharge || null,
        buyer_company_id: form.buyer_company_id || form.final_company_id,
        final_company_id: form.final_company_id,
        markup_pct: form.markup_pct ? parseFloat(form.markup_pct) : null,
      })
      setOpen(false)
      setForm({ ...EMPTY_FORM })
      navigate(`/proforma-invoices/${id}`)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setSaving(false)
    }
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return r.pi_number.toLowerCase().includes(q) || (r.suppliers?.name ?? '').toLowerCase().includes(q)
  }), [rows, search])

  const alphaRouted = (r: Row) => r.buyer_company && r.final_company && r.buyer_company.name !== r.final_company.name

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Proforma Invoices</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {rows.length} order{rows.length === 1 ? '' : 's'} · split each into containers below
          </p>
        </div>
        <button
          onClick={() => { setOpen(true); setError(null); setForm({ ...EMPTY_FORM }); setShortages([]) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> New proforma invoice
        </button>
      </div>

      {!loading && rows.length > 0 && (
        <div className="mb-4 relative w-64">
          <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search PI number, supplier"
            className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-16">
          <FileText size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No proforma invoices yet</p>
          <p className="text-xs text-gray-400 mb-4">
            Start here before creating containers/shipments — a PI can now split across multiple containers.
          </p>
          <button onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={13} /> New proforma invoice
          </button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>PI number</div>
            <div>Supplier</div>
            <div>Routing</div>
            <div>Issue date</div>
            <div>Containers</div>
            <div>Status</div>
          </div>
          {filtered.map((r, i) => (
            <Link
              key={r.id}
              to={`/proforma-invoices/${r.id}`}
              className={`grid grid-cols-[1.3fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-4 py-3 items-center hover:bg-gray-50/50 transition-colors ${i < filtered.length - 1 ? 'border-b border-gray-50' : ''}`}
            >
              <div className="text-sm font-medium">{r.pi_number}</div>
              <div className="text-xs text-gray-500">{r.suppliers?.name ?? '—'}</div>
              <div className="text-xs text-gray-500">
                {alphaRouted(r)
                  ? <span>{r.buyer_company?.name} → {r.final_company?.name}</span>
                  : <span>{r.final_company?.name ?? '—'}</span>}
              </div>
              <div className="text-xs text-gray-500">{r.issue_date}</div>
              <div className="text-xs text-gray-500">{r.containers?.length ?? 0}</div>
              <div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS[r.status]?.cls ?? STATUS.DRAFT.cls}`}>
                  {STATUS[r.status]?.label ?? r.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">New proforma invoice</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Supplier <span className="text-red-400">*</span></label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  value={form.supplier_id} onChange={async e => {
                    const supplierId = e.target.value
                    set('supplier_id', supplierId)
                    setShortages([])
                    if (!supplierId) return
                    setLoadingShortages(true)
                    try {
                      setShortages(await listOpenShortageNotes(supplierId))
                    } finally {
                      setLoadingShortages(false)
                    }
                  }}>
                  <option value="">— select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {loadingShortages && (
                <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Checking for outstanding shortages…</div>
              )}
              {shortages.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                    <AlertOctagon size={13} /> Outstanding shortages from previous orders with this supplier
                  </p>
                  {shortages.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-2.5 py-1.5 border border-amber-100">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-700 truncate">
                          {(s as any).products?.name ?? 'Unspecified item'}
                          {s.quantity_short != null && ` — short by ${s.quantity_short}`}
                        </p>
                        {s.notes && <p className="text-gray-400 truncate">{s.notes}</p>}
                      </div>
                      <button
                        onClick={async () => { await resolveShortageNote(s.id); setShortages(prev => prev.filter(x => x.id !== s.id)) }}
                        className="shrink-0 text-xs px-2 py-1 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        Added — resolve
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Buyer of record</label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.buyer_company_id} onChange={e => set('buyer_company_id', e.target.value)}>
                    <option value="">— same as final company —</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Who buys from the real supplier — pick ALPHA if it's routed through them.</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Final company <span className="text-red-400">*</span></label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.final_company_id} onChange={e => set('final_company_id', e.target.value)}>
                    <option value="">— select company —</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Who the stock is ultimately for — can change until Djibouti arrival.</p>
                </div>
              </div>

              {form.buyer_company_id && form.buyer_company_id !== form.final_company_id && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Markup % (buyer → final company)</label>
                  <input type="number" step="0.1"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.markup_pct} onChange={e => set('markup_pct', e.target.value)}
                    placeholder="e.g. 10" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Issue date</label>
                  <input type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Incoterm</label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.incoterm} onChange={e => set('incoterm', e.target.value)}>
                    <option value="FOB">FOB</option>
                    <option value="CIF">CIF</option>
                    <option value="EXW">EXW</option>
                    <option value="CFR">CFR</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Port of loading</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.port_of_loading} onChange={e => set('port_of_loading', e.target.value)} placeholder="e.g. Shenzhen" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Port of discharge</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.port_of_discharge} onChange={e => set('port_of_discharge', e.target.value)} />
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors min-w-[130px] justify-center">
                {saving ? <><Loader2 size={12} className="animate-spin" /> Creating…</> : <><Check size={12} /> Create & continue</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
