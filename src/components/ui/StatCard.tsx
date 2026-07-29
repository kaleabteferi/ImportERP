// src/components/ui/StatCard.tsx
//
// Big bold headline number with a small label above it, matching the
// reference design's "Overdue / Due within next month / ..." summary
// cards. Used for the metric row at the top of list pages.
import type { ReactNode } from 'react'
import { Card } from './Card'

interface Props {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  accent?: boolean
}

export function StatCard({ label, value, hint, accent }: Props) {
  return (
    <Card padded className={accent ? 'ring-1 ring-accent/40' : ''}>
      <p className="text-xs text-gray-400 mb-1.5">{label}</p>
      <p className="text-[28px] leading-tight font-semibold tracking-tight">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1.5">{hint}</p>}
    </Card>
  )
}
