// src/api/transactions.ts — generic edit/delete across the four
// tables that feed the Money Tracking ledger. Downstream totals
// (order paid_amount, customer outstanding, credit balance) update
// automatically via the existing triggers, which already fire on
// UPDATE and DELETE, not just INSERT.
//
// Keys here match the composite-ID PREFIX used in MoneyTracking.tsx
// (`sale-`, `po-`, `credit-`, `expense-`) — note this differs from the
// Txn.source field values ('sale' | 'purchase' | 'credit_repayment' |
// 'expense'), so this is intentionally NOT keyed off `source`.
import { supabase } from '../lib/supabase'

export type TxnIdPrefix = 'sale' | 'po' | 'credit' | 'expense'

interface EditableFields {
  amount?: number
  method?: string
  notes?: string | null
  sensitive?: boolean
}

const TABLE_BY_PREFIX: Record<TxnIdPrefix, string> = {
  sale: 'sales_payments',
  po: 'purchase_order_payments',
  credit: 'credit_transactions',
  expense: 'company_expenses',
}

const AMOUNT_COLUMN: Record<TxnIdPrefix, string> = {
  sale: 'amount_etb',
  po: 'amount',
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