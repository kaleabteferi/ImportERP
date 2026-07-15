import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { calculateInventoryBalances, type InventoryBalance } from '../lib/inventoryLedger'
import { fetchAllProducts } from '../api/bom'
import { fetchWarehousesList } from '../api/income'
import { usePageState } from '../lib/pageState'
import { Package, AlertTriangle, Loader2, Plus, X, ShieldAlert } from 'lucide-react'

interface Option { id: string; name: string }

function AdjustStockForm({ products, warehouses, onDone, onCancel }: {
  products: Array<{ id: string; name: string; sku: string }>
  warehouses: Option[]
  onDone: () => void
  onCancel: () => void
}) {
  const [productId, setProductId] = useState('')
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const qty = Number(quantity)
    if (!productId) { setError('Choose a product.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!qty || qty === 0) { setError('Enter a nonzero quantity — positive to add stock, negative to remove it.'); return }
    if (!notes.trim()) { setError('Add a reason — this becomes part of the permanent audit trail.'); return }
    setSaving(true); setError(null)
    try {
      const { error } = await supabase.from('inventory_ledger').insert({
        product_id: productId,
        warehouse_id: warehouseId,
        quantity: qty,
        unit_cost_etb: qty > 0 && unitCost ? Number(unitCost) : null,
        movement_type: 'ADJUSTMENT',
        movement_date: new Date().toISOString().split('T')[0],
        notes,
      })
      if (error) throw error
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record adjustment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5">
      <p className="text-xs font-medium text-amber-700 flex items-center gap-1"><ShieldAlert size={12} /> Manual stock adjustment</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <select value={productId} onChange={e => setProductId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Product</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.sku && `(${p.sku})`}</option>)}
        </select>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Warehouse</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
          placeholder="Quantity (+ to add, − to remove)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        {Number(quantity) > 0 && (
          <input type="number" value={unitCost} onChange={e => setUnitCost(e.target.value)}
            placeholder="Unit cost ETB (optional)"
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        )}
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Reason (e.g. physical count correction, damaged stock, opening balance)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Record adjustment'}
        </button>
      </div>
    </div>
  )
}

interface InventoryRow extends InventoryBalance {}

interface Movement {
  id: string
  movement_type: string
  quantity: number
  unit_cost_etb: number | null
  movement_date: string
  notes: string | null
  warehouse_id: string | null
  warehouse_name: string | null
  products: { name: string; sku: string } | null
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const MOVE_COLOR: Record<string, string> = {
  SHIPMENT_RECEIVED:   'text-green-700',
  PRODUCTION_OUTPUT:   'text-green-700',
  SALE:                'text-red-600',
  ADJUSTMENT:          'text-amber-700',
  DAMAGE:              'text-red-600',
  PRODUCTION_CONSUMED: 'text-amber-700',
}

export function Inventory() {
  const [inventory, setInventory] = useState<InventoryRow[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [tab, setTab]             = usePageState<'stock' | 'movements'>('inventory.tab', 'stock')
  const [filterProd, setFilterProd] = usePageState('inventory.filterProd', '')
  const [filterWarehouse, setFilterWarehouse] = usePageState('inventory.filterWarehouse', '')
  const [stockSearch, setStockSearch] = usePageState('inventory.stockSearch', '')
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [products, setProducts] = useState<Array<{ id: string; name: string; sku: string }>>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const [ledgerRes, moveRes, productRes, warehouseRes] = await Promise.all([
        supabase.from('inventory_ledger').select('product_id, quantity, unit_cost_etb, warehouse_id'),
        supabase.from('inventory_ledger').select('id, movement_type, quantity, unit_cost_etb, movement_date, notes, warehouse_id, product_id').order('movement_date', { ascending: false }).limit(100),
        supabase.from('products').select('id, name, sku').order('name'),
        supabase.from('warehouses').select('id, name').order('name'),
      ])

      if (ledgerRes.error) throw ledgerRes.error
      if (moveRes.error) throw moveRes.error
      if (productRes.error) throw productRes.error
      if (warehouseRes.error) throw warehouseRes.error

      const productsById = new Map((productRes.data ?? []).map((p: any) => [p.id, p]))
      const warehousesById = new Map((warehouseRes.data ?? []).map((w: any) => [w.id, w]))

      const ledgerRows = (ledgerRes.data ?? []).map((row: any) => ({
        ...row,
        products: row.product_id ? { name: productsById.get(row.product_id)?.name ?? '—', sku: productsById.get(row.product_id)?.sku ?? '—' } : null,
        warehouses: row.warehouse_id ? { name: warehousesById.get(row.warehouse_id)?.name ?? 'Main Warehouse' } : null,
      }))

      const moveRows = (moveRes.data ?? []).map((row: any) => ({
        ...row,
        products: row.product_id ? { name: productsById.get(row.product_id)?.name ?? '—', sku: productsById.get(row.product_id)?.sku ?? '—' } : null,
        warehouse_name: row.warehouse_id ? (warehousesById.get(row.warehouse_id)?.name ?? 'Main Warehouse') : null,
      }))

      const inv = calculateInventoryBalances(ledgerRows as any[])

      setInventory(inv)
      setMovements(moveRows)
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Unable to load inventory data.')
      setInventory([])
      setMovements([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    fetchAllProducts().then((rows: any) => setProducts((rows ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku })))).catch(console.error)
    fetchWarehousesList().then((rows: any) => setWarehouses((rows ?? []).map((w: any) => ({ id: w.id, name: w.name })))).catch(console.error)
  }, [])

