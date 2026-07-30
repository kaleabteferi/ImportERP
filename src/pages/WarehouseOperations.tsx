import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeDollarSign,
  Boxes, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2, ChevronRight,
  CircleDollarSign, ClipboardCheck, Clock3, Factory, Gauge, Layers3, Loader2, Package, Plus,
  FileDown, Landmark, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, UserCheck, Users, WalletCards, X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { SelectMenu } from '../components/ui/SelectMenu'
import { createDamageReport } from '../api/damageReports'
import { fetchProductionDailyReport, logUnmanagedProduction } from '../api/production'
import type { ProductionDailyReportData } from '../api/production'
import {
  approveProductionBatch,
  computeMaxProducible,
  createProductionBatch,
  createWarehouseProductionOrder,
  createWorkforceGroup,
  decideOvertime,
  fetchWarehouseOperations,
  prepareWarehousePayroll,
  refreshOperationalAlerts,
  resolveOperationalAlert,
  saveAttendance,
  saveAttendanceBatch,
  submitOvertime,
  transitionProductionBatch,
  transitionWarehousePayroll,
  validateWarehousePayroll,
} from '../api/warehouseOperations'
import type {
  AttendanceStatus,
  OperationalEmployee,
  OperationalProductionOrder,
  OperationalUnit,
  PayrollValidationResult,
  ProductionBatch,
  UnitAccessRole,
  UnitDailyRollup,
  WarehouseOperationsData,
  WarehousePayrollRun,
  WorkforceGroup,
} from '../api/warehouseOperations'

type Tab = 'overview' | 'production' | 'workforce' | 'attendance' | 'overtime' | 'efficiency' | 'payroll' | 'dailyReport' | 'alerts'
type ModalName = 'batch' | 'batchDetail' | 'productionOrder' | 'group' | 'attendance' | 'overtime' | 'payroll' | 'logProduction' | 'logDamage' | null

const today = () => new Date().toISOString().slice(0, 10)
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const money = new Intl.NumberFormat('en-ET', { style: 'currency', currency: 'ETB', maximumFractionDigits: 0 })
const formatNumber = (value: number) => nf.format(Math.round(value))
const formatHours = (value: number) => `${oneDecimal.format(value)} h`
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())

