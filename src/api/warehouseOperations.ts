import { supabase } from '../lib/supabase'

export type UnitAccessRole = 'regional_manager' | 'warehouse_manager' | 'payroll_officer' | 'viewer'
export type BatchStatus = 'draft' | 'active' | 'completed' | 'submitted' | 'approved' | 'cancelled'
export type AttendanceStatus = 'present' | 'absent' | 'partial' | 'leave' | 'sick'
export type PayrollRunStatus =
  | 'draft' | 'calculated' | 'submitted' | 'hr_approved'
  | 'finance_approved' | 'posted' | 'paid' | 'rejected'

export interface OperationalUnit {
  id: string
  warehouse_id: string | null
  company_id: string | null
  cost_center_id: string | null
  name: string
  code: string
  unit_type: 'warehouse' | 'factory' | 'distribution_center'
  is_active: boolean
}

export interface OperationalCompany {
  id: string
  name: string
  is_primary: boolean
}

export interface UnitAssignment {
  id: string
  profile_id: string
  operational_unit_id: string | null
  access_role: UnitAccessRole
  effective_from: string
  effective_to: string | null
}

export interface OperationalEmployee {
  id: string
  full_name: string
  department: string | null
  title: string | null
  warehouse_id: string | null
  employment_type: string
  operational_unit_id: string
}

export interface WorkforceGroup {
  id: string
  operational_unit_id: string
  name: string
  group_type: 'permanent' | 'temporary' | 'shift' | 'task_team'
  supervisor_employee_id: string | null
  is_active: boolean
}

export interface WorkforceGroupMember {
  id: string
  workforce_group_id: string
  employee_id: string
  role_in_group: string | null
  allocation_pct: number
  is_active: boolean
}

export interface OperationalShift {
  id: string
  operational_unit_id: string
  name: string
  start_time: string
  end_time: string
  standard_hours: number
  overtime_after_hours: number
  is_active: boolean
}

export interface OperationalTaskType {
  id: string
  operational_unit_id: string | null
  name: string
  code: string
  standard_units_per_hour: number | null
  default_target_units: number | null
  incentive_eligible: boolean
}

export interface ProductionBatch {
  id: string
  batch_number: string
  operational_unit_id: string
  warehouse_id: string | null
  task_type_id: string
  shift_id: string | null
  production_date: string
  target_units: number | null
  actual_units: number
  rejected_units: number
  allocation_method: 'equal' | 'hours_weighted' | 'manual' | 'role_weighted'
  status: BatchStatus
  supervisor_employee_id: string | null
  production_order_id: string | null
  bom_header_id: string | null
  product_id: string | null
  production_daily_log_id: string | null
  inventory_posting_status: 'not_required' | 'pending' | 'posted' | 'failed'
  inventory_posted_at: string | null
  notes: string | null
  approved_at: string | null
  created_at: string
}

export interface OperationalProductionOrder {
  id: string
  order_number: string
  company_id: string | null
  product_id: string | null
  bom_header_id: string | null
  warehouse_id: string
  target_quantity: number
  completed_quantity: number
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  planned_start_date: string | null
  due_date: string | null
  notes: string | null
}

export interface OperationalBom {
  id: string
  product_id: string | null
  finished_product_id: string | null
  name: string
  stage: 'ASSEMBLY' | 'STICKER' | 'OTHER'
  is_active: boolean
}

export interface OperationalProduct {
  id: string
  name: string
  sku: string
}

export interface OperationalBomLine {
  id: string
  bom_header_id: string
  component_product_id: string
  quantity_required: number
}

export interface WarehouseInventoryRow {
  warehouse_id: string
  product_id: string
  quantity_on_hand: number
}

export interface ProducibleEstimate {
  bomHeaderId: string
  warehouseId: string
  maxUnits: number | null
  limitingComponentId: string | null
}

