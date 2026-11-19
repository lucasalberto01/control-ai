import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import test from 'node:test'
import { readBlueprint, readRenovation } from '../src/blueprint.ts'
import { contourPath } from '../src/svg-path.ts'
import { appearanceFor, models, readAppearance } from '../src/appearance.ts'
import { attachmentHeights, compatibleEditParts, editComposition, readComposition, slots } from '../src/modules.ts'
import { installedAppearance } from '../src/appearance.ts'
import { appearanceKey } from '../src/appearance-registry.ts'
import { World } from '../src/world.ts'
import { same, WorldMap } from '../src/world-map.ts'
import { TurnPlanner } from '../src/turn-planner.ts'
import { fromSave, toSave } from '../src/world-save.ts'

const invention = {
  nome: 'Concha do Orvalho', tipo: 'objeto', ideia: 'Guarda a chuva e permite usar a água para umedecer a horta.',
  custo: { madeira: 1, pedra: 1 },
  pecas: [
    { forma: 'bloco', cor: 'marrom', x: 0, y: 0, largura: 10, altura: 16 },
    { forma: 'oval', cor: 'azul', x: 0, y: 16, largura: 24, altura: 8 },
  ],
  regras: [
    { gatilho: 'chuva', verbo: 'gerar', alvo: 'agua', quantidade: 2, insumo: 'nenhum' },
    { gatilho: 'uso', verbo: 'efeito', alvo: 'umidade', quantidade: 10, insumo: 'agua' },
  ],
}

const build = at => ({ id: 'construir', label: 'Instalar', at, kind: 'build', score: 0 })
const assemble = (world, plan, at) => world.complete({
  id: 'montar_kit', label: 'Montar kit', at: world.workbench, kind: 'assemble', score: 0, plan, plot: at,
})
const pickupKit = world => world.complete(world.actions().find(a => a.kind === 'pickup_kit'))
const place = (world, plan, at) => pickupKit(assemble(world, plan, at)).complete(build(at))
const curvedRoof = {
  forma: 'contorno', cor: 'azul', x: 0, y: 12, largura: 20, altura: 10,
  tracado: [{ op: 'M', x: 0, y: 100 }, { op: 'Q', cx: 50, cy: 0, x: 100, y: 100 }, { op: 'Z' }],
}
const upgrade = {
  ideia: 'Pintou a base com uma cor nova e uma placa.',
  custo: { madeira: 1, pedra: 0 },
  modulo: { camada: 'base', parte: { peca: 'laje', cor: 'terracota' } },
}

function useTwice(world, id) {
  while ((world.builds.find(b => b.id === id)?.uses ?? 0) < 2) {
    const use = world.actions().find(action => action.kind === 'use' && action.objectId === id)
    world = world.complete(use ?? world.actions().find(action => action.kind === 'walk'))
  }
  while (world.turn < id + 3) world = world.complete(world.actions().find(action => action.kind === 'walk'))
  return world
}

function readyForRenovation() {
  const initial = World.create()
  const built = place(initial, invention, initial.constructionTiles()[0])
  return useTwice(built, built.builds[0].id)
}

test('aceita protótipo válido e recusa peças, efeitos e duplicatas fora dos limites', () => {
  assert.deepEqual(readBlueprint(invention), invention)
  assert.equal(readBlueprint({ ...invention, pecas: [{ ...invention.pecas[0], forma: 'script' }, invention.pecas[1]] }), null)
  assert.equal(readBlueprint({ ...invention, regras: [{ ...invention.regras[1], insumo: 'nenhum' }] }), null)
  assert.equal(readBlueprint({ ...invention, regras: [invention.regras[1], invention.regras[1]] }), null)
  assert.equal(readBlueprint({ ...invention, custo: { pedra: 0, madeira: 0 } }), null)
})

