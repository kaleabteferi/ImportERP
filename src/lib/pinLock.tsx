import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { hasPin as apiHasPin } from '../api/pin'

export type PinStatus = 'checking' | 'needs-setup' | 'locked' | 'unlocked'

const INACTIVITY_MS = 10 * 60 * 1000 // 10 minutes

interface PinLockContextValue {
  status: PinStatus
  unlock: () => void
  completeSetup: () => void
  lockNow: () => void
}

const PinLockContext = createContext<PinLockContextValue | null>(null)

export function PinLockProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const [status, setStatus] = useState<PinStatus>('checking')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every fresh load of the app re-checks from scratch — status lives only
  // in memory, never localStorage, so reopening the tab always relocks
  // (matching a banking app), while staying unlocked during active use.
  useEffect(() => {
    let cancelled = false
    if (!session || !profile || profile.role === 'pending') {
      setStatus('checking')
      return
    }
    apiHasPin()
      .then(has => { if (!cancelled) setStatus(has ? 'locked' : 'needs-setup') })
      .catch(() => { if (!cancelled) setStatus('needs-setup') })
    return () => { cancelled = true }
  }, [session?.user?.id, profile?.role])

  const lockNow = useCallback(() => setStatus('locked'), [])

  const resetInactivityTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(lockNow, INACTIVITY_MS)
  }, [lockNow])

  useEffect(() => {
    if (status !== 'unlocked') {
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }
    resetInactivityTimer()
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetInactivityTimer, { passive: true }))
    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status, resetInactivityTimer])

  const unlock = useCallback(() => setStatus('unlocked'), [])
  const completeSetup = useCallback(() => setStatus('unlocked'), [])

  return (
    <PinLockContext.Provider value={{ status, unlock, completeSetup, lockNow }}>
      {children}
    </PinLockContext.Provider>
  )
}

export function usePinLock() {
  const ctx = useContext(PinLockContext)
  if (!ctx) throw new Error('usePinLock must be used within PinLockProvider')
  return ctx
}
