// src/api/rfq.ts — supplier RFQ/quotation comparison, and turning a winning
// quote into a real shipment (see 20260718_rfq_schema.sql for the "why").
import { supabase } from '../lib/supabase'

export type RfqStatus = 'draft' | 'sent' | 'awarded' | 'closed'
export type QuoteStatus = 'invited' | 'quoted' | 'declined'

export interface RfqListRow {
  id: string
  reference: string
  status: RfqStatus
  companyId: string | null
  companyName: string | null
  createdAt: string
  lineCount: number
  quoteCount: number
  awardedShipmentId: string | null
  awardedShipmentNumber: string | null
}

export interface RfqLine {
  id: string
  productId: string
  productName: string
  productSku: string
  quantityRequested: number
}

export interface RfqQuoteLine {
  id: string
  rfqLineId: string
  unitPrice: number | null
  moq: number | null
  notes: string | null
}

export interface RfqQuote {
  id: string
  supplierId: string
  supplierName: string
  status: QuoteStatus
  currency: string
  paymentTerms: string | null
  leadTimeDays: number | null
  validUntil: string | null
  notes: string | null
  lines: RfqQuoteLine[]
}

export interface RfqDetail {
  id: string
  reference: string
  status: RfqStatus
  companyId: string | null
  notes: string | null
  createdAt: string
  awardedShipmentId: string | null
  lines: RfqLine[]
  quotes: RfqQuote[]
}

export async function fetchRfqs(): Promise<RfqListRow[]> {
  const { data, error } = await supabase
    .from('rfqs')
    .select('id, reference, status, company_id, created_at, awarded_shipment_id, companies(name), shipments(shipment_number), rfq_lines(id), rfq_supplier_quotes(id)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((r: any) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies
    const shipment = Array.isArray(r.shipments) ? r.shipments[0] : r.shipments
    return {
      id: r.id, reference: r.reference, status: r.status,
      companyId: r.company_id, companyName: company?.name ?? null,
      createdAt: r.created_at,
      lineCount: (r.rfq_lines ?? []).length,
      quoteCount: (r.rfq_supplier_quotes ?? []).length,
      awardedShipmentId: r.awarded_shipment_id,
      awardedShipmentNumber: shipment?.shipment_number ?? null,
    }
  })
}

export async function fetchRfq(id: string): Promise<RfqDetail> {
  const [{ data: rfq, error: rfqError }, { data: lines, error: linesError }, { data: quotes, error: quotesError }] = await Promise.all([
    supabase.from('rfqs').select('id, reference, status, company_id, notes, created_at, awarded_shipment_id').eq('id', id).single(),
    supabase.from('rfq_lines').select('id, product_id, quantity_required:quantity_requested, products(name, sku)').eq('rfq_id', id),
    supabase.from('rfq_supplier_quotes').select('id, supplier_id, status, currency, payment_terms, lead_time_days, valid_until, notes, suppliers(name)').eq('rfq_id', id).order('created_at'),
  ])
  if (rfqError) throw new Error(rfqError.message)
  if (linesError) throw new Error(linesError.message)
  if (quotesError) throw new Error(quotesError.message)

  const quoteIds = (quotes ?? []).map((q: any) => q.id)
  const { data: quoteLines, error: quoteLinesError } = quoteIds.length > 0
    ? await supabase.from('rfq_quote_lines').select('id, rfq_supplier_quote_id, rfq_line_id, unit_price, moq, notes').in('rfq_supplier_quote_id', quoteIds)
    : { data: [], error: null }
  if (quoteLinesError) throw new Error(quoteLinesError.message)

  return {
    id: rfq.id, reference: rfq.reference, status: rfq.status, companyId: rfq.company_id,
    notes: rfq.notes, createdAt: rfq.created_at, awardedShipmentId: rfq.awarded_shipment_id,
    lines: (lines ?? []).map((l: any) => {
      const product = Array.isArray(l.products) ? l.products[0] : l.products
      return { id: l.id, productId: l.product_id, productName: product?.name ?? 'Unknown', productSku: product?.sku ?? '', quantityRequested: Number(l.quantity_required ?? 0) }
    }),
    quotes: (quotes ?? []).map((q: any) => {
      const supplier = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers
      return {
        id: q.id, supplierId: q.supplier_id, supplierName: supplier?.name ?? 'Unknown', status: q.status,
        currency: q.currency, paymentTerms: q.payment_terms, leadTimeDays: q.lead_time_days,
        validUntil: q.valid_until, notes: q.notes,
        lines: (quoteLines ?? []).filter((ql: any) => ql.rfq_supplier_quote_id === q.id)
          .map((ql: any) => ({ id: ql.id, rfqLineId: ql.rfq_line_id, unitPrice: ql.unit_price != null ? Number(ql.unit_price) : null, moq: ql.moq != null ? Number(ql.moq) : null, notes: ql.notes })),
      }
    }),
  }
}

export async function createRfq(input: {
  reference: string
  companyId: string | null
  notes?: string
  lines: { productId: string; quantityRequested: number }[]
}): Promise<string> {
  const { data: rfq, error: rfqError } = await supabase
    .from('rfqs')
    .insert({ reference: input.reference, company_id: input.companyId, notes: input.notes ?? null })
    .select('id')
    .single()
  if (rfqError) throw new Error(rfqError.message)

  if (input.lines.length > 0) {
    const { error: linesError } = await supabase.from('rfq_lines').insert(
      input.lines.map(l => ({ rfq_id: rfq.id, product_id: l.productId, quantity_requested: l.quantityRequested }))
    )
    if (linesError) throw new Error(linesError.message)
  }
  return rfq.id as string
}

