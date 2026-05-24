/**
 * Renderer de mapas: compõe map.data[] + tilesets PNG em uma única imagem.
 *
 * Cobertura desta versão:
 *   - B, C, D, E sheets   ✓ (cálculo de tile exato)
 *   - A5 sheet            ✓ (cálculo de tile exato)
 *   - A1-A4 autotiles     ✓ (shape 0 = tile "default", sem encoding de borda)
 *
 * Limitação: autotiles sempre usam o tile representativo do bloco, não a forma
 * exata correspondente à conectividade (que requer tabela de 48 shapes).
 * Resultado visual: mapas com bordas/cantos parecem mais "blocky" que no jogo.
 * Pra preview rápido, é suficiente.
 *
 * Renderiza camadas z=0..3 (ground, ground overlay, upper 1, upper 2).
 * Pula z=4 (shadow) e z=5 (region) — não são visuais.
 */

import path from 'node:path';
import { Jimp } from 'jimp';

import type { Config } from '../config.js';
import { loadMap } from './map-io.js';
import { loadDbRaw } from './db-io.js';
import { mzError } from '../utils/errors.js';

const TILE_WIDTH = 48;
const TILE_HEIGHT = 48;

/* ============================ Tile decoding ============================ */

function isTileB(id: number): boolean { return id >= 0 && id < 256; }
function isTileC(id: number): boolean { return id >= 256 && id < 512; }
function isTileD(id: number): boolean { return id >= 512 && id < 768; }
function isTileE(id: number): boolean { return id >= 768 && id < 1024; }
function isTileA5(id: number): boolean { return id >= 1536 && id < 2048; }
function isTileA1(id: number): boolean { return id >= 2048 && id < 2816; }
function isTileA2(id: number): boolean { return id >= 2816 && id < 4352; }
function isTileA3(id: number): boolean { return id >= 4352 && id < 5888; }
function isTileA4(id: number): boolean { return id >= 5888 && id < 8192; }

/** Retorna o índice do sheet (0=A1, 1=A2, ..., 4=A5, 5=B, 6=C, 7=D, 8=E) ou -1 se não suportado. */
function getSheetIndex(tileId: number): number {
  if (isTileB(tileId)) return 5;
  if (isTileC(tileId)) return 6;
  if (isTileD(tileId)) return 7;
  if (isTileE(tileId)) return 8;
  if (isTileA5(tileId)) return 4;
  if (isTileA1(tileId)) return 0;
  if (isTileA2(tileId)) return 1;
  if (isTileA3(tileId)) return 2;
  if (isTileA4(tileId)) return 3;
  return -1;
}

/** Retorna (sx, sy) — posição do tile dentro do sheet. */
function getSourceCoords(tileId: number): { sx: number; sy: number } {
  if (isTileB(tileId) || isTileC(tileId) || isTileD(tileId) || isTileE(tileId)) {
    const sx = ((Math.floor(tileId / 128) % 2) * 8 + (tileId % 8)) * TILE_WIDTH;
    const sy = (Math.floor((tileId % 256) / 8) % 16) * TILE_HEIGHT;
    return { sx, sy };
  }
  if (isTileA5(tileId)) {
    const localId = tileId - 1536;
    const sx = ((Math.floor(tileId / 128) % 2) * 8 + (tileId % 8)) * TILE_WIDTH;
    const sy = (Math.floor(localId / 8) % 8) * TILE_HEIGHT;
    return { sx, sy };
  }
  // A1: 16 autotiles em grid 4×4, cada um ocupa 2×3 cells. Shape 0 = center bottom.
  if (isTileA1(tileId)) {
    const autotileIndex = Math.floor((tileId - 2048) / 48);
    const blockX = (autotileIndex % 4) * 2 * TILE_WIDTH;
    const blockY = Math.floor(autotileIndex / 4) * 3 * TILE_HEIGHT;
    return { sx: blockX + TILE_WIDTH, sy: blockY + 2 * TILE_HEIGHT };
  }
  // A2: 32 autotiles em grid 8×4, cada um 2×3 cells.
  if (isTileA2(tileId)) {
    const autotileIndex = Math.floor((tileId - 2816) / 48);
    const blockX = (autotileIndex % 8) * 2 * TILE_WIDTH;
    const blockY = Math.floor(autotileIndex / 8) * 3 * TILE_HEIGHT;
    return { sx: blockX + TILE_WIDTH, sy: blockY + 2 * TILE_HEIGHT };
  }
  // A3: 32 autotiles em grid 8×4, cada 2×2 cells. Tile representativo no top-left.
  if (isTileA3(tileId)) {
    const autotileIndex = Math.floor((tileId - 4352) / 48);
    const blockX = (autotileIndex % 8) * 2 * TILE_WIDTH;
    const blockY = Math.floor(autotileIndex / 8) * 2 * TILE_HEIGHT;
    return { sx: blockX, sy: blockY };
  }
  // A4: 48 autotiles em grid 8×6, cada 2×3 cells.
  if (isTileA4(tileId)) {
    const autotileIndex = Math.floor((tileId - 5888) / 48);
    const blockX = (autotileIndex % 8) * 2 * TILE_WIDTH;
    const blockY = Math.floor(autotileIndex / 8) * 3 * TILE_HEIGHT;
    return { sx: blockX + TILE_WIDTH, sy: blockY + 2 * TILE_HEIGHT };
  }
  return { sx: 0, sy: 0 };
}

