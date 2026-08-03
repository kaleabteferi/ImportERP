import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { hasAccess } from '../../lib/roles'
import type { Role } from '../../lib/roles'

export function RequireRole({ allow, warehouseScope = false, children }: { allow: Role[]; warehouseScope?: boolean; children: ReactNode }) {
  const { profile, warehouseAssignments } = useAuth()
  if (!hasAccess(profile?.role as Role | undefined, allow, warehouseAssignments, warehouseScope)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
