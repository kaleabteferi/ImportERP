import { useState } from 'react'
import { X, Loader2, Check, ClipboardPaste, Trash2, AlertTriangle } from 'lucide-react'

export interface BulkImportColumn {
  key: string
  label: string
  required?: boolean
  width?: string
}

interface BulkImportModalProps {
  title: string
  columns: BulkImportColumn[]
  exampleCsv: string
  helpText?: string
  onImport: (rows: Record<string, string>[]) => Promise<{ succeeded: number; errors: string[] }>
  onClose: () => void
  onImported: () => void
}

// Small CSV parser — handles quoted fields (with embedded commas/quotes),
// plain commas, and both \n and \r\n line endings. Not a full RFC-4180
// implementation, but covers what a pasted spreadsheet/export produces.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { inQuotes = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function normalizeKey(s: string) {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function parsePastedText(text: string, columns: BulkImportColumn[]): { rows: Record<string, string>[]; error: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [], error: null }

  const keyByNormalized = new Map(columns.flatMap(c => [[normalizeKey(c.key), c.key], [normalizeKey(c.label), c.key]] as [string, string][]))

  // JSON array of objects
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      const rows = arr.map((obj: any) => {
        const row: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj)) {
          const matchedKey = keyByNormalized.get(normalizeKey(k)) ?? k
          row[matchedKey] = v === null || v === undefined ? '' : String(v)
        }
        return row
      })
      return { rows, error: null }
    } catch (e: any) {
      return { rows: [], error: `Couldn't parse as JSON: ${e?.message ?? 'invalid syntax'}` }
    }
  }

  // CSV / TSV (tab-separated pastes from spreadsheets use the same shape)
  const delimiter = trimmed.includes('\t') && !trimmed.split('\n')[0].includes(',') ? '\t' : ','
  const lines = delimiter === '\t' ? trimmed.split(/\r?\n/).map(l => l.split('\t')) : parseCsv(trimmed)
  if (lines.length === 0) return { rows: [], error: null }

  const header = lines[0].map(h => keyByNormalized.get(normalizeKey(h)) ?? normalizeKey(h))
  const dataLines = lines.slice(1)
  const rows = dataLines.map(line => {
    const row: Record<string, string> = {}
    header.forEach((key, i) => { row[key] = (line[i] ?? '').trim() })
    return row
  })
  return { rows, error: null }
}

export function BulkImportModal({ title, columns, exampleCsv, helpText, onImport, onClose, onImported }: BulkImportModalProps) {
  const [step, setStep] = useState<'paste' | 'preview'>('paste')
  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ succeeded: number; errors: string[] } | null>(null)

  function handleParse() {
    const { rows: parsed, error } = parsePastedText(pasted, columns)
    if (error) { setParseError(error); return }
    if (parsed.length === 0) { setParseError('Nothing to import — paste some rows first.'); return }
    setRows(parsed.map(r => Object.fromEntries(columns.map(c => [c.key, r[c.key] ?? '']))))
    setParseError(null)
    setStep('preview')
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    setRows(rs => rs.map((r, i) => i === rowIndex ? { ...r, [key]: value } : r))
  }
  function removeRow(rowIndex: number) {
    setRows(rs => rs.filter((_, i) => i !== rowIndex))
  }

  const missingRequired = rows.some(r => columns.some(c => c.required && !r[c.key]?.trim()))

  async function handleImport() {
    setImporting(true)
    try {
      const res = await onImport(rows)
      setResult(res)
      if (res.errors.length === 0) onImported()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-medium flex items-center gap-2"><ClipboardPaste size={16} className="text-blue-600" /> {title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {step === 'paste' ? (
            <div className="space-y-3">
              {helpText && <p className="text-xs text-gray-500">{helpText}</p>}
              <p className="text-xs text-gray-400">
                Paste a CSV/TSV table (e.g. copied from Excel, with a header row) or a JSON array of objects.
                Columns: {columns.map(c => c.label + (c.required ? ' *' : '')).join(', ')}.
              </p>
              <textarea
                value={pasted}
                onChange={e => setPasted(e.target.value)}
                rows={12}
                placeholder={exampleCsv}
                className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
              {parseError && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={12} /> {parseError}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {result && (
                <div className={`px-3 py-2 rounded-lg text-xs ${result.errors.length > 0 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                  {result.succeeded} row{result.succeeded === 1 ? '' : 's'} imported.
                  {result.errors.length > 0 && (
                    <ul className="list-disc pl-4 mt-1">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400">{rows.length} row{rows.length === 1 ? '' : 's'} parsed — check and fix anything before importing.</p>
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {columns.map(c => <th key={c.key} className="text-left px-2 py-1.5 font-medium text-gray-400 whitespace-nowrap">{c.label}{c.required && ' *'}</th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-gray-50">
                        {columns.map(c => (
                          <td key={c.key} className="px-1 py-1">
                            <input
                              value={row[c.key] ?? ''}
                              onChange={e => updateCell(ri, c.key, e.target.value)}
                              style={{ width: c.width ?? '100px' }}
                              className={`px-1.5 py-1 text-xs border rounded ${c.required && !row[c.key]?.trim() ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                            />
                          </td>
                        ))}
                        <td><button onClick={() => removeRow(ri)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missingRequired && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={12} /> Fill in every required (*) field before importing.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
          {step === 'preview' && (
            <button onClick={() => { setStep('paste'); setResult(null) }} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 mr-auto">Back to paste</button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">{result ? 'Close' : 'Cancel'}</button>
          {step === 'paste' ? (
            <button onClick={handleParse} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">Parse & preview</button>
          ) : (
            <button onClick={handleImport} disabled={importing || rows.length === 0 || missingRequired}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {importing ? 'Importing…' : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
