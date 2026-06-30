import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Ship, Building2,
  Wrench, Package, Calculator, BarChart3,
  Tag, Wallet, CreditCard,
} from 'lucide-react'
import { Settings as SettingsIcon } from 'lucide-react'
const links = [
  { section: 'Overview', items: [
    { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
  ]},
 { section: 'Import', items: [
  { to: '/shipments',  icon: Ship,       label: 'Shipments'  },
  { to: '/suppliers',  icon: Building2,  label: 'Suppliers'  },
  { to: '/products',   icon: Tag,        label: 'Products'   },
]},
  { section: 'Operations', items: [
    { to: '/production',  icon: Wrench,      label: 'Production' },
    { to: '/inventory',   icon: Package,     label: 'Inventory'  },
  ]},
  { section: 'Finance', items: [
    { to: '/costs',       icon: Calculator,  label: 'Cost Engine' },
    { to: '/payables',    icon: Wallet,      label: 'Payables'    },
    { to: '/receivables', icon: CreditCard,  label: 'Receivables' },
    { to: '/reports',     icon: BarChart3,   label: 'Reports'     },
  ]},
  { section: 'System', items: [
  { to: '/settings', icon: SettingsIcon, label: 'Settings' },
]},
]

export function Sidebar() {
  return (
    <aside style={{
      width: '200px', height: '100vh', background: 'var(--color-background-primary)',
      borderRight: '0.5px solid var(--color-border-tertiary)',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto'
    }}>
      <div style={{ padding: '16px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <div style={{ fontSize: '13px', fontWeight: 500 }}>ImportERP</div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
          Addis Ababa · ETB/USD
        </div>
      </div>
      <nav style={{ padding: '8px', flex: 1 }}>
        {links.map(group => (
          <div key={group.section}>
            <div style={{
              fontSize: '10px', color: 'var(--color-text-tertiary)',
              padding: '10px 8px 4px', textTransform: 'uppercase', letterSpacing: '.05em'
            }}>
              {group.section}
            </div>
            {group.items.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 8px', borderRadius: '6px', marginBottom: '1px',
                  fontSize: '12px', textDecoration: 'none',
                  background: isActive ? 'var(--color-background-info)' : 'transparent',
                  color: isActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)',
                  fontWeight: isActive ? 500 : 400,
                })}
              >
                <link.icon size={15} strokeWidth={1.5} />
                {link.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}