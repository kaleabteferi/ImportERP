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
  created_at: string | null
}

const COLUMNS = 'id, full_name, department, title, warehouse_id, employment_type, is_active, hire_date, phone, tin_number, bank_name, bank_account_number, emergency_contact, base_salary_etb, daily_rate_etb, pension_eligible, notes, created_at'

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select(COLUMNS).order('full_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Employee[]
}

export async function fetchEmployeeById(id: string): Promise<Employee> {
  const { data, error } = await supabase.from('employees').select(COLUMNS).eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as unknown as Employee
}

export type EmployeeInput = Omit<Employee, 'id' | 'created_at'>

export async function createEmployee(input: EmployeeInput): Promise<string> {
  const { data, error } = await supabase.from('employees').insert(input).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateEmployee(id: string, patch: Partial<EmployeeInput>): Promise<void> {
  const { error } = await supabase.from('employees').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteEmployees(ids: string[]): Promise<void> {
  const { error } = await supabase.from('employees').delete().in('id', ids)
  if (error) throw new Error(error.message)
}

export interface EmployeeWorkforceMembership {
  employee_id: string
  group_id: string
  group_name: string
  group_type: string
}

export async function fetchEmployeeWorkforceMemberships(): Promise<EmployeeWorkforceMembership[]> {
  const [{ data: groups, error: groupsError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from('workforce_groups').select('id, name, group_type'),
    supabase.from('workforce_group_members').select('employee_id, workforce_group_id').eq('is_active', true),
  ])
  if (groupsError) throw new Error(groupsError.message)
  if (membersError) throw new Error(membersError.message)
  const groupById = new Map((groups ?? []).map(group => [group.id as string, group]))
  return (members ?? []).flatMap(member => {
    const group = groupById.get(member.workforce_group_id as string)
    return group ? [{ employee_id: member.employee_id as string, group_id: group.id as string, group_name: group.name as string, group_type: group.group_type as string }] : []
  })
}
