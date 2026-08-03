// src/components/ui/Card.tsx
//
// The white (or dark-panel) rounded bordered container used for every
// list/table/summary block across the app. `variant="dark"` is the
// reference design's charcoal side-panel look (e.g. a compact "current
// status" list next to a lighter detail view) -- a deliberate dark surface
// independent of the app's own light/dark theme toggle, so it reads the
// same in both.
import type { ReactNode, HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: 'light' | 'dark'
  padded?: boolean
  children: ReactNode
}

export function Card({ variant = 'light', padded = false, className = '', children, ...rest }: Props) {
  // "No unnecessary borders. Only shadows" -- the design spec's cards lift
  // off the page via a soft shadow alone; dark-panel still gets a hairline
  // since it has no shadow contrast against a dark app theme.
  const base = variant === 'dark'
    ? 'bg-panel-dark text-panel-dark-foreground border border-black/10'
    : 'bg-white dark:border dark:border-gray-700'
  return (
    <div className={`app-card ${base} rounded-card overflow-hidden shadow-[var(--shadow-card-sm)] ${padded ? 'p-6' : ''} ${className}`} {...rest}>
      {children}
    </div>
  )
}
