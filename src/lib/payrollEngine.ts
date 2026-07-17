// src/lib/payrollEngine.ts — Ethiopian payroll calculation rules.
//
// Every rate below is sourced from research against primary/professional
// sources as of 2026-07-17 — see the "HR Notes" page in the app (and the
// citations in each comment) for the full picture, including what's
// confirmed vs. still flagged as uncertain. This is not a substitute for
// advice from a licensed Ethiopian accountant or the actual gazetted
// proclamation text — verify before relying on this for real compliance,
// and update the constants below if a rate changes.

const round2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------
// PAYE — Income Tax (Amendment) Proclamation No. 1395/2025, effective
// 8 July 2025 (amends Federal Income Tax Proclamation No. 979/2016).
// Confirmed independently by EY, Chambers and Partners, and PwC Worldwide
// Tax Summaries (Ethiopia, individual income tax — reviewed 2026-07-15).
// ---------------------------------------------------------------------
export interface TaxBracket { upTo: number; rate: number }
export const PAYE_BRACKETS: TaxBracket[] = [
  { upTo: 2_000, rate: 0 },
  { upTo: 4_000, rate: 0.15 },
  { upTo: 7_000, rate: 0.20 },
  { upTo: 10_000, rate: 0.25 },
  { upTo: 14_000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
]

// Computed as an explicit marginal-bracket walk, not a "deduction shortcut"
// table — the shortcut constants circulating for the old 979/2016 brackets
// (e.g. subtract 302.50 at the 20% band) couldn't be independently
// re-verified for the new 1395/2025 brackets, so this avoids propagating
// an unconfirmed number.
export function calculatePAYE(taxableIncomeEtb: number): number {
  if (taxableIncomeEtb <= 0) return 0
  let tax = 0
  let lower = 0
  for (const bracket of PAYE_BRACKETS) {
    if (taxableIncomeEtb <= lower) break
    const upper = Math.min(taxableIncomeEtb, bracket.upTo)
    tax += (upper - lower) * bracket.rate
    lower = upper
  }
  return round2(tax)
}

// ---------------------------------------------------------------------
// Pension — Private Organization Employees' Pension Proclamation
// No. 1268/2022 (replaced No. 715/2011's phased-in rates with flat rates
// from day one). Applies to Ethiopian citizens engaged 45+ days
// (definite, indefinite, or piece-work) — mandatory for citizens, optional
// for foreign nationals of Ethiopian origin, unavailable to other foreign
// nationals. No verified salary ceiling — some payroll-vendor sites claim
// a 15,000 ETB cap but it could not be confirmed against the proclamation
// text, so none is applied here.
// ---------------------------------------------------------------------
export const PENSION_EMPLOYEE_RATE = 0.07
export const PENSION_EMPLOYER_RATE = 0.11

// ---------------------------------------------------------------------
// Overtime — Labour Proclamation No. 1156/2019, Article 68. Normal hours
// (Art. 61): 8/day, 48/week. A second, lower multiplier schedule
// (1.25/1.5/2x) circulates on generic international payroll-guide sites,
// but couldn't be traced to any Ethiopian statutory source and structurally
// resembles other countries' rules — the schedule below was sourced from a
// direct quote of Article 68 text.
// ---------------------------------------------------------------------
export type OvertimeType = 'weekday' | 'night' | 'rest_day' | 'public_holiday'
export const OT_LABELS: Record<OvertimeType, string> = {
  weekday: 'Weekday overtime (6am–10pm, beyond normal hours)',
  night: 'Night work (10pm–6am)',
  rest_day: 'Weekly rest day',
  public_holiday: 'Public holiday',
}
export const OT_MULTIPLIERS: Record<OvertimeType, number> = {
  weekday: 1.5,
  night: 1.75,
  rest_day: 2,
  public_holiday: 2.5,
}

// The Proclamation doesn't itself state a divisor for converting a monthly
// salary into an hourly rate. 240 (30 days x 8 hours) is the more common
// payroll-practice convention found; a competing 208 (48hr week x 4.33
// weeks/month) convention also exists and produces a materially different
// hourly rate. This is an unresolved practice question, not a settled
// legal figure — confirm with your accountant if overtime amounts need to
// be exact, and adjust this constant if so.
export const MONTHLY_HOURS_DIVISOR = 240
const HOURS_PER_DAY = 8

export interface OvertimeLineInput { ot_type: OvertimeType; hours: number }
export interface OvertimeLineResult { ot_type: OvertimeType; hours: number; rate_multiplier: number; amount_etb: number }

function hourlyRate(input: Pick<PayrollCalcInput, 'employmentType' | 'baseSalaryEtb' | 'dailyRateEtb'>): number {
  if (input.employmentType === 'permanent') return (input.baseSalaryEtb ?? 0) / MONTHLY_HOURS_DIVISOR
  return (input.dailyRateEtb ?? 0) / HOURS_PER_DAY
}

export function calculateOvertimeLines(
  input: Pick<PayrollCalcInput, 'employmentType' | 'baseSalaryEtb' | 'dailyRateEtb'>,
  lines: OvertimeLineInput[],
): OvertimeLineResult[] {
  const rate = hourlyRate(input)
  return lines
    .filter(l => l.hours > 0)
    .map(l => ({
      ot_type: l.ot_type,
      hours: l.hours,
      rate_multiplier: OT_MULTIPLIERS[l.ot_type],
      amount_etb: round2(rate * OT_MULTIPLIERS[l.ot_type] * l.hours),
    }))
}

// ---------------------------------------------------------------------
// Severance pay — Labour Proclamation 1156/2019, Art. 39-40. Only payable
// on specific termination grounds (business closure, redundancy,
// disability, 5+ years' resignation, etc.) — not on fault-based dismissal.
// Formula (Art. 40, direct quote): 30x average daily wage for the first
// year, +1/3 of that (10 days) per additional full year, capped at 12
// months' wages total. Exposed here as a standalone reference calculator —
// not wired into the regular monthly payroll run, since severance is a
// termination-time event with its own eligibility rules, not routine pay.
// ---------------------------------------------------------------------
export function calculateSeverancePay(averageDailyWageEtb: number, yearsOfService: number): number {
  if (averageDailyWageEtb <= 0 || yearsOfService <= 0) return 0
  const base = 30 * averageDailyWageEtb
  let total: number
  if (yearsOfService < 1) {
    total = base * yearsOfService
  } else {
    const fullAdditionalYears = Math.floor(yearsOfService) - 1
    const fractionalYear = yearsOfService - Math.floor(yearsOfService)
    total = base + fullAdditionalYears * (base / 3) + fractionalYear * (base / 3)
  }
  const cap = averageDailyWageEtb * 30 * 12 // 12 months' wages
  return round2(Math.min(total, cap))
}

// ---------------------------------------------------------------------
// Full payroll entry calculation
// ---------------------------------------------------------------------
export interface PayrollCalcInput {
  employmentType: 'permanent' | 'daily_wage' | 'casual'
  baseSalaryEtb: number | null
  dailyRateEtb: number | null
  daysWorked: number | null
  pensionEligible: boolean
  overtimeLines: OvertimeLineInput[]
  allowancesEtb: number
  otherDeductions: { deduction_type: string; description: string; amount_etb: number }[]
}

export interface PayrollCalcResult {
  basePayEtb: number
  overtimeLines: OvertimeLineResult[]
  overtimePayEtb: number
  allowancesEtb: number
  grossPayEtb: number
  taxableIncomeEtb: number
  pensionEmployeeEtb: number
  pensionEmployerEtb: number
  incomeTaxEtb: number
  otherDeductionsEtb: number
  netPayEtb: number
}

export function calculatePayrollEntry(input: PayrollCalcInput): PayrollCalcResult {
  const basePayEtb = input.employmentType === 'permanent'
    ? round2(input.baseSalaryEtb ?? 0)
    : round2((input.dailyRateEtb ?? 0) * (input.daysWorked ?? 0))

  const overtimeLines = calculateOvertimeLines(input, input.overtimeLines)
  const overtimePayEtb = round2(overtimeLines.reduce((s, l) => s + l.amount_etb, 0))
  const allowancesEtb = round2(input.allowancesEtb)
  const grossPayEtb = round2(basePayEtb + overtimePayEtb + allowancesEtb)

  // Pension is calculated on basic pay only (not overtime/allowances) —
  // standard Ethiopian payroll practice, consistent with "basic salary"
  // wording in Proclamation 1268/2022.
  const pensionEmployeeEtb = input.pensionEligible ? round2(basePayEtb * PENSION_EMPLOYEE_RATE) : 0
  const pensionEmployerEtb = input.pensionEligible ? round2(basePayEtb * PENSION_EMPLOYER_RATE) : 0

  // Taxable income = gross pay minus the employee's own pension
  // contribution — standard practice, though not found as an explicit
  // clause in the amendment text itself (medium confidence).
  const taxableIncomeEtb = Math.max(0, round2(grossPayEtb - pensionEmployeeEtb))
  const incomeTaxEtb = calculatePAYE(taxableIncomeEtb)

  const otherDeductionsEtb = round2(input.otherDeductions.reduce((s, d) => s + d.amount_etb, 0))

  const netPayEtb = round2(grossPayEtb - pensionEmployeeEtb - incomeTaxEtb - otherDeductionsEtb)

  return {
    basePayEtb, overtimeLines, overtimePayEtb, allowancesEtb, grossPayEtb,
    taxableIncomeEtb, pensionEmployeeEtb, pensionEmployerEtb, incomeTaxEtb,
    otherDeductionsEtb, netPayEtb,
  }
}
