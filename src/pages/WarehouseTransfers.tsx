import { useState, useEffect, useCallback } from 'react'
import { Truck, Loader2, CheckCircle2, AlertTriangle, Plus } from 'lucide-react'
import { fetchWarehousesList } from '../api/income'
import { fetchAllProducts } from '../api/bom'
import { fetchEmployeesList } from '../api/companyExpenses'
import {
  fetchWarehouseTransfers, createWarehouseTransfer, receiveWarehouseTransfer,
  cancelWarehouseTransfer,
} from '../api/warehouseTransfers'
import type { WarehouseTransfer, TransferPurpose } from '../api/warehouseTransfers'
import { usePageState } from '../lib/pageState'
import { SearchableSelect } from '../components/SearchableSelect'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'

interface Option { id: string; name: string; sku?: string }

const PURPOSE_LABEL: Record<TransferPurpose, string> = {
  WAREHOUSE_TO_WAREHOUSE: 'Warehouse → warehouse',
  SALES: 'Sales (leaving network)',
  RETURN: 'Return',
  OTHER: 'Other',
}

const EMPTY_FORM = {
  fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '',
  transferDate: new Date().toISOString().split('T')[0],
  purpose: 'WAREHOUSE_TO_WAREHOUSE' as TransferPurpose,
  driverName: '', truckPlate: '', requestedByEmployeeId: '', notes: '',
}

