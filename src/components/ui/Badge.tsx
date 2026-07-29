// src/components/ui/Badge.tsx
//
// Status pill, replacing the many ad hoc `<span className="text-[10px]
// px-1.5 py-0.5 rounded-full bg-X-50 text-X-600">` variants scattered
// across pages (order status, payment status, frequent-customer flags,
// etc). One shared set of color variants keeps them visually consistent.
import type { ReactNode } from 'react'

type Variant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

const VARIANT_CLASSES: Record<Variant, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  accent: 'bg-accent text-accent-foreground',
}

interface Props {
  variant?: Variant
  icon?: ReactNode
  children: ReactNode
}

export function Badge({ variant = 'neutral', icon, children }: Props) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${VARIANT_CLASSES[variant]}`}>
      {icon}{children}
    </span>
  )
}
