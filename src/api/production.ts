// src/api/production.ts
import { supabase } from '../lib/supabase'

export async function produceAssembly(
  warehouseId: string,
  finishedProductId: string,
  quantity: number,
  loggedBy?: string,
  notes?: string,
) {
  const { data, error } = await supabase.rpc('produce_assembly', {
    p_warehouse_id: warehouseId,
    p_finished_product_id: finishedProductId,
    p_quantity: quantity,
    p_logged_by: loggedBy ?? null,
    p_notes: notes ?? null,
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

  const nameById = new Map((products ?? []).map((p: any) => [p.id, p.name]))

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
  const nameById = new Map((products ?? []).map((p: any) => [p.id, p.name]))

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