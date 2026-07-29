// src/components/ui/Button.tsx
//
// Primary/secondary/danger button variants, replacing the repeated
// `className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
// text-xs rounded-lg hover:bg-blue-700 ..."` strings duplicated across
// every page. Primary now uses the redesign's lime accent instead of blue.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-accent-foreground hover:brightness-95',
  secondary: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-transparent',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', loading, icon, disabled, className = '', children, ...rest }: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full
        transition-colors disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}
