// src/api/employees.ts
import { supabase } from '../lib/supabase'

export interface Employee {
  id: string
  full_name: string
  department: string | null
  title: string | null
  warehouse_id: string | null
  employment_type: 'permanent' | 'daily_wage' | 'casual'
  is_active: boolean
  hire_date: string | null
  phone: string | null
  tin_number: string | null
  bank_name: string | null
  bank_account_number: string | null
  emergency_contact: string | null
  base_salary_etb: number | null
  daily_rate_etb: number | null
  pension_eligible: boolean
  notes: string | null
}

const COLUMNS = 'id, full_name, department, title, warehouse_id, employment_type, is_active, hire_date, phone, tin_number, bank_name, bank_account_number, emergency_contact, base_salary_etb, daily_rate_etb, pension_eligible, notes'

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select(COLUMNS).order('full_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Employee[]
}

export type EmployeeInput = Omit<Employee, 'id'>

export async function createEmployee(input: EmployeeInput): Promise<string> {
  const { data, error } = await supabase.from('employees').insert(input).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateEmployee(id: string, patch: Partial<EmployeeInput>): Promise<void> {
  const { error } = await supabase.from('employees').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
