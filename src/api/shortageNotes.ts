// src/api/shortageNotes.ts
//
// "Yaltechane" tracking: materials that came up short on a shipment get
// flagged against the supplier so they resurface as a reminder when
// starting the next order with that same supplier.
import { supabase } from '../lib/supabase'

export interface ShortageNote {
  id: string
  supplier_id: string
  product_id: string | null
  shipment_id: string | null
  quantity_short: number | null
  notes: string | null
  is_resolved: boolean
  created_at: string
  products?: { name: string; sku: string } | null
}

export async function listOpenShortageNotes(supplierId: string): Promise<ShortageNote[]> {
  const { data, error } = await supabase
    .from('supplier_shortage_notes')
    .select('*, products(name, sku)')
    .eq('supplier_id', supplierId)
    .eq('is_resolved', false)
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface AddShortageNoteInput {
  supplierId: string
  productId?: string | null
  shipmentId?: string | null
  quantityShort?: number | null
  notes?: string | null
}

export async function addShortageNote(input: AddShortageNoteInput): Promise<void> {
  const { error } = await supabase.from('supplier_shortage_notes').insert({
    supplier_id: input.supplierId,
    product_id: input.productId ?? null,
    shipment_id: input.shipmentId ?? null,
    quantity_short: input.quantityShort ?? null,
    notes: input.notes ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function resolveShortageNote(id: string): Promise<void> {
  const { error } = await supabase
    .from('supplier_shortage_notes')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