export function WarehouseTransfers() {
  const [transfers, setTransfers] = useState<WarehouseTransfer[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<Option[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = usePageState('warehouseTransfers.status', 'IN_TRANSIT')

  const warehouseName = (id: string | null) => warehouses.find(w => w.id === id)?.name ?? '—'
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? '—'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, w, p, e] = await Promise.all([
        fetchWarehouseTransfers(),
        fetchWarehousesList(),
        fetchAllProducts(),
        fetchEmployeesList(),
      ])
      setTransfers(t)
      setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setProducts((p ?? []).map((x: any) => ({ id: x.id, name: x.name, sku: x.sku })))
      setEmployees((e ?? []).map((x: any) => ({ id: x.id, name: x.full_name })))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load transfers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    const qty = Number(form.quantity)
    if (!form.fromWarehouseId) { setError('Choose the source warehouse.'); return }
    if (form.purpose === 'WAREHOUSE_TO_WAREHOUSE' && !form.toWarehouseId) { setError('Choose the destination warehouse.'); return }
    if (form.fromWarehouseId === form.toWarehouseId) { setError('Source and destination must be different.'); return }
    if (!form.productId) { setError('Choose an item.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }

    setSaving(true); setError(null); setSuccess(null)
    try {
      await createWarehouseTransfer({
        fromWarehouseId: form.fromWarehouseId,
        toWarehouseId: form.purpose === 'WAREHOUSE_TO_WAREHOUSE' ? form.toWarehouseId : null,
        productId: form.productId,
        quantity: qty,
        transferDate: form.transferDate,
        purpose: form.purpose,
        driverName: form.driverName || undefined,
        truckPlate: form.truckPlate || undefined,
        requestedByEmployeeId: form.requestedByEmployeeId || undefined,
        notes: form.notes || undefined,
      })
      setSuccess('Transfer logged.')
      setOpen(false)
      setForm({ ...EMPTY_FORM })
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to log transfer.')
    } finally {
      setSaving(false)
    }
  }

  async function markReceived(t: WarehouseTransfer) {
    setBusyId(t.id); setError(null)
    try {
      await receiveWarehouseTransfer(t)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mark as received.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(t: WarehouseTransfer) {
    setBusyId(t.id); setError(null)
    try {
      await cancelWarehouseTransfer(t.id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to cancel transfer.')
    } finally {
      setBusyId(null)
    }
  }

  // Djibouti-forwarder dispatches (requested_quantity is only ever set by
  // createDjiboutiRequest) live in this same table but go through their own
  // request -> dispatch -> confirm-receipt lifecycle on the Djibouti
  // Forwarder page. Letting them also be "received" here called a second,
  // unrelated inventory-posting function on top of that — double-deducting
  // the forwarder's warehouse. Keep them off this page entirely.
  const visible = transfers
    .filter(t => t.requested_quantity === null)
    .filter(t => statusFilter === 'ALL' || t.status === statusFilter)

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <PageHeader
        icon={<Truck size={18} />}
        title="Warehouse Transfers"
        subtitle="Movement between warehouses (e.g. Debre Berhan → Addisu Gebeya → Merkato), with driver, plate, and purpose"
        actions={<Button icon={<Plus size={13} />} onClick={() => { setForm({ ...EMPTY_FORM }); setOpen(true) }}>New transfer</Button>}
      />

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-card text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
      {success && <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-card text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 size={12} />{success}</div>}

      <div className="flex gap-2 mb-3">
        {['IN_TRANSIT', 'RECEIVED', 'CANCELLED', 'ALL'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-card border transition-colors ${
              statusFilter === s ? 'bg-accent text-accent-foreground border-accent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === 'IN_TRANSIT' ? 'In transit' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400 gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <Card padded className="text-center py-10">
          <Truck size={32} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No transfers here</p>
          <p className="text-xs text-gray-400">Log a transfer whenever stock moves between warehouses.</p>
        </Card>
      ) : (
        <Card>
          {visible.map((t, i) => (
            <div
              key={t.id}
              className={`stagger-row px-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
              style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {t.transfer_number} · {productName(t.product_id)} · {t.quantity}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {warehouseName(t.from_warehouse_id)} → {t.to_warehouse_id ? warehouseName(t.to_warehouse_id) : PURPOSE_LABEL[t.purpose]}
                    {' · '}{t.transfer_date}
                  </p>
                  {(t.driver_name || t.truck_plate) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[t.driver_name, t.truck_plate].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={t.status === 'RECEIVED' ? 'success' : t.status === 'CANCELLED' ? 'neutral' : 'warning'}>
                    {t.status === 'IN_TRANSIT' ? 'In transit' : t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                  </Badge>
                  {t.status === 'IN_TRANSIT' && (
                    <>
                      <Button
                        onClick={() => markReceived(t)}
                        disabled={busyId === t.id}
                        className="px-2.5 py-1"
                      >
                        Mark received
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => cancel(t)}
                        disabled={busyId === t.id}
                        className="px-2.5 py-1"
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New transfer"
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={submit} className="min-w-[110px]">Log transfer</Button>
        </>}
      >
              <div>
                <label className="block text-xs text-gray-500 mb-1">Purpose</label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.purpose}
                  onChange={e => setForm(p => ({ ...p, purpose: e.target.value as TransferPurpose }))}
                >
                  {(Object.keys(PURPOSE_LABEL) as TransferPurpose[]).map(k => (
                    <option key={k} value={k}>{PURPOSE_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">From warehouse</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.fromWarehouseId}
                    onChange={e => setForm(p => ({ ...p, fromWarehouseId: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                {form.purpose === 'WAREHOUSE_TO_WAREHOUSE' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">To warehouse</label>
                    <select
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={form.toWarehouseId}
                      onChange={e => setForm(p => ({ ...p, toWarehouseId: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {warehouses.filter(w => w.id !== form.fromWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Item</label>
                  <SearchableSelect
                    options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
                    value={form.productId}
                    onChange={id => setForm(p => ({ ...p, productId: id }))}
                    placeholder="Select…"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.quantity}
                    onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.transferDate}
                    onChange={e => setForm(p => ({ ...p, transferDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Requested by</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.requestedByEmployeeId}
                    onChange={e => setForm(p => ({ ...p, requestedByEmployeeId: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Driver name</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.driverName}
                    onChange={e => setForm(p => ({ ...p, driverName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Truck plate</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.truckPlate}
                    onChange={e => setForm(p => ({ ...p, truckPlate: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
      </Modal>
    </div>
  )
}
