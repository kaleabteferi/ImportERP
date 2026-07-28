// src/components/containers/ContainerFillGauge.tsx
//
// "How full is this container, and how much room is left?" -- a real
// shipping-container illustration (corrugated body, door end with handles,
// corner castings, a subtle roof-line for depth) whose interior fills like
// a gauge as packed CBM grows toward the container's rated capacity.
// Capacities are fixed, real ISO container specs (not a live lookup --
// these don't change).
import { useId } from 'react'

const STANDARD_CAPACITY_M3: Record<string, number> = {
  '20GP': 33.2,
  '40GP': 67.7,
  '40HC': 76.3,
}

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 1 }).format(n)

const BODY_X = 16, BODY_Y = 16, BODY_W = 258, BODY_H = 72

export function ContainerFillGauge({ containerType, packedM3 }: { containerType: string; packedM3: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const capacity = STANDARD_CAPACITY_M3[containerType] ?? STANDARD_CAPACITY_M3['40HC']
  const pct = Math.max(0, Math.min(100, (packedM3 / capacity) * 100))
  const isOverfull = packedM3 > capacity

  const fill = isOverfull
    ? { from: '#f87171', to: '#dc2626' }
    : pct >= 90
      ? { from: '#fbbf24', to: '#d97706' }
      : { from: '#60a5fa', to: '#2563eb' }

  const fillWidth = BODY_W * (pct / 100)
  const ribCount = 14
  const ribs = Array.from({ length: ribCount - 1 }, (_, i) => BODY_X + ((i + 1) * BODY_W) / ribCount)

  return (
    <div className="w-full">
      <svg viewBox="0 0 300 100" className="w-full h-auto max-h-[84px]" role="img" aria-label={`Container ${N(pct)}% full`}>
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={fill.from} />
            <stop offset="100%" stopColor={fill.to} />
          </linearGradient>
          <linearGradient id={`steel-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f1f5f9" />
            <stop offset="55%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <clipPath id={`clip-${uid}`}>
            <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={5} />
          </clipPath>
        </defs>

        {/* subtle roof-line for depth */}
        <polygon points={`${BODY_X + 6},${BODY_Y} ${BODY_X + 16},${BODY_Y - 6} ${BODY_X + BODY_W + 2},${BODY_Y - 6} ${BODY_X + BODY_W - 8},${BODY_Y}`}
          fill="#dbe3ea" stroke="#94a3b8" strokeWidth="0.75" />

        {/* outer shell */}
        <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={5} fill={`url(#steel-${uid})`} stroke="#475569" strokeWidth="2" />

        {/* fill gauge */}
        <g clipPath={`url(#clip-${uid})`}>
          <rect x={BODY_X} y={BODY_Y} width={fillWidth} height={BODY_H} fill={`url(#fill-${uid})`} className="transition-all duration-700 ease-out" />
          <rect x={BODY_X} y={BODY_Y} width={fillWidth} height={BODY_H * 0.32} fill="white" opacity="0.18" className="transition-all duration-700 ease-out" />
          <line x1={BODY_X + fillWidth} y1={BODY_Y} x2={BODY_X + fillWidth} y2={BODY_Y + BODY_H} stroke="white" strokeOpacity="0.5" strokeWidth="1.5" className="transition-all duration-700 ease-out" />
        </g>

        {/* corrugation ribs (drawn over the fill, subtle) */}
        {ribs.map((x, i) => (
          <line key={i} x1={x} y1={BODY_Y + 2} x2={x} y2={BODY_Y + BODY_H - 2} stroke="#64748b" strokeOpacity="0.25" strokeWidth="1" />
        ))}

        {/* door end */}
        <rect x={BODY_X + BODY_W} y={BODY_Y} width="10" height={BODY_H} rx="2" fill="#475569" />
        <line x1={BODY_X + BODY_W + 5} y1={BODY_Y + 3} x2={BODY_X + BODY_W + 5} y2={BODY_Y + BODY_H - 3} stroke="#1e293b" strokeWidth="1.25" />
        <rect x={BODY_X + BODY_W + 1.5} y={BODY_Y + BODY_H * 0.32} width="7" height="3.5" rx="1" fill="#1e293b" />
        <rect x={BODY_X + BODY_W + 1.5} y={BODY_Y + BODY_H * 0.64} width="7" height="3.5" rx="1" fill="#1e293b" />

        {/* corner castings */}
        {[
          [BODY_X - 4, BODY_Y - 4], [BODY_X + BODY_W + 10 - 6, BODY_Y - 4],
          [BODY_X - 4, BODY_Y + BODY_H - 6], [BODY_X + BODY_W + 10 - 6, BODY_Y + BODY_H - 6],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="10" height="10" rx="2" fill="#334155" />
        ))}

        {/* percentage readout -- dark text with a white halo so it stays
            legible whether it sits over the filled or empty portion */}
        <text x={BODY_X + BODY_W / 2} y={BODY_Y + BODY_H / 2 + 7} textAnchor="middle"
          fontSize="22" fontWeight="700" fill="#1e293b"
          stroke="white" strokeWidth="4" paintOrder="stroke" style={{ fontFamily: 'inherit' }}>
          {N(pct)}%
        </text>
      </svg>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400">{containerType}</span>
        <span className={`text-xs font-mono ${isOverfull ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
          {N(packedM3)} / {N(capacity)} m³{isOverfull ? ' · over capacity' : ''}
        </span>
      </div>
    </div>
  )
}
