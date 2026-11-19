import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import test from 'node:test'
import { World } from '../src/world.ts'
import { WorldMap } from '../src/world-map.ts'
import { fromSave, toSave } from '../src/world-save.ts'
import { TurnPlanner } from '../src/turn-planner.ts'
import { hasWaterSupply, ruleKey } from '../src/blueprint.ts'

const stack = (item, quantity = 1) => ({ item, quantity })
const observer = { model() {}, activity() {} }
const apply = (world, kind) => {
  const action = world.actions().find(a => a.kind === kind)
  assert.ok(action, `Ação indisponível: ${kind}`)
  return world.complete(action)
}
const gather = (world, item) => {
  const action = world.actions().find(a => a.kind === 'gather' && a.resource === item)
  assert.ok(action, `Coleta indisponível: ${item}`)
  return world.complete(action)
}

function withChanges(world, changes, vitals = {}) {
  const changed = World.fromState(world.map, { ...world.toState(), ...changes, vitals: { ...world.vitals, ...vitals } })
  assert.ok(changed)
  return changed
}

function drought(world) {
  const dry = world.map.tiles.filter(p => world.map.isWater(p)).map(at => ({ at, wood: 0, stone: 2, water: 0, fruit: 0, layers: 1 }))
  return withChanges(world, {
    terrain: [...world.toState().terrain.filter(c => !world.map.isWater(c.at)), ...dry],
    inventory: world.inventory.map(s => s?.item === 'agua' ? null : s),
  })
}

const rainRules = [
  { gatilho: 'chuva', verbo: 'gerar', alvo: 'agua', quantidade: 3, insumo: 'nenhum' },
  { gatilho: 'uso', verbo: 'transferir', alvo: 'agua', quantidade: 3, insumo: 'nenhum' },
]
const supply = {
  nome: 'Telha das Nuvens', tipo: 'objeto', ideia: 'Capta chuva e deixa Laya guardar a água na mochila.',
  custo: { madeira: 1, pedra: 1 }, aparencia: { modelo: 'coletor', acabamento: 'lagoa', detalhe: 'placa' },
  regras: rainRules, pecas: [],
}

test('sede só baixa ao beber água da mochila, que é debitada em uma unidade', () => {
  const world = withChanges(World.create(), {}, { sede: 84 })
  assert.equal(world.actions()[0].kind, 'drink')
  const drank = apply(world, 'drink')
  assert.equal(drank.bag.agua, world.bag.agua - 1)
  assert.equal(drank.vitals.sede, 25)
  assert.equal(drank.vitals.hp, 100)
  assert.throws(() => drought(world).complete(world.actions()[0]), /ação/)
})

test('energia baixa, fome, tristeza e sede tiram HP separadamente e o dano acumula', () => {
  const world = World.create()
  for (const vitals of [{ energia: 12 }, { fome: 85 }, { alegria: 10 }, { sede: 85 }]) {
    assert.equal(gather(withChanges(world, {}, vitals), 'pedra').vitals.hp, 96)
  }
  const critical = withChanges(world, {}, { energia: 12, fome: 85, alegria: 10, sede: 85 })
  assert.equal(gather(critical, 'pedra').vitals.hp, 84)
  const healthy = withChanges(world, {}, { hp: 63 })
  assert.equal(gather(healthy, 'pedra').vitals.hp, 67)
})

test('desmaio não cria recursos; a Laya só volta com o Reviver e perde tudo', () => {
  const world = withChanges(drought(World.create()), {}, { sede: 100, fome: 98, hp: 4 })
  const fainted = gather(world, 'pedra')
  assert.equal(fainted.vitals.hp, 0)
  assert.equal(fainted.character('laya').alive, false)
  assert.ok(fainted.drops.length >= 1, 'A mochila caiu no chão')
  assert.deepEqual(fainted.actions().map(action => action.kind), ['wait'])
  const revived = fainted.revive('laya')
  assert.equal(revived.character('laya').alive, true)
  assert.equal(revived.character('laya').xp, 0)
  assert.equal(revived.vitals.hp, 100)
  assert.equal(revived.inventory.filter(Boolean).length, 0, 'Volta sem nada')
  assert.equal(revived.lakeReserve, 0)
})

