// src/api/supplierPayables.ts — what's owed to a supplier (opened
// manually, optionally linked to a shipment) and the payments made
// against it. Payments made via hawala carry the ETB handed to the
// dealer, the rate they quoted, and the route/dealer used, since that's
// how converting ETB into the CNY/USD a supplier is owed actually works —
// see 20260721_supplier_payables_schema.sql for the full "why".
import { supabase } from '../lib/supabase'

export type PayableCurrency = 'USD' | 'ETB' | 'CNY'
export type PaymentMethod = 'hawala' | 'bank_transfer' | 'cash' | 'other'

export interface SupplierPayableListRow {
  id: string
  supplierId: string
  supplierName: string
  shipmentId: string | null
  shipmentNumber: string | null
  reference: string | null
  currency: PayableCurrency
  totalAmount: number
  paidAmount: number
  createdAt: string
}

export interface SupplierPaymentRow {
  id: string
  paymentDate: string
  method: PaymentMethod
  amount: number
  accountId: string | null
  accountName: string | null
  sourceSalesOrderId: string | null
  sourceSalesOrderNumber: string | null
  sourceNote: string | null
  hawalaRoute: string | null
  etbAmount: number | null
  exchangeRate: number | null
  reference: string | null
  notes: string | null
}

export interface SupplierPayableDetail extends SupplierPayableListRow {
  notes: string | null
  payments: SupplierPaymentRow[]
}

export async function fetchSupplierPayables(): Promise<SupplierPayableListRow[]> {
  const { data, error } = await supabase
    .from('supplier_payables')
    .select('id, supplier_id, shipment_id, reference, currency, total_amount, paid_amount, created_at, suppliers(name), shipments(shipment_number)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => {
    const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers
    const shipment = Array.isArray(r.shipments) ? r.shipments[0] : r.shipments
    return {
      id: r.id, supplierId: r.supplier_id, supplierName: supplier?.name ?? 'Unknown supplier',
      shipmentId: r.shipment_id, shipmentNumber: shipment?.shipment_number ?? null,
      reference: r.reference, currency: r.currency, totalAmount: Number(r.total_amount),
      paidAmount: Number(r.paid_amount), createdAt: r.created_at,
    }
  })
}

export async function fetchSupplierPayable(id: string): Promise<SupplierPayableDetail> {
  const [{ data: payable, error: payableError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase.from('supplier_payables')
      .select('id, supplier_id, shipment_id, reference, currency, total_amount, paid_amount, notes, created_at, suppliers(name), shipments(shipment_number)')
      .eq('id', id).single(),
    supabase.from('supplier_payments')
      .select('id, payment_date, method, amount, account_id, source_sales_order_id, source_note, hawala_route, etb_amount, exchange_rate, reference, notes, accounts(name), sales_orders(order_number)')
      .eq('payable_id', id).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
  ])
  if (payableError) throw new Error(payableError.message)
  if (paymentsError) throw new Error(paymentsError.message)

  const supplier = Array.isArray(payable.suppliers) ? payable.suppliers[0] : payable.suppliers
  const shipment = Array.isArray(payable.shipments) ? payable.shipments[0] : payable.shipments

  return {
    id: payable.id, supplierId: payable.supplier_id, supplierName: (supplier as any)?.name ?? 'Unknown supplier',
    shipmentId: payable.shipment_id, shipmentNumber: (shipment as any)?.shipment_number ?? null,
    reference: payable.reference, currency: payable.currency, totalAmount: Number(payable.total_amount),
    paidAmount: Number(payable.paid_amount), createdAt: payable.created_at, notes: payable.notes,
    payments: (payments ?? []).map((p: any) => {
      const account = Array.isArray(p.accounts) ? p.accounts[0] : p.accounts
      const order = Array.isArray(p.sales_orders) ? p.sales_orders[0] : p.sales_orders
      return {
        id: p.id, paymentDate: p.payment_date, method: p.method, amount: Number(p.amount),
        accountId: p.account_id, accountName: account?.name ?? null,
        sourceSalesOrderId: p.source_sales_order_id, sourceSalesOrderNumber: order?.order_number ?? null,
        sourceNote: p.source_note, hawalaRoute: p.hawala_route,
        etbAmount: p.etb_amount != null ? Number(p.etb_amount) : null,
        exchangeRate: p.exchange_rate != null ? Number(p.exchange_rate) : null,
        reference: p.reference, notes: p.notes,
      }
    }),
  }
}

export async function createSupplierPayable(input: {
  supplierId: string; shipmentId: string | null; reference: string | null
  currency: PayableCurrency; totalAmount: number; notes: string | null
}): Promise<string> {
  const { data, error } = await supabase
    .from('supplier_payables')
    .insert({
      supplier_id: input.supplierId, shipment_id: input.shipmentId, reference: input.reference,
      currency: input.currency, total_amount: input.totalAmount, notes: input.notes,
    })
    .select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function deleteSupplierPayable(id: string): Promise<void> {
  const { error } = await supabase.from('supplier_payables').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function recordSupplierPayment(payableId: string, input: {
  paymentDate: string; method: PaymentMethod; amount: number
  accountId: string | null; sourceSalesOrderId: string | null; sourceNote: string | null
  hawalaRoute: string | null; etbAmount: number | null; exchangeRate: number | null
  reference: string | null; notes: string | null
}): Promise<void> {
  const { error } = await supabase.from('supplier_payments').insert({
    payable_id: payableId, payment_date: input.paymentDate, method: input.method, amount: input.amount,
    account_id: input.accountId, source_sales_order_id: input.sourceSalesOrderId, source_note: input.sourceNote,
    hawala_route: input.hawalaRoute, etb_amount: input.etbAmount, exchange_rate: input.exchangeRate,
    reference: input.reference, notes: input.notes,
  })
  if (error) throw new Error(error.message)
  // paid_amount on supplier_payables updates automatically via
  // trg_sync_supplier_payable_paid_amount.
}

export async function deleteSupplierPayment(id: string): Promise<void> {
  const { error } = await supabase.from('supplier_payments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
