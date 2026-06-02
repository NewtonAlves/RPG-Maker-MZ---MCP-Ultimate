/**
 * Tools de runtime (companion). Cada tool faz uma chamada JSON-RPC pro companion
 * via CompanionBridge.
 *
 * Todas falham com companion_not_connected se o jogo não estiver rodando com
 * MzMcpCompanion.js conectado.
 *
 * Também expõe companion_install (instala o plugin no projeto MZ do usuário).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { getBridge } from '../../runtime/bridge.js';
import { logger } from '../../utils/logger.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';
import { loadPluginsJs, savePluginsJs } from '../../core/plugins-js.js';
import { safeWrite } from '../../core/safe-writer.js';

const COMPANION_NAME = 'MzMcpCompanion';

export function registerRuntimeTools(server: McpServer, config: Config): void {
  // Start bridge (não bloqueia se já started)
  const bridge = getBridge(config);
  bridge.start().catch((err) => {
    logger.warn(`Bridge falhou ao iniciar: ${(err as Error).message}`);
  });

  /* ---------------- companion_install ---------------- */
  server.registerTool(
    'companion_install',
    {
      description:
        'Instala o MzMcpCompanion.js no projeto MZ (copia pra js/plugins/ + registra ' +
        'em plugins.js). Pré-popula o param `token` com o token atual da bridge. ' +
        'Use 1× pra setup, depois inicie Playtest no MZ.',
      inputSchema: z.object({
        enableEvalJs: z
          .boolean()
          .optional()
          .describe('Sobrescreve config.runtime.enableEvalJs'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        // Acha o arquivo MzMcpCompanion.js relativo ao módulo
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        // Em dev (src/tools/runtime/index.ts → ../../../companion-src/)
        // Em build (dist/tools/runtime/index.js → ../../../companion-src/)
        const candidates = [
          path.resolve(__dirname, '..', '..', '..', 'companion-src', 'MzMcpCompanion.js'),
          path.resolve(__dirname, '..', '..', '..', '..', 'companion-src', 'MzMcpCompanion.js'),
        ];
        let companionSource: string | null = null;
        for (const c of candidates) {
          try {
            companionSource = await fs.readFile(c, 'utf-8');
            break;
          } catch {}
        }
        if (!companionSource) {
          throw mzError('file_not_found', `MzMcpCompanion.js não encontrado em ${candidates.join(' OR ')}`);
        }

        const enableEval = args.enableEvalJs ?? config.runtime.enableEvalJs;
        const destPath = path.join(config.project.path, 'js', 'plugins', `${COMPANION_NAME}.js`);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await safeWrite(destPath, companionSource);

        // Registra em plugins.js (com params pré-populados)
        const entries = await loadPluginsJs(config);
        const idx = entries.findIndex((e) => e.name === COMPANION_NAME);
        const newEntry = {
          name: COMPANION_NAME,
          status: true,
          description: 'mz-mcp Companion — WebSocket bridge',
          parameters: {
            port: String(bridge.getPort()),
            token: bridge.getToken(),
            enableEvalJs: String(enableEval),
            verbose: 'false',
          },
        };
        if (idx >= 0) entries[idx] = newEntry;
        else entries.push(newEntry);
        await savePluginsJs(config, entries);

        return {
          installed: true,
          file: destPath,
          port: bridge.getPort(),
          tokenFile: path.resolve(config.project.path, config.runtime.tokenFile),
          enableEvalJs: enableEval,
          message:
            'Companion instalado. Abra o RPG Maker MZ, abra Plugin Manager (Ferramentas > Plugin Manager), confirme MzMcpCompanion habilitado, depois rode Playtest. mz-mcp vai detectar a conexão automaticamente.',
        };
      }),
  );

  /* ---------------- runtime_status -------------------- */
  server.registerTool(
    'runtime_status',
    {
      description:
        'Retorna se o companion está conectado, porta, e info do companion (gameTitle, ' +
        'protocolVersion). Use isso primeiro pra confirmar que o playtest está ativo.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => bridge.getInfo()),
  );

  /* ---------------- runtime_ping ---------------------- */
  server.registerTool(
    'runtime_ping',
    {
      description: 'Envia ping pro companion (verifica RTT). Falha se não conectado.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const t0 = Date.now();
        const pong = (await bridge.call('ping')) as { pong: boolean; t: number };
        return { rttMs: Date.now() - t0, companionTime: pong.t };
      }),
  );

  /* ---------------- runtime_get_state ----------------- */
  server.registerTool(
    'runtime_get_state',
    {
      description:
        'Retorna estado atual do jogo. scope: "all", "player", "party", "map", ' +
        '"switches", "variables", "system". Para switches/variables, retorna só os ' +
        'que têm valor não-default.',
      inputSchema: z.object({
        scope: z
          .enum(['all', 'player', 'party', 'map', 'switches', 'variables', 'system'])
          .default('all'),
      }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('getState', { scope: args.scope })),
  );

  /* ---------------- runtime_get_actor_state ----------- */
  server.registerTool(
    'runtime_get_actor_state',
    {
      description: 'Estado de um actor específico em runtime: HP, MP, level, params, equipment, states, skills.',
      inputSchema: z.object({ actorId: z.number().int().positive() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('getActorState', { actorId: args.actorId })),
  );

  /* ---------------- runtime_get/set_switch ------------ */
  server.registerTool(
    'runtime_get_switch',
    {
      description: 'Lê valor de um switch em runtime.',
      inputSchema: z.object({ id: z.number().int().positive() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('getSwitch', { id: args.id })),
  );
  server.registerTool(
    'runtime_set_switch',
    {
      description: 'Seta valor de um switch em runtime.',
      inputSchema: z.object({ id: z.number().int().positive(), value: z.boolean() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('setSwitch', { id: args.id, value: args.value })),
  );

  /* ---------------- runtime_get/set_variable ---------- */
  server.registerTool(
    'runtime_get_variable',
    {
      description: 'Lê valor de uma variable em runtime.',
      inputSchema: z.object({ id: z.number().int().positive() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('getVariable', { id: args.id })),
  );
  server.registerTool(
    'runtime_set_variable',
    {
      description: 'Seta valor de uma variable em runtime.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        value: z.union([z.number(), z.string()]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => bridge.call('setVariable', { id: args.id, value: args.value })),
  );

  /* ---------------- runtime_set_self_switch ----------- */
  server.registerTool(
    'runtime_set_self_switch',
    {
      description: 'Seta self-switch (A/B/C/D) de um evento no mapa atual.',
      inputSchema: z.object({
        eventId: z.number().int().positive(),
        slot: z.enum(['A', 'B', 'C', 'D']),
        value: z.boolean(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () =>
        bridge.call('setSelfSwitch', { eventId: args.eventId, slot: args.slot, value: args.value }),
      ),
  );

  /* ---------------- runtime_set_actor_hp/mp ----------- */
  server.registerTool(
    'runtime_set_actor_hp',
    {
      description: 'Seta HP de um actor.',
      inputSchema: z.object({ actorId: z.number().int().positive(), value: z.number().int() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('setActorHp', { actorId: args.actorId, value: args.value })),
  );
  server.registerTool(
    'runtime_set_actor_mp',
    {
      description: 'Seta MP de um actor.',
      inputSchema: z.object({ actorId: z.number().int().positive(), value: z.number().int() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('setActorMp', { actorId: args.actorId, value: args.value })),
  );

  /* ---------------- runtime_call_common_event --------- */
  server.registerTool(
    'runtime_call_common_event',
    {
      description: 'Reserva um common event pra executar.',
      inputSchema: z.object({ id: z.number().int().positive() }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('callCommonEvent', { id: args.id })),
  );

  /* ---------------- runtime_force_battle -------------- */
  server.registerTool(
    'runtime_force_battle',
    {
      description: 'Força uma batalha com troopId. canLose opcional (default false).',
      inputSchema: z.object({
        troopId: z.number().int().positive(),
        canLose: z.boolean().default(false),
      }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('forceBattle', { troopId: args.troopId, canLose: args.canLose })),
  );

  /* ---------------- runtime_transfer_player ----------- */
  server.registerTool(
    'runtime_transfer_player',
    {
      description: 'Move o jogador pra um mapId/x/y.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        direction: z.number().int().min(0).max(8).default(0),
        fadeType: z.number().int().min(0).max(2).default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () =>
        bridge.call('transferPlayer', { mapId: args.mapId, x: args.x, y: args.y, direction: args.direction, fadeType: args.fadeType }),
      ),
  );

  /* ---------------- runtime_eval_js (opt-in) ---------- */
  server.registerTool(
    'runtime_eval_js',
    {
      description:
        '⚠️ Executa JS arbitrário no contexto do jogo. SÓ funciona se enableEvalJs ' +
        'estiver true no companion. Use pra debug avançado: scripts pequenos que ' +
        'retornam um valor inspecionável.',
      inputSchema: z.object({
        code: z.string().min(1).describe('Expressão JS que retorna um valor.'),
      }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('evalJs', { code: args.code })),
  );

  /* ---------------- runtime_hot_reload ---------------- */
  server.registerTool(
    'runtime_hot_reload',
    {
      description:
        'Recarrega assets sem reiniciar o jogo. scope: "data" recarrega database files; ' +
        '"map" força reload do mapa atual.',
      inputSchema: z.object({
        scope: z.enum(['data', 'map']).default('data'),
      }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('hotReload', { scope: args.scope })),
  );

  /* ---------------- runtime_screenshot ---------------- */
  server.registerTool(
    'runtime_screenshot',
    {
      description:
        'Captura screenshot do canvas do jogo (via PIXI extract — funciona com WebGL). ' +
        'Retorna a imagem como content type "image" (Claude vê nativamente como multimodal) ' +
        'em vez de string base64 em texto.',
      inputSchema: z.object({}).shape,
    },
    async () => {
      try {
        const result = (await bridge.call('screenshot')) as {
          ok: boolean;
          dataUrl?: string;
          method?: string;
          error?: string;
        };
        if (!result.ok || !result.dataUrl) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { error: 'screenshot_failed', message: result.error ?? 'unknown' },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        // Extrai base64 puro (sem o prefixo "data:image/png;base64,") + identifica mime
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(result.dataUrl);
        const mimeType = match?.[1] ?? 'image/png';
        const data = match?.[2] ?? result.dataUrl;
        return {
          content: [
            {
              type: 'image' as const,
              data,
              mimeType,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { error: 'screenshot_call_failed', message: (err as Error).message },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  /* ---------------- runtime_get_scene_state ---------------- */
  server.registerTool(
    'runtime_get_scene_state',
    {
      description:
        'Retorna nome da Scene_* atual + propriedades relevantes (mapId/playerXY pra Map; troopId/phase/subject pra Battle; menuCommand pra Menu). Alternativa SEGURA a eval_js.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => bridge.call('getSceneState')),
  );

  /* ---------------- runtime_get_window_state ---------------- */
  server.registerTool(
    'runtime_get_window_state',
    {
      description:
        'Lista Windows visíveis na Scene atual com type, position, size, index selecionado, currentSymbol.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => bridge.call('getWindowState')),
  );

  /* ---------------- runtime_get_battle_state ---------------- */
  server.registerTool(
    'runtime_get_battle_state',
    {
      description:
        'Estado detalhado de batalha: phase, turn, subject ativo, party/troop alive com HP/MP, log de ações. Retorna inBattle:false se não está em batalha.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => bridge.call('getBattleState')),
  );

  /* ---------------- runtime_get_message_state ---------------- */
  server.registerTool(
    'runtime_get_message_state',
    {
      description:
        'Se mensagem está sendo mostrada: text, faceName/Index, background, position, choices.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => bridge.call('getMessageState')),
  );

  /* ---------------- runtime_inspect ---------------- */
  server.registerTool(
    'runtime_inspect',
    {
      description:
        'Lê uma propriedade do contexto do jogo via dot-walk SEGURO (sem eval). ' +
        'Path aceita identifiers e [N] pra arrays. Ex: "$gameParty._gold", "$gameActors._data[1]._level". ' +
        'Alternativa segura a runtime_eval_js — não executa código, só navega objetos.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Path tipo "$gameParty._gold"'),
      }).shape,
    },
    async (args) => mcpReturn(async () => bridge.call('inspectPath', { path: args.path })),
  );

  /* ---------------- runtime_simulate_battle ---------------- */
  server.registerTool(
    'runtime_simulate_battle',
    {
      description:
        'Simula uma batalha COMPLETA OFFLINE no companion sem afetar o gameplay real. ' +
        'Clona party + troop, roda auto-attack por turnos até alguém ganhar/perder. ' +
        'Usa Game_Action.makeDamageValue do engine REAL — respeita plugins customizados ' +
        '(VisuStella, Yanfly, sistemas custom). Retorna log detalhado + resultado + stats. ' +
        'Útil pra testar balanceamento de inimigos novos sem precisar entrar em batalha real.',
      inputSchema: z.object({
        troopId: z.number().int().positive().describe('ID da troop a simular'),
        partyActorIds: z
          .array(z.number().int().positive())
          .optional()
          .describe('IDs dos actors no party (default: party atual do jogador)'),
        maxTurns: z.number().int().positive().default(30).describe('Limite de turnos'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () =>
        bridge.call('simulateBattle', {
          troopId: args.troopId,
          partyActorIds: args.partyActorIds ?? [],
          maxTurns: args.maxTurns,
        }),
      ),
  );

  /* ---------------- runtime_get_console_log ---------------- */
  server.registerTool(
    'runtime_get_console_log',
    {
      description:
        'Lê os erros/warnings capturados do jogo durante o Playtest (console.error, ' +
        'console.warn, window.onerror, unhandledrejection). Pega crashes de plugin SEM ' +
        'precisar de screenshot. Filtre por level (error/warn/uncaught/unhandledrejection). ' +
        'clear:true esvazia o buffer após ler.',
      inputSchema: z.object({
        level: z
          .enum(['all', 'error', 'warn', 'uncaught', 'unhandledrejection'])
          .default('all')
          .describe('Filtra por nível'),
        limit: z.number().int().positive().default(100).describe('Máximo de entradas'),
        clear: z.boolean().default(false).describe('Esvazia o buffer após ler'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () =>
        bridge.call('getConsoleLog', { level: args.level, limit: args.limit, clear: args.clear }),
      ),
  );

  /* ---------------- runtime_drain_events ---------------- */
  server.registerTool(
    'runtime_drain_events',
    {
      description:
        'Lê e limpa o buffer de eventos push do companion. Eventos rastreados (11): ' +
        'mapChanged, battleStarted, battleEnded, levelUp, switchChanged, variableChanged, ' +
        'goldChanged, itemChanged, partyMemberAdded, partyMemberRemoved, commonEventStarted. ' +
        'Filtre por nome com filterName.',
      inputSchema: z.object({
        filterName: z.string().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const events = bridge.drainEvents(args.filterName);
        return { count: events.length, events };
      }),
  );

  /* ---------------- runtime_wait_for_event ---------------- */
  server.registerTool(
    'runtime_wait_for_event',
    {
      description:
        'Bloqueia até o próximo evento com o nome especificado chegar do companion ' +
        '(ou timeout). Útil pra "espera o jogador entrar no mapa 5" antes de agir. ' +
        'Eventos (11): mapChanged, battleStarted, battleEnded, levelUp, switchChanged, ' +
        'variableChanged, goldChanged, itemChanged, partyMemberAdded, partyMemberRemoved, commonEventStarted.',
      inputSchema: z.object({
        eventName: z.string().min(1),
        timeoutMs: z.number().int().positive().default(30000),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const ev = await bridge.waitForEvent(args.eventName, args.timeoutMs);
        return ev;
      }),
  );
}
