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
