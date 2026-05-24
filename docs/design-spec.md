# `mz-mcp` — Servidor MCP de Controle Total para RPG Maker MZ

**Versão do design**: 1.0 (2026-05-23)
**Próximo passo após aprovação**: invocar skill `writing-plans` para gerar plano de implementação faseado.

---

## 1. Contexto

O usuário está criando um jogo no **RPG Maker MZ** e quer um agente de IA (Claude Code) com **controle total** sobre o projeto: criar e editar personagens (Actors), classes, habilidades, itens, inimigos, grupos de batalha (Troops), estados, animações, tilesets, mapas (incluindo tiles e eventos), Common Events, switches, variáveis, configurações de sistema, e — crucialmente — também **escrever plugins JavaScript do zero**, importar assets com validação rigorosa, fazer builds cross-platform, traduzir conteúdo, e inspecionar/mexer no jogo enquanto ele está rodando.

Já existem dois MCPs públicos pra MZ (`devmagary/MCP-Maker`, `k4zuki0539/rpgmaker-mz-mcp`) mas ambos são puramente file-based, têm cobertura parcial (faltam Common Events, Troops, Animations, autoria de plugins, validação rigorosa de assets, runtime ao vivo, etc.). O `mz-mcp` será um super-set comprehensive, projetado pra:

- **Cobrir 100% da superfície customizável do MZ** (16+ tipos de dados, 40+ event commands, plugins, assets, system, switches/variáveis)
- **Aproveitar a instalação local do RPG Maker MZ** (`corescript/`, `newdata/`, `samplemaps/`, `generator/`, `dlc/`, `help-en/`)
- **Combinar edição estática (arquivos) e ao vivo (companion plugin no jogo)** numa arquitetura híbrida
- **Garantir segurança e atomicidade por padrão** (SafeWriter, backups automáticos, detecção de editor aberto)

O usuário **não é programador**. A comunicação e UX precisam ser acessíveis — mensagens de erro claras, validação preventiva, defaults seguros, deep-links pra ajuda local quando aplicável.

---

## 2. Visão geral

### As 3 peças

| Peça | O que é | O que faz |
|---|---|---|
| **`mz-mcp`** (servidor) | Processo TypeScript rodando localmente (`stdio` MCP) | Lê e edita JSONs/JS do projeto MZ; expõe ~150 tools |
| **Projeto MZ** | Pasta do jogo do usuário (`data/`, `js/`, `img/`, `audio/`, `game.rmmzproject`) | Onde o estado do jogo mora |
| **`MzMcpCompanion.js`** | Plugin opcional dentro do jogo MZ | Abre WebSocket localhost quando o jogo está rodando, permite queries/ações ao vivo |

### Os 2 modos

- **Modo edição (jogo fechado)**: agente pede coisas → `mz-mcp` edita arquivos com SafeWriter + atomic + backup; força reload do editor MZ via `System.json.versionId` bump
- **Modo runtime (jogo aberto/playtest)**: companion conecta via WS local → agente faz queries (HP, switches, variáveis, save state) e ações (transfer, set switch, hot reload, screenshot)

### Diferencial vs MCPs existentes

Database completo (16+ tipos), 40+ event commands com templates, Common Events, Troops, Animations, plugin authoring (escrever do zero), SafeWriter + atomicidade + versionId bump, asset import com validação de formato, detecção de editor aberto, runtime plugin via WS, validação Zod a partir de tipagens TS oficiais do MZ, busca cross-database, undo transacional via snapshots.

---

## 3. Arquitetura

```
   Agente IA (Claude Code / Claude Desktop)
            │ MCP protocol (stdio)
            ▼
       mz-mcp (TypeScript)
       ┌──────────────────────────────────────┐
       │ Tools (18 categorias, ~150 tools)    │
       ├──────────────────────────────────────┤
       │ Core: SafeWriter, Lock, VersionBump, │
       │ Backup, Project, Config              │
       ├──────────────────────────────────────┤
       │ Schemas (Zod gerados de @comuns TS)  │
       ├──────────────────────────────────────┤
       │ Runtime Bridge (WebSocket client)    │
       └──────────────────────────────────────┘
            │                          │
            ▼ R/W arquivos             ▼ WS localhost (opcional)
       Projeto MZ                MzMcpCompanion.js
       (data/, js/, img/,        (no jogo rodando)
        audio/)
            │
            └─► Instalação MZ usada como referência:
                C:\Program Files (x86)\Steam\steamapps\
                  common\RPG Maker MZ\
                  ├─ corescript/v1.6.0/       (engine TS truth)
                  ├─ newdata/                 (template scaffold)
                  ├─ samplemaps/              (293 mapas de seed)
                  ├─ generator/               (sprite gen)
                  ├─ dlc/                     (plugins bundled)
                  └─ help-en/                 (HTML help deep-links)
```

