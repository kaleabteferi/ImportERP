import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Calculator, Loader2, Lock, AlertTriangle, ArrowRight } from 'lucide-react'

interface ShipmentCostRow {
  id: string
  shipment_number: string
  container_number: string | null
  status: string
  allocation_method: string
  suppliers: { name: string } | null
  item_count: number
  expense_total_etb: number
  provisional_count: number
  has_landed_costs: boolean
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const STATUS: Record<string, string> = {
  ORDERED: 'Ordered', IN_PRODUCTION: 'In production', SHIPPED: 'Shipped',
  AT_DJIBOUTI: 'At Djibouti', IN_TRANSIT: 'In transit', AT_CUSTOMS: 'At customs',
  WAREHOUSE_RECEIVED: 'Received', COMPLETED: 'Completed',
}

export function CostEngine() {
  const [rows, setRows]       = useState<ShipmentCostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fxRate, setFxRate]   = useState(131.20)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [shRes, itemsRes, expRes, fxRes] = await Promise.all([
        supabase.from('shipments')
          .select('id, shipment_number, container_number, status, allocation_method, suppliers(name)')
          .order('created_at', { ascending: false }),
        supabase.from('shipment_items')
          .select('shipment_id, unit_landed_cost_etb, cost_status'),
        supabase.from('shipment_expenses')
          .select('shipment_id, amount_etb, cost_status'),
        supabase.from('forex_rates').select('rate')
          .eq('from_currency', 'USD').eq('to_currency', 'ETB').eq('rate_type', 'CUSTOMS')
          .order('effective_date', { ascending: false }).limit(1),
      ])

      setFxRate(fxRes.data?.[0]?.rate ?? 131.20)

      const itemsByShip = new Map<string, typeof itemsRes.data>()
      for (const item of itemsRes.data ?? []) {
        const list = itemsByShip.get(item.shipment_id) ?? []
        list.push(item)
        itemsByShip.set(item.shipment_id, list)
      }

      const expByShip = new Map<string, typeof expRes.data>()
      for (const exp of expRes.data ?? []) {
        const list = expByShip.get(exp.shipment_id) ?? []
        list.push(exp)
        expByShip.set(exp.shipment_id, list)
      }

      const mapped: ShipmentCostRow[] = (shRes.data ?? []).map((s: any) => {
        const items = itemsByShip.get(s.id) ?? []
        const exps  = expByShip.get(s.id) ?? []
        return {
          id: s.id,
          shipment_number: s.shipment_number,
          container_number: s.container_number,
          status: s.status,
          allocation_method: s.allocation_method,
          suppliers: Array.isArray(s.suppliers) ? s.suppliers[0] ?? null : s.suppliers,
          item_count: items.length,
          expense_total_etb: exps.reduce((sum, e) => sum + (e.amount_etb ?? 0), 0),
          provisional_count: exps.filter(e => e.cost_status === 'PROVISIONAL').length,
          has_landed_costs: items.some(i => i.unit_landed_cost_etb),
        }
      })

      setRows(mapped)
      setLoading(false)
    }
    load()
  }, [])

  const needsCalc    = rows.filter(r => r.item_count > 0 && !r.has_landed_costs)
  const needsFinalize = rows.filter(r => r.has_landed_costs && r.provisional_count > 0)
  const ready        = rows.filter(r => r.has_landed_costs && r.provisional_count === 0)

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Calculator size={18} /> Cost Engine
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Landed cost overview across all shipments · Customs rate {fxRate} ETB/USD
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Needs calculation', val: needsCalc.length, color: 'text-amber-700' },
          { label: 'Ready to finalize', val: needsFinalize.length, color: 'text-blue-700' },
          { label: 'Costs locked', val: ready.length, color: 'text-green-700' },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={`text-xl font-medium font-mono ${s.color}`}>{s.val}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100 text-xs font-medium
                          text-gray-400 uppercase tracking-wide">
            <div>Shipment</div>
            <div>Status</div>
            <div className="text-right">Items</div>
            <div className="text-right">Expenses</div>
            <div className="text-right">Costs</div>
            <div></div>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3
                          items-center text-sm
                          ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}
            >
              <div>
                <Link to={`/shipments/${r.id}`} className="font-medium text-blue-700 hover:underline">
                  {r.shipment_number}
                </Link>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.suppliers?.name ?? '—'}
                  {r.container_number && ` · ${r.container_number}`}
                </p>
              </div>
              <div className="text-xs text-gray-600">{STATUS[r.status] ?? r.status}</div>
              <div className="text-right font-mono text-xs">{r.item_count}</div>
              <div className="text-right font-mono text-xs">{N(r.expense_total_etb)} ETB</div>
              <div className="text-right">
                {r.has_landed_costs ? (
                  r.provisional_count > 0 ? (
                    <span className="text-xs text-amber-700 flex items-center justify-end gap-1">
                      <AlertTriangle size={11} /> Provisional
                    </span>
                  ) : (
                    <span className="text-xs text-green-700">Final</span>
                  )
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Link
                  to={`/shipments/${r.id}`}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg
                             hover:bg-gray-50 text-gray-600"
                >
                  Open
                </Link>
                {r.has_landed_costs && r.provisional_count > 0 && (
                  <Link
                    to={`/shipments/${r.id}/finalize`}
                    className="text-xs px-2 py-1 bg-amber-50 border border-amber-200
                               rounded-lg text-amber-700 flex items-center gap-1"
                  >
                    <Lock size={10} /> Finalize
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
        <ArrowRight size={12} className="mt-0.5 shrink-0" />
        <span>
          Open any shipment → add PI items and expenses → click Recalculate →
          Finalize when all invoices are confirmed. Demurrage and customs taxes
          auto-sync to expenses without creating duplicates.
        </span>
      </div>
    </div>
  )
}
