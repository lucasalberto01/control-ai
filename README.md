# Vale da Laya

Um minimundo isométrico em SVG que vive sozinho. A Laya passeia, cuida das próprias necessidades e constrói invenções propostas em português por um segundo modelo local. As criações ficam no mapa, ganham regras reais e podem ser visitadas e usadas.

## Rodar no Windows

Requer Node.js 22+ e Ollama 0.40+ rodando em `127.0.0.1:11434`.

```powershell
npm install
ollama pull laya:322m-multilingual-bf16
ollama pull qwen3.5:4b
npm run dev
```

Abra a janela do **Vale da Laya** que o Electron inicia. A simulação começa sem comandos. Use os botões de pausa e velocidade se quiser. Clique numa invenção no mapa para ver o efeito dela no mundo e quantas vezes já foi usada.

No mapa, use a **roda do mouse** para dar zoom. Para se mover, segure **Espaço** e arraste ou use o **botão do meio** do mouse. O botão **1:1** devolve o mapa ao centro. O zoom e a posição são só da sua tela e não alteram o save.

A lateral tem as abas **Mochila** (com troca entre Laya e Kael), **Diário** (com filtros de combate, coleta e pesquisa), **Criações** e **Oficina**. No rodapé do mapa ficam os contadores de javalis, itens no chão e criações quebradas; clique no contador de itens para ver o conteúdo das pilhas.

O jogo pode continuar com a janela minimizada; **ao fechar o app, a simulação para**.

## Dados do mundo

- [`src/data/world.seed.json`](src/data/world.seed.json) define um mundo novo: dimensões, lugares e suas áreas, caminhos, árvores, clima e estado inicial da Laya. As descrições de terrenos usam os lugares mais próximos do mapa, incluindo os que ela construir.
- `world.save.json` guarda o mapa, o terreno coletado, a mochila, as receitas, as estações e as invenções. No Windows, em desenvolvimento, fica em `%APPDATA%\markts_pou\world.save.json`. A cada turno, um arquivo temporário é gravado antes de substituir o save anterior. O mapa também é gravado a cada turno, então as expansões da fronteira sobrevivem ao fechar o app. Saves v1 migram automaticamente: os quatro contadores da bolsa viram pilhas sem perder as criações anteriores.
- Alterações no seed valem só para mundos novos. `npm run dev` e `npm start` compartilham o novo arquivo quando usam o mesmo perfil do Electron. Para importar o progresso antigo do `localStorage`, abra primeiro pelo mesmo modo (dev ou compilado) que usava antes. O original não é apagado, e um JSON existente tem prioridade.

Para editar manualmente um save, feche o app e faça uma cópia antes.

## Como funciona

- **Laya 322M** escolhe ações disponíveis. As regras do mundo têm prioridade quando há uma necessidade crítica ou uma invenção ainda não testada.
- **Qwen 3.5 4B** inventa a função e monta o visual por módulos SVG desenhados à mão: base, suporte, corpo, topo e adorno, com cor independente. As consultas ao Qwen acontecem na Mesa de Pesquisa, perto da casa: a Laya caminha até lá, recebe a receita, a planta ou o projeto de reforma e só então segue para a bancada ou para o objeto. Os encaixes e alturas são checados pelo jogo; o mesmo pedestal pode sustentar uma bacia, uma gema ou uma luminária. Os visuais anteriores têm equivalentes modulares sem perder os dados antigos.
- Depois de usar uma criação, a Laya pode reformá-la **só no desenho**: trocar, pintar, acrescentar ou remover uma peça compatível. Nome, lugar, funções, estoque e histórico de uso são preservados. Cada objeto aceita no máximo duas reformas e há um intervalo de 20 turnos entre elas. Reformar nunca atrasa a próxima invenção.
- **Uma função por objeto.** A criação nasce com uma família só — efeitos nas necessidades (energia, alegria, fome, umidade) **ou** recursos (guardar, retirar, converter). Ao abrir um save antigo, cada criação mantém só a função principal, definida pelo nome/ideia; as funções extras acumuladas por reformas antigas são removidas. A poda é estável: reabrir o save não muda mais nada.
- O jogo compara peças e cores entre as criações e os objetos instalados no mapa. Se uma combinação já existir, procura uma variante, priorizando repintar uma peça sem mudar a silhueta. Ao abrir um save antigo, o primeiro objeto com um visual o conserva e as duplicatas são diferenciadas sem custo.
- A simulação valida terrenos e materiais e aplica os efeitos permitidos. Por exemplo, uma invenção pode guardar água da chuva e liberá-la para a mochila quando a Laya recolhe no local. O vale começa com **14 criações** (antes eram nove, o que travava novas invenções e a fonte de água); saves antigos sobem para 14 ao abrir, sem perder nada. Cada expansão da fronteira libera **mais 4 criações** e mais terreno. Se o Ollama falhar, a rotina continua com regras simples e as futuras tentativas de pesquisa são retomadas automaticamente.