---

## 4. Catálogo de tools — 18 categorias, ~150 tools

### Princípios

1. **Generic + Specialized**: `db_create("actor", {...})` E `actor_create(name, classId, level, ...)`.
2. **Templates pra event commands**: `event_command_add_generic` + templates pros 7 mais usados (Show Text/101, Show Choices/102, Input Number/103, Conditional/111, Transfer/201, Battle/301, Play SE/250).
3. **Validação por padrão**: schema Zod antes de tocar disco; mensagens linkam `help-en/`.
4. **Tools `runtime_*` segregadas**: falham com mensagem clara se companion não conectado.
5. **Dry-run em operações destrutivas**: `mz_build`, `db_import_csv`, `mz_import_translations`, `procgen_*`, `mz_clean_unused_assets` aceitam `dryRun: true`.
6. **Note field é OPACO**: escrita byte-por-byte; nunca reformatar nem parsear conteúdo.

### Tabela das 18 categorias

| # | Categoria | Qtd | Exemplos representativos |
|---|---|---|---|
| 1 | **Database CRUD** | ~25 | `db_list`, `db_get`, `db_create`, `db_update`, `db_delete`, `db_search`; helpers: `actor_create`, `skill_create_damage`, `skill_create_healing`, `enemy_create_balanced(level, role)` |
| 2 | **Maps & Tiles** | ~12 | `map_create`, `map_list`, `map_get`, `map_set_properties`, `map_tile_set`, `map_tile_fill_rect`, `map_layer_clear`, `map_set_battleback`, `map_set_bgm` |
| 3 | **Events** | ~20 | `event_create`, `event_list_in_map`, `event_move`, `event_page_add`, `event_page_set_trigger`, `event_command_add_generic`, `event_template_dialogue`, `event_template_choices`, `event_template_conditional`, `event_template_transfer`, `event_template_battle` |
| 4 | **Troops & Battles** | ~8 | `troop_create`, `troop_set_layout`, `troop_member_add`, `troop_battle_event_add`, `battle_action_pattern_set` |
| 5 | **Plugins** | ~12 | `plugin_list_installed`, `plugin_install_from_file`, `plugin_install_from_url`, `plugin_install_from_dlc`, `plugin_uninstall`, `plugin_enable`, `plugin_disable`, `plugin_reorder`, `plugin_set_param`, `plugin_create_new`, `plugin_update_code`, `plugin_validate_metadata` |
| 6 | **Switches & Variables** | ~6 | `switch_list`, `switch_rename`, `switch_search_uses`, `variable_list`, `variable_rename`, `variable_search_uses` |
| 7 | **Assets** | ~14 | `asset_list("character")`, `asset_import("character", path)`, `asset_validate_format`, `asset_delete`, `asset_organize`, `asset_get_info`, `audio_import_bgm/bgs/me/se`, `audio_list` |
| 8 | **System** | ~7 | `system_get`, `system_update_title`, `system_update_terms`, `system_update_currency`, `system_update_starting_position`, `system_update_party`, `system_update_window_tone` |
| 9 | **DB ↔ CSV** | ~3 | `db_export_csv(category)`, `db_import_csv(category, csv, dryRun?)`, `db_diff_csv` |
| 10 | **Build & Deploy** | ~3 | `mz_build(platforms, output, encryptAudio, encryptImages)` (rpgmpacker wrapper), `mz_validate_project`, `mz_clean_unused_assets` |
| 11 | **Localização** | ~3 | `mz_extract_translatable_text(format: "translator++")`, `mz_import_translations(file)`, `mz_localization_coverage` |
| 12 | **Saves** | ~3 | `save_read(path)`, `save_edit(path, patch)`, `save_create_test_state` |
| 13 | **Procgen** | ~3 | `procgen_dungeon(algo, w, h, seed, tilesetId, sampleFrom?)`, `procgen_cave`, `procgen_outdoor` |
| 14 | **Runtime** (companion) | ~12 | `runtime_status`, `runtime_get_player_state`, `runtime_get_actor_state`, `runtime_get_switch`, `runtime_set_switch`, `runtime_get_variable`, `runtime_set_variable`, `runtime_call_common_event`, `runtime_force_battle`, `runtime_transfer_player`, `runtime_eval_js` (opt-in), `runtime_hot_reload(scope)`, `runtime_screenshot` |
| 15 | **Project utils** | ~6 | `project_init(template: "newdata" \| "newdata-1" \| ...)`, `project_get_info`, `project_lock_check`, `project_backup_create`, `project_restore_from_backup`, `project_undo_last_change` |
| 16 | **Character Generator** (usa `generator/` da instalação) | ~5 | `actor_sprite_generate({face, hair, eyes, skin, accessories, ...})`, `actor_face_generate`, `actor_battler_generate_sv`, `generator_list_parts`, `generator_preview` |
| 17 | **MZ install integration** | ~4 | `mz_install_detect_path`, `mz_install_get_corescript_path(version?)`, `mz_install_list_dlc_plugins`, `mz_install_get_help_url(topic)` |
| 18 | **Sample maps library** (usa `samplemaps/`) | ~3 | `samplemaps_list`, `samplemaps_clone_to_project(id, newId)`, `samplemaps_search_by_features(tags)` |

