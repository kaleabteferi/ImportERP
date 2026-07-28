// src/components/shipments/ShipmentStatusStepper.tsx
//
// "Where in the roadmap are we now?" -- a compact horizontal stepper across
// the shipment_status enum's 8 stages, reusing the exact numbered-circle +
// connector-bar visual already established in CostFinalization.tsx's
// stepper so this doesn't introduce a new visual language.
import { Check } from 'lucide-react'

const STAGES: { status: string; label: string }[] = [
  { status: 'ORDERED',            label: 'Ordered' },
  { status: 'IN_PRODUCTION',      label: 'In production' },
  { status: 'SHIPPED',            label: 'Shipped' },
  { status: 'AT_DJIBOUTI',        label: 'At Djibouti' },
  { status: 'IN_TRANSIT',         label: 'In transit' },
  { status: 'AT_CUSTOMS',         label: 'At customs' },
  { status: 'WAREHOUSE_RECEIVED', label: 'Received' },
  { status: 'COMPLETED',          label: 'Completed' },
]

export function ShipmentStatusStepper({ status }: { status: string }) {
  const currentIndex = STAGES.findIndex(s => s.status === status)
  const n = currentIndex === -1 ? 0 : currentIndex

  return (
    <div className="flex items-center gap-0 mb-5">
      {STAGES.map((s, i) => {
        const done = i < n
        const active = i === n
        return (
          <div key={s.status} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 min-w-[64px]">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center
                               text-xs font-medium border-2 transition-all
                ${done   ? 'bg-green-100 border-green-600 text-green-700' : ''}
                ${active ? 'bg-blue-50 border-blue-600 text-blue-700'     : ''}
                ${!done && !active ? 'bg-gray-50 border-gray-200 text-gray-400' : ''}`}>
                {done ? <Check size={11} /> : i + 1}
              </div>
              <span className={`text-[10px] text-center leading-tight
                ${active ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors
                ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
