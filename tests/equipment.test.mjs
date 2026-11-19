import assert from 'node:assert/strict'
import test from 'node:test'
import { World } from '../src/world.ts'
import { fromSave, toSave } from '../src/world-save.ts'
import { readItem } from '../src/inventory.ts'
import { readRecipeDraft } from '../src/crafting.ts'
import { TurnPlanner } from '../src/turn-planner.ts'

const sword = {
  id: 'espada_teste', name: 'Espada de Teste', emoji: '🗡️', kind: 'objeto',
  capability: 'nenhuma', fuel: false, damage: 8,
}
const shield = {
  id: 'escudo_teste', name: 'Escudo de Teste', emoji: '🛡️', kind: 'objeto',
  capability: 'nenhuma', fuel: false, protection: 5,
}
const tower = { ...shield, id: 'escudo_torre', name: 'Escudo Torre', protection: 12 }

const focus = (world, id = 'laya') => {
  const next = World.fromState(world.map, {
    ...world.toState(), active: world.characters.findIndex(character => character.id === id),
  })
  assert.ok(next)
  return next
}

const fillSlot = (slots, id) => {
  const copy = [...slots]
  const index = copy.findIndex(slot => !slot)
  assert.ok(index >= 0)
  copy[index] = { item: id, quantity: 1 }
  return copy
}

function gearWorld(items, bag = { laya: [], kael: [] }) {
  const base = World.create()
  const state = structuredClone(base.toState())
  state.animals = []
  state.items = [...(state.items ?? []), ...items]
  const fill = (slots, ids) => {
    const copy = [...slots]
    for (const id of ids) {
      const index = copy.findIndex(slot => !slot)
      assert.ok(index >= 0)
      copy[index] = { item: id, quantity: 1 }
    }
    return copy
  }
  state.inventory = fill(state.inventory, bag.laya ?? [])
  state.rival = { ...state.rival, bag: fill(state.rival.bag, bag.kael ?? []) }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  return world
}

test('um slot de equipamento: arma aumenta o dano, armadura ocupa o mesmo lugar', () => {
  let world = gearWorld([sword, shield], { laya: ['espada_teste', 'escudo_teste'] })
  world = focus(world)
  const equipSword = world.actions().find(action => action.kind === 'equip' && action.item === 'espada_teste')
  assert.ok(equipSword, 'A espada precisa poder ser equipada')
  world = world.complete(equipSword)
  assert.equal(world.character('laya').equipment, 'espada_teste')
  assert.equal(world.character('laya').inventory.count('espada_teste'), 1, 'O item continua na mochila')

  const laya = world.character('laya')
  const combat = World.fromState(world.map, {
    ...world.toState(), active: 0,
    animals: [{ id: 7, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 12, nextBreak: 0 }],
  })
  assert.ok(combat)
  const attack = combat.actions().find(action =>
    action.kind === 'attack' && action.target.kind === 'animal' && action.target.id === 7)
  assert.ok(attack)
  const hurt = combat.complete(attack)
  assert.equal(hurt.animals.find(animal => animal.id === 7).hp, 4, '8 de dano da espada')

  const layaTurn = focus(hurt)
  const equipShield = layaTurn.actions().find(action => action.kind === 'equip' && action.item === 'escudo_teste')
  assert.ok(equipShield, 'A armadura também pode ser equipada')
  const armored = layaTurn.complete(equipShield)
  assert.equal(armored.character('laya').equipment, 'escudo_teste')
  assert.equal(armored.character('laya').inventory.count('espada_teste'), 1, 'A espada volta para a mochila')

  const laya2 = armored.character('laya')
  const combat2 = World.fromState(armored.map, {
    ...armored.toState(), active: 0,
    animals: [{ id: 8, at: { x: laya2.at.x + 1, y: laya2.at.y }, hp: 12, nextBreak: 0 }],
  })
  assert.ok(combat2)
  const attack2 = combat2.actions().find(action =>
    action.kind === 'attack' && action.target.kind === 'animal' && action.target.id === 8)
  assert.ok(attack2)
  const after2 = combat2.complete(attack2)
  assert.equal(after2.animals.find(animal => animal.id === 8).hp, 10, 'Com a armadura, o golpe volta a ser o punho')
})

