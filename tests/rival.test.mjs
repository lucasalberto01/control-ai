import assert from 'node:assert/strict'
import test from 'node:test'
import { World } from '../src/world.ts'
import { fromSave, toSave } from '../src/world-save.ts'
import { TurnPlanner } from '../src/turn-planner.ts'

const focus = (world, id) => {
  const next = World.fromState(world.map, {
    ...world.toState(), active: world.characters.findIndex(character => character.id === id),
  })
  assert.ok(next)
  return next
}
const wait = (world, id) => {
  const actor = focus(world, id)
  return actor.complete({ id: 'esperar', kind: 'wait', at: actor.position, score: 1 })
}
const simplePlan = {
  nome: 'Marco de Teste', tipo: 'objeto', ideia: 'Um marco para descansar e recuperar a energia.',
  custo: { madeira: 1, pedra: 0 }, aparencia: {
    base: { peca: 'laje', cor: 'arenito' }, suporte: null, corpo: null,
    topo: { peca: 'estatua', cor: 'arenito' }, adorno: null,
  }, regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 6, insumo: 'nenhum' }], pecas: [],
}

test('duas personagens alternam o turno e têm mochilas separadas', () => {
  const world = World.create()
  assert.deepEqual(world.characters.map(character => character.id), ['laya', 'kael'])
  assert.equal(world.activeId, 'laya')
  const next = world.complete(world.actions().find(action => action.kind === 'walk'))
  assert.equal(next.activeId, 'kael')
  const [laya, kael] = next.characters
  assert.notEqual(laya.inventory, kael.inventory)
  assert.notEqual(laya.inventory.slots, kael.inventory.slots)
})

test('não planeja ação no tile ocupado pela outra personagem', () => {
  const base = World.create()
  const lookout = base.map.lookouts[0]
  const state = { ...base.toState(), animals: [] }
  state.rival = { ...state.rival, at: { ...lookout } }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const actions = world.actions()
  assert.ok(actions.length > 0)
  assert.ok(!actions.some(action => action.at.x === lookout.x && action.at.y === lookout.y),
    'Nenhuma ação deve mandar a personagem para o tile do Kael')
  assert.ok(!actions.some(action => action.id === 'passear'))

  const home = base.map.findSite('casa').area[0]
  const tired = World.fromState(base.map, {
    ...base.toState(), animals: [], vitals: { ...base.toState().vitals, energia: 20 },
    rival: { ...base.toState().rival, at: { ...home } },
  })
  assert.ok(tired)
  assert.ok(tired.actions().some(action => action.kind === 'rest'), 'Dormir em casa continua possível com o Kael lá')
})

test('atacar, matar, saquear e reviver: o morto perde mochila e XP', () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = {
    ...base.toState(), active: 1, xp: 40, animals: [],
    vitals: { ...base.toState().vitals, hp: 2 },
  }
  state.rival = {
    ...base.toState().rival,
    at: { x: laya.at.x + 1, y: laya.at.y },
    vitals: { ...base.toState().rival.vitals, hp: 100 },
    xp: 0,
  }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const attack = world.actions().find(action => action.kind === 'attack' && action.target.kind === 'character')
  assert.ok(attack, 'Kael precisa poder atacar a Laya ao lado')
  const after = world.complete(attack)
  const dead = after.character('laya')
  assert.equal(dead.alive, false)
  assert.equal(dead.vitals.hp, 0)
  assert.equal(dead.xp, 0)
  assert.equal(after.character('kael').xp, 20, 'Metade do XP da vítima')
  assert.equal(dead.inventory.slots.filter(Boolean).length, 0, 'A mochila caiu')
  assert.equal(after.drops.length, 1)
  assert.ok(after.drops[0].items.some(stack => stack.item === 'madeira'))
  assert.equal(after.drops[0].at.x, laya.at.x)

  const revived = after.revive('laya')
  assert.equal(revived.character('laya').alive, true)
  assert.equal(revived.character('laya').xp, 0)
  assert.equal(revived.character('laya').inventory.slots.filter(Boolean).length, 0)
  assert.equal(revived.vitals.hp, 100)
})

test('largar item perto do outro e o outro recolhe no chão', () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = { ...base.toState(), active: 0, animals: [] }
  state.rival = { ...state.rival, at: { x: laya.at.x + 1, y: laya.at.y } }
  // A personagem só divide itens quando a mochila está quase cheia.
  state.inventory = state.inventory.map(() => ({ item: 'pedra', quantity: 1 }))
  let world = World.fromState(base.map, state)
  const drop = world.actions().find(action => action.kind === 'drop')
  assert.ok(drop, 'A Laya pode largar um item para o Kael')
  const item = drop.item
  world = world.complete(drop)
  assert.equal(world.drops.length, 1)
  const dropped = world.drops[0]
  assert.ok(dropped.items.some(stack => stack.item === item))

  // A Laya sai de cima do loot para o Kael poder chegar.
  world = focus(world, 'laya')
  world = world.complete(world.actions().find(action => action.kind === 'walk'))
  world = focus(world, 'kael')
  const take = world.actions().find(action => action.kind === 'take')
  assert.ok(take, 'O Kael vê o item no chão')
  const after = world.complete(take)
  assert.ok(after.character('kael').inventory.count(item) >= 1)
  assert.equal(after.drops.length, 0)
})

