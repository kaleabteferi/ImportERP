import type { ReactNode } from 'react'
import { useAuth } from '../../lib/auth'
import { Login } from '../../pages/Login'
import { Loader2, Clock } from 'lucide-react'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> Loading…
      </div>
    )
  }

  if (!session) return <Login />

  if (!profile || profile.role === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm w-full bg-white border border-gray-200 rounded-xl p-6 text-center">
          <Clock size={24} className="mx-auto text-amber-500 mb-3" />
          <p className="text-sm font-medium mb-1">Waiting for approval</p>
          <p className="text-xs text-gray-500 mb-4">
            An admin needs to assign your role before you can access the system.
          </p>
          <button onClick={signOut} className="text-xs text-gray-400 hover:text-gray-600">Sign out</button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}