test('proteção reduz mordidas e golpes, com no mínimo 1 de dano', () => {
  let world = gearWorld([tower], { laya: ['escudo_torre'] })
  world = focus(world)
  world = world.complete(world.actions().find(action => action.kind === 'equip' && action.item === 'escudo_torre'))
  assert.equal(world.character('laya').equipment, 'escudo_torre')

  const laya = world.character('laya')
  const bittenWorld = World.fromState(world.map, {
    ...world.toState(), active: 0,
    vitals: { ...world.character('laya').vitals, hp: 100, energia: 20, fome: 20, alegria: 40, sede: 20 },
    animals: [{ id: 9, at: { x: laya.at.x + 1, y: laya.at.y }, hp: 12, nextBreak: 0 }],
  })
  assert.ok(bittenWorld)
  const bitten = bittenWorld.complete({ id: 'esperar', kind: 'wait', label: 'Esperar', at: bittenWorld.position, score: 1 })
  assert.equal(bitten.character('laya').vitals.hp, 99, 'A mordida de 4 vira 1 com proteção 12')

  const duelState = structuredClone(world.toState())
  duelState.active = 1
  duelState.animals = []
  duelState.items = [...(duelState.items ?? []), sword]
  duelState.rival = {
    ...duelState.rival, at: { x: laya.at.x + 1, y: laya.at.y }, equipment: 'espada_teste',
    bag: fillSlot(duelState.rival.bag, 'espada_teste'),
  }
  const armed = World.fromState(world.map, duelState)
  assert.ok(armed)
  const strike = armed.actions().find(action => action.kind === 'attack' && action.target.kind === 'character')
  assert.ok(strike)
  const after = armed.complete(strike)
  assert.equal(after.character('laya').vitals.hp, 99, '8 de dano contra proteção 12 também vira 1')
})

test('arma antiga vira equipamento, cai ao morrer e some ao reviver', () => {
  let world = gearWorld([sword], { laya: ['espada_teste'] })
  world = focus(world)
  world = world.complete(world.actions().find(action => action.kind === 'equip' && action.item === 'espada_teste'))
  const legacy = world.toState()
  delete legacy.equipment
  legacy.weapon = 'espada_teste'
  const restored = World.fromState(world.map, legacy)
  assert.ok(restored)
  assert.equal(restored.character('laya').equipment, 'espada_teste', 'O campo weapon antigo migra para o slot')
  assert.equal(fromSave(JSON.parse(JSON.stringify(toSave(restored)))).character('laya').equipment, 'espada_teste')

  const laya = restored.character('laya')
  const duel = World.fromState(restored.map, {
    ...restored.toState(), active: 1, animals: [], vitals: { ...restored.character('laya').vitals, hp: 2 },
    rival: { ...restored.toState().rival, at: { x: laya.at.x + 1, y: laya.at.y } },
  })
  assert.ok(duel)
  const strike = duel.actions().find(action => action.kind === 'attack' && action.target.kind === 'character')
  assert.ok(strike)
  const dead = duel.complete(strike)
  assert.equal(dead.character('laya').alive, false)
  assert.equal(dead.character('laya').equipment, undefined)
  assert.ok(dead.drops.some(drop => drop.items.some(stack => stack.item === 'espada_teste')))
  const revived = dead.revive('laya')
  assert.equal(revived.character('laya').equipment, undefined)
  assert.equal(revived.character('laya').inventory.slots.filter(Boolean).length, 0)
})

test('itens com proteção não são instalações e a receita aceita o atributo', () => {
  const world = gearWorld([shield], { laya: ['escudo_teste'] })
  assert.ok(!world.actions().some(action => action.kind === 'install' && action.item === 'escudo_teste'))
  assert.equal(readItem(shield)?.protection, 5)
  assert.equal(readItem({ ...shield, kind: 'material' }), null)
  const draft = readRecipeDraft({
    name: 'Escudo de Teste', process: 'montar', inputs: [{ item: 'madeira', quantity: 2 }],
    fuel: null, output: { item: 'escudo_teste', quantity: 1 }, newItem: shield,
  })
  assert.ok(draft)
  assert.equal(draft.newItem?.protection, 5)
})

test('o planejador mostra a opção de equipar para a IA', async () => {
  const world = gearWorld([sword], { laya: ['espada_teste'] })
  let keys = []
  const planner = new TurnPlanner({
    async decide(_state, choices) { keys = Object.keys(choices); return { ok: true, value: keys[0] } },
    async invent() { return { ok: false, error: 'Sem projeto.' } },
    async renovate() { return { ok: false, error: 'Sem reforma.' } },
  })
  await planner.plan(world, { model() {}, activity() {} })
  assert.ok(keys.some(key => key.startsWith('equipar_')), 'Equipar precisa chegar às escolhas do modelo')
})
