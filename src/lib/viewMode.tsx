import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type ViewMode = 'desktop' | 'mobile'
const STORAGE_KEY = 'erp.viewMode'

function getInitialMode(): ViewMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'desktop' || stored === 'mobile') return stored
  return window.innerWidth < 768 ? 'mobile' : 'desktop'
}

const ViewModeContext = createContext<{ mode: ViewMode; setMode: (m: ViewMode) => void; toggleMode: () => void } | null>(null)

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>(getInitialMode)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, mode) }, [mode])

  const setMode = (m: ViewMode) => setModeState(m)
  const toggleMode = () => setModeState(m => (m === 'mobile' ? 'desktop' : 'mobile'))

  return (
    <ViewModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </ViewModeContext.Provider>
  )
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext)
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider')
  return ctx
}
