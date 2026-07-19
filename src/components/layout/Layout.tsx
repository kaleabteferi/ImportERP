import { Outlet } from 'react-router-dom'
import { Sun, Moon, Smartphone, Monitor } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useTheme } from '../../lib/theme'
import { useViewMode } from '../../lib/viewMode'

export function Layout() {
  const { theme, toggleTheme } = useTheme()
  const { mode, toggleMode } = useViewMode()
  const isMobile = mode === 'mobile'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden',
                  background: 'var(--color-background-tertiary)' }}>
      {/* Desktop sidebar — shown whenever "full version" is selected,
          regardless of actual viewport width (an explicit user choice, not
          just a responsive breakpoint) */}
      {!isMobile && <Sidebar />}

      <button
        onClick={toggleMode}
        title={isMobile ? 'Switch to full version' : 'Switch to mobile version'}
        style={{
          position: 'fixed', top: '12px', right: '52px', zIndex: 60,
          height: '32px', padding: '0 10px', borderRadius: '9999px',
          display: 'flex', alignItems: 'center', gap: '5px',
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-tertiary)',
          color: 'var(--color-text-secondary)', cursor: 'pointer',
          fontSize: '11px', fontWeight: 500,
        }}
      >
        {isMobile ? <Monitor size={13} strokeWidth={1.5} /> : <Smartphone size={13} strokeWidth={1.5} />}
        {isMobile ? 'Full version' : 'Mobile version'}
      </button>

      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          position: 'fixed', top: '12px', right: '12px', zIndex: 60,
          width: '32px', height: '32px', borderRadius: '9999px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-tertiary)',
          color: 'var(--color-text-secondary)', cursor: 'pointer',
        }}
      >
        {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
      </button>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column',
                     overflow: 'hidden', minWidth: 0 }}>
        {/* paddingTop clears the fixed theme/mode toggle buttons above (top:
            12px, 32px tall) — without it, any page whose own header puts
            content in the top-right (e.g. a sort/filter button row) renders
            underneath those buttons and becomes unclickable. */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', paddingTop: '44px', paddingBottom: isMobile ? '64px' : 0 }}>
          <Outlet />
        </div>

        {/* Mobile bottom nav */}
        {isMobile && <MobileNav />}
      </main>
    </div>
  )
}