/** Max whole units producible from on-hand stock, and which component runs out first. */
export function computeMaxProducible(
  bomLines: OperationalBomLine[],
  inventory: WarehouseInventoryRow[],
  bomHeaderId: string,
  warehouseId: string,
): ProducibleEstimate {
  const lines = bomLines.filter(line => line.bom_header_id === bomHeaderId && line.quantity_required > 0)
  if (lines.length === 0) return { bomHeaderId, warehouseId, maxUnits: null, limitingComponentId: null }
  let maxUnits = Infinity
  let limitingComponentId: string | null = null
  for (const line of lines) {
    const stock = inventory.find(row => row.warehouse_id === warehouseId && row.product_id === line.component_product_id)?.quantity_on_hand ?? 0
    const possible = Math.floor(stock / line.quantity_required)
    if (possible < maxUnits) { maxUnits = possible; limitingComponentId = line.component_product_id }
  }
  return { bomHeaderId, warehouseId, maxUnits: Number.isFinite(maxUnits) ? maxUnits : null, limitingComponentId }
}

export interface ProductionBatchWorker {
  id: string
  production_batch_id: string
  employee_id: string
  source_group_id: string | null
  regular_hours: number
  overtime_hours: number
  units_attributed: number | null
  attendance_status: AttendanceStatus
  employee_efficiency_pct: number | null
  incentive_amount: number
}

export interface EmployeeAttendance {
  id: string
  employee_id: string
  operational_unit_id: string
  shift_id: string | null
  attendance_date: string
  clock_in: string | null
  clock_out: string | null
  regular_hours: number
  raw_overtime_hours: number
  approved_overtime_hours: number
  attendance_status: AttendanceStatus
  source: string
  notes: string | null
}

export interface OvertimeType {
  id: string
  name: string
  code: string
  multiplier: number
}

export interface OvertimeRequest {
  id: string
  employee_id: string
  operational_unit_id: string
  production_batch_id: string | null
  overtime_date: string
  requested_hours: number
  approved_hours: number | null
  overtime_type_id: string
  reason: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted'
  rejection_reason: string | null
  created_at: string
}

export interface EmployeeEfficiency {
  id: string
  employee_id: string
  operational_unit_id: string
  log_date: string
  regular_hours: number
  overtime_hours: number
  earned_hours: number
  attributed_units: number
  efficiency_pct: number
  rolling_avg_7d: number
  trend_flag: 'improving' | 'stable' | 'declining'
  needs_attention: boolean
}

export interface UnitDailyRollup {
  id: string
  operational_unit_id: string
  log_date: string
  employee_count: number
  total_units: number
  accepted_units: number
  rejected_units: number
  regular_hours: number
  overtime_hours: number
  avg_efficiency_pct: number
  output_per_labor_hour: number
  target_achievement_pct: number
  rank_position: number | null
}

export interface OperationalAlert {
  id: string
  operational_unit_id: string
  alert_date: string
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  related_employee_id: string | null
  related_batch_id: string | null
  is_resolved: boolean
}

export interface WarehousePayrollRun {
  id: string
  payroll_scope_id: string
  operational_unit_id: string
  run_number: string
  period_start: string
  period_end: string
  status: PayrollRunStatus
  employee_count: number
  gross_amount: number
  overtime_amount: number
  incentive_amount: number
  deduction_amount: number
  tax_amount: number
  pension_amount: number
  employer_pension_amount: number
  net_amount: number
  created_at: string
}

export interface WarehousePayrollEmployee {
  id: string
  payroll_run_id: string
  employee_id: string
  days_worked: number
  basic_salary: number
  regular_pay: number
  overtime_hours: number
  overtime_pay: number
  production_incentive: number
  gross_pay: number
  tax: number
  pension_employee: number
  pension_employer: number
  other_deductions: number
  net_pay: number
}

export interface AccountingBatch {
  id: string
  payroll_run_id: string
  journal_batch_number: string
  total_debit: number
  total_credit: number
  posting_status: 'pending' | 'posted' | 'failed' | 'reversed'
  posted_at: string | null
}

export interface PayrollValidationItem {
  id: string
  label: string
  detail?: string
}

export interface PayrollValidationIssue {
  count: number
  items: PayrollValidationItem[]
}

export interface PayrollValidationResult {
  ready: boolean
  blocking_count: number
  active_employees: number
  missing_attendance: PayrollValidationIssue
  pending_overtime: PayrollValidationIssue
  unapproved_batches: PayrollValidationIssue
  missing_salary: PayrollValidationIssue
  payroll_scope: {
    configured: boolean
    label: string
  }
  existing_run: {
    exists: boolean
    label: string
  }
}

