import { Outlet } from 'react-router-dom'
import { Sun, Moon } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useTheme } from '../../lib/theme'

export function Layout() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden',
                  background: 'var(--color-background-tertiary)' }}>
      {/* Desktop sidebar */}
      <div style={{ display: 'none' }} className="sidebar-desktop">
        <Sidebar />
      </div>

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

      {/* Always show sidebar on md+ */}
      <style>{`
        @media(min-width:768px){
          .sidebar-desktop{ display:flex !important }
          .mobile-nav{ display:none !important }
        }
      `}</style>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column',
                     overflow: 'hidden', minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '64px' }}
             className="main-scroll">
          <style>{`@media(min-width:768px){ .main-scroll{ padding-bottom:0 !important } }`}</style>
          <Outlet />
        </div>

        {/* Mobile bottom nav */}
        <div className="mobile-nav">
          <MobileNav />
        </div>
      </main>
    </div>
  )
}