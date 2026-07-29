import { Outlet, useLocation } from 'react-router-dom'
import { Sun, Moon, Smartphone, Monitor } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useTheme } from '../../lib/theme'
import { useViewMode } from '../../lib/viewMode'

// Keying by pathname forces a fresh mount on every navigation, which
// restarts the CSS animation — a plain wrapper without the key would only
// animate once, on first load.
function RouteFade() {
  const location = useLocation()
  return (
    <div key={location.pathname} style={{ animation: 'fadeInUp 0.2s ease-out' }}>
      <Outlet />
    </div>
  )
}

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

      {/* A single grouped floating pill, echoing the reference's unified
          top nav-bar treatment rather than two separate disconnected
          buttons. */}
      <div style={{
        position: 'fixed', top: '12px', right: '12px', zIndex: 60,
        display: 'flex', alignItems: 'center', gap: '2px',
        height: '32px', padding: '3px', borderRadius: '9999px',
        background: 'var(--color-background-primary)',
        border: '1px solid var(--color-border-tertiary)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <button
          onClick={toggleMode}
          title={isMobile ? 'Switch to full version' : 'Switch to mobile version'}
          style={{
            height: '100%', padding: '0 10px', borderRadius: '9999px',
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'transparent', border: 'none',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            fontSize: '11px', fontWeight: 500,
            transition: 'background-color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-background-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {isMobile ? <Monitor size={13} strokeWidth={1.5} /> : <Smartphone size={13} strokeWidth={1.5} />}
          {isMobile ? 'Full version' : 'Mobile version'}
        </button>

        <div style={{ width: '1px', height: '16px', background: 'var(--color-border-tertiary)' }} />

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            width: '26px', height: '26px', borderRadius: '9999px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            transition: 'transform 150ms ease, background-color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(-8deg)'; e.currentTarget.style.background = 'var(--color-background-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'rotate(0deg)'; e.currentTarget.style.background = 'transparent' }}
        >
          {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
        </button>
      </div>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column',
                     overflow: 'hidden', minWidth: 0 }}>
        {/* paddingTop clears the fixed theme/mode toggle buttons above (top:
            12px, 32px tall) — without it, any page whose own header puts
            content in the top-right (e.g. a sort/filter button row) renders
            underneath those buttons and becomes unclickable. */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', paddingTop: '44px', paddingBottom: isMobile ? '64px' : 0 }}>
          <RouteFade />
        </div>

        {/* Mobile bottom nav */}
        {isMobile && <MobileNav />}
      </main>
    </div>
  )
}