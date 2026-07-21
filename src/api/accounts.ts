// src/api/accounts.ts — cash tills / bank accounts, so payments can record
// which specific account the money moved through.
import { supabase } from '../lib/supabase'

export interface Account {
  id: string
  name: string
  type: 'cash' | 'bank'
  currency: string
  company_id: string | null
  is_active: boolean
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('is_active', true)
    .order('type')
    .order('name')
  if (error) throw new Error(error.message)
  return data as Account[]
}

export async function createAccount(input: {
  name: string; type: 'cash' | 'bank'; currency?: string; companyId?: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: input.name,
      type: input.type,
      currency: input.currency || 'ETB',
      company_id: input.companyId || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateAccount(id: string, patch: { name?: string; type?: 'cash' | 'bank'; currency?: string; isActive?: boolean }) {
  const { error } = await supabase
    .from('accounts')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Every payment/expense that tags an account_id feeds this — summed here
// rather than kept as a stored running total, since nothing writes through
// a single choke point (sales, supplier payments, expenses, credit
// repayments and shipment expenses all insert independently). No opening
// balance: this is only money that has moved through the app, not a real
// till count.
export async function fetchAccountBalances(accounts: Account[]): Promise<Record<string, number>> {
  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  const currencyByAccount = new Map(accounts.map(a => [a.id, a.currency]))

  const [salesRes, creditRes, expensesRes, shipExpRes, supplierPayRes] = await Promise.all([
    supabase.from('sales_payments').select('amount_etb, account_id').not('account_id', 'is', null),
    supabase.from('credit_transactions').select('amount, account_id').eq('type', 'repayment').not('account_id', 'is', null),
    supabase.from('company_expenses').select('amount, currency, account_id').not('account_id', 'is', null),
    supabase.from('shipment_expenses').select('amount, currency, account_id').eq('is_paid', true).not('account_id', 'is', null),
    supabase.from('supplier_payments').select('amount, method, etb_amount, account_id, supplier_payables(currency)').not('account_id', 'is', null),
  ])

  const balances: Record<string, number> = {}
  const add = (accountId: string | null, amount: number) => {
    if (!accountId) return
    balances[accountId] = (balances[accountId] ?? 0) + amount
  }

  // sales_payments and credit repayments are always ETB — only count them
  // toward an ETB-denominated account.
  for (const r of (salesRes.data ?? []) as any[]) {
    if (currencyByAccount.get(r.account_id) === 'ETB') add(r.account_id, Number(r.amount_etb ?? 0))
  }
  for (const r of (creditRes.data ?? []) as any[]) {
    if (currencyByAccount.get(r.account_id) === 'ETB') add(r.account_id, Number(r.amount ?? 0))
  }
  for (const r of (expensesRes.data ?? []) as any[]) {
    if (currencyByAccount.get(r.account_id) === r.currency) add(r.account_id, -Number(r.amount ?? 0))
  }
  for (const r of (shipExpRes.data ?? []) as any[]) {
    if (currencyByAccount.get(r.account_id) === r.currency) add(r.account_id, -Number(r.amount ?? 0))
  }
  // A hawala supplier payment debits the account in ETB (etb_amount) — the
  // account paid the dealer, not the supplier directly, so `amount` (in the
  // payable's currency) never actually left this account.
  for (const r of (supplierPayRes.data ?? []) as any[]) {
    const payable = one(r.supplier_payables)
    const acctCurrency = currencyByAccount.get(r.account_id)
    if (r.method === 'hawala' && r.etb_amount != null) {
      if (acctCurrency === 'ETB') add(r.account_id, -Number(r.etb_amount))
    } else if (payable?.currency === acctCurrency) {
      add(r.account_id, -Number(r.amount ?? 0))
    }
  }

  return balances
}
