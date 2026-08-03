import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Check, ChevronDown, Eye, EyeOff, Factory, KeyRound, Loader2, Plus, Radio, Search, ShieldOff, UserCog, UserX, UsersRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { deleteUser, fetchAdminUsers, resetUserPassword, updateUserAuthority } from '../api/admin'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../lib/roles'
import type { Role } from '../lib/roles'
import { PageHeader } from '../components/ui/PageHeader'
import { SelectMenu } from '../components/ui/SelectMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import './Users.css'

interface UserRow {
  id: string; full_name: string | null; email: string | null; role: string; employee_id: string | null; employee_name: string | null
  created_at: string | null; last_sign_in_at: string | null
}
interface EmployeeOption { id: string; full_name: string }
interface OperationalUnitOption { id: string; name: string }
interface WarehouseAssignment { id: string; profile_id: string; operational_unit_id: string | null; access_role: 'regional_manager' | 'warehouse_manager' | 'payroll_officer' | 'viewer' }
interface AssignmentDraft { operational_unit_id: string; access_role: WarehouseAssignment['access_role'] }
interface ProfileQueryRow { id: string; full_name: string | null; role: string; employee_id: string | null; employees: { full_name: string } | Array<{ full_name: string }> | null }

const ROLES = [
  { value: 'pending', label: 'Pending', description: 'Login remains blocked' },
  ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label, description: ROLE_DESCRIPTIONS[value as Role] })),
]
const ROLE_MODULES: Record<Role, string[]> = {
  full_access: ['All ERP modules', 'All warehouses', 'Final approvals'], accounting_finance: ['Finance', 'Settlement', 'Payroll approval'],
  operations_marketing: ['Imports', 'Shipments', 'Suppliers', 'Logistics'], manufacturing_sales: ['Production', 'Inventory', 'Transfers', 'Sales'],
  hr_system: ['Main employees', 'HR', 'Payroll review', 'System access'], warehouse_operations: ['Assigned warehouses only'],
}
const initials = (name: string | null) => (name ?? 'User').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const isOnline = (lastSeen: string | null | undefined) => Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() < 120_000)
const ago = (value: string | null | undefined) => {
  if (!value) return 'Never signed in'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Active now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return new Date(value).toLocaleDateString()
}