test('gera d de SVG só a partir de linhas, curvas e coordenadas limitadas', () => {
  const record = { ...invention, pecas: [...invention.pecas, curvedRoof] }
  const validated = readBlueprint(record)
  assert.ok(validated)
  assert.equal(contourPath(validated.pecas[2]), 'M-10 -12 Q0 -22 10 -12 Z')
  const cubic = { ...curvedRoof, tracado: [
    { op: 'M', x: 0, y: 100 }, { op: 'C', cx: 25, cy: 0, dx: 75, dy: 0, x: 100, y: 100 },
    { op: 'L', x: 50, y: 75 }, { op: 'Z' },
  ] }
  assert.equal(contourPath(readBlueprint({ ...record, pecas: [record.pecas[0], cubic] }).pecas[1]),
    'M-10 -12 C-5 -22 5 -22 10 -12 L0 -14.5 Z')
  for (const bad of [
    'M0 100 Q50 0 100 100 Z',
    [{ op: 'M', x: 0, y: 100 }, { op: 'Q', x: 100, y: 100, cx: 500, cy: 0 }, { op: 'Z' }],
    [{ op: 'M', x: 0, y: 100 }, { op: 'Q', x: '100', y: 100, cx: 50, cy: 0 }, { op: 'Z' }],
    [{ op: 'M', x: 0, y: 100 }, { op: 'M', x: 100, y: 100 }, { op: 'Z' }],
    [{ op: 'L', x: 0, y: 100 }, { op: 'Q', x: 100, y: 100, cx: 50, cy: 0 }, { op: 'Z' }],
  ]) {
    assert.equal(readBlueprint({ ...record, pecas: [record.pecas[0], { ...curvedRoof, tracado: bad }] }), null)
  }
})

test('usa uma aparência pronta sem coordenadas e mantém a geometria dos saves antigos', () => {
  const look = { modelo: 'coletor', acabamento: 'lagoa', detalhe: 'placa' }
  assert.equal(models.length, 10)
  const { pecas, ...fields } = invention
  const modern = readBlueprint({ ...fields, aparencia: look })
  assert.deepEqual(modern.pecas, [])
  assert.equal(appearanceFor(modern).corpo.peca, 'barril')
  assert.deepEqual(appearanceFor(modern).topo, { peca: 'funil', cor: 'lagoa' })
  assert.equal(readAppearance({ ...look, modelo: '<svg>' }), null)
  assert.equal(readBlueprint({ ...fields, aparencia: { ...look, acabamento: 'azul-livre' } }), null)
  const saved = readBlueprint({ ...fields, pecas })
  assert.deepEqual(saved.pecas, pecas)
  assert.equal(appearanceFor(saved).corpo.peca, 'barril')
  assert.equal(appearanceFor({ ...saved, nome: 'Banco do Pomar', ideia: 'Um assento de madeira para descansar.' }).corpo.peca, 'assento')
})

test('rotas não atravessam o lago, mas chegam a todos os outros terrenos', () => {
  const { position, map } = World.create()
  for (const to of map.tiles) {
    const route = map.pathTo(position, to)
    if (map.isWater(to)) assert.equal(route, null)
    else {
      assert.ok(route)
      assert.ok(same(route.at(-1) ?? position, to))
      let last = position
      for (const point of route) {
        assert.equal(Math.abs(last.x - point.x) + Math.abs(last.y - point.y), 1)
        assert.ok(!map.isWater(point))
        last = point
      }
    }
  }
})

