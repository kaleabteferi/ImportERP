// src/lib/packingSuggestion.ts
//
// Suggests how to split each proforma invoice line's remaining (unallocated)
// cartons across a set of containers, so packing a multi-container order
// doesn't have to be worked out by hand line-by-line. Pure function, no I/O
// -- the caller fetches remaining quantities/container usage and writes the
// resulting assignments back as normal pl_items rows, so the suggestion is
// just a starting point the user can still edit or delete afterward.
//
// Approach: first-fit-decreasing bin packing. Items are sorted by carton
// volume descending (biggest cartons placed first, the standard heuristic
// for minimizing wasted space), and each item's cartons are dropped into
// containers in order -- filling one container as full as it'll go before
// spilling into the next -- constrained by both remaining CBM and remaining
// payload weight per container.
//
// One deliberate guard against a real failure mode: after a big item fills
// a container almost to the brim, the leftover sliver is often just enough
// for ONE carton of whatever's next -- which technically "fits" but means a
// single unit of that item gets stranded in an otherwise-unrelated
// container while the rest of its stock ships elsewhere (extra customs
// paperwork per container, and nobody actually packs like that). A
// fragment is only accepted if it either finishes that item off entirely,
// or uses a genuinely meaningful share of the container's own capacity --
// see MIN_FRAGMENT_FRACTION below.
const MIN_FRAGMENT_FRACTION = 0.05

export interface SuggestionItemInput {
  piItemId: string
  remainingUnits: number
  /** Product's standard units-per-carton; without it we can't compute a whole-carton split. */
  unitsPerCarton: number | null
  /** Real carton volume from product carton dims, or per-unit volume_m3 x unitsPerCarton. Null if neither is set. */
  cartonVolumeM3: number | null
  /** Per-unit weight_kg x unitsPerCarton. Null if the product has no weight recorded -- weight just won't constrain that item. */
  cartonWeightKg: number | null
}

export interface SuggestionContainerInput {
  containerId: string
  capacityM3: number
  payloadKg: number
  /** Volume/weight already used by lines already packed into this container (across all its existing pl_items). */
  usedM3: number
  usedKg: number
}

export interface SuggestedAssignment {
  containerId: string
  piItemId: string
  cartonQty: number
  unitsPerCarton: number
}

export interface SkippedItem {
  piItemId: string
  reason: string
}

export interface UnplacedItem {
  piItemId: string
  cartonsUnplaced: number
}

export interface SuggestionResult {
  assignments: SuggestedAssignment[]
  skipped: SkippedItem[]
  unplaced: UnplacedItem[]
}

export function suggestPackingLayout(
  items: SuggestionItemInput[],
  containers: SuggestionContainerInput[],
): SuggestionResult {
  const skipped: SkippedItem[] = []
  const packable: (SuggestionItemInput & { unitsPerCarton: number; cartonVolumeM3: number })[] = []

  for (const it of items) {
    if (it.remainingUnits <= 0) continue
    if (!it.unitsPerCarton || it.unitsPerCarton <= 0) {
      skipped.push({ piItemId: it.piItemId, reason: 'no units-per-carton set on the product' })
      continue
    }
    if (!it.cartonVolumeM3 || it.cartonVolumeM3 <= 0) {
      skipped.push({ piItemId: it.piItemId, reason: 'no carton size or volume set on the product' })
      continue
    }
    packable.push({ ...it, unitsPerCarton: it.unitsPerCarton, cartonVolumeM3: it.cartonVolumeM3 })
  }

  const sorted = [...packable].sort((a, b) => b.cartonVolumeM3 - a.cartonVolumeM3)

  const remaining = containers.map(c => ({
    containerId: c.containerId,
    capacityM3: c.capacityM3,
    volLeft: Math.max(0, c.capacityM3 - c.usedM3),
    kgLeft: Math.max(0, c.payloadKg - c.usedKg),
  }))

  const cartonsByKey = new Map<string, number>()
  const unplacedByItem = new Map<string, number>()

  for (const it of sorted) {
    let cartonsNeeded = Math.ceil(it.remainingUnits / it.unitsPerCarton)
    const kgPerCarton = it.cartonWeightKg ?? 0
    const skippedContainers = new Set<string>()

    // Product-cohesive best fit: prefer one container that can hold the
    // whole remaining product line, choosing the tightest such fit. Only
    // split when no container can take it whole; then use the container
    // that can take the largest meaningful block. This reduces customs and
    // receiving fragmentation while still using both CBM and payload.
    while (cartonsNeeded > 0) {
      const candidates = remaining.filter(c => !skippedContainers.has(c.containerId)).map(c => {
        const maxByVol = Math.floor(c.volLeft / it.cartonVolumeM3)
        const maxByWeight = kgPerCarton > 0 ? Math.floor(c.kgLeft / kgPerCarton) : cartonsNeeded
        return { c, fit: Math.min(cartonsNeeded, maxByVol, maxByWeight) }
      }).filter(candidate => candidate.fit > 0)
      if (!candidates.length) break

      const completeFits = candidates.filter(candidate => candidate.fit >= cartonsNeeded)
      const chosen = completeFits.length
        ? completeFits.sort((left, right) => (left.c.volLeft - cartonsNeeded * it.cartonVolumeM3) - (right.c.volLeft - cartonsNeeded * it.cartonVolumeM3))[0]
        : candidates.sort((left, right) => right.fit - left.fit || left.c.volLeft - right.c.volLeft)[0]
      const finishesItem = chosen.fit === cartonsNeeded
      const meaningfulShare = (chosen.fit * it.cartonVolumeM3) / chosen.c.capacityM3 >= MIN_FRAGMENT_FRACTION
      if (!finishesItem && !meaningfulShare) {
        skippedContainers.add(chosen.c.containerId)
        continue
      }

      const key = `${chosen.c.containerId} ${it.piItemId}`
      cartonsByKey.set(key, (cartonsByKey.get(key) ?? 0) + chosen.fit)
      chosen.c.volLeft -= chosen.fit * it.cartonVolumeM3
      chosen.c.kgLeft -= chosen.fit * kgPerCarton
      cartonsNeeded -= chosen.fit
    }

    if (cartonsNeeded > 0) unplacedByItem.set(it.piItemId, cartonsNeeded)
  }

  const assignments: SuggestedAssignment[] = []
  for (const [key, cartonQty] of cartonsByKey) {
    const [containerId, piItemId] = key.split(' ')
    const src = packable.find(x => x.piItemId === piItemId)!
    assignments.push({ containerId, piItemId, cartonQty, unitsPerCarton: src.unitsPerCarton })
  }

  const unplaced: UnplacedItem[] = [...unplacedByItem].map(([piItemId, cartonsUnplaced]) => ({ piItemId, cartonsUnplaced }))

  return { assignments, skipped, unplaced }
}