function csvCell(value: string | number) {
  const text = String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadPayrollReport(
  run: WarehousePayrollRun,
  items: WarehouseOperationsData['payrollEmployees'],
  employeeById: Map<string, OperationalEmployee>,
  unitName: string,
) {
  const headers = ['Employee', 'Days worked', 'Regular pay ETB', 'Overtime hours', 'Overtime pay ETB', 'Production incentive ETB', 'Gross pay ETB', 'Tax ETB', 'Employee pension ETB', 'Other deductions ETB', 'Net pay ETB']
  const lines = [
    ['Warehouse', unitName],
    ['Payroll run', run.run_number],
    ['Period', `${run.period_start} to ${run.period_end}`],
    ['Status', titleCase(run.status)],
    [],
    headers,
    ...items.filter(item => item.payroll_run_id === run.id).map(item => [
      employeeById.get(item.employee_id)?.full_name ?? 'Employee',
      item.days_worked,
      item.regular_pay,
      item.overtime_hours,
      item.overtime_pay,
      item.production_incentive,
      item.gross_pay,
      item.tax,
      item.pension_employee,
      item.other_deductions,
      item.net_pay,
    ]),
    [],
    ['TOTAL', '', run.gross_amount - run.overtime_amount - run.incentive_amount, '', run.overtime_amount, run.incentive_amount, run.gross_amount, run.tax_amount, run.pension_amount, run.deduction_amount, run.net_amount],
  ]
  const csv = lines.map(line => line.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${unitName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${run.run_number}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'production', label: 'Production control' },
  { key: 'workforce', label: 'Workforce' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'dailyReport', label: 'Daily Report' },
  { key: 'alerts', label: 'Alerts' },
]

const EMPTY_DATA: WarehouseOperationsData = {
  units: [], companies: [], assignments: [], employees: [], groups: [], groupMembers: [], shifts: [],
  taskTypes: [], batches: [], batchWorkers: [], attendance: [], overtimeTypes: [],
  overtime: [], employeeEfficiency: [], rollups: [], alerts: [], payrollRuns: [],
  payrollEmployees: [], accountingBatches: [], productionOrders: [], boms: [], products: [],
  bomLines: [], inventory: [],
}

function offsetDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function sum<T>(rows: T[], get: (row: T) => number) {
  return rows.reduce((total, row) => total + (Number(get(row)) || 0), 0)
}

function statusTone(status: string) {
  if (['approved', 'posted', 'paid', 'completed', 'hr_approved', 'finance_approved'].includes(status)) return 'success'
  if (['submitted', 'active', 'calculated', 'partial'].includes(status)) return 'info'
  if (['rejected', 'cancelled', 'absent', 'critical', 'failed'].includes(status)) return 'danger'
  if (['pending', 'draft', 'leave', 'sick', 'high'].includes(status)) return 'warning'
  return 'neutral'
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase()
  return <span className={`warehouse-ops-status is-${statusTone(normalized)}`}><i />{titleCase(normalized)}</span>
}

function Section({
  title, eyebrow, action, children, className = '',
}: {
  title: string
  eyebrow?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`warehouse-ops-panel ${className}`}>
      <div className="warehouse-ops-panel__head">
        <div>
          {eyebrow && <span>{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ icon: Icon = Boxes, title, copy }: { icon?: typeof Boxes; title: string; copy: string }) {
  return (
    <div className="warehouse-ops-empty">
      <div><Icon size={18} /></div>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  )
}

function Modal({
  title, eyebrow, children, onClose, wide = false,
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="warehouse-ops-modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className={`warehouse-ops-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><span>{eyebrow}</span><h2>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {children}
      </div>
    </div>
  )
}

function TrendChart({ rollups, date }: { rollups: UnitDailyRollup[]; date: string }) {
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(date, index - 6))
  const points = days.map(day => {
    const rows = rollups.filter(row => row.log_date === day)
    const hours = sum(rows, row => row.regular_hours + row.overtime_hours)
    const efficiency = hours
      ? sum(rows, row => row.avg_efficiency_pct * (row.regular_hours + row.overtime_hours)) / hours
      : 0
    return { day, value: efficiency }
  })
  const hasData = points.some(point => point.value > 0)
  if (!hasData) return <EmptyState icon={TrendingUp} title="No efficiency trend yet" copy="Approve production batches to calculate daily performance." />
  const x = (index: number) => 24 + index * (552 / 6)
  const y = (value: number) => 162 - Math.max(0, Math.min(120, value)) / 120 * 130
  const polyline = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  return (
    <div className="warehouse-ops-trend">
      <svg viewBox="0 0 600 205" role="img" aria-label="Seven day warehouse efficiency trend">
        {[60, 80, 100, 120].map(value => (
          <g key={value}>
            <line x1="24" x2="576" y1={y(value)} y2={y(value)} />
            <text x="2" y={y(value) + 4}>{value}%</text>
          </g>
        ))}
        <defs>
          <linearGradient id="warehouseTrendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--wo-accent)" stopOpacity=".28" />
            <stop offset="100%" stopColor="var(--wo-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`24,172 ${polyline} 576,172`} fill="url(#warehouseTrendFill)" />
        <polyline points={polyline} className="warehouse-ops-trend__line" />
        {points.map((point, index) => (
          <g key={point.day}>
            <circle cx={x(index)} cy={y(point.value)} r="4" />
            <text x={x(index)} y="194" textAnchor="middle">{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${point.day}T12:00:00`))}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function BatchForm({
  unit, data, date, saving, initialProductionOrderId = '', onSave,
}: {
  unit: OperationalUnit
  data: WarehouseOperationsData
  date: string
  saving: boolean
  initialProductionOrderId?: string
  onSave: (input: Parameters<typeof createProductionBatch>[0]) => Promise<void>
}) {
  const employees = data.employees.filter(employee => employee.operational_unit_id === unit.id)
  const groups = data.groups.filter(group => group.operational_unit_id === unit.id)
  const shifts = data.shifts.filter(shift => shift.operational_unit_id === unit.id)
  const tasks = data.taskTypes.filter(task => task.operational_unit_id === null || task.operational_unit_id === unit.id)
  const productionOrders = data.productionOrders.filter(order =>
    order.warehouse_id === unit.warehouse_id && ['DRAFT', 'IN_PROGRESS'].includes(order.status),
  )
  const initialOrder = productionOrders.find(order => order.id === initialProductionOrderId) ?? null
  const initialBom = initialOrder ? data.boms.find(bom => bom.id === initialOrder.bom_header_id) ?? null : null
  const initialTask = tasks.find(task => task.code === (initialBom?.stage ?? ''))
  const [taskTypeId, setTaskTypeId] = useState(initialTask?.id ?? tasks[0]?.id ?? '')
  const [productionOrderId, setProductionOrderId] = useState(initialOrder?.id ?? '')
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '')
  const [supervisorId, setSupervisorId] = useState('')
  const [productionDate, setProductionDate] = useState(date)
  const [target, setTarget] = useState(initialOrder
    ? String(Math.max(0, initialOrder.target_quantity - initialOrder.completed_quantity) || initialOrder.target_quantity)
    : '')
  const [actual, setActual] = useState('')
  const [rejected, setRejected] = useState('0')
  const [regularHours, setRegularHours] = useState('8')
  const [overtimeHours, setOvertimeHours] = useState('0')
  const [allocation, setAllocation] = useState<ProductionBatch['allocation_method']>('hours_weighted')
  const [notes, setNotes] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [excludedEmployees, setExcludedEmployees] = useState<Set<string>>(new Set())
  const linkedOrder = data.productionOrders.find(order => order.id === productionOrderId) ?? null
  const linkedBom = linkedOrder ? data.boms.find(bom => bom.id === linkedOrder.bom_header_id) ?? null : null
  const linkedProduct = linkedOrder ? data.products.find(product => product.id === linkedOrder.product_id) ?? null : null

  function selectProductionOrder(value: string) {
    setProductionOrderId(value)
    if (!value) return
    const order = productionOrders.find(item => item.id === value)
    if (!order) return
    const bom = data.boms.find(item => item.id === order.bom_header_id)
    const remaining = Math.max(0, order.target_quantity - order.completed_quantity)
    setTarget(String(remaining || order.target_quantity))
    const stageTask = tasks.find(task => task.code === (bom?.stage ?? 'ASSEMBLY'))
    if (stageTask) setTaskTypeId(stageTask.id)
  }

  const employeeIdsFromGroups = useMemo(() => new Set(
    data.groupMembers
      .filter(member => selectedGroups.has(member.workforce_group_id))
      .map(member => member.employee_id),
  ), [data.groupMembers, selectedGroups])
  const finalEmployeeIds = useMemo(
    () => new Set([...selectedEmployees, ...employeeIdsFromGroups].filter(employeeId => !excludedEmployees.has(employeeId))),
    [selectedEmployees, employeeIdsFromGroups, excludedEmployees],
  )
  const presentEmployeeIds = useMemo(() => new Set(
    data.attendance
      .filter(row => row.operational_unit_id === unit.id && row.attendance_date === productionDate && ['present', 'partial'].includes(row.attendance_status))
      .map(row => row.employee_id),
  ), [data.attendance, productionDate, unit.id])

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
      const status = submitter?.value === 'draft' ? 'draft' : 'submitted'
      const workers = [...finalEmployeeIds].map(employeeId => ({
        employeeId,
        sourceGroupId: [...selectedGroups].find(groupId => data.groupMembers.some(member => member.workforce_group_id === groupId && member.employee_id === employeeId)) ?? null,
        regularHours: Number(regularHours),
        overtimeHours: Number(overtimeHours),
      }))
      void onSave({
        operationalUnitId: unit.id,
        warehouseId: unit.warehouse_id,
        productionOrderId: linkedOrder?.id ?? null,
        bomHeaderId: linkedOrder?.bom_header_id ?? null,
        productId: linkedOrder?.product_id ?? null,
        taskTypeId,
        shiftId: shiftId || null,
        productionDate,
        targetUnits: Number(target),
        actualUnits: Number(actual),
        rejectedUnits: Number(rejected),
        allocationMethod: allocation,
        status,
        supervisorEmployeeId: supervisorId || null,
        notes,
        workers,
      })
    }}>
      <div className="warehouse-ops-production-bridge">
        <div className="warehouse-ops-production-bridge__icon"><Factory size={18} /></div>
        <div>
          <span>Production planning handoff</span>
          <strong>{linkedOrder ? `${linkedOrder.order_number} · ${linkedProduct?.name ?? 'Production item'}` : 'Operational-only batch'}</strong>
          <p>{linkedOrder
            ? `${linkedBom?.name ?? 'Linked BOM'} · ${formatNumber(Math.max(0, linkedOrder.target_quantity - linkedOrder.completed_quantity))} units remaining. Approved accepted output posts to inventory automatically.`
            : 'Tracks workers, hours, efficiency and payroll without moving product inventory.'}</p>
        </div>
        <SelectMenu
          className="warehouse-ops-production-bridge__select"
          ariaLabel="Linked production order"
          searchable
          value={productionOrderId}
          onChange={selectProductionOrder}
          options={[
            { value: '', label: 'Operational-only batch', description: 'No inventory posting' },
            ...productionOrders.map(order => {
              const product = data.products.find(item => item.id === order.product_id)
              const existingBatch = data.batches.find(batch =>
                batch.production_order_id === order.id && !['approved', 'cancelled'].includes(batch.status),
              )
              return {
                value: order.id,
                label: `${order.order_number} · ${product?.name ?? 'Production item'}`,
                description: existingBatch
                  ? `Already assigned to ${existingBatch.batch_number}`
                  : `${formatNumber(Math.max(0, order.target_quantity - order.completed_quantity))} remaining${order.due_date ? ` · due ${formatDate(order.due_date)}` : ''}`,
                disabled: Boolean(existingBatch && order.id !== initialProductionOrderId),
              }
            }),
          ]}
        />
      </div>
      <div className="warehouse-ops-form__grid">
        <label>Task type<SelectMenu ariaLabel="Task type" searchable value={taskTypeId} onChange={setTaskTypeId} options={tasks.map(task => ({ value: task.id, label: task.name, description: task.standard_units_per_hour ? `${task.standard_units_per_hour} units/hour` : 'Target-based task' }))} /></label>
        <label>Shift<SelectMenu ariaLabel="Production shift" value={shiftId} onChange={setShiftId} options={[{ value: '', label: 'No shift', description: 'Unscheduled batch' }, ...shifts.map(shift => ({ value: shift.id, label: shift.name, description: `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` }))]} /></label>
        <label>Production date<input required type="date" value={productionDate} onChange={event => setProductionDate(event.target.value)} /></label>
        <label>Supervisor<SelectMenu ariaLabel="Batch supervisor" searchable value={supervisorId} onChange={setSupervisorId} options={[{ value: '', label: 'No named supervisor', description: 'Warehouse manager retains oversight' }, ...employees.map(employee => ({ value: employee.id, label: employee.full_name, description: employee.title ?? titleCase(employee.employment_type) }))]} /></label>
        <label>Allocation<SelectMenu ariaLabel="Output allocation method" value={allocation} onChange={value => setAllocation(value as ProductionBatch['allocation_method'])} options={[
          { value: 'hours_weighted', label: 'Hours weighted', description: 'Proportional to hours worked' },
          { value: 'equal', label: 'Equal allocation', description: 'Same units per present worker' },
          { value: 'role_weighted', label: 'Role weighted', description: 'Uses worker allocation weights' },
          { value: 'manual', label: 'Manual allocation', description: 'Preserve entered unit attribution' },
        ]} /></label>
        <label>Target units<input required min="1" step="0.001" type="number" value={target} onChange={event => setTarget(event.target.value)} /></label>
        <label>Actual units<input min="0" step="0.001" type="number" value={actual} onChange={event => setActual(event.target.value)} placeholder="Enter when completed" /></label>
        <label>Rejected units<input required min="0" max={actual || undefined} step="0.001" type="number" value={rejected} onChange={event => setRejected(event.target.value)} /></label>
        <label>Regular hours / worker<input required min="0" max="24" step=".25" type="number" value={regularHours} onChange={event => setRegularHours(event.target.value)} /></label>
        <label>Overtime hours / worker<input required min="0" max="16" step=".25" type="number" value={overtimeHours} onChange={event => setOvertimeHours(event.target.value)} /></label>
      </div>
      <div className="warehouse-ops-form__selection">
        <div className="warehouse-ops-form__selection-head"><strong>Select groups</strong><span>Group members expand into individual worker records.</span></div>
        <div className="warehouse-ops-check-grid">
          {groups.length ? groups.map(group => (
            <label key={group.id} className="warehouse-ops-check">
              <input type="checkbox" checked={selectedGroups.has(group.id)} onChange={() => toggle(setSelectedGroups, group.id)} />
              <span><strong>{group.name}</strong><small>{data.groupMembers.filter(member => member.workforce_group_id === group.id).length} members</small></span>
            </label>
          )) : <p className="warehouse-ops-form__hint">No groups yet. You can select workers directly.</p>}
        </div>
      </div>
      <div className="warehouse-ops-form__selection">
        <div className="warehouse-ops-form__selection-head"><strong>Workers · {finalEmployeeIds.size} selected</strong><span>Imported group members can be removed individually.</span></div>
        <div className="warehouse-ops-picker-tools">
          <button type="button" disabled={presentEmployeeIds.size === 0} onClick={() => {
            setSelectedEmployees(current => new Set([...current, ...presentEmployeeIds]))
            setExcludedEmployees(current => {
              const next = new Set(current)
              presentEmployeeIds.forEach(employeeId => next.delete(employeeId))
              return next
            })
          }}><UserCheck size={13} /> Select all present <b>{presentEmployeeIds.size}</b></button>
          <button type="button" onClick={() => {
            setSelectedGroups(new Set())
            setSelectedEmployees(new Set())
            setExcludedEmployees(new Set())
          }}><X size={13} /> Clear selection</button>
        </div>
        <div className="warehouse-ops-employee-picker">
          {employees.map(employee => {
            const inherited = employeeIdsFromGroups.has(employee.id)
            return (
              <label key={employee.id} className="warehouse-ops-check">
                <input type="checkbox" checked={finalEmployeeIds.has(employee.id)} onChange={() => {
                  if (inherited) {
                    setExcludedEmployees(current => {
                      const next = new Set(current)
                      if (next.has(employee.id)) next.delete(employee.id)
                      else next.add(employee.id)
                      return next
                    })
                  } else {
                    toggle(setSelectedEmployees, employee.id)
                  }
                }} />
                <span><strong>{employee.full_name}</strong><small>{employee.title ?? employee.employment_type}{inherited ? ' · imported from group' : presentEmployeeIds.has(employee.id) ? ' · attendance recorded' : ''}</small></span>
              </label>
            )
          })}
        </div>
      </div>
      <label>Batch notes<textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional production notes" /></label>
      <div className="warehouse-ops-form__footer">
        <span>{finalEmployeeIds.size} worker records will be created.</span>
        <div className="warehouse-ops-form__actions">
          <button type="submit" name="intent" value="draft" className="warehouse-ops-secondary" disabled={saving || !taskTypeId || !target || finalEmployeeIds.size === 0}>
            Save draft
          </button>
          <button type="submit" name="intent" value="submitted" className="warehouse-ops-primary" disabled={saving || !taskTypeId || !target || actual === '' || finalEmployeeIds.size === 0}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Submit & post to inventory
          </button>
        </div>
      </div>
    </form>
  )
}

function ProductionOrderForm({
  unit, data, date, saving, onSave,
}: {
  unit: OperationalUnit
  data: WarehouseOperationsData
  date: string
  saving: boolean
  onSave: (input: Parameters<typeof createWarehouseProductionOrder>[0]) => Promise<void>
}) {
  const activeBoms = data.boms.filter(bom => bom.is_active)
  const availableCompanies = unit.company_id
    ? data.companies.filter(company => company.id === unit.company_id)
    : data.companies
  const [bomHeaderId, setBomHeaderId] = useState(activeBoms[0]?.id ?? '')
  const [companyId, setCompanyId] = useState(
    unit.company_id
      ?? availableCompanies.find(company => company.is_primary)?.id
      ?? availableCompanies[0]?.id
      ?? '',
  )
  const [targetQuantity, setTargetQuantity] = useState('')
  const [plannedStartDate, setPlannedStartDate] = useState(date)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const selectedBom = activeBoms.find(bom => bom.id === bomHeaderId) ?? null
  const selectedProduct = selectedBom
    ? data.products.find(product => product.id === (selectedBom.finished_product_id ?? selectedBom.product_id)) ?? null
    : null

  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({
        operationalUnitId: unit.id,
        companyId,
        bomHeaderId,
        targetQuantity: Number(targetQuantity),
        plannedStartDate,
        dueDate: dueDate || null,
        notes,
      })
    }}>
      <div className="warehouse-ops-production-bridge">
        <div className="warehouse-ops-production-bridge__icon"><Layers3 size={18} /></div>
        <div>
          <span>Planning source of truth</span>
          <strong>{selectedProduct?.name ?? 'Choose the finished-product BOM'}</strong>
          <p>The order sets demand and schedule. An assigned warehouse manager sends it to a floor batch; only approved accepted output posts inventory.</p>
        </div>
        <StatusPill value="draft" />
      </div>
      <div className="warehouse-ops-form__grid">
        <label className="warehouse-ops-form__span-two">
          Company / accounting entity
          <SelectMenu
            ariaLabel="Production order company"
            searchable
            value={companyId}
            onChange={setCompanyId}
            disabled={Boolean(unit.company_id)}
            options={availableCompanies.length
              ? availableCompanies.map(company => ({
                value: company.id,
                label: company.name,
                description: company.is_primary ? 'Primary company' : 'Production accounting scope',
              }))
              : [{
                value: '',
                label: 'No authorized company',
                description: 'Ask an administrator to assign company access',
                disabled: true,
              }]}
          />
        </label>
        <label className="warehouse-ops-form__span-two">
          Bill of materials
          <SelectMenu
            ariaLabel="Production order BOM"
            searchable
            value={bomHeaderId}
            onChange={setBomHeaderId}
            options={activeBoms.map(bom => {
              const product = data.products.find(item => item.id === (bom.finished_product_id ?? bom.product_id))
              return {
                value: bom.id,
                label: product?.name ?? bom.name,
                description: `${bom.name} · ${titleCase(bom.stage)}`,
              }
            })}
          />
        </label>
        <label>
          Target quantity
          <input required min="0.001" step="0.001" type="number" value={targetQuantity} onChange={event => setTargetQuantity(event.target.value)} placeholder="0" />
        </label>
        <label>
          Planned start
          <input required type="date" value={plannedStartDate} onChange={event => {
            setPlannedStartDate(event.target.value)
            if (dueDate && dueDate < event.target.value) setDueDate('')
          }} />
        </label>
        <label>
          Due date
          <input type="date" min={plannedStartDate} value={dueDate} onChange={event => setDueDate(event.target.value)} />
        </label>
      </div>
      <label>Planning notes<textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Priority, customer commitment, material or quality notes" /></label>
      <div className="warehouse-ops-form__footer">
        <span>{availableCompanies.find(company => company.id === companyId)?.name ?? 'Company required'} · {unit.name} · the order remains a draft until floor execution starts.</span>
        <button className="warehouse-ops-primary" type="submit" disabled={saving || !companyId || !bomHeaderId || !targetQuantity || Number(targetQuantity) <= 0}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Create production order
        </button>
      </div>
    </form>
  )
}

function ProductionControl({
  data,
  units,
  selectedUnit,
  query,
  focusedOrderId,
  canPlan,
  canManageUnit,
  onFocusOrder,
  onCreateOrder,
  onCreateBatch,
  onOpenBatch,
  onLogProduction,
  onLogDamage,
}: {
  data: WarehouseOperationsData
  units: OperationalUnit[]
  selectedUnit: OperationalUnit | null
  query: string
  focusedOrderId: string
  canPlan: boolean
  canManageUnit: (unitId: string) => boolean
  onFocusOrder: (orderId: string) => void
  onCreateOrder: () => void
  onCreateBatch: (order: OperationalProductionOrder, unit: OperationalUnit) => void
  onOpenBatch: (batchId: string) => void
  onLogProduction: () => void
  onLogDamage: () => void
}) {
  const canManageSelected = Boolean(selectedUnit && canManageUnit(selectedUnit.id))
  const warehouseIds = new Set(units.map(unit => unit.warehouse_id).filter(Boolean))
  const normalizedQuery = query.trim().toLowerCase()
  const scopedOrders = data.productionOrders.filter(order => warehouseIds.has(order.warehouse_id))
  const filteredOrders = scopedOrders.filter(order => {
    const product = data.products.find(item => item.id === order.product_id)
    const bom = data.boms.find(item => item.id === order.bom_header_id)
    const company = data.companies.find(item => item.id === order.company_id)
    return !normalizedQuery
      || order.order_number.toLowerCase().includes(normalizedQuery)
      || (product?.name ?? '').toLowerCase().includes(normalizedQuery)
      || (bom?.name ?? '').toLowerCase().includes(normalizedQuery)
      || (company?.name ?? '').toLowerCase().includes(normalizedQuery)
  })
  const openOrders = filteredOrders.filter(order => ['DRAFT', 'IN_PROGRESS'].includes(order.status))
  const activeOrder = filteredOrders.find(order => order.id === focusedOrderId)
    ?? openOrders[0]
    ?? filteredOrders[0]
    ?? null
  const unitForOrder = (order: OperationalProductionOrder) =>
    units.find(unit => unit.warehouse_id === order.warehouse_id)
    ?? data.units.find(unit => unit.warehouse_id === order.warehouse_id)
    ?? null
  const batchesForOrder = (orderId: string) => data.batches
    .filter(batch => batch.production_order_id === orderId)
    .sort((left, right) => (
      right.production_date.localeCompare(left.production_date)
      || right.created_at.localeCompare(left.created_at)
    ))
  const openBatchForOrder = (orderId: string) => batchesForOrder(orderId)
    .find(batch => !['approved', 'cancelled'].includes(batch.status)) ?? null
  const latestBatchForOrder = (orderId: string) =>
    openBatchForOrder(orderId) ?? batchesForOrder(orderId)[0] ?? null
  const activeBatch = activeOrder ? latestBatchForOrder(activeOrder.id) : null
  const activeBom = activeOrder ? data.boms.find(bom => bom.id === activeOrder.bom_header_id) ?? null : null
  const activeProduct = activeOrder ? data.products.find(product => product.id === activeOrder.product_id) ?? null : null
  const activeWorkers = activeBatch
    ? data.batchWorkers.filter(worker => worker.production_batch_id === activeBatch.id).length
    : 0
  const todayValue = today()
  const weekOut = offsetDate(todayValue, 7)
  const remainingUnits = sum(openOrders, order => Math.max(0, order.target_quantity - order.completed_quantity))
  const overdueOrders = openOrders.filter(order => order.due_date && order.due_date < todayValue).length
  const dueSoonOrders = openOrders.filter(order => order.due_date && order.due_date >= todayValue && order.due_date <= weekOut).length
  const waitingFloor = openOrders.filter(order => !openBatchForOrder(order.id)).length
  const awaitingApproval = data.batches.filter(batch =>
    units.some(unit => unit.id === batch.operational_unit_id)
    && batch.production_order_id !== null
    && ['completed', 'submitted'].includes(batch.status),
  ).length
  const handoff = [
    { label: 'Production order', detail: activeOrder?.order_number ?? 'Select a plan', complete: Boolean(activeOrder), current: false },
    { label: 'BOM linked', detail: activeBom ? titleCase(activeBom.stage) : 'Material recipe', complete: Boolean(activeBom), current: Boolean(activeOrder && !activeBom) },
    { label: 'Floor batch', detail: activeBatch?.batch_number ?? 'Manager assignment', complete: Boolean(activeBatch), current: Boolean(activeOrder && !activeBatch) },
    {
      label: 'Approval',
      detail: activeBatch ? titleCase(activeBatch.status) : 'Independent review',
      complete: activeBatch?.status === 'approved',
      current: Boolean(activeBatch && ['completed', 'submitted'].includes(activeBatch.status)),
    },
    {
      label: 'Inventory posted',
      detail: activeBatch ? titleCase(activeBatch.inventory_posting_status) : 'Accepted output only',
      complete: activeBatch?.inventory_posting_status === 'posted',
      current: activeBatch?.status === 'approved' && activeBatch.inventory_posting_status !== 'posted',
    },
    {
      label: 'Labor captured',
      detail: activeWorkers ? `${activeWorkers} worker record${activeWorkers === 1 ? '' : 's'}` : 'Payroll-ready hours',
      complete: activeWorkers > 0,
      current: Boolean(activeBatch && activeWorkers === 0),
    },
  ]

  return (
    <>
      <div className="warehouse-ops-production-metrics" aria-label="Production planning summary">
        <article><span>Open production plans</span><strong>{formatNumber(openOrders.length)}</strong><small>{formatNumber(remainingUnits)} units remaining</small></article>
        <article className={overdueOrders ? 'is-alert' : ''}><span>Schedule pressure</span><strong>{overdueOrders}</strong><small>{dueSoonOrders} due in the next 7 days</small></article>
        <article><span>Waiting for floor batch</span><strong>{waitingFloor}</strong><small>Warehouse manager handoff</small></article>
        <article className={awaitingApproval ? 'is-accent' : ''}><span>Awaiting approval</span><strong>{awaitingApproval}</strong><small>Inventory has not posted yet</small></article>
      </div>

      <Section
        title="Order-to-floor handoff"
        eyebrow={activeOrder ? `${activeProduct?.name ?? 'Production item'} · ${activeOrder.order_number}` : 'Production planning → inventory → payroll'}
        action={(canManageSelected || (selectedUnit && canPlan)) ? <div className="warehouse-ops-section-actions">
          {canManageSelected && <button className="warehouse-ops-secondary" onClick={onLogDamage}><ShieldAlert size={15} /> Log damage</button>}
          {canManageSelected && <button className="warehouse-ops-secondary" onClick={onLogProduction} title="Quick entry: no workers or hours, updates inventory only"><Plus size={15} /> Log production</button>}
          {selectedUnit && canPlan && <button className="warehouse-ops-primary" onClick={onCreateOrder} title="Plan only: sets a BOM, target quantity and due date — no floor work yet"><Plus size={15} /> New production order</button>}
        </div> : undefined}
      >
        {canManageSelected && <p className="warehouse-ops-panel-note">Registering output? <strong>Log production</strong> is the fast path (just the quantity). Use a <strong>floor batch</strong> below only when you also need to track workers, hours and payroll for this run.</p>}
        {activeOrder ? (
          <div className="warehouse-ops-handoff">
            <div className="warehouse-ops-handoff__context">
              <div>
                <span>Plan progress</span>
                <strong>{formatNumber(activeOrder.completed_quantity)} / {formatNumber(activeOrder.target_quantity)} units</strong>
              </div>
              <div className="warehouse-ops-handoff__progress" aria-label={`${oneDecimal.format(activeOrder.target_quantity ? activeOrder.completed_quantity / activeOrder.target_quantity * 100 : 0)} percent complete`}>
                <i style={{ width: `${Math.min(100, activeOrder.target_quantity ? activeOrder.completed_quantity / activeOrder.target_quantity * 100 : 0)}%` }} />
              </div>
              <StatusPill value={activeOrder.status} />
            </div>
            <div className="warehouse-ops-handoff__rail">
              {handoff.map((step, index) => (
                <div key={step.label} className={`${step.complete ? 'is-complete' : ''}${step.current ? ' is-current' : ''}`} aria-current={step.current ? 'step' : undefined}>
                  <span>{step.complete ? <Check size={12} /> : index + 1}</span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon={Factory} title="No production orders in this warehouse scope" copy={selectedUnit && canPlan ? 'Create a production order to connect the BOM plan, floor labor, approval and inventory posting.' : 'Production planners create orders; warehouse managers receive them here for floor execution.'} />
        )}
      </Section>

      <Section
        title="Production order queue"
        eyebrow={`${openOrders.length} open · ${filteredOrders.length} visible plans`}
        action={!selectedUnit && canPlan
          ? <span className="warehouse-ops-panel-note">Select a warehouse to create a plan</span>
          : undefined}
      >
        {filteredOrders.length ? (
          <div className="warehouse-ops-table-wrap">
            <table className="warehouse-ops-table is-roomy warehouse-ops-order-table">
              <thead><tr><th>Production plan</th><th>Product / BOM</th><th>Warehouse</th><th>Plan progress</th><th>Schedule</th><th>Floor status</th><th /></tr></thead>
              <tbody>{filteredOrders.map(order => {
                const product = data.products.find(item => item.id === order.product_id)
                const bom = data.boms.find(item => item.id === order.bom_header_id)
                const unit = unitForOrder(order)
                const openBatch = openBatchForOrder(order.id)
                const latestBatch = latestBatchForOrder(order.id)
                const remaining = Math.max(0, order.target_quantity - order.completed_quantity)
                const progress = order.target_quantity ? Math.min(100, order.completed_quantity / order.target_quantity * 100) : 0
                const isLate = Boolean(order.due_date && order.due_date < todayValue && remaining > 0)
                const canCreateFloorBatch = Boolean(unit && canManageUnit(unit.id) && remaining > 0 && ['DRAFT', 'IN_PROGRESS'].includes(order.status))
                return (
                  <tr key={order.id} className={activeOrder?.id === order.id ? 'is-selected' : ''}>
                    <td><button className="warehouse-ops-batch-link" onClick={() => onFocusOrder(order.id)}>{order.order_number}</button><small>{order.planned_start_date ? `Starts ${formatDate(order.planned_start_date)}` : 'Start not scheduled'}</small></td>
                    <td><strong>{product?.name ?? 'Production item'}</strong><small>{bom?.name ?? 'BOM not linked'} · {bom ? titleCase(bom.stage) : 'Needs planning'}</small></td>
                    <td>{unit?.name ?? 'Unassigned warehouse'}<small>{order.company_id ? data.companies.find(company => company.id === order.company_id)?.name ?? 'Company scoped' : 'Legacy company scope missing'}</small></td>
                    <td><div className="warehouse-ops-order-progress"><span><b>{oneDecimal.format(progress)}%</b><small>{formatNumber(remaining)} remaining</small></span><i><b style={{ width: `${progress}%` }} /></i></div></td>
                    <td><span className={isLate ? 'is-negative' : ''}>{order.due_date ? formatDate(order.due_date) : 'No due date'}</span><small>{isLate ? 'Overdue' : titleCase(order.status)}</small></td>
                    <td>{latestBatch ? <><StatusPill value={latestBatch.status} /><small>{latestBatch.batch_number} · inventory {titleCase(latestBatch.inventory_posting_status)}</small></> : <><StatusPill value="pending" /><small>Not sent to floor</small></>}</td>
                    <td>
                      {openBatch ? (
                        <button className="warehouse-ops-row-action" onClick={event => { event.stopPropagation(); onOpenBatch(openBatch.id) }}>Open batch</button>
                      ) : canCreateFloorBatch && unit ? (
                        <button className="warehouse-ops-row-action is-approve" onClick={event => { event.stopPropagation(); onCreateBatch(order, unit) }} title="Opens the same floor-batch form, pre-linked to this order">New floor batch</button>
                      ) : latestBatch ? (
                        <button className="warehouse-ops-row-action" onClick={event => { event.stopPropagation(); onOpenBatch(latestBatch.id) }}>View result</button>
                      ) : (
                        <button className="warehouse-ops-row-action" disabled title="A current warehouse-manager assignment is required">Manager required</button>
                      )}
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Layers3} title="No matching production plans" copy={normalizedQuery ? 'Clear the search to see the production order queue.' : 'Create a production order from this warehouse or use the planning workspace.'} />
        )}
      </Section>

      <ProducibleNowPanel data={data} units={units} />
    </>
  )
}

function ProducibleNowPanel({ data, units }: { data: WarehouseOperationsData; units: OperationalUnit[] }) {
  const activeBoms = data.boms.filter(bom => bom.is_active)
  const warehouseUnits = units.filter(unit => unit.warehouse_id)
  const rows = warehouseUnits.flatMap(unit => activeBoms.map(bom => {
    const product = data.products.find(item => item.id === (bom.finished_product_id ?? bom.product_id))
    const estimate = computeMaxProducible(data.bomLines, data.inventory, bom.id, unit.warehouse_id as string)
    const limitingProduct = estimate.limitingComponentId
      ? data.products.find(item => item.id === estimate.limitingComponentId)
      : null
    return { unit, bom, product, estimate, limitingProduct }
  })).filter(row => row.estimate.maxUnits !== null)
    .sort((left, right) => (right.estimate.maxUnits ?? 0) - (left.estimate.maxUnits ?? 0))

  return (
    <Section
      title="Producible Now"
      eyebrow="Live stock vs. BOM requirements, per warehouse"
    >
      {rows.length ? (
        <div className="warehouse-ops-table-wrap">
          <table className="warehouse-ops-table is-roomy">
            <thead><tr><th>Product / BOM</th><th>Warehouse</th><th>Max producible now</th><th>Limiting component</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={`${row.unit.id}-${row.bom.id}`}>
                <td><strong>{row.product?.name ?? row.bom.name}</strong><small>{row.bom.name} · {titleCase(row.bom.stage)}</small></td>
                <td>{row.unit.name}</td>
                <td><strong className={row.estimate.maxUnits === 0 ? 'is-negative' : 'is-positive'}>{formatNumber(row.estimate.maxUnits ?? 0)} units</strong></td>
                <td>{row.limitingProduct?.name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Boxes} title="No BOM/inventory comparison available" copy="Active BOMs need at least one component line before a producible quantity can be estimated." />
      )}
    </Section>
  )
}

function BatchDetail({
  batch, data, canManage, canApprove, saving, onTransition, onApprove,
}: {
  batch: ProductionBatch
  data: WarehouseOperationsData
  canManage: boolean
  canApprove: boolean
  saving: boolean
  onTransition: (input: Parameters<typeof transitionProductionBatch>[0]) => Promise<void>
  onApprove: () => Promise<void>
}) {
  const batchWorkers = data.batchWorkers.filter(worker => worker.production_batch_id === batch.id)
  const task = data.taskTypes.find(item => item.id === batch.task_type_id)
  const supervisor = data.employees.find(employee => employee.id === batch.supervisor_employee_id)
  const productionOrder = data.productionOrders.find(item => item.id === batch.production_order_id)
  const productionProduct = data.products.find(item => item.id === batch.product_id)
  const productionBom = data.boms.find(item => item.id === batch.bom_header_id)
  const [actualUnits, setActualUnits] = useState(String(batch.actual_units))
  const [rejectedUnits, setRejectedUnits] = useState(String(batch.rejected_units))
  const [notes, setNotes] = useState(batch.notes ?? '')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [workerDrafts, setWorkerDrafts] = useState<Record<string, {
    regularHours: string
    overtimeHours: string
    attendanceStatus: Exclude<AttendanceStatus, 'sick'>
  }>>(() => Object.fromEntries(batchWorkers.map(worker => [worker.id, {
    regularHours: String(worker.regular_hours),
    overtimeHours: String(worker.overtime_hours),
    attendanceStatus: worker.attendance_status === 'sick' ? 'leave' : worker.attendance_status,
  }])))
  const locked = ['approved', 'cancelled'].includes(batch.status)
  const canEditResults = canManage && !locked
  const acceptedUnits = Math.max(0, Number(actualUnits || 0) - Number(rejectedUnits || 0))
  const achievement = batch.target_units ? acceptedUnits / batch.target_units * 100 : 0
  const rejectionRate = Number(actualUnits) ? Number(rejectedUnits || 0) / Number(actualUnits) * 100 : 0
  const stageIndex: Record<string, number> = { draft: 0, active: 1, completed: 2, submitted: 2, approved: 3, cancelled: -1 }
  const activeStage = stageIndex[batch.status] ?? 0

  function updateWorker(workerId: string, patch: Partial<(typeof workerDrafts)[string]>) {
    setWorkerDrafts(current => ({
      ...current,
      [workerId]: { ...current[workerId], ...patch },
    }))
  }

  return (
    <div className="warehouse-ops-batch-detail">
      <div className="warehouse-ops-batch-stage" aria-label={`Production batch status: ${titleCase(batch.status)}`}>
        {['Planned', 'In production', 'Submitted', 'Approved'].map((label, index) => (
          <div key={label} className={activeStage > index ? 'is-complete' : activeStage === index ? 'is-current' : ''}>
            <span>{activeStage > index ? <Check size={12} /> : index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
        {batch.status === 'cancelled' && <b>Batch cancelled</b>}
      </div>

      <div className="warehouse-ops-batch-summary">
        <article><span>Task type</span><strong>{task?.name ?? 'Production task'}</strong><small>{task?.standard_units_per_hour ? `${oneDecimal.format(task.standard_units_per_hour)} standard units/hour` : 'Target-based measurement'}</small></article>
        <article><span>Production date</span><strong>{formatDate(batch.production_date)}</strong><small>{data.shifts.find(shift => shift.id === batch.shift_id)?.name ?? 'No assigned shift'}</small></article>
        <article><span>Supervisor</span><strong>{supervisor?.full_name ?? 'Warehouse manager'}</strong><small>{supervisor?.title ?? 'Operational oversight'}</small></article>
        <article><span>Target achievement</span><strong className={achievement >= 90 ? 'is-positive' : achievement ? 'is-negative' : ''}>{oneDecimal.format(achievement)}%</strong><small>{formatNumber(acceptedUnits)} accepted · {oneDecimal.format(rejectionRate)}% rejected</small></article>
      </div>

      <div className={`warehouse-ops-batch-handoff is-${batch.inventory_posting_status}`}>
        <div><Landmark size={17} /></div>
        <span>
          <small>Production → inventory → workforce</small>
          <strong>{productionOrder
            ? `${productionOrder.order_number} · ${productionProduct?.name ?? 'Production item'}`
            : 'Operational batch · no inventory posting'}</strong>
          <p>{productionOrder
            ? `${productionBom?.name ?? 'Linked BOM'} · Inventory ${titleCase(batch.inventory_posting_status)}${batch.inventory_posted_at ? ` on ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(batch.inventory_posted_at))}` : ' after production approval'}. Labor stays attached to this batch for payroll.`
            : 'Worker hours and efficiency flow to warehouse payroll; product inventory is unchanged.'}</p>
        </span>
        <StatusPill value={batch.inventory_posting_status} />
      </div>

      <form onSubmit={event => {
        event.preventDefault()
        void onTransition({
          batchId: batch.id,
          action: 'submit',
          actualUnits: Number(actualUnits),
          rejectedUnits: Number(rejectedUnits),
          notes,
          workers: batchWorkers.map(worker => ({
            id: worker.id,
            regularHours: Number(workerDrafts[worker.id].regularHours),
            overtimeHours: Number(workerDrafts[worker.id].overtimeHours),
            attendanceStatus: workerDrafts[worker.id].attendanceStatus,
          })),
        })
      }}>
        <div className="warehouse-ops-batch-results">
          <div>
            <label>Actual units<input readOnly={!canEditResults} required min="0" step=".001" type="number" value={actualUnits} onChange={event => setActualUnits(event.target.value)} /></label>
            <label>Rejected units<input readOnly={!canEditResults} required min="0" max={actualUnits || undefined} step=".001" type="number" value={rejectedUnits} onChange={event => setRejectedUnits(event.target.value)} /></label>
            <label>Allocation method<div className="warehouse-ops-readonly-field">{titleCase(batch.allocation_method)}</div></label>
            <label>Batch status<div className="warehouse-ops-readonly-field"><StatusPill value={batch.status} /></div></label>
          </div>
          <label>Production notes<textarea readOnly={!canEditResults} rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add completion notes or production exceptions" /></label>
        </div>

        <div className="warehouse-ops-batch-workers">
          <div><span>Worker allocation</span><strong>{batchWorkers.length} employee records</strong><small>Hours and attendance are locked when the batch is approved.</small></div>
          <div className="warehouse-ops-table-wrap">
            <table className="warehouse-ops-table is-roomy">
              <thead><tr><th>Employee</th><th>Attendance</th><th>Regular hours</th><th>Overtime</th><th>Attributed units</th><th>Efficiency</th></tr></thead>
              <tbody>{batchWorkers.map(worker => {
                const employee = data.employees.find(item => item.id === worker.employee_id)
                const draft = workerDrafts[worker.id]
                return (
                  <tr key={worker.id}>
                    <td><strong>{employee?.full_name ?? 'Employee'}</strong><small>{employee?.title ?? titleCase(employee?.employment_type ?? 'operations')}</small></td>
                    <td>{canEditResults ? <SelectMenu ariaLabel={`${employee?.full_name ?? 'Employee'} batch attendance`} size="sm" value={draft.attendanceStatus} onChange={value => updateWorker(worker.id, { attendanceStatus: value as Exclude<AttendanceStatus, 'sick'> })} options={[
                      { value: 'present', label: 'Present' },
                      { value: 'partial', label: 'Partial day' },
                      { value: 'absent', label: 'Absent' },
                      { value: 'leave', label: 'Approved leave' },
                    ]} /> : <StatusPill value={worker.attendance_status} />}</td>
                    <td><input aria-label={`${employee?.full_name ?? 'Employee'} regular hours`} readOnly={!canEditResults} min="0" max="24" step=".25" type="number" value={draft.regularHours} onChange={event => updateWorker(worker.id, { regularHours: event.target.value })} /></td>
                    <td><input aria-label={`${employee?.full_name ?? 'Employee'} overtime hours`} readOnly={!canEditResults} min="0" max="16" step=".25" type="number" value={draft.overtimeHours} onChange={event => updateWorker(worker.id, { overtimeHours: event.target.value })} /></td>
                    <td>{worker.units_attributed == null ? 'Pending approval' : formatNumber(worker.units_attributed)}</td>
                    <td>{worker.employee_efficiency_pct == null ? '—' : <strong className={worker.employee_efficiency_pct < 80 ? 'is-negative' : 'is-positive'}>{oneDecimal.format(worker.employee_efficiency_pct)}%</strong>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>

        <div className="warehouse-ops-batch-actions">
          <div>
            {canManage && batch.status === 'draft' && <button type="button" className="warehouse-ops-secondary" disabled={saving} onClick={() => void onTransition({ batchId: batch.id, action: 'start' })}><Factory size={15} /> Start production</button>}
            {canManage && !locked && <button type="button" className={`warehouse-ops-cancel-button${confirmCancel ? ' is-confirming' : ''}`} disabled={saving} onClick={() => {
              if (!confirmCancel) setConfirmCancel(true)
              else void onTransition({ batchId: batch.id, action: 'cancel', notes })
            }}>{confirmCancel ? 'Confirm cancellation' : 'Cancel batch'}</button>}
          </div>
          <div>
            {canApprove && ['completed', 'submitted'].includes(batch.status) && <button type="button" className="warehouse-ops-secondary" disabled={saving} onClick={() => void onApprove()}><ShieldCheck size={15} /> Finalize & post to inventory</button>}
            {canEditResults && <button type="submit" className="warehouse-ops-primary" disabled={saving || actualUnits === '' || Number(rejectedUnits) > Number(actualUnits)}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Save & post to inventory
            </button>}
          </div>
        </div>
      </form>
    </div>
  )
}

function GroupForm({
  unit, employees, saving, onSave,
}: {
  unit: OperationalUnit
  employees: OperationalEmployee[]
  saving: boolean
  onSave: (input: Parameters<typeof createWorkforceGroup>[0]) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [groupType, setGroupType] = useState<WorkforceGroup['group_type']>('task_team')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({ operationalUnitId: unit.id, name, groupType, employeeIds: [...selected] })
    }}>
      <div className="warehouse-ops-form__grid">
        <label>Group name<input required value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Packing Team A" /></label>
        <label>Group type<SelectMenu ariaLabel="Workforce group type" value={groupType} onChange={value => setGroupType(value as WorkforceGroup['group_type'])} options={[
          { value: 'task_team', label: 'Task team', description: 'Reusable production crew' },
          { value: 'shift', label: 'Shift group', description: 'Workers assigned by shift' },
          { value: 'permanent', label: 'Permanent group', description: 'Stable long-term team' },
          { value: 'temporary', label: 'Temporary group', description: 'Time-limited assignment' },
        ]} /></label>
      </div>
      <div className="warehouse-ops-form__selection">
        <div className="warehouse-ops-form__selection-head"><strong>Members · {selected.size} selected</strong><span>Employees remain individual records in the HR master.</span></div>
        <div className="warehouse-ops-employee-picker">
          {employees.map(employee => (
            <label key={employee.id} className="warehouse-ops-check">
              <input type="checkbox" checked={selected.has(employee.id)} onChange={() => setSelected(current => {
                const next = new Set(current)
                if (next.has(employee.id)) next.delete(employee.id)
                else next.add(employee.id)
                return next
              })} />
              <span><strong>{employee.full_name}</strong><small>{employee.title ?? employee.employment_type}</small></span>
            </label>
          ))}
        </div>
      </div>
      <div className="warehouse-ops-form__footer">
        <span>Members can belong to multiple task teams.</span>
        <button className="warehouse-ops-primary" disabled={saving || !name.trim()}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />} Create group
        </button>
      </div>
    </form>
  )
}

function AttendanceForm({
  unit, employees, shifts, date, saving, onSave,
}: {
  unit: OperationalUnit
  employees: OperationalEmployee[]
  shifts: WarehouseOperationsData['shifts']
  date: string
  saving: boolean
  onSave: (input: Parameters<typeof saveAttendance>[0]) => Promise<void>
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '')
  const [attendanceDate, setAttendanceDate] = useState(date)
  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [hours, setHours] = useState('8')
  const [overtime, setOvertime] = useState('0')
  const [notes, setNotes] = useState('')
  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({
        employeeId, operationalUnitId: unit.id, shiftId: shiftId || null,
        attendanceDate, attendanceStatus: status, regularHours: Number(hours),
        rawOvertimeHours: Number(overtime), notes,
      })
    }}>
      <div className="warehouse-ops-form__grid">
        <label>Employee<SelectMenu ariaLabel="Attendance employee" searchable value={employeeId} onChange={setEmployeeId} options={employees.map(employee => ({ value: employee.id, label: employee.full_name, description: employee.title ?? titleCase(employee.employment_type) }))} /></label>
        <label>Date<input required type="date" value={attendanceDate} onChange={event => setAttendanceDate(event.target.value)} /></label>
        <label>Shift<SelectMenu ariaLabel="Attendance shift" value={shiftId} onChange={setShiftId} options={[{ value: '', label: 'No shift' }, ...shifts.map(shift => ({ value: shift.id, label: shift.name, description: `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` }))]} /></label>
        <label>Status<SelectMenu ariaLabel="Attendance status" value={status} onChange={value => setStatus(value as AttendanceStatus)} options={[
          { value: 'present', label: 'Present', description: 'Completed scheduled work' },
          { value: 'partial', label: 'Partial day', description: 'Worked fewer scheduled hours' },
          { value: 'absent', label: 'Absent', description: 'No attendance recorded' },
          { value: 'leave', label: 'Approved leave' },
          { value: 'sick', label: 'Sick leave' },
        ]} /></label>
        <label>Regular hours<input min="0" max="24" step=".25" type="number" value={hours} onChange={event => setHours(event.target.value)} /></label>
        <label>Raw overtime<input min="0" max="16" step=".25" type="number" value={overtime} onChange={event => setOvertime(event.target.value)} /></label>
      </div>
      <label>Notes<textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional attendance note" /></label>
      <div className="warehouse-ops-form__footer">
        <span>Saving again updates the same employee/date record.</span>
        <button className="warehouse-ops-primary" disabled={saving || !employeeId}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />} Save attendance
        </button>
      </div>
    </form>
  )
}

type BulkAttendanceDraft = {
  shiftId: string
  status: AttendanceStatus | ''
  regularHours: string
  overtimeHours: string
  notes: string
}

function BulkAttendanceForm({
  unit, employees, shifts, attendance, date, saving, onSave,
}: {
  unit: OperationalUnit
  employees: OperationalEmployee[]
  shifts: WarehouseOperationsData['shifts']
  attendance: WarehouseOperationsData['attendance']
  date: string
  saving: boolean
  onSave: (inputs: Parameters<typeof saveAttendanceBatch>[0]) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [defaultShiftId, setDefaultShiftId] = useState(shifts[0]?.id ?? '')
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, BulkAttendanceDraft>>(() => Object.fromEntries(
    employees.map(employee => {
      const existing = attendance.find(row => row.employee_id === employee.id)
      return [employee.id, {
        shiftId: existing?.shift_id ?? shifts[0]?.id ?? '',
        status: existing?.attendance_status ?? '',
        regularHours: String(existing?.regular_hours ?? 8),
        overtimeHours: String(existing?.raw_overtime_hours ?? 0),
        notes: existing?.notes ?? '',
      }]
    }),
  ))

  const filtered = employees.filter(employee => {
    const term = search.trim().toLowerCase()
    return !term || employee.full_name.toLowerCase().includes(term)
      || (employee.title ?? employee.department ?? '').toLowerCase().includes(term)
  })
  const recorded = Object.values(drafts).filter(row => row.status).length
  const dirtyRows = employees.filter(employee => dirty.has(employee.id) && drafts[employee.id]?.status)

  function updateDraft(employeeId: string, patch: Partial<BulkAttendanceDraft>) {
    setDrafts(current => ({
      ...current,
      [employeeId]: { ...current[employeeId], ...patch },
    }))
    setDirty(current => new Set(current).add(employeeId))
  }

  function fillMissingAsPresent() {
    const changed: string[] = []
    setDrafts(current => {
      const next = { ...current }
      employees.forEach(employee => {
        if (!next[employee.id]?.status) {
          next[employee.id] = {
            ...next[employee.id],
            shiftId: defaultShiftId,
            status: 'present',
            regularHours: '8',
            overtimeHours: '0',
          }
          changed.push(employee.id)
        }
      })
      return next
    })
    setDirty(current => new Set([...current, ...changed]))
  }

  return (
    <form className="warehouse-ops-form warehouse-ops-bulk-attendance" onSubmit={event => {
      event.preventDefault()
      void onSave(dirtyRows.map(employee => {
        const draft = drafts[employee.id]
        return {
          employeeId: employee.id,
          operationalUnitId: unit.id,
          shiftId: draft.shiftId || null,
          attendanceDate: date,
          attendanceStatus: draft.status as AttendanceStatus,
          regularHours: Number(draft.regularHours),
          rawOvertimeHours: Number(draft.overtimeHours),
          notes: draft.notes,
        }
      }))
    }}>
      <div className="warehouse-ops-bulk-toolbar">
        <div>
          <span>Attendance ledger</span>
          <strong>{recorded} of {employees.length} employees recorded</strong>
          <small>{formatDate(date)} · changes save as one controlled batch</small>
        </div>
        <label className="warehouse-ops-bulk-search">
          <Search size={14} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find an employee" />
        </label>
        <div className="warehouse-ops-bulk-default">
          <span>Default shift</span>
          <SelectMenu
            ariaLabel="Default attendance shift"
            size="sm"
            value={defaultShiftId}
            onChange={setDefaultShiftId}
            options={[{ value: '', label: 'No shift' }, ...shifts.map(shift => ({
              value: shift.id,
              label: shift.name,
              description: `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`,
            }))]}
          />
        </div>
        <button type="button" className="warehouse-ops-secondary" onClick={fillMissingAsPresent}>
          <UserCheck size={15} /> Fill missing as present
        </button>
      </div>

      <div className="warehouse-ops-table-wrap warehouse-ops-attendance-ledger">
        <table className="warehouse-ops-table is-roomy">
          <thead><tr><th>Employee</th><th>Status</th><th>Shift</th><th>Regular hours</th><th>Raw OT</th><th>Entry</th></tr></thead>
          <tbody>
            {filtered.map(employee => {
              const row = drafts[employee.id]
              const wasRecorded = attendance.some(item => item.employee_id === employee.id)
              return (
                <tr key={employee.id} className={dirty.has(employee.id) ? 'is-dirty' : ''}>
                  <td><strong>{employee.full_name}</strong><small>{employee.title ?? employee.department ?? titleCase(employee.employment_type)}</small></td>
                  <td>
                    <SelectMenu
                      ariaLabel={`${employee.full_name} attendance status`}
                      size="sm"
                      value={row.status}
                      placeholder="Choose status"
                      onChange={value => updateDraft(employee.id, {
                        status: value as AttendanceStatus,
                        regularHours: ['absent', 'leave', 'sick'].includes(value) ? '0' : row.regularHours || '8',
                        overtimeHours: ['absent', 'leave', 'sick'].includes(value) ? '0' : row.overtimeHours,
                      })}
                      options={[
                        { value: 'present', label: 'Present' },
                        { value: 'partial', label: 'Partial day' },
                        { value: 'absent', label: 'Absent' },
                        { value: 'leave', label: 'Approved leave' },
                        { value: 'sick', label: 'Sick leave' },
                      ]}
                    />
                  </td>
                  <td>
                    <SelectMenu
                      ariaLabel={`${employee.full_name} shift`}
                      size="sm"
                      value={row.shiftId}
                      onChange={value => updateDraft(employee.id, { shiftId: value })}
                      options={[{ value: '', label: 'No shift' }, ...shifts.map(shift => ({ value: shift.id, label: shift.name }))]}
                    />
                  </td>
                  <td><input aria-label={`${employee.full_name} regular hours`} disabled={!row.status || ['absent', 'leave', 'sick'].includes(row.status)} min="0" max="24" step=".25" type="number" value={row.regularHours} onChange={event => updateDraft(employee.id, { regularHours: event.target.value })} /></td>
                  <td><input aria-label={`${employee.full_name} raw overtime`} disabled={!row.status || ['absent', 'leave', 'sick'].includes(row.status)} min="0" max="16" step=".25" type="number" value={row.overtimeHours} onChange={event => updateDraft(employee.id, { overtimeHours: event.target.value })} /></td>
                  <td><span className={`warehouse-ops-ledger-state${dirty.has(employee.id) ? ' is-dirty' : wasRecorded ? ' is-saved' : ''}`}>{dirty.has(employee.id) ? 'Changed' : wasRecorded ? 'Saved' : 'Missing'}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="warehouse-ops-form__footer">
        <span>{dirtyRows.length} changed attendance record{dirtyRows.length === 1 ? '' : 's'} ready to save. Approved overtime remains controlled separately.</span>
        <button className="warehouse-ops-primary" disabled={saving || dirtyRows.length === 0}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Save attendance batch
        </button>
      </div>
    </form>
  )
}

function AttendanceWorkspace({
  unit, employees, shifts, attendance, date, saving, onSaveSingle, onSaveBulk,
}: {
  unit: OperationalUnit
  employees: OperationalEmployee[]
  shifts: WarehouseOperationsData['shifts']
  attendance: WarehouseOperationsData['attendance']
  date: string
  saving: boolean
  onSaveSingle: (input: Parameters<typeof saveAttendance>[0]) => Promise<void>
  onSaveBulk: (inputs: Parameters<typeof saveAttendanceBatch>[0]) => Promise<void>
}) {
  const [mode, setMode] = useState<'bulk' | 'single'>('bulk')
  return (
    <div className="warehouse-ops-attendance-workspace">
      <div className="warehouse-ops-mode-switch" role="tablist" aria-label="Attendance entry mode">
        <button type="button" role="tab" aria-selected={mode === 'bulk'} className={mode === 'bulk' ? 'is-active' : ''} onClick={() => setMode('bulk')}>
          <ClipboardCheck size={14} /> Bulk ledger
        </button>
        <button type="button" role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'is-active' : ''} onClick={() => setMode('single')}>
          <UserCheck size={14} /> Quick single entry
        </button>
      </div>
      {mode === 'bulk'
        ? <BulkAttendanceForm unit={unit} employees={employees} shifts={shifts} attendance={attendance} date={date} saving={saving} onSave={onSaveBulk} />
        : <AttendanceForm unit={unit} employees={employees} shifts={shifts} date={date} saving={saving} onSave={onSaveSingle} />}
    </div>
  )
}

function OvertimeForm({
  unit, employees, types, batches, date, saving, onSave,
}: {
  unit: OperationalUnit
  employees: OperationalEmployee[]
  types: WarehouseOperationsData['overtimeTypes']
  batches: ProductionBatch[]
  date: string
  saving: boolean
  onSave: (input: Parameters<typeof submitOvertime>[0]) => Promise<void>
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '')
  const [overtimeDate, setOvertimeDate] = useState(date)
  const [hours, setHours] = useState('2')
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [batchId, setBatchId] = useState('')
  const [reason, setReason] = useState('')
  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({
        employeeId, operationalUnitId: unit.id, productionBatchId: batchId || null,
        overtimeDate, requestedHours: Number(hours), overtimeTypeId: typeId, reason,
      })
    }}>
      <div className="warehouse-ops-form__grid">
        <label>Employee<SelectMenu ariaLabel="Overtime employee" searchable value={employeeId} onChange={setEmployeeId} options={employees.map(employee => ({ value: employee.id, label: employee.full_name, description: employee.title ?? titleCase(employee.employment_type) }))} /></label>
        <label>Overtime date<input required type="date" value={overtimeDate} onChange={event => setOvertimeDate(event.target.value)} /></label>
        <label>Requested hours<input required min=".25" max="16" step=".25" type="number" value={hours} onChange={event => setHours(event.target.value)} /></label>
        <label>Overtime type<SelectMenu ariaLabel="Overtime rate type" value={typeId} onChange={setTypeId} options={types.map(type => ({ value: type.id, label: type.name, description: `${type.multiplier}× hourly rate` }))} /></label>
        <label>Production batch<SelectMenu ariaLabel="Related production batch" searchable value={batchId} onChange={setBatchId} options={[{ value: '', label: 'Not batch-specific', description: 'General warehouse overtime' }, ...batches.map(batch => ({ value: batch.id, label: batch.batch_number, description: `${formatDate(batch.production_date)} · ${titleCase(batch.status)}` }))]} /></label>
      </div>
      <label>Business reason<textarea required rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is overtime required?" /></label>
      <div className="warehouse-ops-form__footer">
        <span>Approval is separate from attendance and payroll preparation.</span>
        <button className="warehouse-ops-primary" disabled={saving || !employeeId || !typeId || !reason.trim()}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Clock3 size={15} />} Submit request
        </button>
      </div>
    </form>
  )
}

function PayrollForm({
  unit, date, saving, onSave,
}: {
  unit: OperationalUnit
  date: string
  saving: boolean
  onSave: (start: string, end: string) => Promise<void>
}) {
  const [start, setStart] = useState(`${date.slice(0, 7)}-01`)
  const [end, setEnd] = useState(date)
  const [validation, setValidation] = useState<PayrollValidationResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!start || !end || end < start) return
    const timer = window.setTimeout(() => {
      setValidating(true)
      setValidationError(null)
      void validateWarehousePayroll(unit.id, start, end)
        .then(result => {
          if (!cancelled) setValidation(result)
        })
        .catch(caught => {
          if (!cancelled) {
            setValidation(null)
            setValidationError(caught instanceof Error ? caught.message : 'Could not run payroll validation.')
          }
        })
        .finally(() => {
          if (!cancelled) setValidating(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [end, start, unit.id])

  const validationIssues = validation ? [
    { key: 'attendance', label: 'Missing attendance', copy: 'Employees without a period record', issue: validation.missing_attendance },
    { key: 'overtime', label: 'Pending overtime', copy: 'Requests needing an independent decision', issue: validation.pending_overtime },
    { key: 'batches', label: 'Unapproved batches', copy: 'Production awaiting approval or cancellation', issue: validation.unapproved_batches },
    { key: 'salary', label: 'Salary structure', copy: 'Employees missing a valid pay basis', issue: validation.missing_salary },
  ] : []

  return (
    <form className="warehouse-ops-form" onSubmit={event => { event.preventDefault(); void onSave(start, end) }}>
      <div className="warehouse-ops-form__grid">
        <label>Period start<input required type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
        <label>Period end<input required min={start} type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
      </div>
      <div className={`warehouse-ops-readiness${validation?.ready ? ' is-ready' : validation ? ' is-blocked' : ''}`}>
        <div className="warehouse-ops-readiness__head">
          <span>{validating ? <Loader2 size={17} className="animate-spin" /> : validation?.ready ? <CheckCircle2 size={17} /> : <ShieldCheck size={17} />}</span>
          <div>
            <strong>{validating ? 'Checking payroll controls…' : validation?.ready ? 'Payroll is ready to calculate' : validation ? `${validation.blocking_count} blocking control${validation.blocking_count === 1 ? '' : 's'} found` : 'Payroll readiness gate'}</strong>
            <small>{validation ? `${validation.active_employees} active employees evaluated for ${formatDate(start)} – ${formatDate(end)}` : 'Select a valid period to inspect attendance, overtime, production and salary controls.'}</small>
          </div>
        </div>
        {validationError && <div className="warehouse-ops-readiness__error" role="alert"><AlertTriangle size={14} />{validationError}</div>}
        {validation && (
          <>
            <div className="warehouse-ops-readiness__grid">
              {validationIssues.map(item => (
                <article key={item.key} className={item.issue.count ? 'has-issue' : 'is-clear'}>
                  <div><span>{item.issue.count ? <AlertTriangle size={14} /> : <Check size={14} />}</span><b>{item.issue.count}</b></div>
                  <strong>{item.label}</strong>
                  <small>{item.copy}</small>
                  {item.issue.items.slice(0, 2).map(issue => <p key={issue.id}>{issue.label}<span>{issue.detail}</span></p>)}
                  {item.issue.items.length > 2 && <em>+{item.issue.items.length - 2} more</em>}
                </article>
              ))}
            </div>
            <div className="warehouse-ops-readiness__system">
              <p className={validation.payroll_scope.configured ? 'is-clear' : 'has-issue'}><span>{validation.payroll_scope.configured ? <Check size={13} /> : <AlertTriangle size={13} />}</span>Payroll scope<strong>{validation.payroll_scope.label}</strong></p>
              <p className={!validation.existing_run.exists ? 'is-clear' : 'has-issue'}><span>{!validation.existing_run.exists ? <Check size={13} /> : <AlertTriangle size={13} />}</span>Period availability<strong>{validation.existing_run.label}</strong></p>
            </div>
          </>
        )}
      </div>
      <div className="warehouse-ops-form__footer">
        <span>{unit.name} · summarized journal only after Finance posts.</span>
        <button className="warehouse-ops-primary" disabled={saving || validating || end < start || (validation !== null && !validation.ready)}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <BadgeDollarSign size={15} />} Calculate warehouse payroll
        </button>
      </div>
    </form>
  )
}

export function WarehouseOperations() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<WarehouseOperationsData>(EMPTY_DATA)
  const [date, setDate] = useState(() => searchParams.get('date') || today())
  const [selectedUnitId, setSelectedUnitId] = useState(() => searchParams.get('unit') || 'all')
  const [tab, setTab] = useState<Tab>(() => {
    const tabKey = searchParams.get('tab')
    return tabKey && TABS.some(item => item.key === tabKey) ? (tabKey as Tab) : 'overview'
  })
  const [modal, setModal] = useState<ModalName>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [preselectedProductionOrderId, setPreselectedProductionOrderId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dailyReport, setDailyReport] = useState<ProductionDailyReportData>({ logs: [], movements: [], salesToday: 0, damageReports: [] })
  const [shipments, setShipments] = useState<Array<{ id: string; shipment_number: string }>>([])

  // Keep date/warehouse/tab in the URL so a hard refresh (or a shared
  // link) restores the same view instead of silently resetting to
  // today + "all units" — batches or orders scoped to another date or
  // warehouse would otherwise look like they'd disappeared.
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('date', date)
      if (selectedUnitId && selectedUnitId !== 'all') next.set('unit', selectedUnitId)
      else next.delete('unit')
      next.set('tab', tab)
      return next
    }, { replace: true })
  }, [date, selectedUnitId, tab, setSearchParams])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [next, report, shipmentsRes] = await Promise.all([
        fetchWarehouseOperations(date),
        fetchProductionDailyReport(date),
        supabase.from('shipments').select('id, shipment_number').order('created_at', { ascending: false }).limit(100),
      ])
      setData(next)
      setDailyReport(report)
      setShipments((shipmentsRes.data ?? []) as Array<{ id: string; shipment_number: string }>)
      setSelectedUnitId(current => {
        if (next.units.length === 1) return next.units[0].id
        if (current !== 'all' && !next.units.some(unit => unit.id === current)) return 'all'
        return current
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load warehouse operations.')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const accessRolesForUnit = useCallback((unitId: string) => {
    const currentDate = today()
    return data.assignments
      .filter(assignment =>
        assignment.profile_id === profile?.id
        && (assignment.operational_unit_id === null || assignment.operational_unit_id === unitId)
        && assignment.effective_from <= currentDate
        && (!assignment.effective_to || assignment.effective_to >= currentDate),
      )
      .map(assignment => assignment.access_role)
  }, [data.assignments, profile?.id])
  const hasUnitRole = useCallback(
    (unitId: string, roles: UnitAccessRole[]) => accessRolesForUnit(unitId).some(role => roles.includes(role)),
    [accessRolesForUnit],
  )
  const canManageUnit = useCallback(
    (unitId: string) => profile?.role === 'full_access' || hasUnitRole(unitId, ['warehouse_manager']),
    [hasUnitRole, profile?.role],
  )

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => {
      const orderId = searchParams.get('order')
      const batchId = searchParams.get('batch')
      const tabKey = searchParams.get('tab')
      if (tabKey && TABS.some(item => item.key === tabKey)) setTab(tabKey as Tab)
      if (orderId) {
        const order = data.productionOrders.find(item => item.id === orderId)
        const unit = order ? data.units.find(item => item.warehouse_id === order.warehouse_id) : null
        if (order && unit) {
          const openBatch = data.batches.find(batch =>
            batch.production_order_id === order.id
            && !['approved', 'cancelled'].includes(batch.status),
          )
          setSelectedUnitId(unit.id)
          setDate(order.planned_start_date ?? today())
          setPreselectedProductionOrderId(order.id)
          setTab('production')
          if (openBatch) {
            setSelectedBatchId(openBatch.id)
            setModal('batchDetail')
          } else if (canManageUnit(unit.id)) {
            setModal('batch')
          } else {
            setModal(null)
            setNotice('Production order opened. A current warehouse-manager assignment is required to create its floor batch.')
          }
        } else {
          setError('This production order is not available in your warehouse operations scope.')
        }
        setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('order'); next.delete('batch'); next.set('tab', 'production'); return next }, { replace: true })
        return
      }
      if (batchId) {
        const batch = data.batches.find(item => item.id === batchId)
        if (batch) {
          setSelectedUnitId(batch.operational_unit_id)
          setDate(batch.production_date)
          setSelectedBatchId(batch.id)
          setTab('production')
          setModal('batchDetail')
        } else {
          setError('This production batch is not available in your warehouse operations scope.')
        }
        setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('order'); next.delete('batch'); next.set('tab', 'production'); return next }, { replace: true })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [canManageUnit, data.batches, data.productionOrders, data.units, loading, searchParams, setSearchParams])

  const unitById = useMemo(() => new Map(data.units.map(unit => [unit.id, unit])), [data.units])
  const employeeById = useMemo(() => new Map(data.employees.map(employee => [employee.id, employee])), [data.employees])
  const taskById = useMemo(() => new Map(data.taskTypes.map(task => [task.id, task])), [data.taskTypes])
  const selectedUnit = selectedUnitId === 'all' ? null : unitById.get(selectedUnitId) ?? null
  const inScope = useCallback((unitId: string) => selectedUnitId === 'all' || unitId === selectedUnitId, [selectedUnitId])
  const scopedUnits = selectedUnit ? [selectedUnit] : data.units
  const scopedEmployees = data.employees.filter(employee => inScope(employee.operational_unit_id))
  const scopedGroups = data.groups.filter(group => inScope(group.operational_unit_id))
  const scopedBatches = data.batches.filter(batch => inScope(batch.operational_unit_id) && batch.production_date === date)
  const scopedAttendance = data.attendance.filter(row => inScope(row.operational_unit_id) && row.attendance_date === date)
  const scopedOvertime = data.overtime.filter(row => inScope(row.operational_unit_id))
  const scopedEfficiency = data.employeeEfficiency.filter(row => inScope(row.operational_unit_id) && row.log_date === date)
  const scopedRollups = data.rollups.filter(row => inScope(row.operational_unit_id) && row.log_date === date)
  const scopedAlerts = data.alerts.filter(alert => inScope(alert.operational_unit_id))
  const scopedPayroll = data.payrollRuns.filter(run => inScope(run.operational_unit_id))

  const canManage = selectedUnit ? canManageUnit(selectedUnit.id) : false
  const canApprove = selectedUnit
    ? profile?.role === 'full_access' || hasUnitRole(selectedUnit.id, ['regional_manager'])
    : false
  const canProcessPayroll = selectedUnit
    ? ['full_access', 'hr_system'].includes(profile?.role ?? '') || hasUnitRole(selectedUnit.id, ['warehouse_manager', 'payroll_officer'])
    : false
  const canDecideOvertime = selectedUnit ? canApprove || profile?.role === 'hr_system' : false
  const canPlanProduction = ['full_access', 'manufacturing_sales'].includes(profile?.role ?? '')
  const selectedBatch = selectedBatchId ? data.batches.find(batch => batch.id === selectedBatchId) ?? null : null
  const canManageSelectedBatch = selectedBatch ? canManageUnit(selectedBatch.operational_unit_id) : false
  const canApproveSelectedBatch = selectedBatch
    ? profile?.role === 'full_access' || hasUnitRole(selectedBatch.operational_unit_id, ['regional_manager'])
    : false

  const rollupHours = sum(scopedRollups, row => row.regular_hours + row.overtime_hours)
  const attendanceHours = sum(scopedAttendance, row => row.regular_hours + row.approved_overtime_hours)
  const totalHours = rollupHours || attendanceHours
  const totalUnits = sum(scopedRollups, row => row.total_units) || sum(scopedBatches.filter(batch => batch.status === 'approved'), batch => batch.actual_units)
  const weightedEfficiency = rollupHours
    ? sum(scopedRollups, row => row.avg_efficiency_pct * (row.regular_hours + row.overtime_hours)) / rollupHours
    : scopedEfficiency.length ? sum(scopedEfficiency, row => row.efficiency_pct) / scopedEfficiency.length : 0
  const latestPayrollByUnit = useMemo(() => {
    const map = new Map<string, WarehousePayrollRun>()
    data.payrollRuns.forEach(run => { if (!map.has(run.operational_unit_id)) map.set(run.operational_unit_id, run) })
    return map
  }, [data.payrollRuns])
  const payrollCost = sum(scopedUnits, unit => latestPayrollByUnit.get(unit.id)?.gross_amount ?? 0)
  const pendingPayroll = scopedPayroll.filter(run => ['calculated', 'submitted', 'hr_approved', 'finance_approved'].includes(run.status)).length
  const unitsNeedingAttention = new Set(scopedAlerts.filter(alert => ['high', 'critical'].includes(alert.severity)).map(alert => alert.operational_unit_id)).size

  const filteredEmployees = scopedEmployees.filter(employee => employee.full_name.toLowerCase().includes(query.toLowerCase()))
  const filteredBatches = scopedBatches.filter(batch => batch.batch_number.toLowerCase().includes(query.toLowerCase()) || (taskById.get(batch.task_type_id)?.name ?? '').toLowerCase().includes(query.toLowerCase()))

  async function runAction(
    action: () => Promise<void>,
    success: string,
    closeModal = false,
    preserveProductionOrder = false,
  ) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (closeModal) {
        setModal(null)
        if (!preserveProductionOrder) setPreselectedProductionOrderId('')
      }
      setNotice(success)
      await load(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The operation could not be completed.')
    } finally {
      setSaving(false)
    }
  }

  function openBatch(batchId: string) {
    setSelectedBatchId(batchId)
    setModal('batchDetail')
  }

  async function refreshAll() {
    setSaving(true)
    setError(null)
    try {
      await Promise.all(scopedUnits.map(unit => refreshOperationalAlerts(unit.id, date)))
      await load(true)
      setNotice('Operational alerts and dashboard metrics are up to date.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not refresh operations.')
    } finally {
      setSaving(false)
    }
  }

  // A BOM already has a floor batch tracking it for this date — quick-log
  // would double-count inventory/labor, so route the user there instead.
  function managedBatchFor(bomHeaderId: string, unitId: string, productionDate: string) {
    const unitWarehouseId = data.units.find(item => item.id === unitId)?.warehouse_id
    const activeOrder = data.productionOrders.find(order =>
      order.bom_header_id === bomHeaderId
      && order.warehouse_id === unitWarehouseId
      && ['DRAFT', 'IN_PROGRESS'].includes(order.status)
      && order.target_quantity > order.completed_quantity,
    )
    return data.batches.find(batch =>
      batch.operational_unit_id === unitId
      && batch.bom_header_id === bomHeaderId
      && (
        (activeOrder && batch.production_order_id === activeOrder.id)
        || batch.production_date === productionDate
      )
      && batch.status !== 'cancelled',
    ) ?? null
  }

  async function submitQuickLog(input: { logDate: string; notes: string; employeeId: string; entries: { bomId: string; quantity: number }[] }) {
    if (!selectedUnit?.warehouse_id) throw new Error('Select a warehouse first.')
    const warehouseId = selectedUnit.warehouse_id
    for (const entry of input.entries) {
      const bom = data.boms.find(item => item.id === entry.bomId)
      if (!bom) continue
      const order = data.productionOrders.find(item =>
        item.bom_header_id === entry.bomId && item.warehouse_id === warehouseId
        && ['DRAFT', 'IN_PROGRESS'].includes(item.status) && item.target_quantity > item.completed_quantity,
      )
      let previousQuantity = 0
      if (order) {
        const { data: existing, error: existingError } = await supabase
          .from('production_daily_logs').select('id, quantity_produced')
          .eq('production_order_id', order.id).eq('log_date', input.logDate).limit(1).maybeSingle()
        if (existingError) throw existingError
        previousQuantity = Number(existing?.quantity_produced ?? 0)
      } else {
        const { data: standalone, error: standaloneError } = await supabase
          .from('production_daily_logs').select('id, quantity_produced')
          .eq('bom_header_id', entry.bomId).eq('warehouse_id', warehouseId).eq('log_date', input.logDate)
          .is('production_order_id', null).limit(1).maybeSingle()
        if (standaloneError) throw standaloneError
        previousQuantity = Number(standalone?.quantity_produced ?? 0)
      }
      const delta = entry.quantity - previousQuantity
      if (delta === 0) continue
      if (delta < 0) throw new Error(`Cannot reduce ${bom.name}'s logged quantity. Use an inventory correction with an audit note instead.`)
      await logUnmanagedProduction({
        bomHeaderId: entry.bomId,
        warehouseId,
        quantity: delta,
        notes: input.notes || undefined,
        logDate: input.logDate,
        employeeId: input.employeeId || undefined,
        productionOrderId: order?.id,
        companyId: selectedUnit.company_id || undefined,
      })
    }
  }

  async function submitDamageReport(input: { productId: string; quantity: number; reason: string; shipmentId: string; reportDate: string }) {
    if (!selectedUnit?.warehouse_id) throw new Error('Select a warehouse first.')
    await createDamageReport({
      productId: input.productId,
      warehouseId: selectedUnit.warehouse_id,
      quantity: input.quantity,
      reason: input.reason,
      shipmentId: input.shipmentId || undefined,
      reportDate: input.reportDate,
    })
  }

  const latestRun = scopedPayroll.find(run => run.status !== 'rejected') ?? scopedPayroll[0] ?? null
  const latestAccountingBatch = latestRun
    ? data.accountingBatches.find(batch => batch.payroll_run_id === latestRun.id) ?? null
    : null
  const todayAttendanceRate = scopedEmployees.length ? scopedAttendance.filter(row => ['present', 'partial'].includes(row.attendance_status)).length / scopedEmployees.length * 100 : 0

  if (loading) {
    return (
      <div className="warehouse-ops-shell">
        <div className="warehouse-ops-loading"><Loader2 className="animate-spin" /><strong>Loading warehouse operations</strong><span>Resolving your operational scope and live production data…</span></div>
      </div>
    )
  }

  return (
    <div className="warehouse-ops-shell">
      <header className="warehouse-ops-header">
        <div>
          <div className="warehouse-ops-eyebrow"><span /><p>Operations / Workforce control</p></div>
          <h1>{selectedUnit ? selectedUnit.name : 'Warehouse Operations'}</h1>
          <p>{selectedUnit ? 'Production, people, efficiency and payroll in one isolated workspace.' : 'Cross-company production, labor efficiency and payroll oversight.'}</p>
        </div>
        <div className="warehouse-ops-header__actions">
          <label className="warehouse-ops-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search workers, orders or batches" /></label>
          <button className="warehouse-ops-icon-button" onClick={() => void refreshAll()} disabled={saving} aria-label="Refresh data"><RefreshCw size={16} className={saving ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div className="warehouse-ops-controls">
        <div className="warehouse-ops-control-select"><Building2 size={15} /><SelectMenu className="warehouse-ops-unit-select" size="sm" ariaLabel="Operational unit" searchable value={selectedUnitId} onChange={setSelectedUnitId} options={[...(data.units.length > 1 ? [{ value: 'all', label: 'All operational units', description: 'Consolidated company view' }] : []), ...data.units.map(unit => ({ value: unit.id, label: unit.name, description: `${titleCase(unit.unit_type)} · ${unit.code}` }))]} /></div>
        <label><CalendarDays size={15} /><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <div className="warehouse-ops-scope">
          <ShieldCheck size={14} />
          <span>{selectedUnit ? (canManage ? 'Warehouse manager scope' : canApprove ? 'Approval scope' : 'Read-only operational scope') : 'Consolidated view-only scope'}</span>
        </div>
      </div>

      {error && <div className="warehouse-ops-message is-error" role="alert"><AlertTriangle size={17} /><div><strong>Action needed</strong><span>{error}</span></div><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div className="warehouse-ops-message is-success" role="status" aria-live="polite"><CheckCircle2 size={17} /><div><strong>Done</strong><span>{notice}</span></div><button onClick={() => setNotice(null)} aria-label="Dismiss confirmation"><X size={15} /></button></div>}

      {data.units.length === 0 ? (
        <Section title="Warehouse Operations is ready to configure">
          <EmptyState icon={Factory} title="No accessible operational units" copy="Apply the warehouse operations migration, then assign operational access in Supabase or link a designated production manager to a warehouse." />
        </Section>
      ) : (
        <>
          <div className="warehouse-ops-kpis">
            <article className="warehouse-ops-kpi is-dark"><div className="warehouse-ops-kpi__icon"><Factory size={21} /></div><span>Total warehouses</span><strong>{data.units.length}</strong><small>{selectedUnit ? titleCase(selectedUnit.unit_type) : `${data.units.filter(unit => unit.unit_type === 'factory').length} production-enabled`}</small></article>
            <article className="warehouse-ops-kpi"><div className="warehouse-ops-kpi__icon is-blue"><Users size={21} /></div><span>Active employees</span><strong>{formatNumber(scopedEmployees.length)}</strong><small>{oneDecimal.format(todayAttendanceRate)}% attendance recorded</small></article>
            <article className="warehouse-ops-kpi"><div className="warehouse-ops-kpi__icon is-green"><Boxes size={21} /></div><span>Total production</span><strong>{formatNumber(totalUnits)}</strong><small>{formatNumber(sum(scopedRollups, row => row.accepted_units))} accepted units</small></article>
            <article className="warehouse-ops-kpi"><div className="warehouse-ops-kpi__icon is-cyan"><Clock3 size={21} /></div><span>Total labor hours</span><strong>{formatHours(totalHours)}</strong><small>{formatHours(sum(scopedRollups, row => row.overtime_hours))} overtime</small></article>
            <article className="warehouse-ops-kpi is-accent"><div className="warehouse-ops-kpi__icon"><Gauge size={21} /></div><span>Overall efficiency</span><strong>{oneDecimal.format(weightedEfficiency)}%</strong><small>Hours-weighted company metric</small></article>
            <article className="warehouse-ops-kpi"><div className="warehouse-ops-kpi__icon is-lime"><CircleDollarSign size={21} /></div><span>Total payroll cost</span><strong>{money.format(payrollCost)}</strong><small>{pendingPayroll} approval{pendingPayroll === 1 ? '' : 's'} pending</small></article>
            <article className="warehouse-ops-kpi"><div className="warehouse-ops-kpi__icon is-orange"><AlertTriangle size={21} /></div><span>Needs attention</span><strong>{unitsNeedingAttention}</strong><small>{scopedAlerts.length} active operational alerts</small></article>
          </div>

          <nav className="warehouse-ops-tabs" aria-label="Warehouse operations sections">
            {TABS.map(item => <button key={item.key} className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>{item.label}{item.key === 'alerts' && scopedAlerts.length > 0 && <b>{scopedAlerts.length}</b>}</button>)}
          </nav>

          {tab === 'overview' && (
            <div className="warehouse-ops-dashboard-grid">
              <Section title={`Production Batches · ${formatDate(date)}`} eyebrow="Live floor control" className="is-wide" action={selectedUnit && canManage ? <button className="warehouse-ops-text-button" onClick={() => setModal('batch')}>New batch <ArrowRight size={14} /></button> : undefined}>
                {filteredBatches.length ? (
                  <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table"><thead><tr><th>Batch</th><th>Task</th><th>Team</th><th>Target</th><th>Actual</th><th>Efficiency</th><th>Status</th><th /></tr></thead><tbody>
                    {filteredBatches.slice(0, 7).map(batch => {
                      const workers = data.batchWorkers.filter(worker => worker.production_batch_id === batch.id)
                      const efficiency = batch.target_units ? (batch.actual_units - batch.rejected_units) / batch.target_units * 100 : 0
                      const order = data.productionOrders.find(item => item.id === batch.production_order_id)
                      const product = data.products.find(item => item.id === batch.product_id)
                      return <tr key={batch.id}><td><button className="warehouse-ops-batch-link" onClick={() => openBatch(batch.id)}>{batch.batch_number}</button></td><td>{taskById.get(batch.task_type_id)?.name ?? 'Task'}{order && <small>{order.order_number} · {product?.name ?? 'Production item'}</small>}</td><td>{workers.length} workers</td><td>{formatNumber(batch.target_units ?? 0)}</td><td>{formatNumber(batch.actual_units)}</td><td><span className={efficiency < 80 ? 'is-negative' : 'is-positive'}>{oneDecimal.format(efficiency)}%</span></td><td><StatusPill value={batch.status} /></td><td><div className="warehouse-ops-row-actions"><button className="warehouse-ops-row-action" onClick={() => openBatch(batch.id)}>{canManage && !['approved', 'cancelled'].includes(batch.status) ? 'Manage' : 'View'}</button>{canApprove && ['completed', 'submitted'].includes(batch.status) && <button className="warehouse-ops-row-action is-approve" onClick={() => void runAction(() => approveProductionBatch(batch.id), `${batch.batch_number} approved.`)}>Approve</button>}</div></td></tr>
                    })}
                  </tbody></table></div>
                ) : <EmptyState icon={Boxes} title="No production batches for this date" copy={selectedUnit && canManage ? 'Create a batch and allocate employees individually or by workforce group.' : 'No submitted or approved production has been recorded.'} />}
              </Section>

              <Section title="Major Alerts" eyebrow="Exceptions first" action={<button className="warehouse-ops-text-button" onClick={() => setTab('alerts')}>View all <ArrowRight size={14} /></button>}>
                {scopedAlerts.length ? <div className="warehouse-ops-alert-list">{scopedAlerts.slice(0, 5).map(alert => <button key={alert.id} onClick={() => setTab('alerts')}><span className={`is-${alert.severity}`}><AlertTriangle size={16} /></span><div><strong>{alert.title}</strong><small>{unitById.get(alert.operational_unit_id)?.name} · {alert.message}</small></div><ChevronRight size={15} /></button>)}</div> : <EmptyState icon={CheckCircle2} title="No active alerts" copy="Attendance, overtime, production and efficiency checks are clear." />}
              </Section>

              <Section title="Efficiency Trend" eyebrow="Seven-day hours-weighted average" className="is-wide">
                <TrendChart rollups={data.rollups.filter(row => inScope(row.operational_unit_id))} date={date} />
              </Section>

              <Section title="Payroll Approval" eyebrow={latestRun ? latestRun.run_number : 'Current period'}>
                {latestRun ? <PayrollWorkflow run={latestRun} /> : <EmptyState icon={BadgeDollarSign} title="No warehouse payroll run" copy={canProcessPayroll ? 'Prepare a payroll after attendance, overtime, and batches are complete.' : 'The assigned payroll officer has not prepared a run yet.'} />}
                {latestRun && <PayrollAction run={latestRun} profileRole={profile?.role} canProcess={canProcessPayroll} saving={saving} onAction={action => void runAction(() => transitionWarehousePayroll(latestRun.id, action), `Payroll ${titleCase(action)} completed.`)} />}
                {!latestRun && canProcessPayroll && <button className="warehouse-ops-wide-button" onClick={() => setModal('payroll')}>Prepare warehouse payroll <ArrowRight size={15} /></button>}
              </Section>

              <Section title="Workforce Groups" eyebrow={`${scopedGroups.length} active groups`} action={selectedUnit && canManage ? <button className="warehouse-ops-text-button" onClick={() => setModal('group')}>Create group <Plus size={14} /></button> : undefined}>
                {scopedGroups.length ? <div className="warehouse-ops-group-list">{scopedGroups.slice(0, 5).map(group => {
                  const members = data.groupMembers.filter(member => member.workforce_group_id === group.id)
                  const attendance = members.filter(member => scopedAttendance.some(row => row.employee_id === member.employee_id && ['present', 'partial'].includes(row.attendance_status))).length
                  return <div key={group.id}><span><Users size={15} /></span><div><strong>{group.name}</strong><small>{members.length} members · {titleCase(group.group_type)}</small></div><b>{members.length ? oneDecimal.format(attendance / members.length * 100) : 0}%<small>attendance</small></b></div>
                })}</div> : <EmptyState icon={Users} title="No workforce groups" copy="Create reusable task, shift, permanent, or temporary teams." />}
              </Section>

              <Section title="Top Efficiency" eyebrow={formatDate(date)} className="is-wide">
                {scopedEfficiency.length ? <div className="warehouse-ops-efficiency-list">{[...scopedEfficiency].sort((a, b) => b.efficiency_pct - a.efficiency_pct).slice(0, 6).map((row, index) => <div key={row.id}><span>{index + 1}</span><div><strong>{employeeById.get(row.employee_id)?.full_name ?? 'Employee'}</strong><small>{employeeById.get(row.employee_id)?.title ?? 'Production team'} · {formatNumber(row.attributed_units)} units</small></div><b className={row.efficiency_pct < 80 ? 'is-negative' : 'is-positive'}>{oneDecimal.format(row.efficiency_pct)}%</b>{row.trend_flag === 'improving' ? <ArrowUpRight className="is-positive" size={16} /> : row.trend_flag === 'declining' ? <ArrowDownRight className="is-negative" size={16} /> : <ArrowRight size={16} />}</div>)}</div> : <EmptyState icon={Gauge} title="No employee efficiency calculated" copy="Efficiency appears after a production batch is approved." />}
              </Section>

              <Section title="Warehouse Comparison" eyebrow="Size-independent ranking" className="is-full">
                <WarehouseRanking units={data.units} rollups={data.rollups.filter(row => row.log_date === date)} alerts={data.alerts} onSelect={unitId => setSelectedUnitId(unitId)} />
              </Section>

              <Section title="Recent Overtime Requests" eyebrow="Approval control" className="is-full" action={selectedUnit && canManage ? <button className="warehouse-ops-text-button" onClick={() => setModal('overtime')}>New request <Plus size={14} /></button> : undefined}>
                <OvertimeTable rows={scopedOvertime.slice(0, 8)} employees={employeeById} units={unitById} canDecide={canDecideOvertime} saving={saving} onDecision={(id, approved, hours) => void runAction(() => decideOvertime(id, approved, hours, approved ? undefined : 'Rejected during operational review'), `Overtime request ${approved ? 'approved' : 'rejected'}.`)} />
              </Section>
            </div>
          )}

          {tab === 'production' && (
            <div className="warehouse-ops-production-stack">
              <ProductionControl
                data={data}
                units={scopedUnits}
                selectedUnit={selectedUnit}
                query={query}
                focusedOrderId={preselectedProductionOrderId}
                canPlan={canPlanProduction}
                canManageUnit={canManageUnit}
                onFocusOrder={setPreselectedProductionOrderId}
                onCreateOrder={() => setModal('productionOrder')}
                onCreateBatch={(order, unit) => {
                  setSelectedUnitId(unit.id)
                  setPreselectedProductionOrderId(order.id)
                  setDate(order.planned_start_date ?? date)
                  setModal('batch')
                }}
                onOpenBatch={openBatch}
                onLogProduction={() => setModal('logProduction')}
                onLogDamage={() => setModal('logDamage')}
              />
              <Section title="Production Batch Register" eyebrow={`${filteredBatches.length} batches on ${formatDate(date)}`} action={selectedUnit && canManage ? <button className="warehouse-ops-primary" onClick={() => { setPreselectedProductionOrderId(''); setModal('batch') }}><Plus size={15} /> New floor batch</button> : undefined}>
              {filteredBatches.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Batch number</th><th>Warehouse</th><th>Task / standard</th><th>Workers</th><th>Accepted / rejected</th><th>Target achievement</th><th>Status</th><th /></tr></thead><tbody>{filteredBatches.map(batch => {
                const task = taskById.get(batch.task_type_id)
                const workerCount = data.batchWorkers.filter(worker => worker.production_batch_id === batch.id).length
                const order = data.productionOrders.find(item => item.id === batch.production_order_id)
                const product = data.products.find(item => item.id === batch.product_id)
                const canManageBatch = canManageUnit(batch.operational_unit_id)
                const canApproveBatch = profile?.role === 'full_access' || hasUnitRole(batch.operational_unit_id, ['regional_manager'])
                return <tr key={batch.id}><td><button className="warehouse-ops-batch-link" onClick={() => openBatch(batch.id)}>{batch.batch_number}</button><small>{formatDate(batch.production_date)}</small></td><td>{unitById.get(batch.operational_unit_id)?.name}</td><td>{task?.name ?? 'Task'}<small>{order ? `${order.order_number} · ${product?.name ?? 'Production item'}` : task?.standard_units_per_hour ? `${task.standard_units_per_hour} units/hour` : 'Operational-only batch'}</small></td><td>{workerCount}</td><td>{formatNumber(batch.actual_units - batch.rejected_units)}<small>{formatNumber(batch.rejected_units)} rejected</small></td><td>{oneDecimal.format(batch.target_units ? (batch.actual_units - batch.rejected_units) / batch.target_units * 100 : 0)}%</td><td><StatusPill value={batch.status} /></td><td><div className="warehouse-ops-row-actions"><button className="warehouse-ops-row-action" onClick={() => openBatch(batch.id)}>{canManageBatch && !['approved', 'cancelled'].includes(batch.status) ? 'Manage' : 'View'}</button>{canApproveBatch && ['completed', 'submitted'].includes(batch.status) && <button className="warehouse-ops-row-action is-approve" onClick={() => void runAction(() => approveProductionBatch(batch.id), `${batch.batch_number} approved.`)}>Approve</button>}</div></td></tr>
              })}</tbody></table></div> : <EmptyState title="No production for the selected date" copy="Choose another date or create the first production batch." />}
              </Section>
            </div>
          )}

          {tab === 'workforce' && (
            <div className="warehouse-ops-two-column">
              <Section title="Employees & Groups" eyebrow={`${filteredEmployees.length} active employees`} className="is-wide" action={selectedUnit && canManage ? <button className="warehouse-ops-primary" onClick={() => setModal('group')}><Plus size={15} /> Create group</button> : undefined}>
                {filteredEmployees.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Employee</th><th>Employment</th><th>Operational unit</th><th>Groups</th><th>Attendance</th><th>Efficiency</th></tr></thead><tbody>{filteredEmployees.map(employee => {
                  const memberships = data.groupMembers.filter(member => member.employee_id === employee.id).map(member => data.groups.find(group => group.id === member.workforce_group_id)?.name).filter(Boolean)
                  const attendance = scopedAttendance.find(row => row.employee_id === employee.id)
                  const efficiency = scopedEfficiency.find(row => row.employee_id === employee.id)
                  return <tr key={employee.id}><td><strong>{employee.full_name}</strong><small>{employee.title ?? employee.department ?? 'Employee'}</small></td><td>{titleCase(employee.employment_type)}</td><td>{unitById.get(employee.operational_unit_id)?.name}</td><td>{memberships.join(', ') || 'Unassigned'}</td><td>{attendance ? <StatusPill value={attendance.attendance_status} /> : <span className="warehouse-ops-muted">Not recorded</span>}</td><td>{efficiency ? `${oneDecimal.format(efficiency.efficiency_pct)}%` : '—'}</td></tr>
                })}</tbody></table></div> : <EmptyState icon={Users} title="No employees in this scope" copy="Assign employees to a warehouse in the HR employee master." />}
              </Section>
              <Section title="Active Groups" eyebrow="Reusable allocation">
                {scopedGroups.length ? <div className="warehouse-ops-group-cards">{scopedGroups.map(group => {
                  const members = data.groupMembers.filter(member => member.workforce_group_id === group.id)
                  return <article key={group.id}><div><Users size={18} /></div><strong>{group.name}</strong><span>{titleCase(group.group_type)}</span><b>{members.length}<small>members</small></b></article>
                })}</div> : <EmptyState icon={Layers3} title="No workforce groups" copy="Groups make production allocation faster without merging employee records." />}
              </Section>
            </div>
          )}

          {tab === 'attendance' && (
            <Section title="Daily Attendance" eyebrow={`${formatDate(date)} · ${oneDecimal.format(todayAttendanceRate)}% recorded present`} action={selectedUnit && canManage ? <button className="warehouse-ops-primary" onClick={() => setModal('attendance')}><Plus size={15} /> Record attendance</button> : undefined}>
              {scopedEmployees.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Employee</th><th>Warehouse</th><th>Status</th><th>Regular hours</th><th>Raw OT</th><th>Approved OT</th><th>Source</th></tr></thead><tbody>{filteredEmployees.map(employee => {
                const row = scopedAttendance.find(item => item.employee_id === employee.id)
                return <tr key={employee.id}><td><strong>{employee.full_name}</strong><small>{employee.title ?? employee.employment_type}</small></td><td>{unitById.get(employee.operational_unit_id)?.name}</td><td>{row ? <StatusPill value={row.attendance_status} /> : <StatusPill value="pending" />}</td><td>{row ? formatHours(row.regular_hours) : '—'}</td><td>{row ? formatHours(row.raw_overtime_hours) : '—'}</td><td>{row ? formatHours(row.approved_overtime_hours) : '—'}</td><td>{row ? titleCase(row.source) : 'Not recorded'}</td></tr>
              })}</tbody></table></div> : <EmptyState icon={UserCheck} title="No employees to record" copy="Employees appear here after assignment to an operational warehouse." />}
            </Section>
          )}

          {tab === 'overtime' && (
            <Section title="Overtime Requests" eyebrow="Submission and independent approval" action={selectedUnit && canManage ? <button className="warehouse-ops-primary" onClick={() => setModal('overtime')}><Plus size={15} /> Request overtime</button> : undefined}>
              <OvertimeTable rows={scopedOvertime} employees={employeeById} units={unitById} canDecide={canDecideOvertime} saving={saving} onDecision={(id, approved, hours) => void runAction(() => decideOvertime(id, approved, hours, approved ? undefined : 'Rejected during operational review'), `Overtime request ${approved ? 'approved' : 'rejected'}.`)} />
            </Section>
          )}

          {tab === 'efficiency' && (
            <div className="warehouse-ops-two-column">
              <Section title="Warehouse Efficiency Comparison" eyebrow="Hours-weighted ranking" className="is-wide">
                <WarehouseRanking units={data.units} rollups={data.rollups.filter(row => row.log_date === date)} alerts={data.alerts} onSelect={unitId => setSelectedUnitId(unitId)} />
              </Section>
              <Section title="Efficiency Formula" eyebrow="Standard method">
                <div className="warehouse-ops-formula"><Sparkles size={20} /><strong>Σ(Employee efficiency × hours)</strong><span>÷</span><strong>Σ(Employee hours)</strong><p>Part-time and short-shift employees do not distort the warehouse comparison.</p></div>
              </Section>
              <Section title="Employee Performance" eyebrow={`${formatDate(date)} · rolling seven-day context`} className="is-full">
                {scopedEfficiency.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Employee</th><th>Unit</th><th>Units</th><th>Regular / OT</th><th>Earned hours</th><th>Efficiency</th><th>7-day average</th><th>Trend</th></tr></thead><tbody>{[...scopedEfficiency].sort((a, b) => b.efficiency_pct - a.efficiency_pct).map(row => <tr key={row.id}><td><strong>{employeeById.get(row.employee_id)?.full_name ?? 'Employee'}</strong></td><td>{unitById.get(row.operational_unit_id)?.name}</td><td>{formatNumber(row.attributed_units)}</td><td>{formatHours(row.regular_hours)} / {formatHours(row.overtime_hours)}</td><td>{formatHours(row.earned_hours)}</td><td><strong className={row.efficiency_pct < 80 ? 'is-negative' : 'is-positive'}>{oneDecimal.format(row.efficiency_pct)}%</strong></td><td>{oneDecimal.format(row.rolling_avg_7d)}%</td><td><StatusPill value={row.trend_flag} /></td></tr>)}</tbody></table></div> : <EmptyState icon={Activity} title="No efficiency results for this date" copy="Approving a production batch calculates worker, warehouse, and cross-warehouse efficiency together." />}
              </Section>
            </div>
          )}

          {tab === 'payroll' && (
            <div className="warehouse-ops-two-column">
              <div className="warehouse-ops-payroll-metrics" aria-label="Warehouse payroll totals">
                <article><span>Employees included</span><strong>{latestRun ? formatNumber(latestRun.employee_count) : '—'}</strong><small>Calculation snapshots</small></article>
                <article><span>Gross payroll</span><strong>{latestRun ? money.format(latestRun.gross_amount) : '—'}</strong><small>Regular, overtime and incentive</small></article>
                <article><span>Overtime cost</span><strong>{latestRun ? money.format(latestRun.overtime_amount) : '—'}</strong><small>Approved requests only</small></article>
                <article><span>Production incentive</span><strong>{latestRun ? money.format(latestRun.incentive_amount) : '—'}</strong><small>Approved batch output</small></article>
                <article><span>Total deductions</span><strong>{latestRun ? money.format(latestRun.deduction_amount + latestRun.tax_amount + latestRun.pension_amount) : '—'}</strong><small>Tax, pension and other</small></article>
                <article className="is-accent"><span>Net payroll</span><strong>{latestRun ? money.format(latestRun.net_amount) : '—'}</strong><small>Employee payroll payable</small></article>
                <article className="is-dark"><span>Accounting expense</span><strong>{latestRun ? money.format(latestRun.gross_amount + latestRun.employer_pension_amount) : '—'}</strong><small>Summarized journal debit</small></article>
              </div>
              <Section title="Consolidated Payroll Summary" eyebrow="Operational detail, accounting summary" className="is-wide" action={
                <div className="warehouse-ops-section-actions">
                  <Link to="/payroll" className="warehouse-ops-secondary"><WalletCards size={15} /> Open system Payroll</Link>
                  {latestRun && <button className="warehouse-ops-secondary" onClick={() => downloadPayrollReport(latestRun, data.payrollEmployees, employeeById, unitById.get(latestRun.operational_unit_id)?.name ?? 'Warehouse')}><FileDown size={15} /> Export report</button>}
                  {selectedUnit && canProcessPayroll && <button className="warehouse-ops-primary" onClick={() => setModal('payroll')}><Plus size={15} /> Prepare payroll</button>}
                </div>
              }>
                {scopedPayroll.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Payroll run</th><th>Warehouse</th><th>Period</th><th>Employees</th><th>Gross</th><th>OT</th><th>Net</th><th>Status</th></tr></thead><tbody>{scopedPayroll.map(run => <tr key={run.id}><td><strong>{run.run_number}</strong></td><td>{unitById.get(run.operational_unit_id)?.name}</td><td>{formatDate(run.period_start)} – {formatDate(run.period_end)}</td><td>{run.employee_count}</td><td>{money.format(run.gross_amount)}</td><td>{money.format(run.overtime_amount)}</td><td>{money.format(run.net_amount)}</td><td><StatusPill value={run.status} /></td></tr>)}</tbody></table></div> : <EmptyState icon={CircleDollarSign} title="No payroll runs in this scope" copy="Warehouse managers prepare and review; HR and Finance retain final approval and posting control." />}
              </Section>
              <Section title="Approval Workflow" eyebrow={latestRun?.run_number ?? 'No active run'}>
                {latestRun ? <><PayrollWorkflow run={latestRun} /><PayrollAction run={latestRun} profileRole={profile?.role} canProcess={canProcessPayroll} saving={saving} onAction={action => void runAction(() => transitionWarehousePayroll(latestRun.id, action), `Payroll ${titleCase(action)} completed.`)} /></> : <EmptyState icon={ShieldCheck} title="Waiting for preparation" copy="The workflow begins after the payroll validation passes." />}
              </Section>
              {latestRun && <Section title="Employee Payroll Detail" eyebrow={`${latestRun.employee_count} calculation snapshots`} className="is-full" action={<button className="warehouse-ops-text-button" onClick={() => downloadPayrollReport(latestRun, data.payrollEmployees, employeeById, unitById.get(latestRun.operational_unit_id)?.name ?? 'Warehouse')}>Download CSV <FileDown size={14} /></button>}>
                <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Employee</th><th>Days</th><th>Regular pay</th><th>OT hours / pay</th><th>Incentive</th><th>Tax</th><th>Pension</th><th>Net pay</th></tr></thead><tbody>{data.payrollEmployees.filter(item => item.payroll_run_id === latestRun.id).map(item => <tr key={item.id}><td><strong>{employeeById.get(item.employee_id)?.full_name ?? 'Employee'}</strong></td><td>{oneDecimal.format(item.days_worked)}</td><td>{money.format(item.regular_pay)}</td><td>{oneDecimal.format(item.overtime_hours)} h<small>{money.format(item.overtime_pay)}</small></td><td>{money.format(item.production_incentive)}</td><td>{money.format(item.tax)}</td><td>{money.format(item.pension_employee)}</td><td><strong>{money.format(item.net_pay)}</strong></td></tr>)}</tbody></table></div>
              </Section>}
              {latestAccountingBatch && <Section title="Accounting Posting Result" eyebrow="Summarized journal · no employee detail" className="is-full">
                <div className="warehouse-ops-accounting-result">
                  <div><span><Landmark size={19} /></span><p>Journal batch<strong>{latestAccountingBatch.journal_batch_number}</strong></p></div>
                  <p>Total debit<strong>{money.format(latestAccountingBatch.total_debit)}</strong></p>
                  <p>Total credit<strong>{money.format(latestAccountingBatch.total_credit)}</strong></p>
                  <p>Posting status<StatusPill value={latestAccountingBatch.posting_status} /></p>
                </div>
              </Section>}
            </div>
          )}

          {tab === 'dailyReport' && (
            <DailyReportTab
              report={dailyReport}
              units={data.units}
              selectedUnit={selectedUnit}
              date={date}
              employees={data.employees}
            />
          )}

          {tab === 'alerts' && (
            <Section title="Operational Alert Center" eyebrow={`${scopedAlerts.length} unresolved exceptions`} action={<button className="warehouse-ops-secondary" onClick={() => void refreshAll()} disabled={saving}><RefreshCw size={15} /> Run checks</button>}>
              {scopedAlerts.length ? <div className="warehouse-ops-alert-register">{scopedAlerts.map(alert => <article key={alert.id}><span className={`is-${alert.severity}`}><AlertTriangle size={18} /></span><div><div><StatusPill value={alert.severity} /><small>{formatDate(alert.alert_date)}</small></div><strong>{alert.title}</strong><p>{alert.message}</p><small>{unitById.get(alert.operational_unit_id)?.name}</small></div>{selectedUnit && (canManage || canApprove) && <button onClick={() => void runAction(() => resolveOperationalAlert(alert.id), 'Alert resolved.')}>Resolve <Check size={14} /></button>}</article>)}</div> : <EmptyState icon={CheckCircle2} title="All operational checks are clear" copy="There are no unresolved attendance, overtime, batch, payroll, rejection, or efficiency exceptions." />}
            </Section>
          )}
        </>
      )}

      {modal === 'batch' && selectedUnit && canManage && <Modal eyebrow={selectedUnit.name} title="Create Production Batch" onClose={() => { setModal(null); setPreselectedProductionOrderId('') }}><BatchForm unit={selectedUnit} data={data} date={date} saving={saving} initialProductionOrderId={preselectedProductionOrderId} onSave={input => runAction(() => createProductionBatch(input).then(() => undefined), input.status === 'draft' ? 'Production batch saved as a draft.' : 'Production posted to inventory.', true)} /></Modal>}
      {modal === 'productionOrder' && selectedUnit && canPlanProduction && <Modal eyebrow={selectedUnit.name} title="Create Production Order" onClose={() => setModal(null)}><ProductionOrderForm unit={selectedUnit} data={data} date={date} saving={saving} onSave={input => runAction(() => createWarehouseProductionOrder(input).then(orderId => { setPreselectedProductionOrderId(orderId) }), 'Production order created and added to the warehouse plan queue.', true, true)} /></Modal>}
      {modal === 'batchDetail' && selectedBatch && <Modal wide eyebrow={unitById.get(selectedBatch.operational_unit_id)?.name ?? 'Production control'} title={selectedBatch.batch_number} onClose={() => { setModal(null); setSelectedBatchId(null) }}><BatchDetail batch={selectedBatch} data={data} canManage={canManageSelectedBatch} canApprove={canApproveSelectedBatch} saving={saving} onTransition={input => runAction(() => transitionProductionBatch(input), input.action === 'start' ? 'Production batch started.' : input.action === 'cancel' ? 'Production batch cancelled.' : 'Production posted to inventory.', true)} onApprove={() => runAction(() => approveProductionBatch(selectedBatch.id), `${selectedBatch.batch_number} approved.`, true)} /></Modal>}
      {modal === 'group' && selectedUnit && <Modal eyebrow={selectedUnit.name} title="Create Workforce Group" onClose={() => setModal(null)}><GroupForm unit={selectedUnit} employees={data.employees.filter(employee => employee.operational_unit_id === selectedUnit.id)} saving={saving} onSave={input => runAction(() => createWorkforceGroup(input), 'Workforce group created.', true)} /></Modal>}
      {modal === 'attendance' && selectedUnit && <Modal wide eyebrow={selectedUnit.name} title="Attendance Control" onClose={() => setModal(null)}><AttendanceWorkspace unit={selectedUnit} employees={data.employees.filter(employee => employee.operational_unit_id === selectedUnit.id)} shifts={data.shifts.filter(shift => shift.operational_unit_id === selectedUnit.id)} attendance={data.attendance.filter(row => row.operational_unit_id === selectedUnit.id && row.attendance_date === date)} date={date} saving={saving} onSaveSingle={input => runAction(() => saveAttendance(input), 'Attendance saved.', true)} onSaveBulk={inputs => runAction(() => saveAttendanceBatch(inputs), `${inputs.length} attendance records saved.`, true)} /></Modal>}
      {modal === 'overtime' && selectedUnit && <Modal eyebrow={selectedUnit.name} title="Submit Overtime Request" onClose={() => setModal(null)}><OvertimeForm unit={selectedUnit} employees={data.employees.filter(employee => employee.operational_unit_id === selectedUnit.id)} types={data.overtimeTypes} batches={data.batches.filter(batch => batch.operational_unit_id === selectedUnit.id)} date={date} saving={saving} onSave={input => runAction(() => submitOvertime(input), 'Overtime request submitted.', true)} /></Modal>}
      {modal === 'payroll' && selectedUnit && <Modal eyebrow={selectedUnit.name} title="Prepare Warehouse Payroll" onClose={() => setModal(null)}><PayrollForm unit={selectedUnit} date={date} saving={saving} onSave={(start, end) => runAction(() => prepareWarehousePayroll(selectedUnit.id, start, end).then(() => undefined), 'Payroll calculated and ready for review.', true)} /></Modal>}
      {modal === 'logProduction' && selectedUnit && <Modal wide eyebrow={selectedUnit.name} title="Log Production" onClose={() => setModal(null)}><QuickLogForm unit={selectedUnit} data={data} date={date} employees={scopedEmployees} managedBatchFor={managedBatchFor} saving={saving} onSave={input => runAction(() => submitQuickLog(input), 'Production logged.', true)} /></Modal>}
      {modal === 'logDamage' && selectedUnit && <Modal eyebrow={selectedUnit.name} title="Log Damage" onClose={() => setModal(null)}><DamageForm products={data.products} shipments={shipments} date={date} saving={saving} onSave={input => runAction(() => submitDamageReport(input), 'Damage logged.', true)} /></Modal>}
    </div>
  )
}

function WarehouseRanking({
  units, rollups, alerts, onSelect,
}: {
  units: OperationalUnit[]
  rollups: UnitDailyRollup[]
  alerts: WarehouseOperationsData['alerts']
  onSelect: (unitId: string) => void
}) {
  const ranked = units.map(unit => {
    const row = rollups.find(item => item.operational_unit_id === unit.id)
    return { unit, row, alerts: alerts.filter(alert => alert.operational_unit_id === unit.id && !alert.is_resolved).length }
  }).sort((a, b) => (b.row?.avg_efficiency_pct ?? 0) - (a.row?.avg_efficiency_pct ?? 0))
  if (!ranked.some(item => item.row)) return <EmptyState icon={Gauge} title="No comparable warehouse results" copy="Approve batches in at least one warehouse to populate size-independent rankings." />
  return (
    <div className="warehouse-ops-ranking">
      <div className="warehouse-ops-ranking__head"><span>Rank / warehouse</span><span>Labor hours</span><span>Output / hour</span><span>Efficiency</span></div>
      {ranked.map((item, index) => {
        const efficiency = item.row?.avg_efficiency_pct ?? 0
        return (
          <button key={item.unit.id} onClick={() => onSelect(item.unit.id)}>
            <div className="warehouse-ops-ranking__name"><b>{index + 1}</b><span><strong>{item.unit.name}</strong><small>{titleCase(item.unit.unit_type)} · {item.alerts} alerts</small></span></div>
            <span>{formatHours((item.row?.regular_hours ?? 0) + (item.row?.overtime_hours ?? 0))}</span>
            <span>{oneDecimal.format(item.row?.output_per_labor_hour ?? 0)}</span>
            <div className="warehouse-ops-ranking__bar"><i><b style={{ width: `${Math.min(100, efficiency)}%` }} /></i><strong>{oneDecimal.format(efficiency)}%</strong></div>
          </button>
        )
      })}
    </div>
  )
}

function OvertimeTable({
  rows, employees, units, canDecide, saving, onDecision,
}: {
  rows: WarehouseOperationsData['overtime']
  employees: Map<string, OperationalEmployee>
  units: Map<string, OperationalUnit>
  canDecide: boolean
  saving: boolean
  onDecision: (id: string, approved: boolean, hours: number) => void
}) {
  if (!rows.length) return <EmptyState icon={Clock3} title="No overtime requests" copy="Submitted overtime will appear here for an independent approval decision." />
  return <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table is-roomy"><thead><tr><th>Employee</th><th>Date / warehouse</th><th>Requested</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{employees.get(row.employee_id)?.full_name ?? 'Employee'}</strong><small>{employees.get(row.employee_id)?.title ?? 'Operations'}</small></td><td>{formatDate(row.overtime_date)}<small>{units.get(row.operational_unit_id)?.name}</small></td><td>{formatHours(row.requested_hours)}{row.approved_hours != null && <small>{formatHours(row.approved_hours)} approved</small>}</td><td>{row.reason}</td><td><StatusPill value={row.status} /></td><td>{canDecide && row.status === 'submitted' && <div className="warehouse-ops-decision"><button disabled={saving} onClick={() => onDecision(row.id, true, row.requested_hours)}>Approve</button><button disabled={saving} onClick={() => onDecision(row.id, false, 0)}>Reject</button></div>}</td></tr>)}</tbody></table></div>
}

function PayrollWorkflow({ run }: { run: WarehousePayrollRun }) {
  const statuses: Array<{ key: WarehousePayrollRun['status']; label: string; copy: string }> = [
    { key: 'calculated', label: 'Prepared & reviewed', copy: 'Warehouse / payroll officer' },
    { key: 'submitted', label: 'HR approval', copy: 'Independent validation' },
    { key: 'hr_approved', label: 'Finance approval', copy: 'Accounting control' },
    { key: 'finance_approved', label: 'Accounting posting', copy: 'Summarized journal' },
  ]
  const indexByStatus: Record<string, number> = { draft: -1, calculated: 0, submitted: 1, hr_approved: 2, finance_approved: 3, posted: 4, paid: 4, rejected: -1 }
  const activeIndex = indexByStatus[run.status] ?? -1
  return <div className="warehouse-ops-workflow">{statuses.map((item, index) => <div key={item.key} className={index < activeIndex || activeIndex >= 4 ? 'is-complete' : index === activeIndex ? 'is-current' : ''}><span>{index < activeIndex || activeIndex >= 4 ? <Check size={13} /> : index + 1}</span><div><strong>{item.label}</strong><small>{item.copy}</small></div></div>)}</div>
}

function PayrollAction({
  run, profileRole, canProcess, saving, onAction,
}: {
  run: WarehousePayrollRun
  profileRole?: string
  canProcess: boolean
  saving: boolean
  onAction: (action: 'submit' | 'hr_approve' | 'finance_approve' | 'post' | 'reject') => void
}) {
  let action: 'submit' | 'hr_approve' | 'finance_approve' | 'post' | null = null
  let label = ''
  if (run.status === 'calculated' && canProcess) { action = 'submit'; label = 'Submit to HR' }
  if (run.status === 'submitted' && (profileRole === 'hr_system' || profileRole === 'full_access')) { action = 'hr_approve'; label = 'Approve as HR' }
  if (run.status === 'hr_approved' && (profileRole === 'accounting_finance' || profileRole === 'full_access')) { action = 'finance_approve'; label = 'Approve as Finance' }
  if (run.status === 'finance_approved' && (profileRole === 'accounting_finance' || profileRole === 'full_access')) { action = 'post'; label = 'Post accounting journal' }
  if (!action) return null
  const nextAction = action
  const canReject = profileRole === 'full_access'
    || (run.status === 'submitted' && profileRole === 'hr_system')
    || (run.status === 'hr_approved' && profileRole === 'accounting_finance')
  return <div className="warehouse-ops-payroll-actions">
    <button className="warehouse-ops-wide-button" disabled={saving} onClick={() => onAction(nextAction)}>{saving ? <Loader2 size={15} className="animate-spin" /> : <BriefcaseBusiness size={15} />}{label}<ArrowRight size={15} /></button>
    {canReject && <button className="warehouse-ops-reject-button" disabled={saving} onClick={() => onAction('reject')}>Reject payroll</button>}
  </div>
}

function QuickLogForm({
  unit, data, date, employees, managedBatchFor, saving, onSave,
}: {
  unit: OperationalUnit
  data: WarehouseOperationsData
  date: string
  employees: OperationalEmployee[]
  managedBatchFor: (bomHeaderId: string, unitId: string, productionDate: string) => ProductionBatch | null
  saving: boolean
  onSave: (input: { logDate: string; notes: string; employeeId: string; entries: { bomId: string; quantity: number }[] }) => Promise<void>
}) {
  const [logDate, setLogDate] = useState(date)
  const [notes, setNotes] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [bomQuery, setBomQuery] = useState('')

  const boms = data.boms.filter(bom => bom.is_active)
  const filteredBoms = boms.filter(bom => {
    const product = data.products.find(item => item.id === (bom.finished_product_id ?? bom.product_id))
    return !bomQuery || (product?.name ?? bom.name).toLowerCase().includes(bomQuery.toLowerCase())
  })
  const entries = Object.entries(quantities)
    .map(([bomId, value]) => ({ bomId, quantity: Number(value) }))
    .filter(entry => entry.quantity > 0)

  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({ logDate, notes, employeeId, entries })
    }}>
      <div className="warehouse-ops-form__grid">
        <label>Log date<input required type="date" value={logDate} onChange={event => setLogDate(event.target.value)} /></label>
        <label>Worker (optional)<SelectMenu ariaLabel="Production worker" searchable value={employeeId} onChange={setEmployeeId} options={[
          { value: '', label: 'Not attributed to one worker', description: 'Use a floor batch for team allocation' },
          ...employees.map(employee => ({ value: employee.id, label: employee.full_name, description: employee.title ?? titleCase(employee.employment_type) })),
        ]} /></label>
      </div>
      {boms.length > 6 && <label className="warehouse-ops-search"><Search size={14} /><input value={bomQuery} onChange={event => setBomQuery(event.target.value)} placeholder="Search products…" /></label>}
      <div className="warehouse-ops-form__selection">
        <div className="warehouse-ops-form__selection-head"><strong>Output by product</strong><span>Leave a product at 0 to skip it.</span></div>
        {filteredBoms.length === 0 ? <EmptyState icon={Package} title="No active BOMs" copy="Add one under BOMs before logging production." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredBoms.map(bom => {
              const product = data.products.find(item => item.id === (bom.finished_product_id ?? bom.product_id))
              const managedBatch = managedBatchFor(bom.id, unit.id, logDate)
              const estimate = computeMaxProducible(data.bomLines, data.inventory, bom.id, unit.warehouse_id ?? '')
              return (
                <div key={bom.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--wo-panel-alt, rgba(0,0,0,0.03))' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{product?.name ?? bom.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{titleCase(bom.stage)}{estimate.maxUnits !== null && ` · stock allows up to ${formatNumber(estimate.maxUnits)} today`}</div>
                    {managedBatch && <div className="is-negative" style={{ fontSize: 11 }}>Managed by floor batch {managedBatch.batch_number} ({managedBatch.status}) — log there instead</div>}
                  </div>
                  <input
                    type="number" min="0" step="1" disabled={Boolean(managedBatch)}
                    value={quantities[bom.id] ?? ''}
                    onChange={event => setQuantities(current => ({ ...current, [bom.id]: event.target.value }))}
                    placeholder="0"
                    style={{ width: 90, flexShrink: 0 }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
      <label>Notes<textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional production notes" /></label>
      <div className="warehouse-ops-form__footer">
        <span>{entries.length} product{entries.length === 1 ? '' : 's'} will be logged.</span>
        <div className="warehouse-ops-form__actions">
          <button type="submit" className="warehouse-ops-primary" disabled={saving || entries.length === 0}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />} Save
          </button>
        </div>
      </div>
    </form>
  )
}

function DamageForm({
  products, shipments, date, saving, onSave,
}: {
  products: WarehouseOperationsData['products']
  shipments: Array<{ id: string; shipment_number: string }>
  date: string
  saving: boolean
  onSave: (input: { productId: string; quantity: number; reason: string; shipmentId: string; reportDate: string }) => Promise<void>
}) {
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [shipmentId, setShipmentId] = useState('')
  const [reportDate, setReportDate] = useState(date)

  return (
    <form className="warehouse-ops-form" onSubmit={event => {
      event.preventDefault()
      void onSave({ productId, quantity: Number(quantity), reason, shipmentId, reportDate })
    }}>
      <label>Item<SelectMenu ariaLabel="Damaged product" searchable value={productId} onChange={setProductId} options={products
        .map(product => ({ value: product.id, label: product.name, description: product.sku }))} /></label>
      <div className="warehouse-ops-form__grid">
        <label>Quantity<input required min="1" step="1" type="number" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Date<input required type="date" value={reportDate} onChange={event => setReportDate(event.target.value)} /></label>
      </div>
      <label>Reason<input required value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. crushed carton, water damage on arrival" /></label>
      <label>From shipment (optional)<SelectMenu ariaLabel="Damage shipment" searchable value={shipmentId} onChange={setShipmentId} options={[
        { value: '', label: 'Not linked', description: 'General warehouse damage' },
        ...shipments.map(shipment => ({ value: shipment.id, label: shipment.shipment_number })),
      ]} /></label>
      <div className="warehouse-ops-form__footer">
        <span />
        <div className="warehouse-ops-form__actions">
          <button type="submit" className="warehouse-ops-primary" disabled={saving || !productId || !quantity || !reason.trim()}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />} Log damage
          </button>
        </div>
      </div>
    </form>
  )
}

function DailyReportTab({
  report, units, selectedUnit, date, employees,
}: {
  report: ProductionDailyReportData
  units: OperationalUnit[]
  selectedUnit: OperationalUnit | null
  date: string
  employees: OperationalEmployee[]
}) {
  const employeeById = new Map(employees.map(employee => [employee.id, employee.full_name]))
  const warehouseIds = selectedUnit
    ? new Set([selectedUnit.warehouse_id].filter(Boolean))
    : new Set(units.map(unit => unit.warehouse_id).filter(Boolean))
  const logs = report.logs.filter(log => !log.warehouseId || warehouseIds.has(log.warehouseId))
  const todayLogs = logs.filter(log => log.logDate === date)
  const totalToday = sum(todayLogs, log => log.quantityProduced)
  const withdrawals = report.movements.filter(m => m.movementType === 'PRODUCTION_CONSUMED')
  const outputs = report.movements.filter(m => m.movementType === 'PRODUCTION_OUTPUT')
  const salesMoves = report.movements.filter(m => m.movementType === 'SALE')

  const byWarehouse = new Map<string, { name: string; units: number; effSum: number; effCount: number }>()
  for (const log of logs) {
    const id = log.warehouseId ?? 'unknown'
    const entry = byWarehouse.get(id) ?? { name: log.warehouseName, units: 0, effSum: 0, effCount: 0 }
    entry.units += log.quantityProduced
    if (log.capacityRate && log.capacityRate > 0) { entry.effSum += (log.quantityProduced / log.capacityRate) * 100; entry.effCount += 1 }
    byWarehouse.set(id, entry)
  }
  const warehouseRows = [...byWarehouse.values()].sort((a, b) => b.units - a.units)

  const byEmployee = new Map<string, { units: number; days: Set<string> }>()
  for (const log of logs.filter(item => item.employeeId)) {
    const id = log.employeeId as string
    const entry = byEmployee.get(id) ?? { units: 0, days: new Set<string>() }
    entry.units += log.quantityProduced
    entry.days.add(log.logDate)
    byEmployee.set(id, entry)
  }
  const employeeRows = [...byEmployee.entries()].sort((a, b) => b[1].units - a[1].units)

  return (
    <div className="warehouse-ops-two-column">
      <div className="warehouse-ops-kpis is-full">
        <article className="warehouse-ops-kpi"><span>Produced today</span><strong>{formatNumber(totalToday)}</strong><small>units</small></article>
        <article className="warehouse-ops-kpi"><span>Sales today</span><strong>{money.format(report.salesToday)}</strong></article>
        <article className="warehouse-ops-kpi"><span>Withdrawals (30d)</span><strong>{formatNumber(withdrawals.length)}</strong></article>
        <article className="warehouse-ops-kpi"><span>Damage reports (30d)</span><strong>{formatNumber(report.damageReports.length)}</strong></article>
      </div>

      <Section title="Efficiency by warehouse" eyebrow="Last 30 days, raw production logs">
        {warehouseRows.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table"><thead><tr><th>Warehouse</th><th>Efficiency</th><th>Units</th></tr></thead><tbody>{warehouseRows.map(row => <tr key={row.name}><td>{row.name}</td><td>{row.effCount > 0 ? <StatusPill value={row.effSum / row.effCount >= 100 ? 'success' : row.effSum / row.effCount >= 70 ? 'warning' : 'danger'} /> : '—'}{row.effCount > 0 && ` ${oneDecimal.format(row.effSum / row.effCount)}%`}</td><td>{formatNumber(row.units)}</td></tr>)}</tbody></table></div> : <EmptyState icon={Activity} title="No production logged" copy="Production logged in the last 30 days will appear here." />}
      </Section>

      <Section title="Output by worker" eyebrow="Last 30 days">
        {employeeRows.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table"><thead><tr><th>Worker</th><th>Units</th><th>Days</th><th>Avg/day</th></tr></thead><tbody>{employeeRows.map(([employeeId, entry]) => <tr key={employeeId}><td>{employeeById.get(employeeId) ?? 'Unknown worker'}</td><td>{formatNumber(entry.units)}</td><td>{entry.days.size}</td><td>{formatNumber(entry.units / entry.days.size)}</td></tr>)}</tbody></table></div> : <EmptyState icon={Users} title="No logs attributed to a worker" copy="Pick a worker in Log Production to start tracking this." />}
      </Section>

      <Section title="Damage reports" eyebrow={`${report.damageReports.length} in the last 50 records`} className="is-full">
        {report.damageReports.length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table"><thead><tr><th>Date</th><th>Report</th><th>Quantity</th><th>Reason</th></tr></thead><tbody>{report.damageReports.map(item => <tr key={item.id}><td>{formatDate(item.report_date)}</td><td>{item.report_number}</td><td className="is-negative">-{formatNumber(item.quantity)}</td><td>{item.reason}</td></tr>)}</tbody></table></div> : <EmptyState icon={ShieldAlert} title="No damage logged" copy="Damage reports post a DAMAGE inventory movement automatically." />}
      </Section>

      <Section title="Warehouse withdrawals & sales" eyebrow="Last 30 days" className="is-full">
        {[...withdrawals, ...outputs, ...salesMoves].length ? <div className="warehouse-ops-table-wrap"><table className="warehouse-ops-table"><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Quantity</th></tr></thead><tbody>{[...withdrawals, ...outputs, ...salesMoves].sort((a, b) => b.movementDate.localeCompare(a.movementDate)).map(movement => <tr key={movement.id}><td>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(movement.movementDate))}</td><td>{movement.productName}</td><td>{titleCase(movement.movementType)}</td><td className={movement.quantity < 0 ? 'is-negative' : 'is-positive'}>{movement.quantity > 0 ? '+' : ''}{formatNumber(movement.quantity)}</td></tr>)}</tbody></table></div> : <EmptyState icon={Boxes} title="No movements recorded" copy="Withdrawals, outputs and sales will appear here." />}
      </Section>
    </div>
  )
}

export default WarehouseOperations
