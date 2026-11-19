import type { Character } from './character'
import type { Item } from './inventory'
import type { World } from './world'

const labels = { energia: 'Energia', fome: 'Fome', alegria: 'Alegria', sede: 'Sede' } as const
const critical = { energia: (value: number) => value <= 15, fome: (value: number) => value >= 85,
  alegria: (value: number) => value <= 15, sede: (value: number) => value >= 85 } as const

const attributes = (item: Item) => [item.damage ? `Dano ${item.damage}` : '', item.protection ? `Proteção ${item.protection}` : '']
  .filter(Boolean).join(' · ')

function FighterCard({ character, active, opponent, equipment, onRevive }: {
  character: Character; active: boolean; opponent: boolean; equipment?: Readonly<Item>; onRevive: () => void
}) {
  return <article className={`fighter ${character.id} ${active ? 'active' : ''} ${character.alive ? '' : 'dead'}`}
    aria-label={`${character.name}, ${active ? 'agindo' : 'esperando'}`}>
    <header>
      <strong>{character.name}{active ? <small>agindo</small> : opponent ? <small>esperando</small> : null}</strong>
      <span>{character.xp} XP</span>
    </header>
    {character.alive ? <>
      <div className={`fighter-hp${character.vitals.hp >= 100 ? ' full' : ''}`}>
        <span>HP</span>
        {character.vitals.hp < 100 && <progress aria-label={`HP de ${character.name}`} value={character.vitals.hp} max={100} />}
        <b>{character.vitals.hp}</b>
      </div>
      <div className="fighter-vitals" aria-label={`Necessidades de ${character.name}`}>
        {(['energia', 'fome', 'alegria', 'sede'] as const).map(stat =>
          <span key={stat} className={critical[stat](character.vitals[stat]) ? 'critical' : ''}
            title={`${labels[stat]}: ${character.vitals[stat]}`}>
            <b>{labels[stat]}</b> {character.vitals[stat]}
          </span>)}
      </div>
      <div className={`fighter-gear ${equipment ? '' : 'empty'}`}
        title={equipment ? `${equipment.name} · ${attributes(equipment)}` : 'Nenhum item equipado'}>
        <span className="eyebrow">Equipado</span>
        {equipment
          ? <><span className="gear-name"><span className="item-emoji" aria-hidden="true">{equipment.emoji}</span> {equipment.name}</span>
            <b>{attributes(equipment)}</b></>
          : <span className="gear-name">Mãos livres</span>}
      </div>
    </> : <div className="fighter-dead">
      <span>Morreu. A mochila caiu onde ela estava.</span>
      <button onClick={onRevive}>Reviver</button>
    </div>}
  </article>
}

export function Fighters({ world, onRevive }: { world: World; onRevive: (id: Character['id']) => void }) {
  return <section className="status-card card fighters" aria-label="Quem está no vale">
    <p className="eyebrow">DUAS VONTADES</p>
    <h2>Quem está vivo</h2>
    {world.characters.map(character => <FighterCard key={character.id} character={character}
      active={character.id === world.activeId} opponent={character.id !== world.activeId}
      equipment={character.equipment ? world.item(character.equipment) : undefined}
      onRevive={() => onRevive(character.id)} />)}
    <p className="fighters-note">{world.animals.length
      ? `${world.animals.length} animal(is) à solta. Eles atacam e quebram objetos.`
      : 'Nenhum animal à vista.'}</p>
  </section>
}
