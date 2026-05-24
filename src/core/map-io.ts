/**
 * I/O de Map###.json e MapInfos.json com SafeWriter + atomic + versionId bump.
 *
 * Maps são UM arquivo por mapa (Map001.json, Map002.json, ...).
 * MapInfos é UM ÚNICO arquivo array-of-records que registra todos os mapas.
 *
 * Map ID é zero-padded a 3 dígitos (Map001, Map002, ..., Map999).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from '../config.js';
import { MapSchema, type Map } from '../schemas/data/map.js';
import { MapInfoSchema, type MapInfo } from '../schemas/data/map-info.js';
import { mzError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { detectEditorLock } from './lock-detect.js';
import { bumpSystemVersionId } from './version-bump.js';
import { safeWrite } from './safe-writer.js';
import { createSnapshot, pruneSnapshots } from './backup.js';

export function mapFileName(id: number): string {
  return `Map${String(id).padStart(3, '0')}.json`;
}

export function mapPath(config: Config, id: number): string {
  return path.join(config.project.path, 'data', mapFileName(id));
}

/** Lê um mapa. Lança file_not_found se não existe. */
export async function loadMap(config: Config, id: number): Promise<Map> {
  const filePath = mapPath(config, id);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw mzError('file_not_found', `Mapa ${id} (${mapFileName(id)}) não existe no projeto.`);
    }
    throw err;
  }
  return MapSchema.parse(JSON.parse(raw));
}

/** Salva um mapa. Cria backup se destructive (overwrite de mapa existente). */
export async function saveMap(
  config: Config,
  id: number,
  map: Map,
  opts: { destructive?: boolean; snapshotLabel?: string } = {},
): Promise<void> {
  await guardLock(config);

  if (opts.destructive && config.project.autoBackup) {
    await createSnapshot(
      config.project.path,
      config.project.backupDir,
      opts.snapshotLabel ?? `before-map-${id}-write`,
    );
    await pruneSnapshots(
      config.project.path,
      config.project.backupDir,
      config.project.backupRetention,
    );
  }

  const filePath = mapPath(config, id);
  // Maps em MZ são single-line JSON
  await safeWrite(filePath, JSON.stringify(map));

  try {
    await bumpSystemVersionId(config.project.path);
  } catch (err) {
    logger.warn(`Falha bumpando versionId após salvar Map${id}: ${(err as Error).message}`);
  }
}

/** Lista todos os IDs de mapas do projeto (varrendo o disco). */
export async function listMapIds(config: Config): Promise<number[]> {
  const dataDir = path.join(config.project.path, 'data');
  const entries = await fs.readdir(dataDir);
  const ids: number[] = [];
  for (const entry of entries) {
    const m = /^Map(\d{3,})\.json$/.exec(entry);
    if (m) ids.push(parseInt(m[1]!, 10));
  }
  return ids.sort((a, b) => a - b);
}

/** Carrega MapInfos.json. */
export async function loadMapInfos(config: Config): Promise<(MapInfo | null)[]> {
  const filePath = path.join(config.project.path, 'data', 'MapInfos.json');
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as (MapInfo | null)[];
  return parsed.map((p) => (p === null ? null : MapInfoSchema.parse(p)));
}

export async function saveMapInfos(config: Config, infos: (MapInfo | null)[]): Promise<void> {
  await guardLock(config);
  const filePath = path.join(config.project.path, 'data', 'MapInfos.json');
  await safeWrite(filePath, JSON.stringify(infos));
  try {
    await bumpSystemVersionId(config.project.path);
  } catch (err) {
    logger.warn(`Falha bumpando versionId após salvar MapInfos: ${(err as Error).message}`);
  }
}

/** Próximo ID livre considerando arquivos e MapInfos. */
export async function nextFreeMapId(config: Config): Promise<number> {
  const ids = await listMapIds(config);
  const infos = await loadMapInfos(config);
  const used = new Set<number>(ids);
  for (let i = 1; i < infos.length; i++) {
    if (infos[i] !== null) used.add(i);
  }
  // Próximo após o maior usado
  let candidate = 1;
  while (used.has(candidate)) candidate++;
  return candidate;
}

async function guardLock(config: Config): Promise<void> {
  const lock = await detectEditorLock();
  if (lock === 'locked') {
    if (config.editor.onLock === 'block') {
      throw mzError(
        'editor_locked',
        'Editor RPG Maker MZ está aberto. Feche-o antes (config editor.onLock=block).',
      );
    } else if (config.editor.onLock === 'warn') {
      logger.warn(
        'Editor MZ parece aberto. versionId bump força reload, mas conflitos podem ocorrer.',
      );
    }
  }
}

/** Cria buffer de tiles vazio (zeros) com tamanho width*height*6. */
export function emptyTileData(width: number, height: number): number[] {
  return new Array(width * height * 6).fill(0);
}

/**
 * Indexa tile data: para celula (x, y, z) onde z é camada (0..5),
 * retorna o índice no array `data`.
 *
 * MZ usa o layout: data[z * width * height + y * width + x]
 */
export function tileIndex(width: number, height: number, x: number, y: number, z: number): number {
  return z * width * height + y * width + x;
}
