# RPG Maker MZ - MCP Ultimate

> Servidor Model Context Protocol (MCP) que dá controle total sobre projetos do **RPG Maker MZ** a agentes de IA.

**Versão:** 1.0.0
**Autor:** Newton Alves
**Produto:** RPG Maker MZ - MCP Ultimate
**Licença:** MIT

---

## Sumário

- [Visão geral](#visão-geral)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Modo de uso](#modo-de-uso)
- [Memória do projeto](#memória-do-projeto)
- [Análises semânticas](#análises-semânticas)
- [Entendendo o catálogo de ferramentas](#entendendo-o-catálogo-de-ferramentas)
- [O que ele consegue fazer](#o-que-ele-consegue-fazer)
- [Exemplos de comandos](#exemplos-de-comandos)
- [Arquitetura](#arquitetura)
- [Segurança e atomicidade](#segurança-e-atomicidade)
- [Múltiplas instâncias simultâneas](#múltiplas-instâncias-simultâneas)
- [Testes](#testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Resolução de problemas](#resolução-de-problemas)
- [Limitações conhecidas](#limitações-conhecidas)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)
- [Créditos](#créditos)

---

## Visão geral

`rpg-maker-mz-mcp` é um servidor MCP em TypeScript que expõe **193 ferramentas** organizadas em 28 categorias, permitindo que um agente de IA crie, edite e inspecione qualquer aspecto de um projeto RPG Maker MZ por meio de comandos em linguagem natural.

A arquitetura é **híbrida**:

- **Modo edição (jogo fechado):** o servidor lê e escreve diretamente os arquivos JSON do projeto (`data/`), os plugins JavaScript (`js/plugins/`) e os assets (`img/`, `audio/`), com garantias de atomicidade, backup automático e detecção de conflito com o editor MZ aberto.
- **Modo runtime (jogo rodando):** um plugin companion (`MzMcpCompanion.js`) instalado no projeto abre uma conexão WebSocket local, permitindo que o agente consulte e modifique o estado do jogo enquanto ele está em execução (HP, switches, variáveis, posição do jogador, cena ativa, janelas visíveis, batalha em andamento etc.).

---

## Pré-requisitos

| Requisito | Versão mínima | Observação |
|---|---|---|
| Node.js | 18.0.0+ | Recomendado 20.x ou 22.x |
| RPG Maker MZ | qualquer | Necessário para usar o produto |
| Cliente MCP | qualquer | Compatível com qualquer cliente que implemente o protocolo MCP (servidor stdio) |
| Sistema operacional | Windows, macOS, Linux | Auto-detecção de instalação do MZ via Steam |

### Dependências externas opcionais

Algumas ferramentas dependem de programas externos que **não vêm incluídos** neste MCP. Você só precisa instalar se quiser usar a ferramenta correspondente.

| Programa externo | Tools que dependem | Sem ele |
|---|---|---|
| **rpgmpacker** ([github.com/erri120/rpgmpacker](https://github.com/erri120/rpgmpacker)) | `mz_build` | Apenas a build cross-platform é desabilitada. As outras 192 ferramentas funcionam normalmente. A tool retorna mensagem clara com link de download se você tentar usar. |

**Importante:** Se você clonar este MCP do GitHub e instalar em outro computador, **não precisa instalar `rpgmpacker` automaticamente** — só quando quiser empacotar seu jogo para distribuição (Windows, Mac, Web, Android). Criação de mapas, personagens, plugins, edição de eventos, etc., funcionam **sem nenhuma dependência externa**.

Para verificar se está disponível a qualquer momento, peça ao agente: *"verifica se o rpgmpacker está disponível"* (chama `mz_build_check_rpgmpacker`).

---

## Instalação

### Clonando o repositório

```bash
git clone <url-do-repositorio>
cd rpg-maker-mz-mcp
npm install
npm run build
```

### Estrutura após build

Após `npm run build`, a pasta `dist/` contém o servidor compilado. O ponto de entrada é `dist/index.js`.

---

## Configuração

### 1. Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `MZ_PROJECT_PATH` | Sim | Caminho absoluto para a pasta do projeto RPG Maker MZ |
| `MZ_INSTALL_PATH` | Não | Caminho da instalação do RPG Maker MZ (auto-detect se omitido) |
| `MZ_MCP_CONFIG` | Não | Caminho do arquivo `mz-mcp.config.json` (default: `<project>/mz-mcp.config.json`) |
| `MZ_MCP_LOG_LEVEL` | Não | `debug`, `info`, `warn`, `error` (default: `info`) |

### 2. Arquivo de configuração (opcional)

Crie `mz-mcp.config.json` na raiz do projeto MZ:

```json
{
  "project": {
    "path": "auto",
    "autoBackup": true,
    "backupRetention": 20,
    "backupDir": ".mz-mcp/backups"
  },
  "editor": {
    "onLock": "warn"
  },
  "mz": {
    "installPath": "auto",
    "corescriptVersion": "v1.6.0"
  },
  "runtime": {
    "enableEvalJs": false,
    "companionPort": 0,
    "tokenFile": ".mz-mcp/companion.token"
  },
  "plugins": {
    "defaultNamingConvention": "snake",
    "knownBases": {}
  },
  "logging": {
    "level": "info"
  }
}
```

### 3. Configuração no cliente MCP

Edite o arquivo `mcp.json` do seu cliente MCP (exemplo abaixo):

```json
{
  "mcpServers": {
    "rpg-maker-mz-mcp": {
      "command": "node",
      "args": ["C:\\caminho\\completo\\dist\\index.js"],
      "env": {
        "MZ_PROJECT_PATH": "C:\\caminho\\do\\seu\\projeto\\MZ"
      }
    }
  }
}
```

Reinicie o cliente MCP após a configuração.

---

## Modo de uso

### Fluxo básico (modo edição)

1. Configure o servidor MCP no seu cliente (item anterior).
2. Reinicie o cliente.
3. Faça pedidos em linguagem natural ao agente:
   - *"Crie um personagem chamado Marina, classe Maga, nível 5."*
   - *"Adicione um diálogo no NPC do mapa 5."*
   - *"Gere uma dungeon procedural 40x30 com autotile A2."*
4. Abra o RPG Maker MZ — as mudanças estarão lá.

### Fluxo runtime (jogo em execução)

1. Peça ao agente: *"Instale o companion no meu projeto."*
2. Abra o RPG Maker MZ e inicie o **Playtest**.
3. Faça pedidos enquanto joga:
   - *"Qual o HP da Marina agora?"*
   - *"Ativa o switch 5."*
   - *"Transfere o jogador para o mapa 10, posição (5, 5)."*
   - *"Que cena está aberta? Tem alguma janela ativa?"* (queries estruturadas, sem `eval_js`)
   - *"Tire um screenshot."* (a imagem chega como conteúdo nativo, sem ser texto base64)

---

## Memória do projeto

Toda sessão de agente costuma começar do zero — sem lembrar decisões de design, convenções, lore, regras de balance, ou o que foi feito por outro Claude ontem. O sistema de **memória persistente** resolve isso: o agente pode **registrar fatos** que ficam guardados localmente em `.mz-mcp/memory/` e ler de volta em qualquer sessão futura.

### Categorias

| Categoria | Para que serve |
|---|---|
| `design_decisions` | Decisões de design intencionais (ex.: "Reid começa fraco propositalmente") |
| `conventions` | Padrões do projeto (naming, organização, estilo) |
| `lore` | Fatos do mundo do jogo |
| `balance_rules` | Regras de balanceamento (ex.: "bosses dão 5× XP de mob comum") |
| `wip_notes` | Notas de trabalho em andamento |
| `agent_handoff` | Mensagens deixadas pra próximo agente continuar |
| `custom` | Tudo que não cabe nas anteriores |

### Tools

- `project_memory_remember(category, key, content, tags?)` — registra ou atualiza
- `project_memory_recall(category?, search?, tags?)` — recupera por filtros
- `project_memory_list(category?)` — lista metadados (sem conteúdo)
- `project_memory_forget(key)` — remove uma entrada
- `project_memory_categories()` — overview com count por categoria

### Storage

```
.mz-mcp/memory/
├── index.json                 # metadados de todas as entradas
└── entries/
    └── <sha1-of-key>.md       # conteúdo livre (markdown)
```

Atomic writes (tmp + rename), multi-agent safe (índice é re-lido antes de cada modificação), versionável via git se você quiser.

---

## Análises semânticas

Ferramentas `analysis_*` rodam varreduras consolidadas do projeto e retornam **relatórios estruturados**. Cada análise tem cache baseado em mtime do `data/` — re-rodar sem mudanças é instantâneo.

| Tool | Responde |
|---|---|
| `analysis_npc_dialogue_map` | Todos os NPCs com diálogo (Show Text 101/401), agrupados por mapa, com preview. Identifica mapas vazios. |
| `analysis_switch_variable_graph` | Grafo de uso: quem seta e quem lê cada switch/variable. Identifica **mortos** (registrados mas nunca usados) e **órfãos** (lidos mas nunca setados — bug provável). |
| `analysis_item_economy` | Pra cada item/arma/armadura: drops de enemies, shops, tesouros de eventos. Identifica items **inalcançáveis** (sem nenhuma fonte). |
| `analysis_skill_distribution` | Pra cada skill: quem aprende (classes via learnings + states com Add Skill), nível, custo, stat principal usado na fórmula. Identifica skills **inacessíveis**. |
| `analysis_enemy_appearances` | Pra cada enemy: em quais troops, e quais delas são chamadas em map events ou random encounters. Identifica enemies **inalcançáveis**. |
| `analysis_tileset_usage` | Pra cada tileset: que mapas usam, com dimensões. Identifica tilesets **não usados**. |
| `analysis_map_flow` | Grafo dirigido do fluxo de mapas baseado em comandos Transfer Player (code 201). Identifica mapas **órfãos** (sem entrada), **dead-end** (sem saída) e **unreachable** (sem caminho a partir do starting map via BFS). Útil pra entender estrutura narrativa em projetos grandes. |
| `analysis_clear_cache` | Limpa todos os caches (use se algo parecer desatualizado). |

Cada chamada aceita `force: true` pra ignorar cache.

### Exemplo de uso real

> *"Quais items do meu jogo o jogador nunca consegue obter?"*

```
analysis_item_economy → retorna unreachableCount + lista
```

> *"Quais switches eu criei mas nunca uso?"*

```
analysis_switch_variable_graph → switches.dead[]
```

> *"Quem fala sobre a Caverna de Fogo no jogo?"*

```
analysis_npc_dialogue_map → procura "fogo" ou "caverna" no preview por mapa
```

> *"Esse mapa novo está conectado ao resto do jogo? E os mapas legacy abandonados?"*

```
analysis_map_flow → nodes.unreachable + nodes.orphan + grafo de edges
```

---

## Entendendo o catálogo de ferramentas

O MCP organiza suas ferramentas em **duas categorias** que se complementam:

### Ferramentas genéricas (CRUD)

**CRUD** é um termo de programação: **C**reate (criar), **R**ead (ler), **U**pdate (atualizar), **D**elete (deletar) — as operações básicas em qualquer banco de dados.

Em vez de criar uma ferramenta separada para cada combinação (criar ator, ler ator, atualizar ator, criar item, ler item, atualizar item...), o MCP tem **6 ferramentas universais** que aceitam um parâmetro `category` indicando o tipo de dado.

| Ferramenta | O que faz | Exemplo |
|---|---|---|
| `db_list` | Lista todos os registros de uma categoria | `db_list(category: "actor")` lista personagens |
| `db_get` | Lê um registro específico por ID | `db_get(category: "skill", id: 5)` |
| `db_create` | Cria um novo registro | `db_create(category: "item", data: {...})` |
| `db_update` | Atualiza campos de um registro existente | `db_update(category: "item", id: 1, patch: { price: 100 })` |
| `db_delete` | Remove um registro (com snapshot automático) | `db_delete(category: "enemy", id: 7)` |
| `db_search` | Busca por substring em name/note/description | `db_search(category: "skill", query: "fogo")` |

Categorias suportadas: `actor`, `class`, `skill`, `item`, `weapon`, `armor`, `enemy`, `troop`, `state`, `animation`, `tileset`, `common_event`.

**Vantagem:** 6 ferramentas cobrem 12 categorias diferentes — extremamente flexível.

**Desvantagem:** Para criar do zero, você precisa fornecer o objeto JSON completo com todos os campos obrigatórios.

### Ferramentas especializadas (helpers)

São atalhos com **defaults sensatos** para casos de uso comuns. O agente normalmente prefere essas porque exigem muito menos parâmetros:

| Helper | O que faz |
|---|---|
| `actor_create(name, classId, level)` | Cria personagem com sprite e face padrão, equipamento vazio |
| `skill_create_damage(name, formula, mpCost, elementId)` | Cria habilidade de dano com `type=1`, `scope=1` (1 inimigo), `hitType=1` (físico) |
| `skill_create_damage(name, formulaPreset)` | Mesmo, mas usando preset (ex.: `"physical_basic"`, `"magical_high"`, `"drain_hp"`) |
| `skill_create_healing(name, formula)` | Cria habilidade de cura com `type=3`, `scope=7` (1 aliado) |
| `enemy_create_balanced(level, role)` | Cria inimigo com stats CALCULADOS automaticamente baseado em level + role (`tank`, `mage`, `glass_cannon`, `boss`, etc.) |

**Vantagem:** Muito mais simples — você fornece apenas o essencial.

**Desvantagem:** Limitado aos casos previstos. Para coisas customizadas, use o CRUD genérico.

### Comparação prática

Criar uma habilidade "Bola de Fogo":

**Com CRUD genérico:**

```
db_create(category: "skill", data: {
  name: "Bola de Fogo",
  description: "Causa dano de fogo",
  iconIndex: 64,
  stypeId: 1,
  mpCost: 8,
  scope: 1,
  occasion: 1,
  hitType: 1,
  damage: { type: 1, elementId: 2, formula: "a.mat * 3", variance: 20, critical: false },
  effects: [], traits: [],
  message1: "", message2: "", messageType: 1,
  successRate: 100, repeats: 1, speed: 0,
  tpGain: 0, tpCost: 0,
  requiredWtypeId1: 0, requiredWtypeId2: 0,
  animationId: 0, note: ""
})
```

**Com helper especializado:**

```
skill_create_damage(
  name: "Bola de Fogo",
  formula: "a.mat * 3",
  mpCost: 8,
  elementId: 2
)
```

O resultado é o mesmo. O agente escolhe o caminho mais adequado a cada pedido.

---

## O que ele consegue fazer

### Database completo

CRUD genérico e helpers especializados para todos os tipos de dados do MZ:

- **Atores** (personagens): criar com classe, nível, sprite, face, equipamento
- **Classes**: definição, curva de EXP, skills aprendidas, traits
- **Habilidades (Skills)**: damage formula, custos, efeitos, traits
- **Itens, Armas, Armaduras**: stats, preço, efeitos, traits
- **Inimigos**: stats balanceados por nível e role (tank, mage, glass cannon, boss, etc.)
- **Grupos de inimigos (Troops)**: membros, layouts, eventos de batalha
- **Estados, Animações, Tilesets, Common Events, System**

### Mapas e eventos

- Criação de mapas, edição de tiles por coordenada ou retângulo
- Geração procedural (BSP dungeon, cellular automata cave, outdoor)
- Eventos com 8 templates de comando: diálogo, escolhas, condicional, transferência, batalha, som, mudança de membro, loja
- Suporte completo aos ~117 event commands do MZ via tool genérica
- **Renderização visual de mapas** (`map_render`) — compõe tiles + tileset images em PNG; retorna como conteúdo de imagem nativo pro agente "ver" o mapa sem abrir o editor
- **Busca/substituição de texto** (`text_replace_all`) — renomeia/corrige em todos os diálogos do projeto de uma vez (dry-run + snapshot)

### Verificação de integridade (4 pilares)

- `db_check_consistency` — **IDs cruzados no banco**: actor com classId inexistente, skills apontando para states deletados, weapons com wtypeId/etypeId fora do range, enemy actions com skillId inválido, troop members com enemyId inexistente, classes com learnings de skills removidas. 500+ checks em segundos, priorizados por severidade.
- `asset_check_missing_references` — **arquivos de asset**: detecta imagens/áudios referenciados que não existem no disco (`missing`) ou que existem com case diferente (`case_mismatch` — quebra em export web/Linux). Animações via `effects/*.efkefc`.
- `event_validate_structure` — **estrutura dos comandos**: command lists malformadas que travam o interpretador (sem terminador, indent inválido, blocos não fechados). Usa só invariantes provadas do MZ — zero falso positivo.
- `event_check_references` — **conteúdo dos comandos**: transfer pra mapa inexistente, call de common event/troop inexistente, switch/variável fora do range, escape codes `\V[n]`/`\N[n]` apontando pra dado inválido.

### Plugins JavaScript

- Instalar plugins prontos (arquivo local ou DLC bundled da instalação)
- Escrever plugins do zero com metadata canônica (JSDoc validada)
- Validar sintaxe via parser AST (acorn)
- Verificar compatibilidade (catálogo de issues conhecidos da suite VisuStella, conflitos YEP→MZ, etc.)

### Assets

- Importar imagens com validação rigorosa de formato (dimensões oficiais por categoria)
- Importar áudio (BGM, BGS, ME, SE)
- Compor sprites de personagem usando as peças do Character Generator do MZ (jimp para renderização)
- Limpeza heurística de assets não referenciados

### Build, tradução, save

- Empacotamento cross-platform via wrapper do `rpgmpacker` (Windows, Mac, Web, Mobile)
- Extração e importação de strings traduzíveis (formato compatível com Translator++)
- Edição de arquivos `.rmmzsave` (LZ-string + JSON) com helpers semânticos (gold, items, level, skills, posição)

### Knowledge distillation

Catálogos JSON que escondem códigos crípticos do MZ:

- Event commands (todos os ~117 codes com nome, categoria, params)
- Effect codes (recover_hp, add_state, learn_skill, etc.)
- Trait codes (param_rate, element_rate, xparam_rate, etc.)
- Tileset flags (passage, terrain tag, ladder, bush, counter)
- Notetags conhecidos (VisuStella, Galv, SRDude, etc.)
- Damage formula presets (physical_basic, magical_high, drain_hp, etc.)

### Runtime (com companion plugin)

Quando o jogo está rodando com o `MzMcpCompanion.js` ativo:

- **Queries clássicas:** estado do jogador, party, mapa, switches, variáveis, system
- **Queries estruturadas (alternativa segura a `eval_js`):**
  - `runtime_get_scene_state` — nome da Scene_* atual + propriedades relevantes (mapId, playerXY, troopId, etc.)
  - `runtime_get_window_state` — lista de Windows visíveis com tipo, posição, índice selecionado
  - `runtime_get_battle_state` — fase, turno, subject ativo, party/troop alive com HP/MP
  - `runtime_get_message_state` — texto, face, choices se mensagem ativa
  - `runtime_inspect` — leitura dot-walk segura de qualquer propriedade (`$gameParty._gold`, `$gameActors._data[1]._level`)
  - `runtime_simulate_battle` — simula batalha COMPLETA offline (clona party + troop, roda turnos com auto-attack, usa `Game_Action.makeDamageValue` do engine REAL). Respeita plugins customizados (VisuStella, Yanfly, sistemas custom). Retorna log + winner + dano total. Não afeta gameplay real.
- **Ações:** set switch/variable, HP/MP de actor, transferência, força batalha, common event, hot reload
- **Screenshot:** captura via PIXI extract com tamanho fixo (816×624), evitando estouro de memória com plugins que adicionam sprites com bounds grandes. Retorna como conteúdo de imagem nativo (Claude vê visualmente).
- **Eventos push (11 tipos):** o companion notifica mudanças — mapChanged, battleStarted, battleEnded, levelUp, switchChanged, variableChanged, goldChanged, itemChanged, partyMemberAdded, partyMemberRemoved, commonEventStarted
- **Execução de JavaScript arbitrário** (opt-in via config, para debug avançado)

---

## Exemplos de comandos

### Criação de conteúdo

> Crie 3 inimigos de gelo level 12-15, que dropam poções de cura.

Resultado: 3× `enemy_create_balanced` + `db_update` para drops + `troop_create` agrupando-os.

### Edição de mapa

> Adicione o diálogo "Olá, viajante!" no NPC do mapa 5 e, se ele já estiver ligado o switch 7, mostre "Você voltou!" no lugar.

Resultado: `map_event_search` + `event_template_dialogue` + `event_page_add` com condições + segundo `event_template_dialogue` na nova página.

### Visualização

> Me mostra como está o mapa 39 hoje (Cidade 1).

Resultado: `map_render(id: 39)` — o agente recebe a imagem nativamente e pode descrever layout, identificar áreas vazias, sugerir melhorias.

### Auditoria

> Verifica se tem algum problema de referência cruzada no banco antes de eu fazer build.

Resultado: `db_check_consistency` — relatório com todas as referências quebradas (skills apontando para states deletados, traits com IDs inválidos, etc.) priorizadas por severidade.

### Plugin authoring

> Crie um plugin chamado StaminaBar que adiciona uma barra de stamina, com parâmetro maxStamina (default 100) e comando setStamina.

Resultado: `plugin_create_new` com metadata gerada do schema, código JS estruturado, validação de sintaxe e registro em `plugins.js`.

### Build e deploy

> Faça o build para Windows e Web criptografando os áudios.

Resultado: `mz_validate_project` + `mz_build(platforms=["windows","web"], encryptAudio=true)`.

### Modo runtime

> Que cena está aberta no jogo agora? Tem alguma janela selecionada?

Resultado: `runtime_get_scene_state` + `runtime_get_window_state` (sem precisar de `eval_js`).

> Que HP a Marina está agora? Coloca em 1, quero testar a animação de baixo HP.

Resultado: `runtime_get_actor_state` + `runtime_set_actor_hp(actorId=marinaId, value=1)`.

> Tira um screenshot pra eu te mostrar o problema visual.

Resultado: `runtime_screenshot` — Claude recebe a imagem nativamente e pode descrever o que está vendo.

---

## Arquitetura

```
   Cliente MCP
            |
            | protocolo MCP (stdio)
            v
       rpg-maker-mz-mcp (TypeScript)
            |
            | Tools (193, 28 categorias)
            | Schemas Zod
            | SafeWriter + auto-backup + versionId bump
            |
            +-- R/W arquivos -->  Projeto RPG Maker MZ
            |                     (data/, js/, img/, audio/)
            |
            +-- WebSocket -->  MzMcpCompanion.js
                               (dentro do jogo em playtest)
```

Toda escrita é atômica (`.tmp` + rename) e cria backup rotativo. O `versionId` em `data/System.json` é incrementado a cada gravação, forçando o editor MZ a recarregar automaticamente se estiver aberto.

---

## Segurança e atomicidade

- **Atomic writes**: escrita em arquivo temporário seguido de rename.
- **Auto-backup**: snapshot completo (`data/`, `js/plugins/`, `js/plugins.js`, `mz-mcp.config.json`) antes de operações destrutivas.
- **Lock detection**: detecta se o editor MZ está aberto (via processo `RPGMZ.exe`) e pode emitir aviso (`warn`), bloquear (`block`) ou ignorar (`ignore`) — configurável.
- **Undo transacional**: `project_undo_last_change` restaura o último snapshot.
- **Note field opaco**: o campo `note` (usado por plugins de terceiros) é preservado byte-por-byte.
- **Validação Zod**: toda escrita valida o payload contra schema antes de tocar o disco.
- **Companion local-only**: a bridge WebSocket aceita conexões apenas em `127.0.0.1` e requer token de autenticação compartilhado (gerado uma vez e salvo em `.mz-mcp/companion.token`).
- **Inspect sem eval**: `runtime_inspect` faz dot-walk seguro em path tipo `$gameParty._gold` sem executar código arbitrário (rejeita parênteses, operadores, etc.).

---

## Múltiplas instâncias simultâneas

Você pode rodar várias sessões de cliente MCP em paralelo (ex.: dois Claudes abertos, ou Claude Desktop + Claude Code). Cada um sobe sua própria instância do MCP server.

| Componente | Porta padrão | Range de fallback |
|---|---|---|
| Companion bridge (WebSocket) | 39872 | 39872-39881 (tenta a próxima livre) |

A porta efetivamente escolhida é escrita em `<project>/.mz-mcp/companion.port`. O `MzMcpCompanion.js` lê esse arquivo no boot do Playtest, então sempre conecta na bridge correta da instância MCP que escreveu por último (geralmente a instância em foco).

---

## Testes

O projeto inclui dois tipos de testes:

### Unit tests (vitest)

```bash
npm test
```

111 testes cobrindo SafeWriter, autotile encoding, parsers de metadata de plugin, schemas Zod, helpers do gerador, error types, mz-codes loader, help links e memória do projeto.

### Smoke tests E2E

Os smoke tests rodam o servidor MCP de verdade contra uma cópia temporária do template padrão do RPG Maker MZ:

```bash
node scripts/smoke-test-phase2.mjs       # Database CRUD
node scripts/smoke-test-phase3.mjs       # Maps & Events
node scripts/smoke-test-phase4.mjs       # Plugins & Assets
node scripts/smoke-test-phase5.mjs       # Extras
node scripts/smoke-test-phase6.mjs       # Runtime (com fake companion)
node scripts/smoke-test-phase7.mjs       # Polish
node scripts/smoke-test-wave-a.mjs       # Sprite/autotile/clean/save helpers
node scripts/smoke-test-wave-b.mjs       # CSV nested, plugin parser, push events
node scripts/smoke-test-wave-c.mjs       # Localization, init variants
node scripts/smoke-test-wave-e.mjs       # Knowledge distillation
node scripts/smoke-test-wave-f.mjs       # Multi-port, map_render, runtime estruturado, integrity checker
node scripts/smoke-test-wave-g.mjs       # Memória persistente + 6 análises semânticas
node scripts/smoke-test-wave-j.mjs       # asset_check_missing_references + event_validate_structure (defeitos injetados)
node scripts/smoke-test-wave-k.mjs       # event_check_references + text_replace_all + event_template_shop (defeitos injetados)
```

Há também `scripts/smoke-test.mjs` (Fase 1 — núcleo) — 15 smoke tests no total. Vários deles **injetam defeitos de propósito** (asset fantasma, lista de comando corrompida, referência quebrada) e confirmam que as ferramentas de diagnóstico os detectam — provando que não dão falso negativo.

---

## Estrutura do projeto

```
rpg-maker-mz-mcp/
├── src/
│   ├── index.ts                  # entrada do servidor MCP
│   ├── config.ts                 # carregamento de configuração
│   ├── core/                     # SafeWriter, lock-detect, version-bump, backup,
│   │                             # map-renderer, integrity-checker, ...
│   ├── schemas/                  # schemas Zod para todos os tipos do MZ
│   ├── data/                     # 7 catálogos JSON (codes, notetags, formulas)
│   ├── tools/                    # 28 categorias de ferramentas MCP
│   ├── runtime/                  # bridge WebSocket para companion
│   └── utils/                    # logger, errors, help-link
├── companion-src/
│   └── MzMcpCompanion.js         # plugin in-game (handlers + 11 push event hooks)
├── tests/unit/                   # 111 unit tests (vitest)
├── scripts/                      # 15 smoke tests E2E + helpers de build
├── dist/                         # output compilado (após npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Resolução de problemas

| Problema | Causa provável | Solução |
|---|---|---|
| Servidor não inicia | `MZ_PROJECT_PATH` não definido | Definir a variável de ambiente apontando para o projeto MZ |
| `MZ install not detected` | Instalação MZ fora dos caminhos canônicos | Definir `MZ_INSTALL_PATH` ou `mz.installPath` no config |
| `rpgmpacker not found` | CLI não instalado | Baixar de github.com/erri120/rpgmpacker e adicionar ao PATH |
| Companion não conecta | Plugin não habilitado em `plugins.js` ou Playtest não iniciado | Verificar via `runtime_status`; reinstalar com `companion_install` |
| Edição com editor aberto causa conflito | MZ editor cacheia dados em memória | Fechar o editor antes de operações grandes, ou usar `editor.onLock: "block"` |
| Tile data parece incorreta | Tile IDs específicos do tileset configurado | Consultar `tileset_get_flags_decoded` e `event_command_describe` |
| Duas instâncias MCP em conflito | Companion não consegue decidir qual MCP conectar | Fechar uma das instâncias; a outra escreve `companion.port` correto |
| Screenshot com erro `Invalid typed array length` | Plugin de terceiros adiciona sprites com bounds gigantes | Já mitigado: companion usa RenderTexture com tamanho fixo da tela. Atualizar o `MzMcpCompanion.js` se vier de versão antiga. |

---

## Limitações conhecidas

Para ser transparente sobre o que o MCP **não** faz hoje:

- **Autotile rendering em `map_render`**: tiles das categorias A1-A4 são renderizados com shape 0 (forma base), sem encoding completo de borda/canto (shapes 1-47). Mapas com muitas autotiles podem aparecer com tiles visualmente incompletos no preview. Não afeta o jogo em si — só a renderização visual. O `procgen` usa autotile encoding correto na geração.
- **Battle simulation**: não há simulador de combate fora do jogo. Pra testar balanceamento, é preciso entrar em batalha real via Playtest (o agente pode forçar via `runtime_force_battle`).
- **Plugin sandbox**: validação de plugin cobre sintaxe via AST, mas não executa o plugin em ambiente isolado. Plugins ruins ainda precisam ser detectados ao reabrir o Playtest.
- **MV (RPG Maker MV)**: o projeto é MZ-only. MV tem divergências menores que poderiam ser cobertas, mas não estão no escopo.

---

## Roadmap

### Implementado (v1.0.0)

- 193 ferramentas em 28 categorias
- 111 unit tests + 15 smoke tests E2E
- **asset_check_missing_references** — detecta assets referenciados que faltam no disco (missing + case_mismatch)
- **event_validate_structure** — valida estrutura de command lists (terminador, indent, blocos fechados)
- **event_check_references** — valida o que comandos apontam (transfer→mapa, call→common event, switch/var range, battle→troop, escape codes \V[n]/\N[n])
- **text_replace_all** — busca/substitui texto em todos os diálogos do projeto (dry-run + snapshot)
- **event_template_shop** — template de loja (Shop Processing 302/605)
- **runtime_get_console_log** — captura erros/warnings do jogo durante Playtest (crashes de plugin)
- **Map Flow Analysis** (`analysis_map_flow`) — grafo de fluxo de mapas com detecção de unreachable/orphan/dead-end
- **Battle Simulation** (`runtime_simulate_battle`) — simulação offline no engine real, respeita plugins customizados
- Sprite composition via jimp
- Autotile encoding em procgen
- Catálogos de event commands, effects, traits, tileset flags
- Catálogos da comunidade (notetags, plugin compat, damage formulas)
- Runtime com queries estruturadas (alternativa a `eval_js`)
- Runtime com 11 tipos de push events
- Screenshot via PIXI RenderTexture (sem estouro de memória)
- Map render visual (`map_render`) com conteúdo de imagem nativo
- Database integrity checker (`db_check_consistency`)
- Múltiplas instâncias simultâneas (multi-port)
- CSV com campos aninhados
- Save edit com helpers semânticos
- **Memória persistente do projeto** (`project_memory_*`) — 7 categorias, multi-agent safe
- **Análises semânticas** (`analysis_*`) — 7 análises com cache mtime-based (NPC dialogue, switch/var graph, item economy, skill distribution, enemy appearances, tileset usage)

### Considerado para futuras versões

- Autotile shape encoding 1-47 no `map_render` (preview visual mais fiel)
- Inspector visual de mapa interativo (clicar num tile mostra ID + flags)
- Suporte a RPG Maker MV (catálogos têm divergências menores)
- Integração direta com Translator++ via CLI

---

## Contribuindo

Contribuições são bem-vindas. Antes de abrir um pull request:

1. `npm run typecheck` deve passar sem erros
2. `npm test` deve passar 100% (atualmente 100 testes)
3. Adicionar testes para novas funcionalidades
4. Smoke tests E2E para mudanças que afetam fluxos completos

---

## Créditos

**Autor:** Newton Alves
**Produto:** RPG Maker MZ - MCP Ultimate
**Versão:** 1.0.0
**Para:** RPG Maker MZ (KADOKAWA Corporation)

Este projeto não é afiliado oficialmente à KADOKAWA. Os arquivos lidos da instalação do RPG Maker MZ (`corescript/`, `newdata/`, `samplemaps/`, `generator/`, `dlc/`, `help-en/`) pertencem ao usuário que possui licença válida do produto.

---

## Licença

MIT License — veja [LICENSE](LICENSE) para detalhes completos.
