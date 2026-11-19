import type { Blueprint } from './blueprint'
import { appearanceFor } from './appearance'
import { attachmentHeights, slots } from './modules'
import type { Color, Composition, Piece } from './modules'

const themes: Record<Color, readonly [string, string, string]> = {
  cedro: ['#d3a371', '#a97151', '#805642'],
  terracota: ['#e7a27e', '#bf735b', '#965441'],
  musgo: ['#c0ce86', '#8ea466', '#647c53'],
  lagoa: ['#a3d0c1', '#6fa9a3', '#4c7f7e'],
  lavanda: ['#d5bfdb', '#ae93c4', '#7c6c9d'],
  arenito: ['#ead7a6', '#bfaa7b', '#947c5c'],
  carvao: ['#a3aaa6', '#727d7d', '#505a5b'],
  cobre: ['#ebbd83', '#c48a5d', '#985d48'],
}
const gold = '#f7d580'
type Theme = typeof themes[Color]

function Flower({ x, y, color }: { x: number; y: number; color: string }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M0 1v-12m0 8-4-4m4 2 4-4" fill="none" stroke="#668353" />
    <path d="M0-16q3-3 4 0 4 1 1 4 1 4-3 3-3 3-4-1-4 0-3-4 1-3 5-2Z" fill={color} strokeWidth=".65" />
    <circle cy="-13" r="1.4" fill={gold} stroke="none" />
  </g>
}

function Basin({ theme, size = 1 }: { theme: Theme; size?: number }) {
  const [light, mid, dark] = theme
  return <g transform={`scale(${size})`}>
    <path d="M-23-7q2 12 23 13 21-1 23-13Z" fill={dark} />
    <ellipse cy="-7" rx="23" ry="8" fill={light} />
    <ellipse cy="-7" rx="19" ry="5" fill="#79b4ae" stroke={mid} />
    <path d="M-13-6h7m12-2h7" stroke="#d5eee3" />
  </g>
}

function Lantern({ theme }: { theme: Theme }) {
  const [light, mid, dark] = theme
  return <>
    <path d="M-8 0l-2-13 10-4 10 4L8 0 0 4Z" fill={gold} />
    <path d="M0-13V4m-7-17L-5 0m12-13L5 0" fill="none" stroke={dark} />
    <path d="M-13-13 0-24 13-13 0-9Z" fill={mid} />
    <circle cy="-24" r="2" fill={light} />
  </>
}

