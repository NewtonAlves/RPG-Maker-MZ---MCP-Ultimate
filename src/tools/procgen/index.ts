/**
 * Tools de geração procedural de mapas.
 *
 * Implementações simples (não pretende ser estado-da-arte):
 *   - procgen_dungeon: BSP recursive partitioning + corridors
 *   - procgen_cave: cellular automata
 *   - procgen_outdoor: noise-based (Perlin-ish)
 *
 * Tile IDs precisam ser fornecidos pelo usuário (tilesetId + tile IDs de
 * floor/wall). Não conhecemos tile IDs do tileset do usuário automaticamente.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { autotileBaseId, computeAutotileMap } from '../../core/autotile.js';
import {
  emptyTileData,
  loadMapInfos,
  nextFreeMapId,
  saveMap,
  saveMapInfos,
  tileIndex,
} from '../../core/map-io.js';
import { MapSchema } from '../../schemas/data/map.js';
import { MapInfoSchema } from '../../schemas/data/map-info.js';
import { mcpReturn } from '../database/index.js';

/* ---------- Util seeded RNG (mulberry32) ---------- */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/* ---------- BSP dungeon ---------- */
interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}
function bspGenerate(
  width: number,
  height: number,
  seed: number,
  minRoom: number,
  maxDepth: number,
): { floor: boolean[]; rooms: Room[] } {
  const rng = makeRng(seed);
  const floor: boolean[] = new Array(width * height).fill(false);
  const rooms: Room[] = [];

  function partition(x: number, y: number, w: number, h: number, depth: number): void {
    if (depth >= maxDepth || (w < minRoom * 2 && h < minRoom * 2)) {
      // Carve a room
      const rw = Math.max(minRoom, w - 2 - rngInt(rng, 0, 2));
      const rh = Math.max(minRoom, h - 2 - rngInt(rng, 0, 2));
      const rx = x + Math.floor((w - rw) / 2);
      const ry = y + Math.floor((h - rh) / 2);
      const room = { x: rx, y: ry, w: rw, h: rh };
      rooms.push(room);
      for (let yy = ry; yy < ry + rh; yy++) {
        for (let xx = rx; xx < rx + rw; xx++) {
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) {
            floor[yy * width + xx] = true;
          }
        }
      }
      return;
    }
    const splitH = w < h || (w === h && rng() < 0.5);
    if (splitH) {
      const split = rngInt(rng, Math.floor(h / 3), Math.floor((h * 2) / 3));
      partition(x, y, w, split, depth + 1);
      partition(x, y + split, w, h - split, depth + 1);
    } else {
      const split = rngInt(rng, Math.floor(w / 3), Math.floor((w * 2) / 3));
      partition(x, y, split, h, depth + 1);
      partition(x + split, y, w - split, h, depth + 1);
    }
  }
  partition(0, 0, width, height, 0);

  // Conecta rooms vizinhos via L corridor
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i]!;
    const b = rooms[i + 1]!;
    const ax = a.x + Math.floor(a.w / 2);
    const ay = a.y + Math.floor(a.h / 2);
    const bx = b.x + Math.floor(b.w / 2);
    const by = b.y + Math.floor(b.h / 2);
    const horizontalFirst = rng() < 0.5;
    if (horizontalFirst) {
      drawHLine(floor, width, height, ax, bx, ay);
      drawVLine(floor, width, height, bx, ay, by);
    } else {
      drawVLine(floor, width, height, ax, ay, by);
      drawHLine(floor, width, height, ax, bx, by);
    }
  }

  return { floor, rooms };
}
function drawHLine(floor: boolean[], width: number, height: number, x1: number, x2: number, y: number): void {
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  for (let x = lo; x <= hi; x++) {
    if (x >= 0 && y >= 0 && x < width && y < height) floor[y * width + x] = true;
  }
}
function drawVLine(floor: boolean[], width: number, height: number, x: number, y1: number, y2: number): void {
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
  for (let y = lo; y <= hi; y++) {
    if (x >= 0 && y >= 0 && x < width && y < height) floor[y * width + x] = true;
  }
}