// Total volume/weight still sitting unplaced -- the shortfall a caller needs
// to cover with additional container capacity.
export function estimateDeficit(unplaced: UnplacedItem[], items: SuggestionItemInput[]): { volM3: number; kg: number } {
  const byId = new Map(items.map(it => [it.piItemId, it]))
  let volM3 = 0
  let kg = 0
  for (const u of unplaced) {
    const it = byId.get(u.piItemId)
    if (!it) continue
    volM3 += u.cartonsUnplaced * (it.cartonVolumeM3 ?? 0)
    kg += u.cartonsUnplaced * (it.cartonWeightKg ?? 0)
  }
  return { volM3, kg }
}

// How many more containers (of the given fresh capacity) would it take to
// hold everything left unplaced -- lets a caller top up the container list
// and re-run rather than settling for "some of it didn't fit."
export function estimateNewContainersNeeded(
  unplaced: UnplacedItem[],
  items: SuggestionItemInput[],
  freshCapacityM3: number,
  freshPayloadKg: number,
): number {
  const { volM3, kg } = estimateDeficit(unplaced, items)
  const byVolume = Math.ceil(volM3 / freshCapacityM3)
  const byWeight = kg > 0 ? Math.ceil(kg / freshPayloadKg) : 0
  return Math.max(byVolume, byWeight, 1)
}

// Picks the smallest of the given container types (specs supplied by the
// caller, ordered smallest-capacity-first) that can hold the WHOLE deficit
// in a single fresh container -- e.g. a small tail-end remainder gets a
// 20GP instead of always defaulting to the biggest type. Falls back to the
// largest type (and lets the caller create more than one) when nothing
// single-handedly fits.
export function pickContainerTypeForDeficit(
  unplaced: UnplacedItem[],
  items: SuggestionItemInput[],
  typesSmallestFirst: { type: string; capacityM3: number; payloadKg: number }[],
): { type: string; capacityM3: number; payloadKg: number } {
  const { volM3, kg } = estimateDeficit(unplaced, items)
  for (const t of typesSmallestFirst) {
    if (volM3 <= t.capacityM3 && kg <= t.payloadKg) return t
  }
  return typesSmallestFirst[typesSmallestFirst.length - 1]
}

// True when some unplaced item's single carton is bigger (by volume or
// weight) than an entirely empty container of the given specs -- no number
// of additional containers will ever fit it, so a caller should stop
// creating more and surface this instead.
export function singleCartonExceedsContainer(
  unplaced: UnplacedItem[],
  items: SuggestionItemInput[],
  freshCapacityM3: number,
  freshPayloadKg: number,
): boolean {
  const byId = new Map(items.map(it => [it.piItemId, it]))
  return unplaced.some(u => {
    const it = byId.get(u.piItemId)
    if (!it) return false
    return (it.cartonVolumeM3 ?? 0) > freshCapacityM3 || (it.cartonWeightKg ?? 0) > freshPayloadKg
  })
}
