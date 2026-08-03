import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, PackageCheck } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

export interface CountLine {
  shipmentItemId: string
  productId: string
  productName: string
  sku?: string
  expectedQuantity: number
  expectedCartons?: number | null
  unitsPerCarton?: number | null
  unitOfMeasure?: string | null
  assemblyType?: string | null
  containerNumber?: string | null
}

export interface PlacementLocation { id: string; code: string; name: string | null }

export interface CountResultLine {
  shipmentItemId: string
  productId: string
  productName: string
  expectedQuantity: number
  countedQuantity: number
  countedCartons: number | null
  damagedQuantity: number
  verified: boolean
  notes: string
  placementLocationId: string | null
}

interface DraftLine {
  counted: string
  cartons: string
  damaged: string
  notes: string
  placementLocationId: string
  verified: boolean
}

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

export function ReceivingCountModal({
  open, title, subtitle, lines, locations, saving, error, requireCheckoff = false, onCancel, onSubmit,
}: {
  open: boolean
  title: string
  subtitle?: string
  lines: CountLine[]
  locations?: PlacementLocation[]
  saving: boolean
  error: string | null
  requireCheckoff?: boolean
  onCancel: () => void
  onSubmit: (result: CountResultLine[]) => void
}) {
  const hasLocations = !!locations?.length
  const initialDraft = (line: CountLine): DraftLine => ({
    counted: String(line.expectedQuantity),
    cartons: line.expectedCartons == null ? '' : String(line.expectedCartons),
    damaged: '0', notes: '', placementLocationId: '', verified: false,
  })
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>(() =>
    Object.fromEntries(lines.map(line => [line.shipmentItemId, initialDraft(line)])))

  function update(id: string, patch: Partial<DraftLine>) {
    setDrafts(previous => {
      const line = lines.find(item => item.shipmentItemId === id)
      return { ...previous, [id]: { ...(previous[id] ?? initialDraft(line!)), ...patch } }
    })
  }

  function submit() {
    onSubmit(lines.map(line => {
      const draft = drafts[line.shipmentItemId] ?? initialDraft(line)
      const counted = Math.max(0, Number(draft.counted) || 0)
      return {
        shipmentItemId: line.shipmentItemId,
        productId: line.productId,
        productName: line.productName,
        expectedQuantity: line.expectedQuantity,
        countedQuantity: counted,
        countedCartons: draft.cartons === '' ? null : Math.max(0, Number(draft.cartons) || 0),
        damagedQuantity: Math.min(counted, Math.max(0, Number(draft.damaged) || 0)),
        verified: draft.verified,
        notes: draft.notes.trim(),
        placementLocationId: draft.placementLocationId || null,
      }
    }))
  }

  const allVerified = lines.every(line => drafts[line.shipmentItemId]?.verified)

  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="max-w-5xl" footer={<>
      <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
      <Button onClick={submit} disabled={requireCheckoff && !allVerified} loading={saving} icon={<PackageCheck size={13} />}>Post counted quantities</Button>
    </>}>
      {subtitle && <p className="text-xs text-gray-500 -mt-1 mb-1">{subtitle}</p>}
      {error && <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}</div>}
      {!lines.length ? <p className="text-xs text-gray-400 py-4 text-center">No lines to count.</p> : (
        <div className="space-y-3">
          {requireCheckoff && <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">Count cartons and units, record damage, choose a storage area, then check every line as verified.</div>}
          {lines.map(line => {
            const draft = drafts[line.shipmentItemId] ?? initialDraft(line)
            const difference = (Number(draft.counted) || 0) - line.expectedQuantity
            return <div key={line.shipmentItemId} className={`rounded-2xl border p-3 transition-colors ${draft.verified ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{line.productName}</p>
                  <p className="text-[11px] text-gray-500 font-mono">{line.sku ?? 'No SKU'} · expected {N(line.expectedQuantity)} {line.unitOfMeasure ?? 'units'}{line.expectedCartons != null ? ` in ${N(line.expectedCartons)} cartons` : ''}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">{line.assemblyType && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{line.assemblyType}</span>}{line.containerNumber && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Container {line.containerNumber}</span>}</div>
                  {difference !== 0 && <p className={`text-[10px] font-semibold mt-1 ${difference < 0 ? 'text-red-600' : 'text-amber-600'}`}>{difference < 0 ? `Short by ${N(-difference)}` : `Over by ${N(difference)}`}</p>}
                </div>
                {requireCheckoff && <button type="button" onClick={() => update(line.shipmentItemId, { verified: !draft.verified })} className={`shrink-0 flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${draft.verified ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}><CheckCircle2 size={13} />{draft.verified ? 'Verified' : 'Check off'}</button>}
              </div>
              <div className={`grid grid-cols-2 ${hasLocations ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-2`}>
                {line.expectedCartons != null && <Field label="Cartons unloaded"><input type="number" min="0" step="1" value={draft.cartons} onChange={event => update(line.shipmentItemId, { cartons: event.target.value })} className="receiving-input" /></Field>}
                <Field label="Units counted"><input type="number" min="0" step="0.01" value={draft.counted} onChange={event => update(line.shipmentItemId, { counted: event.target.value })} className="receiving-input" /></Field>
                <Field label="Damaged"><input type="number" min="0" step="0.01" value={draft.damaged} onChange={event => update(line.shipmentItemId, { damaged: event.target.value })} className="receiving-input" /></Field>
                {hasLocations && <Field label="Storage area"><select value={draft.placementLocationId} onChange={event => update(line.shipmentItemId, { placementLocationId: event.target.value })} className="receiving-input"><option value="">Leave unplaced</option>{locations!.map(location => <option key={location.id} value={location.id}>{location.code}{location.name ? ` — ${location.name}` : ''}</option>)}</select></Field>}
                <label className="col-span-2 md:col-span-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">Notes<input value={draft.notes} onChange={event => update(line.shipmentItemId, { notes: event.target.value })} placeholder="Short, damaged, seal issue..." className="receiving-input" /></label>
              </div>
            </div>
          })}
        </div>
      )}
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}{children}</label>
}
