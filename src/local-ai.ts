import type { Blueprint, Renovation } from './blueprint'
import type { WorldSave } from './world-save'
import type { WorldState } from './world'
import type { MapData } from './world-map'
import type { Composition } from './modules'
import type { RecipeDraft, RecipeOptions } from './crafting'

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
export type Idea = { plan: Blueprint; plot: number }

export interface LocalAI {
  decide(state: string, choices: Record<string, string>): Promise<Reply<string>>
  invent(state: string, plotCount: number, first?: boolean, materials?: boolean, water?: Blueprint['custo']): Promise<Reply<Idea>>
  renovate(state: string, look: Composition): Promise<Reply<Renovation>>
  recipe?(state: string, options: RecipeOptions): Promise<Reply<RecipeDraft>>
}

export interface WorldStorage {
  load(legacy: string | null): Promise<Reply<WorldSave>>
  save(state: WorldState, map?: MapData): Promise<Reply<null>>
}

/** Delivered by the Electron main process after a research result is saved. */
export type ResearchNotice = { title: string; body: string }
export interface ResearchNotices {
  onResult(listener: (notice: ResearchNotice) => void): () => void
}
