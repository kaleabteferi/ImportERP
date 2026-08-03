import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Ship, Check, Loader2, AlertTriangle, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { receiveShipmentAtDjibouti, resolveAssemblyType } from '../lib/inventoryReceive'
import { fetchAliWarehouseId } from '../api/warehouseTransfers'
import { createDamageReport } from '../api/damageReports'
import { addShortageNote } from '../api/shortageNotes'
import { ReceivingCountModal, type CountLine, type CountResultLine } from '../components/ReceivingCountModal'
import { DeleteShipmentModal } from '../components/shipments/DeleteShipmentModal'
import { usePageState } from '../lib/pageState'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { SwipeToDelete } from '../components/ui/SwipeToDelete'

interface Shipment {
  id: string
  shipment_number: string
  container_number: string | null
  status: string
  eta_djibouti: string | null
  arrived_addis_date: string | null
  allocation_method: string
  company_id: string | null
  djibouti_received_at: string | null
  supplier_id: string
  suppliers: { name: string } | null
  companies: { name: string } | null
}

interface Supplier { id: string; name: string }
interface Company { id: string; name: string }

const STATUS: Record<string, { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  ORDERED:            { label: 'Ordered',       variant: 'neutral' },
  IN_PRODUCTION:      { label: 'In production', variant: 'neutral' },
  SHIPPED:            { label: 'Shipped',       variant: 'info' },
  AT_DJIBOUTI:        { label: 'At Djibouti',   variant: 'warning' },
  IN_TRANSIT:         { label: 'In transit',    variant: 'accent' },
  AT_CUSTOMS:         { label: 'At customs',    variant: 'danger' },
  WAREHOUSE_RECEIVED: { label: 'Received',      variant: 'success' },
  COMPLETED:          { label: 'Completed',     variant: 'success' },
}

const EMPTY_FORM = {
  supplier_id: '', company_id: '', container_number: '', vessel_name: '',
  etd_china: '', eta_djibouti: '', status: 'ORDERED',
  allocation_method: 'QUANTITY', notes: '',
}