  const totalValue = inventory.reduce((s, i) => s + i.total_value, 0)
  const outOfStock = inventory.filter(i => i.quantity_on_hand <= 0)
  const lowStock   = inventory.filter(i => i.quantity_on_hand > 0 && i.quantity_on_hand < 20)
  const moves      = filterProd
    ? movements.filter(m => (m.products as any)?.name === filterProd)
    : movements
  // inventory has one row per product+warehouse, but this filter is by
  // product name only — dedupe so the same product isn't listed per warehouse.
  const filterableProducts = [...new Map(inventory.map(i => [i.product_name, i])).values()]
  const visibleStock = inventory
    .filter(i => !filterWarehouse || i.warehouse_id === filterWarehouse)
    .filter(i => !stockSearch || i.product_name.toLowerCase().includes(stockSearch.toLowerCase()) || i.sku.toLowerCase().includes(stockSearch.toLowerCase()))

  return (
    <div className="p-5 max-w-5xl mx-auto">

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Inventory</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {inventory.length} products ·{' '}
            <span className="font-medium text-blue-700">{N(totalValue)} ETB</span>
            {' '}total value
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdjustForm(v => !v)}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white flex items-center gap-1"
          >
            {showAdjustForm ? <X size={12} /> : <Plus size={12} />} Adjust stock
          </button>
          {(['stock', 'movements'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize
                ${tab === t
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {t === 'stock' ? 'Stock levels' : 'Movement history'}
            </button>
          ))}
        </div>
      </div>

      {showAdjustForm && (
        <AdjustStockForm
          products={products}
          warehouses={warehouses}
          onCancel={() => setShowAdjustForm(false)}
          onDone={() => { setShowAdjustForm(false); load() }}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && outOfStock.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200
                        rounded-xl text-xs text-red-700 mb-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>{outOfStock.length} products</strong> out of stock:{' '}
            {outOfStock.map(p => p.product_name).join(', ')}
          </span>
        </div>
      )}

      {!loading && lowStock.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200
                        rounded-xl text-xs text-amber-700 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>{lowStock.length} products</strong> below safety stock:{' '}
            {lowStock.map(p => p.product_name).join(', ')}
          </span>
        </div>
      )}