export async function deleteRfq(id: string): Promise<void> {
  const { error } = await supabase.from('rfqs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function inviteSupplier(rfqId: string, supplierId: string): Promise<void> {
  const { error } = await supabase.from('rfq_supplier_quotes').insert({ rfq_id: rfqId, supplier_id: supplierId })
  if (error) throw new Error(error.message)
}

export async function removeQuote(quoteId: string): Promise<void> {
  const { error } = await supabase.from('rfq_supplier_quotes').delete().eq('id', quoteId)
  if (error) throw new Error(error.message)
}

// Full replace of a quote's header + line prices in one save, same
// "recompute from scratch" pattern used elsewhere in the app (e.g. payroll
// entries) rather than a partial patch that could drift.
export async function saveQuote(quoteId: string, input: {
  status: QuoteStatus
  currency: string
  paymentTerms: string | null
  leadTimeDays: number | null
  validUntil: string | null
  notes: string | null
  lines: { rfqLineId: string; unitPrice: number | null; moq: number | null }[]
}): Promise<void> {
  const { error: quoteError } = await supabase.from('rfq_supplier_quotes').update({
    status: input.status, currency: input.currency, payment_terms: input.paymentTerms,
    lead_time_days: input.leadTimeDays, valid_until: input.validUntil, notes: input.notes,
  }).eq('id', quoteId)
  if (quoteError) throw new Error(quoteError.message)

  for (const line of input.lines) {
    const { error: lineError } = await supabase.from('rfq_quote_lines').upsert(
      { rfq_supplier_quote_id: quoteId, rfq_line_id: line.rfqLineId, unit_price: line.unitPrice, moq: line.moq },
      { onConflict: 'rfq_supplier_quote_id,rfq_line_id' },
    )
    if (lineError) throw new Error(lineError.message)
  }
}

async function nextShipmentNumber(year: number): Promise<string> {
  const { count } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01`)
    .lt('created_at', `${year + 1}-01-01`)
  return `SHP-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`
}

// Awards a quote: creates a real Shipment for that supplier, pre-fills its
// PI items from the quote's line prices, marks the RFQ awarded and every
// other quote on it declined, and links the RFQ to the shipment it became.
// unit_price_usd only gets pre-filled when the quote was in USD — silently
// converting a CNY/ETB quote at some assumed rate would be worse than
// leaving it blank for a human to fill in on the shipment itself.
export async function awardQuote(rfqId: string, quoteId: string): Promise<{ shipmentId: string; shipmentNumber: string; pricesNeedReview: boolean }> {
  const rfq = await fetchRfq(rfqId)
  const quote = rfq.quotes.find(q => q.id === quoteId)
  if (!quote) throw new Error('Quote not found.')

  const productIds = rfq.lines.map(l => l.productId)
  const { data: products, error: productsError } = await supabase.from('products').select('id, weight_kg, volume_m3').in('id', productIds)
  if (productsError) throw new Error(productsError.message)
  const productById = new Map((products ?? []).map((p: any) => [p.id, p]))

  const year = new Date().getFullYear()
  let shipment: { id: string; shipment_number: string } | null = null
  let err: { message: string; code?: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const num = await nextShipmentNumber(year)
    const res = await supabase.from('shipments').insert({
      shipment_number: num,
      supplier_id: quote.supplierId,
      company_id: rfq.companyId,
      status: 'ORDERED',
      allocation_method: 'QUANTITY',
      notes: `Awarded from RFQ ${rfq.reference}`,
    }).select('id, shipment_number').single()
    err = res.error
    if (!err) { shipment = res.data; break }
    if (err.code !== '23505') break
  }
  if (err || !shipment) throw new Error(err?.message ?? 'Failed to create shipment.')

  const isUsd = quote.currency === 'USD'
  let pricesNeedReview = !isUsd
  const itemRows = rfq.lines.map(rfqLine => {
    const quoteLine = quote.lines.find(ql => ql.rfqLineId === rfqLine.id)
    const product = productById.get(rfqLine.productId)
    const qty = rfqLine.quantityRequested
    if (!quoteLine?.unitPrice) pricesNeedReview = true
    return {
      shipment_id: shipment!.id,
      product_id: rfqLine.productId,
      quantity: qty,
      unit_of_measure: 'PCS',
      carton_qty: Math.ceil(qty / 2),
      unit_price_usd: isUsd ? (quoteLine?.unitPrice ?? null) : null,
      weight_kg_total: product?.weight_kg ? product.weight_kg * qty : null,
      volume_m3_total: product?.volume_m3 ? product.volume_m3 * qty : null,
      cost_status: 'PROVISIONAL',
    }
  })
  const { error: itemsError } = await supabase.from('shipment_items').insert(itemRows)
  if (itemsError) throw new Error(itemsError.message)

  const { error: awardError } = await supabase.from('rfqs').update({ status: 'awarded', awarded_shipment_id: shipment.id }).eq('id', rfqId)
  if (awardError) throw new Error(awardError.message)

  const otherQuoteIds = rfq.quotes.filter(q => q.id !== quoteId).map(q => q.id)
  if (otherQuoteIds.length > 0) {
    await supabase.from('rfq_supplier_quotes').update({ status: 'declined' }).in('id', otherQuoteIds)
  }

  return { shipmentId: shipment.id, shipmentNumber: shipment.shipment_number, pricesNeedReview }
}