test('horta não produz sem plantio; a semente da árvore cresce com água e segue no save', () => {
  const initial = World.create()
  const horta = initial.map.findSite('horta').area[0]
  assert.equal(initial.gardenStage, 'vazia')
  assert.equal(initial.bag.fruta, 0)
  let world = gather(initial, 'fruta')
  assert.equal(world.bag.fruta, 3)
  assert.equal(world.harvestable(world.map.fruitTree, 'fruta'), 0)
  assert.ok(world.inventory.some(s => s?.item === 'semente_da_horta'))
  world = apply(withChanges(world, { minute: 350, log: [] }, { umidade: 0 }), 'walk')
  assert.equal(world.harvestable(world.map.fruitTree, 'fruta'), 3)
  assert.equal(world.harvestable(horta, 'fruta'), 0, 'Nem ao amanhecer a horta vazia produz')
  world = apply(world, 'plant')
  assert.equal(world.gardenStage, 'crescendo')
  assert.ok(!world.inventory.some(s => s?.item === 'semente_da_horta'))
  world = fromSave(toSave(apply(world, 'walk')))
  assert.equal(world.gardenStage, 'crescendo')
  assert.equal(world.harvestable(horta, 'fruta'), 0)
  const before = world.bag.agua
  world = apply(world, 'water')
  assert.equal(world.bag.agua, before - 1)
  // A chuva do mapa também umedece uma lavoura já plantada.
  world = withChanges(world, { minute: 760 }, { umidade: 55 })
  for (let i = 0; i < 6; i++) world = apply(world, 'walk')
  assert.equal(world.gardenStage, 'madura')
  assert.equal(world.harvestable(horta, 'fruta'), 4)
  assert.equal(fromSave(toSave(world)).gardenStage, 'madura')
  world = apply(withChanges(world, {}, { fome: 83 }), 'eat')
  assert.equal(world.bag.fruta, 2)
  const pick = world.actions().find(a => a.kind === 'gather' && a.resource === 'fruta')
  // Harvest the mature garden even if the other tree is closer from this spot.
  const harvested = world.complete({ ...pick, at: horta, source: horta, quantity: 3 })
  assert.equal(harvested.bag.fruta, 5)
  assert.equal(harvested.harvestable(horta, 'fruta'), 1)
})

test('lago seco não reabastece com chuva e a fonte vem de uma proposta da IA, depois de montada e instalada', async () => {
  const dry = withChanges(drought(World.create()), { minute: 760 })
  let world = apply(dry, 'walk')
  assert.equal(world.weather.rain, true)
  assert.equal(world.lakeReserve, 0)
  assert.equal(world.bag.agua, 0)
  assert.equal(world.builds.length, 0)
  let requests = 0
  const planner = new TurnPlanner({
    async decide(_state, choices) { return { ok: true, value: Object.keys(choices)[0] } },
    async invent(prompt, _count, _first, _materials, budget) {
      assert.match(prompt, /guarde chuva/)
      assert.ok(budget.madeira >= 1 && budget.pedra >= 1)
      requests++
      return { ok: true, value: { plot: 0, plan: supply } }
    },
  })
  const visit = (await planner.plan(world, observer)).action
  assert.equal(visit.kind, 'visit_research')
  assert.equal(requests, 0)
  world = world.complete(visit)
  const idea = (await planner.plan(world, observer)).action
  assert.equal(idea.kind, 'record_project')
  world = apply(world.complete(idea), 'assemble')
  assert.equal(requests, 1)
  assert.equal(world.builds.length, 0)
  assert.equal(world.bag.agua, 0)
  world = apply(apply(fromSave(toSave(world)), 'pickup_kit'), 'build')
  assert.equal(world.builds[0].stock.agua, 0, 'A instalação não dá água de graça')
  world = apply(withChanges(world, { minute: 1460 }), 'walk')
  assert.equal(world.builds[0].stock.agua, 3)
  assert.equal(world.bag.agua, 0)
  const retrieve = world.actions().find(a => a.kind === 'pickup' && a.item === 'agua')
  assert.deepEqual(retrieve.at, world.builds[0].at)
  assert.throws(() => world.complete({ ...retrieve, at: world.map.findSite('casa').area[0] }), /produção ou coleta|ocupa esse tile/)
  world = world.complete(retrieve)
  assert.equal(world.bag.agua, 3)
  assert.equal(world.lakeReserve, 0)
  const stored = apply(world, 'pickup')
  assert.equal(stored.bag.agua, 4, 'A fonte completa a reserva sem encher a mochila')
})