/* ---------- Cellular Automata cave ---------- */
function caveGenerate(width: number, height: number, seed: number, fillPct: number, steps: number): boolean[] {
  const rng = makeRng(seed);
  let grid: boolean[] = new Array(width * height).fill(false).map(() => rng() < fillPct);
  for (let s = 0; s < steps; s++) {
    const next: boolean[] = new Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              neighbors++; // bordas como solid
            } else if (grid[ny * width + nx]) {
              neighbors++;
            }
          }
        }
        // Rule: solid se >= 5 vizinhos solid
        next[y * width + x] = neighbors >= 5;
      }
    }
    grid = next;
  }
  // Inverte: floor = !solid
  return grid.map((g) => !g);
}

/* ---------- Outdoor noise ---------- */
function outdoorGenerate(width: number, height: number, seed: number, density: number): boolean[] {
  const rng = makeRng(seed);
  const floor: boolean[] = new Array(width * height).fill(true);
  // Coloca "árvores" / obstáculos esparsos
  const obstacleCount = Math.floor(width * height * density);
  for (let i = 0; i < obstacleCount; i++) {
    const idx = rngInt(rng, 0, width * height - 1);
    floor[idx] = false;
  }
  return floor;
}

/* ---------- Aplica grid no mapa ---------- */
function gridToMapData(
  floor: boolean[],
  width: number,
  height: number,
  floorTileId: number,
  wallTileId: number,
): number[] {
  const data = emptyTileData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = tileIndex(width, height, x, y, 0);
      data[idx] = floor[y * width + x] ? floorTileId : wallTileId;
    }
  }
  return data;
}

/** Versão autotile-aware: usa shape encoding pros tiles de floor. */
function gridToMapDataAutotile(
  floor: boolean[],
  width: number,
  height: number,
  autotileSheet: 'A1' | 'A2' | 'A3' | 'A4',
  autotileIndex: number,
  wallTileId: number,
): number[] {
  const data = emptyTileData(width, height);
  const baseId = autotileBaseId(autotileSheet, autotileIndex);
  const shapeMap = computeAutotileMap(floor, width, height, baseId, wallTileId);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = tileIndex(width, height, x, y, 0);
      data[idx] = shapeMap[y * width + x]!;
    }
  }
  return data;
}

/* ============================ Tools ============================ */

