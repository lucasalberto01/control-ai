import { useEffect, useRef, useState } from 'react'
import { World } from './world'
import { same } from './world-map'
import type { Point } from './world-map'
import { fromSave, LEGACY_SAVE_KEY } from './world-save'
import { TurnPlanner } from './turn-planner'
import type { ModelState, Turn } from './turn-planner'
import type { ResearchNotice } from './local-ai'
import type { CharacterId } from './character'

export type Speed = 1 | 2 | 4
type Motion = Turn & { route: Point[]; index: number }
const initialModels = { decision: 'Aguardando', generation: 'Aguardando' }

export function useWorld() {
  const [world, setWorld] = useState<World | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [storageError, setStorageError] = useState('')
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [motion, setMotion] = useState<Motion | null>(null)
  const [activity, setActivity] = useState('Observando os arredores…')
  const [models, setModels] = useState<ModelState>(initialModels)
  const [notice, setNotice] = useState<ResearchNotice>()
  const [planner] = useState(() => new TurnPlanner(window.localAI))
  const pending = useRef<{ world: World; turn: Promise<Turn> }>()
  const saving = useRef<Promise<void>>()
  const failed = useRef(new Set<string>())

  useEffect(() => {
    const notices = window.researchNotices
    if (!notices) return
    return notices.onResult(setNotice)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(undefined), 10_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const storage = window.worldStorage
    if (!storage) {
      try { setWorld(World.create()) } catch { setStorageError('Configuração inicial do vale inválida.') }
      return
    }
    let active = true
    let legacy: string | null = null
    try { legacy = localStorage.getItem(LEGACY_SAVE_KEY) } catch { /* New saves use the JSON file. */ }
    void storage.load(legacy).then(reply => {
      if (!active) return
      if (reply.ok) setWorld(fromSave(reply.value))
      else setStorageError(reply.error)
    }).catch(() => { if (active) setStorageError('Não foi possível carregar o progresso do vale.') })
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => {
    if (!world || paused || motion) return
    if (!world.hasLivingCharacter) {
      setActivity('Alguém precisa ser revivido para o vale continuar.')
      return
    }
    let canceled = false
    const timer = window.setTimeout(() => {
      if (pending.current?.world !== world) {
        pending.current = {
          world,
          turn: Promise.resolve(saving.current).then(() => planner.plan(world, {
            model: (part, state) => setModels(m => ({ ...m, [part]: state })),
            activity: setActivity,
          }, failed.current)),
        }
      }
      void pending.current.turn.then(turn => {
        if (canceled) return
        const route = world.pathTo(turn.action.at) ?? []
        setActivity(turn.action.label)
        setMotion({ ...turn, route, index: 0 })
      })
    }, 900 / speed)
    return () => {
      canceled = true
      window.clearTimeout(timer)
    }
  }, [motion, paused, planner, speed, world])

  useEffect(() => {
    if (!world || paused || !motion) return
    const walking = motion.index < motion.route.length
    const construction = ['build', 'renovation', 'assemble', 'install', 'craft'].includes(motion.action.kind)
    const duration = walking ? 315 : construction ? 1700 : 1170
    const timer = window.setTimeout(() => {
      if (walking) setMotion({ ...motion, index: motion.index + 1 })
      else {
        let next: World
        try {
          next = world.complete(motion.action, motion.postpone)
        } catch (error) {
          console.error('A ação planejada foi recusada pelo mundo.', error)
          failed.current.add(motion.action.id)
          pending.current = undefined
          setMotion(null)
          setActivity(`A ação de ${world.active.name} não pôde ser concluída; vai tentar outra coisa.`)
          // Nunca deixa o turno parado: se a ação falhar de novo, o vale espera e passa a vez.
          if (motion.action.kind !== 'wait') {
            try {
              const wait = { id: 'esperar', kind: 'wait' as const, label: `${world.active.name} espera`, at: world.position, score: 1 }
              const idle = world.complete(wait)
              saving.current = window.worldStorage?.save(idle.toState(), idle.map.toData()).then(reply => {
                setStorageError(reply.ok ? '' : reply.error)
              }).catch(() => setStorageError('Não foi possível gravar o progresso do vale.'))
              setWorld(idle)
              setActivity(`${world.active.name} esperou e passou a vez.`)
            } catch (fallback) {
              console.error('O vale não conseguiu nem esperar.', fallback)
            }
          }
          return
        }
        if (motion.action.kind !== 'wait') failed.current.clear()
        saving.current = window.worldStorage?.save(next.toState(), next.map.toData()).then(reply => {
          setStorageError(reply.ok ? '' : reply.error)
        }).catch(() => setStorageError('Não foi possível gravar o progresso do vale.'))
        setWorld(next)
        setMotion(null)
        setActivity('Observando os arredores…')
      }
    }, duration / speed)
    return () => window.clearTimeout(timer)
  }, [motion, paused, speed, world])

  if (!world) return {
    world: null, storageError,
    retryLoad: () => { setStorageError(''); setLoadAttempt(attempt => attempt + 1) },
    revive: () => {},
  } as const

  const actor = motion?.route[motion.index - 1] ?? world.position
  const previous = motion?.route[motion.index - 2] ?? world.position
  const action = motion?.action
  let draft
  if (action?.kind === 'build') {
    const plan = world.previewBuild(action.at)
    if (plan) draft = { at: action.at, plan }
  }
  if (action?.kind === 'renovation' && same(actor, action.at)) {
    const plan = world.previewRenovation(action.objectId, action.upgrade)
    if (plan) draft = { at: action.at, plan, renovationOf: action.objectId }
  }
  const revive = (id: CharacterId) => {
    if (!world) return
    const next = world.revive(id)
    if (next === world) return
    saving.current = window.worldStorage?.save(next.toState(), next.map.toData()).then(reply => {
      setStorageError(reply.ok ? '' : reply.error)
    }).catch(() => setStorageError('Não foi possível gravar o progresso do vale.'))
    setWorld(next)
    setMotion(null)
    setActivity(`${next.active.name} voltou ao vale sem nada.`)
  }

  return {
    world, paused, setPaused, speed, setSpeed, activity, models, actor, storageError, notice, revive,
    dismissNotice: () => setNotice(undefined),
    facing: same(previous, actor) ? 1 : (actor.x - previous.x) - (actor.y - previous.y),
    walking: !paused && !!motion && motion.index > 0 && motion.index < motion.route.length,
    destination: motion && !same(actor, motion.action.at) ? motion.action.at : undefined,
    draft,
  }
}
