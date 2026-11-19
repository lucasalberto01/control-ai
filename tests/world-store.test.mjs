import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorldStore } from '../electron/world-store.ts'
import { World } from '../src/world.ts'
import { fromSave } from '../src/world-save.ts'

function profile(t) {
  const preferred = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
  const root = preferred && existsSync(preferred) ? preferred : tmpdir()
  const dir = mkdtempSync(path.join(root, 'vale-store-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, file: path.join(dir, 'world.save.json') }
}

const walk = w => w.complete(w.actions().find(a => a.kind === 'walk'))

test('cria um save versionado, grava turnos e abre o mesmo mapa de novo', t => {
  const { dir, file } = profile(t)
  const store = new WorldStore(dir)
  const { state, map, version } = store.open(null)
  assert.equal(version, 2)
  assert.equal(state.turn, 0)
  const localMap = { ...map, name: 'Vale de Teste', width: 8 }
  writeFileSync(file, JSON.stringify({ version, map: localMap, state }))
  const restored = store.open(null)
  assert.equal(restored.map.width, 8)
  const next = walk(fromSave(restored))
  store.commit(next.toState())
  assert.deepEqual(new WorldStore(dir).open(null), { version, map: localMap, state: next.toState() })
  assert.deepEqual(readdirSync(dir), ['world.save.json'])
  assert.throws(() => store.commit(state), /turno/)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).state, next.toState())
})

test('importa do localStorage as invenções, seus efeitos e o histórico na primeira abertura', t => {
  const { dir, file } = profile(t)
  const initial = World.create()
  const plan = {
    nome: 'Mirante Azul', tipo: 'lugar', ideia: 'Aumenta a alegria quando é visitado.',
    custo: { madeira: 1, pedra: 0 },
    pecas: [
      { forma: 'bloco', cor: 'azul', x: 0, y: 0, largura: 20, altura: 8 },
      { forma: 'triangulo', cor: 'creme', x: 0, y: 8, largura: 16, altura: 6 },
    ],
    regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'alegria', quantidade: 10, insumo: 'nenhum' }],
  }
  const staged = initial.complete({ id: 'montar_kit', kind: 'assemble', at: initial.workbench, plot: initial.constructionTiles()[0], plan })
  const packed = staged.complete(staged.actions().find(a => a.kind === 'pickup_kit'))
  const built = packed.complete(packed.actions().find(a => a.kind === 'build'))
  const used = built.complete(built.actions().find(a => a.kind === 'use'))
  const oldState = used.toState()
  delete oldState.inventory
  oldState.bag = used.bag
  // v1 used only four resource counters and had no workshop cooldown.
  const legacy = JSON.stringify(oldState)
  const disk = new WorldStore(dir).open(legacy)
  assert.deepEqual(disk.state.builds, used.toState().builds)
  assert.deepEqual(fromSave(disk).bag, used.bag)
  assert.equal(disk.state.inventory.length, 32)
  assert.equal(disk.state.builds[0].uses, 1)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), disk)
  assert.deepEqual(new WorldStore(dir).open(JSON.stringify(initial.toState())), disk)
})

test('abre world.save.json v1 e grava v2 ao avançar, conservando o turno e a bolsa', t => {
  const { dir, file } = profile(t)
  const initial = World.create()
  const state = initial.toState()
  delete state.inventory
  state.bag = initial.bag
  writeFileSync(file, JSON.stringify({ version: 1, map: initial.map.toData(), state }))
  const store = new WorldStore(dir)
  const migrated = fromSave(store.open(null))
  assert.equal(migrated.turn, initial.turn)
  assert.deepEqual(migrated.bag, initial.bag)
  store.commit(walk(migrated).toState())
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2)
})

test('não substitui arquivo corrompido, versão desconhecida nem progresso legado inválido', t => {
  const { dir, file } = profile(t)
  const store = new WorldStore(dir)
  assert.throws(() => store.open('legado quebrado'), /importar/)
  assert.deepEqual(readdirSync(dir), [])
  for (const content of ['JSON quebrado', '{"version":900}', '{"version":1,"map":{},"state":{}}']) {
    writeFileSync(file, content)
    assert.throws(() => store.open(null), /JSON|versão|validação/)
    assert.equal(readFileSync(file, 'utf8'), content)
  }
})