/* ============================ Rendering ============================ */

export interface RenderOptions {
  /** Layers a renderizar (0..3). Default: [0,1,2,3] */
  layers?: number[];
  /** Escala da saída (1.0 = tamanho real, 0.5 = metade). Default: 1.0 */
  scale?: number;
  /** Max tiles (largura × altura) — proteção contra mapas gigantes. Default: 256*256 */
  maxTiles?: number;
}

export async function renderMap(
  config: Config,
  mapId: number,
  options: RenderOptions = {},
): Promise<Buffer> {
  const layers = options.layers ?? [0, 1, 2, 3];
  const scale = options.scale ?? 1.0;
  const maxTiles = options.maxTiles ?? 256 * 256;

  const map = await loadMap(config, mapId);
  if (map.width * map.height > maxTiles) {
    throw mzError(
      'schema_validation_failed',
      `Mapa ${mapId} tem ${map.width}×${map.height} = ${map.width * map.height} tiles, excede maxTiles=${maxTiles}.`,
    );
  }

  // Carrega tileset metadata
  const tilesetsRaw = await loadDbRaw(config, 'tileset');
  const tileset = tilesetsRaw[map.tilesetId];
  if (!tileset) {
    throw mzError('file_not_found', `Tileset ${map.tilesetId} (do mapa ${mapId}) não existe.`);
  }
  const tilesetNames = (tileset.tilesetNames as string[]) ?? [];

  // Carrega as 9 sheet images (algumas podem ser vazias)
  const tilesetsDir = path.join(config.project.path, 'img', 'tilesets');
  const sheets: (Awaited<ReturnType<typeof Jimp.read>> | null)[] = [];
  for (let i = 0; i < 9; i++) {
    const name = tilesetsNamesAt(tilesetNames, i);
    if (!name) {
      sheets.push(null);
      continue;
    }
    const sheetPath = path.join(tilesetsDir, `${name}.png`);
    try {
      sheets.push(await Jimp.read(sheetPath));
    } catch {
      sheets.push(null);
    }
  }

  // Output: width*48 × height*48
  const outW = map.width * TILE_WIDTH;
  const outH = map.height * TILE_HEIGHT;
  const output = new Jimp({ width: outW, height: outH, color: 0x000000ff });

  // Renderiza camadas em ordem
  const layerSize = map.width * map.height;
  for (const z of layers) {
    if (z < 0 || z > 3) continue;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = z * layerSize + y * map.width + x;
        const tileId = map.data[idx];
        if (!tileId || tileId === 0) continue;
        const sheetIdx = getSheetIndex(tileId);
        if (sheetIdx < 0) continue;
        const sheet = sheets[sheetIdx];
        if (!sheet) continue;
        const { sx, sy } = getSourceCoords(tileId);
        // Crop the tile area
        const tile = sheet.clone().crop({ x: sx, y: sy, w: TILE_WIDTH, h: TILE_HEIGHT });
        output.composite(tile, x * TILE_WIDTH, y * TILE_HEIGHT);
      }
    }
  }

  // Escala se solicitado
  if (scale !== 1.0) {
    output.resize({ w: Math.round(outW * scale), h: Math.round(outH * scale) });
  }

  // Retorna PNG buffer
  return await output.getBuffer('image/png');
}

function tilesetsNamesAt(arr: string[], i: number): string {
  return arr[i] ?? '';
}
