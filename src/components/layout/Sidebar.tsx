import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, KeyRound } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { hasAccess, ROLE_LABELS } from '../../lib/roles'
import type { Role } from '../../lib/roles'
import { NAV_LINKS } from '../../lib/navLinks'
import { ChangePinModal } from '../ChangePinModal'

const links = NAV_LINKS

// The app's 5 highest-traffic, "run the business day-to-day" pages get a
// subtly bolder treatment in the nav — a small accent dot plus bolder label
// even when not the active page — so they read as the main pages at a
// glance rather than blending into the rest of the list.
const MAIN_PAGE_ROUTES = new Set(['/money-tracking', '/sales', '/inventory', '/proforma-invoices', '/production'])

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
      width: '208px', height: '100vh', background: 'var(--color-panel-dark)',
      color: 'var(--color-panel-dark-foreground)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto'
    }}>
      <div style={{ padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em' }}>ImportERP</div>
        <div style={{ fontSize: '11px', color: 'rgba(245,246,242,0.45)', marginTop: '2px' }}>
          Addis Ababa · ETB/USD
        </div>
      </div>
      <nav style={{ padding: '10px', flex: 1 }}>
        {visibleLinks.map((group, gi) => (
          <div key={group.section} className="stagger-row" style={{ '--stagger-index': gi } as React.CSSProperties}>
            <div style={{
              fontSize: '10px', color: 'rgba(245,246,242,0.35)',
              padding: '12px 8px 5px', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
            }}>
              {group.section}
            </div>
            {group.items.map(link => {
              const isMain = MAIN_PAGE_ROUTES.has(link.to)
              return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '9px',
                  padding: '7px 10px', borderRadius: '9999px', marginBottom: '2px',
                  fontSize: '12px', textDecoration: 'none',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                  color: isActive ? 'var(--color-accent-foreground)' : (isMain ? 'rgba(245,246,242,0.92)' : 'rgba(245,246,242,0.75)'),
                  fontWeight: isActive ? 600 : (isMain ? 600 : 400),
                  transition: 'background-color 150ms ease, color 150ms ease',
                })}
              >
                {({ isActive }) => (
                  <>
                    <link.icon size={15} strokeWidth={1.5} />
                    {link.label}
                    {isMain && !isActive && (
                      <span style={{
                        width: '5px', height: '5px', borderRadius: '9999px',
                        background: 'var(--color-accent)', marginLeft: 'auto', flexShrink: 0,
                      }} />
                    )}
                  </>
                )}
              </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{profile?.full_name ?? 'Unnamed'}</div>
        <div style={{ fontSize: '10px', color: 'rgba(245,246,242,0.4)', marginBottom: '9px' }}>
          {role ? ROLE_LABELS[role] : profile?.role}
        </div>
        <button
          onClick={() => setShowChangePin(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            color: 'rgba(245,246,242,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            marginBottom: '8px', transition: 'color 150ms ease',
          }}
        >
          <KeyRound size={13} strokeWidth={1.5} /> Change PIN
        </button>
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            color: 'rgba(245,246,242,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            transition: 'color 150ms ease',
          }}
        >
          <LogOut size={13} strokeWidth={1.5} /> Sign out
        </button>
      </div>
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} />}
    </aside>
  )
}
