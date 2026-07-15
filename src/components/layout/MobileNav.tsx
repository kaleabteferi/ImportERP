import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Ship, Wrench, Banknote, BarChart3 } from 'lucide-react'

const tabs = [
  { to: '/',              icon: LayoutDashboard, label: 'Home'       },
  { to: '/shipments',     icon: Ship,            label: 'Shipments'  },
  { to: '/production',    icon: Wrench,          label: 'Production' },
  { to: '/money-tracking',icon: Banknote,        label: 'Money'      },
  { to: '/reports',       icon: BarChart3,       label: 'Reports'    },
]

export function MobileNav() {
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'var(--color-background-primary)',
      borderTop: '0.5px solid var(--color-border-tertiary)',
      display: 'flex', zIndex: 50,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {tabs.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '8px 4px', gap: '2px', textDecoration: 'none',
            color: isActive ? '#185FA5' : 'var(--color-text-tertiary)',
            fontSize: '10px',
          })}
        >
          <tab.icon size={22} strokeWidth={1.5} />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}