import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Ship, Building2,
  Wrench, Package, Calculator, BarChart3,
  Tag, Wallet, CreditCard, Banknote, Landmark, Receipt, CalendarDays, Users, Hammer, ListTree, Truck, Anchor,
  ShoppingCart,
} from 'lucide-react'
import { Settings as SettingsIcon, UserCog, LogOut, KeyRound } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { hasAccess, ROLE_LABELS } from '../../lib/roles'
import type { Role } from '../../lib/roles'
import { ChangePinModal } from '../ChangePinModal'

// allow: [] means visible to every authenticated role (pure reporting/overview pages).
const links = [
  { section: 'Overview', items: [
    { to: '/',              icon: LayoutDashboard, label: 'Dashboard',      allow: [] as Role[] },
    { to: '/daily-activity',icon: CalendarDays,    label: 'Daily Activity', allow: [] as Role[] },
  ]},
 { section: 'Import', items: [
  { to: '/shipments',  icon: Ship,       label: 'Shipments',  allow: ['operations_marketing'] as Role[] },
  { to: '/djibouti',   icon: Anchor,     label: 'Djibouti Forwarder', allow: ['operations_marketing', 'accounting_finance'] as Role[] },
  { to: '/suppliers',  icon: Building2,  label: 'Suppliers',  allow: ['operations_marketing'] as Role[] },
  { to: '/customers',  icon: Users,      label: 'Customers',  allow: ['operations_marketing', 'manufacturing_sales'] as Role[] },
  { to: '/products',   icon: Tag,        label: 'Products',   allow: ['operations_marketing', 'manufacturing_sales'] as Role[] },
]},
  { section: 'Operations', items: [
    { to: '/production',  icon: Wrench,      label: 'Production', allow: ['manufacturing_sales'] as Role[] },
    { to: '/assembly',    icon: Hammer,      label: 'Assembly',   allow: ['manufacturing_sales'] as Role[] },
    { to: '/boms',        icon: ListTree,    label: 'BOMs',       allow: ['manufacturing_sales'] as Role[] },
    { to: '/inventory',   icon: Package,     label: 'Inventory',  allow: ['manufacturing_sales', 'operations_marketing'] as Role[] },
    { to: '/warehouse-transfers', icon: Truck, label: 'Warehouse Transfers', allow: ['manufacturing_sales', 'operations_marketing'] as Role[] },
  ]},
  { section: 'Sales', items: [
    { to: '/sales', icon: ShoppingCart, label: 'Sales', allow: ['manufacturing_sales', 'accounting_finance'] as Role[] },
  ]},
  { section: 'Finance', items: [
    { to: '/costs',          icon: Calculator,  label: 'Cost Engine',     allow: ['accounting_finance'] as Role[] },
    { to: '/customs-estimator', icon: Calculator, label: 'Customs Estimator', allow: ['accounting_finance', 'operations_marketing'] as Role[] },
    { to: '/payables',       icon: Wallet,      label: 'Payables',        allow: ['accounting_finance'] as Role[] },
    { to: '/receivables',    icon: CreditCard,  label: 'Receivables',     allow: ['accounting_finance'] as Role[] },
    { to: '/money-tracking', icon: Banknote,    label: 'Money Tracking',  allow: ['accounting_finance'] as Role[] },
    { to: '/credit-accounts',icon: Landmark,    label: 'Credit Accounts', allow: ['accounting_finance'] as Role[] },
    { to: '/expenses',       icon: Receipt,     label: 'Expenses',        allow: ['accounting_finance'] as Role[] },
    { to: '/reports',        icon: BarChart3,   label: 'Reports',         allow: [] as Role[] },
  ]},
  { section: 'System', items: [
  { to: '/users',    icon: UserCog,    label: 'Users & Roles', allow: ['hr_system'] as Role[] },
  { to: '/settings', icon: SettingsIcon, label: 'Settings',    allow: ['hr_system'] as Role[] },
]},
]

export function Sidebar() {
  const { profile, signOut } = useAuth()
  const role = profile?.role as Role | undefined
  const [showChangePin, setShowChangePin] = useState(false)
  const visibleLinks = links
    .map(group => ({
      ...group,
      items: group.items.filter(link => link.allow.length === 0 || hasAccess(role, link.allow)),
    }))
    .filter(group => group.items.length > 0)
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
        {visibleLinks.map(group => (
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
      <div style={{ padding: '10px 12px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <div style={{ fontSize: '12px', fontWeight: 500 }}>{profile?.full_name ?? 'Unnamed'}</div>
        <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>
          {role ? ROLE_LABELS[role] : profile?.role}
        </div>
        <button
          onClick={() => setShowChangePin(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            marginBottom: '8px',
          }}
        >
          <KeyRound size={13} strokeWidth={1.5} /> Change PIN
        </button>
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <LogOut size={13} strokeWidth={1.5} /> Sign out
        </button>
      </div>
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} />}
    </aside>
  )
}