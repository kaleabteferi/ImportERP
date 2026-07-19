import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Ship, Wrench, Banknote, BarChart3, Menu, X, LogOut, KeyRound, Monitor } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useViewMode } from '../../lib/viewMode'
import { hasAccess, ROLE_LABELS } from '../../lib/roles'
import type { Role } from '../../lib/roles'
import { NAV_LINKS } from '../../lib/navLinks'
import { ChangePinModal } from '../ChangePinModal'

const tabs = [
  { to: '/',              icon: LayoutDashboard, label: 'Home'       },
  { to: '/shipments',     icon: Ship,            label: 'Shipments'  },
  { to: '/production',    icon: Wrench,          label: 'Production' },
  { to: '/money-tracking',icon: Banknote,        label: 'Money'      },
  { to: '/reports',       icon: BarChart3,       label: 'Reports'    },
]

// The 5 tabs above are the curated, most-used-on-the-move destinations —
// everything else in the app (Suppliers, RFQs, Djibouti, Customers,
// Products, BOMs, Inventory, Finance/HR/System pages, ...) previously had
// no way to be reached at all while in mobile mode, since Layout.tsx hides
// the desktop Sidebar here. "More" opens the same page list the sidebar
// uses, filtered by role, so nothing is a dead end just because you're on
// a phone.
function MoreMenu({ onClose }: { onClose: () => void }) {
  const { profile, signOut } = useAuth()
  const { toggleMode } = useViewMode()
  const role = profile?.role as Role | undefined
  const [showChangePin, setShowChangePin] = useState(false)
  const visibleGroups = NAV_LINKS
    .map(group => ({ ...group, items: group.items.filter(link => link.allow.length === 0 || hasAccess(role, link.allow)) }))
    .filter(group => group.items.length > 0)

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-sm font-medium">{profile?.full_name ?? 'Unnamed'}</p>
            <p className="text-xs text-gray-400">{role ? ROLE_LABELS[role] : profile?.role}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.section}>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">{group.section}</p>
              <div className="grid grid-cols-3 gap-2">
                {group.items.map(link => (
                  <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={onClose}
                    className={({ isActive }) => `flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center ${isActive ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
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

  return (
    <>
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
              color: isActive ? 'var(--color-text-info)' : 'var(--color-text-tertiary)',
              fontSize: '10px',
            })}
          >
            <tab.icon size={22} strokeWidth={1.5} />
            {tab.label}
          </NavLink>
        ))}
        <button
          onClick={() => setShowMore(true)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '8px 4px', gap: '2px', background: 'none', border: 'none',
            color: 'var(--color-text-tertiary)', fontSize: '10px', cursor: 'pointer',
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
