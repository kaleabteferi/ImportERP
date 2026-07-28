// src/lib/containerSpecs.ts
//
// Fixed, real ISO container specs -- not a live lookup, these don't change.
// Payload figures are typical max gross payload (capacity minus tare
// weight) for standard dry containers; actual max varies slightly by
// carrier/container, so treat these as a conservative planning limit
// rather than an exact certified rating.
export const STANDARD_CAPACITY_M3: Record<string, number> = {
  '20GP': 33.2,
  '40GP': 67.7,
  '40HC': 76.3,
}

export const STANDARD_PAYLOAD_KG: Record<string, number> = {
  '20GP': 28200,
  '40GP': 26700,
  '40HC': 26300,
}

export function containerCapacityM3(containerType: string): number {
  return STANDARD_CAPACITY_M3[containerType] ?? STANDARD_CAPACITY_M3['40HC']
}

export function containerPayloadKg(containerType: string): number {
  return STANDARD_PAYLOAD_KG[containerType] ?? STANDARD_PAYLOAD_KG['40HC']
}
