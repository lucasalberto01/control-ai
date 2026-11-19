import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Blueprint } from './blueprint'
import type { Point, World } from './world'
import { CompositionArt, InventionArt } from './InventionArt'
import { installedAppearance, workbenchAppearance } from './appearance'
import type { Composition } from './modules'
import { pointKey, same } from './world-map'
import type { Item } from './inventory'

const project = ({ x, y }: Point) => ({ x: 400 + (x - y) * 47, y: 96 + (x + y) * 24 })
const position = (at: Point) => { const p = project(at); return `translate(${p.x} ${p.y})` }
const diamond = (w: number, h: number) => `0,${-h} ${w},0 0,${h} ${-w},0`
const grass = ['#a8bd77', '#afc580', '#b6ca88', '#9fb871', '#b0c47f', '#b7c888']

function Ground({ at, world }: { at: Point; world: World }) {
  const { x, y } = at
  const { map } = world
  const site = map.siteAt(at)
  const lake = site?.kind === 'lago' ? site : undefined
  const surface = world.surface(at)
  const water = world.water(at)
  const wet = water > 0
  const path = map.hasTrail(at)
  const right = x === map.width - 1
  const left = y === map.height - 1
  const pattern = (x * 31 + y * 13 + x * y * 7) % 29
  const fill = surface === 'pedra' ? '#a2a89c' : surface === 'terra' ? '#b18b62'
    : surface === 'areia' || wet ? '#d7be8f' : grass[pattern % grass.length]
  const pool = .63 + water * .09
  return <g transform={position(at)} data-surface={surface} data-tile={pointKey(at)} data-water={water || undefined}>
    {left && <path d="M-47 0 0 24 0 49 -47 25Z" fill="#849259" stroke="#697b4c" />}
    {right && <path d="M47 0 0 24 0 49 47 25Z" fill="#687f4e" stroke="#64784c" />}
    {left && pattern % 2 === 0 && <path d="M-31 18l9 4m10 10 6 3" stroke="#9ca46a" strokeWidth="2" />}
    {right && pattern % 2 === 1 && <path d="M14 33l9-5m10-11 7-3" stroke="#819253" strokeWidth="2" />}
    <polygon points={diamond(47, 24)} fill={fill} stroke="#93a177" strokeWidth="1">
      <title>{wet ? `${lake?.name ?? 'Água'} · ${water} unidades de água` : world.item(surface)?.name}</title>
    </polygon>
    {wet ? <g transform={`scale(${Math.min(1, pool)})`}>
      <polygon points={diamond(47, 24)} fill="#75acaa" stroke="#93cbbd" />
      <g className="pond-ripple" stroke="#b6d6c5" opacity=".7" strokeLinecap="round">
        <path d={`M${-20 + pattern / 2} -4h15m-8 6h21m1 7h9`} fill="none" strokeWidth="1.5" />
        {pattern % 2 === 0 && <path d="M17-7q9-5 16 0-4 4-13 3l5-3Z" fill="#6f9852" stroke="none" />}
      </g>
    </g> : <>
      {path && surface === 'grama' && <polygon points={diamond(38, 19)} fill="#c8bf8a" opacity=".78" />}
      <path d={`M${-21 + pattern} 8h3m${12 - pattern / 2} -11h4m-25 -4h3`}
        stroke={path ? '#a99f70' : '#779551'} strokeWidth="1.4" opacity=".55" />
      {!path && surface === 'grama' && pattern % 3 === 0 && <g transform="translate(16 6)"><path d="M0 1v-6" stroke="#69914c" /><circle cy="-5" r="2" fill="#f5db90" /></g>}
    </>}
  </g>
}

function FallenTree() {
  return <g className="fallen-tree">
    <title>Árvore caída</title>
    <path d="M-4 4v-9h8v9Z" fill="#8c6146" stroke="#664e38" />
    <ellipse cy="-5" rx="4" ry="2" fill="#ddaa7a" />
    <path d="M4 3 20-7l6 3-17 11Z" fill="#876246" stroke="#6a5038" />
    <ellipse cx="7" cy="5" rx="3.5" ry="2" fill="#cc9d70" stroke="#77523d" />
  </g>
}