test('construção persiste no mapa, consome materiais e pode ser usada de verdade', () => {
  const initial = World.create()
  const at = initial.constructionTiles()[0]
  assert.ok(initial.canBuild(invention, at))
  const lake = initial.map.sites.find(site => site.kind === 'lago').area[0]
  assert.equal(initial.canBuild(invention, lake), false)
  assert.throws(() => initial.complete(build(lake)), /não é acessível/)
  assert.throws(() => initial.complete(build(at)), /construção não é válida/)
  const poor = World.fromState(initial.map, { ...initial.toState(), inventory: initial.inventory.map(s => s?.item === 'pedra' ? null : s) })
  assert.equal(poor.canBuild(invention, at), false)
  const staged = assemble(initial, invention, at)
  assert.deepEqual(staged.position, initial.workbench)
  assert.equal(staged.builds.length, 0)
  assert.equal(staged.benchKit, invention.nome)
  assert.ok(!staged.inventory.some(slot => slot?.item === '@kit'))
  assert.equal(staged.bag.pedra, initial.bag.pedra - 1)
  assert.equal(staged.bag.madeira, initial.bag.madeira - 1)
  assert.throws(() => staged.complete(build(at)), /construção não é válida/)
  const reloaded = fromSave(toSave(staged))
  assert.deepEqual(reloaded.toState(), staged.toState())
  const packed = pickupKit(reloaded)
  assert.ok(packed.inventory.some(slot => slot?.item === '@kit'))
  const reloadedPacked = fromSave(toSave(packed))
  assert.equal(reloadedPacked.benchKit, undefined)
  const built = reloadedPacked.complete(build(at))
  assert.ok(!built.inventory.some(slot => slot?.item === '@kit'))
  assert.equal(initial.builds.length, 0)
  assert.equal(built.bag.pedra, initial.bag.pedra - 1)
  assert.equal(built.bag.madeira, initial.bag.madeira - 1)
  assert.equal(built.builds[0].plan.nome, invention.nome)
  assert.ok(!built.constructionTiles().some(p => same(at, p)))
  assert.equal(built.canBuild({ ...invention, nome: 'Concha do Orválho' }, built.constructionTiles()[0]), false)
  const use = built.actions().find(action => action.kind === 'use')
  assert.ok(use)
  const used = built.complete(use)
  assert.equal(used.bag.agua, built.bag.agua - 1)
  assert.equal(used.vitals.umidade, built.vitals.umidade - 4 + 10)
  assert.equal(used.builds[0].uses, 1)
  assert.match(used.log[0].text, /Laya usou Concha/)
  assert.ok(!used.actions().some(action => action.kind === 'use'))
})

test('chuva abastece estoque próprio e composições podem transferir recursos', () => {
  const plan = { ...invention, regras: [invention.regras[0], { gatilho: 'uso', verbo: 'transferir', alvo: 'agua', quantidade: 2, insumo: 'nenhum' }] }
  assert.ok(readBlueprint(plan))
  const initial = World.create()
  const built = place(initial, plan, initial.constructionTiles()[0])
  assert.ok(!built.actions().some(action => action.kind === 'use'))
  const raining = World.fromState(built.map, { ...built.toState(), minute: 760 })
  const walked = raining.complete(raining.actions().find(action => action.kind === 'walk'))
  assert.equal(walked.builds[0].stock.agua, 2)
  assert.equal(raining.builds[0].stock.agua, 0)
  const used = walked.complete(walked.actions().find(action => action.kind === 'pickup' && action.item === 'agua'))
  assert.equal(used.bag.agua, built.bag.agua + 2)
  assert.equal(used.builds[0].stock.agua, 2)
})

test('aparelho inventado converte para estoque local antes de permitir retirada', () => {
  const initial = World.create()
  const plan = { ...invention, regras: [{ gatilho: 'uso', verbo: 'converter', alvo: 'pedra', quantidade: 1, insumo: 'madeira' }] }
  const built = place(initial, plan, initial.constructionTiles()[0])
  const used = built.complete(built.actions().find(a => a.kind === 'use'))
  assert.equal(used.bag.madeira, built.bag.madeira - 1)
  assert.equal(used.bag.pedra, built.bag.pedra)
  assert.equal(used.builds[0].stock.pedra, 1)
  const pickup = used.actions().find(a => a.kind === 'pickup' && a.item === 'pedra')
  assert.deepEqual(pickup.at, used.position)
  const collected = used.complete(pickup)
  assert.equal(collected.bag.pedra, built.bag.pedra + 1)
  assert.equal(collected.builds[0].stock.pedra, 0)
})

test('lugares e limites do mapa vêm dos dados, inclusive na descrição para a IA', () => {
  const initial = World.create()
  const target = { x: 3, y: 2 }
  assert.equal(initial.describePlot(target), 'perto de Horta')
  const plan = { ...invention, nome: 'Mirante do Orvalho', tipo: 'lugar' }
  const expanded = place(initial, plan, { x: 3, y: 2 })
  assert.equal(expanded.describePlot(target), 'perto de Mirante do Orvalho')

  const data = initial.map.toData()
  const home = data.sites.find(site => site.kind === 'casa')
  home.area = [{ x: 6, y: 0 }]
  home.name = 'Casa da Colina'
  data.width = 8
  const map = WorldMap.fromData(data)
  assert.ok(map)
  const altered = World.fromState(map, initial.toState()).actions().find(action => action.id === 'descansar')
  assert.deepEqual(altered.at, home.area[0])
  assert.match(altered.label, /Casa da Colina/)
  assert.equal(map.tiles.length, 56)
  assert.equal(WorldMap.fromData({ ...data, sites: [...data.sites, { ...home, id: 'sobreposto', kind: 'marco' }] }), null)
})

