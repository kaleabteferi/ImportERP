import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'

export function Layout() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden',
                  background: 'var(--color-background-tertiary)' }}>
      {/* Desktop sidebar */}
      <div style={{ display: 'none' }} className="sidebar-desktop">
        <Sidebar />
      </div>

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