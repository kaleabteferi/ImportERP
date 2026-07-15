// src/api/companyExpenses.ts — general company expenses (rent, salaries, ad-hoc spend),
// distinct from src/api/expenses.ts which is scoped to shipment costs.
import { supabase } from '../lib/supabase'

export interface CompanyExpenseInput {
  companyId?: string
  category: string
  description: string
  amount: number
  currency: 'USD' | 'ETB'
  method: 'cash' | 'bank_transfer' | 'credit' | 'mobile_money'
  paidBy?: string
  vendorName?: string
  expenseDate: string
  sensitive?: boolean
  notes?: string
  accountId?: string
}

export async function recordCompanyExpense(input: CompanyExpenseInput) {
  const { error } = await supabase.from('company_expenses').insert({
    company_id: input.companyId ?? null,
    category: input.category,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    method: input.method,
    paid_by: input.paidBy ?? null,
    vendor_name: input.vendorName ?? null,
    expense_date: input.expenseDate,
    sensitive_flag: input.sensitive ?? false,
    notes: input.notes ?? null,
    account_id: input.accountId ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function fetchCompanyExpenses(limit = 100) {
  const { data, error } = await supabase
    .from('company_expenses')
    .select('id, category, description, amount, currency, method, vendor_name, expense_date, sensitive_flag, notes, companies(name), employees(full_name)')
    .order('expense_date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data
}

export async function fetchCompaniesList() {
  const { data, error } = await supabase.from('companies').select('id, name').order('name')
  if (error) throw new Error(error.message)
  return data
}

export async function fetchEmployeesList() {
  const { data, error } = await supabase.from('employees').select('id, full_name').order('full_name')
  if (error) throw new Error(error.message)
  return data
}