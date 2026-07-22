import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { resetUserPassword, fetchUserEmails } from '../api/admin'
import { UserCog, Loader2, ShieldOff, KeyRound, Eye, EyeOff, Check, X } from 'lucide-react'

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
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
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetShow, setResetShow] = useState(false)
  const [resetSaving, setResetSaving] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetDoneId, setResetDoneId] = useState<string | null>(null)

  const canManage = profile?.role === 'full_access' || profile?.role === 'hr_system'

  function openReset(userId: string) {
    setResetId(userId); setResetPassword(''); setResetShow(false); setResetError(null); setResetDoneId(null)
  }

  async function submitReset(userId: string) {
    if (resetPassword.length < 6) { setResetError('Password must be at least 6 characters.'); return }
    setResetSaving(true); setResetError(null)
    try {
      await resetUserPassword(userId, resetPassword)
      setResetId(null); setResetPassword('')
      setResetDoneId(userId)
      setTimeout(() => setResetDoneId(prev => (prev === userId ? null : prev)), 4000)
    } catch (e: any) {
      setResetError(e?.message ?? 'Failed to reset password.')
    } finally {
      setResetSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profilesRes, employeesRes, emailMap] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, employee_id, employees(full_name)'),
        supabase.from('employees').select('id, full_name').order('full_name'),
        // Emails live in auth.users, not profiles — the browser can't read
        // that table directly, so this goes through the admin Edge
        // Function. Fails soft: the rest of the page (roles, employee
        // links) still works even if emails can't be shown.
        fetchUserEmails().catch(() => ({} as Record<string, string>)),
      ])
      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      setRows((profilesRes.data ?? []).map((r: any) => ({
        id: r.id, full_name: r.full_name, email: emailMap[r.id] ?? null, role: r.role, employee_id: r.employee_id,
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
            <div key={r.id} className={`${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.full_name ?? 'Unnamed'}</p>
                  {r.email && <p className="text-xs text-gray-400 truncate">{r.email}</p>}
                  {r.role === 'pending' && <p className="text-xs text-amber-600">Waiting for a role</p>}
                  {resetDoneId === r.id && <p className="text-xs text-green-600 flex items-center gap-1"><Check size={11} /> Password reset — let them know their new one.</p>}
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
                <button
                  onClick={() => resetId === r.id ? setResetId(null) : openReset(r.id)}
                  title="Reset password"
                  className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                    resetId === r.id ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <KeyRound size={13} />
                </button>
              </div>

              {resetId === r.id && (
                <div className="px-4 py-3 bg-amber-50/50 border-t border-amber-100 flex items-center gap-2">
                  <div className="relative flex-1 max-w-xs">
                    <input
                      type={resetShow ? 'text' : 'password'}
                      value={resetPassword}
                      onChange={e => setResetPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitReset(r.id)}
                      placeholder={`New password for ${r.full_name ?? 'this user'}`}
                      className="w-full px-2.5 py-1.5 pr-8 text-xs border border-gray-200 rounded-lg"
                      autoFocus
                    />
                    <button
                      onClick={() => setResetShow(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {resetShow ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <button
                    onClick={() => submitReset(r.id)}
                    disabled={resetSaving}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white disabled:opacity-50"
                  >
                    {resetSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Set password
                  </button>
                  <button onClick={() => setResetId(null)} className="p-1.5 text-gray-400 hover:text-gray-600">
                    <X size={13} />
                  </button>
                  {resetError && <p className="text-xs text-red-600">{resetError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}