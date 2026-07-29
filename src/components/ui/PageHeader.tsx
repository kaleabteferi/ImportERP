// src/components/ui/PageHeader.tsx
//
// Standardizes the title + subtitle + action-buttons row that every page
// used to hand-roll individually (`<div className="flex items-center
// justify-between mb-5">...`). One place to keep that layout consistent
// across the whole app's redesign.
import type { ReactNode } from 'react'

interface Props {
  icon?: ReactNode
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ icon, title, subtitle, actions }: Props) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h1 className="text-[32px] leading-tight font-semibold tracking-tight flex items-center gap-2.5">
          {icon}{title}
        </h1>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