test('os snapshots não expõem o estado interno e o JSON restaura as classes', () => {
  const initial = World.create()
  const world = place(initial, invention, initial.constructionTiles()[0])
  const exported = world.toState()
  exported.inventory.find(s => s?.item === 'madeira').quantity = 0
  exported.builds[0].plan.nome = 'Mudança externa'
  exported.log[0].text = 'Mudança externa'
  assert.equal(world.bag.madeira, 3)
  assert.equal(world.builds[0].plan.nome, invention.nome)
  assert.match(world.log[0].text, /Laya instalou/)
  const restored = fromSave(JSON.parse(JSON.stringify(toSave(world))))
  assert.ok(restored instanceof World)
  assert.ok(restored.map instanceof WorldMap)
  assert.deepEqual(restored.toState(), world.toState())
  assert.ok(restored.actions().some(action => action.kind === 'use'))
})

test('o planejador aceita IA injetada e mantém a prioridade do primeiro uso', async () => {
  const initial = World.create()
  const world = initial.complete(initial.actions().find(a => a.kind === 'gather' && a.resource === 'fruta'))
  const observer = { model() {}, activity() {} }
  let queries = 0
  const planner = new TurnPlanner({
    async decide() { return { ok: true, value: 'inventar' } },
    async invent() { queries++; return { ok: true, value: { plan: invention, plot: 0 } } },
    async renovate() { return { ok: true, value: upgrade } },
  })
  const visit = (await planner.plan(world, observer)).action
  assert.equal(visit.kind, 'visit_research')
  assert.equal(queries, 0)
  assert.deepEqual(visit.at, world.researchTable)
  assert.notDeepEqual(world.researchTable, world.workbench)
  assert.throws(() => world.complete({ ...visit, at: world.workbench }), /ação de produção/)
  const atTable = fromSave(toSave(world.complete(visit)))
  assert.deepEqual(atTable.position, world.researchTable)
  const outcome = (await planner.plan(atTable, observer)).action
  assert.equal(outcome.kind, 'record_project')
  assert.equal(queries, 1)
  const recorded = fromSave(toSave(atTable.complete(outcome)))
  assert.equal(recorded.researchProject.kind, 'blueprint')
  assert.deepEqual(recorded.bag, atTable.bag)
  const action = (await planner.plan(recorded, observer)).action
  assert.equal(action.kind, 'assemble')
  assert.deepEqual(action.at, world.workbench)
  assert.throws(() => recorded.complete({ ...action, at: world.researchTable }), /bancada/)
  const staged = recorded.complete(action)
  const retrieval = (await planner.plan(staged, observer)).action
  assert.equal(retrieval.kind, 'pickup_kit')
  const packed = staged.complete(retrieval)
  const installation = (await planner.plan(packed, observer)).action
  assert.equal(installation.kind, 'build')
  let built = packed.complete(installation)
  let next = (await planner.plan(built, observer)).action
  for (let step = 0; step < 6 && next.kind !== 'use'; step++) {
    built = built.complete(next)
    next = (await planner.plan(built, observer)).action
  }
  assert.equal(next.kind, 'use')
  assert.notEqual((await new TurnPlanner().plan(world, observer)).action.kind, 'invent')
})

