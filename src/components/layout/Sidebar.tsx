import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut, KeyRound } from 'lucide-react'
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
const MAIN_PAGE_ROUTES = new Set(['/money-tracking', '/sales', '/inventory', '/proforma-invoices', '/warehouse-operations'])

export function Sidebar() {
  const { profile, warehouseAssignments, signOut } = useAuth()
  const role = profile?.role as Role | undefined
  const location = useLocation()
  const [showChangePin, setShowChangePin] = useState(false)
  const visibleLinks = links
    .map(group => ({
      ...group,
      items: group.items.filter(link => hasAccess(role, link.allow, warehouseAssignments, link.warehouseScope)),
    }))
    .filter(group => group.items.length > 0)
  const activeSection = visibleLinks.find(group => group.items.some(link => link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)))?.section
  const [openSections, setOpenSections] = useState<string[]>(() => ['Overview'])

  function toggleSection(section: string) {
    setOpenSections(current => current.includes(section) ? current.filter(item => item !== section) : [...current, section])
  }
  return (
    <aside style={{
      width: '224px', height: '100vh', background: 'var(--color-panel-dark)',
      color: 'var(--color-panel-dark-foreground)',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden'
    }}>
      <div style={{ padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em' }}>ImportERP</div>
        <div style={{ fontSize: '12px', color: 'rgba(245,246,242,0.62)', marginTop: '2px' }}>
          Addis Ababa · ETB/USD
        </div>
      </div>
      <nav className="erp-sidebar-scroll" style={{ padding: '10px', flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {visibleLinks.map((group, gi) => (
          <div key={group.section} className="stagger-row" style={{ '--stagger-index': gi } as React.CSSProperties}>
            <button type="button" onClick={() => toggleSection(group.section)} aria-expanded={openSections.includes(group.section) || activeSection === group.section} style={{
              width: '100%', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: '11px', color: activeSection === group.section ? 'rgba(245,246,242,0.92)' : 'rgba(245,246,242,0.58)',
              padding: '10px 8px 5px', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 650,
              background: 'transparent', border: 0, cursor: 'pointer',
            }}>
              <span>{group.section}</span><ChevronDown size={14} style={{ transform: openSections.includes(group.section) || activeSection === group.section ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 180ms ease' }} />
            </button>
            <div hidden={!openSections.includes(group.section) && activeSection !== group.section}>
            {group.items.map(link => {
              const isMain = MAIN_PAGE_ROUTES.has(link.to)
              return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '9px',
                  minHeight: '38px', padding: '8px 10px', borderRadius: '9999px', marginBottom: '2px',
                  fontSize: '13px', textDecoration: 'none',
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
          </div>
        ))}
      </nav>
      <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{profile?.full_name ?? 'Unnamed'}</div>
        <div style={{ fontSize: '11px', color: 'rgba(245,246,242,0.58)', marginBottom: '9px' }}>
          {role ? ROLE_LABELS[role] : profile?.role}
        </div>
        <button
          onClick={() => setShowChangePin(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', minHeight: '32px',
            color: 'rgba(245,246,242,0.72)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            marginBottom: '8px', transition: 'color 150ms ease',
          }}
        >
          <KeyRound size={13} strokeWidth={1.5} /> Change PIN
        </button>
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', minHeight: '32px',
            color: 'rgba(245,246,242,0.72)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
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