**Total: ~150 tools** (25+12+20+8+12+6+14+7+3+3+3+3+3+12+6+5+4+3 = 149 com estimativas conservadoras).

### Exemplos de fluxos completos

**"Cria 3 inimigos de gelo level 12-15, que dropam itens de cura":**
```
enemy_create_balanced(level=12, role="elemental_ice") → enemyId=42
enemy_create_balanced(level=13, role="elemental_ice")  → enemyId=43
enemy_create_balanced(level=15, role="elemental_ice_boss") → enemyId=44
db_update("enemy", 42, {dropItems:[{kind:"item", dataId:potionId, denominator:3}]})
db_update("enemy", 43, {dropItems:[...]})
db_update("enemy", 44, {dropItems:[...]})
troop_create("Trio de Gelo", members:[
  {enemyId:42, x:200, y:300}, {enemyId:43, x:400, y:300}, {enemyId:44, x:600, y:300}
])
```

**"Adiciona diálogo 'Olá, viajante!' no NPC do mapa 5":**
```
event_search(map=5, name_contains="npc") → eventId=3
event_template_dialogue(map=5, eventId=3, page=1,
  faceName="Actor1", faceIndex=0,
  text="Olá, viajante! Está procurando aventura?")
```

**"Cria um plugin de barra de stamina":**
```
plugin_create_new(name="StaminaBar", metadata={
  target:"MZ", base:"VisuMZ_0_CoreEngine",
  plugindesc:"Barra de stamina",
  params:[{name:"maxStamina", type:"number", default:100,
           text:"Stamina máxima", desc:"..."}],
  commands:[{name:"setStamina", args:[{name:"value", type:"number"}]}]
}, code="/* implementation */")
plugin_validate_metadata("StaminaBar")
plugin_enable("StaminaBar")
```

**"Build pra Windows e Web criptografando áudio":**
```
project_validate()
mz_build(platforms=["windows","web"], output="./dist",
         encryptAudio=true, encryptionKey="auto")
```

**Durante playtest — "Que HP a Marina tá? Coloca em 1":**
```
runtime_status() → connected
runtime_get_actor_state(actorId=marinaId) → {hp:230, mp:80, ...}
runtime_set_actor_hp(actorId=marinaId, value=1)
```

---

## 5. Schemas e validação

### Fonte de verdade

1. **Tipagens TS do MZ**: `@comuns-rpgmaker/rpg-maker-mz-typescript` (npm). Fallback: `niokasgami/Rpg-Maker-MZ-Typescript`.
2. **Schema de plugin metadata**: `comuns-rpgmaker/plugin-metadata` (JSON Schema canônico).
3. **Validação cruzada contra dado real**: arquivos em `<install>/newdata/data/*.json` e `<install>/samplemaps/Map###.json` confirmam shape esperado.
4. **Engine core**: `<install>/corescript/v1.6.0/rmmz_objects.js` define classes `Game_*`; consultado quando há ambiguidade.

### Estratégia Zod

