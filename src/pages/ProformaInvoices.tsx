// src/pages/ProformaInvoices.tsx
import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Plus, FileText, Check, Loader2, Search, AlertOctagon, Boxes, CircleDollarSign, ArrowUpRight, Ship, SlidersHorizontal } from 'lucide-react'
import { usePageState } from '../lib/pageState'
import { nextPiNumber, createProformaInvoice } from '../api/proformaInvoices'
import { listOpenShortageNotes, resolveShortageNote } from '../api/shortageNotes'
import type { ShortageNote } from '../api/shortageNotes'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { SelectMenu } from '../components/ui/SelectMenu'
import './ProformaInvoices.css'

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
  pi_items: { quantity: number; total_price: number | null }[]
}

interface Supplier { id: string; name: string }
interface Company { id: string; name: string }

const STATUS: Record<string, { label: string; variant: 'neutral' | 'info' | 'success' }> = {
  DRAFT:     { label: 'Draft',     variant: 'neutral' },
  CONFIRMED: { label: 'Confirmed', variant: 'info' },
  COMPLETED: { label: 'Completed', variant: 'success' },
}
// A ledger feel distinct from the app's usual stacked-card lists — a
// status-colored rail down the left of each row.
const STATUS_RAIL: Record<string, string> = {
  DRAFT: 'border-l-gray-300', CONFIRMED: 'border-l-blue-400', COMPLETED: 'border-l-green-400',
}