test('num vale cheio, a Laya não transforma uma criação existente em cisterna', () => {
  const initial = World.create()
  const map = WorldMap.fromData({ ...initial.map.toData(), buildLimit: 1 })
  const world = World.fromState(map, initial.toState())
  const oldRules = [
    { gatilho: 'uso', verbo: 'efeito', alvo: 'alegria', quantidade: 6, insumo: 'nenhum' },
    { gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 6, insumo: 'nenhum' },
  ]
  const packed = apply(world.complete({ id: 'montar', kind: 'assemble', at: world.workbench, plot: world.constructionTiles()[0],
    plan: { ...supply, nome: 'Banco antigo', regras: oldRules } }), 'pickup_kit')
  let built = drought(apply(packed, 'build'))
  assert.deepEqual(built.builds[0].plan.regras.map(ruleKey), oldRules.map(ruleKey))
  while (built.builds[0].uses < 2) {
    built = built.actions().some(action => action.kind === 'use')
      ? apply(built, 'use') : apply(built, 'walk')
  }
  const id = built.builds[0].id
  assert.ok(!built.actions().some(action => action.kind === 'invent'), 'Sem terreno para uma fonte nova')
  const visual = { ideia: 'Pintou a base com outra cor.', custo: { madeira: 1, pedra: 0 },
    modulo: { camada: 'base', parte: { peca: 'laje', cor: 'terracota' } } }
  assert.ok(built.previewRenovation(id, visual), 'Reforma só do desenho continua valendo')
  const functional = { ideia: 'Queria guardar chuva neste banco.', custo: { madeira: 1, pedra: 0 }, regras: rainRules }
  assert.equal(built.previewRenovation(id, functional), null, 'Regras não entram por reforma')
  assert.equal(hasWaterSupply(built.builds[0].plan.regras), false)
})

test('save antigo recebe HP e sede sem repor a bolsa ou fabricar comida/água', () => {
  const save = toSave(drought(World.create()))
  delete save.state.vitals.hp
  delete save.state.vitals.sede
  delete save.state.nextWaterIdea
  const world = fromSave(save)
  assert.equal(world.vitals.hp, 100)
  assert.equal(world.vitals.sede, 18)
  assert.deepEqual(world.inventory, save.state.inventory)
  assert.equal(world.lakeReserve, 0)
  assert.match(world.recipeIssue({ name: 'Água fácil', process: 'montar', inputs: [stack('pedra')], fuel: null,
    output: stack('agua'), newItem: null }), /não na bancada/)
})

test('projeto pendente guarda o turno e é arquivado se continuar impossível', () => {
  const initial = World.create()
  const start = World.fromState(initial.map, { ...initial.toState(), turn: 40 })
  assert.ok(start)
  const atTable = start.complete({ kind: 'visit_research', id: 'ir_pesquisar', at: start.researchTable,
    topic: { kind: 'blueprint' } })
  const plan = { ...supply, custo: { madeira: 1, pedra: 0 } }
  const recorded = atTable.complete({ kind: 'record_project', id: 'anotar', at: atTable.researchTable,
    project: { kind: 'blueprint', plan, plot: atTable.constructionTiles()[0] } })
  assert.equal(recorded.researchProject.kind, 'blueprint')
  assert.equal(recorded.toState().projectSince, recorded.turn)
  assert.ok(recorded.actions().some(action => action.kind === 'assemble'))
  const poor = World.fromState(recorded.map, { ...recorded.toState(),
    inventory: recorded.inventory.map(slot => slot?.item === 'madeira' || slot?.item === 'pedra' ? null : slot) })
  assert.ok(!poor.actions().some(action => action.kind === 'assemble'))
  assert.ok(!poor.actions().some(action => action.kind === 'archive_project'), 'Ainda pode juntar madeira')
  const stale = World.fromState(recorded.map, { ...poor.toState(), projectSince: recorded.turn - 31 })
  assert.ok(!stale.actions().some(action => action.kind === 'assemble'))
  assert.ok(stale.actions().some(action => action.kind === 'archive_project'))
  const archived = fromSave(toSave(apply(stale, 'archive_project')))
  assert.equal(archived.researchProject, undefined)
  assert.equal(archived.toState().projectSince, undefined)
  assert.ok(archived.actions().some(action => action.kind === 'invent'), 'A mesa volta a aceitar pesquisas')
})