function InstalledArt({ item, look }: { item: Readonly<Item>; look?: Composition }) {
  return <g data-installed-item={item.id}>
    <title>{item.kind === 'luz' ? item.name : `${item.name}: ${item.capability}`}</title>
    {item.kind === 'luz' && <ellipse cy="-12" rx="32" ry="19" fill="#f6bd64" opacity=".36" />}
    <CompositionArt look={look ?? installedAppearance(item)} />
  </g>
}

function ResearchStation({ busy }: { busy: boolean }) {
  const screen = busy ? '#b9f2df' : '#7fb6aa'
  return <g className={busy ? 'research-station busy' : 'research-station'}
    stroke="#5c5547" strokeWidth="1.05" strokeLinejoin="round" strokeLinecap="round">
    <title>Mesa de Pesquisa{busy ? ' · pesquisando' : ''}</title>
    <ellipse cx="3" cy="10" rx="29" ry="9" fill="#435d3c" opacity=".22" stroke="none" />
    <path d="M-17-7v18m34-18v18" stroke="#7d5f45" strokeWidth="3" />
    <path d="m-21-11 16-8 26 9-16 8Z" fill="#d8b98d" />
    <path d="m-21-11 26 9 16-8v4L5 2l-26-9Z" fill="#b58f68" />
    <g transform="translate(0 -18)">
      <path d="m-8 8 8-4 8 4-8 4Z" fill="#67756f" />
      <path d="M-2 5V1h4v4Z" fill="#7b8a84" />
      <path d="m-11-9 11-5 11 5v14l-11 5-11-5Z" fill="#e4dcc6" />
      <path d="m0-14 11 5v14l-11 5Z" fill="#cec5ad" />
      <path className="research-screen" d="m-7-7 7-3 7 3v8l-7 3-7-3Z" fill={screen} stroke="#3f6f66" />
      <path d="m-4-6 4-2 4 2v5l-4 2-4-2Z" fill={busy ? '#e7fff7' : '#aad4c9'} opacity=".85" stroke="none" />
      {busy && <path d="M-2-3h8M-2-1h5" stroke="#f6fffb" strokeWidth="1.2" />}
    </g>
    <g transform="translate(-15 -15)">
      <path d="m-6-8 6-3 6 3v14l-6 3-6-3Z" fill="#cdd3cd" />
      <path d="m0-11 6 3v14l-6 3Z" fill="#aeb8b2" />
      <circle cx="-3" cy="-1" r="1.1" fill={busy ? '#f7d978' : '#8fbf8a'} stroke="none" />
      <circle cx="-3" cy="3" r="1.1" fill="#79a8c4" stroke="none" />
      <path d="m-3 7 4-2v3l-4 2Z" fill="#7d8781" stroke="none" />
    </g>
    <path d="m-14-4 8-4 12 4-8 4Z" fill="#d9cdb4" />
    <path d="m-10-4 3-1m0 2 3-1m0 2 3-1" stroke="#8d8371" strokeWidth=".8" />
  </g>
}

function Grave({ name }: { name: string }) {
  return <g>
    <title>{name} (morta)</title>
    <ellipse cx="2" cy="5" rx="16" ry="6" fill="#3e523b" opacity=".3" />
    <path d="M-11 5V-9q0-12 11-12T11-9V5Z" fill="#a9a799" stroke="#6e7268" />
    <path d="M11 5V-9q0-12-11-12v26Z" fill="#8e9185" stroke="#6e7268" />
    <path d="M0-17v13m-5-8h10" stroke="#5d655c" strokeWidth="1.8" />
    <path d="M-13 5h26" stroke="#7b7f72" />
  </g>
}

function HealthBar({ value, max = 100, y = -40, label }: { value: number; max?: number; y?: number; label: string }) {
  if (value >= max) return null
  const width = 36
  const height = 5
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const color = ratio > .55 ? '#6c9f5c' : ratio > .25 ? '#c5a04d' : '#b85a4c'
  return <g transform={`translate(0 ${y})`} data-health-bar={label} data-health-value={value}>
    <title>{label}: {value} de {max}</title>
    <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={2.5} fill="#3c3a2e" opacity=".58" />
    {ratio > 0 && <rect x={-width / 2 + 1} y={-height / 2 + 1} width={(width - 2) * ratio} height={height - 2}
      rx={1.5} fill={color} />}
    {ratio === 0 && <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={2.5}
      fill="none" stroke="#b85a4c" strokeWidth="1.2" />}
  </g>
}

