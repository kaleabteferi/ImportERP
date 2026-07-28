// src/api/proformaInvoices.ts
import { supabase } from '../lib/supabase'

export interface ProformaInvoice {
  id: string
  pi_number: string
  supplier_id: string
  issue_date: string
  validity_date: string | null
  currency: string
  incoterm: string
  port_of_loading: string | null
  port_of_discharge: string | null
  payment_terms: string | null
  total_amount: number | null
  notes: string | null
  status: string
  buyer_company_id: string | null
  final_company_id: string | null
  markup_pct: number | null
  created_at: string
}

export interface PiItem {
  id: string
  pi_id: string
  line_number: number
  product_id: string | null
  item_description: string
  hs_code: string
  country_of_origin: string
  quantity: number
  unit_of_measure: string
  unit_price: number
  total_price: number | null
  customs_value: number | null
  duty_rate_pct: number | null
  vat_rate_pct: number | null
  surtax_rate_pct: number | null
  excise_rate_pct: number | null
  /** Carton-size defaults, used to pre-fill the packing list's dimension
   * fields for this line's product -- only present when product_id is set. */
  products?: {
    carton_length_cm: number | null
    carton_width_cm: number | null
    carton_height_cm: number | null
    default_units_per_carton: number | null
  } | null
}

export async function nextPiNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('proforma_invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01`)
    .lt('created_at', `${year + 1}-01-01`)
  return `PI-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`
}

export async function listProformaInvoices() {
  const { data, error } = await supabase
    .from('proforma_invoices')
    .select('*, suppliers(name), buyer_company:buyer_company_id(name), final_company:final_company_id(name), containers(id)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProformaInvoice(id: string) {
  const { data, error } = await supabase
    .from('proforma_invoices')
    .select('*, suppliers(name), buyer_company:buyer_company_id(name), final_company:final_company_id(name)')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export interface ProformaInvoiceInput {
  pi_number: string
  supplier_id: string
  issue_date: string
  validity_date?: string | null
  incoterm?: string
  port_of_loading?: string | null
  port_of_discharge?: string | null
  payment_terms?: string | null
  notes?: string | null
  buyer_company_id?: string | null
  final_company_id?: string | null
  markup_pct?: number | null
}

export async function createProformaInvoice(input: ProformaInvoiceInput): Promise<string> {
  const { data, error } = await supabase
    .from('proforma_invoices')
    .insert({
      pi_number: input.pi_number,
      supplier_id: input.supplier_id,
      issue_date: input.issue_date,
      validity_date: input.validity_date || null,
      incoterm: input.incoterm || 'FOB',
      port_of_loading: input.port_of_loading || null,
      port_of_discharge: input.port_of_discharge || 'Djibouti',
      payment_terms: input.payment_terms || null,
      notes: input.notes || null,
      buyer_company_id: input.buyer_company_id || null,
      final_company_id: input.final_company_id || null,
      markup_pct: input.markup_pct ?? null,
      status: 'DRAFT',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateProformaInvoice(id: string, patch: Partial<ProformaInvoiceInput> & { status?: string }) {
  const { error } = await supabase.from('proforma_invoices').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// pi_items.pi_id cascades on delete, but containers.pi_id is ON DELETE
// RESTRICT — deleting a PI that already has containers under it fails at
// the DB and the error surfaces to the caller, which is the desired guard
// (no bespoke cascade needed: you shouldn't delete an order that's already
// been split into physical containers).
export async function deleteProformaInvoice(id: string) {
  const { error } = await supabase.from('proforma_invoices').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listPiItems(piId: string) {
  const { data, error } = await supabase
    .from('pi_items')
    .select('*, products(name, sku, carton_length_cm, carton_width_cm, carton_height_cm, default_units_per_carton)')
    .eq('pi_id', piId)
    .order('line_number')
  if (error) throw new Error(error.message)
  return data ?? []
}

// "What did we last actually order for this product?" -- the most recent
// prior PI line for a product is real historical data (our own trade
// pattern with this exact supplier relationship), so it's a safe
// prefill source for HS code / price / origin on a new line, without
// needing any external HS-code database.
export interface LastPiItemForProduct { hs_code: string; unit_price: number; country_of_origin: string }

export async function fetchLastPiItemForProduct(productId: string): Promise<LastPiItemForProduct | null> {
  const { data, error } = await supabase
    .from('pi_items')
    .select('hs_code, unit_price, country_of_origin, proforma_invoices!inner(created_at)')
    .eq('product_id', productId)
    .order('created_at', { referencedTable: 'proforma_invoices', ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const row = data?.[0]
  if (!row) return null
  return { hs_code: row.hs_code, unit_price: Number(row.unit_price), country_of_origin: row.country_of_origin }
}

export interface PiItemInput {
  product_id: string | null
  item_description: string
  hs_code: string
  country_of_origin?: string
  quantity: number
  unit_of_measure?: string
  unit_price: number
  customs_value?: number | null
  duty_rate_pct?: number | null
  vat_rate_pct?: number | null
  surtax_rate_pct?: number | null
  excise_rate_pct?: number | null
}

export async function addPiItem(piId: string, input: PiItemInput) {
  const { count } = await supabase
    .from('pi_items')
    .select('id', { count: 'exact', head: true })
    .eq('pi_id', piId)
  const { error } = await supabase.from('pi_items').insert({
    pi_id: piId,
    line_number: (count ?? 0) + 1,
    product_id: input.product_id,
    item_description: input.item_description,
    hs_code: input.hs_code,
    country_of_origin: input.country_of_origin || 'China',
    quantity: input.quantity,
    unit_of_measure: input.unit_of_measure || 'PCS',
    unit_price: input.unit_price,
    customs_value: input.customs_value ?? null,
    duty_rate_pct: input.duty_rate_pct ?? null,
    vat_rate_pct: input.vat_rate_pct ?? 15,
    surtax_rate_pct: input.surtax_rate_pct ?? 10,
    excise_rate_pct: input.excise_rate_pct ?? 0,
  })
  if (error) throw new Error(error.message)
}

export async function updatePiItem(id: string, patch: Partial<PiItemInput>) {
  const { error } = await supabase.from('pi_items').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// pl_items.pi_item_id is ON DELETE RESTRICT -- deleting a line already
// split onto a container's packing list fails at the DB, same guard logic
// as the PI-level delete above.
export async function deletePiItem(id: string) {
  const { error } = await supabase.from('pi_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
