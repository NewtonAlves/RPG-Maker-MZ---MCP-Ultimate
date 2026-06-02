/**
 * Tools de Events (eventos de mapa) + templates dos event commands mais usados.
 *
 * Trigger: 0=Action Button, 1=Player Touch, 2=Event Touch, 3=Autorun, 4=Parallel.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadMap, saveMap } from '../../core/map-io.js';
import { MapEventSchema, type MapEvent } from '../../schemas/data/map-event.js';
import { EventPageSchema } from '../../schemas/data/map-event-page.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

/** Loop helper: carrega o mapa, deixa o callback mutar, salva. */
async function mutateMap(
  config: Config,
  mapId: number,
  fn: (events: (MapEvent | null)[]) => void | Promise<void>,
  opts: { destructive?: boolean; snapshotLabel?: string } = {},
): Promise<void> {
  const map = await loadMap(config, mapId);
  const events = [...map.events] as (MapEvent | null)[];
  await fn(events);
  await saveMap(config, mapId, { ...map, events }, opts);
}

function nextEventId(events: (MapEvent | null)[]): number {
  for (let i = 1; i < events.length; i++) {
    if (events[i] === null) return i;
  }
  return events.length;
}

export function registerEventTools(server: McpServer, config: Config): void {
  /* -------------------------- event_create ----------------------- */
  server.registerTool(
    'event_create',
    {
      description:
        'Cria um evento novo num mapa em (x, y). Inicializa com 1 página vazia (trigger=Action Button). ' +
        'Use os event_template_* depois pra adicionar comandos.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        name: z.string().default(''),
        characterName: z.string().default(''),
        characterIndex: z.number().int().min(0).max(7).default(0),
        trigger: z
          .number()
          .int()
          .min(0)
          .max(4)
          .default(0)
          .describe('0=Action, 1=Player Touch, 2=Event Touch, 3=Autorun, 4=Parallel'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let createdId: number;
        await mutateMap(config, args.mapId, (events) => {
          const id = nextEventId(events);
          while (events.length <= id) events.push(null);
          const page = EventPageSchema.parse({
            image: { characterName: args.characterName, characterIndex: args.characterIndex },
            trigger: args.trigger,
          });
          events[id] = MapEventSchema.parse({
            id,
            name: args.name || `EV${String(id).padStart(3, '0')}`,
            x: args.x,
            y: args.y,
            pages: [page],
          });
          createdId = id;
        });
        return { mapId: args.mapId, eventId: createdId!, x: args.x, y: args.y };
      }),
  );

  /* -------------------------- event_list_in_map ----------------- */
  server.registerTool(
    'event_list_in_map',
    {
      description: 'Lista eventos de um mapa (resumo: id, name, x, y, page count).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.mapId);
        const items = map.events
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .map((e) => ({
            id: e.id,
            name: e.name,
            x: e.x,
            y: e.y,
            pages: e.pages.length,
            firstTrigger: e.pages[0]?.trigger,
            firstCommandCount: e.pages[0]?.list.length ?? 0,
          }));
        return { mapId: args.mapId, count: items.length, items };
      }),
  );

  /* -------------------------- event_get -------------------------- */
  server.registerTool(
    'event_get',
    {
      description: 'Retorna detalhes completos de um evento (todas as páginas e comandos).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.mapId);
        const event = map.events[args.eventId];
        if (!event) {
          throw mzError('file_not_found', `Evento ${args.eventId} não existe no mapa ${args.mapId}.`);
        }
        return event;
      }),
  );

  /* -------------------------- event_move ------------------------- */
  server.registerTool(
    'event_move',
    {
      description: 'Move um evento (muda x/y).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const ev = events[args.eventId];
          if (!ev) throw mzError('file_not_found', `Evento ${args.eventId} não existe.`);
          events[args.eventId] = { ...ev, x: args.x, y: args.y };
        });
        return { mapId: args.mapId, eventId: args.eventId, x: args.x, y: args.y };
      }),
  );

  /* -------------------------- event_delete ----------------------- */
  server.registerTool(
    'event_delete',
    {
      description: 'Remove um evento do mapa. Operação destrutiva — cria snapshot.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(
          config,
          args.mapId,
          (events) => {
            if (!events[args.eventId]) {
              throw mzError('file_not_found', `Evento ${args.eventId} não existe.`);
            }
            events[args.eventId] = null;
          },
          { destructive: true, snapshotLabel: `before-delete-event-${args.mapId}-${args.eventId}` },
        );
        return { deleted: true, mapId: args.mapId, eventId: args.eventId };
      }),
  );

  /* -------------------------- event_page_add --------------------- */
  server.registerTool(
    'event_page_add',
    {
      description:
        'Adiciona uma página nova ao evento. Útil pra criar comportamentos condicionais ' +
        '(ex.: NPC fala diferente depois que o switch X é ligado).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        trigger: z.number().int().min(0).max(4).default(0),
        conditions: z
          .object({
            switch1Id: z.number().int().nonnegative().optional(),
            switch1Valid: z.boolean().optional(),
            switch2Id: z.number().int().nonnegative().optional(),
            switch2Valid: z.boolean().optional(),
            variableId: z.number().int().nonnegative().optional(),
            variableValid: z.boolean().optional(),
            variableValue: z.number().optional(),
            selfSwitchCh: z.enum(['A', 'B', 'C', 'D']).optional(),
            selfSwitchValid: z.boolean().optional(),
            itemId: z.number().int().nonnegative().optional(),
            itemValid: z.boolean().optional(),
            actorId: z.number().int().nonnegative().optional(),
            actorValid: z.boolean().optional(),
          })
          .optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let pageIndex: number;
        await mutateMap(config, args.mapId, (events) => {
          const ev = events[args.eventId];
          if (!ev) throw mzError('file_not_found', `Evento ${args.eventId} não existe.`);
          const page = EventPageSchema.parse({
            trigger: args.trigger,
            conditions: args.conditions ?? {},
          });
          ev.pages = [...ev.pages, page];
          pageIndex = ev.pages.length - 1;
        });
        return { mapId: args.mapId, eventId: args.eventId, pageIndex: pageIndex! };
      }),
  );

  /* -------------------------- event_command_add_generic --------- */
  server.registerTool(
    'event_command_add_generic',
    {
      description:
        'Adiciona um event command BRUTO a uma página. Use quando não há template ' +
        'pronto pro código. Códigos comuns: 101=Show Text, 102=Show Choices, 111=Conditional, ' +
        '201=Transfer, 250=Play SE, 301=Battle, 401=Text Continuation. ' +
        'Lista completa: docs do MZ ou samplemaps.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        code: z.number().int().nonnegative().describe('Código do event command'),
        indent: z.number().int().nonnegative().default(0),
        parameters: z.array(z.unknown()).default([]),
        /** Posição na lista; default: antes do terminador (code=0) final. */
        insertBefore: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const ev = events[args.eventId];
          if (!ev) throw mzError('file_not_found', `Evento ${args.eventId} não existe.`);
          const page = ev.pages[args.pageIndex];
          if (!page) {
            throw mzError('file_not_found', `Página ${args.pageIndex} não existe.`);
          }
          insertCommand(page.list, {
            code: args.code,
            indent: args.indent,
            parameters: args.parameters,
          }, args.insertBefore);
        });
        return { mapId: args.mapId, eventId: args.eventId, pageIndex: args.pageIndex, code: args.code };
      }),
  );

  /* -------------------- map_event_search -------------------- */
  server.registerTool(
    'map_event_search',
    {
      description:
        'Busca em event commands de todos os maps. Filtros: text (substring em Show Text/Choices), ' +
        'codes (array de codes pra filtrar), mapId (limita a um map).',
      inputSchema: z.object({
        text: z.string().optional().describe('Substring case-insensitive em Show Text/Choices'),
        codes: z.array(z.number().int()).optional().describe('Filtra por códigos específicos'),
        mapId: z.number().int().positive().optional(),
        limit: z.number().int().positive().default(100),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { listMapIds, loadMap } = await import('../../core/map-io.js');
        const ids = args.mapId ? [args.mapId] : await listMapIds(config);
        const matches: Array<{
          mapId: number; eventId: number; pageIndex: number; commandIndex: number;
          code: number; preview?: string;
        }> = [];
        const textLower = args.text?.toLowerCase();
        for (const mapId of ids) {
          if (matches.length >= args.limit) break;
          try {
            const m = await loadMap(config, mapId);
            for (const ev of m.events) {
              if (!ev || matches.length >= args.limit) continue;
              for (let p = 0; p < ev.pages.length; p++) {
                const page = ev.pages[p]!;
                for (let i = 0; i < page.list.length; i++) {
                  if (matches.length >= args.limit) break;
                  const cmd = page.list[i]!;
                  if (args.codes && !args.codes.includes(cmd.code)) continue;
                  let preview: string | undefined;
                  if (textLower) {
                    let textInCmd = '';
                    if (cmd.code === 101 && typeof cmd.parameters[4] === 'string') textInCmd = cmd.parameters[4];
                    if (cmd.code === 401 && typeof cmd.parameters[0] === 'string') textInCmd = cmd.parameters[0];
                    if (cmd.code === 102 && Array.isArray(cmd.parameters[0])) textInCmd = (cmd.parameters[0] as string[]).join(' | ');
                    if (!textInCmd.toLowerCase().includes(textLower)) continue;
                    preview = textInCmd.slice(0, 80);
                  }
                  matches.push({
                    mapId, eventId: ev.id, pageIndex: p, commandIndex: i, code: cmd.code, preview,
                  });
                }
              }
            }
          } catch {}
        }
        return { count: matches.length, matches };
      }),
  );

  /* -------------------------- templates -------------------------- */
  registerDialogueTemplate(server, config);
  registerChoicesTemplate(server, config);
  registerConditionalTemplate(server, config);
  registerTransferTemplate(server, config);
  registerBattleTemplate(server, config);
  registerPlaySoundTemplate(server, config);
  registerChangePartyMemberTemplate(server, config);
  registerShopTemplate(server, config);
}

