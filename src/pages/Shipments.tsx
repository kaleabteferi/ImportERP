import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Ship, X, Check, Loader2, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Shipment {
  id: string
  shipment_number: string
  container_number: string | null
  status: string
  eta_djibouti: string | null
  arrived_addis_date: string | null
  allocation_method: string
  suppliers: { name: string } | null
}

interface Supplier { id: string; name: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  ORDERED:            { label: 'Ordered',       cls: 'bg-gray-100 text-gray-600'   },
  IN_PRODUCTION:      { label: 'In production', cls: 'bg-gray-100 text-gray-600'   },
  SHIPPED:            { label: 'Shipped',       cls: 'bg-blue-50 text-blue-700'    },
  AT_DJIBOUTI:        { label: 'At Djibouti',  cls: 'bg-amber-50 text-amber-700'  },
  IN_TRANSIT:         { label: 'In transit',    cls: 'bg-purple-50 text-purple-700'},
  AT_CUSTOMS:         { label: 'At customs',    cls: 'bg-red-50 text-red-700'      },
  WAREHOUSE_RECEIVED: { label: 'Received',      cls: 'bg-green-50 text-green-700'  },
  COMPLETED:          { label: 'Completed',     cls: 'bg-green-50 text-green-700'  },
}

const EMPTY_FORM = {
  supplier_id: '', container_number: '', vessel_name: '',
  etd_china: '', eta_djibouti: '', status: 'ORDERED',
  allocation_method: 'QUANTITY', notes: '',
}

export function Shipments() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading]     = useState(true)
  const [open, setOpen]           = useState(false)
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [shRes, supRes] = await Promise.all([
      supabase.from('shipments')
        .select('id, shipment_number, container_number, status, eta_djibouti, arrived_addis_date, allocation_method, suppliers(name)')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers')
        .select('id, name').eq('is_active', true).order('name'),
    ])
    setShipments((shRes.data ?? []).map(s => ({
      ...s,
      suppliers: Array.isArray(s.suppliers) ? s.suppliers[0] ?? null : s.suppliers,
    })))
    setSuppliers(supRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }))

  async function save() {
    if (!form.supplier_id) { setError('Select a supplier'); return }
    setSaving(true)
    setError(null)
    const year  = new Date().getFullYear()
    const count = shipments.length + 1
    const num   = `SHP-${year}-${String(count).padStart(3, '0')}`

    const { error: err } = await supabase.from('shipments').insert({
      shipment_number:   num,
      supplier_id:       form.supplier_id,
      container_number:  form.container_number || null,
      vessel_name:       form.vessel_name || null,
      etd_china:         form.etd_china || null,
      eta_djibouti:      form.eta_djibouti || null,
      status:            form.status,
      allocation_method: form.allocation_method,
      notes:             form.notes || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setOpen(false)
    setForm({ ...EMPTY_FORM })
    load()
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('shipments').update({ status }).eq('id', id)
    load()
  }

  const active    = shipments.filter(s => !['COMPLETED','WAREHOUSE_RECEIVED'].includes(s.status))
  const completed = shipments.filter(s =>  ['COMPLETED','WAREHOUSE_RECEIVED'].includes(s.status))

  return (
    <div className="p-5 max-w-5xl mx-auto">

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Shipments</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {active.length} active · {completed.length} completed
          </p>
        </div>
        <button
          onClick={() => { setOpen(true); setError(null); setForm({ ...EMPTY_FORM }) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                     text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> New shipment
        </button>
      </div>

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
          <button onClick={() => setOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                             text-white text-xs rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={13} /> New shipment
          </button>
        </div>
      )}

      {!loading && shipments.length > 0 && (
        <div className="space-y-5">

          {/* Active */}
          {active.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                Active ({active.length})
              </p>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
                    <div
                      key={sh.id}
                      className={`grid grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] gap-3
                                  px-4 py-3 items-center
                                  ${i < active.length - 1 ? 'border-b border-gray-50' : ''}`}
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
                        </p>
                      </div>
                      <div className="text-xs font-mono text-gray-500">
                        {sh.container_number || '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {sh.eta_djibouti ?? '—'}
                      </div>
                      <div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full
                                          text-xs font-medium ${st.cls}`}>
                          {st.label}
                        </span>
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
                  )
                })}
              </div>
            </div>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                Completed ({completed.length})
              </p>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden opacity-70">
                {completed.map((sh, i) => {
                  const st = STATUS[sh.status] ?? STATUS['COMPLETED']
                  return (
                    <div
                      key={sh.id}
                      className={`grid grid-cols-[1.5fr_1.2fr_1fr_1fr_auto] gap-3
                                  px-4 py-3 items-center
                                  ${i < completed.length - 1 ? 'border-b border-gray-50' : ''}`}
                    >
                      <div>
                        <p className="text-sm font-medium">{sh.shipment_number}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {(sh.suppliers as any)?.name ?? '—'}
                        </p>
                      </div>
                      <div className="text-xs font-mono text-gray-400">
                        {sh.container_number || '—'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {sh.arrived_addis_date ?? sh.eta_djibouti ?? '—'}
                      </div>
                      <div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full
                                          text-xs font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      <Link
                        to={`/shipments/${sh.id}`}
                        className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                                   hover:bg-gray-50 transition-colors text-gray-600"
                      >
                        Open →
                      </Link>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh]
                          overflow-auto shadow-xl">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">New shipment</h2>
              <button onClick={() => setOpen(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">

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
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4
                            border-t border-gray-100">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                           transition-colors min-w-[130px] justify-center"
              >
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> Create shipment</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}