test('notificação só é liberada ao gravar uma pesquisa válida, sem repetir ao reabrir', t => {
  const { dir } = profile(t)
  const store = new WorldStore(dir)
  const fresh = fromSave(store.open(null))
  const ready = walk(walk(fresh))
  assert.equal(store.commit(ready.toState()), undefined)
  assert.equal(store.researchKind, undefined)
  const recipe = { name: 'Forno de pedra', process: 'montar', inputs: [{ item: 'pedra', quantity: 4 }],
    fuel: null, output: { item: 'forno', quantity: 1 }, newItem: null }
  const learning = { kind: 'learn', id: 'aprender', at: ready.researchTable, recipe }
  assert.throws(() => ready.complete(learning), /ação de produção/)
  const visit = world => world.complete({ kind: 'visit_research', id: 'ir_pesquisar', at: world.researchTable, topic: { kind: 'recipe' } })
  const first = visit(ready)
  assert.equal(store.commit(first.toState()), undefined)
  assert.equal(store.researchKind, 'recipe')
  const failed = first.complete({ kind: 'finish_research', id: 'encerrar_pesquisa', at: first.researchTable })
  assert.equal(store.commit(failed.toState()), undefined)
  const second = visit(failed)
  assert.equal(store.commit(second.toState()), undefined)
  const accepted = second.complete(learning)
  assert.deepEqual(store.commit(accepted.toState()), { title: 'Nova receita de Laya', body: 'Forno de pedra' })
  assert.throws(() => store.commit(accepted.toState()), /turno/)
  const reopened = new WorldStore(dir)
  assert.equal(fromSave(reopened.open(null)).recipes[0].name, recipe.name)
  assert.equal(reopened.researchKind, undefined)
  assert.equal(reopened.commit(walk(accepted).toState()), undefined)
})

test('planta aceita notifica; projeto forjado sem condições não notifica e pode ser arquivado', t => {
  const plan = { nome: 'Marco do Estudo', tipo: 'objeto', ideia: 'Recupera a alegria de quem visita o marco.',
    custo: { madeira: 1, pedra: 1 }, aparencia: { modelo: 'monumento', acabamento: 'arenito', detalhe: 'flores' }, pecas: [],
    regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'alegria', quantidade: 6, insumo: 'nenhum' }] }
  const visit = (world, topic) => world.complete({ kind: 'visit_research', id: 'ir_pesquisar', at: world.researchTable, topic })
  const first = profile(t)
  const store = new WorldStore(first.dir)
  const fresh = fromSave(store.open(null))
  const blue = visit(fresh, { kind: 'blueprint' })
  assert.equal(store.commit(blue.toState()), undefined)
  assert.equal(store.researchKind, 'blueprint')
  const recorded = blue.complete({ kind: 'record_project', id: 'anotar_planta', at: blue.researchTable,
    project: { kind: 'blueprint', plan, plot: blue.constructionTiles()[0] } })
  assert.deepEqual(store.commit(recorded.toState()), { title: 'Nova planta de Laya', body: plan.nome })

  const second = profile(t)
  const other = new WorldStore(second.dir)
  const base = fromSave(other.open(null))
  assert.equal(other.commit(visit(base, { kind: 'blueprint' }).toState()), undefined)
  const current = fromSave(new WorldStore(second.dir).open(null))
  const forged = JSON.parse(JSON.stringify(current.toState()))
  forged.turn += 1
  delete forged.research
  forged.project = { kind: 'blueprint', plot: { x: 0, y: 0 }, plan }
  assert.equal(other.commit(forged), undefined)
  const reloaded = fromSave(other.open(null))
  assert.equal(reloaded.researchProject.kind, 'blueprint')
  const archive = reloaded.actions().find(action => action.kind === 'archive_project')
  assert.ok(archive)
  const repaired = reloaded.complete(archive)
  assert.equal(repaired.researchProject, undefined)
  const broken = JSON.parse(JSON.stringify(repaired.toState()))
  broken.project = { kind: 'blueprint', plot: { x: -5, y: 0 }, plan }
  assert.throws(() => other.commit(broken), /turno/)
})