/* ========================== templates impl ========================== */

function registerDialogueTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_dialogue',
    {
      description:
        'Adiciona um diálogo (Show Text 101 + Text Continuation 401) numa página. ' +
        'Aceita texto multi-linha — quebra em comandos 401 automaticamente.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        text: z.string().min(1).describe('Texto do diálogo (\\n separa linhas)'),
        faceName: z.string().default('').describe('Nome do face (img/faces/)'),
        faceIndex: z.number().int().min(0).max(7).default(0),
        background: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(0)
          .describe('0=Window, 1=Dim, 2=Transparent'),
        position: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(2)
          .describe('0=Top, 1=Middle, 2=Bottom'),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          const lines = args.text.split('\n');
          // 101: [faceName, faceIndex, background, position, speakerName?]
          insertCommand(page.list, {
            code: 101,
            indent: args.indent,
            parameters: [args.faceName, args.faceIndex, args.background, args.position, ''],
          });
          for (const line of lines) {
            insertCommand(page.list, { code: 401, indent: args.indent, parameters: [line] });
          }
        });
        return { mapId: args.mapId, eventId: args.eventId, lines: args.text.split('\n').length };
      }),
  );
}

function registerChoicesTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_choices',
    {
      description:
        'Adiciona Show Choices (102) com 2-6 opções. Cada opção começa um bloco ' +
        '(code 402 = "When [N]") seguido pelos comandos da escolha (indent+1) e termina com 404.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        choices: z.array(z.string().min(1)).min(2).max(6),
        cancelType: z
          .number()
          .int()
          .default(-1)
          .describe('-1=Disallow, -2=Branch, 0+ = índice da escolha (0-based)'),
        defaultType: z.number().int().default(0).describe('Índice da escolha default (0-based)'),
        positionType: z.number().int().min(0).max(2).default(2),
        background: z.number().int().min(0).max(2).default(0),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          // 102: [choices[], cancelType, defaultType, positionType, background]
          insertCommand(page.list, {
            code: 102,
            indent: args.indent,
            parameters: [
              args.choices,
              args.cancelType,
              args.defaultType,
              args.positionType,
              args.background,
            ],
          });
          // Para cada escolha: 402 com [index, text], depois um placeholder, depois 404 fecha
          for (let i = 0; i < args.choices.length; i++) {
            insertCommand(page.list, {
              code: 402,
              indent: args.indent,
              parameters: [i, args.choices[i]],
            });
            insertCommand(page.list, { code: 0, indent: args.indent + 1, parameters: [] });
          }
          // 404 fecha o bloco Show Choices
          insertCommand(page.list, { code: 404, indent: args.indent, parameters: [] });
        });
        return { mapId: args.mapId, eventId: args.eventId, choices: args.choices.length };
      }),
  );
}

function registerConditionalTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_conditional',
    {
      description:
        'Adiciona Conditional Branch (111) verificando switch ou variável. Gera ' +
        'também os terminadores 0 (corpo vazio do branch) e 412 (fim do if).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        kind: z.enum(['switch', 'variable']),
        switchId: z.number().int().positive().optional(),
        switchOn: z.boolean().default(true).optional(),
        variableId: z.number().int().positive().optional(),
        comparison: z
          .number()
          .int()
          .min(0)
          .max(5)
          .default(0)
          .describe('0=Eq, 1=>=, 2=<=, 3=>, 4=<, 5=!='),
        variableValue: z.number().default(0),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          // Parameter shapes per kind:
          //  switch:   [0, switchId, switchOn? 0 : 1]
          //  variable: [1, variableId, 0 (=constant), value, comparison]
          let params: unknown[];
          if (args.kind === 'switch') {
            if (!args.switchId) throw mzError('schema_validation_failed', 'switchId obrigatório.');
            params = [0, args.switchId, args.switchOn ? 0 : 1];
          } else {
            if (!args.variableId) {
              throw mzError('schema_validation_failed', 'variableId obrigatório.');
            }
            params = [1, args.variableId, 0, args.variableValue, args.comparison];
          }
          insertCommand(page.list, { code: 111, indent: args.indent, parameters: params });
          insertCommand(page.list, { code: 0, indent: args.indent + 1, parameters: [] });
          insertCommand(page.list, { code: 412, indent: args.indent, parameters: [] });
        });
        return { mapId: args.mapId, eventId: args.eventId };
      }),
  );
}

function registerTransferTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_transfer',
    {
      description:
        'Adiciona Transfer Player (201). Move o jogador pra um mapa/coordenada. ' +
        'direction: 0=Retain, 2=Down, 4=Left, 6=Right, 8=Up.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        destMapId: z.number().int().positive(),
        destX: z.number().int().nonnegative(),
        destY: z.number().int().nonnegative(),
        direction: z.number().int().min(0).max(8).default(0),
        fadeType: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(0)
          .describe('0=Black, 1=White, 2=No fade'),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          // 201: [designation, mapId, x, y, direction, fadeType]
          //   designation: 0=Direct, 1=By Variables
          insertCommand(page.list, {
            code: 201,
            indent: args.indent,
            parameters: [0, args.destMapId, args.destX, args.destY, args.direction, args.fadeType],
          });
        });
        return { mapId: args.mapId, eventId: args.eventId };
      }),
  );
}

function registerBattleTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_battle',
    {
      description: 'Adiciona Battle Processing (301) iniciando batalha com troopId.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        troopId: z.number().int().positive(),
        canEscape: z.boolean().default(true),
        canLose: z.boolean().default(false),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          // 301: [troopMode, troopId, canEscape, canLose]
          //   troopMode: 0=Direct, 1=Variable, 2=Same as previous
          insertCommand(page.list, {
            code: 301,
            indent: args.indent,
            parameters: [0, args.troopId, args.canEscape, args.canLose],
          });
        });
        return { mapId: args.mapId, eventId: args.eventId, troopId: args.troopId };
      }),
  );
}

function registerPlaySoundTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_play_sound',
    {
      description: 'Toca um SE (250). Use pra efeitos sonoros pontuais.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        seName: z.string().min(1).describe('Nome do arquivo em audio/se/ (sem extensão)'),
        volume: z.number().int().min(0).max(100).default(90),
        pitch: z.number().int().min(50).max(150).default(100),
        pan: z.number().int().min(-100).max(100).default(0),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          insertCommand(page.list, {
            code: 250,
            indent: args.indent,
            parameters: [{ name: args.seName, volume: args.volume, pitch: args.pitch, pan: args.pan }],
          });
        });
        return { mapId: args.mapId, eventId: args.eventId };
      }),
  );

  /* -------------------------- event_validate_structure ----------------------- */
  server.registerTool(
    'event_validate_structure',
    {
      description:
        'Valida a ESTRUTURA das command lists de eventos (mapas + common events + troops). ' +
        'Detecta listas malformadas que travam o interpretador: sem terminador code 0, ' +
        'indent negativo, salto de indent (corrupção), blocos não fechados (conditional/loop/' +
        'choices sem End), e continuações órfãs (401/405/505/655 sem header). Usa apenas ' +
        'invariantes provadas do MZ — zero falso positivo. Só lê, não modifica.',
      inputSchema: z.object({
        severity: z.enum(['all', 'error', 'warning']).default('all').describe('Filtra por severity'),
        limit: z.number().int().positive().default(200).describe('Máximo de issues retornadas'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { validateEventStructure } = await import('../../core/event-structure.js');
        const result = await validateEventStructure(config);
        let items = result.issues;
        if (args.severity !== 'all') items = items.filter((i) => i.severity === args.severity);
        return {
          totalLists: result.totalLists,
          totalIssues: result.totalIssues,
          errorCount: result.errorCount,
          warningCount: result.warningCount,
          issues: items.slice(0, args.limit),
          truncated: items.length > args.limit ? items.length - args.limit : 0,
        };
      }),
  );

  /* -------------------------- event_check_references ----------------------- */
  server.registerTool(
    'event_check_references',
    {
      description:
        'Valida o que os comandos de evento APONTAM (complementa event_validate_structure). ' +
        'Detecta: Transfer Player (201) pra mapa inexistente, Call Common Event (117) inexistente, ' +
        'Control Switch/Variable (121/122) fora do range, Battle (301) com troop inexistente, e ' +
        'escape codes \\V[n]/\\N[n] no texto apontando pra variável/actor inválido. ' +
        '100% determinístico, só lê. Pega bugs que travam ou se comportam errado em runtime.',
      inputSchema: z.object({
        severity: z.enum(['all', 'error', 'warning']).default('all').describe('Filtra por severity'),
        limit: z.number().int().positive().default(200).describe('Máximo de issues retornadas'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { checkEventReferences } = await import('../../core/event-references.js');
        const result = await checkEventReferences(config);
        let items = result.issues;
        if (args.severity !== 'all') items = items.filter((i) => i.severity === args.severity);
        return {
          totalCommands: result.totalCommands,
          totalIssues: result.totalIssues,
          errorCount: result.errorCount,
          warningCount: result.warningCount,
          byRule: result.byRule,
          issues: items.slice(0, args.limit),
          truncated: items.length > args.limit ? items.length - args.limit : 0,
        };
      }),
  );

  /* -------------------------- text_replace_all ----------------------- */
  server.registerTool(
    'text_replace_all',
    {
      description:
        'Busca e substitui texto em TODOS os diálogos do projeto (Show Text 401 + Scroll Text ' +
        '405) — mapas, common events e battle events. Útil pra renomear personagem em massa, ' +
        'corrigir typo recorrente. Substring literal (não regex). dryRun=true (padrão) só ' +
        'mostra as ocorrências SEM mudar nada — RODE PRIMEIRO assim pra revisar. dryRun=false ' +
        'aplica (cria snapshot antes). Confirme com o usuário antes de aplicar.',
      inputSchema: z.object({
        find: z.string().min(1).describe('Texto a procurar'),
        replace: z.string().describe('Texto de substituição (pode ser vazio pra remover)'),
        caseSensitive: z.boolean().default(true).describe('Diferencia maiúsculas/minúsculas'),
        dryRun: z.boolean().default(true).describe('true = só preview; false = aplica de verdade'),
        limit: z.number().int().positive().default(500).describe('Máximo de ocorrências detalhadas'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { textReplaceAll } = await import('../../core/text-replace.js');
        return textReplaceAll(config, {
          find: args.find,
          replace: args.replace,
          caseSensitive: args.caseSensitive,
          dryRun: args.dryRun,
          limit: args.limit,
        });
      }),
  );
}

function registerChangePartyMemberTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_change_party_member',
    {
      description:
        'Change Party Member (129). add=true adiciona, false remove. initialize=true ' +
        'restaura HP/MP no add.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        actorId: z.number().int().positive(),
        add: z.boolean(),
        initialize: z.boolean().default(false),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          // 129: [actorId, operation, initialize]  operation: 0=add, 1=remove
          insertCommand(page.list, {
            code: 129,
            indent: args.indent,
            parameters: [args.actorId, args.add ? 0 : 1, args.initialize],
          });
        });
        return { mapId: args.mapId, eventId: args.eventId, actorId: args.actorId, add: args.add };
      }),
  );
}

