/**
 * Tools de System.json — configurações globais do jogo.
 *
 * Diferente do CRUD do database, System.json é UM ÚNICO objeto (não array-of-records).
 * Cada tool faz um update PATCH sobre o System object.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { safeWrite } from '../../core/safe-writer.js';
import { detectEditorLock } from '../../core/lock-detect.js';
import { logger } from '../../utils/logger.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const SYSTEM_FILE = 'data/System.json';

async function loadSystem(config: Config): Promise<Record<string, unknown>> {
  const filePath = path.join(config.project.path, SYSTEM_FILE);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function saveSystem(config: Config, system: Record<string, unknown>): Promise<void> {
  const lock = await detectEditorLock();
  if (lock === 'locked' && config.editor.onLock === 'block') {
    throw mzError('editor_locked', 'Editor MZ está aberto.');
  } else if (lock === 'locked' && config.editor.onLock === 'warn') {
    logger.warn('Editor MZ parece aberto — escrita prosseguindo.');
  }
  // Bump versionId aqui mesmo
  const current = typeof system.versionId === 'number' ? (system.versionId as number) : 0;
  system.versionId = current + 1;
  const filePath = path.join(config.project.path, SYSTEM_FILE);
  await safeWrite(filePath, JSON.stringify(system));
}

export function registerSystemTools(server: McpServer, config: Config): void {
  server.registerTool(
    'system_get',
    {
      description:
        'Retorna o conteúdo de data/System.json — todas as configurações globais ' +
        '(título, termos, currency, sons, vehicles, etc.).',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(() => loadSystem(config)),
  );

  server.registerTool(
    'system_update_title',
    {
      description: 'Atualiza o título do jogo (gameTitle).',
      inputSchema: z.object({ title: z.string().min(1) }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.gameTitle = args.title;
        await saveSystem(config, sys);
        return { gameTitle: args.title };
      }),
  );

  server.registerTool(
    'system_update_currency',
    {
      description: 'Atualiza unit de moeda (currencyUnit). Ex.: "G", "Gold", "R$".',
      inputSchema: z.object({ unit: z.string().min(1) }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.currencyUnit = args.unit;
        await saveSystem(config, sys);
        return { currencyUnit: args.unit };
      }),
  );

  server.registerTool(
    'system_update_starting_position',
    {
      description: 'Atualiza onde o jogador começa (startMapId, startX, startY).',
      inputSchema: z.object({
        mapId: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.startMapId = args.mapId;
        sys.startX = args.x;
        sys.startY = args.y;
        await saveSystem(config, sys);
        return { startMapId: args.mapId, startX: args.x, startY: args.y };
      }),
  );

  server.registerTool(
    'system_update_party',
    {
      description: 'Atualiza membros iniciais da party (array de actor IDs).',
      inputSchema: z.object({
        actorIds: z.array(z.number().int().positive()).min(1).max(8),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.partyMembers = args.actorIds;
        await saveSystem(config, sys);
        return { partyMembers: args.actorIds };
      }),
  );

  server.registerTool(
    'system_update_terms',
    {
      description:
        'Atualiza strings de UI (basic, params, commands, messages). Patch shallow: ' +
        'só atualiza o que vier em `patch`; resto permanece.',
      inputSchema: z.object({
        patch: z.record(z.unknown()),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.terms = { ...((sys.terms as Record<string, unknown>) ?? {}), ...args.patch };
        await saveSystem(config, sys);
        return { terms: sys.terms };
      }),
  );

  server.registerTool(
    'system_update_window_tone',
    {
      description: 'Atualiza windowTone (cor da janela). RGB + alpha (-255 a 255 em cada).',
      inputSchema: z.object({
        r: z.number().int().min(-255).max(255).default(0),
        g: z.number().int().min(-255).max(255).default(0),
        b: z.number().int().min(-255).max(255).default(0),
        gray: z.number().int().min(-255).max(255).default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        sys.windowTone = [args.r, args.g, args.b, args.gray];
        await saveSystem(config, sys);
        return { windowTone: sys.windowTone };
      }),
  );
}
