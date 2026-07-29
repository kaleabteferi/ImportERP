import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { postInventoryMovement } from '../lib/inventoryReceive'
import { fetchWarehousesList } from '../api/income'
import { createDamageReport, fetchDamageReports } from '../api/damageReports'
import type { DamageReport } from '../api/damageReports'
import { produceAssembly, fetchComponentAvailability } from '../api/production'
import type { ComponentAvailability } from '../api/production'
import { usePageState } from '../lib/pageState'
import { Plus, Wrench, X, Check, Loader2, Package, AlertTriangle, ShieldAlert, Sticker, Boxes, ClipboardList, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'

type BomStage = 'ASSEMBLY' | 'STICKER' | 'OTHER'

const STAGE_INFO: Record<BomStage, { label: string; icon: typeof Wrench }> = {
  ASSEMBLY: { label: 'Assembly', icon: Wrench },
  STICKER: { label: 'Sticker Application', icon: Sticker },
  OTHER: { label: 'Other', icon: Boxes },
}

interface ProductionOrder {
  id: string
  order_number: string
  product_id: string | null
  target_quantity: number
  completed_quantity: number
  status: string
  planned_start_date: string | null
  due_date: string | null
  labor_cost_etb: number
  bom_header_id: string | null
  warehouse_id: string
  bom_headers: { products: { id: string; name: string; sku: string } | null } | null
}

interface DailyLog {
  id: string
  log_date: string
  quantity_produced: number
  production_order_id: string | null
  bom_header_id: string | null
  product_id: string | null
  warehouse_id: string | null
  employee_id: string | null
  notes: string | null
  production_orders?: { order_number: string; bom_headers: { products: { name: string } | null } | null }
  eff_warehouse_id?: string | null
  eff_product_id?: string | null
  capacity_rate?: number | null
}

interface DayMovement {
  id: string
  movement_type: string
  quantity: number
  movement_date: string
  notes: string | null
  products: { name: string; sku: string } | null
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT:       'neutral',
  IN_PROGRESS: 'info',
  COMPLETED:   'success',
  CANCELLED:   'danger',
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

export function Production() {
  const [orders, setOrders]     = useState<ProductionOrder[]>([])
  const [logs, setLogs]         = useState<DailyLog[]>([])
  const [movements, setMovements] = useState<DayMovement[]>([])
  const [salesToday, setSalesToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<'orders' | 'report'>('orders')
  const [logOpen, setLogOpen]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [entries, setEntries]   = useState<Record<string, string>>({})
  const [logDate, setLogDate]   = useState(new Date().toISOString().split('T')[0])
  const [logNotes, setLogNotes] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [bomOptions, setBomOptions] = useState<Array<{ id: string; product_id: string | null; name: string; product_name: string; sku: string; stage: BomStage; imageUrl: string | null }>>([])
  const [bomLinesByHeader, setBomLinesByHeader] = useState<Record<string, { name: string; sku: string; qty: number }[]>>({})
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [selectedBomId, setSelectedBomId] = useState('')
  const [targetQty, setTargetQty] = useState('10')
  const [dueDate, setDueDate] = useState('')
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = usePageState('production.warehouseId', '')
  const [products, setProducts] = useState<Array<{ id: string; name: string; sku: string; image_url: string | null }>>([])
  const [shipments, setShipments] = useState<Array<{ id: string; shipment_number: string }>>([])
  const [damageReports, setDamageReports] = useState<DamageReport[]>([])
  const [damageOpen, setDamageOpen] = useState(false)
  const [damageSaving, setDamageSaving] = useState(false)
  const [damageForm, setDamageForm] = useState({
    productId: '', quantity: '', reason: '', shipmentId: '',
    reportDate: new Date().toISOString().split('T')[0],
  })
  const [bomQuery, setBomQuery] = useState('')
  const [damageQuery, setDamageQuery] = useState('')
  const [factoryEmployees, setFactoryEmployees] = useState<Array<{ id: string; name: string }>>([])
  const [logEmployeeId, setLogEmployeeId] = useState('')
  // "How many more can I actually assemble today?" -- live component-stock
  // preview for ASSEMBLY-stage rows in the log modal, same UX Assembly.tsx
  // already had (and Production's own manual multi-step path lacked).
  const [assemblyAvailability, setAssemblyAvailability] = useState<Record<string, ComponentAvailability[]>>({})

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    try {
      const [ordersRes, logsRes, moveRes, salesRes, productsRes, bomRes, warehouseRows, shipmentsRes, damageRows, capacityRes, bomLinesRes, employeeRows] = await Promise.all([
        supabase.from('production_orders')
          .select('id, order_number, product_id, target_quantity, completed_quantity, status, planned_start_date, due_date, labor_cost_etb, bom_header_id, warehouse_id, created_at, updated_at')
          .in('status', ['DRAFT', 'IN_PROGRESS'])
          .order('created_at', { ascending: false }),
        // production_orders embedded directly (regardless of its status) --
        // a from-scratch assembly run marks its order COMPLETED immediately,
        // so resolving bom_header_id via the DRAFT/IN_PROGRESS-only orders
        // query below would silently drop today's already-logged quantity
        // for that BOM, making today's "Log production" entry look empty
        // even though output was already recorded.
        supabase.from('production_daily_logs')
          .select('id, log_date, quantity_produced, production_order_id, bom_header_id, product_id, warehouse_id, employee_id, notes, created_at, production_orders(order_number, bom_header_id, warehouse_id)')
          .gte('log_date', since)
          .order('log_date', { ascending: false }),
        supabase.from('inventory_ledger')
          .select('id, movement_type, quantity, movement_date, notes, product_id')
          .gte('movement_date', since)
          .in('movement_type', ['SHIPMENT_RECEIVED', 'PRODUCTION_CONSUMED', 'PRODUCTION_OUTPUT', 'SALE', 'DAMAGE'])
          .order('movement_date', { ascending: false }),
        supabase.from('sales_orders')
          .select('total_etb')
          .eq('sale_date', today)
          .in('status', ['INVOICED', 'PAID']),
        supabase.from('products').select('id, name, sku, image_url').order('name'),
        supabase.from('bom_headers').select('id, product_id, name, stage').eq('is_active', true).order('name'),
        fetchWarehousesList(),
        supabase.from('shipments').select('id, shipment_number').order('created_at', { ascending: false }).limit(100),
        fetchDamageReports(50),
        supabase.from('production_capacity').select('warehouse_id, product_id, rated_capacity_per_day, effective_from'),
        supabase.from('bom_lines').select('bom_header_id, component_product_id, quantity_required'),
        supabase.from('employees').select('id, full_name').eq('department', 'manufacturing_sales').eq('is_active', true).order('full_name'),
      ])

      if (ordersRes.error) throw ordersRes.error
      if (logsRes.error) throw logsRes.error
      if (moveRes.error) throw moveRes.error
      if (salesRes.error) throw salesRes.error
      setProducts((productsRes.data ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, image_url: p.image_url })))
      setShipments((shipmentsRes.data ?? []).map((s: any) => ({ id: s.id, shipment_number: s.shipment_number })))
      setDamageReports(damageRows)
      if (productsRes.error) throw productsRes.error
      if (bomRes.error) throw bomRes.error

      const productsById = new Map((productsRes.data ?? []).map((p: any) => [p.id, p]))
      const bomLinesMap: Record<string, { name: string; sku: string; qty: number }[]> = {}
      for (const line of (bomLinesRes.data ?? []) as any[]) {
        const product = productsById.get(line.component_product_id)
        if (!bomLinesMap[line.bom_header_id]) bomLinesMap[line.bom_header_id] = []
        bomLinesMap[line.bom_header_id].push({ name: product?.name ?? 'Unknown component', sku: product?.sku ?? '—', qty: Number(line.quantity_required ?? 0) })
      }
      setBomLinesByHeader(bomLinesMap)
      setFactoryEmployees((employeeRows.data ?? []).map((e: any) => ({ id: e.id, name: e.full_name })))
      const bomRows = (bomRes.data ?? []).map((bom: any) => {
        const product = bom.product_id ? productsById.get(bom.product_id) : null
        return {
          id: bom.id,
          product_id: bom.product_id,
          name: bom.name ?? 'Unnamed BOM',
          product_name: product?.name ?? 'Unassigned product',
          sku: product?.sku ?? '—',
          stage: (bom.stage ?? 'ASSEMBLY') as BomStage,
          imageUrl: product?.image_url ?? null,
        }
      })
      setBomOptions(bomRows)
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setSelectedWarehouseId(prev => prev || (warehouseRows?.[0]?.id ?? ''))
      const orderRows = (ordersRes.data ?? []).map((order: any) => {
        const product = order.product_id ? productsById.get(order.product_id) : null
        return {
          ...order,
          bom_headers: {
            products: product
              ? { id: product.id, name: product.name ?? '—', sku: product.sku ?? '—' }
              : null,
          },
        }
      })

      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

      // Same capacity-rate lookup ManufacturingPerformanceCard uses on the
      // Dashboard — the latest rate effective on or before the log's date,
      // for that exact warehouse+product.
      const capacityRows = capacityRes.data ?? []
      function capacityFor(warehouseId: string | null, productId: string | null, asOf: string): number | null {
        if (!warehouseId || !productId) return null
        const candidates = capacityRows.filter((c: any) =>
          c.warehouse_id === warehouseId && c.product_id === productId && c.effective_from <= asOf)
        if (candidates.length === 0) return null
        candidates.sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))
        return Number(candidates[0].rated_capacity_per_day)
      }

      const logsRows = (logsRes.data ?? []).map((log: any) => {
        const linkedOrder = one(log.production_orders)
        // Product display info resolved via bomRows (every active BOM,
        // unfiltered) rather than orderRows (DRAFT/IN_PROGRESS only) -- a
        // log's linked order may already be COMPLETED.
        const bom = linkedOrder ? bomRows.find(b => b.id === linkedOrder.bom_header_id) : null
        const effWarehouseId = log.warehouse_id ?? linkedOrder?.warehouse_id ?? null
        const effProductId = log.product_id ?? bom?.product_id ?? null
        return {
          ...log,
          production_orders: linkedOrder
            ? {
                order_number: linkedOrder.order_number,
                bom_headers: { products: bom ? { id: bom.product_id, name: bom.product_name, sku: bom.sku } : null },
              }
            : undefined,
          eff_warehouse_id: effWarehouseId,
          eff_product_id: effProductId,
          capacity_rate: capacityFor(effWarehouseId, effProductId, log.log_date),
        }
      })

      const movementRows = (moveRes.data ?? []).map((m: any) => ({
        ...m,
        products: m.product_id ? {
          name: productsById.get(m.product_id)?.name ?? '—',
          sku: productsById.get(m.product_id)?.sku ?? '—',
        } : null,
      }))

      setOrders(orderRows)
      setLogs(logsRows)
      setMovements(movementRows)
      setSalesToday((salesRes.data ?? []).reduce((s, r) => s + (r.total_etb ?? 0), 0))

      const todayLogs = (logsRes.data ?? []).filter((l: any) => l.log_date === today)
      const e: Record<string, string> = {}
      for (const l of todayLogs) {
        const bomHeaderId = l.bom_header_id ?? one(l.production_orders)?.bom_header_id
        if (bomHeaderId) e[bomHeaderId] = String(l.quantity_produced)
      }
      setEntries(e)
    } catch (e: any) {
      console.error(e)
      setOrders([])
      setLogs([])
      setMovements([])
      setSalesToday(0)
      setEntries({})
      setError(e?.message ?? 'Unable to load production data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!logOpen || !selectedWarehouseId) { setAssemblyAvailability({}); return }
    let cancelled = false
    const assemblyBoms = bomOptions.filter(b => b.stage === 'ASSEMBLY')
    Promise.all(assemblyBoms.map(b => fetchComponentAvailability(b.id, selectedWarehouseId).then(a => [b.id, a] as const)))
      .then(pairs => { if (!cancelled) setAssemblyAvailability(Object.fromEntries(pairs)) })
      .catch(() => { if (!cancelled) setAssemblyAvailability({}) })
    return () => { cancelled = true }
  }, [logOpen, selectedWarehouseId, bomOptions])

  function maxAssemblableToday(bomId: string): number | null {
    const availability = assemblyAvailability[bomId]
    if (!availability || availability.length === 0) return null
    return Math.min(...availability.map(a => a.quantityRequired > 0 ? Math.floor(a.available / a.quantityRequired) : Infinity))
  }

  async function submitDamage() {
    const qty = Number(damageForm.quantity)
    if (!damageForm.productId) { setError('Choose which item was damaged.'); return }
    if (!selectedWarehouseId) { setError('Choose a warehouse.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }
    if (!damageForm.reason.trim()) { setError('Add a reason — this becomes part of the record for any supplier claim.'); return }

    setDamageSaving(true); setError(null)
    try {
      await createDamageReport({
        productId: damageForm.productId,
        warehouseId: selectedWarehouseId,
        quantity: qty,
        reason: damageForm.reason,
        shipmentId: damageForm.shipmentId || undefined,
        reportDate: damageForm.reportDate,
      })
      setDamageOpen(false)
      setDamageForm({ productId: '', quantity: '', reason: '', shipmentId: '', reportDate: new Date().toISOString().split('T')[0] })
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to log damage.')
    } finally {
      setDamageSaving(false)
    }
  }

  async function createOrder() {
    setCreatingOrder(true)
    setError(null)

    try {
      if (!selectedBomId) {
        setError('Select a BOM before creating a production order.')
        return
      }

      const bom = bomOptions.find(option => option.id === selectedBomId)
      if (!bom) {
        setError('Selected BOM was not found.')
        return
      }

      const qty = Number(targetQty)
      if (!Number.isFinite(qty) || qty <= 0) {
        setError('Enter a valid production quantity.')
        return
      }

      if (!selectedWarehouseId) {
        setError('Select which warehouse this production order belongs to.')
        return
      }

      const orderNumber = `PROD-${Date.now().toString().slice(-6)}`
      const { error: insertError } = await supabase.from('production_orders').insert({
        order_number: orderNumber,
        product_id: bom.product_id,
        bom_header_id: bom.id,
        warehouse_id: selectedWarehouseId,
        target_quantity: qty,
        completed_quantity: 0,
        status: 'DRAFT',
        planned_start_date: new Date().toISOString().split('T')[0],
        due_date: dueDate || null,
        labor_cost_etb: 0,
      })

      if (insertError) throw insertError

      setCreateOpen(false)
      setDueDate('')
      setSelectedBomId('')
      setTargetQty('10')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Unable to create production order.')
    } finally {
      setCreatingOrder(false)
    }
  }

  // Withdraws a BOM's components for `delta` extra units produced, at the
  // given warehouse. Shared by both the order-linked and order-less paths.
  // Read-only pre-flight check, run before ANY writes for a log entry. Without
  // this, insufficient component stock was only discovered inside
  // consumeBomComponents — by which point the finished-goods PRODUCTION_OUTPUT
  // movement (and the daily-log/production-order rows) had already been
  // written, leaving phantom finished units in inventory with nothing consumed
  // to make them.
  async function checkBomComponentsAvailable(bomHeaderId: string, warehouseId: string, delta: number) {
    const { data: bomLines } = await supabase
      .from('bom_lines')
      .select('component_product_id, quantity_required')
      .eq('bom_header_id', bomHeaderId)

    for (const line of bomLines ?? []) {
      const needed = line.quantity_required * delta
      const { data: ledgerRows } = await supabase
        .from('inventory_ledger')
        .select('quantity')
        .eq('product_id', line.component_product_id)
        .eq('warehouse_id', warehouseId)
      const available = (ledgerRows ?? []).reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)

      if (available < needed) {
        throw new Error(
          `Not enough component stock at this warehouse to log ${delta} units — ` +
          `have ${available}, need ${needed}.`
        )
      }
    }
  }

  async function consumeBomComponents(bomHeaderId: string, warehouseId: string, delta: number, refType: string, refId: string, label: string) {
    const { data: bomLines } = await supabase
      .from('bom_lines')
      .select('component_product_id, quantity_required')
      .eq('bom_header_id', bomHeaderId)

    for (const line of bomLines ?? []) {
      const needed = line.quantity_required * delta

      const { data: ledgerRows } = await supabase
        .from('inventory_ledger')
        .select('quantity')
        .eq('product_id', line.component_product_id)
        .eq('warehouse_id', warehouseId)
      const available = (ledgerRows ?? []).reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)

      if (available < needed) {
        throw new Error(
          `Not enough component stock at this warehouse to log ${delta} units — ` +
          `have ${available}, need ${needed}.`
        )
      }

      await postInventoryMovement({
        product_id: line.component_product_id,
        quantity: -needed,
        movement_type: 'PRODUCTION_CONSUMED',
        movement_date: logDate,
        warehouse_id: warehouseId,
        notes: `Withdrawn for ${label}`,
        reference_type: refType,
        reference_id: refId,
      })
    }
  }

  async function saveLog() {
    setSaving(true)
    setError(null)

    if (!selectedWarehouseId) { setError('Choose a warehouse.'); setSaving(false); return }

    const toLog = bomOptions.filter(bom => Number(entries[bom.id] ?? '0') > 0)
    if (!toLog.length) { setError('Enter a quantity for at least one item.'); setSaving(false); return }

    try {
      for (const bom of toLog) {
        const qty = parseInt(entries[bom.id] ?? '0')
        if (qty <= 0 || !bom.product_id) continue

        // Assembly-stage BOMs log through the same atomic RPC Assembly.tsx
        // uses (one DB transaction: find-or-reuse order, upsert today's
        // log, update completed_quantity, post output, consume components)
        // instead of the several sequential client-side steps below --
        // safer under concurrent submits. Sticker/Other stages keep using
        // the manual multi-step path since produce_assembly is scoped to
        // stage='ASSEMBLY' BOMs only.
        if (bom.stage === 'ASSEMBLY') {
          // Resolve today's already-logged quantity via the order regardless
          // of its status -- a from-scratch run marks its order COMPLETED
          // immediately, so a plain DRAFT/IN_PROGRESS-only lookup would miss
          // it and treat this edit as a fresh full amount instead of a delta.
          const { data: existingLog } = await supabase
            .from('production_daily_logs')
            .select('quantity_produced, production_orders!inner(bom_header_id, warehouse_id)')
            .eq('log_date', logDate)
            .eq('production_orders.bom_header_id', bom.id)
            .eq('production_orders.warehouse_id', selectedWarehouseId)
            .maybeSingle()
          const prevQty = existingLog?.quantity_produced ?? 0
          const delta = qty - prevQty
          if (delta === 0) continue
          if (delta < 0) throw new Error(`Cannot reduce ${bom.product_name}'s logged quantity below what's already recorded — remove the excess directly from the order instead.`)
          await produceAssembly(selectedWarehouseId, bom.product_id, delta, undefined, logNotes || undefined, logDate, logEmployeeId || undefined)
          continue
        }

        // Prefer an existing open order for this BOM at this warehouse (so
        // due-date/target tracking keeps working) — but an order is not
        // required. Without one, the log stands alone.
        const order = orders.find(o =>
          o.bom_header_id === bom.id && o.warehouse_id === selectedWarehouseId &&
          ['DRAFT', 'IN_PROGRESS'].includes(o.status) && o.target_quantity > o.completed_quantity,
        )
        const warehouseId = order?.warehouse_id ?? selectedWarehouseId

        const { data: existing } = order
          ? await supabase.from('production_daily_logs')
              .select('id, quantity_produced')
              .eq('production_order_id', order.id)
              .eq('log_date', logDate)
              .maybeSingle()
          : await supabase.from('production_daily_logs')
              .select('id, quantity_produced')
              .eq('bom_header_id', bom.id)
              .eq('warehouse_id', selectedWarehouseId)
              .eq('log_date', logDate)
              .is('production_order_id', null)
              .maybeSingle()

        const prevQty = existing?.quantity_produced ?? 0
        const delta   = qty - prevQty

        // Validate component stock before writing anything — finished-goods
        // credit and log/order rows must not land if the components to make
        // them don't actually exist at this warehouse.
        if (delta > 0) await checkBomComponentsAvailable(bom.id, warehouseId, delta)

        if (existing) {
          const { error: updErr } = await supabase.from('production_daily_logs')
            .update({ quantity_produced: qty, notes: logNotes || null, employee_id: logEmployeeId || null })
            .eq('id', existing.id)
          if (updErr) throw updErr
        } else {
          const { error: insErr } = await supabase.from('production_daily_logs').insert({
            production_order_id: order?.id ?? null,
            bom_header_id: order ? null : bom.id,
            product_id: order ? null : bom.product_id,
            warehouse_id: order ? null : selectedWarehouseId,
            log_date: logDate,
            quantity_produced: qty,
            notes: logNotes || null,
            employee_id: logEmployeeId || null,
          })
          if (insErr) throw insErr
        }

        if (delta === 0) continue

        const label = order ? order.order_number : `${bom.name} (${logDate})`
        const refType = order ? 'production_order' : 'production_log'
        const refId = order ? order.id : bom.id

        if (order) {
          const newCompleted = Math.min(
            order.target_quantity,
            Math.max(0, order.completed_quantity + delta),
          )
          const { error: ordErr } = await supabase.from('production_orders').update({
            completed_quantity: newCompleted,
            status: newCompleted >= order.target_quantity ? 'COMPLETED' : 'IN_PROGRESS',
          }).eq('id', order.id)
          if (ordErr) throw ordErr
        }

        // Finished goods into inventory (net zero for STICKER-stage BOMs
        // where the product consumed and produced are the same item —
        // still correctly decrements the sticker component below).
        await postInventoryMovement({
          product_id: bom.product_id,
          quantity: delta,
          movement_type: 'PRODUCTION_OUTPUT',
          movement_date: logDate,
          warehouse_id: warehouseId,
          notes: `${STAGE_INFO[bom.stage].label} output · ${label}`,
          reference_type: refType,
          reference_id: refId,
        })

        if (delta > 0) {
          await consumeBomComponents(bom.id, warehouseId, delta, refType, refId, label)
        }
      }

      setLogOpen(false)
      setLogNotes('')
      setLogEmployeeId('')
      setEntries({})
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const activeOrders = orders.filter(o =>
    ['DRAFT', 'IN_PROGRESS'].includes(o.status) && o.target_quantity > o.completed_quantity,
  )
  const todayStr     = new Date().toISOString().split('T')[0]
  const isLate = (o: ProductionOrder) => !!o.due_date && o.due_date < todayStr
  const lateOrders = activeOrders.filter(isLate)
  const totalToday = logs
    .filter(l => l.log_date === todayStr)
    .reduce((s, l) => s + l.quantity_produced, 0)

  // How many units per day an order needs to hit its due date — null when
  // there's no due date to pace against. Inclusive of both the start and
  // due day, so a 1-day order (start === due) still divides by 1, not 0.
  function dailyGoal(o: ProductionOrder): number | null {
    if (!o.due_date) return null
    const start = o.planned_start_date ? new Date(o.planned_start_date) : new Date()
    const due = new Date(o.due_date)
    const days = Math.max(1, Math.round((due.getTime() - start.getTime()) / 86400000) + 1)
    return o.target_quantity / days
  }
  const totalDailyGoal = activeOrders.reduce((s, o) => s + (dailyGoal(o) ?? 0), 0)
  const todayEfficiencyPct = totalDailyGoal > 0 ? Math.round((totalToday / totalDailyGoal) * 100) : null

  const withdrawals = movements.filter(m => m.movement_type === 'PRODUCTION_CONSUMED')
  const outputs     = movements.filter(m => m.movement_type === 'PRODUCTION_OUTPUT')
  const salesMoves  = movements.filter(m => m.movement_type === 'SALE')

  return (
    <div className="p-5 max-w-4xl mx-auto">

      <PageHeader
        title="Production"
        subtitle={<>
          {activeOrders.length} open orders
          {totalToday > 0 && ` · ${N(totalToday)} units logged today`}
          {todayEfficiencyPct !== null && (
            <span className={`font-medium ${todayEfficiencyPct >= 100 ? 'text-green-600' : todayEfficiencyPct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
              {' '}· {todayEfficiencyPct}% of today's goal
            </span>
          )}
          {lateOrders.length > 0 && (
            <span className="text-red-600 font-medium"> · {lateOrders.length} late</span>
          )}
        </>}
        actions={<>
          <div className="flex gap-1">
            {(['orders', 'report'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize
                  ${tab === t
                    ? 'bg-accent text-accent-foreground border-accent font-medium'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {t === 'orders' ? 'Assembly lines' : 'Daily report'}
              </button>
            ))}
          </div>
          <Button variant="secondary" icon={<ClipboardList size={13} />}
            title="Optional — for target-tracked runs with a due date. Not required to log daily output."
            onClick={() => { setCreateOpen(v => !v); setError(null) }}>New order</Button>
          <Button icon={<ShieldAlert size={13} />} className="!bg-amber-600 !text-white hover:!brightness-95"
            onClick={() => { setDamageOpen(true); setError(null) }}>Log damage</Button>
          <Button icon={<Plus size={13} />} onClick={() => { setLogOpen(true); setError(null) }}>Log production</Button>
        </>}
      />

      {createOpen && (
        <div className="mb-4 rounded-card border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-blue-900">Create production order from BOM</h3>
              <p className="text-sm text-blue-700">SKD and CKD receipts feed component stock for the assembly line before you log output.</p>
            </div>
            <button onClick={() => setCreateOpen(false)} className="rounded-lg p-2 text-blue-700 hover:bg-blue-100">
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <label className="text-sm text-blue-900">
              BOM
              <select value={selectedBomId} onChange={e => setSelectedBomId(e.target.value)} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">
                <option value="">Select a BOM</option>
                {bomOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.product_name} ({option.sku})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-blue-900">
              Warehouse
              <select value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">
                <option value="">Select warehouse</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-blue-900">
              Target quantity
              <input value={targetQty} onChange={e => setTargetQty(e.target.value)} type="number" min="1" className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-blue-900">
              Due date
              <input value={dueDate} onChange={e => setDueDate(e.target.value)} type="date" className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
            </label>
            <button onClick={createOrder} disabled={creatingOrder} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-70 self-end">
              {creatingOrder ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && tab === 'orders' && orders.length === 0 && (
        <div className="text-center py-16">
          <Wrench size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No open production orders</p>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Orders are optional — use "Log production" to record daily output directly.
            Create an order only when you want to track progress against a target/due date.
          </p>
        </div>
      )}

      {!loading && tab === 'orders' && orders.length > 0 && (
        <div className="space-y-5">
          {(['ASSEMBLY', 'STICKER', 'OTHER'] as BomStage[]).map(stage => {
            const stageOrders = orders.filter(o => (bomOptions.find(b => b.id === o.bom_header_id)?.stage ?? 'ASSEMBLY') === stage)
            if (stageOrders.length === 0) return null
            const info = STAGE_INFO[stage]
            return (
              <div key={stage}>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                  <info.icon size={13} /> {info.label} ({stageOrders.length})
                </p>
                <div className="space-y-3">
                  {stageOrders.map(order => {
                    const prod     = order.bom_headers?.products
                    const pct      = order.target_quantity > 0
                      ? Math.min(100, Math.round(order.completed_quantity / order.target_quantity * 100))
                      : 0
                    const todayLog = logs.find(l =>
                      l.production_order_id === order.id && l.log_date === todayStr)
                    const barColor = pct >= 100
                      ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-400'
                    const remaining = order.target_quantity - order.completed_quantity
                    const goal = dailyGoal(order)
                    const effPct = goal && goal > 0 ? Math.round(((todayLog?.quantity_produced ?? 0) / goal) * 100) : null

                    const rail = isLate(order) ? 'border-l-red-400' : pct >= 100 ? 'border-l-green-400' : pct >= 50 ? 'border-l-blue-400' : 'border-l-amber-400'
                    const components = bomLinesByHeader[order.bom_header_id ?? ''] ?? []
                    const orderExpanded = expandedOrderId === order.id
                    return (
                      <Card padded key={order.id} className={`border-l-[3px] ${rail}`}>
                        <div className="flex items-start justify-between mb-3">
                          <button
                            onClick={() => setExpandedOrderId(orderExpanded ? null : order.id)}
                            className="flex items-start gap-1.5 text-left"
                          >
                            {orderExpanded ? <ChevronDown size={14} className="text-gray-300 shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-gray-300 shrink-0 mt-0.5" />}
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">
                                  {prod?.name ?? 'Unknown product'}
                                </span>
                                <Badge variant={STATUS_VARIANT[order.status] ?? 'neutral'}>
                                  {STATUS_LABEL[order.status] ?? order.status}
                                </Badge>
                                {isLate(order) && (
                                  <Badge variant="danger" icon={<AlertTriangle size={10} />}>Late</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                {order.order_number}
                                {prod?.sku && ` · ${prod.sku}`}
                                {` · ${warehouses.find(w => w.id === order.warehouse_id)?.name ?? 'Unknown warehouse'}`}
                                {order.due_date && (
                                  <span className={isLate(order) ? 'text-red-600 font-medium' : ''}>
                                    {` · due ${order.due_date}`}
                                  </span>
                                )}
                                {components.length > 0 && ` · ${components.length} component${components.length === 1 ? '' : 's'}`}
                              </p>
                            </div>
                          </button>
                          <div className="text-right">
                            <p className="text-2xl font-medium font-mono text-blue-700">{pct}%</p>
                            <p className="text-xs text-gray-400">complete</p>
                          </div>
                        </div>
                        {orderExpanded && (
                          <div className="mb-3 bg-gray-50 rounded-lg px-3 py-2.5">
                            <p className="text-xs font-medium text-gray-500 mb-1.5">Assembly components (per unit)</p>
                            {components.length === 0 ? (
                              <p className="text-xs text-gray-400">No BOM components recorded for this assembly.</p>
                            ) : (
                              <div className="space-y-1">
                                {components.map((c, ci) => (
                                  <div key={ci} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-600">{c.name} <span className="text-gray-400 font-mono">({c.sku})</span></span>
                                    <span className="font-mono text-gray-500">{c.qty} per unit</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                               style={{ width: `${pct}%` }} />
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {[
                            { label: 'Target',    val: N(order.target_quantity) },
                            { label: 'Done',      val: N(order.completed_quantity) },
                            { label: 'Remaining', val: N(remaining) },
                            { label: 'Today',     val: todayLog ? N(todayLog.quantity_produced) : '—', sub: goal ? `of ${N(Math.ceil(goal))} goal` : undefined },
                            { label: 'Efficiency', val: effPct !== null ? `${effPct}%` : '—', tone: effPct === null ? undefined : effPct >= 100 ? 'good' : effPct >= 70 ? 'warn' : 'bad' },
                          ].map(stat => (
                            <div key={stat.label}
                                 className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                              <p className="text-xs text-gray-400 mb-1">{stat.label}</p>
                              <p className={`text-sm font-medium font-mono ${
                                stat.tone === 'good' ? 'text-green-600' : stat.tone === 'warn' ? 'text-amber-600' : stat.tone === 'bad' ? 'text-red-600' : ''
                              }`}>{stat.val}</p>
                              {stat.sub && <p className="text-[10px] text-gray-400">{stat.sub}</p>}
                            </div>
                          ))}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'report' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Produced today" value={`${N(totalToday)} units`} />
            <StatCard label="Sales today" value={`${N(salesToday)} ETB`} />
            <StatCard label="Withdrawals (30d)" value={String(withdrawals.length)} />
            <StatCard label="Damage reports (30d)" value={String(damageReports.length)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
                Efficiency by warehouse (last 30 days)
              </div>
              {(() => {
                const byWarehouse = new Map<string, { name: string; units: number; effSum: number; effCount: number }>()
                for (const l of logs) {
                  const id = l.eff_warehouse_id ?? 'unknown'
                  const name = warehouses.find(w => w.id === l.eff_warehouse_id)?.name ?? 'Unknown warehouse'
                  const entry = byWarehouse.get(id) ?? { name, units: 0, effSum: 0, effCount: 0 }
                  entry.units += l.quantity_produced
                  if (l.capacity_rate && l.capacity_rate > 0) {
                    entry.effSum += (l.quantity_produced / l.capacity_rate) * 100
                    entry.effCount += 1
                  }
                  byWarehouse.set(id, entry)
                }
                const rows = [...byWarehouse.values()].sort((a, b) => b.units - a.units)
                return rows.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-gray-400 text-center">No production logged in the last 30 days</p>
                ) : rows.map((r, i) => (
                  <div key={r.name} className={`flex items-center justify-between px-4 py-2.5 text-xs ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <span className="text-gray-700 font-medium">{r.name}</span>
                    <div className="flex items-center gap-2">
                      {r.effCount > 0 && (
                        <Badge variant={r.effSum / r.effCount >= 100 ? 'success' : r.effSum / r.effCount >= 70 ? 'warning' : 'danger'}>
                          {Math.round(r.effSum / r.effCount)}% avg eff.
                        </Badge>
                      )}
                      <span className="font-mono font-medium">{N(r.units)} units</span>
                    </div>
                  </div>
                ))
              })()}
            </Card>

            <Card>
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
                Output by worker (last 30 days)
              </div>
              {(() => {
                const attributed = logs.filter(l => l.employee_id)
                const byEmployee = new Map<string, { name: string; units: number; days: Set<string> }>()
                for (const l of attributed) {
                  const id = l.employee_id as string
                  const name = factoryEmployees.find(e => e.id === id)?.name ?? 'Unknown worker'
                  const entry = byEmployee.get(id) ?? { name, units: 0, days: new Set<string>() }
                  entry.units += l.quantity_produced
                  entry.days.add(l.log_date)
                  byEmployee.set(id, entry)
                }
                const rows = [...byEmployee.values()].sort((a, b) => b.units - a.units)
                return rows.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-gray-400 text-center">
                    No logs attributed to a specific worker yet — pick a worker in "Log production" to start tracking this.
                  </p>
                ) : rows.map((r, i) => (
                  <div key={r.name} className={`flex items-center justify-between px-4 py-2.5 text-xs ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <span className="text-gray-700 font-medium">{r.name}</span>
                    <div className="text-right">
                      <p className="font-mono font-medium">{N(r.units)} units</p>
                      <p className="text-gray-400">{r.days.size} day{r.days.size === 1 ? '' : 's'} · {N(r.units / r.days.size)}/day avg</p>
                    </div>
                  </div>
                ))
              })()}
            </Card>
          </div>

          <Card>
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
              Production logs (last 30 days) — with calculated efficiency vs. each warehouse/product's rated capacity
            </div>
            {logs.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No logs yet</p>
            ) : logs.map((l, i) => {
              const rate = l.capacity_rate ?? null
              const effPct = rate && rate > 0 ? Math.round((l.quantity_produced / rate) * 100) : null
              const warehouseName = warehouses.find(w => w.id === l.eff_warehouse_id)?.name
              const orderNumber = (l.production_orders as any)?.order_number
              return (
                <div key={l.id}
                     className={`stagger-row flex items-center justify-between px-4 py-2.5 text-xs
                       ${i < logs.length - 1 ? 'border-b border-gray-50' : ''}`}
                     style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}>
                  <div className="min-w-0">
                    <span className="text-gray-700 font-medium">
                      {(l.production_orders as any)?.bom_headers?.products?.name ?? '—'}
                    </span>
                    <p className="text-gray-400 mt-0.5">
                      {l.log_date}
                      {warehouseName && ` · ${warehouseName}`}
                      {orderNumber && ` · ${orderNumber}`}
                      {rate != null && ` · goal ${N(rate)}/day`}
                      {l.notes && ` · ${l.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {effPct !== null && (
                      <Badge variant={effPct >= 100 ? 'success' : effPct >= 70 ? 'warning' : 'danger'}>{effPct}% eff.</Badge>
                    )}
                    <span className="font-mono font-medium">{N(l.quantity_produced)} units</span>
                  </div>
                </div>
              )
            })}
          </Card>

          <Card>
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <ShieldAlert size={12} className="text-amber-500" /> Damage reports
            </div>
            {damageReports.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No damage logged</p>
            ) : damageReports.map((d, i) => (
              <div key={d.id}
                   className={`stagger-row flex items-center justify-between px-4 py-2.5 text-xs
                     ${i < damageReports.length - 1 ? 'border-b border-gray-50' : ''}`}
                   style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}>
                <span className="text-gray-600">
                  {d.report_date} · {products.find(p => p.id === d.product_id)?.name ?? '—'} · {d.reason}
                  {d.shipment_id && ` · ${shipments.find(s => s.id === d.shipment_id)?.shipment_number ?? ''}`}
                </span>
                <span className="font-mono font-medium text-red-600">-{N(d.quantity)}</span>
              </div>
            ))}
          </Card>

          <Card>
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
              Warehouse withdrawals & sales
            </div>
            {[...withdrawals, ...outputs, ...salesMoves].length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No movements recorded</p>
            ) : [...withdrawals, ...outputs, ...salesMoves]
              .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
              .map((m, i, arr) => (
                <div key={m.id}
                     className={`stagger-row flex items-center justify-between px-4 py-2.5 text-xs
                       ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}
                     style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}>
                  <span className="text-gray-600">
                    {m.movement_date} · {m.products?.name ?? '—'} ·{' '}
                    <span className={
                      m.movement_type === 'SALE' ? 'text-red-600'
                        : m.movement_type === 'PRODUCTION_OUTPUT' ? 'text-green-600'
                        : 'text-amber-600'
                    }>
                      {m.movement_type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </span>
                  <span className={`font-mono font-medium ${m.quantity < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {m.quantity > 0 ? '+' : ''}{N(m.quantity)}
                  </span>
                </div>
              ))}
          </Card>
        </div>
      )}

      {/* Log Modal — tap items, no production order required */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log production"
        footer={<>
          <Button variant="secondary" onClick={() => setLogOpen(false)}>Cancel</Button>
          <Button loading={saving} disabled={bomOptions.length === 0} icon={<Check size={12} />} onClick={saveLog}>Save</Button>
        </>}
      >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Log date</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={logDate}
                    onChange={e => setLogDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={selectedWarehouseId}
                    onChange={e => setSelectedWarehouseId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Worker (optional — for per-employee output tracking)</label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={logEmployeeId}
                  onChange={e => setLogEmployeeId(e.target.value)}
                >
                  <option value="">Not attributed to one worker</option>
                  {factoryEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              {bomOptions.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
                  No BOMs set up yet — add one under BOMs first.
                </div>
              ) : (
                <div className="space-y-4">
                  {bomOptions.length > 6 && (
                    <div className="relative">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={bomQuery} onChange={e => setBomQuery(e.target.value)} placeholder="Search products…"
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                    </div>
                  )}
                  {(['ASSEMBLY', 'STICKER', 'OTHER'] as BomStage[]).map(stage => {
                    const stageBoms = bomOptions.filter(b => b.stage === stage && b.product_name.toLowerCase().includes(bomQuery.toLowerCase()))
                    if (stageBoms.length === 0) return null
                    const info = STAGE_INFO[stage]
                    return (
                      <div key={stage}>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <info.icon size={12} /> {info.label}
                        </p>
                        <div className="space-y-2">
                          {stageBoms.map(bom => {
                            const order = orders.find(o =>
                              o.bom_header_id === bom.id && o.warehouse_id === selectedWarehouseId &&
                              ['DRAFT', 'IN_PROGRESS'].includes(o.status) && o.target_quantity > o.completed_quantity,
                            )
                            const remaining = order ? order.target_quantity - order.completed_quantity : null
                            const maxAssemblable = stage === 'ASSEMBLY' ? maxAssemblableToday(bom.id) : null
                            return (
                              <div key={bom.id} className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                                  {bom.imageUrl ? <img src={bom.imageUrl} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-gray-300" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{bom.product_name}</p>
                                  {remaining !== null && <p className="text-xs text-blue-600">order open · max {N(remaining)}</p>}
                                  {maxAssemblable !== null && isFinite(maxAssemblable) && (
                                    <p className={`text-xs ${maxAssemblable > 0 ? 'text-gray-400' : 'text-red-500'}`}>
                                      component stock allows up to {N(maxAssemblable)} today
                                    </p>
                                  )}
                                </div>
                                <input
                                  type="number" min="0" max={remaining ?? undefined}
                                  value={entries[bom.id] ?? ''}
                                  onChange={e => setEntries(p => ({ ...p, [bom.id]: e.target.value }))}
                                  placeholder="0"
                                  className="w-20 px-2.5 py-2 text-sm font-mono border border-gray-200 rounded-lg text-center"
                                />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                />
              </div>
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}
            </div>
      </Modal>

      {/* Damage Modal */}
      {damageOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setDamageOpen(false)}
        >
          <div className="bg-white rounded-card w-full max-w-md max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium flex items-center gap-1.5"><ShieldAlert size={15} className="text-amber-600" /> Log damage</h2>
              <button onClick={() => setDamageOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Item</label>
                {products.length > 6 && (
                  <div className="relative mb-1.5">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={damageQuery} onChange={e => setDamageQuery(e.target.value)} placeholder="Search products…"
                      className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto p-1">
                  {products.filter(p => p.name.toLowerCase().includes(damageQuery.toLowerCase()) || p.sku?.toLowerCase().includes(damageQuery.toLowerCase())).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDamageForm(f => ({ ...f, productId: p.id }))}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border text-center
                        ${damageForm.productId === p.id ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-gray-300" />}
                      </div>
                      <span className="text-[10px] leading-tight line-clamp-2">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    value={damageForm.quantity} onChange={e => setDamageForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    value={damageForm.reportDate} onChange={e => setDamageForm(f => ({ ...f, reportDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={damageForm.reason} onChange={e => setDamageForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. crushed carton, water damage on arrival" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From shipment (optional)</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={damageForm.shipmentId} onChange={e => setDamageForm(f => ({ ...f, shipmentId: e.target.value }))}>
                  <option value="">Not linked</option>
                  {shipments.map(s => <option key={s.id} value={s.id}>{s.shipment_number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)}>
                  <option value="">Select warehouse</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setDamageOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submitDamage} disabled={damageSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700 disabled:opacity-50 min-w-[110px] justify-center">
                {damageSaving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Log damage'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}