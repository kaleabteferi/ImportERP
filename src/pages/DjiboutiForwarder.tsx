import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchWarehousesList } from '../api/income'
import { fetchAllProducts } from '../api/bom'
import { fetchEmployeesList } from '../api/companyExpenses'
import {
  fetchAliStock, fetchWarehouseTransfers, createDjiboutiRequest,
  recordDjiboutiDispatch, confirmDjiboutiReceipt, cancelWarehouseTransfer,
} from '../api/warehouseTransfers'
import type { WarehouseTransfer, AliStockRow } from '../api/warehouseTransfers'
import {
  Truck, Loader2, Plus, X, AlertTriangle, CheckCircle2, Package, Ship,
} from 'lucide-react'

interface Option { id: string; name: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

const EMPTY_REQUEST_FORM = {
  toWarehouseId: '', productId: '', requestedQuantity: '',
  requestDate: new Date().toISOString().split('T')[0],
  linkedShipmentId: '', requestedByEmployeeId: '', notes: '',
}

const EMPTY_DISPATCH_FORM = {
  actualQuantity: '', waybillNumber: '', driverName: '', truckPlate: '',
  weightKg: '', truckingRatePerKg: '', linkedShipmentId: '',
}

export function DjiboutiForwarder() {
  const [stock, setStock] = useState<AliStockRow[]>([])
  const [transfers, setTransfers] = useState<WarehouseTransfer[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<Option[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [shipments, setShipments] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('REQUESTED')

  const [reqOpen, setReqOpen] = useState(false)
  const [reqForm, setReqForm] = useState({ ...EMPTY_REQUEST_FORM })
  const [reqSaving, setReqSaving] = useState(false)

  const [dispatchTarget, setDispatchTarget] = useState<WarehouseTransfer | null>(null)
  const [dispatchForm, setDispatchForm] = useState({ ...EMPTY_DISPATCH_FORM })
  const [dispatchSaving, setDispatchSaving] = useState(false)

  const [receiveTarget, setReceiveTarget] = useState<WarehouseTransfer | null>(null)
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveSaving, setReceiveSaving] = useState(false)

  const warehouseName = (id: string | null) => warehouses.find(w => w.id === id)?.name ?? '—'
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? '—'
  const shipmentLabel = (id: string | null) => id ? (shipments.find(s => s.id === id)?.name ?? '—') : null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [stockRows, transferRows, w, p, e, shRes] = await Promise.all([
        fetchAliStock(),
        fetchWarehouseTransfers(200),
        fetchWarehousesList(),
        fetchAllProducts(),
        fetchEmployeesList(),
        supabase.from('shipments').select('id, shipment_number').order('created_at', { ascending: false }).limit(100),
      ])
      setStock(stockRows)
      setTransfers(transferRows)
      setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setProducts((p ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setEmployees((e ?? []).map((x: any) => ({ id: x.id, name: x.full_name })))
      setShipments((shRes.data ?? []).map((s: any) => ({ id: s.id, name: s.shipment_number })))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load Djibouti data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submitRequest() {
    const qty = Number(reqForm.requestedQuantity)
    if (!reqForm.toWarehouseId) { setError('Choose a destination warehouse.'); return }
    if (!reqForm.productId) { setError('Choose an item.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }

    setReqSaving(true); setError(null); setSuccess(null)
    try {
      await createDjiboutiRequest({
        toWarehouseId: reqForm.toWarehouseId,
        productId: reqForm.productId,
        requestedQuantity: qty,
        requestDate: reqForm.requestDate,
        linkedShipmentId: reqForm.linkedShipmentId || undefined,
        requestedByEmployeeId: reqForm.requestedByEmployeeId || undefined,
        notes: reqForm.notes || undefined,
      })
      setSuccess('Request logged — tell Ali what to send.')
      setReqOpen(false)
      setReqForm({ ...EMPTY_REQUEST_FORM })
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to log request.')
    } finally {
      setReqSaving(false)
    }
  }

  function openDispatch(t: WarehouseTransfer) {
    setDispatchTarget(t)
    setDispatchForm({
      actualQuantity: String(t.requested_quantity ?? t.quantity),
      waybillNumber: '', driverName: '', truckPlate: '',
      weightKg: '', truckingRatePerKg: '',
      linkedShipmentId: t.linked_shipment_id ?? '',
    })
  }

  async function submitDispatch() {
    if (!dispatchTarget) return
    const qty = Number(dispatchForm.actualQuantity)
    if (!qty || qty <= 0) { setError('Enter the quantity Ali actually loaded.'); return }

    setDispatchSaving(true); setError(null); setSuccess(null)
    try {
      await recordDjiboutiDispatch(dispatchTarget, {
        actualQuantity: qty,
        waybillNumber: dispatchForm.waybillNumber || undefined,
        driverName: dispatchForm.driverName || undefined,
        truckPlate: dispatchForm.truckPlate || undefined,
        weightKg: dispatchForm.weightKg ? Number(dispatchForm.weightKg) : undefined,
        truckingRatePerKg: dispatchForm.truckingRatePerKg ? Number(dispatchForm.truckingRatePerKg) : undefined,
        linkedShipmentId: dispatchForm.linkedShipmentId || undefined,
      })
      setSuccess('Dispatch recorded. Stock deducted from Ali\'s warehouse.')
      setDispatchTarget(null)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record dispatch.')
    } finally {
      setDispatchSaving(false)
    }
  }

  function openReceive(t: WarehouseTransfer) {
    setReceiveTarget(t)
    setReceiveQty(String(t.quantity))
  }

  async function submitReceive() {
    if (!receiveTarget) return
    const qty = Number(receiveQty)
    if (!qty || qty <= 0) { setError('Enter the quantity that actually arrived.'); return }

    setReceiveSaving(true); setError(null); setSuccess(null)
    try {
      await confirmDjiboutiReceipt(receiveTarget, qty)
      setSuccess('Receipt confirmed — stock added to your warehouse.')
      setReceiveTarget(null)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to confirm receipt.')
    } finally {
      setReceiveSaving(false)
    }
  }

  async function cancel(t: WarehouseTransfer) {
    setError(null)
    try {
      await cancelWarehouseTransfer(t.id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to cancel.')
    }
  }

  const djiboutiRequests = transfers.filter(t => t.requested_quantity !== null || t.status === 'REQUESTED')
  const visible = djiboutiRequests.filter(t => statusFilter === 'ALL' || t.status === statusFilter)

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Ship size={18} /> Djibouti Forwarder
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Stock held at Ali's Djibouti warehouse, and requests to dispatch it to your warehouses
        </p>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
      {success && <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 size={12} />{success}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Stock with Ali */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5">
              <Package size={13} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Currently with Ali (Djibouti)</p>
            </div>
            {stock.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-gray-400">
                Nothing at Ali's warehouse right now. Items land here automatically when a shipment's
                status is set to "At Djibouti".
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {stock.map(s => (
                  <div key={s.product_id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-gray-700">{s.product_name} {s.sku && <span className="text-gray-400 font-mono text-xs">({s.sku})</span>}</span>
                    <span className="font-mono font-medium">{N(s.quantity)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Requests */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2 flex-wrap">
              {['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED', 'ALL'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {s === 'IN_TRANSIT' ? 'In transit' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setReqForm({ ...EMPTY_REQUEST_FORM }); setReqOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors shrink-0"
            >
              <Plus size={13} /> New request to Ali
            </button>
          </div>

          {visible.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Truck size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No requests here</p>
              <p className="text-xs text-gray-400">Log a request whenever you ask Ali to send items.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {visible.map((t, i) => (
                <div key={t.id} className={`px-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">
                        {t.transfer_number} · {productName(t.product_id)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Requested {N(t.requested_quantity ?? t.quantity)}
                        {t.status !== 'REQUESTED' && t.quantity !== t.requested_quantity && ` · Dispatched ${N(t.quantity)}`}
                        {t.received_quantity !== null && ` · Received ${N(t.received_quantity)}`}
                        {' → '}{warehouseName(t.to_warehouse_id)}
                        {' · '}{t.transfer_date}
                      </p>
                      {(t.driver_name || t.truck_plate || t.waybill_number) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[t.waybill_number && `WB ${t.waybill_number}`, t.driver_name, t.truck_plate].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {t.weight_kg && t.trucking_cost_etb && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {N(t.weight_kg)}kg × {N(t.trucking_rate_per_kg ?? 0)} ETB/kg = {N(t.trucking_cost_etb)} ETB
                          {shipmentLabel(t.linked_shipment_id) && ` · billed to ${shipmentLabel(t.linked_shipment_id)}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                        t.status === 'RECEIVED' ? 'bg-green-100 text-green-700'
                          : t.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500'
                          : t.status === 'IN_TRANSIT' ? 'bg-amber-50 text-amber-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {t.status === 'IN_TRANSIT' ? 'In transit' : t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                      </span>
                      {t.status === 'REQUESTED' && (
                        <>
                          <button onClick={() => openDispatch(t)}
                            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            Record dispatch
                          </button>
                          <button onClick={() => cancel(t)}
                            className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">
                            Cancel
                          </button>
                        </>
                      )}
                      {t.status === 'IN_TRANSIT' && (
                        <button onClick={() => openReceive(t)}
                          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          Confirm receipt
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* New request modal */}
      {reqOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setReqOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">New request to Ali</h2>
              <button onClick={() => setReqOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Item</label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={reqForm.productId} onChange={e => setReqForm(p => ({ ...p, productId: e.target.value }))}>
                    <option value="">Select…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={reqForm.requestedQuantity} onChange={e => setReqForm(p => ({ ...p, requestedQuantity: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Destination warehouse</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={reqForm.toWarehouseId} onChange={e => setReqForm(p => ({ ...p, toWarehouseId: e.target.value }))}>
                  <option value="">Select…</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={reqForm.requestDate} onChange={e => setReqForm(p => ({ ...p, requestDate: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Requested by</label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={reqForm.requestedByEmployeeId} onChange={e => setReqForm(p => ({ ...p, requestedByEmployeeId: e.target.value }))}>
                    <option value="">Select…</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Related shipment (optional)</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={reqForm.linkedShipmentId} onChange={e => setReqForm(p => ({ ...p, linkedShipmentId: e.target.value }))}>
                  <option value="">Not linked</option>
                  {shipments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={reqForm.notes} onChange={e => setReqForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setReqOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submitRequest} disabled={reqSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 min-w-[110px] justify-center">
                {reqSaving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Log request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record dispatch modal */}
      {dispatchTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setDispatchTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-medium">Record dispatch</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {dispatchTarget.transfer_number} · requested {N(dispatchTarget.requested_quantity ?? dispatchTarget.quantity)} {productName(dispatchTarget.product_id)}
                </p>
              </div>
              <button onClick={() => setDispatchTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Quantity Ali actually loaded</label>
                <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={dispatchForm.actualQuantity} onChange={e => setDispatchForm(p => ({ ...p, actualQuantity: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Waybill number</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={dispatchForm.waybillNumber} onChange={e => setDispatchForm(p => ({ ...p, waybillNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Truck plate</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={dispatchForm.truckPlate} onChange={e => setDispatchForm(p => ({ ...p, truckPlate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Driver name</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={dispatchForm.driverName} onChange={e => setDispatchForm(p => ({ ...p, driverName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Weight (kg)</label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={dispatchForm.weightKg} onChange={e => setDispatchForm(p => ({ ...p, weightKg: e.target.value }))} placeholder="e.g. 400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Rate (ETB/kg)</label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={dispatchForm.truckingRatePerKg} onChange={e => setDispatchForm(p => ({ ...p, truckingRatePerKg: e.target.value }))} placeholder="e.g. 1400" />
                </div>
              </div>
              {Number(dispatchForm.weightKg) > 0 && Number(dispatchForm.truckingRatePerKg) > 0 && (
                <p className="text-xs text-blue-600">
                  Trucking cost: {N(Number(dispatchForm.weightKg) * Number(dispatchForm.truckingRatePerKg))} ETB
                </p>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bill trucking cost to shipment</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={dispatchForm.linkedShipmentId} onChange={e => setDispatchForm(p => ({ ...p, linkedShipmentId: e.target.value }))}>
                  <option value="">Don't auto-create an expense</option>
                  {shipments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setDispatchTarget(null)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submitDispatch} disabled={dispatchSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 min-w-[110px] justify-center">
                {dispatchSaving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Record dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm receipt modal */}
      {receiveTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setReceiveTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-medium">Confirm receipt</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {receiveTarget.transfer_number} · dispatched {N(receiveTarget.quantity)} {productName(receiveTarget.product_id)}
                </p>
              </div>
              <button onClick={() => setReceiveTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4">
              <label className="block text-xs text-gray-500 mb-1">Quantity that actually arrived</label>
              <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={receiveQty} onChange={e => setReceiveQty(e.target.value)} />
              {Number(receiveQty) !== receiveTarget.quantity && receiveQty !== '' && (
                <p className="text-xs text-amber-600 mt-1">
                  {Number(receiveQty) < receiveTarget.quantity ? 'Short' : 'Over'} by {N(Math.abs(Number(receiveQty) - receiveTarget.quantity))} vs. what was dispatched.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setReceiveTarget(null)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submitReceive} disabled={receiveSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 min-w-[110px] justify-center">
                {receiveSaving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Confirm receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