export interface WarehouseOperationsData {
  units: OperationalUnit[]
  companies: OperationalCompany[]
  assignments: UnitAssignment[]
  employees: OperationalEmployee[]
  groups: WorkforceGroup[]
  groupMembers: WorkforceGroupMember[]
  shifts: OperationalShift[]
  taskTypes: OperationalTaskType[]
  batches: ProductionBatch[]
  batchWorkers: ProductionBatchWorker[]
  attendance: EmployeeAttendance[]
  overtimeTypes: OvertimeType[]
  overtime: OvertimeRequest[]
  employeeEfficiency: EmployeeEfficiency[]
  rollups: UnitDailyRollup[]
  alerts: OperationalAlert[]
  payrollRuns: WarehousePayrollRun[]
  payrollEmployees: WarehousePayrollEmployee[]
  accountingBatches: AccountingBatch[]
  productionOrders: OperationalProductionOrder[]
  boms: OperationalBom[]
  products: OperationalProduct[]
  bomLines: OperationalBomLine[]
  inventory: WarehouseInventoryRow[]
}

function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}

function rows<T>(result: { data: unknown; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T[]
}

export async function fetchWarehouseOperations(date: string): Promise<WarehouseOperationsData> {
  const from = dateOffset(date, -34)
  const [unitsRes, companiesRes, assignmentsRes, employeesRes, groupsRes, groupMembersRes, shiftsRes, taskTypesRes, productionOrdersRes, bomsRes, productsRes] = await Promise.all([
    supabase.from('operational_units').select('*').eq('is_active', true).order('name'),
    supabase.rpc('list_production_planning_companies'),
    supabase.from('warehouse_user_assignments').select('id, profile_id, operational_unit_id, access_role, effective_from, effective_to').eq('is_active', true),
    supabase.from('operational_employee_directory').select('*').order('full_name'),
    supabase.from('workforce_groups').select('*').eq('is_active', true).order('name'),
    supabase.from('workforce_group_members').select('*').eq('is_active', true),
    supabase.from('operational_shifts').select('*').eq('is_active', true).order('name'),
    supabase.from('operational_task_types').select('*').eq('is_active', true).order('name'),
    supabase.from('production_orders').select('id, order_number, company_id, product_id, bom_header_id, warehouse_id, target_quantity, completed_quantity, status, planned_start_date, due_date, notes').order('created_at', { ascending: false }).limit(300),
    supabase.from('bom_headers').select('id, product_id, finished_product_id, name, stage, is_active').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name, sku').order('name'),
  ])
  const [bomLinesRes, inventoryRes] = await Promise.all([
    supabase.from('bom_lines').select('id, bom_header_id, component_product_id, quantity_required'),
    supabase.from('current_inventory').select('warehouse_id, product_id, quantity_on_hand'),
  ])

  const units = rows<OperationalUnit>(unitsRes)
  const unitIds = units.map(unit => unit.id)
  if (unitIds.length === 0) {
    return {
      units: [], companies: rows<OperationalCompany>(companiesRes), assignments: rows<UnitAssignment>(assignmentsRes),
      employees: [], groups: [], groupMembers: [], shifts: [], taskTypes: rows<OperationalTaskType>(taskTypesRes),
      batches: [], batchWorkers: [], attendance: [], overtimeTypes: [], overtime: [],
      employeeEfficiency: [], rollups: [], alerts: [], payrollRuns: [], payrollEmployees: [], accountingBatches: [],
      productionOrders: rows<OperationalProductionOrder>(productionOrdersRes),
      boms: rows<OperationalBom>(bomsRes),
      products: rows<OperationalProduct>(productsRes),
      bomLines: rows<OperationalBomLine>(bomLinesRes),
      inventory: rows<WarehouseInventoryRow>(inventoryRes),
    }
  }

  const [batchesRes, attendanceRes, overtimeTypesRes, overtimeRes, efficiencyRes, rollupsRes, alertsRes, payrollRunsRes] = await Promise.all([
    supabase.from('production_batches').select('*').in('operational_unit_id', unitIds).order('production_date', { ascending: false }).limit(500),
    supabase.from('employee_attendance').select('*').in('operational_unit_id', unitIds).gte('attendance_date', from).lte('attendance_date', date).order('attendance_date', { ascending: false }),
    supabase.from('overtime_types').select('*').eq('active', true).order('multiplier'),
    supabase.from('overtime_requests').select('*').in('operational_unit_id', unitIds).gte('overtime_date', from).lte('overtime_date', date).order('created_at', { ascending: false }),
    supabase.from('employee_daily_efficiency').select('*').in('operational_unit_id', unitIds).gte('log_date', from).lte('log_date', date).order('log_date', { ascending: false }),
    supabase.from('operational_unit_daily_rollups').select('*').in('operational_unit_id', unitIds).gte('log_date', from).lte('log_date', date).order('log_date', { ascending: false }),
    supabase.from('operational_alerts').select('*').in('operational_unit_id', unitIds).eq('is_resolved', false).order('created_at', { ascending: false }),
    supabase.from('warehouse_payroll_runs').select('*').in('operational_unit_id', unitIds).order('period_end', { ascending: false }).limit(100),
  ])

  const batches = rows<ProductionBatch>(batchesRes)
  const payrollRuns = rows<WarehousePayrollRun>(payrollRunsRes)
  const batchIds = batches.map(batch => batch.id)
  const payrollRunIds = payrollRuns.map(run => run.id)
  const [batchWorkersRes, payrollEmployeesRes, accountingBatchesRes] = await Promise.all([
    batchIds.length
      ? supabase.from('production_batch_workers').select('*').in('production_batch_id', batchIds)
      : Promise.resolve({ data: [], error: null }),
    payrollRunIds.length
      ? supabase.from('warehouse_payroll_run_employees').select('*').in('payroll_run_id', payrollRunIds)
      : Promise.resolve({ data: [], error: null }),
    payrollRunIds.length
      ? supabase.from('payroll_accounting_batches').select('*').in('payroll_run_id', payrollRunIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  return {
    units,
    companies: rows<OperationalCompany>(companiesRes),
    assignments: rows<UnitAssignment>(assignmentsRes),
    employees: rows<OperationalEmployee>(employeesRes),
    groups: rows<WorkforceGroup>(groupsRes),
    groupMembers: rows<WorkforceGroupMember>(groupMembersRes),
    shifts: rows<OperationalShift>(shiftsRes),
    taskTypes: rows<OperationalTaskType>(taskTypesRes),
    batches,
    batchWorkers: rows<ProductionBatchWorker>(batchWorkersRes),
    attendance: rows<EmployeeAttendance>(attendanceRes),
    overtimeTypes: rows<OvertimeType>(overtimeTypesRes),
    overtime: rows<OvertimeRequest>(overtimeRes),
    employeeEfficiency: rows<EmployeeEfficiency>(efficiencyRes),
    rollups: rows<UnitDailyRollup>(rollupsRes),
    alerts: rows<OperationalAlert>(alertsRes),
    payrollRuns,
    payrollEmployees: rows<WarehousePayrollEmployee>(payrollEmployeesRes),
    accountingBatches: rows<AccountingBatch>(accountingBatchesRes),
    productionOrders: rows<OperationalProductionOrder>(productionOrdersRes),
    boms: rows<OperationalBom>(bomsRes),
    products: rows<OperationalProduct>(productsRes),
    bomLines: rows<OperationalBomLine>(bomLinesRes),
    inventory: rows<WarehouseInventoryRow>(inventoryRes),
  }
}

async function currentProfileId() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error(error?.message ?? 'Your session has expired.')
  return data.user.id
}

export interface CreateBatchInput {
  operationalUnitId: string
  warehouseId: string | null
  taskTypeId: string
  shiftId: string | null
  productionDate: string
  targetUnits: number
  actualUnits: number
  rejectedUnits: number
  allocationMethod: ProductionBatch['allocation_method']
  status?: 'draft' | 'submitted'
  supervisorEmployeeId?: string | null
  productionOrderId?: string | null
  bomHeaderId?: string | null
  productId?: string | null
  notes?: string
  workers: Array<{
    employeeId: string
    sourceGroupId?: string | null
    regularHours: number
    overtimeHours: number
    attendanceStatus?: AttendanceStatus
  }>
}

export async function createProductionBatch(input: CreateBatchInput): Promise<string> {
  if (input.workers.length === 0) throw new Error('Select at least one worker or workforce group.')
  const { data, error } = await supabase.rpc('create_production_batch_with_workers', {
    p_operational_unit_id: input.operationalUnitId,
    p_warehouse_id: input.warehouseId,
    p_task_type_id: input.taskTypeId,
    p_shift_id: input.shiftId || null,
    p_production_date: input.productionDate,
    p_target_units: input.targetUnits,
    p_actual_units: input.actualUnits,
    p_rejected_units: input.rejectedUnits,
    p_allocation_method: input.allocationMethod,
    p_status: input.status ?? 'submitted',
    p_supervisor_employee_id: input.supervisorEmployeeId || null,
    p_production_order_id: input.productionOrderId || null,
    p_bom_header_id: input.bomHeaderId || null,
    p_product_id: input.productId || null,
    p_notes: input.notes || '',
    p_workers: input.workers.map(worker => ({
      employee_id: worker.employeeId,
      source_group_id: worker.sourceGroupId || null,
      regular_hours: worker.regularHours,
      overtime_hours: worker.overtimeHours,
      attendance_status: worker.attendanceStatus ?? 'present',
    })),
  })
  if (error) {
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      throw new Error('A current warehouse-manager assignment is required to create floor production batches for this warehouse. Ask an administrator to update Warehouse Access in Users.')
    }
    if (error.code === '23505' || error.message.toLowerCase().includes('already has an open warehouse batch')) {
      throw new Error('This production order already has an open warehouse batch. Finish or cancel that batch before creating another.')
    }
    throw new Error(error.message)
  }
  return data as string
}

export interface CreateWarehouseProductionOrderInput {
  operationalUnitId: string
  companyId: string
  bomHeaderId: string
  targetQuantity: number
  plannedStartDate: string
  dueDate?: string | null
  notes?: string
}

export async function createWarehouseProductionOrder(
  input: CreateWarehouseProductionOrderInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_warehouse_production_order', {
    p_operational_unit_id: input.operationalUnitId,
    p_company_id: input.companyId,
    p_bom_header_id: input.bomHeaderId,
    p_target_quantity: input.targetQuantity,
    p_planned_start_date: input.plannedStartDate,
    p_due_date: input.dueDate || null,
    p_notes: input.notes || '',
  })
  if (error) {
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      throw new Error('Production planning access is required to create an order in this warehouse.')
    }
    throw new Error(error.message)
  }
  return data as string
}

