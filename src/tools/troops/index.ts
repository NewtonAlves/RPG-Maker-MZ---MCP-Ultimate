/**
 * Tools de Troops (grupos de inimigos pra batalha).
 *
 * Troops são records em Troops.json (array-of-records). Usamos db-io diretamente.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadDbRaw, nextFreeId, saveDbRaw, setRecordAtId } from '../../core/db-io.js';
import { TroopSchema } from '../../schemas/data/troop.js';
import { TroopPageSchema } from '../../schemas/shared/index.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerTroopTools(server: McpServer, config: Config): void {
  /* -------------------------- troop_create ----------------------- */
  server.registerTool(
    'troop_create',
    {
      description:
        'Cria um Troop (grupo de inimigos pra batalha) com membros e posições. ' +
        'Use coords (x, y) em pixels relativos ao battler. Default troop ID auto-alocado.',
      inputSchema: z.object({
        name: z.string().min(1),
        members: z
          .array(
            z.object({
              enemyId: z.number().int().positive(),
              x: z.number().int().default(400),
              y: z.number().int().default(300),
              hidden: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(8),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'troop');
        const id = nextFreeId(raw);
        const troop = TroopSchema.parse({
          id,
          name: args.name,
          members: args.members,
          pages: [],
        });
        setRecordAtId(raw, troop);
        await saveDbRaw(config, 'troop', raw, { destructive: false });
        return { id, troop };
      }),
  );

  /* -------------------------- troop_member_add ------------------- */
  server.registerTool(
    'troop_member_add',
    {
      description: 'Adiciona um membro (enemy) num troop existente.',
      inputSchema: z.object({
        troopId: z.number().int().positive(),
        enemyId: z.number().int().positive(),
        x: z.number().int().default(400),
        y: z.number().int().default(300),
        hidden: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'troop');
        const troop = raw[args.troopId];
        if (!troop) {
          throw mzError('file_not_found', `Troop ${args.troopId} não existe.`);
        }
        const members = [
          ...((troop.members as unknown[]) ?? []),
          { enemyId: args.enemyId, x: args.x, y: args.y, hidden: args.hidden },
        ];
        const updated = TroopSchema.parse({ ...troop, members });
        setRecordAtId(raw, updated);
        await saveDbRaw(config, 'troop', raw, { destructive: false });
        return { troopId: args.troopId, memberCount: members.length };
      }),
  );

  /* -------------------------- troop_member_remove --------------- */
  server.registerTool(
    'troop_member_remove',
    {
      description: 'Remove um membro do troop pelo índice (0-based).',
      inputSchema: z.object({
        troopId: z.number().int().positive(),
        index: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'troop');
        const troop = raw[args.troopId];
        if (!troop) {
          throw mzError('file_not_found', `Troop ${args.troopId} não existe.`);
        }
        const members = [...((troop.members as unknown[]) ?? [])];
        if (args.index >= members.length) {
          throw mzError(
            'schema_validation_failed',
            `Índice ${args.index} fora de range (${members.length} membros).`,
          );
        }
        members.splice(args.index, 1);
        const updated = TroopSchema.parse({ ...troop, members });
        setRecordAtId(raw, updated);
        await saveDbRaw(config, 'troop', raw, { destructive: false });
        return { troopId: args.troopId, removed: args.index, memberCount: members.length };
      }),
  );

  /* -------------------------- troop_set_layout ------------------- */
  server.registerTool(
    'troop_set_layout',
    {
      description:
        'Posiciona automaticamente os membros do troop numa formação. Layouts: ' +
        '"line" (linha horizontal centrada), "v" (V invertido), "circle" (círculo).',
      inputSchema: z.object({
        troopId: z.number().int().positive(),
        layout: z.enum(['line', 'v', 'circle']).default('line'),
        centerX: z.number().int().default(400),
        centerY: z.number().int().default(300),
        spacing: z.number().int().positive().default(150),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'troop');
        const troop = raw[args.troopId];
        if (!troop) {
          throw mzError('file_not_found', `Troop ${args.troopId} não existe.`);
        }
        const members = [...((troop.members as { enemyId: number; x: number; y: number; hidden: boolean }[]) ?? [])];
        const n = members.length;
        for (let i = 0; i < n; i++) {
          const m = members[i]!;
          if (args.layout === 'line') {
            // Centralizado horizontalmente
            const offset = (i - (n - 1) / 2) * args.spacing;
            members[i] = { ...m, x: args.centerX + Math.round(offset), y: args.centerY };
          } else if (args.layout === 'v') {
            // V invertido: meio mais alto, lados mais baixos
            const offset = (i - (n - 1) / 2) * args.spacing;
            const yShift = Math.round(Math.abs(offset) * 0.3);
            members[i] = {
              ...m,
              x: args.centerX + Math.round(offset),
              y: args.centerY - yShift,
            };
          } else {
            // circle
            const angle = (2 * Math.PI * i) / Math.max(n, 1);
            members[i] = {
              ...m,
              x: args.centerX + Math.round(Math.cos(angle) * args.spacing),
              y: args.centerY + Math.round(Math.sin(angle) * args.spacing * 0.5),
            };
          }
        }
        const updated = TroopSchema.parse({ ...troop, members });
        setRecordAtId(raw, updated);
        await saveDbRaw(config, 'troop', raw, { destructive: false });
        return { troopId: args.troopId, layout: args.layout, positions: members.map((m) => ({ x: m.x, y: m.y })) };
      }),
  );

  /* -------------------------- troop_battle_event_add ------------ */
  server.registerTool(
    'troop_battle_event_add',
    {
      description:
        'Adiciona uma página de battle event ao troop (executada quando condições são ' +
        'atingidas). Condições básicas: turnEnding, turnA, turnB, enemyHp%, actorHp%, switch.',
      inputSchema: z.object({
        troopId: z.number().int().positive(),
        conditions: z
          .object({
            turnEnding: z.boolean().optional(),
            turnValid: z.boolean().optional(),
            turnA: z.number().int().optional(),
            turnB: z.number().int().optional(),
            enemyValid: z.boolean().optional(),
            enemyIndex: z.number().int().optional(),
            enemyHp: z.number().int().optional().describe('Trigger quando HP% <= valor'),
            actorValid: z.boolean().optional(),
            actorId: z.number().int().optional(),
            actorHp: z.number().int().optional(),
            switchValid: z.boolean().optional(),
            switchId: z.number().int().optional(),
          })
          .default({}),
        span: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(0)
          .describe('0=Battle (uma vez), 1=Turn (a cada turno), 2=Moment'),
        commands: z
          .array(
            z.object({
              code: z.number().int().nonnegative(),
              indent: z.number().int().nonnegative().default(0),
              parameters: z.array(z.unknown()).default([]),
            }),
          )
          .default([]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'troop');
        const troop = raw[args.troopId];
        if (!troop) {
          throw mzError('file_not_found', `Troop ${args.troopId} não existe.`);
        }
        const commands = [...args.commands, { code: 0, indent: 0, parameters: [] }];
        const page = TroopPageSchema.parse({
          conditions: args.conditions,
          span: args.span,
          list: commands,
        });
        const pages = [...((troop.pages as unknown[]) ?? []), page];
        const updated = TroopSchema.parse({ ...troop, pages });
        setRecordAtId(raw, updated);
        await saveDbRaw(config, 'troop', raw, { destructive: false });
        return { troopId: args.troopId, pageCount: pages.length };
      }),
  );
}
