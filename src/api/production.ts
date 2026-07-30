// src/api/production.ts
import { supabase } from '../lib/supabase'
import { fetchDamageReports } from './damageReports'
import type { DamageReport } from './damageReports'

export async function produceAssembly(
  warehouseId: string,
  finishedProductId: string,
  quantity: number,
  loggedBy?: string,
  notes?: string,
  logDate?: string,
  employeeId?: string,
) {
  const { data, error } = await supabase.rpc('produce_assembly', {
    p_warehouse_id: warehouseId,
    p_finished_product_id: finishedProductId,
    p_quantity: quantity,
    p_logged_by: loggedBy ?? null,
    p_notes: notes ?? null,
    p_log_date: logDate ?? new Date().toISOString().split('T')[0],
    p_employee_id: employeeId ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}

export interface AssemblableProduct { bomHeaderId: string; productId: string; productName: string }

export async function fetchAssemblableProducts(): Promise<AssemblableProduct[]> {
  // Must match produce_assembly's own BOM selection (stage = 'ASSEMBLY')
  // — otherwise this page could offer a product whose only active BOM is
  // STICKER/OTHER stage, which the RPC would then reject.
  const { data: headers, error: headersError } = await supabase
    .from('bom_headers')
    .select('id, product_id, finished_product_id')
    .eq('is_active', true)
    .eq('stage', 'ASSEMBLY')
  if (headersError) throw new Error(headersError.message)

  const rows = headers ?? []
  const productIds = [...new Set(rows.map(r => r.product_id ?? r.finished_product_id).filter(Boolean))]
  if (productIds.length === 0) return []

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name')
    .in('id', productIds)
  if (productsError) throw new Error(productsError.message)

  const productRows = (products ?? []) as Array<{ id: string; name: string }>
  const nameById = new Map(productRows.map(product => [product.id, product.name]))

  return rows
    .map(r => {
      const productId = r.product_id ?? r.finished_product_id
      return { bomHeaderId: r.id, productId, productName: nameById.get(productId) ?? 'Unknown product' }
    })
    .filter((r): r is AssemblableProduct => !!r.productId)
}

export interface ComponentAvailability {
  componentProductId: string
  componentName: string
  quantityRequired: number
  available: number
}

export interface ProductionOperationalUnit {
  id: string
  warehouse_id: string | null
  company_id: string | null
  name: string
  code: string
}

export interface ProductionOperationalBatch {
  id: string
  batch_number: string
  operational_unit_id: string
  production_order_id: string | null
  bom_header_id: string | null
  product_id: string | null
  production_date: string
  target_units: number | null
  actual_units: number
  rejected_units: number
  status: 'draft' | 'active' | 'completed' | 'submitted' | 'approved' | 'cancelled'
  inventory_posting_status: 'not_required' | 'pending' | 'posted' | 'failed'
  inventory_posted_at: string | null
}

export interface ProductionOperationsIntegration {
  units: ProductionOperationalUnit[]
  batches: ProductionOperationalBatch[]
}

export async function fetchProductionOperationsIntegration(): Promise<ProductionOperationsIntegration> {
  const [unitsRes, batchesRes] = await Promise.all([
    supabase.from('operational_units').select('id, warehouse_id, company_id, name, code').eq('is_active', true).order('name'),
    supabase.from('production_batches')
      .select('id, batch_number, operational_unit_id, production_order_id, bom_header_id, product_id, production_date, target_units, actual_units, rejected_units, status, inventory_posting_status, inventory_posted_at')
      .order('production_date', { ascending: false })
      .limit(500),
  ])
  if (unitsRes.error) throw new Error(unitsRes.error.message)
  if (batchesRes.error) throw new Error(batchesRes.error.message)
  return {
    units: (unitsRes.data ?? []) as ProductionOperationalUnit[],
    batches: (batchesRes.data ?? []) as ProductionOperationalBatch[],
  }
}

export async function logUnmanagedProduction(input: {
  bomHeaderId: string
  warehouseId: string
  quantity: number
  notes?: string
  logDate: string
  employeeId?: string
  productionOrderId?: string
  companyId?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('log_unmanaged_production', {
    p_bom_header_id: input.bomHeaderId,
    p_warehouse_id: input.warehouseId,
    p_quantity: input.quantity,
    p_notes: input.notes?.trim() || null,
    p_log_date: input.logDate,
    p_employee_id: input.employeeId || null,
    p_production_order_id: input.productionOrderId || null,
    p_company_id: input.companyId || null,
  })
  if (error) {
    const diagnostic = `${error.code ?? ''} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
    if (
      diagnostic.includes('warehouse operations')
      || diagnostic.includes('managed production')
      || diagnostic.includes('managed batch')
    ) {
      throw new Error('This production is managed in Warehouse Operations. Record its workers and output on the floor batch so inventory and labor post once.')
    }
    if (error.code === '42501' || diagnostic.includes('row-level security')) {
      throw new Error('Production and company access are required to log output for this warehouse.')
    }
    throw new Error(error.message)
  }
  return data as string
}

export async function fetchComponentAvailability(
  bomHeaderId: string,
  warehouseId: string,
): Promise<ComponentAvailability[]> {
  const { data: lines, error: linesError } = await supabase
    .from('bom_lines')
    .select('component_product_id, quantity_required')
    .eq('bom_header_id', bomHeaderId)
  if (linesError) throw new Error(linesError.message)

  const rows = lines ?? []
  const componentIds = [...new Set(rows.map(l => l.component_product_id))]
  if (componentIds.length === 0) return []

  const [{ data: products, error: productsError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
    supabase.from('products').select('id, name').in('id', componentIds),
    supabase.from('inventory_ledger').select('product_id, quantity').eq('warehouse_id', warehouseId).in('product_id', componentIds),
  ])
  if (productsError) throw new Error(productsError.message)
  if (ledgerError) throw new Error(ledgerError.message)
  const productRows = (products ?? []) as Array<{ id: string; name: string }>
  const nameById = new Map(productRows.map(product => [product.id, product.name]))

  const availableByComponent = new Map<string, number>()
  for (const r of ledgerRows ?? []) {
    availableByComponent.set(r.product_id, (availableByComponent.get(r.product_id) ?? 0) + Number(r.quantity ?? 0))
  }

  return rows.map(line => ({
    componentProductId: line.component_product_id,
    componentName: nameById.get(line.component_product_id) ?? 'Unknown component',
    quantityRequired: Number(line.quantity_required ?? 0),
    available: availableByComponent.get(line.component_product_id) ?? 0,
  }))
}

export interface DailyReportLogRow {
  id: string
  logDate: string
  quantityProduced: number
  productName: string
  warehouseId: string | null
  warehouseName: string
  employeeId: string | null
  orderNumber: string | null
  notes: string | null
  capacityRate: number | null
}

export interface DailyReportMovementRow {
  id: string
  movementType: string
  quantity: number
  movementDate: string
  notes: string | null
  productName: string
}

export interface ProductionDailyReportData {
  logs: DailyReportLogRow[]
  movements: DailyReportMovementRow[]
  salesToday: number
  damageReports: DamageReport[]
}

interface EmbeddedOrderForReport { order_number: string; bom_header_id: string | null; warehouse_id: string }

/** Everything the merged Warehouse Ops "Daily Report" tab needs: raw
 * production logs (quick-logged and order-linked alike, unlike the
 * employee_daily_efficiency rollups which only cover approved floor
 * batches), inventory movements, today's sales, and damage reports. */
export async function fetchProductionDailyReport(referenceDate: string): Promise<ProductionDailyReportData> {
  const since = new Date(new Date(`${referenceDate}T00:00:00`).getTime() - 30 * 86400000).toISOString().split('T')[0]

  const [logsRes, moveRes, salesRes, damageRows, capacityRes, productsRes, warehousesRes, bomRes] = await Promise.all([
    supabase.from('production_daily_logs')
      .select('id, log_date, quantity_produced, production_order_id, bom_header_id, product_id, warehouse_id, employee_id, notes, production_orders(order_number, bom_header_id, warehouse_id)')
      .gte('log_date', since)
      .order('log_date', { ascending: false }),
    supabase.from('inventory_ledger')
      .select('id, movement_type, quantity, movement_date, notes, product_id')
      .gte('movement_date', since)
      .in('movement_type', ['SHIPMENT_RECEIVED', 'PRODUCTION_CONSUMED', 'PRODUCTION_OUTPUT', 'SALE', 'DAMAGE'])
      .order('movement_date', { ascending: false }),
    supabase.from('sales_orders').select('total_etb').eq('sale_date', referenceDate).in('status', ['INVOICED', 'PAID']),
    fetchDamageReports(50),
    supabase.from('production_capacity').select('warehouse_id, product_id, rated_capacity_per_day, effective_from'),
    supabase.from('products').select('id, name, sku'),
    supabase.from('warehouses').select('id, name'),
    supabase.from('bom_headers').select('id, product_id, finished_product_id'),
  ])
  if (logsRes.error) throw new Error(logsRes.error.message)
  if (moveRes.error) throw new Error(moveRes.error.message)
  if (salesRes.error) throw new Error(salesRes.error.message)
  if (capacityRes.error) throw new Error(capacityRes.error.message)
  if (productsRes.error) throw new Error(productsRes.error.message)
  if (warehousesRes.error) throw new Error(warehousesRes.error.message)
  if (bomRes.error) throw new Error(bomRes.error.message)

  const productRows = (productsRes.data ?? []) as Array<{ id: string; name: string; sku: string }>
  const nameById = new Map(productRows.map(product => [product.id, product.name]))
  const warehouseRows = (warehousesRes.data ?? []) as Array<{ id: string; name: string }>
  const warehouseNameById = new Map(warehouseRows.map(warehouse => [warehouse.id, warehouse.name]))
  const bomRows = (bomRes.data ?? []) as Array<{ id: string; product_id: string | null; finished_product_id: string | null }>
  const bomProductById = new Map(bomRows.map(bom => [bom.id, bom.finished_product_id ?? bom.product_id]))

  const capacityRows = (capacityRes.data ?? []) as Array<{ warehouse_id: string; product_id: string; rated_capacity_per_day: number; effective_from: string }>
  function capacityFor(warehouseId: string | null, productId: string | null, asOf: string): number | null {
    if (!warehouseId || !productId) return null
    const candidates = capacityRows.filter(capacity =>
      capacity.warehouse_id === warehouseId && capacity.product_id === productId && capacity.effective_from <= asOf)
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    return Number(candidates[0].rated_capacity_per_day)
  }

  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const logRows = (logsRes.data ?? []) as Array<{
    id: string; log_date: string; quantity_produced: number; production_order_id: string | null
    bom_header_id: string | null; product_id: string | null; warehouse_id: string | null
    employee_id: string | null; notes: string | null
    production_orders: EmbeddedOrderForReport | EmbeddedOrderForReport[] | null
  }>

  const logs: DailyReportLogRow[] = logRows.map(log => {
    const linkedOrder = one(log.production_orders)
    const effWarehouseId = log.warehouse_id ?? linkedOrder?.warehouse_id ?? null
    const effBomHeaderId = log.bom_header_id ?? linkedOrder?.bom_header_id ?? null
    const effProductId = log.product_id ?? (effBomHeaderId ? bomProductById.get(effBomHeaderId) ?? null : null)
    return {
      id: log.id,
      logDate: log.log_date,
      quantityProduced: Number(log.quantity_produced ?? 0),
      productName: effProductId ? (nameById.get(effProductId) ?? '—') : '—',
      warehouseId: effWarehouseId,
      warehouseName: effWarehouseId ? (warehouseNameById.get(effWarehouseId) ?? 'Unknown warehouse') : 'Unknown warehouse',
      employeeId: log.employee_id,
      orderNumber: linkedOrder?.order_number ?? null,
      notes: log.notes,
      capacityRate: capacityFor(effWarehouseId, effProductId, log.log_date),
    }
  })

  const movements: DailyReportMovementRow[] = ((moveRes.data ?? []) as Array<{ id: string; movement_type: string; quantity: number; movement_date: string; notes: string | null; product_id: string | null }>).map(movement => ({
    id: movement.id,
    movementType: movement.movement_type,
    quantity: Number(movement.quantity ?? 0),
    movementDate: movement.movement_date,
    notes: movement.notes,
    productName: movement.product_id ? (nameById.get(movement.product_id) ?? '—') : '—',
  }))

  return {
    logs,
    movements,
    salesToday: ((salesRes.data ?? []) as Array<{ total_etb: number | null }>).reduce((sum, row) => sum + (row.total_etb ?? 0), 0),
    damageReports: damageRows,
  }
}
