import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPayrollPeriods, createPayrollPeriod, deletePayrollPeriod,
  fetchPayrollEntries, recalculateAndSaveEntry, finalizePayrollPeriod,
} from '../api/payroll'
import type { PayrollPeriod, PayrollEntry, PayrollEntryDeduction } from '../api/payroll'
import { fetchEmployees } from '../api/employees'
import type { Employee } from '../api/employees'
import { fetchAccounts } from '../api/accounts'
import { recordCompanyExpense } from '../api/companyExpenses'
import { OT_LABELS, OT_MULTIPLIERS } from '../lib/payrollEngine'
import type { OvertimeType } from '../lib/payrollEngine'
import {
  Wallet, Loader2, Plus, X, Check, Lock, ChevronLeft, Pencil, Trash2,
  Printer, Info, Users, AlertTriangle,
} from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function NewRunForm({ employees, onCancel, onCreated }: { employees: Employee[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setError(null)
    try {
      const id = await createPayrollPeriod(month, year, employees)
      onCreated(id)
    } catch (e: any) {
      setError(e?.message?.includes('duplicate') || e?.message?.includes('unique') ? 'A pay run already exists for this month.' : (e?.message ?? 'Failed to create pay run.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">Creates a draft entry for every active employee ({employees.filter(e => e.is_active).length}), pre-calculated with no overtime or extra deductions — adjust each one from there.</p>
      <div className="flex gap-2">
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-24 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Creating…' : 'Create pay run'}
        </button>
      </div>
    </div>
  )
}

function EntryEditForm({ entry, employee, onCancel, onSaved }: {
  entry: PayrollEntry; employee: Employee | undefined; onCancel: () => void; onSaved: () => void
}) {
  const [daysWorked, setDaysWorked] = useState(entry.days_worked ?? 26)
  const [otLines, setOtLines] = useState<{ ot_type: OvertimeType; hours: string }[]>(
    entry.overtime_lines.length > 0 ? entry.overtime_lines.map(l => ({ ot_type: l.ot_type, hours: String(l.hours) })) : []
  )
  const [allowances, setAllowances] = useState(String(entry.allowances_etb))
  const [deductions, setDeductions] = useState<PayrollEntryDeduction[]>(entry.deductions)
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addOtLine() { setOtLines(l => [...l, { ot_type: 'weekday', hours: '' }]) }
  function addDeduction() { setDeductions(d => [...d, { deduction_type: 'other', description: '', amount_etb: 0 }]) }

  async function submit() {
    if (!employee) { setError('Employee record not found.'); return }
    setSaving(true); setError(null)
    try {
      await recalculateAndSaveEntry(entry, employee, {
        daysWorked: employee.employment_type === 'permanent' ? null : daysWorked,
        overtimeLines: otLines.filter(l => Number(l.hours) > 0).map(l => ({ ot_type: l.ot_type, hours: Number(l.hours) })),
        allowancesEtb: Number(allowances) || 0,
        deductions: deductions.filter(d => d.amount_etb > 0),
        notes,
      })
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-blue-50/40 border-t border-blue-100 space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {employee?.employment_type !== 'permanent' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Days worked this period</label>
          <input type="number" value={daysWorked} onChange={e => setDaysWorked(Number(e.target.value))} className="w-24 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">Overtime</label>
          <button onClick={addOtLine} className="text-xs text-blue-600 hover:underline">+ Add</button>
        </div>
        {otLines.map((l, i) => (
          <div key={i} className="flex gap-2 mb-1.5">
            <select value={l.ot_type} onChange={e => setOtLines(ls => ls.map((x, xi) => xi === i ? { ...x, ot_type: e.target.value as OvertimeType } : x))}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              {(Object.keys(OT_LABELS) as OvertimeType[]).map(t => <option key={t} value={t}>{OT_LABELS[t]} ({OT_MULTIPLIERS[t]}x)</option>)}
            </select>
            <input type="number" value={l.hours} onChange={e => setOtLines(ls => ls.map((x, xi) => xi === i ? { ...x, hours: e.target.value } : x))}
              placeholder="Hours" className="w-20 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <button onClick={() => setOtLines(ls => ls.filter((_, xi) => xi !== i))} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Allowances (ETB)</label>
        <input type="number" value={allowances} onChange={e => setAllowances(e.target.value)} className="w-32 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">Other deductions (loans, absences, advances…)</label>
          <button onClick={addDeduction} className="text-xs text-blue-600 hover:underline">+ Add</button>
        </div>
        {deductions.map((d, i) => (
          <div key={i} className="flex gap-2 mb-1.5">
            <select value={d.deduction_type} onChange={e => setDeductions(ds => ds.map((x, xi) => xi === i ? { ...x, deduction_type: e.target.value } : x))}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white capitalize">
              {['absence', 'loan_repayment', 'salary_reduction', 'advance', 'other'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
            <input value={d.description} onChange={e => setDeductions(ds => ds.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))}
              placeholder="Note" className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <input type="number" value={d.amount_etb || ''} onChange={e => setDeductions(ds => ds.map((x, xi) => xi === i ? { ...x, amount_etb: Number(e.target.value) } : x))}
              placeholder="ETB" className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <button onClick={() => setDeductions(ds => ds.filter((_, xi) => xi !== i))} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Saving…' : 'Recalculate & save'}
        </button>
      </div>
    </div>
  )
}

const OT_TYPES = Object.keys(OT_LABELS) as OvertimeType[]
const OT_SHORT_LABELS: Record<OvertimeType, string> = { weekday: 'Weekday', night: 'Night', rest_day: 'Rest day', public_holiday: 'Holiday' }

// A factory floor of 50-100 daily-wage/casual workers can't reasonably be
// entered one row-edit-panel at a time — this is a spreadsheet-style table
// covering just days worked + overtime hours (the two fields that actually
// vary week to week for that cohort) across every non-permanent employee at
// once. Allowances/deductions stay rare enough to edit individually via the
// regular per-row form; this tool only ever touches days + OT, so it leaves
// whatever allowances/deductions/notes already exist on each entry
// untouched (recalculateAndSaveEntry always does a full recompute, so those
// values are read from the entry and passed straight through unchanged).
function BulkFactoryForm({ entries, employeeById, onCancel, onSaved }: {
  entries: PayrollEntry[]; employeeById: Map<string, Employee>; onCancel: () => void; onSaved: () => void
}) {
  const factoryEntries = useMemo(() => entries.filter(e => e.employment_type !== 'permanent'), [entries])
  const [rows, setRows] = useState<Record<string, { days: string; ot: Record<OvertimeType, string> }>>(() =>
    Object.fromEntries(factoryEntries.map(e => [e.id, {
      days: e.days_worked != null ? String(e.days_worked) : '',
      ot: Object.fromEntries(OT_TYPES.map(t => [t, String(e.overtime_lines.find(l => l.ot_type === t)?.hours ?? '')])) as Record<OvertimeType, string>,
    }]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setDays(id: string, v: string) { setRows(r => ({ ...r, [id]: { ...r[id], days: v } })) }
  function setOt(id: string, type: OvertimeType, v: string) { setRows(r => ({ ...r, [id]: { ...r[id], ot: { ...r[id].ot, [type]: v } } })) }
  function applyDaysToAll(v: string) { setRows(r => Object.fromEntries(Object.keys(r).map(id => [id, { ...r[id], days: v }]))) }

  async function submit() {
    setSaving(true); setError(null)
    try {
      const results = await Promise.allSettled(factoryEntries.map(entry => {
        const employee = employeeById.get(entry.employee_id)
        const row = rows[entry.id]
        if (!employee || !row) return Promise.resolve()
        const overtimeLines = OT_TYPES.map(t => ({ ot_type: t, hours: Number(row.ot[t]) || 0 })).filter(l => l.hours > 0)
        return recalculateAndSaveEntry(entry, employee, {
          daysWorked: Number(row.days) || 0,
          overtimeLines,
          allowancesEtb: entry.allowances_etb,
          deductions: entry.deductions,
          notes: entry.notes ?? '',
        })
      }))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) setError(`${failed} of ${factoryEntries.length} rows failed to save. Fix and try again, or edit that employee individually below.`)
      else onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (factoryEntries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 text-xs text-gray-400">
        No daily-wage or casual employees in this pay run — permanent staff don't have days-worked or hourly overtime, so there's nothing to bulk-enter here. Use the per-row edit below instead.
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Users size={14} className="text-blue-600" /> Bulk factory entry — {factoryEntries.length} daily-wage/casual employees</p>
          <p className="text-xs text-gray-400 mt-0.5">Enter days worked and overtime hours for everyone at once, then save in one action.</p>
        </div>
        <button type="button" onClick={() => { const v = prompt('Set days worked for every row below (e.g. 26):'); if (v && !isNaN(Number(v))) applyDaysToAll(v) }}
          className="text-xs text-blue-600 hover:underline shrink-0">Set same days for everyone</button>
      </div>
      {error && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-96 overflow-y-auto">
        <table className="text-xs w-full">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium text-gray-400 whitespace-nowrap">Employee</th>
              <th className="text-center px-2 py-1.5 font-medium text-gray-400 whitespace-nowrap">Days worked</th>
              {OT_TYPES.map(t => (
                <th key={t} className="text-center px-2 py-1.5 font-medium text-gray-400 whitespace-nowrap" title={`${OT_LABELS[t]} (${OT_MULTIPLIERS[t]}x)`}>
                  {OT_SHORT_LABELS[t]} hrs
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {factoryEntries.map((entry, i) => (
              <tr key={entry.id} className={i % 2 === 1 ? 'bg-gray-50/50' : ''}>
                <td className="px-2 py-1 whitespace-nowrap font-medium">{entry.employee_name}</td>
                <td className="px-1 py-1">
                  <input type="number" value={rows[entry.id]?.days ?? ''} onChange={e => setDays(entry.id, e.target.value)}
                    className="w-16 px-1.5 py-1 text-xs border border-gray-200 rounded text-center" />
                </td>
                {OT_TYPES.map(t => (
                  <td key={t} className="px-1 py-1">
                    <input type="number" value={rows[entry.id]?.ot[t] ?? ''} onChange={e => setOt(entry.id, t, e.target.value)}
                      className="w-16 px-1.5 py-1 text-xs border border-gray-200 rounded text-center" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Saving…' : `Save all ${factoryEntries.length} rows`}
        </button>
      </div>
    </div>
  )
}

function Payslip({ entry, period, employee, onClose }: { entry: PayrollEntry; period: PayrollPeriod; employee: Employee | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 print:hidden">
          <h2 className="text-sm font-medium">Payslip</h2>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="p-1.5 text-gray-400 hover:text-gray-600"><Printer size={15} /></button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
        </div>
        <div className="p-5 text-sm">
          <p className="text-base font-medium">{entry.employee_name}</p>
          <p className="text-xs text-gray-400 mb-4">{employee?.title ?? ''}{employee?.department && ` · ${employee.department}`} · {MONTH_NAMES[period.period_month - 1]} {period.period_year}</p>
          <div className="space-y-1.5 border-t border-gray-100 pt-3">
            <div className="flex justify-between"><span className="text-gray-500">Base pay {entry.employment_type !== 'permanent' && `(${entry.days_worked} days)`}</span><span className="font-mono">{N(entry.base_pay_etb)}</span></div>
            {entry.overtime_pay_etb > 0 && <div className="flex justify-between"><span className="text-gray-500">Overtime</span><span className="font-mono">{N(entry.overtime_pay_etb)}</span></div>}
            {entry.allowances_etb > 0 && <div className="flex justify-between"><span className="text-gray-500">Allowances</span><span className="font-mono">{N(entry.allowances_etb)}</span></div>}
            <div className="flex justify-between font-medium border-t border-gray-100 pt-1.5"><span>Gross pay</span><span className="font-mono">{N(entry.gross_pay_etb)}</span></div>
          </div>
          <div className="space-y-1.5 border-t border-gray-100 pt-3 mt-3">
            <div className="flex justify-between text-red-600"><span>Pension (7%, employee)</span><span className="font-mono">−{N(entry.pension_employee_etb)}</span></div>
            <div className="flex justify-between text-red-600"><span>Income tax (PAYE)</span><span className="font-mono">−{N(entry.income_tax_etb)}</span></div>
            {entry.other_deductions_etb > 0 && <div className="flex justify-between text-red-600"><span>Other deductions</span><span className="font-mono">−{N(entry.other_deductions_etb)}</span></div>}
          </div>
          <div className="flex justify-between text-base font-semibold border-t border-gray-200 pt-3 mt-3">
            <span>Net pay</span><span className="font-mono text-green-700">{N(entry.net_pay_etb)} ETB</span>
          </div>
          <p className="text-xs text-gray-300 mt-4">Employer pension contribution (not deducted from pay): {N(entry.pension_employer_etb)} ETB</p>
        </div>
      </div>
    </div>
  )
}

export function Payroll() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null)
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [payslipEntry, setPayslipEntry] = useState<PayrollEntry | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
  const [recordExpenseAccountId, setRecordExpenseAccountId] = useState('')
  const [showBulkFactory, setShowBulkFactory] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [periodRows, employeeRows, accountRows] = await Promise.all([fetchPayrollPeriods(), fetchEmployees(), fetchAccounts()])
      setPeriods(periodRows)
      setEmployees(employeeRows)
      setAccounts(accountRows ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load payroll.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadEntries = useCallback(async (periodId: string) => {
    setEntriesLoading(true)
    try {
      setEntries(await fetchPayrollEntries(periodId))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load pay run.')
    } finally {
      setEntriesLoading(false)
    }
  }, [])

  useEffect(() => { if (activePeriodId) loadEntries(activePeriodId) }, [activePeriodId, loadEntries])

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])
  const activePeriod = periods.find(p => p.id === activePeriodId) ?? null

  const totals = useMemo(() => ({
    gross: entries.reduce((s, e) => s + e.gross_pay_etb, 0),
    tax: entries.reduce((s, e) => s + e.income_tax_etb, 0),
    pension: entries.reduce((s, e) => s + e.pension_employee_etb + e.pension_employer_etb, 0),
    net: entries.reduce((s, e) => s + e.net_pay_etb, 0),
  }), [entries])

  async function handleFinalize() {
    if (!activePeriod) return
    setFinalizing(true); setError(null)
    try {
      await finalizePayrollPeriod(activePeriod.id)
      if (recordExpenseAccountId) {
        await recordCompanyExpense({
          category: 'salary', description: `Payroll — ${MONTH_NAMES[activePeriod.period_month - 1]} ${activePeriod.period_year}`,
          amount: totals.net, currency: 'ETB', method: 'bank_transfer', expenseDate: new Date().toISOString().split('T')[0],
          accountId: recordExpenseAccountId,
        })
      }
      await load()
      await loadEntries(activePeriod.id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to finalize.')
    } finally {
      setFinalizing(false)
    }
  }

  async function handleDeletePeriod(id: string) {
    if (!confirm('Delete this draft pay run? This removes every entry in it.')) return
    try {
      await deletePayrollPeriod(id)
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete.')
    }
  }

  if (activePeriodId && activePeriod) {
    return (
      <div className="p-5 max-w-5xl mx-auto">
        <button onClick={() => setActivePeriodId(null)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
          <ChevronLeft size={13} /> Back to pay runs
        </button>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-medium">{MONTH_NAMES[activePeriod.period_month - 1]} {activePeriod.period_year}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{entries.length} employees · {activePeriod.status}</p>
          </div>
          {activePeriod.status === 'draft' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowBulkFactory(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                {showBulkFactory ? <X size={12} /> : <Users size={12} />} Bulk factory entry
              </button>
              <select value={recordExpenseAccountId} onChange={e => setRecordExpenseAccountId(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
                <option value="">Don't record as an expense</option>
                {accounts.map(a => <option key={a.id} value={a.id}>Record net pay from {a.name}</option>)}
              </select>
              <button onClick={handleFinalize} disabled={finalizing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white disabled:opacity-50">
                {finalizing ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} {finalizing ? 'Finalizing…' : 'Finalize pay run'}
              </button>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-50 text-green-700"><Lock size={12} /> Finalized</span>
          )}
        </div>

        {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

        {showBulkFactory && activePeriod.status === 'draft' && (
          <BulkFactoryForm entries={entries} employeeById={employeeById}
            onCancel={() => setShowBulkFactory(false)}
            onSaved={() => { setShowBulkFactory(false); loadEntries(activePeriod.id) }} />
        )}

        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-gray-50 rounded-xl px-4 py-3"><p className="text-xs text-gray-400">Gross pay</p><p className="text-lg font-medium font-mono">{N(totals.gross)}</p></div>
          <div className="bg-gray-50 rounded-xl px-4 py-3"><p className="text-xs text-gray-400">Income tax</p><p className="text-lg font-medium font-mono text-amber-700">{N(totals.tax)}</p></div>
          <div className="bg-gray-50 rounded-xl px-4 py-3"><p className="text-xs text-gray-400">Pension (both sides)</p><p className="text-lg font-medium font-mono text-amber-700">{N(totals.pension)}</p></div>
          <div className="bg-gray-50 rounded-xl px-4 py-3"><p className="text-xs text-gray-400">Net pay</p><p className="text-lg font-medium font-mono text-green-700">{N(totals.net)}</p></div>
        </div>

        {entriesLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
              <div>Employee</div><div className="text-right">Gross</div><div className="text-right">Pension</div><div className="text-right">Tax</div><div className="text-right">Other ded.</div><div className="text-right">Net</div><div></div>
            </div>
            {entries.map((entry, i) => {
              const emp = employeeById.get(entry.employee_id)
              return (
                <div key={entry.id} className={i < entries.length - 1 ? 'border-b border-gray-50' : ''}>
                  <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-4 py-3 items-center text-sm">
                    <div>
                      <p className="font-medium">{entry.employee_name}</p>
                      <p className="text-xs text-gray-400 capitalize">{entry.employment_type.replace('_', ' ')}</p>
                    </div>
                    <div className="text-right font-mono text-xs">{N(entry.gross_pay_etb)}</div>
                    <div className="text-right font-mono text-xs text-amber-700">{N(entry.pension_employee_etb)}</div>
                    <div className="text-right font-mono text-xs text-amber-700">{N(entry.income_tax_etb)}</div>
                    <div className="text-right font-mono text-xs text-amber-700">{N(entry.other_deductions_etb)}</div>
                    <div className="text-right font-mono text-xs font-medium text-green-700">{N(entry.net_pay_etb)}</div>
                    <div className="flex gap-1">
                      <button onClick={() => setPayslipEntry(entry)} className="p-1.5 text-gray-300 hover:text-blue-600"><Printer size={13} /></button>
                      {activePeriod.status === 'draft' && (
                        <button onClick={() => setEditingEntryId(editingEntryId === entry.id ? null : entry.id)} className="p-1.5 text-gray-300 hover:text-blue-600">
                          {editingEntryId === entry.id ? <X size={13} /> : <Pencil size={13} />}
                        </button>
                      )}
                    </div>
                  </div>
                  {editingEntryId === entry.id && (
                    <EntryEditForm entry={entry} employee={emp} onCancel={() => setEditingEntryId(null)}
                      onSaved={() => { setEditingEntryId(null); loadEntries(activePeriod.id) }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {payslipEntry && <Payslip entry={payslipEntry} period={activePeriod} employee={employeeById.get(payslipEntry.employee_id)} onClose={() => setPayslipEntry(null)} />}
      </div>
    )
  }

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><Wallet size={18} /> Payroll</h1>
          <p className="text-xs text-gray-400 mt-0.5">Monthly pay runs — PAYE, pension, and overtime calculated per <Link to="/hr-notes" className="text-blue-600 hover:underline">HR Notes</Link></p>
        </div>
        <button onClick={() => setShowNewForm(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
          {showNewForm ? <X size={12} /> : <Plus size={12} />} New pay run
        </button>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {employees.filter(e => e.is_active).length === 0 && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>No active employees yet — <Link to="/employees" className="underline">add your team</Link> before starting a pay run.</span>
        </div>
      )}

      {showNewForm && <NewRunForm employees={employees} onCancel={() => setShowNewForm(false)} onCreated={id => { setShowNewForm(false); load(); setActivePeriodId(id) }} />}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : periods.length === 0 ? (
        <div className="text-center py-16">
          <Wallet size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No pay runs yet</p>
          <p className="text-xs text-gray-400">Create one above to calculate this month's pay.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {periods.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${i < periods.length - 1 ? 'border-b border-gray-50' : ''}`}
              onClick={() => setActivePeriodId(p.id)}>
              <div className="flex-1">
                <p className="text-sm font-medium">{MONTH_NAMES[p.period_month - 1]} {p.period_year}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'finalized' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{p.status}</span>
              {p.status === 'draft' && (
                <button onClick={e => { e.stopPropagation(); handleDeletePeriod(p.id) }} className="p-1.5 text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