test('a Laya pode reformar no mesmo terreno pagando o custo, sem perder identidade, uso ou estoque', async () => {
  const ready = readyForRenovation()
  const world = World.fromState(ready.map, { ...ready.toState(), vitals: { ...ready.vitals, energia: 65, fome: 35, sede: 20 },
    inventory: ready.inventory.map((slot, index) => index === 10 ? { item: 'fruta', quantity: 2 } : slot) })
  const before = world.builds[0]
  const option = world.actions().find(a => a.kind === 'renovate')
  assert.equal(option.objectId, before.id)
  assert.notEqual((await new TurnPlanner().plan(world, { model() {}, activity() {} })).action.kind, 'renovate')
  const planner = new TurnPlanner({
    async decide() { return { ok: true, value: option.id } },
    async invent() { throw new Error('Não é uma construção nova.') },
    async renovate(prompt) {
      assert.ok(prompt.includes(before.plan.nome))
      return { ok: true, value: upgrade }
    },
  })
  const observer = { model() {}, activity() {} }
  const visit = (await planner.plan(world, observer)).action
  assert.equal(visit.kind, 'visit_research')
  const atTable = world.complete(visit)
  const result = (await planner.plan(atTable, observer)).action
  assert.equal(result.kind, 'record_project')
  const recorded = atTable.complete(result)
  assert.equal(recorded.builds[0].renovations, undefined)
  const { action } = await planner.plan(recorded, observer)
  assert.equal(action.kind, 'renovation')
  assert.deepEqual(action.at, before.at)
  const after = recorded.complete(action)
  assert.equal(after.builds.length, 1)
  assert.equal(after.bag.madeira, world.bag.madeira - upgrade.custo.madeira)
  assert.equal(after.toState().nextIdea, recorded.toState().nextIdea, 'Reformar não atrasa a próxima invenção')
  assert.ok(after.log.some(entry => /Laya reformou/.test(entry.text)))
  const changed = after.builds[0]
  assert.equal(changed.id, before.id)
  assert.equal(changed.plan.nome, before.plan.nome)
  assert.deepEqual(changed.at, before.at)
  assert.equal(changed.uses, before.uses)
  assert.equal(changed.lastUse, before.lastUse)
  const sameTripWithoutRenovation = recorded.complete({ ...action, kind: 'walk', id: 'passear' })
  assert.deepEqual(changed.stock, sameTripWithoutRenovation.builds[0].stock)
  assert.deepEqual(changed.plan.pecas, before.plan.pecas)
  assert.deepEqual(changed.plan.regras, before.plan.regras)
  assert.equal(changed.plan.ideia, before.plan.ideia)
  assert.deepEqual(changed.renovations, [{ turn: after.turn, text: upgrade.ideia }])
  assert.equal(world.builds[0].renovations, undefined)
  const restored = fromSave(JSON.parse(JSON.stringify(toSave(after))))
  assert.deepEqual(restored.builds[0], changed)
})

test('reprova reforma sem mudança visual, sem material, fora do lugar ou com função nova', () => {
  const world = readyForRenovation()
  const { id, plan } = world.builds[0]
  const look = appearanceFor(plan)
  assert.equal(world.previewRenovation(id, { ...upgrade, modulo: { camada: 'base', parte: look.base } }), null)
  assert.ok(world.previewRenovation(id, upgrade))
  assert.equal(world.previewRenovation(id, {
    ...upgrade, regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 7, insumo: 'nenhum' }],
  }), null)
  const poor = World.fromState(world.map, { ...world.toState(), inventory: world.inventory.map(s => s?.item === 'madeira' ? null : s) })
  assert.equal(poor.previewRenovation(id, upgrade), null)
  assert.throws(() => world.complete({
    ...world.actions().find(a => a.kind === 'renovate'), kind: 'renovation', upgrade, at: { x: 0, y: 0 },
  }), /reforma não é válida/)
})

test('reforma modular repinta só uma peça sem modificar regras ou apagar as peças antigas', () => {
  const world = readyForRenovation()
  const build = world.builds[0]
  const option = world.actions().find(a => a.kind === 'renovate')
  const original = appearanceFor(build.plan)
  const upgrade = {
    custo: { madeira: 1, pedra: 0 }, ideia: 'Ganhou um acabamento de terracota e uma nova placa.', regras: [],
    modulo: { camada: 'base', parte: { ...original.base, cor: 'terracota' } },
  }
  assert.equal(world.previewRenovation(build.id, { ...upgrade, modulo: { camada: 'base', parte: original.base } }), null)
  const action = { ...option, kind: 'renovation', upgrade }
  const next = fromSave(toSave(world.complete(action)))
  assert.deepEqual(next.builds[0].plan.aparencia.base, upgrade.modulo.parte)
  for (const slot of slots.filter(slot => slot !== 'base')) assert.deepEqual(next.builds[0].plan.aparencia[slot], original[slot])
  assert.deepEqual(next.builds[0].plan.pecas, build.plan.pecas)
  assert.deepEqual(next.builds[0].plan.regras, build.plan.regras)
})

