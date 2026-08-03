import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPayrollPeriods, createPayrollPeriod, deletePayrollPeriod,
  fetchPayrollEntries, recalculateAndSaveEntry, finalizePayrollPeriod, fetchWarehousePayrollInbox, fetchWarehousePayrollInboxEmployees,
} from '../api/payroll'
import type { PayrollPeriod, PayrollEntry, PayrollEntryDeduction, WarehousePayrollInboxItem, WarehousePayrollInboxEmployee } from '../api/payroll'
import { transitionWarehousePayroll } from '../api/warehouseOperations'
import { fetchEmployees } from '../api/employees'
import type { Employee } from '../api/employees'
import { fetchAccounts } from '../api/accounts'
import type { Account } from '../api/accounts'
import { recordCompanyExpense } from '../api/companyExpenses'
import { OT_LABELS, OT_MULTIPLIERS } from '../lib/payrollEngine'
import type { OvertimeType } from '../lib/payrollEngine'
import {
  Wallet, Loader2, Plus, X, Check, Lock, ChevronLeft, Pencil, Trash2,
  Printer, Info, Users, AlertTriangle, Building2, Warehouse, ShieldCheck, Landmark, Clock3, ArrowRight, FileCheck2, Banknote,
} from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SwipeToDelete } from '../components/ui/SwipeToDelete'
import './HrWorkspace.css'

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
    <div className="bg-white border border-gray-200 rounded-card p-4 mb-4 space-y-2.5">
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