/* ========================== helpers ========================== */

function registerShopTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    'event_template_shop',
    {
      description:
        'Adiciona Shop Processing (302 + 605) abrindo uma loja. goods = lista de itens à venda. ' +
        'kind: "item"|"weapon"|"armor". price omitido ou 0 = usa o preço padrão do item. ' +
        'purchaseOnly=true impede o jogador de vender.',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        pageIndex: z.number().int().nonnegative().default(0),
        goods: z
          .array(
            z.object({
              kind: z.enum(['item', 'weapon', 'armor']),
              dataId: z.number().int().positive(),
              price: z.number().int().nonnegative().default(0).describe('0 = preço padrão do item'),
            }),
          )
          .min(1)
          .describe('Itens à venda'),
        purchaseOnly: z.boolean().default(false).describe('true impede venda'),
        indent: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const kindMap: Record<string, number> = { item: 0, weapon: 1, armor: 2 };
        await mutateMap(config, args.mapId, (events) => {
          const page = getPage(events, args);
          args.goods.forEach((g, idx) => {
            const goodType = kindMap[g.kind]!;
            const priceType = g.price && g.price > 0 ? 1 : 0;
            // Primeiro item = 302 (com purchaseOnly no fim); adicionais = 605
            if (idx === 0) {
              insertCommand(page.list, {
                code: 302,
                indent: args.indent,
                parameters: [goodType, g.dataId, priceType, g.price ?? 0, args.purchaseOnly],
              });
            } else {
              insertCommand(page.list, {
                code: 605,
                indent: args.indent,
                parameters: [goodType, g.dataId, priceType, g.price ?? 0],
              });
            }
          });
        });
        return { mapId: args.mapId, eventId: args.eventId, goodsCount: args.goods.length };
      }),
  );
}

function getPage(
  events: (MapEvent | null)[],
  args: { eventId: number; pageIndex: number },
): { list: { code: number; indent: number; parameters: unknown[] }[] } {
  const ev = events[args.eventId];
  if (!ev) throw mzError('file_not_found', `Evento ${args.eventId} não existe.`);
  const page = ev.pages[args.pageIndex];
  if (!page) {
    throw mzError('file_not_found', `Página ${args.pageIndex} não existe no evento ${args.eventId}.`);
  }
  return page as never;
}

/**
 * Insere comando na lista. Por default, insere ANTES do terminador (último code=0).
 * Se a lista estiver vazia ou só tiver o terminador, append antes do terminador.
 */
function insertCommand(
  list: { code: number; indent: number; parameters: unknown[] }[],
  cmd: { code: number; indent: number; parameters: unknown[] },
  insertBefore?: number,
): void {
  // Lista MZ sempre termina com {code:0, indent:0, parameters:[]}
  // Se não terminar, garante isso
  if (list.length === 0 || list[list.length - 1]!.code !== 0) {
    list.push({ code: 0, indent: 0, parameters: [] });
  }
  const pos = insertBefore ?? list.length - 1;
  list.splice(pos, 0, cmd);
}