function ModuleArt({ piece }: { piece: Piece }) {
  const theme = themes[piece.cor]
  const [light, mid, dark] = theme
  switch (piece.peca) {
    case 'laje': return <>
      <path d="m-26 0 26 11 26-11v4L0 15-26 4Z" fill={mid} />
      <path d="M0 11 26 0v4L0 15Z" fill={dark} />
      <path d="m-26 0 26-12L26 0 0 11Z" fill={light} />
    </>
    case 'disco': return <>
      <path d="M-24 0v5c0 12 48 12 48 0V0Z" fill={mid} />
      <ellipse cy="-2" rx="24" ry="10" fill={light} />
      <path d="M4 12q12 0 19-6" fill="none" stroke={dark} strokeWidth="2" />
    </>
    case 'octogono': return <>
      <path d="m-25-3 0 6 9 7 15 5 18-6 8-6v-6" fill={dark} />
      <path d="m-25-3 9-7 17-5 16 5 8 7-8 7-18 6-15-5Z" fill={light} />
      <path d="m-20-3 7-5 14-4 13 4 6 5-6 5-15 5-12-4Z" fill={mid} />
    </>
    case 'pedestal': return <>
      <path d="M-8-11 0-15 8-11v9L0 3l-8-5Z" fill={mid} />
      <path d="M0-7 8-11v9L0 3Z" fill={dark} />
      <path d="m-8-11 8-4 8 4-8 4Z" fill={light} />
    </>
    case 'poste': return <>
      <ellipse cy="-1" rx="7" ry="3" fill={mid} />
      <path d="M-2 0v-26h4V0Z" fill={dark} />
      <path d="M0-2v-22" stroke={light} />
    </>
    case 'colunas': return <>
      <path d="M-21-31V-2m21-35v25m21-19V-2" stroke={dark} strokeWidth="4" />
      <path d="M-22-30v28m21-34v23m21-18v28" stroke={light} />
    </>
    case 'bacia': return <Basin theme={theme} />
    case 'cascata': return <>
      <Basin theme={theme} />
      <path d="M-4-17h8V-6q-4 4-8 0Z" fill={mid} />
      <g transform="translate(0 -12)"><Basin theme={theme} size={.53} /></g>
      <path d="M-5-14q-3 5-2 10m13-11q4 5 2 9" fill="none" stroke="#c4e9df" strokeWidth="2" />
    </>
    case 'barril': return <>
      <path d="M-15-15v11c0 12 30 12 30 0v-11Z" fill={mid} />
      <ellipse cy="-15" rx="15" ry="6" fill={light} />
      <path d="M-15-13q15 10 30 0M-15-5q15 10 30 0" fill="none" stroke={dark} strokeWidth="2" />
      <path d="M4-4h6v4" fill="none" stroke={gold} strokeWidth="2.1" />
    </>
    case 'assento': return <>
      <path d="M-22-10v11m34 4V0m9-7v9m-33-2v-13" stroke={dark} strokeWidth="3" />
      <path d="m-22-13 42 13 7-5-41-12Z" fill={light} />
      <path d="M-21-15v-11l41 13v11Z" fill={mid} />
      <path d="m-21-26 41 13 4-3-41-13Z" fill={light} />
      <path d="m-18-19 35 11" stroke={dark} />
    </>
    case 'mesa': return <>
      <path d="M-17-11V1m13-4V8m22-15V4" stroke={dark} strokeWidth="3" />
      <path d="m-21-11 16-8 26 9-16 8Z" fill={light} />
      <path d="m-21-11 26 9 16-8v4L5 2l-26-9Z" fill={mid} />
      <path d="m-14-11 19 6m-14-9 20 6" stroke={dark} opacity=".58" />
    </>
    case 'canteiro': return <>
      <path d="m-24-5 23 10 23-10v6L-1 11-24 1Z" fill={mid} />
      <path d="M-1 5 22-5v6L-1 11Z" fill={dark} />
      <path d="m-24-5 23-10 23 10L-1 5Z" fill={light} />
      <path d="m-18-5 17-7 17 7L-1 2Z" fill="#765f4a" />
      <Flower x={-11} y={-4} color={light} /><Flower x={4} y={-5} color="#f6df9b" />
      <Flower x={1} y={1} color="#edb08d" />
    </>
    case 'armario': return <>
      <path d="m-19-24 26-10 17 9L0-14Z" fill={light} />
      <path d="M-19-24 0-14V8L-19 0Z" fill={dark} />
      <path d="M0-14 24-25V-3L0 8Z" fill={mid} />
      <path d="m3-12 7-3V2L3 5Zm10-5 8-3v17l-8 3Z" fill="none" stroke={light} />
      <path d="M9-8v4m6-7v4" stroke={gold} strokeWidth="1.7" />
    </>
    case 'fornalha': return <>
      <path d="M-22-5v-13q0-13 17-14h12q15 1 15 12V0L0 7Z" fill={mid} />
      <path d="M-22-18-5-32 10-29 23-21 0-13Z" fill={light} />
      <path d="M-13-3v-6q0-10 8-8 8 1 8 12v7Z" fill={dark} />
      <path d="M-10-5q2-10 6-3 5 0 5 8Z" fill="#f1ac60" />
    </>
    case 'bica': return <>
      <path d="M8 2v-13q0-6-7-6h-6v5h6q2 0 2 2v12Z" fill={mid} />
      <path d="M-5-12v11" stroke="#b9e7dc" strokeWidth="2" />
      <path d="M5-16v-4m-3 0h7" stroke={light} strokeWidth="2" />
    </>
    case 'jato': return <>
      <ellipse rx="6" ry="2" fill={mid} />
      <path d="M0-1v-13m0 4q-8-11-13 4m13-4q9-11 14 6" fill="none" stroke="#c7eee1" strokeWidth="2" />
    </>
    case 'funil': return <>
      <path d="m-15-11 12 12h6l12-12Z" fill={mid} />
      <ellipse cy="-11" rx="15" ry="6" fill={light} />
      <ellipse cy="-11" rx="10" ry="3" fill="#6ca7a3" />
    </>
    case 'cupula': return <Lantern theme={theme} />
    case 'chama': return <>
      <path d="M0 3c-9-3-7-10-2-14 1 5 4 0 5-4 7 8 6 15-3 18Z" fill={mid} stroke={dark} />
      <path d="M0 1c-3-1-3-5 1-8 1 3 3 6-1 8Z" fill={gold} stroke="none" />
    </>
    case 'telhado_curvo': return <>
      <path d="M-29 1Q-22-20-8-22l28 13Q7-8 1 13Z" fill={mid} />
      <path d="M1 13Q7-8 20-9l10 9Z" fill={dark} />
      <path d="m-26-3 29 13m-24-24 29 13m-22-20 29 13" stroke={light} />
    </>
    case 'telhado_reto': return <>
      <path d="M-29 1-10-24 22-10 1 13Z" fill={mid} />
      <path d="M1 13 22-10 30 0Z" fill={dark} />
      <path d="m-26-3 29 13m-23-21 28 12m-22-20 27 12" stroke={light} />
    </>
    case 'gema': return <>
      <path d="M-12-13-3-30 8-33 17-16 8-2-1 2Z" fill={mid} />
      <path d="M-3-30 4-15-1 2-12-13Z" fill={light} />
      <path d="m8-33 9 17-9 14-9 4 5-17Z" fill={dark} />
      <path d="m-3-28 5 11-8 2Z" fill="#f5f0df" opacity=".55" stroke="none" />
    </>
    case 'estatua': return <>
      <path d="M1 1q-9-5-8-14-11 3-13-8 10-8 18 1 0-10 9-15 10 9 6 19-7 1-10 9l2 8Z" fill={mid} />
      <path d="M1-2q-3-14 7-25m-9 13-11-6" fill="none" stroke={light} strokeWidth="1.7" />
    </>
    case 'flores': return <g transform="translate(-24 11)">
      <path d="M-7-5h14L5 3H-5Z" fill={mid} /><Flower x={-2} y={-5} color={light} /><Flower x={5} y={-3} color="#e6ae8e" />
    </g>
    case 'lampiao': return <g transform="translate(25 9) scale(.58)">
      <path d="M0 4v-11" stroke={dark} strokeWidth="3" /><Lantern theme={theme} />
    </g>
    case 'trepadeira': return <g transform="translate(-17 8)" fill={light} stroke={dark} strokeWidth=".8">
      <path d="M0 0c-9-7 7-11 1-16s-4-9 2-13" fill="none" />
      <path d="M-3-12q-6-2-4-7 5 0 5 6m2-8q3-7 8-5-1 6-8 6m-2 17q-6-1-7-7 7 0 7 5" />
    </g>
    case 'placa': return <g transform="translate(21 11)">
      <path d="M0 5V-10" stroke={dark} strokeWidth="2.4" />
      <path d="M-6-12 5-10v6L-6-6Z" fill={light} strokeWidth=".8" />
      <path d="m-4-9 6 1" stroke={mid} strokeWidth=".8" />
    </g>
  }
}

export function InventionArt({ plan }: { plan: Blueprint }) {
  return <CompositionArt look={appearanceFor(plan)} />
}

export function CompositionArt({ look }: { look: Composition }) {
  const heights = attachmentHeights(look)
  return <g className="modular-invention-art" stroke="#5a5143" strokeWidth="1.15" strokeLinejoin="round" strokeLinecap="round">
    <ellipse cx="3" cy="7" rx="30" ry="9" fill="#435d3c" opacity=".27" stroke="none" />
    {slots.map(slot => {
      const piece = look[slot]
      return piece && <g key={slot} data-art-slot={slot} data-art-piece={piece.peca} data-art-color={piece.cor}
        transform={`translate(0 ${-heights[slot]})`}><ModuleArt piece={piece} /></g>
    })}
  </g>
}
