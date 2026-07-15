// src/api/bom.ts
import { supabase } from '../lib/supabase'

export interface BomLineInput { componentProductId: string; quantityRequired: number }
export type BomStage = 'ASSEMBLY' | 'STICKER' | 'OTHER'

export async function fetchBoms() {
  const { data: headers, error } = await supabase
    .from('bom_headers')
    .select('id, name, product_id, finished_product_id, is_active, notes, stage, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const rows = headers ?? []
  const productIds = [...new Set(rows.map(r => r.product_id ?? r.finished_product_id).filter(Boolean))]

  const { data: products } = productIds.length > 0
    ? await supabase.from('products').select('id, name, sku').in('id', productIds)
    : { data: [] }
  const productById = new Map((products ?? []).map((p: any) => [p.id, p]))

  const headerIds = rows.map(r => r.id)
  const { data: allLines } = headerIds.length > 0
    ? await supabase.from('bom_lines').select('id, bom_header_id, component_product_id, quantity_required').in('bom_header_id', headerIds)
    : { data: [] }

  const componentIds = [...new Set((allLines ?? []).map((l: any) => l.component_product_id))]
  const { data: components } = componentIds.length > 0
    ? await supabase.from('products').select('id, name, sku').in('id', componentIds)
    : { data: [] }
  const componentById = new Map((components ?? []).map((p: any) => [p.id, p]))

  return rows.map(r => {
    const productId = r.product_id ?? r.finished_product_id
    const lines = (allLines ?? [])
      .filter((l: any) => l.bom_header_id === r.id)
      .map((l: any) => ({
        id: l.id,
        componentProductId: l.component_product_id,
        componentName: componentById.get(l.component_product_id)?.name ?? 'Unknown',
        componentSku: componentById.get(l.component_product_id)?.sku ?? '',
        quantityRequired: Number(l.quantity_required ?? 0),
      }))
    return {
      id: r.id,
      name: r.name,
      isActive: r.is_active,
      notes: r.notes,
      stage: (r.stage ?? 'ASSEMBLY') as BomStage,
      productId,
      productName: productById.get(productId)?.name ?? 'Unknown product',
      productSku: productById.get(productId)?.sku ?? '',
      lines,
    }
  })
}

export async function fetchAllProducts() {
  const { data, error } = await supabase.from('products').select('id, name, sku').order('name')
  if (error) throw new Error(error.message)
  return data
}

export async function createBom(input: {
  name: string
  productId: string
  lines: BomLineInput[]
  notes?: string
  stage?: BomStage
}) {
  const { data: header, error: headerError } = await supabase
    .from('bom_headers')
    .insert({
      name: input.name,
      product_id: input.productId,
      finished_product_id: input.productId, // NOT NULL — bom_headers has both columns from an earlier schema revision
      is_active: true,
      notes: input.notes ?? null,
      stage: input.stage ?? 'ASSEMBLY',
    })
    .select('id')
    .single()
  if (headerError) throw new Error(headerError.message)

  if (input.lines.length > 0) {
    const { error: linesError } = await supabase.from('bom_lines').insert(
      input.lines.map(l => ({
        bom_header_id: header.id,
        component_product_id: l.componentProductId,
        quantity_required: l.quantityRequired,
      }))
    )
    if (linesError) throw new Error(linesError.message)
  }
  return header.id as string
}

export async function setBomActive(bomHeaderId: string, isActive: boolean) {
  const { error } = await supabase.from('bom_headers').update({ is_active: isActive }).eq('id', bomHeaderId)
  if (error) throw new Error(error.message)
}

export async function deleteBom(bomHeaderId: string) {
  // bom_lines cascade is not guaranteed by schema, so delete lines first
  const { error: linesError } = await supabase.from('bom_lines').delete().eq('bom_header_id', bomHeaderId)
  if (linesError) throw new Error(linesError.message)
  const { error } = await supabase.from('bom_headers').delete().eq('id', bomHeaderId)
  if (error) throw new Error(error.message)
}