// src/api/payroll.ts
import { supabase } from '../lib/supabase'
import { calculatePayrollEntry } from '../lib/payrollEngine'
import type { OvertimeType } from '../lib/payrollEngine'
import type { Employee } from './employees'

export interface PayrollPeriod {
  id: string
  period_month: number
  period_year: number
  status: 'draft' | 'finalized'
  notes: string | null
  created_at: string
  finalized_at: string | null
}

export interface PayrollEntryDeduction { deduction_type: string; description: string; amount_etb: number }
export interface PayrollEntryOvertimeLine { ot_type: OvertimeType; hours: number; rate_multiplier: number; amount_etb: number }

export interface PayrollEntry {
  id: string
  payroll_period_id: string
  employee_id: string
  employee_name: string
  employment_type: Employee['employment_type']
  days_worked: number | null
  base_pay_etb: number
  overtime_pay_etb: number
  allowances_etb: number
  gross_pay_etb: number
  taxable_income_etb: number
  pension_employee_etb: number
  pension_employer_etb: number
  income_tax_etb: number
  other_deductions_etb: number
  net_pay_etb: number
  notes: string | null
  overtime_lines: PayrollEntryOvertimeLine[]
  deductions: PayrollEntryDeduction[]
}

export async function fetchPayrollPeriods(): Promise<PayrollPeriod[]> {
  const { data, error } = await supabase.from('payroll_periods').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// Creates the period, then seeds one payroll_entries row per active
// employee with a first-pass calculation (no overtime/allowances/other
// deductions, days_worked defaulted to a full working month for
// daily-wage/casual staff) — HR reviews and adjusts each row from there
// rather than adding employees to a run one at a time.
export async function createPayrollPeriod(month: number, year: number, employees: Employee[]): Promise<string> {
  const { data: period, error: periodError } = await supabase
    .from('payroll_periods')
    .insert({ period_month: month, period_year: year })
    .select('id')
    .single()
  if (periodError) throw new Error(periodError.message)

  const activeEmployees = employees.filter(e => e.is_active)
  for (const emp of activeEmployees) {
    const daysWorked = emp.employment_type === 'permanent' ? null : 26
    const calc = calculatePayrollEntry({
      employmentType: emp.employment_type,
      baseSalaryEtb: emp.base_salary_etb,
      dailyRateEtb: emp.daily_rate_etb,
      daysWorked,
      pensionEligible: emp.pension_eligible,
      overtimeLines: [],
      allowancesEtb: 0,
      otherDeductions: [],
    })
    const { error: entryError } = await supabase.from('payroll_entries').insert({
      payroll_period_id: period.id, employee_id: emp.id, employment_type: emp.employment_type,
      days_worked: daysWorked, base_pay_etb: calc.basePayEtb, overtime_pay_etb: calc.overtimePayEtb,
      allowances_etb: calc.allowancesEtb, gross_pay_etb: calc.grossPayEtb, taxable_income_etb: calc.taxableIncomeEtb,
      pension_employee_etb: calc.pensionEmployeeEtb, pension_employer_etb: calc.pensionEmployerEtb,
      income_tax_etb: calc.incomeTaxEtb, other_deductions_etb: calc.otherDeductionsEtb, net_pay_etb: calc.netPayEtb,
    })
    if (entryError) throw new Error(entryError.message)
  }

  return period.id as string
}

export async function deletePayrollPeriod(id: string): Promise<void> {
  const { error } = await supabase.from('payroll_periods').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchPayrollEntries(periodId: string): Promise<PayrollEntry[]> {
  const { data: entries, error } = await supabase
    .from('payroll_entries')
    .select('*, employees(full_name)')
    .eq('payroll_period_id', periodId)
    .order('created_at')
  if (error) throw new Error(error.message)

  const entryIds = (entries ?? []).map((e: any) => e.id)
  const [{ data: otLines }, { data: deductions }] = await Promise.all([
    entryIds.length > 0 ? supabase.from('payroll_overtime_lines').select('*').in('payroll_entry_id', entryIds) : Promise.resolve({ data: [] }),
    entryIds.length > 0 ? supabase.from('payroll_deductions').select('*').in('payroll_entry_id', entryIds) : Promise.resolve({ data: [] }),
  ])

  return (entries ?? []).map((e: any) => {
    const employee = Array.isArray(e.employees) ? e.employees[0] : e.employees
    return {
      id: e.id, payroll_period_id: e.payroll_period_id, employee_id: e.employee_id,
      employee_name: employee?.full_name ?? 'Unknown', employment_type: e.employment_type,
      days_worked: e.days_worked ? Number(e.days_worked) : null,
      base_pay_etb: Number(e.base_pay_etb), overtime_pay_etb: Number(e.overtime_pay_etb), allowances_etb: Number(e.allowances_etb),
      gross_pay_etb: Number(e.gross_pay_etb), taxable_income_etb: Number(e.taxable_income_etb),
      pension_employee_etb: Number(e.pension_employee_etb), pension_employer_etb: Number(e.pension_employer_etb),
      income_tax_etb: Number(e.income_tax_etb), other_deductions_etb: Number(e.other_deductions_etb), net_pay_etb: Number(e.net_pay_etb),
      notes: e.notes,
      overtime_lines: (otLines ?? []).filter((l: any) => l.payroll_entry_id === e.id).map((l: any) => ({ ot_type: l.ot_type, hours: Number(l.hours), rate_multiplier: Number(l.rate_multiplier), amount_etb: Number(l.amount_etb) })),
      deductions: (deductions ?? []).filter((d: any) => d.payroll_entry_id === e.id).map((d: any) => ({ deduction_type: d.deduction_type, description: d.description ?? '', amount_etb: Number(d.amount_etb) })),
    }
  })
}

// Recalculates and persists one entry, including replacing its overtime
// and deduction line items — always a full recompute from the given
// inputs via the shared engine, never a partial patch, so the stored
// totals can't drift from what the line items actually say.
export async function recalculateAndSaveEntry(
  entry: PayrollEntry,
  employee: Employee,
  input: { daysWorked: number | null; overtimeLines: { ot_type: OvertimeType; hours: number }[]; allowancesEtb: number; deductions: PayrollEntryDeduction[]; notes: string },
): Promise<void> {
  const calc = calculatePayrollEntry({
    employmentType: employee.employment_type,
    baseSalaryEtb: employee.base_salary_etb,
    dailyRateEtb: employee.daily_rate_etb,
    daysWorked: input.daysWorked,
    pensionEligible: employee.pension_eligible,
    overtimeLines: input.overtimeLines,
    allowancesEtb: input.allowancesEtb,
    otherDeductions: input.deductions,
  })

  const { error } = await supabase.from('payroll_entries').update({
    days_worked: input.daysWorked, base_pay_etb: calc.basePayEtb, overtime_pay_etb: calc.overtimePayEtb,
    allowances_etb: calc.allowancesEtb, gross_pay_etb: calc.grossPayEtb, taxable_income_etb: calc.taxableIncomeEtb,
    pension_employee_etb: calc.pensionEmployeeEtb, pension_employer_etb: calc.pensionEmployerEtb,
    income_tax_etb: calc.incomeTaxEtb, other_deductions_etb: calc.otherDeductionsEtb, net_pay_etb: calc.netPayEtb,
    notes: input.notes || null, updated_at: new Date().toISOString(),
  }).eq('id', entry.id)
  if (error) throw new Error(error.message)

  await supabase.from('payroll_overtime_lines').delete().eq('payroll_entry_id', entry.id)
  if (calc.overtimeLines.length > 0) {
    const { error: otError } = await supabase.from('payroll_overtime_lines').insert(
      calc.overtimeLines.map(l => ({ payroll_entry_id: entry.id, ot_type: l.ot_type, hours: l.hours, rate_multiplier: l.rate_multiplier, amount_etb: l.amount_etb }))
    )
    if (otError) throw new Error(otError.message)
  }

  await supabase.from('payroll_deductions').delete().eq('payroll_entry_id', entry.id)
  if (input.deductions.length > 0) {
    const { error: dedError } = await supabase.from('payroll_deductions').insert(
      input.deductions.map(d => ({ payroll_entry_id: entry.id, deduction_type: d.deduction_type, description: d.description || null, amount_etb: d.amount_etb }))
    )
    if (dedError) throw new Error(dedError.message)
  }
}

export async function finalizePayrollPeriod(id: string): Promise<void> {
  const { error } = await supabase.from('payroll_periods').update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}
