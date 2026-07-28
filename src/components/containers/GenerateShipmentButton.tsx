// src/components/containers/GenerateShipmentButton.tsx
//
// The bridge from the new PI/container flow into the existing, unmodified
// shipments pipeline (cost allocation, demurrage, customs, inventory
// receive, Djibouti forwarder, documents — all of it keys off shipment_id
// and stays untouched).
//
// One PI = one shipment, so this is a single button for the whole PI (not
// one per container) -- clicking it loops the create_shipment_from_container
// RPC across every container that doesn't have a shipment_id yet, posting
// each one's packed items into the same shared shipment (the RPC itself
// detects and reuses a sibling container's shipment_id). A container with
// nothing packed onto it yet is skipped, not failed -- it'll join next time
// this runs, once it has items. If every existing container is already
// linked, this becomes a plain "Open shipment" link; if a shipment exists
// but a newer/unpacked container still isn't linked, both the link and the
// button to pull it in show side by side.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ship, Loader2, ArrowRight } from 'lucide-react'
import { generateShipmentFromContainer } from '../../api/containers'

interface Props {
  containers: { id: string; shipment_id: string | null }[]
  onGenerated: () => void
}

export function GenerateShipmentButton({ containers, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingShipmentId = containers.find(c => c.shipment_id)?.shipment_id ?? null
  const unlinked = containers.filter(c => !c.shipment_id)
  const allLinked = containers.length > 0 && unlinked.length === 0

  async function generate() {
    setGenerating(true)
    setError(null)
    let anyReady = false
    try {
      for (const c of unlinked) {
        try {
          await generateShipmentFromContainer(c.id)
          anyReady = true
        } catch (e: any) {
          // A container with nothing packed onto it yet is expected and
          // fine to skip -- it'll join the shipment next time this runs.
          // Anything else (e.g. an unlinked product) is a real problem.
          const msg = e?.message ?? String(e)
          if (!/no line items yet|no packing list yet/i.test(msg)) throw e
        }
      }
      if (!anyReady) {
        setError('No container has packed items yet — split at least one line item onto a container first.')
        return
      }
      onGenerated()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setGenerating(false)
    }
  }

  if (allLinked) {
    return (
      <Link to={`/shipments/${existingShipmentId}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 text-xs rounded-lg hover:bg-green-100 transition-colors">
        <Ship size={13} /> Open shipment <ArrowRight size={12} />
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {existingShipmentId && (
        <Link to={`/shipments/${existingShipmentId}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 text-xs rounded-lg hover:bg-green-100 transition-colors">
          <Ship size={13} /> Open shipment <ArrowRight size={12} />
        </Link>
      )}
      <div>
        <button onClick={generate} disabled={generating || containers.length === 0}
          title={containers.length === 0 ? 'Add a container first' : existingShipmentId ? `Adds the packed items from ${unlinked.length} more container${unlinked.length === 1 ? '' : 's'} into the shared shipment` : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
          {generating
            ? <><Loader2 size={12} className="animate-spin" /> {existingShipmentId ? 'Adding…' : 'Generating…'}</>
            : existingShipmentId
              ? <><Ship size={13} /> Add {unlinked.length} more container{unlinked.length === 1 ? '' : 's'}</>
              : <><Ship size={13} /> Generate shipment</>}
        </button>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  )
}
