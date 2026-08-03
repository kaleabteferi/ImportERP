import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Ship, Wrench, Banknote, Menu, X, LogOut, KeyRound, Monitor, ChevronDown } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useViewMode } from '../../lib/viewMode'
import { hasAccess, ROLE_LABELS } from '../../lib/roles'
import type { Role } from '../../lib/roles'
import { NAV_LINKS } from '../../lib/navLinks'
import { ChangePinModal } from '../ChangePinModal'

const tabs: Array<{ to: string; icon: typeof LayoutDashboard; label: string; allow: Role[]; warehouseScope?: boolean }> = [
  { to: '/',                    icon: LayoutDashboard, label: 'Home',       allow: [], warehouseScope: true },
  { to: '/shipments',           icon: Ship,            label: 'Shipments',  allow: ['operations_marketing'] },
  { to: '/production',          icon: Wrench,          label: 'Production', allow: ['manufacturing_sales'] },
  { to: '/warehouse-operations',icon: Wrench,          label: 'Warehouse',  allow: [], warehouseScope: true },
  { to: '/money-tracking',      icon: Banknote,        label: 'Money',      allow: ['accounting_finance'] },
]

// The 5 tabs above are the curated, most-used-on-the-move destinations —
// everything else in the app (Suppliers, RFQs, Djibouti, Customers,
// Products, BOMs, Inventory, Finance/HR/System pages, ...) previously had
// no way to be reached at all while in mobile mode, since Layout.tsx hides
// the desktop Sidebar here. "More" opens the same page list the sidebar
// uses, filtered by role, so nothing is a dead end just because you're on
// a phone.
function MoreMenu({ onClose }: { onClose: () => void }) {
  const { profile, warehouseAssignments, signOut } = useAuth()
  const { toggleMode } = useViewMode()
  const role = profile?.role as Role | undefined
  const location = useLocation()
  const [showChangePin, setShowChangePin] = useState(false)
  const visibleGroups = NAV_LINKS
    .map(group => ({ ...group, items: group.items.filter(link => hasAccess(role, link.allow, warehouseAssignments, link.warehouseScope)) }))
    .filter(group => group.items.length > 0)
  const activeSection = visibleGroups.find(group => group.items.some(link => link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)))?.section
  const [openSections, setOpenSections] = useState<string[]>(['Overview'])

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mobile-more-sheet bg-white rounded-t-[24px] max-h-[85vh] flex flex-col shadow-[var(--shadow-card-xl)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-sm font-medium">{profile?.full_name ?? 'Unnamed'}</p>
            <p className="text-xs text-gray-400">{role ? ROLE_LABELS[role] : profile?.role}</p>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="p-1.5 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.section}>
              <button type="button" onClick={() => setOpenSections(current => current.includes(group.section) ? current.filter(section => section !== group.section) : [...current, group.section])} aria-expanded={openSections.includes(group.section) || activeSection === group.section} className="mb-1 flex min-h-11 w-full items-center justify-between rounded-xl px-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]"><span>{group.section}</span><ChevronDown size={15} className={`transition-transform ${openSections.includes(group.section) || activeSection === group.section ? '' : '-rotate-90'}`} /></button>
              <div hidden={!openSections.includes(group.section) && activeSection !== group.section} className="grid grid-cols-3 gap-2">
                {group.items.map(link => (
                  <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={onClose}
                    className={({ isActive }) => `flex flex-col items-center gap-1.5 p-2.5 rounded-card border text-center ${isActive ? 'border-accent bg-accent/10' : 'border-gray-200'}`}>
                    <link.icon size={17} strokeWidth={1.5} className="text-gray-500" />
                    <span className="text-[10px] leading-tight">{link.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 shrink-0">
          <button onClick={() => setShowChangePin(true)} className="flex items-center gap-1.5 text-xs text-gray-500">
            <KeyRound size={13} strokeWidth={1.5} /> Change PIN
          </button>
          <button onClick={toggleMode} className="flex items-center gap-1.5 text-xs text-gray-500">
            <Monitor size={13} strokeWidth={1.5} /> Full version
          </button>
          <button onClick={signOut} className="flex items-center gap-1.5 text-xs text-gray-500">
            <LogOut size={13} strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </div>
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} />}
    </div>
  )
}

export function MobileNav() {
  const [showMore, setShowMore] = useState(false)
  const { profile, warehouseAssignments } = useAuth()
  const role = profile?.role as Role | undefined
  const visibleTabs = tabs.filter(tab => hasAccess(role, tab.allow, warehouseAssignments, tab.warehouseScope)).slice(0, 4)

  return (
    <>
      <nav className="mobile-bottom-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--color-background-primary)',
        borderTop: '0.5px solid var(--color-border-tertiary)',
        display: 'flex', zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {visibleTabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              minHeight: '64px', padding: '6px 4px 8px', gap: '3px', textDecoration: 'none',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontSize: '11px', fontWeight: isActive ? 650 : 500,
            })}
          >
            {({ isActive }) => (
              <>
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '34px', height: '22px', borderRadius: '9999px',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                }}>
                  <tab.icon size={19} strokeWidth={1.5} color={isActive ? 'var(--color-accent-foreground)' : 'currentColor'} />
                </span>
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => setShowMore(true)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            minHeight: '64px', padding: '6px 4px 8px', gap: '3px', background: 'none', border: 'none',
            color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <Menu size={22} strokeWidth={1.5} />
          More
        </button>
      </nav>
      {showMore && <MoreMenu onClose={() => setShowMore(false)} />}
    </>
  )
}