- Schemas Zod escritos manualmente espelhando os tipos TS oficiais (não geração automática — manter explícito)
- Cada categoria de dado em `src/schemas/data/{actor,class,skill,...}.ts`
- Validação no boundary: **toda** chamada de tool valida input com Zod antes de qualquer I/O
- Validação de saída opcional (defesa em profundidade)

### Regra do `note` field

- Campo `note` é **opaco**: armazenado/escrito byte-por-byte, sem reformatar
- Tools que mutam um record preservam o `note` se não for tocado
- Tool dedicada `note_get(category, id)` retorna o conteúdo bruto
- Tool dedicada `note_set(category, id, content)` substitui inteiro (com snapshot)
- Tool `note_search(category, query)` faz substring/regex search

---

## 6. Companion plugin — protocolo

### Setup

- Arquivo: `MzMcpCompanion.js` instalado em `<project>/js/plugins/` via tool `companion_install`
- Plugin auto-registra no `plugins.js` do projeto
- No boot do jogo: lê token de `<project>/.mz-mcp/companion.token`, escolhe porta aleatória, escreve em `<project>/.mz-mcp/companion.port`, abre WS server `localhost:<port>`

### Protocolo

- **Transport**: WebSocket localhost, JSON-RPC 2.0
- **Auth**: token compartilhado via arquivo (gerado pelo `mz-mcp` no setup, ignorado pelo git)
- **Handshake**: cliente envia `{method:"hello", params:{token, clientVersion}}` → servidor responde `{protocolVersion, serverVersion}`
- **Versionamento**: campo `protocolVersion` em cada mensagem; rejeita versões incompatíveis
- **Heartbeat**: ping a cada 30s; reconexão automática com backoff exponencial
- **Métodos suportados** (espelham as runtime_* tools):
  - `getState(scope)` — player, party, map, switches, vars, system
  - `setSwitch(id, value)`, `setVariable(id, value)`, `setSelfSwitch(eventId, slot, value)`
  - `setActorHp(actorId, value)`, `setActorMp(actorId, value)`
  - `callCommonEvent(id)`, `forceBattle(troopId)`, `transferPlayer(mapId, x, y)`
  - `evalJs(code)` — só responde se config `enableEvalJs: true`
  - `hotReload(scope)` — recarrega data files / plugins ativos
  - `screenshot()` — retorna PNG base64

### Segurança

- WS bind em `127.0.0.1` apenas (nunca `0.0.0.0`)
- Token obrigatório no handshake; sem token = recusa
- `evalJs` opt-in via config (default OFF)
- Logs de auditoria pra todas as chamadas mutadoras

---

## 7. Safety, atomicidade, backup

### SafeWriter

Pattern (inspirado no `MCP-Maker`):

```
1. Verifica lock do editor (lockfile + process check); se aberto:
   - onLock="warn" (default): registra warning, continua
   - onLock="block": recusa escrita
2. Lê arquivo original
3. Aplica patch em memória, valida via Zod
4. Escreve em `<file>.tmp` (na mesma pasta — atomic rename precisa de mesmo volume)
5. Copia `<file>` → `<file>.bak` (rotaciona últimos 10)
6. Rename atômico `<file>.tmp` → `<file>`
7. Bump `data/System.json.versionId` (incrementa) — força editor MZ a recarregar
8. Log da operação em `.mz-mcp/operations.log`
```

### Auto-backup

- Snapshot do que pode ser destruído (`data/` + `js/plugins/` + `js/plugins.js` + `mz-mcp.config.json`) antes de operações destrutivas
- Salvo em `.mz-mcp/backups/<ISO timestamp>/`
- Retenção: últimos N (default 20, configurável)
- Operações destrutivas: `db_delete`, `map_delete`, `db_import_csv`, `mz_clean_unused_assets`, `procgen_*` quando overwrite, `event_delete`, `plugin_uninstall`, `companion_uninstall`, `project_restore_from_backup`
- Tool `project_undo_last_change` reverte usando o último snapshot

### Detecção de editor aberto

- Check 1: arquivo lock-style do MZ (se existir)
- Check 2: processo `RPGMZ.exe` rodando (Windows: `Get-Process`, Mac: `pgrep`, Linux: idem)
- Check 3: timestamp recente de modificação no `<project>/.git` se houver
- Decisão por config `editor.onLock`: `warn` (default), `block`, `ignore`

---

## 8. Integração com a instalação MZ

### Detecção da instalação