test('reusa o mesmo pedestal em fonte, cristal e luminária; valida encaixes e recalcula alturas', () => {
  const common = { base: { peca: 'octogono', cor: 'arenito' }, suporte: { peca: 'pedestal', cor: 'cobre' }, adorno: null }
  const fountain = readComposition({ ...common, corpo: { peca: 'bacia', cor: 'lagoa' }, topo: { peca: 'bica', cor: 'carvao' } })
  const gem = readComposition({ ...common, corpo: null, topo: { peca: 'gema', cor: 'lavanda' } })
  const lamp = readComposition({ ...common, corpo: null, topo: { peca: 'cupula', cor: 'cedro' } })
  for (const composed of [fountain, gem, lamp]) assert.deepEqual(composed.suporte, common.suporte)
  assert.ok(attachmentHeights(fountain).topo > attachmentHeights(gem).topo)
  const amended = editComposition(fountain, { camada: 'corpo', parte: { peca: 'cascata', cor: 'lagoa' } })
  assert.ok(attachmentHeights(amended).topo > attachmentHeights(fountain).topo)
  assert.deepEqual(amended.topo, fountain.topo)
  assert.equal(editComposition(fountain, { camada: 'topo', parte: { peca: 'funil', cor: 'cedro' } }), null)
  assert.equal(editComposition(gem, { camada: 'topo', parte: null }), null)
  assert.equal(editComposition(lamp, { camada: 'base', parte: null }), null)
  assert.ok(!compatibleEditParts(fountain, 'topo').includes('telhado_reto'))
  assert.equal(readComposition({ ...fountain, suporte: { peca: 'poste', cor: 'cedro' } }), null)
  assert.equal(readComposition({ ...fountain, base: { ...fountain.base, cor: '#fff' } }), null)
})

const calm = { ...invention, nome: 'Sede da Calma',
  aparencia: { base: { peca: 'laje', cor: 'arenito' }, suporte: null, corpo: { peca: 'assento', cor: 'cedro' }, topo: null, adorno: null } }
const oasis = { ...calm, nome: 'Oásis Refletivo' }
const sameSilhouette = (a, b) => slots.every(slot => a[slot]?.peca === b[slot]?.peca)

test('uma construção com nome diferente não repete o visual; a prévia é a mesma arte gravada', () => {
  const initial = World.create()
  const first = place(initial, calm, initial.constructionTiles()[0])
  const plot = first.constructionTiles()[0]
  const reordered = Object.fromEntries(Object.entries(oasis.aparencia).reverse())
  const proposal = { ...oasis, aparencia: reordered }
  const packed = pickupKit(assemble(first, proposal, plot))
  const preview = packed.previewBuild(plot)
  const next = packed.complete(build(plot))
  assert.equal(appearanceKey(calm.aparencia), appearanceKey(reordered))
  assert.equal(next.builds[0].plan.nome, calm.nome)
  assert.equal(next.builds[1].plan.nome, oasis.nome)
  assert.deepEqual(next.builds[1].plan, preview)
  assert.notEqual(appearanceKey(preview.aparencia), appearanceKey(calm.aparencia))
  assert.ok(sameSilhouette(preview.aparencia, calm.aparencia))
  assert.deepEqual(next.builds[1].plan.regras, [invention.regras[1]])
  assert.deepEqual(fromSave(toSave(next)).builds, next.builds)
})

test('uma reforma não copia outra invenção nem modifica uma camada além da solicitada', () => {
  const initial = World.create()
  const first = place(initial, calm, initial.constructionTiles()[0])
  const target = {
    ...oasis, aparencia: { ...oasis.aparencia, corpo: { peca: 'assento', cor: 'lavanda' } },
  }
  let world = place(first, target, first.constructionTiles()[0])
  world = useTwice(world, world.builds[1].id)
  const current = world.builds[1]
  const option = world.actions().find(a => a.kind === 'renovate' && a.objectId === current.id)
  assert.ok(option)
  const upgrade = { ideia: 'Pintou o assento com uma nova cor.', custo: { madeira: 1, pedra: 0 },
    modulo: { camada: 'corpo', parte: calm.aparencia.corpo } }
  const preview = world.previewRenovation(current.id, upgrade)
  assert.ok(preview)
  const next = world.complete({ ...option, kind: 'renovation', upgrade })
  const revised = next.builds[1]
  assert.deepEqual(revised.plan, preview)
  assert.notEqual(appearanceKey(revised.plan.aparencia), appearanceKey(calm.aparencia))
  assert.notEqual(appearanceKey(revised.plan.aparencia), appearanceKey(current.plan.aparencia))
  assert.deepEqual(slots.filter(slot => JSON.stringify(revised.plan.aparencia[slot]) !== JSON.stringify(current.plan.aparencia[slot])), ['corpo'])
  assert.deepEqual(revised.plan.regras, current.plan.regras)
  assert.equal(revised.uses, current.uses)
})

