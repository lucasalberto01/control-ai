import { compatibleEditParts, palettes, readComposition, slots } from './modules.ts'
import type { Composition, Slot } from './modules.ts'

export function appearanceKey(look: Composition): string {
  return JSON.stringify(slots.map(slot => {
    const piece = look[slot]
    return piece ? [piece.peca, piece.cor] : null
  }))
}

export class AppearanceRegistry {
  readonly #keys = new Set<string>()

  constructor(looks: Iterable<Composition>) {
    for (const look of looks) this.reserve(look)
  }

  reserve(look: Composition) {
    this.#keys.add(appearanceKey(look))
  }

  available(look: Composition, only?: Slot, previous?: Composition): Composition | null {
    const previousKey = previous && appearanceKey(previous)
    const free = (candidate: Composition) => {
      const key = appearanceKey(candidate)
      return key !== previousKey && !this.#keys.has(key)
    }
    if (free(look)) return look

    // Preserve the silhouette when possible; prefer recoloring a large visible piece.
    const order: readonly Slot[] = only ? [only] : ['corpo', 'base', 'topo', 'suporte', 'adorno']
    for (const slot of order) {
      const part = look[slot]
      if (!part) continue
      for (const cor of palettes) {
        if (cor === part.cor) continue
        const candidate = readComposition({ ...look, [slot]: { ...part, cor } })
        if (candidate && free(candidate)) return candidate
      }
    }
    for (const slot of order) {
      for (const peca of compatibleEditParts(look, slot)) {
        if (peca === (look[slot]?.peca ?? null)) continue
        for (const cor of palettes) {
          const candidate = readComposition({ ...look, [slot]: peca ? { peca, cor } : null })
          if (candidate && free(candidate)) return candidate
          if (peca === null) break
        }
      }
    }
    if (only) return null

    // As a last resort, change two cosmetic slots without affecting other attachments.
    for (const baseColor of palettes) {
      for (const peca of compatibleEditParts(look, 'adorno')) {
        for (const decorColor of palettes) {
          const candidate = readComposition({
            ...look, base: { ...look.base, cor: baseColor }, adorno: peca ? { peca, cor: decorColor } : null,
          })
          if (candidate && free(candidate)) return candidate
        }
      }
    }
    return null
  }
}