export async function fetchProductionPlanningCompanies(): Promise<OperationalCompany[]> {
  const { data, error } = await supabase.rpc('list_production_planning_companies')
  if (error) throw new Error(error.message)
  return (data ?? []) as OperationalCompany[]
}

export async function approveProductionBatch(batchId: string) {
  const { error } = await supabase.rpc('approve_production_batch', { p_batch_id: batchId })
  if (error) throw new Error(error.message)
}

export async function transitionProductionBatch(input: {
  batchId: string
  action: 'start' | 'submit' | 'cancel'
  actualUnits?: number
  rejectedUnits?: number
  notes?: string
  workers?: Array<{
    id: string
    regularHours: number
    overtimeHours: number
    attendanceStatus: Exclude<AttendanceStatus, 'sick'>
  }>
}) {
  const { error } = await supabase.rpc('transition_production_batch', {
    p_batch_id: input.batchId,
    p_action: input.action,
    p_actual_units: input.actualUnits ?? null,
    p_rejected_units: input.rejectedUnits ?? null,
    p_notes: input.notes ?? null,
    p_worker_updates: (input.workers ?? []).map(worker => ({
      id: worker.id,
      regular_hours: worker.regularHours,
      overtime_hours: worker.overtimeHours,
      attendance_status: worker.attendanceStatus,
    })),
  })
  if (error) throw new Error(error.message)
}

