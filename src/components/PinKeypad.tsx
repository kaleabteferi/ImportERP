import { Delete } from 'lucide-react'

export function Dots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex items-center justify-center gap-3 my-6">
      {Array.from({ length }).map((_, i) => (
        <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${i < filled ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`} />
      ))}
    </div>
  )
}

export function Keypad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-[260px] mx-auto">
      {keys.map((k, i) => {
        if (k === '') return <div key={i} />
        if (k === 'back') {
          return (
            <button key={i} onClick={onBackspace} disabled={disabled}
              className="h-14 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors disabled:opacity-40">
              <Delete size={18} />
            </button>
          )
        }
        return (
          <button key={i} onClick={() => onDigit(k)} disabled={disabled}
            className="h-14 rounded-2xl bg-gray-50 hover:bg-blue-50 hover:text-blue-700 flex items-center justify-center text-lg font-medium text-gray-700 transition-colors disabled:opacity-40">
            {k}
          </button>
        )
      })}
    </div>
  )
}