const EMPTY_FORM = {
  supplier_id: '', issue_date: new Date().toISOString().slice(0, 10),
  incoterm: 'FOB', port_of_loading: '', port_of_discharge: 'Djibouti',
  buyer_company_id: '', final_company_id: '', markup_pct: '', validity_date: '', payment_terms: '', notes: '',
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
  const [statusFilter, setStatusFilter] = usePageState('proformaInvoices.status', 'ALL')
  const [sortBy, setSortBy] = usePageState<'newest' | 'oldest' | 'value'>('proformaInvoices.sort', 'newest')
  const [shortages, setShortages] = useState<ShortageNote[]>([])
  const [loadingShortages, setLoadingShortages] = useState(false)

  async function load() {
    setLoading(true)
    const [piRes, supRes, coRes] = await Promise.all([
      supabase.from('proforma_invoices')
        .select('id, pi_number, issue_date, incoterm, status, suppliers(name), buyer_company:buyer_company_id(name), final_company:final_company_id(name), containers(id), pi_items(quantity, total_price)')
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
        validity_date: form.validity_date || null,
        payment_terms: form.payment_terms || null,
        notes: form.notes || null,
      })
      setOpen(false)
      setForm({ ...EMPTY_FORM })
      navigate(`/proforma-invoices/${id}`)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setSaving(false)
    }
  }

  const rowValue = (row: Row) => row.pi_items.reduce((sum, item) => sum + Number(item.total_price ?? 0), 0)
  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return r.pi_number.toLowerCase().includes(q) || (r.suppliers?.name ?? '').toLowerCase().includes(q)
  }).sort((left, right) => sortBy === 'value' ? rowValue(right) - rowValue(left) : sortBy === 'oldest' ? left.issue_date.localeCompare(right.issue_date) : right.issue_date.localeCompare(left.issue_date)), [rows, search, sortBy, statusFilter])

  const alphaRouted = (r: Row) => r.buyer_company && r.final_company && r.buyer_company.name !== r.final_company.name

  return (
    <div className="proforma-hub p-5 max-w-7xl mx-auto">
      <section className="proforma-hero">
      <PageHeader
        title="Proforma Invoices"
        subtitle="Build the commercial order, classify every line, then allocate cartons into shipment-ready containers."
        actions={
          <Button icon={<Plus size={13} />} onClick={() => { setOpen(true); setError(null); setForm({ ...EMPTY_FORM }); setShortages([]) }}>
            New proforma invoice
          </Button>
        }
      />
      <div className="proforma-hero-flow"><span className="active"><b>1</b>Invoice terms</span><i /><span><b>2</b>Line items</span><i /><span><b>3</b>Container plan</span><i /><span><b>4</b>Shipment</span></div>
      </section>

      {!loading && <section className="proforma-kpis"><article><i><FileText /></i><span>Active proformas<strong>{rows.filter(row => row.status !== 'COMPLETED').length}</strong><small>{rows.filter(row => row.status === 'DRAFT').length} still in draft</small></span></article><article><i><CircleDollarSign /></i><span>Quoted value<strong>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(rows.reduce((sum, row) => sum + rowValue(row), 0))}</strong><small>Across entered PI lines</small></span></article><article><i><Boxes /></i><span>Containers planned<strong>{rows.reduce((sum, row) => sum + (row.containers?.length ?? 0), 0)}</strong><small>Physical loading units</small></span></article><article><i><Ship /></i><span>Ready workflow<strong>{rows.filter(row => row.pi_items.length && row.containers.length).length}</strong><small>Have lines and containers</small></span></article></section>}

      {!loading && rows.length > 0 && (
        <div className="proforma-filterbar">
          <div className="proforma-search"><Search size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search PI number or supplier" /></div><div className="proforma-filter"><SlidersHorizontal size={14} /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Confirmed</option><option value="COMPLETED">Completed</option></select></div><select value={sortBy} onChange={event => setSortBy(event.target.value as 'newest' | 'oldest' | 'value')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="value">Highest value</option></select><span>{filtered.length} records</span>
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
          <Button icon={<Plus size={13} />} onClick={() => setOpen(true)} className="mx-auto">
            New proforma invoice
          </Button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <Card className="proforma-register">
          <div className="proforma-register-head"><div>Proforma / supplier</div><div>Commercial route</div><div>Order value</div><div>Load plan</div><div>Status</div></div>
          {filtered.map((r, i) => (
            <Link
              key={r.id}
              to={`/proforma-invoices/${r.id}`}
              className={`proforma-register-row stagger-row ${STATUS_RAIL[r.status] ?? 'border-l-gray-200'}`}
              style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
            >
              <div className="proforma-identity"><i><FileText /></i><span><strong>{r.pi_number}</strong><small>{r.suppliers?.name ?? 'Supplier not assigned'} · {r.issue_date}</small></span></div>
              <div className="proforma-route">
                {alphaRouted(r)
                  ? <span>{r.buyer_company?.name} → {r.final_company?.name}</span>
                  : <span>{r.final_company?.name ?? '—'}</span>}
              </div>
              <div className="proforma-value"><strong>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(rowValue(r))}</strong><small>{r.pi_items.length} line{r.pi_items.length === 1 ? '' : 's'}</small></div>
              <div className="proforma-load"><Boxes /><span><strong>{r.containers?.length ?? 0} containers</strong><small>{r.incoterm} · {r.pi_items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0).toLocaleString()} units</small></span></div>
              <div className="proforma-row-end">
                <Badge variant={STATUS[r.status]?.variant ?? 'neutral'}>
                  {STATUS[r.status]?.label ?? r.status}
                </Badge>
                <ArrowUpRight size={15} />
              </div>
            </Link>
          ))}
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New proforma invoice"
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} icon={<Check size={12} />} onClick={save} className="min-w-[130px]">
            Create & continue
          </Button>
        </>}
      >
              <div className="pi-create-intro"><i><FileText /></i><div><strong>Start with the supplier’s commercial terms</strong><span>The next screen adds HS-coded line items and allocates cartons into containers.</span></div></div>
              <div className="pi-create-section"><h3>Trade parties</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Supplier <span className="text-red-400">*</span></label>
                <SelectMenu
                  ariaLabel="Supplier"
                  searchable
                  value={form.supplier_id}
                  onChange={async supplierId => {
                    set('supplier_id', supplierId)
                    setShortages([])
                    if (!supplierId) return
                    setLoadingShortages(true)
                    try {
                      setShortages(await listOpenShortageNotes(supplierId))
                    } finally {
                      setLoadingShortages(false)
                    }
                  }}
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  placeholder="— select supplier —"
                />
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
                  <SelectMenu
                    ariaLabel="Buyer of record"
                    searchable
                    value={form.buyer_company_id}
                    onChange={value => set('buyer_company_id', value)}
                    options={companies.map(c => ({ value: c.id, label: c.name }))}
                    placeholder="— same as final company —"
                  />
                  <p className="text-xs text-gray-400 mt-1">Who buys from the real supplier — pick ALPHA if it's routed through them.</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Final company <span className="text-red-400">*</span></label>
                  <SelectMenu
                    ariaLabel="Final company"
                    searchable
                    value={form.final_company_id}
                    onChange={value => set('final_company_id', value)}
                    options={companies.map(c => ({ value: c.id, label: c.name }))}
                    placeholder="— select company —"
                  />
                  <p className="text-xs text-gray-400 mt-1">Who the stock is ultimately for — can change until Djibouti arrival.</p>
                </div>
              </div>

              {form.buyer_company_id && form.buyer_company_id !== form.final_company_id && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Markup % (buyer → final company)</label>
                  <input type="number" step="0.1"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={form.markup_pct} onChange={e => set('markup_pct', e.target.value)}
                    placeholder="e.g. 10" />
                </div>
              )}

              </div><div className="pi-create-section"><h3>Dates and commercial terms</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Issue date</label>
                  <input type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Incoterm</label>
                  <SelectMenu
                    ariaLabel="Incoterm"
                    value={form.incoterm}
                    onChange={value => set('incoterm', value)}
                    options={[
                      { value: 'FOB', label: 'FOB' },
                      { value: 'CIF', label: 'CIF' },
                      { value: 'EXW', label: 'EXW' },
                      { value: 'CFR', label: 'CFR' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-gray-500 mb-1">Valid until</label><input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" value={form.validity_date} onChange={event => set('validity_date', event.target.value)} /></div><div><label className="block text-xs text-gray-500 mb-1">Payment terms</label><input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" value={form.payment_terms} onChange={event => set('payment_terms', event.target.value)} placeholder="e.g. 30% deposit, 70% before shipment" /></div></div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Port of loading</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={form.port_of_loading} onChange={e => set('port_of_loading', e.target.value)} placeholder="e.g. Shenzhen" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Port of discharge</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={form.port_of_discharge} onChange={e => set('port_of_discharge', e.target.value)} />
                </div>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">Commercial notes</label><textarea rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" value={form.notes} onChange={event => set('notes', event.target.value)} placeholder="Quality requirements, document instructions, inspection or delivery conditions" /></div>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
              )}
      </Modal>
    </div>
  )
}
