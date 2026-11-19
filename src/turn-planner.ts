import type { LocalAI } from './local-ai'
import type { Action, Postpone, World } from './world'
import { appearanceFor } from './appearance.ts'
import { hasWaterSupply } from './blueprint.ts'
import { fruitSeed } from './inventory.ts'
import { same } from './world-map.ts'
import type { ResearchTopic } from './research.ts'

export type Turn = { action: Action; postpone?: Postpone }
export type ModelState = { decision: string; generation: string }
type Observer = {
  model(part: keyof ModelState, state: string): void
  activity(text: string): void
}

export class TurnPlanner {
  readonly #ai: LocalAI | undefined

  constructor(ai?: LocalAI) {
    this.#ai = ai
  }

  async plan(world: World, observer: Observer, skipIds: ReadonlySet<string> = new Set()): Promise<Turn> {
    const all = world.actions()
    const available = skipIds.size && all.length > 1
      ? all.filter(action => !skipIds.has(action.id))
      : all
    const ordinary = available.filter(action => action.kind !== 'invent' && action.kind !== 'renovate' && action.kind !== 'research')
    const ai = this.#ai
    const topic = world.researchTopic
    if (topic && world.vitals.hp > 0 && same(world.position, world.researchTable)) {
      if (ai && topic.kind === 'blueprint') return this.#design(world, ai, observer, topic.water)
      if (ai && topic.kind === 'renovation') return this.#renovate(world, ai, topic, observer)
      if (ai?.recipe && topic.kind === 'recipe') return this.#research(world, ai, observer)
      return this.#noResult(world, topic.kind === 'recipe' ? 'workshop' : topic.kind === 'blueprint' && topic.water ? 'water' : 'idea')
    }
    if (!ai) {
      observer.model('decision', 'Modo sem IA — abra pelo Electron.')
      return { action: ordinary[0] }
    }

    let ranked = available.filter(action => action.kind !== 'research' || !!ai.recipe).slice(0, 5)
    // Sem nenhuma receita, a oficina continua na mesa de escolhas mesmo quando a Laya está ocupada.
    if (!world.recipes.length) {
      const research = available.find(action => action.kind === 'research')
      if (research && !ranked.some(action => action.id === research.id)) ranked = [...ranked.slice(0, 4), research]
    }
    // Equipar é uma escolha consciente: a IA pode preferir arma, armadura ou seguir sem nada.
    const equip = available.find(action => action.kind === 'equip')
    if (equip && !ranked.some(action => action.id === equip.id)) ranked = [...ranked, equip]
    // Itens no chão precisam chegar à mesa de escolhas, senão a mochila nunca é reposta.
    const loot = available.find(action => action.kind === 'take')
    if (loot && !ranked.some(action => action.id === loot.id)) ranked = [...ranked, loot]
    // Carne crua estraga: assar precisa ser uma opção visível antes do prazo.
    const cook = available.find(action => action.kind === 'cook')
    if (cook && !ranked.some(action => action.id === cook.id)) ranked = [...ranked, cook]
    // Expandir é sempre uma escolha consciente: a IA pode decidir crescer ou seguir a rotina.
    const expand = available.find(action => action.kind === 'expand')
    if (expand && !ranked.some(action => action.id === expand.id)) ranked = [...ranked, expand]
    const action = ranked.length > 1 ? await this.#choose(world, ai, ranked, observer) : ranked[0]
    const chosen: ResearchTopic | null = action.kind === 'invent' ? { kind: 'blueprint', water: action.water }
      : action.kind === 'renovate' ? { kind: 'renovation', objectId: action.objectId }
      : action.kind === 'research' ? { kind: 'recipe' } : null
    if (chosen) return { action: { kind: 'visit_research', id: 'ir_pesquisar', topic: chosen, at: world.researchTable,
      label: 'Ir à Mesa de Pesquisa', score: action.score } }
    return { action }
  }