As regras ficam em `World` (turnos e decisões válidas), `WorldMap` (terreno, rotas e clima) e `Invention` (estoque e efeitos). `TurnPlanner` consulta a IA; `WorldStore` valida e grava o progresso. O React anima a simulação e recebe uma nova instância de `World` por turno. O Electron e o arquivo JSON recebem apenas dados, que são convertidos de volta em classes ao carregar.

## Mesa de Pesquisa

A Laya precisa ir até a Mesa de Pesquisa, perto da casa — um pequeno computador em SVG —, para consultar o Qwen sobre receitas, plantas e reformas. A tela acende enquanto ela pesquisa. Uma receita entra no caderno; uma planta segue para a bancada; um projeto de reforma só é aplicado no tile da invenção. Pesquisas e projetos pendentes ficam no save.

Resultados aceitos e gravados aparecem como um aviso dentro da janela do Electron, com o nome da descoberta. A versão instalada também pode exibir uma notificação nativa do Windows; se ela não aparecer, confira as notificações do sistema.

## Fome, sede e HP

- Cada personagem come e bebe da **própria mochila**. Quando fica com fome, sede, exaustão ou tristeza crítica, perde 4 HP por condição a cada turno. Quando as necessidades estão em dia, recupera HP aos poucos.
- **HP em 0 é morte.** Não existe recuperação automática: o corpo fica no mapa, a mochila cai no chão e só você pode clicar em **Reviver**. Quem volta recomeça em casa, com mochila vazia e XP 0 — o mundo e as criações continuam.
- A árvore frutífera pode ser colhida e dá sementes. Na horta, só nasce fruta se a personagem plantar e houver umidade suficiente da chuva ou da rega. Regar gasta a mesma água que ela usa para beber.
- O lago é finito. Quando a reserva fica baixa, a personagem pede ao Qwen o projeto de um aparelho que capte chuva para o próprio estoque. Ela fabrica, recolhe e instala o kit — **sempre uma invenção nova**, nunca adaptando um banco ou uma mesa. Retirar água do aparelho é outra ação no mesmo tile; só então a água fica na mochila. Não existe fonte pronta, e o lago não enche sozinho.

## Duas personagens, combate e animais

