import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calculateInventoryBalances, type InventoryBalance } from '../lib/inventoryLedger'
import { fetchAllProducts, fetchBoms } from '../api/bom'
import { fetchWarehousesList } from '../api/income'
import { usePageState } from '../lib/pageState'
import { computeDemandForecast, STOCKOUT_WARNING_DAYS, type SalesLine } from '../lib/forecasting'
import { SearchableSelect } from '../components/SearchableSelect'
import { PageHeader } from '../components/ui/PageHeader'
import { Package, AlertTriangle, Loader2, Plus, X, ShieldAlert, LayoutGrid, Wrench, Boxes, TrendingUp, TrendingDown, Minus, Gauge, Calendar, Clock, ChevronDown, ChevronRight, Search, ArrowRightLeft, ShoppingCart, Warehouse, CircleDollarSign, Map as MapIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import './Inventory.css'

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-3 px-3.5 py-2 rounded-card bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/40 dark:to-gray-900 border border-blue-100 dark:border-blue-900/40 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <Calendar size={13} className="text-blue-400 shrink-0" />
        {now.toLocaleDateString('en-ET', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      <div className="w-px h-3.5 bg-blue-100 dark:bg-blue-900/40" />
      <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-blue-700 dark:text-blue-300 tabular-nums">
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
    <Card padded className="mb-4 space-y-2.5">
      <p className="text-xs font-medium text-amber-700 flex items-center gap-1"><ShieldAlert size={12} /> Manual stock adjustment</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <SearchableSelect
          className="flex-1"
          options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
          value={productId}
          onChange={setProductId}
          placeholder="Product"
        />
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
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} onClick={submit} className="bg-amber-600 text-white hover:brightness-95">
          Record adjustment
        </Button>
      </div>
    </Card>
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
  product_id: string | null
  products: { name: string; sku: string } | null
  source_label: string | null
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const MOVE_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  SHIPMENT_RECEIVED:   'success',
  PRODUCTION_OUTPUT:   'success',
  SALE:                'danger',
  ADJUSTMENT:          'warning',
  DAMAGE:              'danger',
  PRODUCTION_CONSUMED: 'warning',
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
  const [stockSort, setStockSort] = usePageState<'value' | 'name' | 'date' | 'quantity' | 'cost'>('inventory.stockSort', 'value')
  const [category, setCategory] = usePageState('inventory.category', 'ALL')
  const [stockStatus, setStockStatus] = usePageState('inventory.stockStatus', 'ALL')
  const [movementType, setMovementType] = usePageState('inventory.movementType', 'ALL')
  const [expandedStockKey, setExpandedStockKey] = useState<string | null>(null)
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
        supabase.from('inventory_ledger').select('product_id, quantity, unit_cost_etb, warehouse_id, movement_date'),
        supabase.from('inventory_ledger').select('id, movement_type, quantity, unit_cost_etb, movement_date, notes, warehouse_id, product_id, reference_id, reference_type').order('movement_date', { ascending: false }).limit(200),
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

      // Trace "SHIPMENT_RECEIVED" movements back to which shipment/container
      // they actually came from — reference_id on those rows is the
      // shipment's id.
      const shipmentIds = [...new Set(
        (moveRes.data ?? []).filter((r: any) => r.movement_type === 'SHIPMENT_RECEIVED' && r.reference_type === 'shipment' && r.reference_id)
          .map((r: any) => r.reference_id),
      )]
      const [{ data: shipmentRows }, { data: containerRows }] = shipmentIds.length > 0
        ? await Promise.all([
            supabase.from('shipments').select('id, shipment_number').in('id', shipmentIds),
            supabase.from('containers').select('shipment_id, container_number').in('shipment_id', shipmentIds),
          ])
        : [{ data: [] }, { data: [] }]
      const shipmentNumberById = new Map((shipmentRows ?? []).map((s: any) => [s.id, s.shipment_number]))
      const containerNumbersByShipment = new Map<string, string[]>()
      for (const c of containerRows ?? []) {
        if (!containerNumbersByShipment.has(c.shipment_id)) containerNumbersByShipment.set(c.shipment_id, [])
        if (c.container_number) containerNumbersByShipment.get(c.shipment_id)!.push(c.container_number)
      }

      const moveRows = (moveRes.data ?? []).map((row: any) => {
        const isShipmentReceipt = row.movement_type === 'SHIPMENT_RECEIVED' && row.reference_type === 'shipment' && row.reference_id
        const shipmentNumber = isShipmentReceipt ? shipmentNumberById.get(row.reference_id) : null
        const containerNumbers = isShipmentReceipt ? (containerNumbersByShipment.get(row.reference_id) ?? []) : []
        return {
          ...row,
          products: row.product_id ? { name: productsById.get(row.product_id)?.name ?? '—', sku: productsById.get(row.product_id)?.sku ?? '—' } : null,
          warehouse_name: row.warehouse_id ? (warehousesById.get(row.warehouse_id)?.name ?? 'Main Warehouse') : null,
          source_label: shipmentNumber ? `${shipmentNumber}${containerNumbers.length > 0 ? ` · ${containerNumbers.join(', ')}` : ''}` : null,
        }
      })

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
    // Seed every active warehouse first so ones with zero stock still show
    // up here — otherwise a warehouse that hasn't received anything yet
    // just silently disappears from this view instead of reading as "empty".
    for (const w of warehouses) map.set(w.id, { name: w.name, items: [] })
    for (const item of inventory) {
      const key = item.warehouse_id ?? ''
      if (!map.has(key)) map.set(key, { name: item.warehouse_name, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [inventory, warehouses])

  const totalValue = inventory.reduce((s, i) => s + i.total_value, 0)
  const outOfStock = inventory.filter(i => i.quantity_on_hand <= 0)
  const lowStock   = inventory.filter(i => i.quantity_on_hand > 0 && i.quantity_on_hand < 20)
  const moves = movements
    .filter(m => !filterProd || m.products?.name === filterProd)
    .filter(m => movementType === 'ALL' || m.movement_type === movementType)
  // inventory has one row per product+warehouse, but this filter is by
  // product name only — dedupe so the same product isn't listed per warehouse.
  const filterableProducts = [...new Map(inventory.map(i => [i.product_name, i])).values()]
  const visibleStock = inventory
    .filter(i => !filterWarehouse || i.warehouse_id === filterWarehouse)
    .filter(i => !stockSearch || i.product_name.toLowerCase().includes(stockSearch.toLowerCase()) || i.sku.toLowerCase().includes(stockSearch.toLowerCase()))
    .filter(i => category === 'ALL' || (productMeta.get(i.product_id)?.assemblyType ?? 'IMPORTED') === category)
    .filter(i => stockStatus === 'ALL' || (stockStatus === 'OUT' ? i.quantity_on_hand <= 0 : stockStatus === 'LOW' ? i.quantity_on_hand > 0 && i.quantity_on_hand < 20 : i.quantity_on_hand >= 20))
    .slice()
    .sort((a, b) => {
      if (stockSort === 'name') return a.product_name.localeCompare(b.product_name)
      if (stockSort === 'date') return (b.last_movement_date ?? '').localeCompare(a.last_movement_date ?? '')
      if (stockSort === 'quantity') return b.quantity_on_hand - a.quantity_on_hand
      if (stockSort === 'cost') return b.avg_unit_cost_etb - a.avg_unit_cost_etb
      return b.total_value - a.total_value
    })
  const totalUnits = inventory.reduce((sum, item) => sum + Math.max(0, item.quantity_on_hand), 0)
  const uniqueSkus = new Set(inventory.map(item => item.product_id)).size
  const finishedUnits = inventory.filter(item => ['FULL', 'IMPORTED'].includes(productMeta.get(item.product_id)?.assemblyType ?? 'IMPORTED')).reduce((sum, item) => sum + Math.max(0, item.quantity_on_hand), 0)

  return (
    <div className="inventory-shell p-5 max-w-7xl mx-auto">

      <PageHeader
        title="Inventory"
        subtitle={<>{inventory.length} products · <span className="font-medium text-blue-700">{N(totalValue)} ETB</span> total value</>}
        actions={<LiveClock />}
      />

      <section className="inventory-kpis"><article><i><Package /></i><span>Units on hand<strong>{N(totalUnits)}</strong><small>{uniqueSkus} active SKUs</small></span></article><article><i><CircleDollarSign /></i><span>Inventory value<strong>{N(totalValue)} ETB</strong><small>Weighted ledger value</small></span></article><article><i><Warehouse /></i><span>Warehouse network<strong>{warehouses.length}</strong><small>{inventory.filter(item => item.quantity_on_hand > 0).length} stocked positions</small></span></article><article className={lowStock.length + outOfStock.length ? 'is-alert' : ''}><i><AlertTriangle /></i><span>Needs attention<strong>{lowStock.length + outOfStock.length}</strong><small>{outOfStock.length} out · {lowStock.length} low</small></span></article><article><i><Wrench /></i><span>Finished goods<strong>{N(finishedUnits)}</strong><small>Available to transfer or sell</small></span></article></section>

      <div className="inventory-command-bar flex items-center justify-end mb-5">
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAdjustForm(v => !v)}
            className="bg-amber-600 text-white hover:brightness-95"
            icon={showAdjustForm ? <X size={12} /> : <Plus size={12} />}
          >
            Adjust stock
          </Button>
          {(['stock', 'warehouses', 'forecast', 'movements'] as const).map(t => (
            <Button
              key={t}
              variant={tab === t ? 'primary' : 'secondary'}
              onClick={() => setTab(t)}
              icon={t === 'warehouses' ? <LayoutGrid size={12} /> : t === 'forecast' ? <Gauge size={12} /> : undefined}
              className="capitalize"
            >
              {t === 'stock' ? 'Stock levels' : t === 'warehouses' ? 'Warehouse view' : t === 'forecast' ? 'Forecast' : 'Movement history'}
            </Button>
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
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && outOfStock.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200
                        rounded-card text-xs text-red-700 mb-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>{outOfStock.length} products</strong> out of stock:{' '}
            {outOfStock.map(p => p.product_name).join(', ')}
          </span>
        </div>
      )}

      {!loading && lowStock.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200
                        rounded-card text-xs text-amber-700 mb-4">
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
              <p className="text-xs text-gray-400 mb-3">
                Current on-hand quantity and value per product/warehouse. Click a row to see its recent
                movements — including which shipment and container it was received from.
              </p>
              <div className="inventory-filter-panel">
                <label className="inventory-search"><Search size={15} /><input
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="Search product or SKU"
                /></label>
                <select
                  value={filterWarehouse}
                  onChange={e => setFilterWarehouse(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                             focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">All warehouses</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)}><option value="ALL">All categories</option><option value="FULL">Finished goods</option><option value="IMPORTED">Imported finished</option><option value="SKD">SKD kits</option><option value="CKD">CKD kits</option></select>
                <select value={stockStatus} onChange={e => setStockStatus(e.target.value)}><option value="ALL">All stock status</option><option value="HEALTHY">Healthy stock</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option></select>
                <select
                  value={stockSort}
                  onChange={e => setStockSort(e.target.value as typeof stockSort)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                             focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="value">Sort: Total value</option>
                  <option value="name">Sort: Product name</option>
                  <option value="date">Sort: Last movement date</option>
                  <option value="quantity">Sort: Quantity on hand</option>
                  <option value="cost">Sort: Unit cost</option>
                </select>
                <span className="inventory-result-count">{visibleStock.length} positions</span>
              </div>

              {visibleStock.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No products match this filter.</div>
              ) : (
              <Card>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                              bg-gray-50 border-b border-gray-100
                              text-xs font-medium text-gray-400 uppercase tracking-wide">
                <div>Product</div>
                <div>Warehouse</div>
                <div className="text-right">On hand</div>
                <div className="text-right">Unit cost</div>
                <div className="text-right">Total value</div>
                <div className="text-right">Last movement</div>
                <div className="text-right">Status</div>
              </div>

              {visibleStock.map((item, i) => {
                const isOut       = item.quantity_on_hand <= 0
                const isCritical  = !isOut && item.quantity_on_hand < 5
                const isLow       = !isOut && !isCritical && item.quantity_on_hand < 20
                const rail = isOut || isCritical ? 'border-l-red-400' : isLow ? 'border-l-amber-400' : 'border-l-green-400'
                const key = `${item.product_id}:${item.warehouse_id ?? ''}`
                const expanded = expandedStockKey === key
                const history = movements
                  .filter(m => m.product_id === item.product_id && (m.warehouse_id ?? '') === (item.warehouse_id ?? ''))
                  .slice(0, 8)
                return (
                  <div key={key}>
                  <button
                    onClick={() => setExpandedStockKey(expanded ? null : key)}
                    className={`inventory-stock-row stagger-row w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 text-left
                                items-center border-l-[3px] ${rail} hover:bg-gray-50/70 transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}
                                ${!expanded && i < visibleStock.length - 1 ? 'border-b border-gray-50' : ''}`}
                    style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                  >
                    <div className="flex items-center gap-1.5">
                      {expanded ? <ChevronDown size={12} className="text-gray-300 shrink-0" /> : <ChevronRight size={12} className="text-gray-300 shrink-0" />}
                      <div>
                        <p className="text-sm font-medium">{item.product_name}</p>
                        <p className="text-xs font-mono text-gray-400 mt-0.5">{item.sku}</p>
                      </div>
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
                    <div className="text-right text-xs text-gray-400">
                      {item.last_movement_date ? new Date(item.last_movement_date).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}
                    </div>
                    <div className="text-right">
                      <Badge variant={isOut || isCritical ? 'danger' : isLow ? 'warning' : 'success'}>
                        {isOut ? 'Out of stock' : isCritical ? 'Critical' : isLow ? 'Low' : 'OK'}
                      </Badge>
                    </div>
                  </button>
                  {expanded && (
                    <div className={`inventory-stock-detail px-4 pb-3 pl-9 bg-gray-50/50 ${i < visibleStock.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <div className="inventory-detail-summary"><span><b>{productMeta.get(item.product_id)?.assemblyType ?? 'IMPORTED'}</b> classification</span><span><b>{N(item.avg_unit_cost_etb)} ETB</b> average unit cost</span><span><b>{N(item.total_value)} ETB</b> position value</span><div><Link to={`/warehouse-transfers?from=${item.warehouse_id ?? ''}&product=${item.product_id}&quantity=${Math.max(1, item.quantity_on_hand)}`}><ArrowRightLeft size={14} /> Transfer stock</Link><Link to={`/sales?warehouse=${item.warehouse_id ?? ''}&product=${item.product_id}`}><ShoppingCart size={14} /> Sell product</Link></div></div>
                      {history.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No movement history found for this product/warehouse.</p>
                      ) : (
                        <div className="space-y-1 pt-2">
                          {history.map(m => (
                            <div key={m.id} className="flex items-center justify-between text-xs py-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge variant={MOVE_BADGE[m.movement_type] ?? 'neutral'}>{m.movement_type.replace(/_/g, ' ')}</Badge>
                                <span className="text-gray-400">{new Date(m.movement_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                {m.source_label && <span className="text-gray-500 truncate">· {m.source_label}</span>}
                                {m.notes && <span className="text-gray-400 truncate">· {m.notes}</span>}
                              </div>
                              <span className={`font-mono font-medium shrink-0 ${m.quantity >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                {m.quantity >= 0 ? '+' : ''}{N(m.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                )
              })}

              {/* Total */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
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
                <div />
              </div>
              </Card>
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
            <div className="inventory-warehouse-toolbar">
              <div><Warehouse size={16} /><span>Warehouse stock classification</span></div>
              <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter warehouse stock by classification">
                <option value="ALL">All product classes</option><option value="FULL">Finished goods</option><option value="IMPORTED">Imported products</option><option value="SKD">SKD components</option><option value="CKD">CKD components</option>
              </select>
            </div>
            {warehouseGroups.map(([whId, group]) => {
              const buildable = buildableByWarehouse.get(whId) ?? []
              const groupItems = group.items.filter(item => category === 'ALL' || (productMeta.get(item.product_id)?.assemblyType ?? 'IMPORTED') === category)
              const maxQty = Math.max(1, ...groupItems.map(i => i.quantity_on_hand))
              return (
                <div key={whId || 'unassigned'}>
                  <div className="inventory-warehouse-heading">
                    <h2 className="text-sm font-medium flex items-center gap-1.5">
                      <LayoutGrid size={14} className="text-gray-400" /> {group.name}
                    </h2>
                    <div><span>{groupItems.length} products · {N(groupItems.reduce((s, i) => s + i.total_value, 0))} ETB</span>{whId && <><Link to={`/warehouse-operations/inventory/${whId}`}><Warehouse size={13} />Inventory</Link><Link to={`/warehouse-operations/floor-plan/${whId}?name=${encodeURIComponent(group.name)}`}><MapIcon size={13} />Floor plan</Link></>}</div>
                  </div>

                  {buildable.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {buildable.map(b => (
                        <div key={b.bomId} className="flex items-center gap-2 px-3 py-2 rounded-card bg-violet-50 border border-violet-200">
                          <Wrench size={14} className="text-violet-600 shrink-0" />
                          <div>
                            <p className="text-xs text-violet-700 font-medium leading-tight">Can build {N(b.buildable)} × {b.productName}</p>
                            <p className="text-xs text-violet-400 leading-tight">from SKD/CKD parts on hand, per active BOM</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {groupItems.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-card">
                      No stock recorded in this warehouse yet.
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {groupItems.map((item, i) => {
                      const isOut      = item.quantity_on_hand <= 0
                      const isCritical = !isOut && item.quantity_on_hand < 5
                      const isLow      = !isOut && !isCritical && item.quantity_on_hand < 20
                      const meta = productMeta.get(item.product_id)
                      const barColor = isOut ? 'bg-red-400' : isCritical ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-green-500'
                      const ringColor = isOut ? 'border-red-200' : isCritical ? 'border-red-200' : isLow ? 'border-amber-200' : 'border-gray-200'
                      return (
                        <Card
                          key={`${whId}:${item.product_id}`}
                          padded
                          className={`inventory-warehouse-card stagger-row !border ${ringColor} flex flex-col gap-2`}
                          style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                        >
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
                          <div className="inventory-card-hover"><span>{meta?.assemblyType ?? 'IMPORTED'} · {N(item.avg_unit_cost_etb)} ETB/unit</span><strong>{N(item.total_value)} ETB value</strong><small>Last movement {item.last_movement_date ? new Date(item.last_movement_date).toLocaleDateString() : 'not recorded'}</small><div><Link to={`/warehouse-transfers?from=${whId}&product=${item.product_id}`}><ArrowRightLeft />Transfer</Link><Link to={`/sales?warehouse=${whId}&product=${item.product_id}`}><ShoppingCart />Sell</Link></div></div>
                        </Card>
                      )
                    })}
                  </div>
                  )}
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
          <Card>
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
                  className={`stagger-row grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 items-center
                              ${i < forecastRows.length - 1 ? 'border-b border-gray-50' : ''} ${urgent ? 'bg-red-50/40' : ''}`}
                  style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}>
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
          </Card>
        )
      )}

      {/* Movements tab */}
      {!loading && tab === 'movements' && (
        <div>
          {inventory.length > 0 && (
            <div className="inventory-history-filters flex items-center gap-2 mb-3">
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
              <select value={movementType} onChange={e => setMovementType(e.target.value)}><option value="ALL">All movement types</option>{Object.keys(MOVE_BADGE).map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select>
              <span>{moves.length} ledger entries</span>
            </div>
          )}

          {moves.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              No movements recorded yet.
            </div>
          ) : (
            <Card>
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
                return (
                  <div
                    key={m.id}
                    className={`stagger-row grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                                items-center
                                ${i < moves.length - 1 ? 'border-b border-gray-50' : ''}`}
                    style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                  >
                    <div>
                      <p className="text-sm font-medium">{prod?.name ?? '—'}</p>
                      {m.notes && <p className="text-xs text-gray-400 mt-0.5">{m.notes}</p>}
                    </div>
                    <div>
                      <Badge variant={MOVE_BADGE[m.movement_type] ?? 'neutral'}>
                        {m.movement_type.replace(/_/g, ' ')}
                      </Badge>
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
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
