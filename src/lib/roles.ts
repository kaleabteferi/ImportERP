// src/lib/roles.ts — maps the org-chart departments onto page access.
// 'full_access' (CEO/GM/Assistant Manager tier) always passes every check.
// This is a UI-layer gate only (hides/blocks navigation) — it is not a
// substitute for Supabase RLS, which is the real security boundary and must
// enforce the same rules server-side.

export type Role =
  | 'full_access'
  | 'accounting_finance'
  | 'operations_marketing'
  | 'manufacturing_sales'
  | 'hr_system'

export const ROLE_LABELS: Record<Role, string> = {
  full_access: 'Full access',
  accounting_finance: 'Accounting & Finance',
  operations_marketing: 'Operations & Marketing',
  manufacturing_sales: 'Manufacturing & Sales',
  hr_system: 'HR & System Control',
}

export function hasAccess(role: Role | undefined | null, allow: Role[]): boolean {
  if (!role) return false
  if (role === 'full_access') return true
  return allow.includes(role)
}
