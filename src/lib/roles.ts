// The ERP role is the person's company-wide department. Warehouse access is
// deliberately a second dimension: it is granted only through an active unit
// assignment, so a warehouse manager does not inherit Sales, HR or Finance.

export type Role =
  | 'full_access'
  | 'accounting_finance'
  | 'operations_marketing'
  | 'manufacturing_sales'
  | 'hr_system'
  | 'warehouse_operations'

export type WarehouseAccessRole = 'regional_manager' | 'warehouse_manager' | 'payroll_officer' | 'viewer'

export interface WarehouseAccessAssignment {
  id: string
  operational_unit_id: string | null
  access_role: WarehouseAccessRole
  effective_from?: string | null
  effective_to?: string | null
  is_active?: boolean
}

export const HEAD_OFFICE_ROLES: Role[] = [
  'full_access', 'accounting_finance', 'operations_marketing', 'manufacturing_sales', 'hr_system',
]

export const ROLE_LABELS: Record<Role, string> = {
  full_access: 'Full access',
  accounting_finance: 'Accounting & Finance',
  operations_marketing: 'Imports & Operations',
  manufacturing_sales: 'Manufacturing & Sales',
  hr_system: 'HR & System Control',
  warehouse_operations: 'Warehouse operations',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  full_access: 'Company-wide view and control across every module and warehouse.',
  accounting_finance: 'Finance, accounting, sales settlement and final payroll approval.',
  operations_marketing: 'Imports, suppliers, shipments, customer and logistics workflows.',
  manufacturing_sales: 'Production planning, products, inventory, transfers and sales.',
  hr_system: 'Head-office employees, HR, user administration and payroll review.',
  warehouse_operations: 'Only assigned warehouse workspaces. A warehouse scope is required.',
}

export function hasActiveWarehouseAccess(assignments: WarehouseAccessAssignment[] | undefined | null): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return (assignments ?? []).some(assignment =>
    assignment.is_active !== false
    && (!assignment.effective_from || assignment.effective_from <= today)
    && (!assignment.effective_to || assignment.effective_to >= today),
  )
}

export function hasAccess(
  role: Role | undefined | null,
  allow: Role[],
  warehouseAssignments?: WarehouseAccessAssignment[] | null,
  allowWarehouseScope = false,
): boolean {
  if (!role) return false
  if (role === 'full_access') return true
  if (allow.length === 0) {
    return role !== 'warehouse_operations' || (allowWarehouseScope && hasActiveWarehouseAccess(warehouseAssignments))
  }
  if (allow.includes(role)) return true
  return allowWarehouseScope && role === 'warehouse_operations' && hasActiveWarehouseAccess(warehouseAssignments)
}
