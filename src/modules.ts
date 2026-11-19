export const partsBySlot = {
  base: { laje: 'laje facetada', disco: 'base redonda', octogono: 'base octogonal' },
  suporte: { pedestal: 'pedestal baixo', poste: 'poste fino e alto', colunas: 'colunas ao redor' },
  corpo: { bacia: 'bacia larga com água', cascata: 'duas bacias de água', barril: 'reservatório', assento: 'banco com encosto',
    mesa: 'bancada', canteiro: 'canteiro com flores', armario: 'armário com portas', fornalha: 'fornalha de pedra' },
  topo: { bica: 'bica lateral', jato: 'jato central', funil: 'funil de coleta', cupula: 'luminária',
    telhado_curvo: 'cobertura curva', telhado_reto: 'telhado reto', gema: 'cristal facetado', estatua: 'escultura', chama: 'chama de tocha' },
  adorno: { flores: 'vaso de flores', lampiao: 'lampião lateral', trepadeira: 'trepadeira', placa: 'placa' },
} as const

export const slots = ['base', 'suporte', 'corpo', 'topo', 'adorno'] as const
export const palettes = ['cedro', 'terracota', 'musgo', 'lagoa', 'lavanda', 'arenito', 'carvao', 'cobre'] as const
export type Color = typeof palettes[number]
export type Slot = typeof slots[number]
export type PartId<S extends Slot> = { [K in Slot]: keyof typeof partsBySlot[K] & string }[S]
export type Piece<S extends Slot = Slot> = { peca: PartId<S>; cor: Color }
export type Composition = { [S in Slot]: S extends 'base' ? Piece<S> : Piece<S> | null }
type EditFor<S extends Slot> = { camada: S; parte: Composition[S] }
export type ModuleEdit = { [S in Slot]: EditFor<S> }[Slot]

export const partIds = <S extends Slot>(slot: S) => Object.keys(partsBySlot[slot]) as PartId<S>[]
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined

function readPiece<S extends Slot>(slot: S, value: unknown): Piece<S> | undefined {
  const raw = object(value)
  if (!raw || !partIds(slot).some(id => id === raw.peca) || !palettes.some(color => color === raw.cor)) return undefined
  return { peca: raw.peca, cor: raw.cor } as Piece<S>
}

export function readComposition(value: unknown): Composition | null {
  const raw = object(value)
  if (!raw) return null
  const base = readPiece('base', raw.base)
  const suporte = raw.suporte === null ? null : readPiece('suporte', raw.suporte)
  const corpo = raw.corpo === null ? null : readPiece('corpo', raw.corpo)
  const topo = raw.topo === null ? null : readPiece('topo', raw.topo)
  const adorno = raw.adorno === null ? null : readPiece('adorno', raw.adorno)
  if (!base || suporte === undefined || corpo === undefined || topo === undefined || adorno === undefined) return null
  const result = { base, suporte, corpo, topo, adorno }
  return fits(result) ? result : null
}

function fits(look: Composition): boolean {
  const support = look.suporte?.peca
  const body = look.corpo?.peca
  const top = look.topo?.peca
  if (!body && !top) return false
  if (support === 'poste' && body) return false
  if (support === 'pedestal' && body && !['bacia', 'cascata', 'barril'].includes(body)) return false
  if (support === 'colunas' && top !== 'telhado_curvo' && top !== 'telhado_reto') return false
  if (top === 'telhado_curvo' || top === 'telhado_reto') return support === 'colunas'
  if (top === 'bica' || top === 'jato') return body === 'bacia' || body === 'cascata'
  if (top === 'funil') return body === 'barril'
  if (top === 'gema' || top === 'estatua' || top === 'cupula' || top === 'chama') {
    return !body || body === 'mesa' || body === 'armario'
  }
  return true
}

export function readModuleEdit(value: unknown): ModuleEdit | null {
  const raw = object(value)
  const slot = slots.find(s => s === raw?.camada)
  if (!raw || !slot) return null
  const part = raw.parte === null && slot !== 'base' ? null : readPiece(slot, raw.parte)
  return part !== undefined ? { camada: slot, parte: part } as ModuleEdit : null
}

export function editComposition(look: Composition, edit: ModuleEdit): Composition | null {
  return readComposition({ ...look, [edit.camada]: edit.parte })
}

export function compatibleEditParts<S extends Slot>(look: Composition, slot: S): (PartId<S> | null)[] {
  const variants = [...partIds(slot), ...(slot === 'base' ? [] : [null])]
  return variants.filter(peca => readComposition({ ...look, [slot]: peca ? { peca, cor: palettes[0] } : null }) !== null)
}

// All the heights are measured from the attachment plane, not from the SVG viewBox.
const baseLift: Record<PartId<'base'>, number> = { laje: 2, disco: 3, octogono: 4 }
const supportLift: Record<PartId<'suporte'>, number> = { pedestal: 10, poste: 25, colunas: 28 }
const bodyLift: Record<PartId<'corpo'>, number> = { bacia: 7, cascata: 16, barril: 15, assento: 12, mesa: 13, canteiro: 9, armario: 23, fornalha: 20 }
export function attachmentHeights(look: Composition) {
  const suporte = baseLift[look.base.peca]
  const frame = look.suporte?.peca === 'colunas'
  const offset = look.suporte ? supportLift[look.suporte.peca] : 0
  const corpo = suporte + (frame ? 0 : offset)
  const topo = frame ? suporte + offset : corpo + (look.corpo ? bodyLift[look.corpo.peca] : 0)
  return { base: 0, suporte, corpo, topo, adorno: 0 }
}
