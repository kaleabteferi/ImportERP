// src/components/shipments/ContainerTimelineTabs.tsx
//
// Bridges the "containers share one shipment" model into TimelinePanel,
// which tracks one container's (or the whole shipment's) timeline/demurrage
// data at a time. A shipment with 0 containers (manual, PI-less create) or
// exactly 1 (every pre-existing shipment, and the common single-container
// order) renders TimelinePanel directly with no selector chrome -- visually
// identical to before this feature existed. 2+ containers get a tab strip,
// each mounting its own independently-tracked TimelinePanel instance.
import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { TimelinePanel } from './TimelinePanel'
import { AliChargesTable } from './AliChargesTable'
import { ShipmentOwedSummary } from './ShipmentOwedSummary'

interface ContainerRow {
  id: string
  container_number: string
  status: string
  eta_djibouti: string | null
}

export function ContainerTimelineTabs({ shipmentId, fxRate, containerVolumeM3, djiboutiReceivedAt }: {
  shipmentId: string
  fxRate: number
  containerVolumeM3?: number
  djiboutiReceivedAt?: string | null
}) {
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeContainerId, setActiveContainerId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase.from('containers')
      .select('id, container_number, status, eta_djibouti')
      .eq('shipment_id', shipmentId)
      .order('container_number')
      .then(({ data }) => {
        if (cancelled) return
        const rows = data ?? []
        setContainers(rows)
        setActiveContainerId(rows[0]?.id ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [shipmentId])

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading timeline…</div>
  }

  // 0 containers (manual shipment) or exactly 1 -- no selector chrome.
  const singleContainerId = containers.length === 1 ? containers[0].id : null
  const showTabs = containers.length > 1

  return (
    <div className="space-y-4">
      <ShipmentOwedSummary
        shipmentId={shipmentId}
        containerIds={containers.map(c => c.id)}
        fxRate={fxRate}
        djiboutiReceivedAt={djiboutiReceivedAt}
      />

      {showTabs && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {containers.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveContainerId(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap shrink-0 font-mono
                ${activeContainerId === c.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {c.container_number}
              {c.eta_djibouti && <span className={activeContainerId === c.id ? 'text-blue-100' : 'text-gray-400'}> · ETA {c.eta_djibouti}</span>}
            </button>
          ))}
        </div>
      )}

      <TimelinePanel
        key={showTabs ? activeContainerId ?? 'none' : 'single'}
        shipmentId={shipmentId}
        containerId={showTabs ? activeContainerId : singleContainerId}
        fxRate={fxRate}
        containerVolumeM3={containerVolumeM3}
        djiboutiReceivedAt={djiboutiReceivedAt}
      />

      {/* Ali's forwarder invoice is one combined bill regardless of how many
          containers arrived under it -- mounted once here, not per container. */}
      <AliChargesTable shipmentId={shipmentId} fxRate={fxRate} />
    </div>
  )
}