export async function createWorkforceGroup(input: {
  operationalUnitId: string
  name: string
  groupType: WorkforceGroup['group_type']
  employeeIds: string[]
}) {
  const profileId = await currentProfileId()
  const { data: group, error } = await supabase.from('workforce_groups').insert({
    operational_unit_id: input.operationalUnitId,
    name: input.name.trim(),
    group_type: input.groupType,
    created_by: profileId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  if (input.employeeIds.length) {
    const { error: memberError } = await supabase.from('workforce_group_members').insert(
      input.employeeIds.map(employeeId => ({ workforce_group_id: group.id, employee_id: employeeId })),
    )
    if (memberError) throw new Error(memberError.message)
  }
}

export async function saveAttendance(input: {
  employeeId: string
  operationalUnitId: string
  shiftId: string | null
  attendanceDate: string
  attendanceStatus: AttendanceStatus
  regularHours: number
  rawOvertimeHours: number
  notes?: string
}) {
  const profileId = await currentProfileId()
  const { error } = await supabase.from('employee_attendance').upsert({
    employee_id: input.employeeId,
    operational_unit_id: input.operationalUnitId,
    shift_id: input.shiftId || null,
    attendance_date: input.attendanceDate,
    attendance_status: input.attendanceStatus,
    regular_hours: input.regularHours,
    raw_overtime_hours: input.rawOvertimeHours,
    source: 'manual',
    notes: input.notes || null,
    created_by: profileId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'employee_id,operational_unit_id,attendance_date' })
  if (error) throw new Error(error.message)
}

export async function saveAttendanceBatch(inputs: Array<{
  employeeId: string
  operationalUnitId: string
  shiftId: string | null
  attendanceDate: string
  attendanceStatus: AttendanceStatus
  regularHours: number
  rawOvertimeHours: number
  notes?: string
}>) {
  if (inputs.length === 0) throw new Error('Select at least one attendance row to save.')
  const profileId = await currentProfileId()
  const updatedAt = new Date().toISOString()
  const { error } = await supabase.from('employee_attendance').upsert(
    inputs.map(input => ({
      employee_id: input.employeeId,
      operational_unit_id: input.operationalUnitId,
      shift_id: input.shiftId || null,
      attendance_date: input.attendanceDate,
      attendance_status: input.attendanceStatus,
      regular_hours: input.regularHours,
      raw_overtime_hours: input.rawOvertimeHours,
      source: 'manual',
      notes: input.notes || null,
      created_by: profileId,
      updated_at: updatedAt,
    })),
    { onConflict: 'employee_id,operational_unit_id,attendance_date' },
  )
  if (error) throw new Error(error.message)
}

export async function submitOvertime(input: {
  employeeId: string
  operationalUnitId: string
  productionBatchId?: string | null
  overtimeDate: string
  requestedHours: number
  overtimeTypeId: string
  reason: string
}) {
  const profileId = await currentProfileId()
  const { error } = await supabase.from('overtime_requests').insert({
    employee_id: input.employeeId,
    operational_unit_id: input.operationalUnitId,
    production_batch_id: input.productionBatchId || null,
    overtime_date: input.overtimeDate,
    requested_hours: input.requestedHours,
    overtime_type_id: input.overtimeTypeId,
    reason: input.reason,
    status: 'submitted',
    requested_by: profileId,
  })
  if (error) throw new Error(error.message)
}

export async function decideOvertime(requestId: string, approve: boolean, hours?: number, reason?: string) {
  const { error } = await supabase.rpc('decide_overtime_request', {
    p_request_id: requestId,
    p_approve: approve,
    p_hours: hours ?? null,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function prepareWarehousePayroll(unitId: string, start: string, end: string): Promise<string> {
  const { data, error } = await supabase.rpc('prepare_warehouse_payroll', {
    p_unit_id: unitId,
    p_start: start,
    p_end: end,
    p_payroll_period_id: null,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function validateWarehousePayroll(
  unitId: string,
  start: string,
  end: string,
): Promise<PayrollValidationResult> {
  const { data, error } = await supabase.rpc('validate_warehouse_payroll', {
    p_unit_id: unitId,
    p_start: start,
    p_end: end,
  })
  if (error) throw new Error(error.message)
  return data as PayrollValidationResult
}

export async function transitionWarehousePayroll(
  runId: string,
  action: 'submit' | 'hr_approve' | 'finance_approve' | 'post' | 'reject',
) {
  const { error } = await supabase.rpc('transition_warehouse_payroll', {
    p_run_id: runId,
    p_action: action,
  })
  if (error) throw new Error(error.message)
}

export async function refreshOperationalAlerts(unitId: string, date: string) {
  const { error } = await supabase.rpc('refresh_operational_alerts', {
    p_unit_id: unitId,
    p_date: date,
  })
  if (error) throw new Error(error.message)
}

export async function resolveOperationalAlert(alertId: string) {
  const profileId = await currentProfileId()
  const { error } = await supabase.from('operational_alerts').update({
    is_resolved: true,
    resolved_by: profileId,
    resolved_at: new Date().toISOString(),
  }).eq('id', alertId)
  if (error) throw new Error(error.message)
}