  #noResult(world: World, postpone: Postpone): Turn {
    return { action: { kind: 'finish_research', id: 'encerrar_pesquisa', at: world.researchTable,
      label: 'Encerrar pesquisa sem resultado', score: 0 }, postpone }
  }

  async #choose(world: World, ai: LocalAI, ranked: Action[], observer: Observer): Promise<Action> {
    observer.activity('Escolhendo o que fazer…')
    const first = ranked[0]
    let goal = 'Alterne a rotina com passeios e use invenções úteis.'
    const threat = world.animals.some(animal => Math.abs(animal.at.x - world.position.x) + Math.abs(animal.at.y - world.position.y) <= 2)
    if (threat) goal = 'Um animal está perto; se precisar, defenda-se antes de cuidar da rotina.'
    else if (first.kind === 'attack' && first.target.kind === 'character') goal = 'Você pode atacar a outra personagem ou ignorá-la e seguir a sua vida.'
    else if (first.kind === 'equip') goal = 'Há um equipamento na mochila; ele pode aumentar o dano ou a proteção contra animais e golpes.'
    else if (first.kind === 'take') goal = 'Há itens no chão que podem repor água, comida, equipamento ou materiais.'
    else if (first.kind === 'cook') goal = 'Há carne crua para assar; cozinhar antes do prazo evita perder a comida.'
    else if (first.kind === 'expand') goal = 'A fronteira do vale pode crescer; desbravar abre mais terreno para novas criações.'
    else if (ranked.some(a => a.kind === 'expand') && world.builds.length >= world.map.buildLimit - 2) {
      goal = 'O vale está apertado para novas criações; desbravar a fronteira pode abrir espaço.'
    }
    else if (first.kind === 'invent' && first.water) goal = 'A reserva do lago está acabando; priorize uma fonte de água.'
    else if (first.kind === 'research') goal = 'Se for possível, descubra uma receita nova que o vale consiga fazer.'
    else if (first.kind === 'renovate') goal = 'Se não houver invenção nova para fazer, mudar o desenho de uma criação é uma boa pausa.'
    else if (ranked.some(a => a.kind === 'invent')) goal = 'Se as necessidades estiverem bem, inventar tem prioridade.'
    if (first.score >= 100) goal = 'A primeira opção é prioritária neste momento.'
    try {
      const reply = await ai.decide(`${this.#summary(world)} ${goal}`, Object.fromEntries(ranked.map(a => [a.id, a.label])))
      if (reply.ok) {
        observer.model('decision', 'Ativa')
        if (!world.mustPrioritize(first)) return ranked.find(a => a.id === reply.value) ?? first
      } else observer.model('decision', reply.error)
    } catch {
      observer.model('decision', 'Não foi possível consultar a Laya.')
    }
    return first
  }

  async #research(world: World, ai: LocalAI, observer: Observer): Promise<Turn> {
    const options = world.recipeOptions()
    const inputs = options.inputs.map(id => `${id}:${world.item(id)?.name ?? id}`)
    const inventory = world.itemCounts().map(s => `${s.item}=${s.quantity}`).join(', ') || 'vazia'
    const stations = world.installed.map(s => {
      const item = world.item(s.item)
      return `${item?.id} (${item?.capability})`
    }).join(', ') || 'nenhuma'
    const known = world.recipes.slice(-6).map(r => `${r.name}: ${r.inputs.map(i => `${i.item}×${i.quantity}`).join('+')}→${r.output.item}`).join('; ')
    observer.activity('Experimentando novas combinações…')
    observer.model('generation', 'Pesquisando receita…')
    try {
      const reply = await ai.recipe!([
        this.#summary(world),
        `Mochila: ${inventory}. Insumos disponíveis na mochila, no terreno ou via receitas: ${inputs.join(', ')}.`,
        `Processos disponíveis: ${options.processes.join(', ')}. Combustíveis disponíveis: ${options.fuels.join(', ') || 'nenhum'}.`,
        `Bancada inicial no mapa; demais estações: ${stations}. IDs que já existem: ${options.outputs.join(', ')}.`,
        `Receitas recentes: ${known || 'nenhuma'}.`,
        'Escolha livremente o que a Laya vai descobrir agora: uma receita, um material novo ou uma estação que abra um processo. Não existe alvo obrigatório.',
        `Se o vale estiver em perigo, uma arma (damage 4–12) ou uma armadura (protection 2–8) pode ser uma descoberta útil. Equipado: ${world.active.equipment ? world.item(world.active.equipment)?.name : 'nada'}.`,
        'Carne crua de javali pode ser assada para alimentar melhor; couro pode virar armadura, roupa ou outro item útil. Use esses materiais quando estiverem disponíveis.',
      ].join('\n'), options)
      const issue = reply.ok ? world.recipeIssue(reply.value) : reply.error
      if (!reply.ok || issue !== null) {
        observer.model('generation', issue || 'Não foi possível pesquisar uma receita.')
        return this.#noResult(world, 'workshop')
      }
      observer.model('generation', 'Ativo')
      return { action: { id: 'aprender', kind: 'learn', recipe: reply.value, at: world.position, score: 0, label: `Anotar ${reply.value.name}` } }
    } catch {
      observer.model('generation', 'Não foi possível pesquisar uma receita.')
      return this.#noResult(world, 'workshop')
    }
  }

  async #renovate(world: World, ai: LocalAI, topic: Extract<ResearchTopic, { kind: 'renovation' }>, observer: Observer): Promise<Turn> {
    const existing = world.builds.find(b => b.id === topic.objectId)
    const postpone = 'idea'
    if (!existing) return this.#noResult(world, postpone)
    observer.activity(`Planejando uma nova cara para ${existing.plan.nome}…`)
    observer.model('generation', 'Planejando reforma…')
    const appearance = appearanceFor(existing.plan)
    const prompt = [
      this.#summary(world),
      `Reforme somente ${existing.plan.nome}. Usos até aqui: ${existing.uses}.`,
      `Ideia atual: ${existing.plan.ideia}`,
      `Aparência atual: ${JSON.stringify(appearance)}. Não repita essa combinação.`,
      'A reforma é só do desenho: troque, repinte, acrescente ou remova uma única peça. Não mude nome, lugar nem funções.',
    ].join('\n')
    try {
      const reply = await ai.renovate(prompt, appearance)
      if (!reply.ok) {
        observer.model('generation', reply.error)
        return this.#noResult(world, postpone)
      }
      if (!world.previewRenovation(topic.objectId, reply.value)) {
        observer.model('generation', 'Reforma sem mudança de desenho válida ou sem materiais disponíveis.')
        return this.#noResult(world, postpone)
      }
      observer.model('generation', 'Ativo')
      return { action: { kind: 'record_project', id: 'anotar_reforma', at: world.researchTable,
        label: `Anotar projeto de reforma de ${existing.plan.nome}`, score: 0,
        project: { kind: 'renovation', objectId: topic.objectId, upgrade: reply.value } } }
    } catch {
      observer.model('generation', 'Não foi possível buscar uma proposta de reforma.')
      return this.#noResult(world, postpone)
    }
  }

  async #design(world: World, ai: LocalAI, observer: Observer, water = false): Promise<Turn> {
    const plots = world.constructionTiles()
    observer.activity(water ? 'Inventando uma fonte própria de água…' : 'Imaginando uma invenção…')
    observer.model('generation', 'Inventando…')
    const builds = world.builds
    const existing = builds.slice(-6).map(b => `${b.plan.nome}: ${b.plan.ideia}`).join(' | ') || 'nenhuma'
    const materials = world.itemCounts().filter(s => s.item !== fruitSeed && world.item(s.item)?.kind === 'material')
    const combine = materials.length > 1 && materials.some(s => !['madeira', 'pedra'].includes(s.item))
    const prompt = [
      this.#summary(world), `Já construído: ${existing}.`,
      `Materiais na mochila: ${materials.map(s => `${s.item}=${s.quantity}`).join(', ')}.`,
      `Terrenos livres: ${plots.map((p, i) => `${i} = (${p.x},${p.y}) ${world.describePlot(p)}`).join('; ')}.`,
      `Esta é a invenção ${builds.length + 1}. Pontos existentes no mapa: ${world.map.sites.slice(0, 12).map(s => s.name).join(', ')}.`,
      water ? `Só restam ${world.lakeReserve} unidades no lago. Projete um aparelho que guarde chuva até Laya ir ao tile e recolher a água.`
        : 'Prefira uma ideia com uma ação que a personagem possa testar logo após construir.',
    ].join('\n')
    const postpone = water ? 'water' : 'idea'
    try {
      const reply = await ai.invent(prompt, plots.length, builds.length === 0, !water && combine,
        water ? this.#waterBudget(world, 4) : undefined)
      if (!reply.ok) {
        observer.model('generation', reply.error)
        return this.#noResult(world, postpone)
      }
      const { plan, plot } = reply.value
      const at = plots[plot]
      const ready = at && world.previewAssembly(plan, at)
      if (!at || !ready || (water && !hasWaterSupply(ready.regras))) {
        observer.model('generation', water ? 'A fonte proposta precisa captar chuva, permitir retirar água e caber nos recursos do vale.'
          : 'Projeto sem terreno, materiais, nome ou espaço para o kit.')
        return this.#noResult(world, postpone)
      }
      observer.model('generation', 'Ativo')
      return { action: { id: 'anotar_planta', label: `Anotar planta de ${plan.nome}`, kind: 'record_project',
        at: world.researchTable, project: { kind: 'blueprint', plan: ready, plot: at }, score: 0 } }
    } catch {
      observer.model('generation', 'Não foi possível buscar uma invenção.')
      return this.#noResult(world, postpone)
    }
  }

  #waterBudget(world: World, cap: number) {
    return { madeira: Math.min(world.bag.madeira, cap), pedra: Math.min(world.bag.pedra, cap) }
  }

  #summary(world: World) {
    const { day, time } = world.time
    const { rain, night } = world.weather
    const { vitals, bag } = world
    const others = world.characters.filter(character => character.id !== world.activeId)
      .map(character => `${character.name} em (${character.at.x},${character.at.y}) ${character.alive ? `com ${character.vitals.hp} HP e ${character.xp} XP` : 'morta'}`)
      .join('; ')
    const animals = world.animals.map(animal => `(${animal.at.x},${animal.at.y}) ${animal.hp} HP`).join(', ') || 'nenhum'
    const gear = world.active.equipment ? world.item(world.active.equipment) : undefined
    const equipment = gear
      ? `Equipado: ${gear.name} (Dano ${gear.damage ?? 0}, Proteção ${gear.protection ?? 0}).`
      : 'Equipado: nada.'
    const raw = world.active.inventory.count('carne_crua')
    const meat = raw > 0
      ? ` Carne crua: ${raw}; estraga em ${Math.max(0, (world.active.rawUntil ?? world.turn) - world.turn)} turnos.`
      : ''
    return `Você interpreta ${world.active.name}. Dia ${day}, ${time}, ${rain ? 'chuva' : night ? 'noite limpa' : 'tempo limpo'}. HP ${vitals.hp}, energia ${vitals.energia}, fome ${vitals.fome}, alegria ${vitals.alegria}, sede ${vitals.sede} (0–100), XP ${world.xp}. Mapa ${world.map.width} × ${world.map.height}. Bolsa: ${bag.madeira} madeira, ${bag.pedra} pedra, ${bag.agua} água, ${bag.fruta} frutas.${meat} ${others ? `Também no vale: ${others}.` : ''} Animais: ${animals}. Horta ${world.gardenStage}. ${equipment}. Última ação: ${world.lastAction || 'cheguei agora'}.`
  }
}
