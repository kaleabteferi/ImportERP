// src/api/transactions.ts — generic edit/delete across the three tables
// that support inline editing in the Money Tracking ledger. Downstream
// totals (order paid_amount, customer outstanding, credit balance) update
// automatically via the existing triggers, which already fire on UPDATE
// and DELETE, not just INSERT.
//
// Supplier payments (`supplierpay-`) and shipment expenses (`shipexp-`)
// deliberately have no entry here and no edit button in the UI — the
// generic form can't correctly resync hawala_route/etb_amount/exchange_rate
// or the payable's trigger-driven paid_amount from a partial edit;
// managing those belongs on Supplier Payments / Payables instead.
//
// Keys here match the composite-ID PREFIX used in MoneyTracking.tsx
// (`sale-`, `credit-`, `expense-`) — note this differs from the
// Txn.source field values ('sale' | 'purchase' | 'credit_repayment' |
// 'expense'), so this is intentionally NOT keyed off `source`.
import { supabase } from '../lib/supabase'
import type { AnomalyTxn } from '../lib/anomalyDetection'

export type TxnIdPrefix = 'sale' | 'credit' | 'expense'

interface EditableFields {
  amount?: number
  method?: string
  notes?: string | null
  sensitive?: boolean
}

const TABLE_BY_PREFIX: Record<TxnIdPrefix, string> = {
  sale: 'sales_payments',
  credit: 'credit_transactions',
  expense: 'company_expenses',
}

const AMOUNT_COLUMN: Record<TxnIdPrefix, string> = {
  sale: 'amount_etb',
  credit: 'amount',
  expense: 'amount',
}

export function parseTxnId(compositeId: string): { prefix: TxnIdPrefix; realId: string } {
  const [prefix, ...rest] = compositeId.split('-')
  return { prefix: prefix as TxnIdPrefix, realId: rest.join('-') }
}

export async function updateTransaction(compositeId: string, fields: EditableFields) {
  const { prefix, realId } = parseTxnId(compositeId)
  const table = TABLE_BY_PREFIX[prefix]
  const amountCol = AMOUNT_COLUMN[prefix]

  const patch: Record<string, any> = {}
  if (fields.amount !== undefined) patch[amountCol] = fields.amount
  if (fields.method !== undefined) patch.method = fields.method
  if (fields.notes !== undefined) patch.notes = fields.notes
  if (fields.sensitive !== undefined) patch.sensitive_flag = fields.sensitive

  const { error } = await supabase.from(table).update(patch).eq('id', realId)
  if (error) throw new Error(error.message)
}

export async function deleteTransaction(compositeId: string) {
  const { prefix, realId } = parseTxnId(compositeId)
  const table = TABLE_BY_PREFIX[prefix]
  const { error } = await supabase.from(table).delete().eq('id', realId)
  if (error) throw new Error(error.message)
}

// Minimal version of the same unified ledger MoneyTracking.tsx builds in
// full — just enough fields to run the anomaly checks — so the Dashboard can
// surface "N unusual transactions" without duplicating MoneyTracking's whole
// load() or its extra edit/display fields.
export async function fetchTransactionsForAnomalies(sinceDate: string): Promise<AnomalyTxn[]> {
  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const [salesRes, supplierPayRes, creditRes, expenseRes, shipExpRes] = await Promise.all([
    supabase.from('sales_payments').select('id, amount_etb, payment_date, sales_orders(customers(name))').gte('payment_date', sinceDate),
    // Replaces purchase_order_payments — that table has never had a row
    // (nothing in the app creates a purchase_orders record); supplier_payments
    // is the real "money paid to a supplier" ledger, including hawala.
    supabase.from('supplier_payments').select('id, amount, payment_date, supplier_payables(currency, suppliers(name))').gte('payment_date', sinceDate),
    supabase.from('credit_transactions').select('id, amount, transaction_date, credit_accounts(customers(name))').eq('type', 'repayment').gte('transaction_date', sinceDate),
    supabase.from('company_expenses').select('id, amount, currency, expense_date, vendor_name, description').gte('expense_date', sinceDate),
    supabase.from('shipment_expenses').select('id, amount_etb, currency, paid_at, vendor_name, description').eq('is_paid', true).gte('paid_at', sinceDate),
  ])

  const txns: AnomalyTxn[] = []
  for (const r of (salesRes.data ?? []) as any[]) {
    const order = one(r.sales_orders); const customer = order ? one(order.customers) : null
    txns.push({ id: `sale-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: Number(r.amount_etb ?? 0), currency: 'ETB', date: r.payment_date, source: 'sale' })
  }
  for (const r of (supplierPayRes.data ?? []) as any[]) {
    const payable = one(r.supplier_payables); const supplier = payable ? one((payable as any).suppliers) : null
    txns.push({ id: `supplierpay-${r.id}`, direction: 'out', party: supplier?.name ?? 'Unknown supplier', amount: Number(r.amount ?? 0), currency: (payable as any)?.currency ?? 'USD', date: r.payment_date, source: 'purchase' })
  }
  for (const r of (creditRes.data ?? []) as any[]) {
    const acct = one(r.credit_accounts); const customer = acct ? one(acct.customers) : null
    txns.push({ id: `credit-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: Number(r.amount ?? 0), currency: 'ETB', date: r.transaction_date, source: 'credit_repayment' })
  }
  for (const r of (expenseRes.data ?? []) as any[]) {
    txns.push({ id: `expense-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: Number(r.amount ?? 0), currency: r.currency ?? 'ETB', date: r.expense_date, source: 'expense' })
  }
  for (const r of (shipExpRes.data ?? []) as any[]) {
    txns.push({ id: `shipexp-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: Number(r.amount_etb ?? 0), currency: 'ETB', date: r.paid_at ? String(r.paid_at).slice(0, 10) : null, source: 'shipment_expense' })
  }
  return txns
}