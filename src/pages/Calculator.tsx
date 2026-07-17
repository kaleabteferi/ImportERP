import { useState, useEffect, useMemo, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  evaluateSheet, formatCellValue, isCellError, expandRange, colIndexToLetter, cellId,
  type CellMap, type CellValue,
} from '../lib/spreadsheet'
import { SHEET_TEMPLATES } from '../lib/spreadsheetTemplates'
import { SheetChart, type ChartDatum } from '../components/SheetChart'
import { fetchSpreadsheets, createSpreadsheet, updateSpreadsheet, deleteSpreadsheet, type SpreadsheetRow } from '../api/spreadsheets'
import {
  Calculator as CalcIcon, Plus, Save, Trash2, Loader2, FileSpreadsheet,
  BarChart3, LineChart, PieChart, X, Sparkles,
} from 'lucide-react'

const COLS = 10
const ROWS = 30

function SheetCell({ id, raw, display, hasError, selected, onFocus, onCommit }: {
  id: string; raw: string; display: string; hasError: boolean; selected: boolean
  onFocus: (id: string) => void
  onCommit: (id: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(raw)
  useEffect(() => { if (!editing) setLocal(raw) }, [raw, editing])

  return (
    <input
      value={editing ? local : display}
      onFocus={() => { setEditing(true); setLocal(raw); onFocus(id) }}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { setEditing(false); if (local !== raw) onCommit(id, local) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur() }}
      className={`w-full h-7 px-1.5 text-xs border-r border-b border-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 relative
        ${hasError ? 'text-red-600 bg-red-50/50' : 'text-gray-700 bg-white'}
        ${raw.startsWith('=') ? 'font-mono' : ''}
        ${selected && !editing ? 'ring-1 ring-inset ring-blue-300' : ''}`}
      style={{ width: 84 }}
    />
  )
}

function parseRangeInput(input: string): string[] {
  const m = /^([A-Z]+[0-9]+):([A-Z]+[0-9]+)$/.exec(input.trim().toUpperCase())
  if (!m) return []
  try { return expandRange(m[1], m[2]) } catch { return [] }
}

export function Calculator() {
  const [sheets, setSheets] = useState<SpreadsheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled sheet')
  const [cells, setCells] = useState<CellMap>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('A1')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar')
  const [labelRange, setLabelRange] = useState('A2:A6')
  const [valueRange, setValueRange] = useState('B2:B6')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSheets(await fetchSpreadsheets())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load sheets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const computed = useMemo(() => evaluateSheet(cells), [cells])

  function commitCell(id: string, value: string) {
    setCells(prev => {
      const next = { ...prev }
      if (value.trim() === '') delete next[id]
      else next[id] = value
      return next
    })
    setDirty(true)
  }

  function selectSheet(row: SpreadsheetRow) {
    setActiveId(row.id)
    setName(row.name)
    setCells(row.data ?? {})
    setDirty(false)
    setError(null)
  }

  function startNewSheet(templateId?: string) {
    const template = templateId ? SHEET_TEMPLATES.find(t => t.id === templateId) : null
    setActiveId(null)
    setName(template ? template.label : 'Untitled sheet')
    setCells(template ? { ...template.cells } : {})
    setDirty(true)
    setShowTemplates(false)
    setSelected('A1')
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      if (activeId) {
        await updateSpreadsheet(activeId, { name, data: cells })
      } else {
        const row = await createSpreadsheet(name, cells)
        setActiveId(row.id)
      }
      setDirty(false)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save sheet.')
    } finally {
      setSaving(false)
    }
  }

  async function removeSheet(id: string) {
    if (!confirm('Delete this sheet? This can\'t be undone.')) return
    try {
      await deleteSpreadsheet(id)
      if (activeId === id) { setActiveId(null); setName('Untitled sheet'); setCells({}); setDirty(false) }
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete sheet.')
    }
  }

  const chartData: ChartDatum[] = useMemo(() => {
    const labelRefs = parseRangeInput(labelRange)
    const valueRefs = parseRangeInput(valueRange)
    const n = Math.min(labelRefs.length, valueRefs.length)
    const out: ChartDatum[] = []
    for (let i = 0; i < n; i++) {
      const lv: CellValue = computed[labelRefs[i]] ?? null
      const vv: CellValue = computed[valueRefs[i]] ?? null
      out.push({
        label: typeof lv === 'string' ? lv : formatCellValue(lv) || labelRefs[i],
        value: typeof vv === 'number' ? vv : 0,
      })
    }
    return out
  }, [labelRange, valueRange, computed])

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><CalcIcon size={18} /> Calculator</h1>
          <p className="text-xs text-gray-400 mt-0.5">A spreadsheet for your own math — formulas, ranges, and charts</p>
        </div>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-[200px_1fr] gap-4">
        {/* Sheet list */}
        <div>
          <button onClick={() => startNewSheet()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mb-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus size={13} /> New sheet
          </button>
          <button onClick={() => setShowTemplates(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mb-3 text-xs rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600">
            <Sparkles size={13} /> Templates
          </button>
          {showTemplates && (
            <div className="mb-3 space-y-1.5">
              {SHEET_TEMPLATES.map(t => (
                <button key={t.id} onClick={() => startNewSheet(t.id)}
                  className="w-full text-left px-2.5 py-2 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40">
                  <p className="text-xs font-medium text-gray-700">{t.label}</p>
                  <p className="text-xs text-gray-400 leading-tight mt-0.5">{t.description}</p>
                </button>
              ))}
            </div>
          )}

          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1.5 mt-4">Saved sheets</p>
          {loading ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2"><Loader2 size={12} className="animate-spin" /> Loading…</div>
          ) : sheets.length === 0 ? (
            <p className="text-xs text-gray-400">No saved sheets yet.</p>
          ) : (
            <div className="space-y-1">
              {sheets.map(s => (
                <div key={s.id}
                  className={`group flex items-center gap-1 px-2.5 py-2 rounded-lg border cursor-pointer text-xs
                    ${activeId === s.id ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                  onClick={() => selectSheet(s)}
                >
                  <FileSpreadsheet size={12} className="text-gray-400 shrink-0" />
                  <span className="flex-1 truncate text-gray-700">{s.name}</span>
                  <button onClick={e => { e.stopPropagation(); removeSheet(s.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 shrink-0">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sheet editor */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <input value={name} onChange={e => { setName(e.target.value); setDirty(true) }}
              className="flex-1 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button onClick={() => setShowChart(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border ${showChart ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <BarChart3 size={13} /> Chart
            </button>
            <button onClick={save} disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white disabled:opacity-40 hover:bg-green-700">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {dirty ? 'Save' : 'Saved'}
            </button>
          </div>

          {/* Formula bar */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-gray-400 w-10 text-center shrink-0">{selected}</span>
            <input
              value={cells[selected] ?? ''}
              onChange={e => commitCell(selected, e.target.value)}
              placeholder="Value, or a formula like =SUM(A1:A5)"
              className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {showChart && (
            <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="flex gap-1">
                  {([['bar', BarChart3], ['line', LineChart], ['pie', PieChart]] as const).map(([t, Icon]) => (
                    <button key={t} onClick={() => setChartType(t)}
                      className={`p-1.5 rounded-lg border ${chartType === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-400">Labels</span>
                <input value={labelRange} onChange={e => setLabelRange(e.target.value)}
                  className="w-24 px-2 py-1 text-xs font-mono border border-gray-200 rounded-lg" placeholder="A2:A6" />
                <span className="text-xs text-gray-400">Values</span>
                <input value={valueRange} onChange={e => setValueRange(e.target.value)}
                  className="w-24 px-2 py-1 text-xs font-mono border border-gray-200 rounded-lg" placeholder="B2:B6" />
                <button onClick={() => setShowChart(false)} className="ml-auto text-gray-300 hover:text-gray-500"><X size={14} /></button>
              </div>
              <SheetChart type={chartType} data={chartData} />
            </div>
          )}

          {/* Grid */}
          <div className="overflow-auto border border-gray-200 rounded-xl" style={{ maxHeight: 520 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `32px repeat(${COLS}, 84px)`, width: 'max-content' }}>
              <div className="sticky top-0 left-0 z-20 bg-gray-50 border-r border-b border-gray-200 h-7" />
              {Array.from({ length: COLS }).map((_, c) => (
                <div key={c} className="sticky top-0 z-10 bg-gray-50 border-r border-b border-gray-200 h-7 flex items-center justify-center text-xs font-medium text-gray-400">
                  {colIndexToLetter(c)}
                </div>
              ))}
              {Array.from({ length: ROWS }).map((_, r) => (
                <FragmentRow key={r}>
                  <div className="sticky left-0 z-10 bg-gray-50 border-r border-b border-gray-200 h-7 flex items-center justify-center text-xs text-gray-400">
                    {r + 1}
                  </div>
                  {Array.from({ length: COLS }).map((_, c) => {
                    const id = cellId(c, r)
                    const raw = cells[id] ?? ''
                    const val = computed[id]
                    const hasError = isCellError(val)
                    return (
                      <SheetCell
                        key={id} id={id} raw={raw}
                        display={formatCellValue(val)}
                        hasError={hasError}
                        selected={selected === id}
                        onFocus={setSelected}
                        onCommit={commitCell}
                      />
                    )
                  })}
                </FragmentRow>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>
}
