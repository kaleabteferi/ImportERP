import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { calculateInventoryBalances, type InventoryBalance } from '../lib/inventoryLedger'
import { Package, AlertTriangle, Loader2 } from 'lucide-react'

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
  const [tab, setTab]             = useState<'stock' | 'movements'>('stock')
  const [filterProd, setFilterProd] = useState('')

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

  useEffect(() => { load() }, [])

  const totalValue = inventory.reduce((s, i) => s + i.total_value, 0)
  const lowStock   = inventory.filter(i => i.quantity_on_hand < 20)
  const moves      = filterProd
    ? movements.filter(m => (m.products as any)?.name === filterProd)
    : movements

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

      {!loading && lowStock.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200
                        rounded-xl text-xs text-red-700 mb-4">
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

              {inventory.map((item, i) => {
                const isLow      = item.quantity_on_hand < 20
                const isCritical = item.quantity_on_hand < 5
                return (
                  <div
                    key={item.product_id}
                    className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                                items-center
                                ${i < inventory.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{item.product_name}</p>
                      <p className="text-xs font-mono text-gray-400 mt-0.5">{item.sku}</p>
                    </div>
                    <div className="text-sm text-gray-600">{item.warehouse_name}</div>
                    <div className="text-right">
                      <p className={`text-sm font-medium font-mono
                        ${isCritical ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-gray-900'}`}>
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
                        ${isCritical
                          ? 'bg-red-50 text-red-700'
                          : isLow
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-green-50 text-green-700'}`}>
                        {isCritical ? 'Critical' : isLow ? 'Low' : 'OK'}
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
                  {N(inventory.reduce((s, i) => s + i.quantity_on_hand, 0))}
                </div>
                <div />
                <div className="text-right font-mono text-blue-700">
                  {N(totalValue)} ETB
                </div>
                <div />
              </div>
            </div>
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
                {inventory.map(i => (
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