import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { UserCog, Loader2, ShieldOff } from 'lucide-react'

interface UserRow {
  id: string
  full_name: string | null
  role: string
  employee_id: string | null
  employee_name: string | null
}
interface EmployeeOption { id: string; full_name: string }

const ROLES = [
  { value: 'pending', label: 'Pending (no access)' },
  { value: 'full_access', label: 'Full access' },
  { value: 'accounting_finance', label: 'Accounting & Finance' },
  { value: 'operations_marketing', label: 'Operations & Marketing' },
  { value: 'manufacturing_sales', label: 'Manufacturing & Sales' },
  { value: 'hr_system', label: 'HR & System' },
]

export function Users() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const canManage = profile?.role === 'full_access' || profile?.role === 'hr_system'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profilesRes, employeesRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, employee_id, employees(full_name)'),
        supabase.from('employees').select('id, full_name').order('full_name'),
      ])
      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      setRows((profilesRes.data ?? []).map((r: any) => ({
        id: r.id, full_name: r.full_name, role: r.role, employee_id: r.employee_id,
        employee_name: one(r.employees)?.full_name ?? null,
      })))
      setEmployees((employeesRes.data ?? []).map((e: any) => ({ id: e.id, full_name: e.full_name })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function updateRole(userId: string, role: string) {
    setSavingId(userId)
    try {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
      if (error) throw error
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSavingId(null)
    }
  }

  async function updateEmployee(userId: string, employeeId: string) {
    setSavingId(userId)
    try {
      const { error } = await supabase.from('profiles').update({ employee_id: employeeId || null }).eq('id', userId)
      if (error) throw error
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSavingId(null)
    }
  }

  if (!canManage) {
    return (
      <div className="p-5 max-w-md mx-auto text-center py-16">
        <ShieldOff size={28} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">Only Full Access and HR & System roles can manage users.</p>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2"><UserCog size={18} /> Users &amp; Roles</h1>
        <p className="text-xs text-gray-400 mt-0.5">Assign what each person can access, and link their login to an employee record</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{r.full_name ?? 'Unnamed'}</p>
                {r.role === 'pending' && <p className="text-xs text-amber-600">Waiting for a role</p>}
              </div>
              <select
                value={r.employee_id ?? ''}
                onChange={e => updateEmployee(r.id, e.target.value)}
                disabled={savingId === r.id}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white w-40"
              >
                <option value="">No linked employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
              <select
                value={r.role}
                onChange={e => updateRole(r.id, e.target.value)}
                disabled={savingId === r.id}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white w-48"
              >
                {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}