test('uma função por objeto: a criação nova é podada e o save antigo perde as funções extras', () => {
  const energy = { gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 5, insumo: 'nenhum' }
  const mixedRules = [energy,
    { gatilho: 'chuva', verbo: 'gerar', alvo: 'agua', quantidade: 2, insumo: 'nenhum' },
    { gatilho: 'uso', verbo: 'transferir', alvo: 'agua', quantidade: 2, insumo: 'nenhum' }]
  const bench = { ...calm, nome: 'Banco do Pomar', regras: mixedRules }
  const initial = World.create()
  const packed = assemble(initial, bench, initial.constructionTiles()[0])
  assert.deepEqual(packed.toState().kit.plan.regras, [energy], 'O kit nasce com uma família só')
  const built = pickupKit(packed).complete(build(initial.constructionTiles()[0]))
  assert.deepEqual(built.builds[0].plan.regras, [energy])

  // Simula um save antigo que acumulou água num banco por reformas.
  const legacy = toSave(built)
  legacy.state.builds[0].plan.regras = structuredClone(mixedRules)
  const loaded = fromSave(legacy)
  assert.deepEqual(loaded.builds[0].plan.regras, [energy])
  assert.deepEqual(toSave(fromSave(toSave(loaded))), toSave(loaded), 'A poda é estável')

  const fountain = { ...calm, nome: 'Fonte da Lua', regras: mixedRules.slice(1) }
  const fountainBuilt = place(initial, fountain, initial.constructionTiles()[1])
  assert.deepEqual(fountainBuilt.builds[0].plan.regras, mixedRules.slice(1), 'Uma fonte mantém o par de água')
})

test('ao abrir saves antigos, resolve duplicatas de forma estável sem mudar quem já era único', () => {  const initial = World.create()
  const first = place(initial, calm, initial.constructionTiles()[0])
  const second = place(first, oasis, first.constructionTiles()[0])
  const third = place(second, { ...oasis, nome: 'Banco do Bosque' }, second.constructionTiles()[0])
  const save = toSave(third)
  // Simula a duplicata de uma versão que ainda não conferia a aparência.
  save.state.builds[1].plan.aparencia = calm.aparencia
  const fixed = fromSave(save)
  const keys = fixed.builds.map(b => appearanceKey(appearanceFor(b.plan)))
  assert.equal(new Set(keys).size, 3)
  assert.equal(keys[0], appearanceKey(calm.aparencia))
  assert.equal(keys[2], appearanceKey(third.builds[2].plan.aparencia))
  assert.deepEqual(fixed.builds[1].plan.regras, save.state.builds[1].plan.regras)
  assert.deepEqual(toSave(fromSave(toSave(fixed))), toSave(fixed))
})

test('uma estação instalada também evita o visual ocupado por uma invenção', () => {
  const initial = World.create()
  const furnace = installedAppearance(initial.item('forno'))
  const first = place(initial, { ...invention, nome: 'Fogareiro do Bosque', aparencia: furnace }, initial.constructionTiles()[0])
  const inventory = first.inventory
  inventory[inventory.indexOf(null)] = { item: 'forno', quantity: 1 }
  const prepared = World.fromState(first.map, { ...first.toState(), inventory })
  const install = prepared.actions().find(action => action.kind === 'install')
  const next = prepared.complete(install)
  const installed = next.installed[0]
  assert.notEqual(appearanceKey(installed.aparencia), appearanceKey(furnace))
  assert.ok(sameSilhouette(installed.aparencia, furnace))
  assert.deepEqual(fromSave(toSave(next)).installed, next.installed)
})