Tool `mz_install_detect_path` busca em ordem:
1. Env var `MZ_INSTALL_PATH`
2. Caminhos canônicos por OS:
   - Windows: `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ`
   - Mac: `/Applications/RPG Maker MZ.app`
   - Linux: via Steam library (`~/.steam/steam/steamapps/common/RPG Maker MZ`)
3. Steam config (`config.vdf`)
4. Falha graciosa: tools de instalação retornam erro útil; demais tools funcionam normalmente

### Uso da instalação

- **`corescript/v1.6.0/` (configurável)**: source of truth do engine, consultado pra validar shapes não documentadas
- **`newdata/`, `newdata-1/`, `newdata-2/`, `newdata-3/`**: templates pra `project_init` escolher
- **`samplemaps/` (293 mapas)**: biblioteca pra `samplemaps_*` tools e seed do `procgen_*`
- **`generator/`**: parts (Face, SV, TV, TVD, Variation) usadas pelo `actor_sprite_generate`
- **`dlc/`**: catálogo de plugins bundled pra `plugin_list_dlc` e `plugin_install_from_dlc`
- **`help-en/`**: páginas HTML linkadas em mensagens de erro/ajuda do MCP (deep-links)

---

## 9. Estrutura do projeto `mz-mcp`

```
mz-mcp/
├── package.json, tsconfig.json, README.md, LICENSE
├── .gitignore (inclui .mz-mcp/)
├── src/
│   ├── index.ts                  # MCP server entry
│   ├── config.ts                 # carrega env vars + config.json
│   ├── core/
│   │   ├── safe-writer.ts
│   │   ├── lock-detect.ts
│   │   ├── version-bump.ts
│   │   ├── backup.ts
│   │   ├── project.ts            # acha pasta do projeto, valida estrutura
│   │   └── mz-install.ts         # acha pasta de instalação MZ
│   ├── schemas/
│   │   ├── data/                 # actor.ts, class.ts, skill.ts, item.ts,
│   │   │                         # weapon.ts, armor.ts, enemy.ts, troop.ts,
│   │   │                         # state.ts, animation.ts, tileset.ts,
│   │   │                         # common-event.ts, system.ts, map.ts,
│   │   │                         # map-infos.ts
│   │   ├── events/               # event-command.ts (40+ tipos)
│   │   ├── plugin-metadata.ts    # do comuns-rpgmaker
│   │   └── runtime.ts            # mensagens JSON-RPC do companion
│   ├── tools/                    # 18 pastas (uma por categoria)
│   │   ├── database/
│   │   ├── maps/
│   │   ├── events/
│   │   ├── troops/
│   │   ├── plugins/
│   │   ├── switches/
│   │   ├── assets/
│   │   ├── system/
│   │   ├── csv/
│   │   ├── build/
│   │   ├── localization/
│   │   ├── saves/
│   │   ├── procgen/
│   │   ├── runtime/
│   │   ├── project/
│   │   ├── generator/
│   │   ├── mz-install/
│   │   └── samplemaps/
│   ├── runtime/
│   │   ├── bridge.ts             # WebSocket client → companion
│   │   ├── protocol.ts           # JSON-RPC framing
│   │   └── auth.ts               # token handshake
│   ├── plugin-authoring/
│   │   ├── metadata-gen.ts       # gera JSDoc block a partir de Zod schema
│   │   ├── code-templates/       # blank.ts, visustella.ts, command-only.ts
│   │   └── validator.ts          # roda eslint + acorn no plugin gerado
│   ├── csv/
│   │   └── codec.ts              # serialize/deserialize JSON ↔ CSV
│   └── utils/
│       ├── logger.ts
│       ├── errors.ts             # erros tipados c/ links pra help-en
│       └── help-link.ts          # mapeia topic → help-en URL
├── companion-src/
│   ├── MzMcpCompanion.js         # plugin que vai no projeto MZ
│   ├── ws-server.js              # WS local
│   ├── handlers.js               # implementação dos métodos
│   ├── auth.js                   # validação de token
│   └── metadata.yaml             # source do JSDoc block
├── templates/
│   └── plugins/                  # blank, visustella, etc.
├── tests/
│   ├── fixtures/
│   │   └── sample-project/       # MZ project pequeno pra testes
│   ├── unit/
│   └── integration/
└── docs/
    ├── setup.md
    ├── tools-reference.md
    ├── runtime-protocol.md
    └── troubleshooting.md
```