function Boar({ id, hp }: { id: number; hp: number }) {
  return <g data-animal={id}>
    <title>Javali selvagem · {hp} HP</title>
    <HealthBar value={hp} max={12} y={-31} label="HP do javali" />
    <ellipse cx="4" cy="10" rx="24" ry="7.5" fill="#3e523b" opacity=".32" />
    <g stroke="#4d3728" strokeWidth="5" strokeLinecap="round">
      <path d="M-15 0v10" /><path d="M-6 2v9" /><path d="M6 2v9" /><path d="M14 0v10" />
    </g>
    <g stroke="#2f241b" strokeWidth="2" strokeLinecap="round">
      <path d="M-17 10h4" /><path d="M-8 11h4" /><path d="M4 11h4" /><path d="M12 10h4" />
    </g>
    <path d="M-21-5q-6-1-5-7 1-4 5-2" fill="none" stroke="#4d3728" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M-22-6q-3-12 7-17 10-5 21-1 6 2 8 7l6 1-2 5q2 9-6 12-10 4-21 1-9-3-13-8Z"
      fill="#a9713f" stroke="#4d3728" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M-16 2q8 6 18 5 8-1 13-6" fill="none" stroke="#d6a06a" strokeWidth="3" opacity=".65" strokeLinecap="round" />
    <path d="M-9-21l-3-5m9 4-1-6m9 6 2-6" stroke="#4d3728" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M16-13q7-2 10 2l3 5-1 6q-4 4-9 2l-8-5q-2-7 5-10Z" fill="#b58150" stroke="#4d3728" strokeWidth="1.6" />
    <path d="M23-6q4 0 7-2l1 5q-2 3-6 3" fill="#e0b37c" stroke="#4d3728" strokeWidth="1.4" />
    <path d="M14-13q0-6 6-6l1 7Z" fill="#8a5a39" stroke="#4d3728" strokeWidth="1.3" />
    <circle cx="21" cy="-7" r="1.8" fill="#2b2119" />
    <circle cx="21.6" cy="-7.6" r=".6" fill="#fff2d0" />
    <path d="M23 1q4 0 5-4" fill="none" stroke="#f1e3b9" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="28" cy="-2" r="1" fill="#4d3728" />
  </g>
}

function Loot() {
  return <g>
    <title>Itens no chão</title>
    <ellipse cx="1" cy="3" rx="9" ry="3" fill="#3e523b" opacity=".3" />
    <path d="M-7 3q-3-9 4-10l-1-3 6-1 1 3q6 2 4 10Z" fill="#c9a878" stroke="#7a5b40" strokeLinejoin="round" />
    <path d="M-3-7h7" stroke="#7a5b40" />
    <circle cx="-2" cy="-2" r="1" fill="#f5df9a" />
  </g>
}

function Pine({ tint = 0 }: { tint?: number }) {
  return <g>
    <ellipse cx="5" cy="3" rx="18" ry="6" fill="#435d3c" opacity=".23" />
    <path d="M-3 4v-14h6V4Z" fill="#8d6649" />
    <path d="M0-49-18-12-9-11-21-3 0 1 20-3 11-11 17-13Z" fill={tint ? '#6a9b64' : '#598d58'} stroke="#496e45" strokeLinejoin="round" />
    <path d="M0-49 0 1 20-3 11-11 17-13Z" fill={tint ? '#528354' : '#44734e'} />
    <path d="M-5-29l5-13 7 14" fill="none" stroke="#9eb16d" opacity=".72" strokeWidth="2" />
  </g>
}

function Cottage() {
  return <g>
    <ellipse cx="4" cy="9" rx="41" ry="11" fill="#45603d" opacity=".22" />
    <path d="M-37-12 0-29 37-11 0 9Z" fill="#dfc99b" />
    <path d="M-31-36 0-19V11l-31-16Z" fill="#f0deb1" stroke="#976b4d" />
    <path d="M0-19 29-33v28L0 11Z" fill="#ceb386" stroke="#976b4d" />
    <path d="M5-9l10-5V2L5 8Z" fill="#8e5e4b" />
    <path d="M-23-22l12 6v11l-12-6Z" fill="#f1bf61" stroke="#8f6852" />
    <path d="M-17-19v10m-6-7 12 6" stroke="#ab7956" />
    <path d="M-39-34-18-66 11-53 1-13Z" fill="#c97054" stroke="#8c5141" strokeLinejoin="round" />
    <path d="M1-13 11-53 37-33Z" fill="#a75848" stroke="#8c5141" strokeLinejoin="round" />
    <path d="M-34-36-2-19m-27-25L1-28m-24-25 27 14m-23-23 25 13" stroke="#df9870" opacity=".72" />
    <path d="M20-47v-15l7-3v16l-7 3-6-3v-15l6 2" fill="#875b4e" stroke="#754e45" strokeLinejoin="round" />
    <path d="M12 9l12-6 9 4-12 6Z" fill="#b7a077" />
  </g>
}

