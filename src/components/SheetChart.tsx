// A small, self-contained SVG chart for the calculator's "visualize a
// range" feature. Deliberately simple: one hue for a single value series
// (bar/line — magnitude is the job), a short fixed categorical order for
// pie slices (identity is the job), thin marks, recessive gridlines, no
// dual axis, direct labels instead of a legend where there's room for one.

const SEQUENTIAL_HUE = '#2563eb' // blue-600 — matches the app's primary accent
const CATEGORICAL = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#7c3aed', '#0891b2', '#db2777', '#6b7280']

export interface ChartDatum { label: string; value: number }

export function SheetChart({ type, data }: { type: 'bar' | 'line' | 'pie'; data: ChartDatum[] }) {
  if (data.length === 0) return <p className="text-xs text-gray-400 text-center py-8">No data to chart yet.</p>

  const width = 560, height = 260, padding = { top: 16, right: 16, bottom: 32, left: 44 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const maxVal = Math.max(...data.map(d => d.value), 0)
  const minVal = Math.min(...data.map(d => d.value), 0)
  const range = maxVal - minVal || 1
  const yOf = (v: number) => padding.top + plotH - ((v - minVal) / range) * plotH
  const gridLines = 4

  if (type === 'pie') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
    let angle = -Math.PI / 2
    const cx = 110, cy = 110, r = 90
    const slices = data.map((d, i) => {
      const frac = total > 0 ? Math.max(0, d.value) / total : 0
      const start = angle
      const end = angle + frac * Math.PI * 2
      angle = end
      const large = end - start > Math.PI ? 1 : 0
      const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end)
      return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color: CATEGORICAL[i % CATEGORICAL.length], label: d.label, value: d.value, pct: frac * 100 }
    })
    return (
      <div className="flex items-center gap-6 flex-wrap justify-center">
        <svg width={220} height={220} role="img" aria-label="Pie chart">
          {slices.map((s, i) => (
            <path key={i} d={s.d} fill={s.color} stroke="white" strokeWidth={2}>
              <title>{`${s.label}: ${s.value} (${s.pct.toFixed(1)}%)`}</title>
            </path>
          ))}
        </svg>
        <div className="space-y-1.5">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-gray-600">{s.label}</span>
              <span className="text-gray-400 font-mono">{s.value} ({s.pct.toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const barW = plotW / data.length
  const zeroY = yOf(0)

  return (
    <svg width={width} height={height} role="img" aria-label={`${type === 'bar' ? 'Bar' : 'Line'} chart`}>
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const v = minVal + (range * i) / gridLines
        const y = yOf(v)
        return (
          <g key={i}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padding.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#9ca3af">{Math.round(v)}</text>
          </g>
        )
      })}
      <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} stroke="#e5e7eb" strokeWidth={1} />

      {type === 'bar' && data.map((d, i) => {
        const x = padding.left + i * barW + barW * 0.15
        const w = barW * 0.7
        const y = Math.min(yOf(d.value), zeroY)
        const h = Math.abs(yOf(d.value) - zeroY)
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(h, 1)} rx={3} fill={SEQUENTIAL_HUE}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="#374151">{d.value}</text>
            <text x={x + w / 2} y={height - padding.bottom + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">{d.label}</text>
          </g>
        )
      })}

      {type === 'line' && (
        <>
          <polyline
            points={data.map((d, i) => `${padding.left + (i + 0.5) * barW},${yOf(d.value)}`).join(' ')}
            fill="none" stroke={SEQUENTIAL_HUE} strokeWidth={2}
          />
          {data.map((d, i) => {
            const x = padding.left + (i + 0.5) * barW
            const y = yOf(d.value)
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={4} fill="white" stroke={SEQUENTIAL_HUE} strokeWidth={2}>
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
                <text x={x} y={y - 8} textAnchor="middle" fontSize={10} fill="#374151">{d.value}</text>
                <text x={x} y={height - padding.bottom + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">{d.label}</text>
              </g>
            )
          })}
        </>
      )}
    </svg>
  )
}
