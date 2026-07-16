import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { calculateInventoryBalances, type InventoryBalance } from '../lib/inventoryLedger'
import { fetchAllProducts, fetchBoms } from '../api/bom'
import { fetchWarehousesList } from '../api/income'
import { usePageState } from '../lib/pageState'
import { computeDemandForecast, STOCKOUT_WARNING_DAYS, type SalesLine } from '../lib/forecasting'
import { Package, AlertTriangle, Loader2, Plus, X, ShieldAlert, LayoutGrid, Wrench, Boxes, TrendingUp, TrendingDown, Minus, Gauge, Calendar, Clock } from 'lucide-react'

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-100 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <Calendar size={13} className="text-blue-400 shrink-0" />
        {now.toLocaleDateString('en-ET', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      <div className="w-px h-3.5 bg-blue-100" />
      <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-blue-700 tabular-nums">
        <Clock size={13} className="text-blue-400 shrink-0" />
        {now.toLocaleTimeString('en-ET', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </div>
    </div>
  )
}

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

interface ProductMeta { id: string; name: string; sku: string; imageUrl: string | null; assemblyType: string | null }
interface BomLine { componentProductId: string; quantityRequired: number }
interface BomEntry { id: string; isActive: boolean; productId: string; productName: string; lines: BomLine[] }

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
  const [tab, setTab]             = usePageState<'stock' | 'movements' | 'warehouses' | 'forecast'>('inventory.tab', 'stock')
  const [salesLines, setSalesLines] = useState<SalesLine[]>([])
  const [filterProd, setFilterProd] = usePageState('inventory.filterProd', '')
  const [filterWarehouse, setFilterWarehouse] = usePageState('inventory.filterWarehouse', '')
  const [stockSearch, setStockSearch] = usePageState('inventory.stockSearch', '')
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [products, setProducts] = useState<Array<{ id: string; name: string; sku: string }>>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [productMeta, setProductMeta] = useState<Map<string, ProductMeta>>(new Map())
  const [boms, setBoms] = useState<BomEntry[]>([])

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
    supabase.from('products').select('id, name, sku, image_url, assembly_type').then(({ data }) => {
      const map = new Map<string, ProductMeta>()
      for (const p of data ?? []) map.set(p.id, { id: p.id, name: p.name, sku: p.sku, imageUrl: p.image_url, assemblyType: p.assembly_type })
      setProductMeta(map)
    })
    fetchBoms().then((rows: any) => setBoms((rows ?? [])
      .filter((b: any) => b.lines.length > 0)
      .map((b: any) => ({ id: b.id, isActive: b.isActive, productId: b.productId, productName: b.productName, lines: b.lines.map((l: any) => ({ componentProductId: l.componentProductId, quantityRequired: l.quantityRequired })) }))
    )).catch(console.error)
    const sixtyAgo = new Date(); sixtyAgo.setDate(sixtyAgo.getDate() - 60)
    const sixtyAgoIso = sixtyAgo.toISOString().slice(0, 10)
    supabase.from('sales_order_lines')
      .select('product_id, quantity, sales_orders(sale_date, status)')
      .then(({ data }) => setSalesLines((data ?? [])
        .map((r: any) => {
          const order = Array.isArray(r.sales_orders) ? r.sales_orders[0] : r.sales_orders
          return { product_id: r.product_id, quantity: Number(r.quantity ?? 0), sale_date: order?.sale_date ?? '', status: order?.status ?? '' }
        })
        .filter((r: any) => r.sale_date >= sixtyAgoIso && (r.status === 'INVOICED' || r.status === 'PAID'))
        .map((r: any) => ({ product_id: r.product_id, quantity: r.quantity, sale_date: r.sale_date }))
      ))
      .then(undefined, console.error)
  }, [])

  // Buildable finished units per warehouse, computed from BOM component stock
  // — this is what lets an SKD/CKD kit ("2 boxes of parts") answer "how many
  // finished units can I actually assemble from what's on hand right now".
  const buildableByWarehouse = useMemo(() => {
    const stockByKey = new Map<string, number>()
    for (const item of inventory) stockByKey.set(`${item.warehouse_id ?? ''}:${item.product_id}`, item.quantity_on_hand)

    const warehouseIds = new Set(inventory.map(i => i.warehouse_id ?? ''))
    const map = new Map<string, Array<{ bomId: string; productId: string; productName: string; buildable: number }>>()
    for (const whId of warehouseIds) {
      const list: Array<{ bomId: string; productId: string; productName: string; buildable: number }> = []
      for (const bom of boms) {
        if (!bom.isActive) continue
        let buildable = Infinity
        for (const line of bom.lines) {
          const stock = stockByKey.get(`${whId}:${line.componentProductId}`) ?? 0
          const possible = line.quantityRequired > 0 ? Math.floor(stock / line.quantityRequired) : 0
          buildable = Math.min(buildable, possible)
        }
        if (buildable !== Infinity && buildable > 0) list.push({ bomId: bom.id, productId: bom.productId, productName: bom.productName, buildable })
      }
      if (list.length > 0) map.set(whId, list)
    }
    return map
  }, [inventory, boms])

  // Company-wide effective stock per product: on-hand quantity plus whatever
  // can still be assembled from SKD/CKD component stock (summed across
  // warehouses — components in different warehouses can't be combined into
  // one kit, but each warehouse's own buildable count still adds to the
  // company-wide total that's actually sellable).
  const stockByProductTotal = useMemo(() => {
    const map = new Map<string, { onHand: number; buildable: number }>()
    for (const item of inventory) {
      const entry = map.get(item.product_id) ?? { onHand: 0, buildable: 0 }
      entry.onHand += item.quantity_on_hand
      map.set(item.product_id, entry)
    }
    for (const list of buildableByWarehouse.values()) {
      for (const b of list) {
        const entry = map.get(b.productId) ?? { onHand: 0, buildable: 0 }
        entry.buildable += b.buildable
        map.set(b.productId, entry)
      }
    }
    return map
  }, [inventory, buildableByWarehouse])

  const forecast = useMemo(() => computeDemandForecast(salesLines, stockByProductTotal), [salesLines, stockByProductTotal])
  const forecastRows = useMemo(() => [...forecast.values()]
    .filter(f => f.avgDailyDemand > 0)
    .sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity)),
    [forecast])

  const warehouseGroups = useMemo(() => {
    const map = new Map<string, { name: string; items: InventoryRow[] }>()
    for (const item of inventory) {
      const key = item.warehouse_id ?? ''
      if (!map.has(key)) map.set(key, { name: item.warehouse_name, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [inventory])

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
        <LiveClock />
      </div>

      <div className="flex items-center justify-end mb-5 -mt-3">
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdjustForm(v => !v)}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white flex items-center gap-1"
          >
            {showAdjustForm ? <X size={12} /> : <Plus size={12} />} Adjust stock
          </button>
          {(['stock', 'warehouses', 'forecast', 'movements'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize flex items-center gap-1
                ${tab === t
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {t === 'warehouses' && <LayoutGrid size={12} />}
              {t === 'forecast' && <Gauge size={12} />}
              {t === 'stock' ? 'Stock levels' : t === 'warehouses' ? 'Warehouse view' : t === 'forecast' ? 'Forecast' : 'Movement history'}
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

      {/* Warehouse view tab — pictorial, grouped by warehouse */}
      {!loading && tab === 'warehouses' && (
        warehouseGroups.length === 0 ? (
          <div className="text-center py-16">
            <Boxes size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">No inventory yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {warehouseGroups.map(([whId, group]) => {
              const buildable = buildableByWarehouse.get(whId) ?? []
              const maxQty = Math.max(1, ...group.items.map(i => i.quantity_on_hand))
              return (
                <div key={whId || 'unassigned'}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-medium flex items-center gap-1.5">
                      <LayoutGrid size={14} className="text-gray-400" /> {group.name}
                    </h2>
                    <span className="text-xs text-gray-400">
                      {group.items.length} products · {N(group.items.reduce((s, i) => s + i.total_value, 0))} ETB
                    </span>
                  </div>

                  {buildable.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {buildable.map(b => (
                        <div key={b.bomId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200">
                          <Wrench size={14} className="text-violet-600 shrink-0" />
                          <div>
                            <p className="text-xs text-violet-700 font-medium leading-tight">Can build {N(b.buildable)} × {b.productName}</p>
                            <p className="text-xs text-violet-400 leading-tight">from SKD/CKD parts on hand, per active BOM</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {group.items.map(item => {
                      const isOut      = item.quantity_on_hand <= 0
                      const isCritical = !isOut && item.quantity_on_hand < 5
                      const isLow      = !isOut && !isCritical && item.quantity_on_hand < 20
                      const meta = productMeta.get(item.product_id)
                      const barColor = isOut ? 'bg-red-400' : isCritical ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-green-500'
                      const ringColor = isOut ? 'border-red-200' : isCritical ? 'border-red-200' : isLow ? 'border-amber-200' : 'border-gray-200'
                      return (
                        <div key={`${whId}:${item.product_id}`} className={`bg-white border ${ringColor} rounded-xl p-3 flex flex-col gap-2`}>
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden">
                              {meta?.imageUrl
                                ? <img src={meta.imageUrl} alt="" className="w-full h-full object-cover" />
                                : <Package size={16} className="text-gray-300" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{item.product_name}</p>
                              <p className="text-xs text-gray-400 font-mono truncate">{item.sku}</p>
                            </div>
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className={`text-lg font-mono font-medium ${isOut || isCritical ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-gray-900'}`}>
                              {N(item.quantity_on_hand)}
                            </span>
                            <span className="text-xs text-gray-400">
                              {meta?.assemblyType === 'CKD' || meta?.assemblyType === 'SKD' ? meta.assemblyType : 'units'}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(4, (item.quantity_on_hand / maxQty) * 100)}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Forecast tab — recency-weighted demand vs. effective stock (on hand
          + buildable from SKD/CKD components), no external API */}
      {!loading && tab === 'forecast' && (
        forecastRows.length === 0 ? (
          <div className="text-center py-16">
            <Gauge size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Not enough sales history yet</p>
            <p className="text-xs text-gray-400">Forecasts need at least some sales in the last 60 days to estimate demand.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                            bg-gray-50 border-b border-gray-100
                            text-xs font-medium text-gray-400 uppercase tracking-wide">
              <div>Product</div>
              <div className="text-right">Avg daily sales</div>
              <div>Trend</div>
              <div className="text-right">Effective stock</div>
              <div className="text-right">Runway</div>
              <div>Reorder by</div>
            </div>
            {forecastRows.map((f, i) => {
              const meta = productMeta.get(f.productId)
              const urgent = f.daysUntilStockout !== null && f.daysUntilStockout <= STOCKOUT_WARNING_DAYS
              return (
                <div key={f.productId}
                  className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 items-center
                              ${i < forecastRows.length - 1 ? 'border-b border-gray-50' : ''} ${urgent ? 'bg-red-50/40' : ''}`}>
                  <div>
                    <p className="text-sm font-medium">{meta?.name ?? 'Unknown product'}</p>
                    <p className="text-xs font-mono text-gray-400">{meta?.sku ?? ''}</p>
                  </div>
                  <div className="text-right text-sm font-mono">{f.avgDailyDemand.toFixed(1)}/day</div>
                  <div className="flex items-center gap-1 text-xs">
                    {f.trendPct === null ? (
                      <span className="text-gray-400">—</span>
                    ) : f.trendPct > 15 ? (
                      <span className="flex items-center gap-0.5 text-red-600"><TrendingUp size={12} /> {f.trendPct.toFixed(0)}%</span>
                    ) : f.trendPct < -15 ? (
                      <span className="flex items-center gap-0.5 text-blue-600"><TrendingDown size={12} /> {f.trendPct.toFixed(0)}%</span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-gray-400"><Minus size={12} /> steady</span>
                    )}
                  </div>
                  <div className="text-right text-sm font-mono">
                    {N(f.effectiveStock)}
                    {f.buildableStock > 0 && <p className="text-xs text-violet-500">{N(f.onHandStock)} + {N(f.buildableStock)} buildable</p>}
                  </div>
                  <div className={`text-right text-sm font-mono font-medium ${urgent ? 'text-red-600' : 'text-gray-700'}`}>
                    {f.daysUntilStockout === null ? '—' : f.daysUntilStockout >= 90 ? '90+ days' : `${Math.round(f.daysUntilStockout)} days`}
                  </div>
                  <div className={`text-xs ${urgent ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {f.recommendReorderBy ?? '—'}
                    {urgent && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                  </div>
                </div>
              )
            })}
          </div>
        )
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