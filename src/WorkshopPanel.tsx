import { useState } from 'react'
import type { Recipe } from './crafting'
import type { Stack } from './inventory'
import type { World } from './world'
import { inList } from './blueprint'
import { harvestOnlyItems } from './inventory'

export function Backpack({ world }: { world: World }) {
  const [who, setWho] = useState(world.activeId)
  const character = world.character(who) ?? world.active
  const slots = character.inventory.slots
  const used = slots.filter(Boolean).length
  const equipped = character.equipment
  return <section className="backpack" aria-label="Mochila">
    <header><h2>Mochila · {character.name}</h2><span>{used}/{slots.length} slots</span></header>
    <div className="backpack-switch" aria-label="Personagem da mochila">
      {world.characters.map(entry =>
        <button key={entry.id} type="button" aria-pressed={entry.id === who} onClick={() => setWho(entry.id)}>
          {entry.name}
        </button>)}
    </div>
    {character.inventory.count('carne_crua') > 0 && <p className="perish-note">
      🥩 Carne crua: {Math.max(0, (character.rawUntil ?? world.turn) - world.turn)} turnos antes de estragar. Asse no forno.
    </p>}
    <ol className="slot-grid" aria-label="Inventário de 32 slots">
      {slots.map((slot, i) => {
        const item = slot && world.item(slot.item)
        const isEquipped = !!slot && slot.item === equipped
        const label = slot && item ? `${item.name} ×${slot.quantity}${isEquipped ? ' · equipado' : ''}` : `Slot ${i + 1} vazio`
        return <li key={i} className={`bag-slot${slot ? ' filled' : ''}${isEquipped ? ' equipped' : ''}`} title={label} aria-label={label}>
          {slot && item && <><span className="item-emoji" aria-hidden="true">{item.emoji}</span><b aria-hidden="true">{slot.quantity}</b>
            {isEquipped && <i className="bag-equipped" aria-hidden="true">E</i>}</>}
        </li>
      })}
    </ol>
  </section>
}

function StackLabel({ world, stack }: { world: World; stack: Stack }) {
  const item = world.item(stack.item)
  return <span className="stack-label"><span className="item-emoji" aria-hidden="true">{item?.emoji}</span> {item?.name ?? stack.item} ×{stack.quantity}</span>
}

function RecipeCard({ world, recipe }: { world: World; recipe: Recipe }) {
  return <li className="recipe">
    <strong>{recipe.name}</strong>
    <small>{recipe.process === 'montar' ? 'Bancada de trabalho' : `Estação: ${recipe.process}`} · {recipe.uses} {recipe.uses === 1 ? 'produção' : 'produções'}</small>
    <p>{recipe.inputs.map((stack, i) => <span key={stack.item}>
      {i > 0 && ' + '}<StackLabel world={world} stack={stack} />
    </span>)} <span aria-label="produz">→</span> <StackLabel world={world} stack={recipe.output} /></p>
    {recipe.fuel && <p>Combustível: <StackLabel world={world} stack={recipe.fuel} /></p>}
    {inList(recipe.output.item, harvestOnlyItems) && <p>Receita antiga inativa: o resultado agora vem de coleta ou cultivo.</p>}
  </li>
}

export function RecipePanel({ world }: { world: World }) {
  const recipes = world.recipes
  const stations = world.installed.filter(s => world.item(s.item)?.kind === 'estacao')
  const project = world.researchProject
  return <div className="workshop-panel">
    <p className="workshop-goal">Mesa de Pesquisa: {world.researchTopic ? <b>Pesquisando</b> : 'as descobertas do Qwen acontecem aqui.'}</p>
    {project && <p className="workshop-goal">Projeto em andamento: <b>{project.kind === 'blueprint'
      ? project.plan.nome : `Reforma de ${world.builds.find(build => build.id === project.objectId)?.plan.nome}`}</b></p>}
    <details className="visual-parts" open>
      <summary>Estoque dos aparelhos</summary>
      <ul>
        <li><b>Bancada de trabalho</b>: {world.benchStock.map(stack => `${world.item(stack.item)?.name ?? stack.item} ×${stack.quantity}`).join(', ')
          || (world.benchKit ? '' : 'vazia')}{world.benchKit && `${world.benchStock.length ? ', ' : ''}Kit de ${world.benchKit}`}</li>
        {stations.map(station => <li key={station.turn}><b>{world.item(station.item)?.name}</b> [{station.at.x}, {station.at.y}]: {(station.stock ?? [])
          .map(stack => `${world.item(stack.item)?.name ?? stack.item} ×${stack.quantity}`).join(', ') || 'vazio'}</li>)}
      </ul>
    </details>
    {recipes.length ? <ul className="recipe-list">{[...recipes].reverse().map(recipe =>
      <RecipeCard key={recipe.id} world={world} recipe={recipe} />)}</ul>
      : <p className="empty">As combinações que a Laya descobrir aparecem aqui.</p>}
  </div>
}