      {/* Stock tab */}
      {!loading && tab === 'stock' && (
        <>
          {inventory.length === 0 ? (
            <div className="text-center py-16">
              <Package size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No inventory yet</p>
              <p className="text-xs text-gray-400">
                Stock is updated automatically when shipments are received and sales are made.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <input
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="Search product or SKU"
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg w-52
                             focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <select
                  value={filterWarehouse}
                  onChange={e => setFilterWarehouse(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                             focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">All warehouses</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>

              {visibleStock.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No products match this filter.</div>
              ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                              bg-gray-50 border-b border-gray-100
                              text-xs font-medium text-gray-400 uppercase tracking-wide">
                <div>Product</div>
                <div>Warehouse</div>
                <div className="text-right">On hand</div>
                <div className="text-right">Unit cost</div>
                <div className="text-right">Total value</div>
                <div className="text-right">Status</div>
              </div>

              {visibleStock.map((item, i) => {
                const isOut       = item.quantity_on_hand <= 0
                const isCritical  = !isOut && item.quantity_on_hand < 5
                const isLow       = !isOut && !isCritical && item.quantity_on_hand < 20
                return (
                  <div
                    key={`${item.product_id}:${item.warehouse_id ?? ''}`}
                    className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                                items-center
                                ${i < visibleStock.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{item.product_name}</p>
                      <p className="text-xs font-mono text-gray-400 mt-0.5">{item.sku}</p>
                    </div>
                    <div className="text-sm text-gray-600">{item.warehouse_name}</div>
                    <div className="text-right">
                      <p className={`text-sm font-medium font-mono
                        ${isOut ? 'text-red-600' : isCritical ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-gray-900'}`}>
                        {N(item.quantity_on_hand)}
                      </p>
                      <p className="text-xs text-gray-400">units</p>
                    </div>
                    <div className="text-right text-xs font-mono text-gray-500">
                      {N(item.avg_unit_cost_etb)} ETB
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium font-mono text-blue-700">
                        {N(item.total_value)} ETB
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                        ${isOut
                          ? 'bg-red-100 text-red-700'
                          : isCritical
                            ? 'bg-red-50 text-red-700'
                            : isLow
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-green-50 text-green-700'}`}>
                        {isOut ? 'Out of stock' : isCritical ? 'Critical' : isLow ? 'Low' : 'OK'}
                      </span>
                    </div>
                  </div>
                )
              })}

              {/* Total */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                              bg-gray-50 border-t border-gray-100
                              text-sm font-medium">
                <div className="text-gray-500 text-xs">Total</div>
                <div />
                <div className="text-right font-mono">
                  {N(visibleStock.reduce((s, i) => s + i.quantity_on_hand, 0))}
                </div>
                <div />
                <div className="text-right font-mono text-blue-700">
                  {N(visibleStock.reduce((s, i) => s + i.total_value, 0))} ETB
                </div>
                <div />
              </div>
              </div>
              )}
            </>
          )}
        </>
      )}

      {/* Movements tab */}
      {!loading && tab === 'movements' && (
        <div>
          {inventory.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-500">Filter:</span>
              <select
                value={filterProd}
                onChange={e => setFilterProd(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg
                           bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">All products</option>
                {filterableProducts.map(i => (
                  <option key={i.product_id} value={i.product_name}>{i.product_name}</option>
                ))}
              </select>
            </div>
          )}

          {moves.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              No movements recorded yet.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                              bg-gray-50 border-b border-gray-100
                              text-xs font-medium text-gray-400 uppercase tracking-wide">
                <div>Product</div>
                <div>Type</div>
                <div className="text-right">Quantity</div>
                <div className="text-right">Unit cost</div>
                <div>Date</div>
              </div>

              {moves.map((m, i) => {
                const prod  = m.products as any
                const isIn  = m.quantity > 0
                const color = MOVE_COLOR[m.movement_type] ?? 'text-gray-500'
                return (
                  <div
                    key={m.id}
                    className={`grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                                items-center
                                ${i < moves.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{prod?.name ?? '—'}</p>
                      {m.notes && <p className="text-xs text-gray-400 mt-0.5">{m.notes}</p>}
                    </div>
                    <div className={`text-xs font-medium ${color}`}>
                      {m.movement_type.replace(/_/g, ' ')}
                    </div>
                    <div className={`text-right text-sm font-mono font-medium
                      ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                      {isIn ? '+' : ''}{N(m.quantity)}
                    </div>
                    <div className="text-right text-xs font-mono text-gray-500">
                      {m.unit_cost_etb ? N(m.unit_cost_etb) + ' ETB' : '—'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(m.movement_date).toLocaleDateString('en-ET')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}