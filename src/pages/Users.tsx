import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { resetUserPassword, fetchUserEmails } from '../api/admin'
import { UserCog, Loader2, ShieldOff, KeyRound, Eye, EyeOff, Check, X, Factory, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SelectMenu } from '../components/ui/SelectMenu'

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
  role: string
  employee_id: string | null
  employee_name: string | null
}
interface EmployeeOption { id: string; full_name: string }
interface OperationalUnitOption { id: string; name: string }
interface WarehouseAssignment {
  id: string
  profile_id: string
  operational_unit_id: string | null
  access_role: 'regional_manager' | 'warehouse_manager' | 'payroll_officer' | 'viewer'
}
interface AssignmentDraft {
  operational_unit_id: string
  access_role: WarehouseAssignment['access_role']
}
interface ProfileQueryRow {
  id: string
  full_name: string | null
  role: string
  employee_id: string | null
  employees: { full_name: string } | Array<{ full_name: string }> | null
}

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
  const [operationalUnits, setOperationalUnits] = useState<OperationalUnitOption[]>([])
  const [warehouseAssignments, setWarehouseAssignments] = useState<WarehouseAssignment[]>([])
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentDraft>>({})
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
    } catch (e: unknown) {
      setResetError(e instanceof Error ? e.message : 'Failed to reset password.')
    } finally {
      setResetSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profilesRes, employeesRes, unitsRes, assignmentsRes, emailMap] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, employee_id, employees(full_name)'),
        supabase.from('employees').select('id, full_name').order('full_name'),
        supabase.from('operational_units').select('id, name').eq('is_active', true).order('name'),
        supabase.from('warehouse_user_assignments').select('id, profile_id, operational_unit_id, access_role').eq('is_active', true),
        // Emails live in auth.users, not profiles — the browser can't read
        // that table directly, so this goes through the admin Edge
        // Function. Fails soft: the rest of the page (roles, employee
        // links) still works even if emails can't be shown.
        fetchUserEmails().catch(() => ({} as Record<string, string>)),
      ])
      const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      setRows(((profilesRes.data ?? []) as ProfileQueryRow[]).map(r => ({
        id: r.id, full_name: r.full_name, email: emailMap[r.id] ?? null, role: r.role, employee_id: r.employee_id,
        employee_name: one(r.employees)?.full_name ?? null,
      })))
      setEmployees((employeesRes.data ?? []) as EmployeeOption[])
      setOperationalUnits((unitsRes.data ?? []) as OperationalUnitOption[])
      setWarehouseAssignments((assignmentsRes.data ?? []) as WarehouseAssignment[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

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

  function assignmentDraft(userId: string): AssignmentDraft {
    return assignmentDrafts[userId] ?? {
      operational_unit_id: operationalUnits[0]?.id ?? '',
      access_role: 'warehouse_manager',
    }
  }

  function updateAssignmentDraft(userId: string, patch: Partial<AssignmentDraft>) {
    setAssignmentDrafts(current => {
      const existing = current[userId] ?? {
        operational_unit_id: operationalUnits[0]?.id ?? '',
        access_role: 'warehouse_manager' as const,
      }
      return { ...current, [userId]: { ...existing, ...patch } }
    })
  }

  async function addWarehouseAssignment(userId: string) {
    const draft = assignmentDraft(userId)
    if (draft.access_role !== 'regional_manager' && !draft.operational_unit_id) return
    setSavingId(userId)
    try {
      const { error } = await supabase.from('warehouse_user_assignments').insert({
        profile_id: userId,
        operational_unit_id: draft.access_role === 'regional_manager' ? null : draft.operational_unit_id,
        access_role: draft.access_role,
        assigned_by: profile?.id ?? null,
      })
      if (error) throw error
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSavingId(null)
    }
  }

  async function removeWarehouseAssignment(assignment: WarehouseAssignment) {
    if (!window.confirm('Remove this operational access assignment?')) return
    setSavingId(assignment.profile_id)
    try {
      const { error } = await supabase.from('warehouse_user_assignments').delete().eq('id', assignment.id)
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
    <div className="p-5 max-w-5xl mx-auto">
      <PageHeader
        icon={<UserCog size={18} />}
        title="Users & Roles"
        subtitle="Assign what each person can access, and link their login to an employee record"
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <Card>
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`stagger-row ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}
              style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
            >
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.full_name ?? 'Unnamed'}</p>
                  {r.email && <p className="text-xs text-gray-400 truncate">{r.email}</p>}
                  {r.role === 'pending' && <Badge variant="warning">Waiting for a role</Badge>}
                  {resetDoneId === r.id && <Badge variant="success" icon={<Check size={11} />}>Password reset — let them know their new one.</Badge>}
                </div>
                <SelectMenu
                  value={r.employee_id ?? ''}
                  onChange={value => updateEmployee(r.id, value)}
                  disabled={savingId === r.id}
                  className="w-48"
                  size="sm"
                  searchable
                  ariaLabel={`Employee linked to ${r.full_name ?? 'user'}`}
                  options={[{ value: '', label: 'No linked employee' }, ...employees.map(employee => ({ value: employee.id, label: employee.full_name }))]}
                />
                <SelectMenu
                  value={r.role}
                  onChange={value => updateRole(r.id, value)}
                  disabled={savingId === r.id}
                  className="w-52"
                  size="sm"
                  ariaLabel={`ERP role for ${r.full_name ?? 'user'}`}
                  options={ROLES.map(role => ({ value: role.value, label: role.label }))}
                />
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

              <div className="mx-4 mb-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Factory size={13} className="text-gray-500" />
                  <p className="text-[11px] font-semibold text-gray-700">Warehouse Operations access</p>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {warehouseAssignments.filter(assignment => assignment.profile_id === r.id).map(assignment => (
                    <span key={assignment.id} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] text-gray-600">
                      {assignment.access_role.replaceAll('_', ' ')}
                      <b className="font-medium text-gray-900">
                        {assignment.operational_unit_id
                          ? `· ${operationalUnits.find(unit => unit.id === assignment.operational_unit_id)?.name ?? 'Warehouse'}`
                          : '· All warehouses'}
                      </b>
                      <button
                        type="button"
                        aria-label="Remove warehouse access"
                        disabled={savingId === r.id}
                        onClick={() => removeWarehouseAssignment(assignment)}
                        className="ml-0.5 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={10} />
                      </button>
                    </span>
                  ))}
                  {warehouseAssignments.every(assignment => assignment.profile_id !== r.id) && (
                    <span className="text-[10px] text-gray-400">No operational scope assigned.</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SelectMenu
                    value={assignmentDraft(r.id).access_role}
                    onChange={value => updateAssignmentDraft(r.id, { access_role: value as WarehouseAssignment['access_role'] })}
                    disabled={savingId === r.id}
                    className="w-56"
                    size="sm"
                    ariaLabel={`Warehouse access role for ${r.full_name ?? 'user'}`}
                    options={[
                      { value: 'warehouse_manager', label: 'Warehouse manager', description: 'Manage one assigned warehouse' },
                      { value: 'payroll_officer', label: 'Payroll officer', description: 'Prepare assigned warehouse payroll' },
                      { value: 'viewer', label: 'Viewer', description: 'Operational records only' },
                      { value: 'regional_manager', label: 'Regional manager', description: 'All warehouses and approvals' },
                    ]}
                  />
                  {assignmentDraft(r.id).access_role !== 'regional_manager' && (
                    <SelectMenu
                      value={assignmentDraft(r.id).operational_unit_id}
                      onChange={value => updateAssignmentDraft(r.id, { operational_unit_id: value })}
                      disabled={savingId === r.id}
                      className="w-56"
                      size="sm"
                      searchable
                      ariaLabel={`Warehouse scope for ${r.full_name ?? 'user'}`}
                      options={[{ value: '', label: 'Choose warehouse' }, ...operationalUnits.map(unit => ({ value: unit.id, label: unit.name }))]}
                    />
                  )}
                  <button
                    type="button"
                    disabled={savingId === r.id || (assignmentDraft(r.id).access_role !== 'regional_manager' && !assignmentDraft(r.id).operational_unit_id)}
                    onClick={() => addWarehouseAssignment(r.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-panel-dark px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50"
                  >
                    {savingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add scope
                  </button>
                </div>
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
        </Card>
      )}
    </div>
  )
}