export function Users() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [operationalUnits, setOperationalUnits] = useState<OperationalUnitOption[]>([])
  const [assignments, setAssignments] = useState<WarehouseAssignment[]>([])
  const [presence, setPresence] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'online' | 'pending' | 'warehouse'>('all')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [serviceWarning, setServiceWarning] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetShow, setResetShow] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  const canManage = profile?.role === 'full_access' || profile?.role === 'hr_system'

  const load = useCallback(async () => {
    setLoading(true); setPageError(null); setServiceWarning(null)
    try {
      const [profilesRes, employeesRes, unitsRes, assignmentsRes, presenceRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, employee_id, employees(full_name)').eq('is_active', true),
        supabase.from('employees').select('id, full_name').order('full_name'),
        supabase.from('operational_units').select('id, name').eq('is_active', true).order('name'),
        supabase.from('warehouse_user_assignments').select('id, profile_id, operational_unit_id, access_role').eq('is_active', true),
        supabase.from('user_presence').select('profile_id, last_seen_at'),
      ])
      if (profilesRes.error) throw profilesRes.error
      const metadata: Awaited<ReturnType<typeof fetchAdminUsers>> = await fetchAdminUsers().catch(error => {
        setServiceWarning(error instanceof Error ? error.message : 'Admin user service is unavailable.')
        return {} as Awaited<ReturnType<typeof fetchAdminUsers>>
      })
      const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] ?? null : value ?? null
      setRows(((profilesRes.data ?? []) as ProfileQueryRow[]).map(row => ({
        id: row.id, full_name: row.full_name, role: row.role, employee_id: row.employee_id, employee_name: one(row.employees)?.full_name ?? null,
        email: metadata[row.id]?.email ?? null, created_at: metadata[row.id]?.createdAt ?? null, last_sign_in_at: metadata[row.id]?.lastSignInAt ?? null,
      })))
      setEmployees((employeesRes.data ?? []) as EmployeeOption[])
      setOperationalUnits((unitsRes.data ?? []) as OperationalUnitOption[])
      setAssignments((assignmentsRes.data ?? []) as WarehouseAssignment[])
      setPresence(Object.fromEntries((presenceRes.data ?? []).map(item => [item.profile_id, item.last_seen_at])))
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Users could not be loaded.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!canManage) return
    const channel = supabase.channel('admin-user-presence').on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, payload => {
      const row = payload.new as { profile_id?: string; last_seen_at?: string }
      if (row.profile_id && row.last_seen_at) setPresence(current => ({ ...current, [row.profile_id!]: row.last_seen_at! }))
    }).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [canManage])

  const visibleRows = useMemo(() => rows.filter(row => {
    const matches = `${row.full_name ?? ''} ${row.email ?? ''} ${ROLE_LABELS[row.role as Role] ?? row.role}`.toLowerCase().includes(query.trim().toLowerCase())
    if (!matches) return false
    if (filter === 'online') return isOnline(presence[row.id])
    if (filter === 'pending') return row.role === 'pending'
    if (filter === 'warehouse') return row.role === 'warehouse_operations' || assignments.some(assignment => assignment.profile_id === row.id)
    return true
  }), [assignments, filter, presence, query, rows])
  const liveUsers = rows.filter(row => isOnline(presence[row.id]))

  async function changeAuthority(user: UserRow, patch: { role?: string; employeeId?: string | null }) {
    setSavingId(user.id); setPageError(null)
    try { await updateUserAuthority(user.id, patch.role ?? user.role, patch.employeeId === undefined ? user.employee_id : patch.employeeId); await load() }
    catch (error) { setPageError(error instanceof Error ? error.message : 'Access could not be updated.') }
    finally { setSavingId(null) }
  }
  function draftFor(userId: string): AssignmentDraft { return drafts[userId] ?? { operational_unit_id: operationalUnits[0]?.id ?? '', access_role: 'warehouse_manager' } }
  function updateDraft(userId: string, patch: Partial<AssignmentDraft>) { setDrafts(current => ({ ...current, [userId]: { ...draftFor(userId), ...patch } })) }
  async function addScope(user: UserRow) {
    const draft = draftFor(user.id)
    if (draft.access_role !== 'regional_manager' && !draft.operational_unit_id) return
    setSavingId(user.id); setPageError(null)
    try {
      if (user.role === 'pending') await updateUserAuthority(user.id, 'warehouse_operations', user.employee_id)
      const { error } = await supabase.from('warehouse_user_assignments').insert({ profile_id: user.id, operational_unit_id: draft.access_role === 'regional_manager' ? null : draft.operational_unit_id, access_role: draft.access_role, assigned_by: profile?.id ?? null })
      if (error) throw error
      await load()
    } catch (error) { setPageError(error instanceof Error ? error.message : 'Warehouse scope could not be added.') }
    finally { setSavingId(null) }
  }
  async function removeScope(assignment: WarehouseAssignment) {
    setSavingId(assignment.profile_id)
    const { error } = await supabase.from('warehouse_user_assignments').update({ is_active: false }).eq('id', assignment.id)
    if (error) setPageError(error.message); else await load()
    setSavingId(null)
  }
  async function submitReset(userId: string) {
    if (resetPassword.length < 6) { setResetError('Use at least 6 characters.'); return }
    setSavingId(userId); setResetError(null)
    try { await resetUserPassword(userId, resetPassword); setResetId(null); setResetPassword('') }
    catch (error) { setResetError(error instanceof Error ? error.message : 'Password could not be reset.') }
    finally { setSavingId(null) }
  }
  async function confirmDelete(user: UserRow) {
    setSavingId(user.id); setPageError(null)
    try { await deleteUser(user.id); await load() }
    catch (error) { setPageError(error instanceof Error ? error.message : 'User could not be deleted.') }
    finally { setSavingId(null) }
  }

  if (!canManage) return <div className="users-denied"><ShieldOff /><h2>Access restricted</h2><p>Only Full Access and HR & System can manage users.</p></div>

  return <main className="users-page">
    <PageHeader icon={<UserCog size={19} />} title="Users & access" subtitle="Assign one company role, add warehouse scope separately, and see who is currently active." />
    <section className="users-overview">
      <article><UsersRound /><span>Active accounts<strong>{rows.length}</strong><small>{rows.filter(row => row.role === 'pending').length} awaiting access</small></span></article>
      <article><Factory /><span>Warehouse scoped<strong>{rows.filter(row => row.role === 'warehouse_operations').length}</strong><small>{assignments.length} active assignments</small></span></article>
      <article className="live"><Radio /><span>Live now<strong>{liveUsers.length}</strong><small>Seen within 2 minutes</small></span><div className="live-avatars">{liveUsers.slice(0, 6).map(user => <i key={user.id} title={user.full_name ?? 'User'}>{initials(user.full_name)}</i>)}</div></article>
    </section>
    {serviceWarning && <div className="users-warning"><Building2 /><span><strong>Admin service needs deployment</strong>{serviceWarning}</span></div>}
    {pageError && <div className="users-error" role="alert">{pageError}</div>}
    <section className="users-directory">
      <div className="users-toolbar"><label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, email or role" /></label><div>{(['all','online','pending','warehouse'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div></div>
      {loading ? <div className="users-loading"><Loader2 className="animate-spin" /> Loading accounts…</div> : <div className="user-cards">{visibleRows.map(user => {
        const userAssignments = assignments.filter(assignment => assignment.profile_id === user.id)
        const online = isOnline(presence[user.id])
        return <article key={user.id} className="user-access-card">
          <header><div className="user-avatar">{initials(user.full_name)}<i className={online ? 'online' : ''} /></div><div className="user-identity"><h2>{user.full_name ?? 'Unnamed user'}</h2><p>{user.email ?? 'Email available after admin function deployment'}</p><span className={online ? 'online' : ''}>{online ? 'Live now' : `Last sign-in ${ago(user.last_sign_in_at)}`}</span></div><div className="user-main-controls"><SelectMenu value={user.role} onChange={role => void changeAuthority(user, { role })} disabled={savingId === user.id || user.id === profile?.id} ariaLabel={`Role for ${user.full_name ?? 'user'}`} options={ROLES} /><SelectMenu value={user.employee_id ?? ''} onChange={employeeId => void changeAuthority(user, { employeeId: employeeId || null })} disabled={savingId === user.id} searchable ariaLabel={`Employee linked to ${user.full_name ?? 'user'}`} options={[{ value: '', label: 'No employee link' }, ...employees.map(employee => ({ value: employee.id, label: employee.full_name }))]} /></div><div className="user-actions"><button onClick={() => { setResetId(resetId === user.id ? null : user.id); setResetPassword(''); setResetError(null) }} aria-label="Reset password"><KeyRound /></button><button className="danger" disabled={user.id === profile?.id || savingId === user.id} onClick={() => setDeleteTarget(user)} aria-label="Delete user"><UserX /></button></div></header>
          <div className="effective-access"><p>{user.role === 'pending' ? 'No ERP access until a role or warehouse scope is assigned.' : ROLE_DESCRIPTIONS[user.role as Role] ?? 'Custom access'}</p>{user.role !== 'pending' && (ROLE_MODULES[user.role as Role] ?? []).map(module => <span key={module}>{module}</span>)}</div>
          <details><summary><span><Factory />Warehouse responsibilities <b>{userAssignments.length}</b></span><ChevronDown /></summary><div className="scope-workspace"><div className="scope-list">{userAssignments.map(assignment => <span key={assignment.id}>{assignment.access_role.replaceAll('_',' ')} <b>· {assignment.operational_unit_id ? operationalUnits.find(unit => unit.id === assignment.operational_unit_id)?.name ?? 'Warehouse' : 'All warehouses'}</b><button onClick={() => void removeScope(assignment)} aria-label="Remove warehouse scope"><X /></button></span>)}{!userAssignments.length && <p>No warehouse responsibility assigned.</p>}</div><div className="scope-form"><SelectMenu value={draftFor(user.id).access_role} onChange={value => updateDraft(user.id, { access_role: value as WarehouseAssignment['access_role'] })} options={[{ value:'warehouse_manager',label:'Warehouse manager',description:'Manage one warehouse'},{value:'payroll_officer',label:'Payroll officer',description:'Prepare warehouse payroll'},{value:'viewer',label:'Viewer',description:'Read operational records'},{value:'regional_manager',label:'Regional manager',description:'All warehouses and approvals'}]} />{draftFor(user.id).access_role !== 'regional_manager' && <SelectMenu value={draftFor(user.id).operational_unit_id} onChange={value => updateDraft(user.id,{operational_unit_id:value})} searchable options={[{value:'',label:'Choose warehouse'},...operationalUnits.map(unit=>({value:unit.id,label:unit.name}))]} />}<button disabled={savingId === user.id || (draftFor(user.id).access_role !== 'regional_manager' && !draftFor(user.id).operational_unit_id)} onClick={() => void addScope(user)}><Plus />Add responsibility</button></div></div></details>
          {resetId === user.id && <div className="password-reset"><label><input autoFocus type={resetShow ? 'text' : 'password'} value={resetPassword} onChange={event => setResetPassword(event.target.value)} onKeyDown={event => event.key === 'Enter' && void submitReset(user.id)} placeholder="New password" /><button onClick={() => setResetShow(value => !value)}>{resetShow ? <EyeOff /> : <Eye />}</button></label><button onClick={() => void submitReset(user.id)} disabled={savingId === user.id}>{savingId === user.id ? <Loader2 className="animate-spin" /> : <Check />}Set password</button><button onClick={() => setResetId(null)}><X /></button>{resetError && <p>{resetError}</p>}</div>}
        </article>
      })}{!visibleRows.length && <div className="users-empty">No users match this view.</div>}</div>}
    </section>
    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this user login?" message={`${deleteTarget?.full_name ?? 'This user'} will lose access immediately. Their historical approvals and audit records will remain.`} danger onClose={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) void confirmDelete(deleteTarget) }} />
  </main>
}