- **Laya e Kael** vivem no mesmo vale e **alternam os turnos**. Cada um tem posição, vitais, mochila de 32 slots, XP e escolhas próprias. A bancada, as estações e as receitas são compartilhadas.
- **Combate:** dá para atacar quem estiver ao lado. Sem arma, o dano é 2; itens com **Dano** batem mais forte e itens com **Proteção** reduzem mordidas e golpes (sempre sobra pelo menos 1 de dano). Matar a outra personagem leva **50% do XP** dela; a mochila da vítima cai no chão e pode ser saqueada por quem estiver vivo.
- **Um slot de equipamento:** cada personagem usa **um único item** por vez. Arma e armadura disputam o mesmo espaço; o cartão mostra o item equipado e os atributos, e a mochila marca o slot com **E**. Equipar não gasta o item: ele continua na mochila, cai junto com ela na morte e precisa ser recolhido. Armas antigas com o campo `weapon` migram para esse slot automaticamente.
- **Atributos:** `Dano` (1–20) só vale para itens `objeto` e aumenta o golpe; `Proteção` (1–20) reduz o dano recebido de animais e da outra personagem, mas não evita fome, sede ou cansaço. Um item pode ter os dois. A oficina e a pesquisa reconhecem os atributos, e itens de equipamento não são instalados no mapa.
- **Barras de vida:** javalis, Laya, Kael e criações mostram uma barra acima do desenho quando não estão com 100% de vida. A barra some quando o HP está cheio e, nas criações quebradas, aparece vazia até o reparo. Os cartões das personagens também escondem a barra de HP quando ela está cheia.
- **Itens no chão:** a IA vê os drops no mapa e prioriza recolher quando falta água, comida, equipamento ou material. Ela só larga um item para a outra personagem quando a própria mochila está quase cheia, para não espalhar coisas sem motivo.
- **Largar e pegar:** uma personagem pode largar itens no chão perto da outra; qualquer um recolhe o que couber. É a forma de trocar sem menu.
- **Sem disputa de tile:** se a outra personagem estiver num lugar, ele sai das opções — ninguém fica tentando a mesma ação no mesmo tile. E, se uma ação for recusada, o turno **passa mesmo assim**: ela espera e tenta outra coisa no turno seguinte, em vez de repetir a mesma falha para sempre.
- **Demolir:** uma personagem pode destruir a criação da outra. Objetos quebrados por animais também podem ser **reparados** com madeira.
- **Animais:** o vale mantém até **4 bichos**. Eles perseguem quem estiver perto, dão 4 de dano por mordida e podem quebrar objetos (a criação fica marcada, para de funcionar e precisa de reparo). **A personagem age antes do bicho**, e cada animal morde no máximo **uma vez a cada dois turnos** — matar um javali antes de ele revidar agora é possível. Ao cair, o javali deixa **2 carnes cruas e 1 couro** no chão, além dos 12 XP; o loot se junta a outros itens no mesmo tile e pode ser recolhido pela mochila. Carnes alimentam (crua tira 45 de fome; assada tira 70) e o couro serve de material para receitas, como armaduras. Se a fauna sumir, novos animais aparecem **em terreno livre do vale** — dois de uma vez quando o vale está vazio e mais um a cada oito turnos, longe das personagens, da casa e das criações. A posição varia a cada turno, então eles não ficam presos no mesmo canto, mesmo em mapas grandes.
- **Expandir o vale:** quando a fronteira descansa e há espaço, Laya ou Kael podem escolher **desbravar**. A personagem caminha até a borda, o mapa ganha uma faixa de terreno, uma nova área de construção e um **Marco** (do Leste ou do Sul). A árvore frutífera, a Mesa de Pesquisa, as criações, o terreno já colhido e as posições de todos ficam exatamente onde estavam. Cada expansão aumenta o limite de criações em 4, e há um intervalo de 45 turnos entre uma e outra.

## Oficina e mochila

- **Mochila:** 32 slots com emojis Unicode do sistema. Materiais iguais empilham até 16; estações ocupam um slot cada. Se a ação não couber, nem os insumos nem o recurso do mapa são consumidos.
- **Coleta:** madeira vem de árvores que ficam caídas no SVG; a água é retirada de uma margem adjacente e o lago revela areia ao secar. Tirar a grama revela terra; tirar a terra revela pedra. As rotas reagem à água que restar, e a fruta da horta renasce ao amanhecer.
- **Bancada de trabalho e aparelhos:** a Laya leva os insumos até o tile correto. Depois de produzir, o item fica no estoque do aparelho. Recolher é outra ação no mesmo tile, e instalar é outro turno em terreno vazio. Se a mochila não comportar tudo, o restante fica no aparelho; se o estoque do aparelho não tiver espaço, a produção não gasta insumos. Os kits SVG também ficam na bancada até serem recolhidos.
- **Receitas:** abra **Caderno do vale → Oficina** para ver os estoques da bancada e das estações instaladas. **Não existe lista fixa de objetivos:** o Qwen recebe os processos acessíveis, os insumos disponíveis, os combustíveis e as receitas recentes, e escolhe livremente o que a Laya descobre — um material, um objeto, uma luz ou uma estação nova. O jogo informa por que uma proposta foi recusada. Aquecer, cortar e misturar exigem a estação correspondente, então o caminho da oficina nasce das invenções dela.
- [`items.json`](src/data/items.json) define o catálogo inicial, com alguns materiais e o forno. O resto do caminho é descoberto: o Qwen pode criar materiais, objetos, luzes e estações, escolhendo um emoji ainda livre no catálogo do jogo. Os objetos instaláveis ganham uma composição SVG no mapa.

```powershell
npm test             # regras do mapa, construção, saves e migração
npm run test:ollama  # teste com os dois modelos locais
npm run lint
npm run build:app    # compila sem gerar instalador
npm run test:electron # abre o vale com Laya e Kael, avança turnos e recarrega o save
npm run test:workshop # acompanha uma descoberta livre da oficina com o Ollama real
npm run test:recipes  # verifica a pesquisa livre de receitas com o Qwen local
npm run test:renovate # verifica a reforma só visual com o Qwen local
npm start            # abre o app compilado
npm run build        # compila e gera o instalador
```