---

## 10. Setup e configuração

### Instalação

```bash
npm install -g @<your-namespace>/mz-mcp
# ou usar via npx sem instalação global
```

### Variáveis de ambiente

- `MZ_PROJECT_PATH` — caminho absoluto pro projeto MZ (obrigatório)
- `MZ_INSTALL_PATH` — caminho da instalação RPG Maker MZ (opcional, auto-detect)
- `MZ_MCP_CONFIG` — caminho pro `mz-mcp.config.json` (opcional, default: `<project>/mz-mcp.config.json`)

### Config (`mz-mcp.config.json`)

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
    "knownBases": {
      "visuStella": "VisuMZ_0_CoreEngine"
    }
  },
  "logging": {
    "level": "info",
    "file": ".mz-mcp/mz-mcp.log"
  }
}
```

### Setup do cliente MCP (Claude Code `mcp.json`)

```json
{
  "mcpServers": {
    "mz-mcp": {
      "command": "npx",
      "args": ["-y", "@<your-namespace>/mz-mcp"],
      "env": {
        "MZ_PROJECT_PATH": "C:\\Users\\Admin\\Documents\\Games\\MeuJogo"
      }
    }
  }
}
```

### Setup do companion

- Pelo agente: *"instala o companion no meu projeto"* → tool `companion_install`
- Manualmente: copiar `MzMcpCompanion.js` pra `<project>/js/plugins/` e registrar em `plugins.js`

---

## 11. Faseamento da implementação (sugestão pro `writing-plans`)

| Fase | Conteúdo | Critério de pronto |
|---|---|---|
| **1. Núcleo** | Server, config, SafeWriter, lock-detect, version-bump, backup, project loader, mz-install detect | Roda `mz_install_detect_path` e `project_get_info` corretamente |
| **2. Database** | 25 CRUD tools (Actors → CommonEvents), schemas Zod pros 15 tipos de dados + família de event commands | `actor_create`, `enemy_create_balanced` funcionam end-to-end |
| **3. Maps & Events** | Maps, Tiles, Events, Troops (~40 tools), templates de event command | Cria mapa novo + adiciona NPC com diálogo funcional |
| **4. Plugins & Assets** | Plugin install + author + validate; asset import com validação de formato; System tools | Gera plugin que compila no MZ; importa sprite 576×384 |
| **5. Extras 1** | Switches/Vars, DB↔CSV, Build (rpgmpacker), Localização, Saves | Export DB → CSV → re-import; build pra Windows roda |
| **6. Runtime** | `MzMcpCompanion.js` + bridge WS + 12 runtime tools | Conecta no playtest e responde queries |
| **7. Polish** | Procgen, project utils (init, undo), generator, samplemaps, mz-install, help links | `project_init` cria projeto novo a partir de `newdata-2/`; help links funcionam |

---

## 12. Verificação

### Testes automatizados

- **Unit** (`tests/unit/`): SafeWriter (atomicidade, recuperação de falha), Zod schemas, parsers de plugin metadata, CSV codec, error-link mapper
- **Integration** (`tests/integration/`): contra `tests/fixtures/sample-project/` (projeto MZ pequeno versionado). Cada tool tem ao menos 1 happy path + 1 erro esperado
- **Property-based** (opcional): pra `procgen_*`, fuzz com seeds aleatórias e validar que mapas gerados passam schema

### Validação manual

1. Instalar `mz-mcp` no Claude Code do dev
2. Apontar pra um projeto MZ de teste (criado via `project_init`)
3. Executar prompts canônicos:
   - "Cria personagem Marina, classe Maga nível 5"
   - "Adiciona diálogo no NPC do mapa 1"
   - "Cria 3 inimigos balanceados level 10"
   - "Build pra Windows"
   - "Instala o companion"
4. Abrir o MZ editor — confirmar que mudanças apareceram, sem corrupção
5. Iniciar Playtest — companion conecta — queries `runtime_*` funcionam
6. Comparação cruzada com `MCP-Maker` e `rpgmaker-mz-mcp` (mesmos prompts, conferir saídas equivalentes onde aplicável)

### Critérios de aceite

- [ ] Todos os ~150 tools implementados e cobertos por ao menos 1 teste de integração
- [ ] Companion conecta em ≤2s do Playtest start
- [ ] Nenhuma operação corrompe `data/*.json` (validação pré-escrita garante)
- [ ] `project_undo_last_change` recupera qualquer operação destrutiva
- [ ] Auto-detect da instalação MZ funciona em Windows/Mac/Linux

---

## 13. Arquivos críticos / referências externas

### Dependências npm chave

- `@modelcontextprotocol/sdk` — protocolo MCP
- `zod` — validação de schemas
- `@comuns-rpgmaker/rpg-maker-mz-typescript` — tipagens TS do MZ (fallback: `niokasgami/Rpg-Maker-MZ-Typescript`)
- `ws` — WebSocket no servidor pra bridge
- `acorn` — parser AST pra validar plugins gerados
- `eslint` — lint dos plugins gerados (regras MZ-friendly)
- `papaparse` (ou similar) — CSV codec
- `rpgmpacker` — invocado como subprocess pra builds (não dep npm direta — verifica disponibilidade)
- `chokidar` — watch opcional pra detectar mudança externa no projeto

### Referências externas (URLs)

- MCPs anteriores (para aprender padrões):
  - `https://github.com/devmagary/MCP-Maker`
  - `https://github.com/k4zuki0539/-rpgmaker-mz-mcp`
- Tipagens e metadata:
  - `https://github.com/comuns-rpgmaker/plugin-metadata`
  - `https://www.npmjs.com/package/@comuns-rpgmaker/rpg-maker-mz-typescript`
- Build tooling:
  - `https://github.com/erri120/rpgmpacker`
- Docs oficiais:
  - `https://developer.rpgmakerweb.com/rpg-maker-mz/`
  - `https://rpgmakerofficial.com/product/MZ_help-en/`
- Plugin ecosystem:
  - `https://visustellamz.itch.io/` (convenção VisuStella)
  - `https://en.plugin-mz.fungamemake.com/` (catálogo PGMZ)

### Arquivos locais na instalação MZ

- `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ\corescript\v1.6.0\rmmz_objects.js` — runtime classes truth
- `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ\newdata\data\Actors.json` — schema reference do Actor
- `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ\samplemaps\Map001.json` — schema reference do Map
- `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ\generator\` — assets pro character generator
- `C:\Program Files (x86)\Steam\steamapps\common\RPG Maker MZ\help-en\01_*.html` — deep-link targets em mensagens

---

## 14. Riscos e questões abertas

| Risco / Questão | Mitigação / Decisão |
|---|---|
| **Drift de versão do corescript MZ** (v1.6.0 → v1.9.0 introduz mudanças) | Config `mz.corescriptVersion`; testes contra múltiplas versões; nota no README |
| **Mudança de licença/EULA do RPG Maker MZ** (usar `newdata/`, `samplemaps/`, `generator/` em produção) | Esses arquivos pertencem ao USUÁRIO que tem o MZ; `mz-mcp` apenas LÊ e COPIA pro projeto dele (que tem licença). Documentar no README. |
| **Plugins de terceiros (VisuStella etc.) com formato não-padrão** | Validador é permissivo na leitura, estrito na escrita; nunca modifica plugins de terceiros sem autorização explícita |
| **`runtime_eval_js` abuse** | Opt-in via config; logs de auditoria; só funciona em localhost |
| **Concorrência com editor MZ aberto** | `editor.onLock` config; versionId bump força reload; documentar workflow recomendado (fechar MZ pra operações grandes) |
| **Cobertura de event commands incompleta** | Templates cobrem 7 mais comuns; `event_command_add_generic` cobre o resto via params raw |
| **Dependência opcional do `rpgmpacker`** | Detectar disponibilidade; falhar com mensagem clara se faltar; documentar instalação |
| **MZ install não encontrada** (usuário em Linux sem Steam) | Tools de install retornam erro útil; resto do MCP funciona normalmente; `project_init` cai em template embutido como fallback |
| **Performance em projetos grandes** (centenas de mapas, milhares de eventos) | Lazy load por categoria; cache de schemas; ops de busca usam índice em memória |
| **Pacote npm namespace** | Decidir nome final (`@<your-namespace>/mz-mcp`) antes do primeiro publish |

---

## 15. Próximos passos

1. **Usuário revisa este spec** — feedback pra ajustar antes de implementação
2. **Invocar skill `writing-plans`** — gera plano de implementação faseado executável (cada fase com tasks granulares)
3. **Decidir namespace npm e configurar repo** (privado/público, MIT)
4. **Fase 1 (Núcleo)** começa a implementação