test('animal ataca quem está perto; matar o animal dá XP', () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = { ...base.toState(), active: 0 }
  state.rival = { ...state.rival, at: { x: 0, y: 0 } }
  state.animals = [{ id: 1, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 2, nextBreak: 0 }]
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const attack = world.actions().find(action => action.kind === 'attack' && action.target.kind === 'animal')
  assert.ok(attack)
  const after = world.complete(attack)
  assert.equal(after.animals.length, 0)
  assert.ok(after.character('laya').xp >= 12)

  const dangerous = World.fromState(base.map, {
    ...base.toState(), active: 0, animals: [{ id: 1, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 12, nextBreak: 0 }],
    vitals: { ...base.toState().vitals, hp: 4 },
  })
  const bitten = wait(dangerous, 'laya')
  assert.equal(bitten.character('laya').alive, false)
  assert.ok(bitten.drops.length >= 1)
})

test('a personagem age antes do animal e o abate evita a mordida', () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = {
    ...base.toState(), active: 0,
    vitals: { ...base.toState().vitals, hp: 2 },
    animals: [{ id: 1, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 2, nextBreak: 0, nextBite: 0 }],
  }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const attack = world.actions().find(action => action.kind === 'attack' && action.target.kind === 'animal')
  assert.ok(attack)
  const after = world.complete(attack)
  assert.equal(after.character('laya').alive, true, 'Laya precisa atacar antes de levar a mordida')
  assert.equal(after.animals.length, 0)
})

test('cada animal morde no máximo uma vez a cada dois turnos', () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = {
    ...base.toState(), active: 0,
    vitals: { ...base.toState().vitals, hp: 100, energia: 25, fome: 20, alegria: 40, sede: 20 },
    animals: [{ id: 1, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 12, nextBreak: 0, nextBite: 0 }],
  }
  const start = World.fromState(base.map, state)
  assert.ok(start)
  const first = wait(start, 'laya')
  assert.equal(first.character('laya').vitals.hp, 96, 'Morde no turno da Laya')
  assert.equal(first.animals[0].nextBite, first.turn + 2)
  const second = wait(first, 'kael')
  assert.equal(second.character('laya').vitals.hp, 96, 'No turno do Kael, o mesmo animal não morde de novo')
  const third = wait(second, 'laya')
  assert.equal(third.character('laya').vitals.hp, 92, 'Na volta da Laya, ele pode morder outra vez')
})

test('a personagem pode demolir a criação da outra', () => {
  const base = World.create()
  const at = base.constructionTiles()[0]
  let world = focus(base, 'laya')
  world = world.complete({ id: 'montar_kit', kind: 'assemble', at: world.workbench, plot: at, plan: simplePlan })
  world = focus(world, 'laya')
  world = world.complete(world.actions().find(action => action.kind === 'pickup_kit'))
  world = focus(world, 'laya')
  world = world.complete(world.actions().find(action => action.kind === 'build'))
  assert.equal(world.builds.length, 1)
  assert.equal(world.builds[0].owner, 'laya')

  const state = { ...world.toState(), active: 1, animals: [] }
  state.rival = { ...state.rival, at: { x: at.x + 1, y: at.y } }
  const rival = World.fromState(world.map, state)
  assert.ok(rival)
  const demolish = rival.actions().find(action => action.kind === 'demolish')
  assert.ok(demolish, 'Kael pode destruir a criação da Laya')
  const after = rival.complete(demolish)
  assert.equal(after.builds.length, 0)
  assert.equal(after.character('kael').xp, 3)
})

test('save guarda as duas personagens, animais e itens no chão', () => {
  const base = World.create()
  const state = { ...base.toState(), animals: [{ id: 2, at: { x: 3, y: 2 }, hp: 7, nextBreak: 0 }] }
  state.drops = [{ id: 9, at: { x: 2, y: 3 }, items: [{ item: 'pedra', quantity: 2 }] }]
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const restored = fromSave(JSON.parse(JSON.stringify(toSave(world))))
  assert.deepEqual(restored.toState(), world.toState())
  assert.equal(restored.animals.length, 1)
  assert.equal(restored.drops.length, 1)
})

test('o planejador não repete a ação que acabou de falhar', async () => {
  const world = World.create()
  const top = world.actions()[0]
  assert.ok(top)
  let keys = []
  const planner = new TurnPlanner({
    async decide(_state, choices) { keys = Object.keys(choices); return { ok: true, value: keys[0] } },
    async invent() { return { ok: false, error: 'Sem projeto.' } },
    async renovate() { return { ok: false, error: 'Sem reforma.' } },
  })
  const turn = await planner.plan(world, { model() {}, activity() {} }, new Set([top.id]))
  assert.ok(keys.length > 0)
  assert.ok(!keys.includes(top.id), 'A ação recusada sai da lista por um turno')
  assert.notEqual(turn.action.id, top.id)
})

test('save antigo sem rival ganha a segunda personagem e os animais', () => {
  const save = toSave(World.create())
  delete save.state.rival
  delete save.state.animals
  delete save.state.lastExpand
  const world = fromSave(save)
  assert.equal(world.characters.length, 2)
  assert.equal(world.character('kael').alive, true)
  assert.equal(world.animals.length, 2)
  assert.equal(world.toState().lastExpand, 0)
})