function FruitTree({ fruit }: { fruit: number }) {
  return <g data-fruit-tree>
    <title>Árvore frutífera · {fruit} frutas</title>
    <ellipse cx="4" cy="3" rx="23" ry="8" fill="#465e3f" opacity=".25" />
    <path d="M-4 5v-27h8v27Z" fill="#986747" stroke="#735844" />
    <path d="M-21-23q-7-14 8-20 6-16 22-9 13-1 17 11 8 14-2 21-7 9-21 5-20 5-24-8Z"
      fill="#729455" stroke="#506b40" strokeWidth="1.4" />
    <path d="M-21-25q10 6 17-1 14 8 29-2" fill="none" stroke="#9fb571" strokeWidth="2" />
    {[[-12, -31], [3, -41], [17, -29]].slice(0, fruit).map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" fill="#d67d55" stroke="#9e563b" />)}
  </g>
}

function Garden({ moisture, fruit, stage }: { moisture: number; fruit: number; stage: World['gardenStage'] }) {
  return <g data-garden-stage={stage}>
    <title>{stage === 'vazia' ? 'Horta sem plantio' : stage === 'crescendo' ? 'Cultivo crescendo' : `Horta · ${fruit} frutas maduras`}</title>
    <path d="M-38 0 0-18 37 0 0 20Z" fill={moisture < 31 ? '#b49161' : '#98724f'} stroke="#80684a" />
    {[-18, -6, 6, 18].map((n, i) => <g key={n} transform={`translate(${n} ${n / 2})`}>
      <path d="M-11 5 12-7" stroke="#c9a678" strokeWidth="2" />
      {stage !== 'vazia' && <path d="M0 0v-7m0 5-4-4m4 2 4-4" fill="none" stroke={moisture < 31 ? '#9c9c50' : '#658c4d'} strokeWidth="2.5" strokeLinecap="round" />}
      {i < fruit && <circle cy="-7" r="2" fill={i % 2 === 0 ? '#e3a65f' : '#d88163'} />}
    </g>)}
  </g>
}

function RockPile() {
  return <g stroke="#6e7970" strokeLinejoin="round">
    <path d="M-24 5-19-4-11-7-1-3 3 5-9 10Z" fill="#a6a998" />
    <path d="M-4 1 0-13 13-18 23-13 28 1 13 8Z" fill="#a9b1a3" />
    <path d="M13-18 16-5 28 1 13 8 10-5Z" fill="#8e9c8d" stroke="none" />
    <path d="M-15 5l6-5 9 2 5 5-11 6-9-3Z" fill="#bac0a8" />
  </g>
}

function Bucket() {
  return <g>
    <path d="M-15 0 10-10 21-5-4 7Z" fill="#9e805b" stroke="#7d654c" />
    <path d="M-13 2 19-7m-23 10 14-6" stroke="#cfaa74" />
    <path d="M-7-10q6-4 12 0l-2 8q-4 4-8 0Z" fill="#8a9f93" stroke="#5b7b70" />
    <ellipse cx="-1" cy="-10" rx="5" ry="2" fill="#84bbb3" />
  </g>
}

function Figure({ variant = 'laya' }: { variant?: 'laya' | 'kael' }) {
  const scarf = variant === 'kael' ? '#a85d4b' : '#789a5c'
  const thread = variant === 'kael' ? '#6d3f35' : '#415e47'
  return <>
    <ellipse cx="2" cy="3" rx="13" ry="5" fill="#3e523b" opacity=".32" />
    <g className="laya-body">
      <path d="M-11-9c0-5 5-7 7-14 2-5 4-7 7-7 5 0 5 7 10 13 6 7 3 17-8 18H-3C-11 1-15-3-11-9Z"
        fill="#d7a06b" stroke="#563e39" strokeWidth="1.7" />
      <path d="M-7-7c0-4 3-6 7-6 5 0 9 2 9 6 0 4-4 6-9 6-4 0-7-2-7-6Z" fill="#edbd87" />
      <ellipse cx="-3.7" cy="-16.5" rx="3.4" ry="4.2" fill="#fff3d4" />
      <ellipse cx="5.4" cy="-16.5" rx="3.4" ry="4.2" fill="#fff3d4" />
      <path d="M-3-17v2m9-2v2M1-10q2 2 4 0" stroke="#513835" strokeWidth="1.45" fill="none" strokeLinecap="round" />
      <path d="M-2-28q-4-7-11-4 3 6 9 6m2-2q1-7 7-6-1 5-7 6" fill={scarf} stroke={thread} strokeWidth="1.3" />
    </g>
  </>
}

type Props = {
  world: World
  actor: Point
  facing: number
  walking: boolean
  paused: boolean
  stepMs: number
  destination?: Point
  draft?: { plan: Blueprint; at: Point; renovationOf?: number }
  selected?: number
  onSelect: (id: number) => void
}

export default function ValleyMap({
  world, actor, facing, walking, paused, stepMs, destination, draft, selected, onSelect,
}: Props) {
  const { rain, night } = world.weather
  const { map } = world
  const builds = world.builds
  const center = project({ x: (map.width - 1) / 2, y: (map.height - 1) / 2 })
  const scale = Math.min(1, 14 / (map.width + map.height))
  const actorPx = project(actor)
  const svgRef = useRef<SVGSVGElement>(null)
  const mapViewRef = useRef<SVGGElement>(null)
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 })
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)

  const writeView = useCallback(() => {
    const view = viewRef.current
    mapViewRef.current?.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.zoom})`)
  }, [])

  const toSvg = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: point.x, y: point.y }
  }

  const zoomAt = useCallback((factor: number, clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm || !mapViewRef.current) return
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    const view = viewRef.current
    const zoom = Math.min(4, Math.max(.75, view.zoom * factor))
    if (zoom === view.zoom) return
    view.x = point.x - (point.x - view.x) * (zoom / view.zoom)
    view.y = point.y - (point.y - view.y) * (zoom / view.zoom)
    view.zoom = zoom
    writeView()
  }, [writeView])

  const zoomFromCenter = (factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (rect) zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const resetView = () => {
    viewRef.current = { x: 0, y: 0, zoom: 1 }
    writeView()
  }

  useEffect(() => { writeView() }, [writeView])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(Math.exp(-event.deltaY * .0015), event.clientX, event.clientY)
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [zoomAt])

  useEffect(() => {
    const interactive = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]')
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || interactive(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    suppressClick.current = false
    if (event.button !== 1 && !(event.button === 0 && spaceHeld)) return
    const point = toSvg(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    dragRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, moved: false }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = toSvg(event.clientX, event.clientY)
    if (!point) return
    const dx = point.x - drag.x
    const dy = point.y - drag.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 1.5) return
    drag.moved = true
    drag.x = point.x
    drag.y = point.y
    viewRef.current.x += dx
    viewRef.current.y += dy
    writeView()
  }

  const endPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    suppressClick.current = drag.moved
    dragRef.current = null
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const guardClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }
  const artByKind = {
    casa: <Cottage />,
    horta: <Garden moisture={world.vitals.umidade} fruit={world.harvestable(map.findSite('horta').area[0], 'fruta')} stage={world.gardenStage} />,
    bosque: world.tree(map.findSite('bosque').area[0]) === 'em_pe' ? <Pine /> : <FallenTree />,
    pedreira: world.harvestable(map.findSite('pedreira').area[0], 'pedra') ? <RockPile /> : null,
    margem: <Bucket />,
    lago: null,
    marco: <path d="M-3 2v-20l-8-3v-7l22 5v8l-8-1V2Z" fill="#b18b61" stroke="#69563e" />,
  }
  const objects: { at: Point; key: string; art: ReactNode }[] = [
    ...map.sites.filter(site => site.kind !== 'lago').map(site => ({
      at: site.area[0], key: `local:${site.id}`, art: <g><title>{site.name}</title>{artByKind[site.kind]}</g>,
    })),
    { at: world.workbench, key: 'bancada', art: <g data-workbench>
      <title>Bancada de trabalho</title>
      <g transform={same(world.workbench, map.findSite('casa').area[0]) ? 'translate(20 11) scale(.72)' : undefined}>
        <CompositionArt look={workbenchAppearance} />
      </g>
    </g> },
    { at: world.researchTable, key: 'pesquisa', art: <g data-research-table={pointKey(world.researchTable)} data-researching={!!world.researchTopic}
      transform={same(world.researchTable, map.findSite('casa').area[0]) ? 'translate(-20 10) scale(.7)' : undefined}>
      <ResearchStation busy={!!world.researchTopic} />
    </g> },
    { at: map.fruitTree, key: 'fruteira', art: <g transform={map.siteAt(map.fruitTree) ? 'translate(19 6) scale(.8)' : undefined}>
      <FruitTree fruit={world.harvestable(map.fruitTree, 'fruta')} />
    </g> },
    ...map.trees.filter(at => !builds.some(b => same(b.at, at)) && !world.installed.some(entry => same(entry.at, at))
      && (!draft || !same(draft.at, at))).map((at, i) => ({
      at, key: `pinheiro:${pointKey(at)}`, art: world.tree(at) === 'em_pe' ? <Pine tint={i % 2} /> : <FallenTree />,
    })),
    ...world.installed.flatMap(entry => {
      const item = world.item(entry.item)
      return item ? [{ at: entry.at, key: `installed:${entry.turn}`, art: <InstalledArt item={item} look={entry.aparencia} /> }] : []
    }),
    ...builds.map(b => ({
      at: b.at, key: `build:${b.id}`, art: <g className="map-invention" role="button" tabIndex={0} data-invention-id={b.id}
        aria-label={b.plan.nome} onClick={() => onSelect(b.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(b.id) }
        }}>
        <title>{b.plan.nome}</title>
        <rect x="-36" y="-74" width="72" height="86" fill="transparent" />
        <HealthBar value={b.broken ? 0 : 100} y={-64} label={`Estrutura: ${b.plan.nome}`} />
        {selected === b.id && <polygon points={diamond(41, 21)} fill="#ffeeb6" fillOpacity=".35" stroke="#fff2bd" strokeWidth="2" />}
        <g opacity={b.broken ? .45 : 1}>
          {draft?.renovationOf === b.id
            ? <g opacity=".55"><InventionArt plan={draft.plan} /></g>
            : <InventionArt plan={b.plan} />}
        </g>
        {b.broken && <g stroke="#8c3f39" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M-14-22 2-12-6-2 10 6" />
          <path d="M-10 4-2 12" />
        </g>}
      </g>,
    })),
  ]
  if (draft && draft.renovationOf === undefined) {
    objects.push({ at: draft.at, key: 'rascunho', art: <g opacity=".55"><InventionArt plan={draft.plan} /></g> })
  }
  for (const character of world.characters) {
    if (character.id === world.activeId) continue
    objects.push({
      at: character.at, key: `hero:${character.id}`,
      art: character.alive
        ? <g><Figure variant={character.id} /><HealthBar value={character.vitals.hp} y={-46} label={`HP de ${character.name}`} /></g>
        : <Grave name={character.name} />,
    })
  }
  for (const animal of world.animals) {
    objects.push({ at: animal.at, key: `animal:${animal.id}`, art: <Boar id={animal.id} hp={animal.hp} /> })
  }
  for (const drop of world.drops) {
    objects.push({ at: drop.at, key: `drop:${drop.id}`, art: <Loot /> })
  }
  const active = world.active
  objects.push({
    at: actor, key: 'laya', art: active.alive
      ? <g>
        <g transform={`scale(${facing < 0 ? -1 : 1} 1)`}><Figure variant={active.id} /></g>
        <HealthBar value={active.vitals.hp} y={-46} label={`HP de ${active.name}`} />
      </g>
      : <Grave name={active.name} />,
  })
  objects.sort((a, b) => a.at.x + a.at.y - b.at.x - b.at.y || Number(a.key === 'laya') - Number(b.key === 'laya'))
  const shadow = [
    { x: -.5, y: -.5 }, { x: map.width - .5, y: -.5 },
    { x: map.width - .5, y: map.height - .5 }, { x: -.5, y: map.height - .5 },
  ].map(project).map(p => `${p.x + 3},${p.y + 32}`).join(' ')
  return <>
    <svg ref={svgRef} className={`valley-svg ${paused ? 'paused' : ''} ${night ? 'night' : ''} ${spaceHeld ? 'can-pan' : ''} ${panning ? 'panning' : ''}`}
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 486" aria-label={`Mapa isométrico: ${map.name}`}
      onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}
      onClickCapture={guardClick} onAuxClick={event => { if (event.button === 1) event.preventDefault() }}
      onMouseDown={event => { if (event.button === 1) event.preventDefault() }}>
    <defs>
      <linearGradient id="sky" x2="0" y2="1">
        <stop stopColor={night ? '#738d9d' : '#dfe9ce'} />
        <stop offset="1" stopColor={night ? '#a5b5ad' : '#f2eed5'} />
      </linearGradient>
      <pattern id="paper-dots" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1" fill="#536e55" opacity=".12" />
      </pattern>
    </defs>
    <rect width="800" height="486" fill="url(#sky)" />
    <rect width="800" height="486" fill="url(#paper-dots)" />
    <g opacity=".7" fill={night ? '#d1ded3' : '#f8f6df'}>
      <path d="M107 85q7-15 22-10 10-13 23 0 15-2 21 10Z" />
      <path d="M544 63q6-13 18-10 12-13 22 2 10-2 17 8Z" />
      <path d="M663 117q7-13 20-10 8-10 20-1 12-1 18 11Z" />
    </g>
    <circle cx="663" cy="62" r="21" fill={night ? '#e9edd6' : '#f4d387'} opacity=".9" />
    <path d="M0 205 85 169l85 24 79-31 87 45 70-8 49-39 110 27 64-25 85 33 86-8v133H0Z"
      fill={night ? '#687f84' : '#c0ceab'} opacity=".36" />
    <g ref={mapViewRef} data-map-view>
      <g transform={`translate(400 240) scale(${scale}) translate(${-center.x} ${-center.y})`}>
        <polygon points={shadow} fill="#597554" opacity=".13" />
        {[...map.tiles].sort((a, b) => a.x + a.y - b.x - b.y).map(at => <Ground key={pointKey(at)} at={at} world={world} />)}
        {destination && <g transform={position(destination)}>
          <polygon points={diamond(42, 21)} fill="#f5e3a3" fillOpacity=".29" stroke="#fff0ba" strokeWidth="1.8" strokeDasharray="4 5" />
        </g>}
        {objects.map(o => o.key === 'laya'
          ? <g key={o.key} className={`laya-figure ${walking ? 'walking' : ''}`}
            style={{ transform: `translate(${actorPx.x}px, ${actorPx.y + 8}px)`, transitionDuration: `${stepMs}ms` }}>{o.art}</g>
          : <g key={o.key} transform={position(o.at)}>{o.art}</g>)}
      </g>
    </g>
    {night && <rect width="800" height="486" fill="#3f5673" opacity=".19" pointerEvents="none" />}
    {rain && <g className="valley-rain" stroke="#e5f3e4" strokeWidth="1.5" opacity=".65" pointerEvents="none">
      {Array.from({ length: 60 }, (_, i) => {
        const x = 33 + ((i * 133) % 739)
        const y = 12 + ((i * 73) % 455)
        return <path key={i} d={`M${x} ${y}l-6 12`} />
      })}
    </g>}
    <g fill="#4b6547" opacity=".74" fontSize="11" fontWeight="700" letterSpacing="2">
      <text x="30" y="453">VALE 01</text>
      <text x="770" textAnchor="end" y="453">{map.width} × {map.height}</text>
    </g>
    </svg>
    <div className="map-tools" aria-label="Zoom e navegação do mapa">
      <span className="map-tools-hint">Espaço + arrastar · botão do meio</span>
      <button type="button" aria-label="Diminuir zoom" onClick={() => zoomFromCenter(1 / 1.25)}>−</button>
      <button type="button" aria-label="Restaurar mapa" onClick={resetView}>1:1</button>
      <button type="button" aria-label="Aumentar zoom" onClick={() => zoomFromCenter(1.25)}>+</button>
    </div>
  </>
}
