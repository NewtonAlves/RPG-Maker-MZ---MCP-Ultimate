/**
 * Tools de Switches e Variables.
 *
 * Switches: arr de strings (nomes) em System.switches[]. Index 0 = vazio.
 * Variables: arr de strings (nomes) em System.variables[].
 * Self-switches: A-D por evento; manipulação só em runtime via companion.
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
import { loadDbRecords } from '../../core/db-io.js';
import { listMapIds, loadMap } from '../../core/map-io.js';

interface MapEventUse {
  mapId: number;
  eventId: number;
  pageIndex: number;
  commandIndex: number;
  code: number;
}

async function scanMapsForSwitchVariableUses(
  config: Config,
  targetId: number,
  kind: 'switch' | 'variable',
): Promise<MapEventUse[]> {
  const uses: MapEventUse[] = [];
  const mapIds = await listMapIds(config);
  for (const mapId of mapIds) {
    try {
      const map = await loadMap(config, mapId);
      for (const ev of map.events) {
        if (!ev) continue;
        for (let p = 0; p < ev.pages.length; p++) {
          const page = ev.pages[p]!;
          for (let i = 0; i < page.list.length; i++) {
            const cmd = page.list[i]!;
            if (matchesIdInCommand(cmd, targetId, kind)) {
              uses.push({ mapId, eventId: ev.id, pageIndex: p, commandIndex: i, code: cmd.code });
            }
          }
        }
      }
    } catch {}
  }
  return uses;
}

function matchesIdInCommand(
  cmd: { code: number; parameters: unknown[] },
  targetId: number,
  kind: 'switch' | 'variable',
): boolean {
  if (kind === 'switch') {
    // 111: Conditional Branch (switch); 121: Control Switches; 295: Event Conditions
    if (cmd.code === 111 && cmd.parameters[0] === 0 && cmd.parameters[1] === targetId) return true;
    if (cmd.code === 121) {
      const lo = Number(cmd.parameters[0]);
      const hi = Number(cmd.parameters[1]);
      if (targetId >= lo && targetId <= hi) return true;
    }
  } else {
    // 111: Conditional Branch (variable); 122: Control Variables
    if (cmd.code === 111 && cmd.parameters[0] === 1 && cmd.parameters[1] === targetId) return true;
    if (cmd.code === 122) {
      const lo = Number(cmd.parameters[0]);
      const hi = Number(cmd.parameters[1]);
      if (targetId >= lo && targetId <= hi) return true;
    }
  }
  return false;
}

const SYSTEM_PATH = (config: Config) => path.join(config.project.path, 'data', 'System.json');

async function loadSystem(config: Config): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(SYSTEM_PATH(config), 'utf-8');
  return JSON.parse(raw);
}

async function saveSystem(config: Config, sys: Record<string, unknown>): Promise<void> {
  const lock = await detectEditorLock();
  if (lock === 'locked' && config.editor.onLock === 'block') {
    throw mzError('editor_locked', 'Editor MZ está aberto.');
  } else if (lock === 'locked' && config.editor.onLock === 'warn') {
    logger.warn('Editor MZ parece aberto — escrita prosseguindo.');
  }
  const cur = typeof sys.versionId === 'number' ? (sys.versionId as number) : 0;
  sys.versionId = cur + 1;
  await safeWrite(SYSTEM_PATH(config), JSON.stringify(sys));
}

export function registerSwitchVariableTools(server: McpServer, config: Config): void {
  /* -------------------- switch_list -------------------- */
  server.registerTool(
    'switch_list',
    {
      description: 'Lista switches (com nomes) do System.json. Inclui switches sem nome.',
      inputSchema: z.object({
        includeUnnamed: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const switches = (sys.switches as string[]) ?? [];
        const items = switches
          .map((name, id) => ({ id, name }))
          .filter((s) => s.id > 0 && (args.includeUnnamed || s.name.length > 0));
        return { total: switches.length - 1, returned: items.length, items };
      }),
  );

  /* -------------------- switch_rename ------------------ */
  server.registerTool(
    'switch_rename',
    {
      description: 'Renomeia um switch. Aumenta o array de switches se id > length.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        name: z.string(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const switches = ((sys.switches as string[]) ?? []).slice();
        while (switches.length <= args.id) switches.push('');
        const old = switches[args.id];
        switches[args.id] = args.name;
        sys.switches = switches;
        await saveSystem(config, sys);
        return { id: args.id, oldName: old, newName: args.name };
      }),
  );

  /* -------------------- switch_resize ------------------ */
  server.registerTool(
    'switch_resize',
    {
      description: 'Aumenta o número total de switches (preenche com "" no fim).',
      inputSchema: z.object({ total: z.number().int().positive() }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const switches = ((sys.switches as string[]) ?? ['']).slice();
        while (switches.length <= args.total) switches.push('');
        if (switches.length > args.total + 1) switches.length = args.total + 1;
        sys.switches = switches;
        await saveSystem(config, sys);
        return { total: args.total, length: switches.length };
      }),
  );

  /* -------------------- switch_search_uses ------------- */
  server.registerTool(
    'switch_search_uses',
    {
      description:
        'Procura usos de um switch ID em CommonEvents E em todos os map events. ' +
        'Códigos verificados: 111 (Conditional Branch), 121 (Control Switches). ' +
        'includeMaps padrão true; passe false pra busca rápida só em CommonEvents.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        includeMaps: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const ces = await loadDbRecords(config, 'common_event');
        const commonEventUses: { commonEventId: number; commandIndex: number; code: number }[] = [];
        for (const ce of ces) {
          const list = (ce.list as { code: number; parameters: unknown[] }[]) ?? [];
          for (let i = 0; i < list.length; i++) {
            const cmd = list[i]!;
            if (matchesIdInCommand(cmd, args.id, 'switch')) {
              commonEventUses.push({ commonEventId: ce.id, commandIndex: i, code: cmd.code });
            }
          }
        }
        const mapUses = args.includeMaps
          ? await scanMapsForSwitchVariableUses(config, args.id, 'switch')
          : [];
        return {
          switchId: args.id,
          commonEventUses,
          mapUses,
          count: commonEventUses.length + mapUses.length,
        };
      }),
  );

  /* -------------------- variable_* (espelhos) ---------- */
  server.registerTool(
    'variable_list',
    {
      description: 'Lista variables (com nomes) do System.json.',
      inputSchema: z.object({ includeUnnamed: z.boolean().default(false) }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const vars = (sys.variables as string[]) ?? [];
        const items = vars
          .map((name, id) => ({ id, name }))
          .filter((v) => v.id > 0 && (args.includeUnnamed || v.name.length > 0));
        return { total: vars.length - 1, returned: items.length, items };
      }),
  );

  server.registerTool(
    'variable_rename',
    {
      description: 'Renomeia uma variable.',
      inputSchema: z.object({ id: z.number().int().positive(), name: z.string() }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const vars = ((sys.variables as string[]) ?? []).slice();
        while (vars.length <= args.id) vars.push('');
        const old = vars[args.id];
        vars[args.id] = args.name;
        sys.variables = vars;
        await saveSystem(config, sys);
        return { id: args.id, oldName: old, newName: args.name };
      }),
  );

  server.registerTool(
    'variable_resize',
    {
      description: 'Aumenta o número total de variables.',
      inputSchema: z.object({ total: z.number().int().positive() }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const sys = await loadSystem(config);
        const vars = ((sys.variables as string[]) ?? ['']).slice();
        while (vars.length <= args.total) vars.push('');
        if (vars.length > args.total + 1) vars.length = args.total + 1;
        sys.variables = vars;
        await saveSystem(config, sys);
        return { total: args.total, length: vars.length };
      }),
  );

  server.registerTool(
    'variable_search_uses',
    {
      description:
        'Procura usos de uma variable ID em CommonEvents E map events. Códigos: 111, 122.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        includeMaps: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const ces = await loadDbRecords(config, 'common_event');
        const commonEventUses: { commonEventId: number; commandIndex: number; code: number }[] = [];
        for (const ce of ces) {
          const list = (ce.list as { code: number; parameters: unknown[] }[]) ?? [];
          for (let i = 0; i < list.length; i++) {
            const cmd = list[i]!;
            if (matchesIdInCommand(cmd, args.id, 'variable')) {
              commonEventUses.push({ commonEventId: ce.id, commandIndex: i, code: cmd.code });
            }
          }
        }
        const mapUses = args.includeMaps
          ? await scanMapsForSwitchVariableUses(config, args.id, 'variable')
          : [];
        return {
          variableId: args.id,
          commonEventUses,
          mapUses,
          count: commonEventUses.length + mapUses.length,
        };
      }),
  );
}
