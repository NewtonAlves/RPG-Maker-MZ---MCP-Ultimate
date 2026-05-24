/**
 * Tools de Sample Maps — leverage os 293 mapas bundled no install do MZ.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  loadMapInfos,
  nextFreeMapId,
  saveMap,
  saveMapInfos,
} from '../../core/map-io.js';
import { MapSchema } from '../../schemas/data/map.js';
import { MapInfoSchema } from '../../schemas/data/map-info.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerSampleMapsTools(server: McpServer, config: Config): void {
  server.registerTool(
    'samplemaps_list',
    {
      description:
        'Lista sample maps disponíveis na instalação do RPG Maker MZ. Retorna IDs, dimensões e tilesetId.',
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const dir = path.join(config.mz.installPath, 'samplemaps');
        const entries = await fs.readdir(dir);
        const maps = entries.filter((e) => /^Map\d+\.json$/.test(e)).sort();
        const sliced = args.limit ? maps.slice(args.offset, args.offset + args.limit) : maps.slice(args.offset);
        const items = await Promise.all(
          sliced.map(async (name) => {
            try {
              const raw = await fs.readFile(path.join(dir, name), 'utf-8');
              const m = JSON.parse(raw);
              return {
                file: name,
                width: m.width,
                height: m.height,
                tilesetId: m.tilesetId,
                eventCount: (m.events ?? []).filter((e: unknown) => e !== null).length,
              };
            } catch {
              return { file: name, error: 'failed to parse' };
            }
          }),
        );
        return { count: items.length, total: maps.length, offset: args.offset, items };
      }),
  );

  server.registerTool(
    'samplemaps_clone_to_project',
    {
      description:
        'Copia um sample map pra o projeto MZ atual. Aceita newMapName (Display Name). ' +
        'Aloca ID livre. Não inclui o thumbnail PNG; só o .json.',
      inputSchema: z.object({
        sampleFile: z
          .string()
          .regex(/^Map\d+\.json$/)
          .describe('Nome do arquivo em samplemaps/ (ex.: "Map042.json")'),
        newMapName: z.string().min(1).describe('Nome no MapInfos do projeto'),
        parentId: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const srcPath = path.join(config.mz.installPath, 'samplemaps', args.sampleFile);
        const raw = await fs.readFile(srcPath, 'utf-8');
        const sample = JSON.parse(raw);
        const map = MapSchema.parse(sample);
        const id = await nextFreeMapId(config);
        await saveMap(config, id, map);
        const infos = await loadMapInfos(config);
        while (infos.length <= id) infos.push(null);
        infos[id] = MapInfoSchema.parse({
          id, name: args.newMapName, expanded: false, order: id, parentId: args.parentId, scrollX: 0, scrollY: 0,
        });
        await saveMapInfos(config, infos);
        return {
          newMapId: id,
          name: args.newMapName,
          dimensions: { w: sample.width, h: sample.height },
          tilesetId: sample.tilesetId,
        };
      }),
  );

  server.registerTool(
    'samplemaps_search_by_features',
    {
      description:
        'Filtra sample maps por features: tilesetId, dimensão (minWidth, maxWidth, etc.), ' +
        'eventCount. Útil pra achar maps próximos ao que você quer.',
      inputSchema: z.object({
        tilesetId: z.number().int().positive().optional(),
        minWidth: z.number().int().positive().optional(),
        maxWidth: z.number().int().positive().optional(),
        minHeight: z.number().int().positive().optional(),
        maxHeight: z.number().int().positive().optional(),
        minEvents: z.number().int().nonnegative().optional(),
        maxEvents: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().default(30),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const dir = path.join(config.mz.installPath, 'samplemaps');
        const entries = await fs.readdir(dir);
        const maps = entries.filter((e) => /^Map\d+\.json$/.test(e)).sort();
        const matches: Array<{ file: string; width: number; height: number; tilesetId: number; eventCount: number }> = [];
        for (const name of maps) {
          if (matches.length >= args.limit) break;
          try {
            const raw = await fs.readFile(path.join(dir, name), 'utf-8');
            const m = JSON.parse(raw);
            const evCount = (m.events ?? []).filter((e: unknown) => e !== null).length;
            if (args.tilesetId !== undefined && m.tilesetId !== args.tilesetId) continue;
            if (args.minWidth !== undefined && m.width < args.minWidth) continue;
            if (args.maxWidth !== undefined && m.width > args.maxWidth) continue;
            if (args.minHeight !== undefined && m.height < args.minHeight) continue;
            if (args.maxHeight !== undefined && m.height > args.maxHeight) continue;
            if (args.minEvents !== undefined && evCount < args.minEvents) continue;
            if (args.maxEvents !== undefined && evCount > args.maxEvents) continue;
            matches.push({ file: name, width: m.width, height: m.height, tilesetId: m.tilesetId, eventCount: evCount });
          } catch {}
        }
        return { count: matches.length, items: matches };
      }),
  );
}
