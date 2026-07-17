import { useState, useEffect, useCallback } from 'react'
import { fetchEmployees, createEmployee, updateEmployee } from '../api/employees'
import type { Employee, EmployeeInput } from '../api/employees'
import { fetchWarehousesList } from '../api/income'
import { Users, Loader2, Plus, X, Check, Search, Pencil, ShieldCheck } from 'lucide-react'

interface Option { id: string; name: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const EMPTY_FORM: EmployeeInput = {
  full_name: '', department: '', title: '', warehouse_id: null,
  employment_type: 'permanent', is_active: true, hire_date: null,
  phone: '', tin_number: '', bank_name: '', bank_account_number: '', emergency_contact: '',
  base_salary_etb: null, daily_rate_etb: null, pension_eligible: true, notes: '',
}

function EmployeeForm({ initial, warehouses, onCancel, onSaved }: {
  initial: Employee | null
  warehouses: Option[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<EmployeeInput>(initial ? { ...initial } : { ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) => setForm(f => ({ ...f, [key]: value }))

  async function submit() {
    if (!form.full_name.trim()) { setError('Enter a name.'); return }
    if (form.employment_type === 'permanent' && !form.base_salary_etb) { setError('Enter a monthly base salary for a permanent employee.'); return }
    if (form.employment_type !== 'permanent' && !form.daily_rate_etb) { setError('Enter a daily rate for a daily-wage or casual worker.'); return }
    setSaving(true); setError(null)
    try {
      const payload: EmployeeInput = {
        ...form,
        department: form.department || null, title: form.title || null,
        phone: form.phone || null, tin_number: form.tin_number || null,
        bank_name: form.bank_name || null, bank_account_number: form.bank_account_number || null,
        emergency_contact: form.emergency_contact || null, notes: form.notes || null,
        hire_date: form.hire_date || null, warehouse_id: form.warehouse_id || null,
      }
      if (initial) await updateEmployee(initial.id, payload)
      else await createEmployee(payload)
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save employee.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-4">
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Basic info</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Full name"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="Job title"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.department ?? ''} onChange={e => set('department', e.target.value)} placeholder="Department (e.g. Factory, Sales)"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <select value={form.warehouse_id ?? ''} onChange={e => set('warehouse_id', e.target.value || null)}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">No fixed warehouse/site</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input type="date" value={form.hire_date ?? ''} onChange={e => set('hire_date', e.target.value || null)}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 px-2.5">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
          </label>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Employment & pay</p>
        <div className="grid grid-cols-2 gap-2">
          <select value={form.employment_type} onChange={e => set('employment_type', e.target.value as EmployeeInput['employment_type'])}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="permanent">Permanent (monthly salary)</option>
            <option value="daily_wage">Daily wage (e.g. factory line worker)</option>
            <option value="casual">Casual (short-term, under 45 days)</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 px-2.5">
            <input type="checkbox" checked={form.pension_eligible} onChange={e => set('pension_eligible', e.target.checked)} /> Pension-eligible
          </label>
          {form.employment_type === 'permanent' ? (
            <input type="number" value={form.base_salary_etb ?? ''} onChange={e => set('base_salary_etb', e.target.value ? Number(e.target.value) : null)}
              placeholder="Monthly base salary (ETB)" className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          ) : (
            <input type="number" value={form.daily_rate_etb ?? ''} onChange={e => set('daily_rate_etb', e.target.value ? Number(e.target.value) : null)}
              placeholder="Daily rate (ETB)" className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          )}
        </div>
        {form.employment_type !== 'permanent' && (
          <p className="text-xs text-amber-600 mt-1.5">
            Under the Pension Proclamation, workers engaged 45+ days are generally pension-eligible regardless of daily-wage pay structure — don't uncheck "pension-eligible" purely because pay is daily. See HR Notes.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Bank, tax & contact</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="Phone"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.tin_number ?? ''} onChange={e => set('tin_number', e.target.value)} placeholder="TIN number"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.bank_name ?? ''} onChange={e => set('bank_name', e.target.value)} placeholder="Bank name"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.bank_account_number ?? ''} onChange={e => set('bank_account_number', e.target.value)} placeholder="Bank account number"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <input value={form.emergency_contact ?? ''} onChange={e => set('emergency_contact', e.target.value)} placeholder="Emergency contact (name & phone)"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg col-span-2" />
        </div>
      </div>

      <input value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Saving…' : 'Save employee'}
        </button>
      </div>
    </div>
  )
}

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [emp, wh] = await Promise.all([fetchEmployees(), fetchWarehousesList()])
      setEmployees(emp)
      setWarehouses((wh ?? []).map((w: any) => ({ id: w.id, name: w.name })))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load employees.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = employees.filter(e =>
    !search.trim() || e.full_name.toLowerCase().includes(search.toLowerCase()) || (e.department ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><Users size={18} /> Employees</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {employees.length} on record · {employees.filter(e => e.is_active).length} active ·{' '}
            <span className="inline-flex items-center gap-1"><ShieldCheck size={11} className="text-gray-400" /> HR only — includes salary, bank, and TIN</span>
          </p>
        </div>
        <button onClick={() => { setShowForm(v => !v); setEditing(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
          {showForm && !editing ? <X size={12} /> : <Plus size={12} />} New employee
        </button>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {showForm && (
        <EmployeeForm
          initial={editing}
          warehouses={warehouses}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); load() }}
        />
      )}

      {!showForm && employees.length > 0 && (
        <div className="relative mb-3">
          <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or department"
            className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-64" />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : employees.length === 0 ? (
        <div className="text-center py-16">
          <Users size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No employees on record yet</p>
          <p className="text-xs text-gray-400">Add your team — payroll, production logs, and expense records all link back to these.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {visible.map((e, i) => (
            <div key={e.id} className={`flex items-center gap-3 px-4 py-3 ${i < visible.length - 1 ? 'border-b border-gray-50' : ''} ${!e.is_active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{e.full_name}</p>
                <p className="text-xs text-gray-400">
                  {e.title ?? '—'}{e.department && ` · ${e.department}`}
                  {!e.is_active && ' · inactive'}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                {e.employment_type.replace('_', ' ')}
              </span>
              <div className="text-right w-28">
                <p className="text-xs font-mono font-medium text-gray-700">
                  {e.employment_type === 'permanent' ? `${N(e.base_salary_etb ?? 0)}/mo` : `${N(e.daily_rate_etb ?? 0)}/day`}
                </p>
                {!e.pension_eligible && <p className="text-xs text-amber-600">No pension</p>}
              </div>
              <button onClick={() => { setEditing(e); setShowForm(true) }} className="p-1.5 text-gray-300 hover:text-blue-600">
                <Pencil size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
