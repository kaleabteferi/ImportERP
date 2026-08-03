import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sun, Moon, Smartphone, Monitor, Grid2X2, Search } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useTheme } from '../../lib/theme'
import { useViewMode } from '../../lib/viewMode'
import { CommandPalette } from '../CommandPalette'
import { NotificationMenu } from '../NotificationMenu'
import './mobile.css'

// Keying by pathname forces a fresh mount on every navigation, which
// restarts the CSS animation — a plain wrapper without the key would only
// animate once, on first load.
function RouteFade({ fillViewport = false, mobile = false }: { fillViewport?: boolean; mobile?: boolean }) {
  const location = useLocation()
  return (
    <div key={location.pathname} className={mobile ? 'mobile-route-page' : undefined} style={{
      height: fillViewport ? '100%' : undefined,
      minHeight: fillViewport ? 0 : undefined,
      animation: fillViewport ? 'none' : 'fadeInUp 0.2s ease-out',
    }}>
      <Outlet />
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { mode, toggleMode } = useViewMode()
  const isMobile = mode === 'mobile'
  const isFloorPlan = location.pathname.startsWith('/warehouse-operations/floor-plan/')
  const mobileTitle = routeTitle(location.pathname)
  const [commandOpen, setCommandOpen] = useState(false)
  const closeCommand = useCallback(() => setCommandOpen(false), [])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

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
      {!isMobile && <div style={{
        position: 'fixed',
        top: isFloorPlan && isMobile ? 'auto' : '12px',
        right: '12px',
        bottom: isFloorPlan && isMobile ? '74px' : 'auto',
        zIndex: 60,
        display: 'flex', alignItems: 'center', gap: '2px',
        minHeight: '38px', padding: '3px', borderRadius: '9999px',
        background: 'var(--color-background-primary)',
        border: '1px solid var(--color-border-tertiary)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <button className="utility-search-trigger" onClick={() => setCommandOpen(true)} title="Search and commands (Ctrl K)"><Search size={14} /><span>Search anything</span><kbd>Ctrl K</kbd></button>
        <NotificationMenu />
        <div style={{ width: '1px', height: '20px', background: 'var(--color-border-tertiary)' }} />
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
          {!(isFloorPlan && isMobile) && (isMobile ? 'Full version' : 'Mobile version')}
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
      </div>}

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column',
                     overflow: 'hidden', minWidth: 0 }}>
        {isMobile && <header className="mobile-app-bar"><div className="mobile-app-mark"><Grid2X2 size={17} /><span>ERP</span></div><strong>{mobileTitle}</strong><div><button onClick={() => setCommandOpen(true)} aria-label="Search and commands"><Search size={18}/></button><NotificationMenu/><button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button onClick={toggleMode} aria-label="Switch to full version"><Monitor size={18} /></button></div></header>}
        {/* paddingTop clears the fixed theme/mode toggle buttons above (top:
            12px, 32px tall) — without it, any page whose own header puts
            content in the top-right (e.g. a sort/filter button row) renders
            underneath those buttons and becomes unclickable. */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: isFloorPlan ? 'hidden' : 'auto',
          overflowX: isFloorPlan ? 'hidden' : 'auto',
          paddingTop: isFloorPlan || isMobile ? 0 : '44px',
          paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom))' : 0,
        }} className={`app-content ${isMobile ? 'mobile-app-content' : 'desktop-app-content'}`}>
          <RouteFade fillViewport={isFloorPlan} mobile={isMobile} />
        </div>

        {/* Mobile bottom nav */}
        {isMobile && <MobileNav />}
      </main>
      <CommandPalette open={commandOpen} onClose={closeCommand} />
    </div>
  )
}

function routeTitle(pathname: string) {
  if (pathname === '/') return 'Dashboard'
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? 'Dashboard'
  if (/^[0-9a-f-]{20,}$/i.test(segment)) return 'Details'
  return segment.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