export function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading]     = useState(true)
  const [open, setOpen]           = useState(false)
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [search, setSearch]           = usePageState('shipments.search', '')
  const [statusFilter, setStatusFilter] = usePageState('shipments.statusFilter', '')
  const [etaFrom, setEtaFrom]         = usePageState('shipments.etaFrom', '')
  const [etaTo, setEtaTo]             = usePageState('shipments.etaTo', '')
  const [deleteTarget, setDeleteTarget] = useState<Shipment | null>(null)
  const [notice, setNotice]           = useState<string | null>(null)
  const [djiboutiCountTarget, setDjiboutiCountTarget] = useState<{
    shipmentId: string
    lines: CountLine[]
    costById: Map<string, number | null>
  } | null>(null)
  const [djiboutiCounting, setDjiboutiCounting] = useState(false)
  const [djiboutiCountError, setDjiboutiCountError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [shRes, supRes, coRes] = await Promise.all([
      supabase.from('shipments')
        .select('id, shipment_number, container_number, status, eta_djibouti, arrived_addis_date, allocation_method, company_id, djibouti_received_at, supplier_id, suppliers(name), companies(name)')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers')
        .select('id, name').eq('is_active', true).order('name'),
      supabase.from('companies')
        .select('id, name').eq('is_active', true).order('is_primary', { ascending: false }).order('name'),
    ])
    setShipments((shRes.data ?? []).map((s: any) => ({
      ...s,
      suppliers: Array.isArray(s.suppliers) ? s.suppliers[0] ?? null : s.suppliers,
      companies: Array.isArray(s.companies) ? s.companies[0] ?? null : s.companies,
    })))
    setSuppliers(supRes.data ?? [])
    setCompanies(coRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))

  async function nextShipmentNumber(year: number): Promise<string> {
    // Best-effort: count from the DB (not the possibly-stale client list) to
    // shrink the race window. Two users creating a shipment in the same
    // instant can still collide — a DB sequence/trigger is the real fix.
    const { count } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', `${year}-01-01`)
      .lt('created_at', `${year + 1}-01-01`)
    return `SHP-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`
  }

  async function save() {
    if (!form.supplier_id) { setError('Select a supplier'); return }
    setSaving(true)
    setError(null)
    const year = new Date().getFullYear()

    let err: { message: string; code?: string } | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const num = await nextShipmentNumber(year)
      const res = await supabase.from('shipments').insert({
        shipment_number:   num,
        supplier_id:       form.supplier_id,
        company_id:        form.company_id || null,
        container_number:  form.container_number || null,
        vessel_name:       form.vessel_name || null,
        etd_china:         form.etd_china || null,
        eta_djibouti:      form.eta_djibouti || null,
        status:            form.status,
        allocation_method: form.allocation_method,
        notes:             form.notes || null,
      })
      err = res.error
      if (!err || err.code !== '23505') break // stop unless it's a unique-constraint collision
    }
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setOpen(false)
    setForm({ ...EMPTY_FORM })
    load()
  }

  async function updateStatus(id: string, status: string) {
    const shipment = shipments.find(s => s.id === id)

    // Landing at Djibouti is a truck-unload moment — count what actually
    // came off before crediting Ali's warehouse, instead of blindly posting
    // the full expected (PI) quantity. Opens a count modal instead of
    // updating the status immediately; the status change happens once the
    // count is submitted (see submitDjiboutiCount below).
    if (status === 'AT_DJIBOUTI' && shipment && !shipment.djibouti_received_at) {
      try {
        const { data: itemRows, error: itemsError } = await supabase
          .from('shipment_items')
          .select('id, product_id, quantity, unit_landed_cost_etb, products(name, sku, assembly_type, is_assembled)')
          .eq('shipment_id', id)
        if (itemsError) throw itemsError

        if (!itemRows || itemRows.length === 0) {
          // Nothing to count — fall through to a plain status update.
          await supabase.from('shipments').update({ status }).eq('id', id)
          load()
          return
        }

        const lines: CountLine[] = itemRows.map((row: any) => {
          const product = Array.isArray(row.products) ? row.products[0] : row.products
          return {
            shipmentItemId: row.id,
            productId: row.product_id,
            productName: product?.name ?? 'Unknown product',
            sku: product?.sku,
            expectedQuantity: Number(row.quantity ?? 0),
          }
        })
        const costById = new Map(itemRows.map((row: any) => [row.id, row.unit_landed_cost_etb]))
        setDjiboutiCountError(null)
        setDjiboutiCountTarget({ shipmentId: id, lines, costById })
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
      return
    }

    await supabase.from('shipments').update({ status }).eq('id', id)
    load()
  }

  async function submitDjiboutiCount(result: CountResultLine[]) {
    const target = djiboutiCountTarget
    if (!target) return
    const shipment = shipments.find(s => s.id === target.shipmentId)
    setDjiboutiCounting(true)
    setDjiboutiCountError(null)
    try {
      const { data: prodMeta } = await supabase
        .from('products')
        .select('id, assembly_type, is_assembled')
        .in('id', result.map(r => r.productId))
      const metaMap = new Map((prodMeta ?? []).map(p => [p.id, p]))
      const aliWarehouseId = await fetchAliWarehouseId()

      const toReceive = result.filter(line => line.countedQuantity > 0).map(line => ({
        shipment_item_id: line.shipmentItemId,
        product_id: line.productId,
        product_name: line.productName,
        quantity: line.countedQuantity,
        unit_landed_cost_etb: target.costById.get(line.shipmentItemId) ?? null,
        assembly_type: resolveAssemblyType(metaMap.get(line.productId) ?? {}),
      }))
      await receiveShipmentAtDjibouti(target.shipmentId, toReceive, aliWarehouseId)
      await supabase.from('shipments').update({ status: 'AT_DJIBOUTI' }).eq('id', target.shipmentId)

      const today = new Date().toISOString().split('T')[0]
      for (const line of result) {
        if (line.damagedQuantity > 0) {
          await createDamageReport({
            productId: line.productId,
            warehouseId: aliWarehouseId,
            quantity: line.damagedQuantity,
            reason: 'Damaged in transit — found during Djibouti landing count',
            shipmentId: target.shipmentId,
            reportDate: today,
            notes: line.notes || undefined,
          })
        }
        const shortQty = line.expectedQuantity - line.countedQuantity
        if (shortQty > 0 && shipment) {
          await addShortageNote({
            supplierId: shipment.supplier_id,
            productId: line.productId,
            shipmentId: target.shipmentId,
            quantityShort: shortQty,
            notes: line.notes || 'Found short at Djibouti landing count.',
          })
        }
      }

      setDjiboutiCountTarget(null)
      load()
    } catch (e: any) {
      setDjiboutiCountError(e?.message ?? String(e))
    } finally {
      setDjiboutiCounting(false)
    }
  }

  const filteredShipments = useMemo(() => shipments
    .filter(s => !statusFilter || s.status === statusFilter)
    .filter(s => !etaFrom || (s.eta_djibouti ?? '') >= etaFrom)
    .filter(s => !etaTo || (s.eta_djibouti ?? '') <= etaTo)
    .filter(s => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return s.shipment_number.toLowerCase().includes(q)
        || (s.container_number ?? '').toLowerCase().includes(q)
        || (s.suppliers?.name ?? '').toLowerCase().includes(q)
        || (s.companies?.name ?? '').toLowerCase().includes(q)
    }),
    [shipments, statusFilter, etaFrom, etaTo, search])

  const hasActiveFilters = !!(search || statusFilter || etaFrom || etaTo)
  const active    = filteredShipments.filter(s => !['COMPLETED','WAREHOUSE_RECEIVED'].includes(s.status))
  const completed = filteredShipments.filter(s =>  ['COMPLETED','WAREHOUSE_RECEIVED'].includes(s.status))

  function clearFilters() {
    setSearch(''); setStatusFilter(''); setEtaFrom(''); setEtaTo('')
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">

      <PageHeader
        title="Shipments"
        subtitle={`${active.length} active · ${completed.length} completed`}
        actions={
          <Button icon={<Plus size={13} />} onClick={() => { setOpen(true); setError(null); setForm({ ...EMPTY_FORM }) }}>
            New shipment
          </Button>
        }
      />

      {!open && error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
          <Check size={12} /> {notice}
        </div>
      )}

      {!loading && shipments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search shipment, container, supplier"
              className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-56
                         focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                       focus:outline-none focus:ring-1 focus:ring-blue-400">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            ETA
            <input type="date" value={etaFrom} onChange={e => setEtaFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <span>–</span>
            <input type="date" value={etaTo} onChange={e => setEtaTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">Clear filters</button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && shipments.length === 0 && (
        <div className="text-center py-16">
          <Ship size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No shipments yet</p>
          <p className="text-xs text-gray-400 mb-4">
            Create your first shipment to start tracking containers.
          </p>
          <Button icon={<Plus size={13} />} onClick={() => setOpen(true)} className="mx-auto">
            New shipment
          </Button>
        </div>
      )}

      {!loading && shipments.length > 0 && filteredShipments.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">No shipments match this filter.</div>
      )}

      {!loading && filteredShipments.length > 0 && (
        <div className="space-y-5">

          {/* Active */}
          {active.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                Active ({active.length})
              </p>
              <Card>
                <div className="grid grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5
                                bg-gray-50 border-b border-gray-100
                                text-xs font-medium text-gray-400 uppercase tracking-wide">
                  <div>Shipment</div>
                  <div>Container</div>
                  <div>ETA Djibouti</div>
                  <div>Status</div>
                  <div>Allocation</div>
                  <div></div>
                </div>
                {active.map((sh, i) => {
                  const st = STATUS[sh.status] ?? STATUS['ORDERED']
                  return (
                    <SwipeToDelete key={sh.id} onDelete={() => setDeleteTarget(sh)}>
                    <div
                      className={`stagger-row grid grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] gap-3
                                  px-4 py-3 items-center bg-white
                                  ${i < active.length - 1 ? 'border-b border-gray-50' : ''}`}
                      style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{sh.shipment_number}</span>
                          {sh.status === 'AT_CUSTOMS' && (
                            <AlertTriangle size={13} className="text-red-500" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {(sh.suppliers as any)?.name ?? '—'}
                          {sh.companies?.name && ` · ${sh.companies.name}`}
                        </p>
                      </div>
                      <div className="text-xs font-mono text-gray-500">
                        {sh.container_number || '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {sh.eta_djibouti ?? '—'}
                      </div>
                      <div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <div className="text-xs text-gray-400">{sh.allocation_method}</div>
                      <div className="flex items-center gap-2">
                        <select
                          value={sh.status}
                          onChange={e => updateStatus(sh.id, e.target.value)}
                          className="text-xs px-2 py-1 border border-gray-200 rounded-lg
                                     bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          {Object.entries(STATUS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <Link
                          to={`/shipments/${sh.id}`}
                          className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                                     hover:bg-gray-50 transition-colors text-gray-600
                                     whitespace-nowrap"
                        >
                          Open →
                        </Link>
                      </div>
                    </div>
                    </SwipeToDelete>
                  )
                })}
              </Card>
            </div>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                Completed ({completed.length})
              </p>
              <Card className="opacity-70">
                {completed.map((sh, i) => {
                  const st = STATUS[sh.status] ?? STATUS['COMPLETED']
                  return (
                    <SwipeToDelete key={sh.id} onDelete={() => setDeleteTarget(sh)}>
                    <div
                      className={`stagger-row grid grid-cols-[1.5fr_1.2fr_1fr_1fr_auto] gap-3
                                  px-4 py-3 items-center bg-white
                                  ${i < completed.length - 1 ? 'border-b border-gray-50' : ''}`}
                      style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                    >
                      <div>
                        <p className="text-sm font-medium">{sh.shipment_number}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {(sh.suppliers as any)?.name ?? '—'}
                          {sh.companies?.name && ` · ${sh.companies.name}`}
                        </p>
                      </div>
                      <div className="text-xs font-mono text-gray-400">
                        {sh.container_number || '—'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {sh.arrived_addis_date ?? sh.eta_djibouti ?? '—'}
                      </div>
                      <div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/shipments/${sh.id}`}
                          className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                                     hover:bg-gray-50 transition-colors text-gray-600 whitespace-nowrap"
                        >
                          Open →
                        </Link>
                      </div>
                    </div>
                    </SwipeToDelete>
                  )
                })}
              </Card>
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <DeleteShipmentModal
          shipmentId={deleteTarget.id}
          shipmentNumber={deleteTarget.shipment_number}
          status={deleteTarget.status}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={(result) => {
            setDeleteTarget(null)
            setNotice(`Deleted ${result.shipment_number} — removed ${result.deleted_items} item${result.deleted_items === 1 ? '' : 's'}, ${result.deleted_expenses} expense${result.deleted_expenses === 1 ? '' : 's'}${result.deleted_inventory_movements > 0 ? `, ${result.deleted_inventory_movements} inventory movement${result.deleted_inventory_movements === 1 ? '' : 's'}` : ''}.`)
            load()
          }}
        />
      )}

      <ReceivingCountModal
        key={djiboutiCountTarget?.shipmentId ?? 'closed'}
        open={!!djiboutiCountTarget}
        title="Count arrival at Djibouti"
        subtitle="Landing at Ali's Djibouti warehouse. Each line defaults to the expected quantity — adjust it to match what actually came off the truck."
        lines={djiboutiCountTarget?.lines ?? []}
        saving={djiboutiCounting}
        error={djiboutiCountError}
        onCancel={() => setDjiboutiCountTarget(null)}
        onSubmit={submitDjiboutiCount}
      />

      {/* Modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New shipment"
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} icon={<Check size={12} />} onClick={save} className="min-w-[130px]">
            Create shipment
          </Button>
        </>}
      >
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Supplier <span className="text-red-400">*</span>
                </label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  value={form.supplier_id}
                  onChange={e => set('supplier_id', e.target.value)}
                >
                  <option value="">— select supplier —</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {companies.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Company</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.company_id}
                    onChange={e => set('company_id', e.target.value)}
                  >
                    <option value="">— unassigned —</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Container number</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.container_number}
                    onChange={e => set('container_number', e.target.value)}
                    placeholder="e.g. CSNU4832156"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Vessel name</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.vessel_name}
                    onChange={e => set('vessel_name', e.target.value)}
                    placeholder="e.g. COSCO Shanghai"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ETD China</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.etd_china}
                    onChange={e => set('etd_china', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ETA Djibouti</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.eta_djibouti}
                    onChange={e => set('eta_djibouti', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.status}
                    onChange={e => set('status', e.target.value)}
                  >
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cost allocation</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.allocation_method}
                    onChange={e => set('allocation_method', e.target.value)}
                  >
                    <option value="QUANTITY">By quantity</option>
                    <option value="WEIGHT">By weight</option>
                    <option value="VOLUME">By volume</option>
                    <option value="VALUE">By value</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Any notes about this shipment…"
                />
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg
                                text-xs text-red-700">
                  {error}
                </div>
              )}
      </Modal>
    </div>
  )
}