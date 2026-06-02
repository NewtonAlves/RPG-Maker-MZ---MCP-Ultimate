/**
 * Tools de Maps — CRUD de mapas, edição de tiles, propriedades.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  emptyTileData,
  listMapIds,
  loadMap,
  loadMapInfos,
  mapFileName,
  mapPath,
  nextFreeMapId,
  saveMap,
  saveMapInfos,
  tileIndex,
} from '../../core/map-io.js';
import { renderMap } from '../../core/map-renderer.js';
import { MapSchema } from '../../schemas/data/map.js';
import { MapInfoSchema } from '../../schemas/data/map-info.js';
import { mzError } from '../../utils/errors.js';
import fs from 'node:fs/promises';
import { mcpReturn } from '../database/index.js';
import { createSnapshot, pruneSnapshots } from '../../core/backup.js';

export function registerMapTools(server: McpServer, config: Config): void {
  /* -------------------------- map_list -------------------------- */
  server.registerTool(
    'map_list',
    {
      description:
        'Lista todos os mapas do projeto (IDs, nomes do MapInfos, dimensões). ' +
        'Conjunto baseado em arquivos Map###.json E entradas do MapInfos.json.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const [ids, infos] = await Promise.all([listMapIds(config), loadMapInfos(config)]);
        const items = ids.map((id) => {
          const info = infos[id];
          return {
            id,
            file: mapFileName(id),
            displayName: info?.name ?? '',
            parentId: info?.parentId ?? 0,
            order: info?.order ?? 0,
          };
        });
        return { count: items.length, items };
      }),
  );

  /* -------------------------- map_get --------------------------- */
  server.registerTool(
    'map_get',
    {
      description:
        'Retorna o conteúdo de um mapa: propriedades + tile data (resumo) + lista de eventos.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        includeTileData: z
          .boolean()
          .default(false)
          .describe('Se true, retorna o array data completo (pode ser grande).'),
        includeEvents: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.id);
        return {
          id: args.id,
          file: mapFileName(args.id),
          width: map.width,
          height: map.height,
          tilesetId: map.tilesetId,
          displayName: map.displayName,
          scrollType: map.scrollType,
          bgm: map.bgm,
          bgs: map.bgs,
          parallaxName: map.parallaxName,
          battleback1Name: map.battleback1Name,
          battleback2Name: map.battleback2Name,
          note: map.note,
          dataLength: map.data.length,
          data: args.includeTileData ? map.data : undefined,
          events: args.includeEvents
            ? map.events.filter((e): e is NonNullable<typeof e> => e !== null).map((e) => ({
                id: e.id,
                name: e.name,
                x: e.x,
                y: e.y,
                pageCount: e.pages.length,
              }))
            : undefined,
        };
      }),
  );

  /* -------------------------- map_create ------------------------- */
  server.registerTool(
    'map_create',
    {
      description:
        'Cria um mapa novo. Auto-aloca ID livre se id não for fornecido. Tile data é ' +
        'inicializado em zeros. Adiciona entrada no MapInfos.json.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Nome do mapa (mostrado no editor MZ)'),
        width: z.number().int().min(17).max(256).default(17),
        height: z.number().int().min(13).max(256).default(13),
        tilesetId: z.number().int().positive().default(1),
        parentId: z.number().int().nonnegative().default(0),
        displayName: z.string().default('').describe('Nome mostrado no JOGO (in-game)'),
        scrollType: z.number().int().min(0).max(3).default(0),
        bgmName: z.string().default('').describe('BGM (nome do arquivo em audio/bgm/)'),
        id: z.number().int().positive().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const id = args.id ?? (await nextFreeMapId(config));

        // Garante que não está sobrescrevendo
        const filePath = mapPath(config, id);
        try {
          await fs.access(filePath);
          throw mzError(
            'schema_validation_failed',
            `Já existe Map${String(id).padStart(3, '0')}.json. Escolha outro id.`,
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof Error && err.message.includes('Já existe'))) {
            throw err;
          }
          if (err instanceof Error && err.message.includes('Já existe')) throw err;
        }

        // Cria o mapa
        const map = MapSchema.parse({
          displayName: args.displayName,
          tilesetId: args.tilesetId,
          width: args.width,
          height: args.height,
          scrollType: args.scrollType,
          autoplayBgm: !!args.bgmName,
          bgm: { name: args.bgmName, volume: 90, pitch: 100, pan: 0 },
          data: emptyTileData(args.width, args.height),
          events: [null],
        });
        await saveMap(config, id, map, { destructive: false });

        // Atualiza MapInfos
        const infos = await loadMapInfos(config);
        while (infos.length <= id) infos.push(null);
        infos[id] = MapInfoSchema.parse({
          id,
          name: args.name,
          expanded: false,
          order: id,
          parentId: args.parentId,
          scrollX: 0,
          scrollY: 0,
        });
        await saveMapInfos(config, infos);

        return { id, name: args.name, file: mapFileName(id), width: args.width, height: args.height };
      }),
  );

  /* -------------------------- map_set_properties ---------------- */
  server.registerTool(
    'map_set_properties',
    {
      description:
        'Atualiza propriedades de um mapa existente (tilesetId, displayName, scroll, ' +
        'parallax, bgm, bgs, battlebacks, encounterList). Preserva tile data e events.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        tilesetId: z.number().int().positive().optional(),
        displayName: z.string().optional(),
        scrollType: z.number().int().min(0).max(3).optional(),
        bgm: z
          .object({
            name: z.string(),
            volume: z.number().int().optional(),
            pitch: z.number().int().optional(),
            pan: z.number().int().optional(),
          })
          .optional(),
        bgs: z
          .object({
            name: z.string(),
            volume: z.number().int().optional(),
            pitch: z.number().int().optional(),
            pan: z.number().int().optional(),
          })
          .optional(),
        battleback1Name: z.string().optional(),
        battleback2Name: z.string().optional(),
        parallaxName: z.string().optional(),
        disableDashing: z.boolean().optional(),
        note: z.string().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.id);
        const updated = MapSchema.parse({
          ...map,
          ...(args.tilesetId !== undefined && { tilesetId: args.tilesetId }),
          ...(args.displayName !== undefined && { displayName: args.displayName }),
          ...(args.scrollType !== undefined && { scrollType: args.scrollType }),
          ...(args.bgm !== undefined && {
            bgm: { ...map.bgm, ...args.bgm },
            autoplayBgm: !!args.bgm.name,
          }),
          ...(args.bgs !== undefined && {
            bgs: { ...map.bgs, ...args.bgs },
            autoplayBgs: !!args.bgs.name,
          }),
          ...(args.battleback1Name !== undefined && {
            battleback1Name: args.battleback1Name,
            specifyBattleback: true,
          }),
          ...(args.battleback2Name !== undefined && {
            battleback2Name: args.battleback2Name,
            specifyBattleback: true,
          }),
          ...(args.parallaxName !== undefined && { parallaxName: args.parallaxName }),
          ...(args.disableDashing !== undefined && { disableDashing: args.disableDashing }),
          ...(args.note !== undefined && { note: args.note }),
        });
        await saveMap(config, args.id, updated, { destructive: false });
        return { id: args.id, updated: true };
      }),
  );

  /* -------------------------- map_tile_set ----------------------- */
  server.registerTool(
    'map_tile_set',
    {
      description:
        'Coloca um tileId numa célula (x, y, z) do mapa. z é a camada (0-5: ' +
        '0=ground A, 1=ground B, 2=overlay A, 3=overlay B, 4=shadow, 5=region).',
      inputSchema: z.object({
        id: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        z: z.number().int().min(0).max(5),
        tileId: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.id);
        if (args.x >= map.width || args.y >= map.height) {
          throw mzError(
            'schema_validation_failed',
            `(${args.x},${args.y}) fora de ${map.width}x${map.height}.`,
          );
        }
        const idx = tileIndex(map.width, map.height, args.x, args.y, args.z);
        const oldTile = map.data[idx];
        const newData = [...map.data];
        newData[idx] = args.tileId;
        const updated = { ...map, data: newData };
        await saveMap(config, args.id, updated, { destructive: false });
        return { id: args.id, x: args.x, y: args.y, z: args.z, oldTile, newTile: args.tileId };
      }),
  );

  /* -------------------------- map_tile_fill_rect ---------------- */
  server.registerTool(
    'map_tile_fill_rect',
    {
      description:
        'Preenche um retângulo da camada z com tileId. Coords inclusivas (x1<=x<=x2).',
      inputSchema: z.object({
        id: z.number().int().positive(),
        x1: z.number().int().nonnegative(),
        y1: z.number().int().nonnegative(),
        x2: z.number().int().nonnegative(),
        y2: z.number().int().nonnegative(),
        z: z.number().int().min(0).max(5),
        tileId: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.id);
        const xLo = Math.min(args.x1, args.x2);
        const xHi = Math.min(Math.max(args.x1, args.x2), map.width - 1);
        const yLo = Math.min(args.y1, args.y2);
        const yHi = Math.min(Math.max(args.y1, args.y2), map.height - 1);
        const newData = [...map.data];
        let filled = 0;
        for (let y = yLo; y <= yHi; y++) {
          for (let x = xLo; x <= xHi; x++) {
            newData[tileIndex(map.width, map.height, x, y, args.z)] = args.tileId;
            filled++;
          }
        }
        await saveMap(config, args.id, { ...map, data: newData }, { destructive: true });
        return { id: args.id, filled, rect: { x1: xLo, y1: yLo, x2: xHi, y2: yHi, z: args.z } };
      }),
  );

  /* -------------------------- map_layer_clear ------------------- */
  server.registerTool(
    'map_layer_clear',
    {
      description: 'Zera uma camada inteira do mapa. Operação destrutiva — cria snapshot.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        z: z.number().int().min(0).max(5),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const map = await loadMap(config, args.id);
        const newData = [...map.data];
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            newData[tileIndex(map.width, map.height, x, y, args.z)] = 0;
          }
        }
        await saveMap(config, args.id, { ...map, data: newData }, {
          destructive: true,
          snapshotLabel: `before-map-${args.id}-layer-${args.z}-clear`,
        });
        return { id: args.id, z: args.z, cleared: true };
      }),
  );

  /* -------------------------- map_render ------------------------- */
  server.registerTool(
    'map_render',
    {
      description:
        'Renderiza um mapa como PNG (compõe tile data + tileset images). Retorna como ' +
        'content type "image" pra Claude visualizar nativamente. Cobre B-E sheets + A5 ' +
        'exatos; A1-A4 autotiles renderizam shape 0 (sem encoding de borda) — preview ' +
        'rápido suficiente.',
      inputSchema: z.object({
        id: z.number().int().positive(),
        layers: z.array(z.number().int().min(0).max(3)).optional().describe('Layers a renderizar (default: 0,1,2,3)'),
        scale: z.number().min(0.1).max(2.0).default(1.0).describe('Escala (1.0=real, 0.5=metade)'),
      }).shape,
    },
    async (args) => {
      try {
        const buffer = await renderMap(config, args.id, {
          layers: args.layers,
          scale: args.scale,
        });
        const base64 = buffer.toString('base64');
        return {
          content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }],
        };
      } catch (err) {
        const { MzMcpError } = await import('../../utils/errors.js');
        if (err instanceof MzMcpError) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON(), null, 2) }],
          };
        }
        throw err;
      }
    },
  );

  /* -------------------------- map_delete ------------------------- */
  server.registerTool(
    'map_delete',
    {
      description:
        'Deleta um mapa. Remove Map###.json e zera a entrada em MapInfos. Operação ' +
        'destrutiva — cria snapshot.',
      inputSchema: z.object({
        id: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        // Snapshot manual antes de deletar (saveMap só faz se destructive=true, mas
        // estamos deletando o arquivo direto)
        if (config.project.autoBackup) {
          await createSnapshot(
            config.project.path,
            config.project.backupDir,
            `before-map-${args.id}-delete`,
          );
          await pruneSnapshots(
            config.project.path,
            config.project.backupDir,
            config.project.backupRetention,
          );
        }
        const filePath = mapPath(config, args.id);
        try {
          await fs.unlink(filePath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw mzError('file_not_found', `Mapa ${args.id} não existe.`);
          }
          throw err;
        }
        // Limpa MapInfos
        const infos = await loadMapInfos(config);
        if (infos[args.id]) {
          infos[args.id] = null;
          await saveMapInfos(config, infos);
        }
        return { deleted: true, id: args.id };
      }),
  );
}
