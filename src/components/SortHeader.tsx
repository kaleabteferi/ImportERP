import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { SortDir } from '../lib/useSort'

export function SortHeader({ label, active, dir, onClick, align }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'right'
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-0.5 hover:text-gray-600 transition-colors ${align === 'right' ? 'ml-auto' : ''}`}>
      {label}
      {active ? (dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} className="opacity-40" />}
    </button>
  )
}
