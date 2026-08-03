import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { clearPageState } from './pageState'
import type { Role, WarehouseAccessAssignment } from './roles'

export interface Profile {
  id: string
  employee_id: string | null
  full_name: string | null
  role: 'pending' | Role
}

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  warehouseAssignments: WarehouseAccessAssignment[]
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [warehouseAssignments, setWarehouseAssignments] = useState<WarehouseAccessAssignment[]>([])
  const [loading, setLoading] = useState(true)

  async function loadIdentity(userId: string) {
    const [profileResult, assignmentResult] = await Promise.all([
      supabase.from('profiles').select('id, employee_id, full_name, role').eq('id', userId).maybeSingle(),
      supabase.from('warehouse_user_assignments')
        .select('id, operational_unit_id, access_role, effective_from, effective_to, is_active')
        .eq('profile_id', userId)
        .eq('is_active', true),
    ])
    if (profileResult.error) console.error('Failed to load profile:', profileResult.error.message)
    if (assignmentResult.error) console.error('Failed to load warehouse access:', assignmentResult.error.message)
    setProfile(profileResult.data as Profile | null)
    setWarehouseAssignments((assignmentResult.data ?? []) as WarehouseAccessAssignment[])
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session?.user?.id) await loadIdentity(data.session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession?.user?.id) void loadIdentity(newSession.user.id)
      else {
        setProfile(null)
        setWarehouseAssignments([])
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user?.id || !profile || profile.role === 'pending') return
    let active = true
    const heartbeat = () => {
      if (!active || document.visibilityState === 'hidden') return
      void supabase.from('user_presence').upsert({
        profile_id: session.user.id,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id' })
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, 45_000)
    window.addEventListener('focus', heartbeat)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', heartbeat)
      document.removeEventListener('visibilitychange', heartbeat)
    }
  }, [profile, session?.user?.id])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    clearPageState()
  }

  async function refreshProfile() {
    if (session?.user?.id) await loadIdentity(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, warehouseAssignments, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// Auth context and its hook intentionally live together as one public module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