export function registerProcgenTools(server: McpServer, config: Config): void {
  server.registerTool(
    'procgen_dungeon',
    {
      description:
        'Gera mapa de dungeon via BSP (recursive partitioning). Cria salas conectadas por corredores. ' +
        'Aplica como Map###.json novo. Suporta autotile encoding: passe autotileSheet+autotileIndex ' +
        '(ex: sheet="A2", index=0) pra bordas suaves, ou floorTileId pra tile flat.',
      inputSchema: z.object({
        name: z.string().default('Dungeon Procgen'),
        width: z.number().int().min(17).max(256).default(40),
        height: z.number().int().min(13).max(256).default(30),
        tilesetId: z.number().int().positive().default(1),
        seed: z.number().int().default(42),
        minRoomSize: z.number().int().min(3).max(20).default(4),
        maxDepth: z.number().int().min(2).max(8).default(4),
        autotileSheet: z.enum(['A1', 'A2', 'A3', 'A4']).optional().describe('Use autotile bordering. Se omitido, usa floorTileId fixo.'),
        autotileIndex: z.number().int().min(0).max(15).default(0),
        floorTileId: z.number().int().nonnegative().default(2816),
        wallTileId: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { floor, rooms } = bspGenerate(args.width, args.height, args.seed, args.minRoomSize, args.maxDepth);
        const data = args.autotileSheet
          ? gridToMapDataAutotile(floor, args.width, args.height, args.autotileSheet, args.autotileIndex, args.wallTileId)
          : gridToMapData(floor, args.width, args.height, args.floorTileId, args.wallTileId);
        const id = await nextFreeMapId(config);
        const map = MapSchema.parse({
          width: args.width,
          height: args.height,
          tilesetId: args.tilesetId,
          data,
          events: [null],
        });
        await saveMap(config, id, map);
        const infos = await loadMapInfos(config);
        while (infos.length <= id) infos.push(null);
        infos[id] = MapInfoSchema.parse({ id, name: args.name, expanded: false, order: id, parentId: 0, scrollX: 0, scrollY: 0 });
        await saveMapInfos(config, infos);
        return { mapId: id, name: args.name, rooms: rooms.length, seed: args.seed, autotile: !!args.autotileSheet };
      }),
  );

  server.registerTool(
    'procgen_cave',
    {
      description:
        'Gera caverna via cellular automata. Estilo orgânico (mais cave-like que dungeon).',
      inputSchema: z.object({
        name: z.string().default('Cave Procgen'),
        width: z.number().int().min(17).max(256).default(40),
        height: z.number().int().min(13).max(256).default(30),
        tilesetId: z.number().int().positive().default(1),
        seed: z.number().int().default(42),
        fillPct: z.number().min(0.3).max(0.6).default(0.45),
        steps: z.number().int().min(1).max(20).default(5),
        autotileSheet: z.enum(['A1', 'A2', 'A3', 'A4']).optional(),
        autotileIndex: z.number().int().min(0).max(15).default(0),
        floorTileId: z.number().int().nonnegative().default(2816),
        wallTileId: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const floor = caveGenerate(args.width, args.height, args.seed, args.fillPct, args.steps);
        const data = args.autotileSheet
          ? gridToMapDataAutotile(floor, args.width, args.height, args.autotileSheet, args.autotileIndex, args.wallTileId)
          : gridToMapData(floor, args.width, args.height, args.floorTileId, args.wallTileId);
        const id = await nextFreeMapId(config);
        const map = MapSchema.parse({
          width: args.width, height: args.height, tilesetId: args.tilesetId,
          data, events: [null],
        });
        await saveMap(config, id, map);
        const infos = await loadMapInfos(config);
        while (infos.length <= id) infos.push(null);
        infos[id] = MapInfoSchema.parse({ id, name: args.name, expanded: false, order: id, parentId: 0, scrollX: 0, scrollY: 0 });
        await saveMapInfos(config, infos);
        return { mapId: id, name: args.name, seed: args.seed, autotile: !!args.autotileSheet };
      }),
  );

  server.registerTool(
    'procgen_outdoor',
    {
      description:
        'Gera mapa outdoor (grass + obstáculos esparsos). Útil pra áreas de mundo aberto base.',
      inputSchema: z.object({
        name: z.string().default('Outdoor Procgen'),
        width: z.number().int().min(17).max(256).default(50),
        height: z.number().int().min(13).max(256).default(40),
        tilesetId: z.number().int().positive().default(1),
        seed: z.number().int().default(42),
        obstacleDensity: z.number().min(0).max(0.5).default(0.05),
        floorTileId: z.number().int().nonnegative().default(2048),
        obstacleTileId: z.number().int().nonnegative().default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const floor = outdoorGenerate(args.width, args.height, args.seed, args.obstacleDensity);
        const data = gridToMapData(floor, args.width, args.height, args.floorTileId, args.obstacleTileId);
        const id = await nextFreeMapId(config);
        const map = MapSchema.parse({
          width: args.width, height: args.height, tilesetId: args.tilesetId,
          data, events: [null],
        });
        await saveMap(config, id, map);
        const infos = await loadMapInfos(config);
        while (infos.length <= id) infos.push(null);
        infos[id] = MapInfoSchema.parse({ id, name: args.name, expanded: false, order: id, parentId: 0, scrollX: 0, scrollY: 0 });
        await saveMapInfos(config, infos);
        return { mapId: id, name: args.name, seed: args.seed };
      }),
  );
}
