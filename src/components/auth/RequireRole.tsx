import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { hasAccess } from '../../lib/roles'
import type { Role } from '../../lib/roles'

export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!hasAccess(profile?.role as Role | undefined, allow)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