// A larger head-office team cannot reasonably be
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
  // Overtime applies regardless of employment type (Labour Proclamation
  // 1156/2019 Art. 68 isn't limited to daily/casual staff), so every
  // employee in the run gets an OT row here — only "days worked" is
  // meaningless for permanent staff (their base pay is a flat monthly
  // salary), so that column is disabled for them rather than hidden, to
  // keep one consistent table instead of splitting bulk entry in two.
  const bulkEntries = entries
  const [selected, setSelected] = useState<Set<string>>(() => new Set(bulkEntries.map(e => e.id)))
  const [rows, setRows] = useState<Record<string, { days: string; ot: Record<OvertimeType, string> }>>(() =>
    Object.fromEntries(bulkEntries.map(e => [e.id, {
      days: e.days_worked != null ? String(e.days_worked) : '',
      ot: Object.fromEntries(OT_TYPES.map(t => [t, String(e.overtime_lines.find(l => l.ot_type === t)?.hours ?? '')])) as Record<OvertimeType, string>,
    }]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleSelected(id: string) {
    setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function setDays(id: string, v: string) { setRows(r => ({ ...r, [id]: { ...r[id], days: v } })) }
  function setOt(id: string, type: OvertimeType, v: string) { setRows(r => ({ ...r, [id]: { ...r[id], ot: { ...r[id].ot, [type]: v } } })) }
  function applyDaysToAll(v: string) {
    setRows(r => Object.fromEntries(Object.entries(r).map(([id, row]) => {
      const entry = bulkEntries.find(e => e.id === id)
      return [id, entry?.employment_type === 'permanent' ? row : { ...row, days: v }]
    })))
  }
  function applyOtToSelected(type: OvertimeType, v: string) {
    setRows(r => Object.fromEntries(Object.entries(r).map(([id, row]) =>
      [id, selected.has(id) ? { ...row, ot: { ...row.ot, [type]: v } } : row])))
  }

  const selectedEntries = bulkEntries.filter(e => selected.has(e.id))

  async function submit() {
    if (selectedEntries.length === 0) { setError('Select at least one employee to save.'); return }
    setSaving(true); setError(null)
    try {
      const results = await Promise.allSettled(selectedEntries.map(entry => {
        const employee = employeeById.get(entry.employee_id)
        const row = rows[entry.id]
        if (!employee || !row) return Promise.resolve()
        const overtimeLines = OT_TYPES.map(t => ({ ot_type: t, hours: Number(row.ot[t]) || 0 })).filter(l => l.hours > 0)
        return recalculateAndSaveEntry(entry, employee, {
          daysWorked: entry.employment_type === 'permanent' ? (entry.days_worked ?? 0) : (Number(row.days) || 0),
          overtimeLines,
          allowancesEtb: entry.allowances_etb,
          deductions: entry.deductions,
          notes: entry.notes ?? '',
        })
      }))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) setError(`${failed} of ${selectedEntries.length} rows failed to save. Fix and try again, or edit that employee individually below.`)
      else onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (bulkEntries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-card p-4 mb-4 text-xs text-gray-400">
        No employees in this pay run yet.
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-card p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Users size={14} className="text-blue-600" /> Bulk days and overtime — {selectedEntries.length} of {bulkEntries.length} employees selected</p>
          <p className="text-xs text-gray-400 mt-0.5">Enter days worked and overtime hours for a group of employees at once, then save in one action. Uncheck anyone this run doesn't apply to.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={() => { const v = prompt('Set OT hours (weekday) for every selected row below:'); if (v && !isNaN(Number(v))) applyOtToSelected('weekday', v) }}
            className="text-xs text-blue-600 hover:underline">Set weekday OT for selected</button>
          <button type="button" onClick={() => { const v = prompt('Set days worked for every daily/casual row below (e.g. 26):'); if (v && !isNaN(Number(v))) applyDaysToAll(v) }}
            className="text-xs text-blue-600 hover:underline">Set same days for everyone</button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-96 overflow-y-auto">
        <table className="text-xs w-full">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-1.5">
                <input type="checkbox" checked={selected.size === bulkEntries.length}
                  onChange={e => setSelected(e.target.checked ? new Set(bulkEntries.map(en => en.id)) : new Set())} />
              </th>
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
            {bulkEntries.map((entry, i) => {
              const isPermanent = entry.employment_type === 'permanent'
              return (
                <tr key={entry.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} ${!selected.has(entry.id) ? 'opacity-40' : ''}`}>
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelected(entry.id)} />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap font-medium">
                    {entry.employee_name}
                    {isPermanent && <span className="text-gray-400 font-normal"> · salaried</span>}
                  </td>
                  <td className="px-1 py-1">
                    <input type="number" value={rows[entry.id]?.days ?? ''} onChange={e => setDays(entry.id, e.target.value)}
                      disabled={isPermanent} title={isPermanent ? 'Salaried staff are paid a flat monthly amount — days worked doesn\'t affect base pay' : undefined}
                      className="w-16 px-1.5 py-1 text-xs border border-gray-200 rounded text-center disabled:bg-gray-50 disabled:text-gray-300" />
                  </td>
                  {OT_TYPES.map(t => (
                    <td key={t} className="px-1 py-1">
                      <input type="number" value={rows[entry.id]?.ot[t] ?? ''} onChange={e => setOt(entry.id, t, e.target.value)}
                        className="w-16 px-1.5 py-1 text-xs border border-gray-200 rounded text-center" />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Saving…' : `Save ${selectedEntries.length} selected row${selectedEntries.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

function Payslip({ entry, period, employee, onClose }: { entry: PayrollEntry; period: PayrollPeriod; employee: Employee | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-card w-full max-w-md shadow-xl">
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
            <div className="flex justify-between"><span className="text-gray-500">Base pay {entry.employment_type !== 'permanent' ? `(${entry.days_worked} days)` : '(gross)'}</span><span className="font-mono">{N(entry.base_pay_etb)}</span></div>
            {entry.employment_type === 'permanent' && employee?.base_salary_etb != null && (
              <div className="flex justify-between text-gray-400"><span>Net salary on file</span><span className="font-mono">{N(employee.base_salary_etb)}</span></div>
            )}
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

function WarehousePayrollInbox({ runs, loading, onRefresh }: { runs: WarehousePayrollInboxItem[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<'all' | 'attention' | 'approved' | 'posted'>('all')
  const [selected, setSelected] = useState<WarehousePayrollInboxItem | null>(null)
  const [employees, setEmployees] = useState<WarehousePayrollInboxEmployee[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = runs.filter(run => status === 'all' || status === 'attention' && ['submitted','hr_approved','finance_approved'].includes(run.status) || status === 'approved' && ['hr_approved','finance_approved'].includes(run.status) || status === 'posted' && ['posted','paid'].includes(run.status))
  const open = async (run: WarehousePayrollInboxItem) => { setSelected(run); setDetailLoading(true); setError(null); try { setEmployees(await fetchWarehousePayrollInboxEmployees(run.id)) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load payroll detail.') } finally { setDetailLoading(false) } }
  const act = async (action: 'hr_approve' | 'finance_approve' | 'post' | 'reject') => { if (!selected) return; setActing(true); setError(null); try { await transitionWarehousePayroll(selected.id, action); await onRefresh(); setSelected(null) } catch (caught) { setError(caught instanceof Error ? caught.message : 'The payroll action failed.') } finally { setActing(false) } }
  const action = selected?.status === 'submitted' ? { label: 'Approve HR review', value: 'hr_approve' as const, icon: ShieldCheck } : selected?.status === 'hr_approved' ? { label: 'Approve for Finance', value: 'finance_approve' as const, icon: Landmark } : selected?.status === 'finance_approved' ? { label: 'Post accounting journal', value: 'post' as const, icon: FileCheck2 } : null
  if (loading) return <div className="hr-loading"><Loader2 className="animate-spin" /> Loading warehouse submissions…</div>
  return <section className="payroll-inbox">
    <div className="payroll-inbox__toolbar"><div><span>Approval queue</span><b>{runs.filter(run => ['submitted','hr_approved','finance_approved'].includes(run.status)).length} run(s) require action</b></div><nav>{(['all','attention','approved','posted'] as const).map(item => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>)}</nav></div>
    {error && <div className="hr-form-error">{error}</div>}
    {visible.length ? <div className="payroll-inbox__list">{visible.map(run => <button key={run.id} onClick={() => void open(run)} className={selected?.id === run.id ? 'active' : ''}><i><Warehouse /></i><span><small>{run.warehouse_name}</small><b>{run.run_number}</b><em>{new Date(run.period_start).toLocaleDateString()} – {new Date(run.period_end).toLocaleDateString()}</em></span><span><small>Employees</small><b>{run.employee_count}</b></span><span><small>Gross</small><b>{N(run.gross_amount)} ETB</b></span><span><small>Net</small><b>{N(run.net_amount)} ETB</b></span><strong className={`payroll-state state-${run.status}`}>{run.status.replaceAll('_',' ')}</strong><ArrowRight /></button>)}</div> : <div className="hr-empty"><FileCheck2 /><h3>No payroll runs in this category</h3><p>Warehouse submissions appear here after the warehouse manager completes calculation and submits the run.</p></div>}
    {selected && <div className="payroll-review"><header><div><span>{selected.warehouse_name}</span><h3>{selected.run_number}</h3><p>{selected.employee_count} employee calculation snapshots · warehouse figures cannot be edited centrally</p></div><button aria-label="Close payroll review" onClick={() => setSelected(null)}><X /></button></header><div className="payroll-review__metrics"><span>Regular + OT + incentive<b>{N(selected.gross_amount)} ETB</b></span><span>Overtime<b>{N(selected.overtime_amount)} ETB</b></span><span>Tax + pension + deductions<b>{N(selected.tax_amount + selected.pension_amount + selected.deduction_amount)} ETB</b></span><span>Net payable<b>{N(selected.net_amount)} ETB</b></span></div>{detailLoading ? <div className="hr-loading"><Loader2 className="animate-spin" /> Loading calculations…</div> : <div className="payroll-review__table"><div className="head"><span>Employee</span><span>Days</span><span>Regular</span><span>OT</span><span>Incentive</span><span>Tax / pension</span><span>Net</span></div>{employees.map(employee => <div key={employee.id}><span><b>{employee.employee_name}</b></span><span>{employee.days_worked}</span><span>{N(employee.regular_pay)}</span><span>{N(employee.overtime_pay)}<small>{employee.overtime_hours} h</small></span><span>{N(employee.production_incentive)}</span><span>{N(employee.tax + employee.pension_employee)}</span><span><b>{N(employee.net_pay)}</b></span></div>)}</div>}<footer><span><Lock /> Attendance, overtime and calculation detail remain owned by {selected.warehouse_name}.</span><div>{['submitted','hr_approved','finance_approved'].includes(selected.status) && <Button variant="secondary" disabled={acting} onClick={() => void act('reject')}>Return to warehouse</Button>}{action && <Button loading={acting} icon={<action.icon size={14} />} onClick={() => void act(action.value)}>{action.label}</Button>}</div></footer></div>}
  </section>
}

export function Payroll() {
  const [workspace, setWorkspace] = useState<'corporate' | 'warehouse'>('corporate')
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [warehouseRuns, setWarehouseRuns] = useState<WarehousePayrollInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null)
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [payslipEntry, setPayslipEntry] = useState<PayrollEntry | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recordExpenseAccountId, setRecordExpenseAccountId] = useState('')
  const [showBulkFactory, setShowBulkFactory] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [periodRows, employeeRows, accountRows, warehouseRunRows] = await Promise.all([fetchPayrollPeriods(), fetchEmployees(), fetchAccounts(), fetchWarehousePayrollInbox()])
      setPeriods(periodRows)
      setEmployees(employeeRows)
      setAccounts(accountRows ?? [])
      setWarehouseRuns(warehouseRunRows)
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
  const corporateEmployees = useMemo(() => employees.filter(employee => !employee.warehouse_id), [employees])
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
      <div className="payroll-workspace">
        <button onClick={() => setActivePeriodId(null)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
          <ChevronLeft size={13} /> Back to pay runs
        </button>
        <PageHeader
          title={`${MONTH_NAMES[activePeriod.period_month - 1]} ${activePeriod.period_year}`}
          subtitle={`${entries.length} employees · ${activePeriod.status}`}
          actions={activePeriod.status === 'draft' ? (
            <>
              <Button variant="secondary" icon={showBulkFactory ? <X size={12} /> : <Users size={12} />} onClick={() => setShowBulkFactory(v => !v)}>Bulk days & overtime</Button>
              <select value={recordExpenseAccountId} onChange={e => setRecordExpenseAccountId(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
                <option value="">Don't record as an expense</option>
                {accounts.filter(a => a.currency === 'ETB').map(a => <option key={a.id} value={a.id}>Record net pay from {a.name}</option>)}
              </select>
              <Button loading={finalizing} icon={<Lock size={12} />} className="!bg-green-600 !text-white hover:!brightness-95" onClick={handleFinalize}>Finalize pay run</Button>
            </>
          ) : (
            <Badge variant="success" icon={<Lock size={10} />}>Finalized</Badge>
          )}
        />

        {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

        {showBulkFactory && activePeriod.status === 'draft' && (
          <BulkFactoryForm entries={entries} employeeById={employeeById}
            onCancel={() => setShowBulkFactory(false)}
            onSaved={() => { setShowBulkFactory(false); loadEntries(activePeriod.id) }} />
        )}

        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard label="Gross pay" value={N(totals.gross)} />
          <StatCard label="Income tax" value={<span className="text-amber-700">{N(totals.tax)}</span>} />
          <StatCard label="Pension (both sides)" value={<span className="text-amber-700">{N(totals.pension)}</span>} />
          <StatCard label="Net pay" value={<span className="text-green-700">{N(totals.net)}</span>} />
        </div>

        {entriesLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <Card>
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
          </Card>
        )}

        {payslipEntry && <Payslip entry={payslipEntry} period={activePeriod} employee={employeeById.get(payslipEntry.employee_id)} onClose={() => setPayslipEntry(null)} />}
      </div>
    )
  }

  return (
    <main className="payroll-workspace">
      <section className="hr-hero payroll-hero"><div className="hr-hero__copy"><span>Payroll control center</span><h1>Company payroll</h1><p>Calculate head-office pay centrally and review warehouse-submitted payroll without mixing employee records or calculation ownership.</p></div><div className="hr-hero__guard"><Lock /><span><b>Separation of duties</b>Warehouse prepares · HR reviews · Finance approves and posts</span></div></section>
      <nav className="hr-workspace-tabs" aria-label="Payroll workspaces"><button className={workspace === 'corporate' ? 'active' : ''} onClick={() => setWorkspace('corporate')}><Building2 /><span><b>Head-office payroll</b><small>Calculated by central HR</small></span><strong>{periods.length}</strong></button><button className={workspace === 'warehouse' ? 'active' : ''} onClick={() => { setWorkspace('warehouse'); setShowNewForm(false) }}><Warehouse /><span><b>Warehouse submissions</b><small>Review, approve and post</small></span><strong>{warehouseRuns.filter(run => ['submitted','hr_approved','finance_approved'].includes(run.status)).length}</strong></button></nav>
      <section className="hr-kpis payroll-kpis"><article><i><Users /></i><span>Head-office employees<strong>{corporateEmployees.filter(employee => employee.is_active).length}</strong><small>Central payroll scope</small></span></article><article><i><Clock3 /></i><span>Awaiting approval<strong>{warehouseRuns.filter(run => ['submitted','hr_approved','finance_approved'].includes(run.status)).length}</strong><small>Warehouse submissions</small></span></article><article><i><Banknote /></i><span>Warehouse net payroll<strong>{N(warehouseRuns.filter(run => !['rejected','draft'].includes(run.status)).reduce((sum, run) => sum + run.net_amount, 0))}</strong><small>ETB in current register</small></span></article><article><i><FileCheck2 /></i><span>Posted warehouse runs<strong>{warehouseRuns.filter(run => ['posted','paid'].includes(run.status)).length}</strong><small>Accounting completed</small></span></article></section>
      {workspace === 'corporate' && <PageHeader
        icon={<Wallet size={18} />}
        title="Head-office payroll"
        subtitle={<>Central calculation for employees without a warehouse assignment · PAYE, pension and overtime follow <Link to="/hr-notes" className="text-blue-600 hover:underline">HR Notes</Link></>}
        actions={<Button icon={showNewForm ? <X size={12} /> : <Plus size={12} />} onClick={() => setShowNewForm(v => !v)}>New head-office run</Button>}
      />}

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {workspace === 'warehouse' && <WarehousePayrollInbox runs={warehouseRuns} loading={loading} onRefresh={load} />}
      {workspace === 'corporate' && <>
      {corporateEmployees.filter(e => e.is_active).length === 0 && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>No active head-office employees yet — <Link to="/employees" className="underline">add central employees</Link> before starting a pay run.</span>
        </div>
      )}

      {showNewForm && <NewRunForm employees={corporateEmployees} onCancel={() => setShowNewForm(false)} onCreated={id => { setShowNewForm(false); load(); setActivePeriodId(id) }} />}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : periods.length === 0 ? (
        <div className="text-center py-16">
          <Wallet size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No head-office pay runs yet</p>
          <p className="text-xs text-gray-400">Create a central run here. Warehouse payroll arrives in the separate submissions workspace.</p>
        </div>
      ) : (
        <Card>
          {periods.map((p, i) => {
            const row = (
              <div className={`stagger-row flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${i < periods.length - 1 ? 'border-b border-gray-50' : ''}`}
                style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
                onClick={() => setActivePeriodId(p.id)}>
                <div className="flex-1">
                  <p className="text-sm font-medium">{MONTH_NAMES[p.period_month - 1]} {p.period_year}</p>
                </div>
                <Badge variant={p.status === 'finalized' ? 'success' : 'neutral'}>{p.status}</Badge>
              </div>
            )
            return p.status === 'draft' ? (
              <SwipeToDelete key={p.id} onDelete={() => handleDeletePeriod(p.id)}>{row}</SwipeToDelete>
            ) : <div key={p.id}>{row}</div>
          })}
        </Card>
      )}
      </>}
    </main>
  )
}
