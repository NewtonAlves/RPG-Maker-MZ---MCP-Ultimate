/**
 * I/O de arquivos de database do MZ.
 *
 * Arquivos como Actors.json têm formato `[null, record1, record2, ...]`. ID é
 * o índice no array (1-based; índice 0 é null reservado).
 *
 * Esta camada:
 *   - Carrega o array do disco e devolve só os records não-nulos (ou o array
 *     bruto pra operações que precisam do "buraco" no índice 0)
 *   - Valida cada record contra o schema da categoria
 *   - Salva de volta com SafeWriter + atomicidade + bump do versionId
 *   - Cria snapshot antes de escrever se autoBackup ligado
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { mzError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { detectEditorLock } from './lock-detect.js';
import { bumpSystemVersionId } from './version-bump.js';
import { safeWrite } from './safe-writer.js';
import { createSnapshot, pruneSnapshots } from './backup.js';
import type { Config } from '../config.js';
import { getCategoryInfo, type DbCategory } from '../schemas/registry.js';

export type DbRecord = Record<string, unknown> & { id: number };

/** Lê o arquivo de uma categoria. Retorna array de records (sem o null inicial). */
export async function loadDbRecords(
  config: Config,
  category: DbCategory,
): Promise<DbRecord[]> {
  const info = getCategoryInfo(category);
  const filePath = path.join(config.project.path, 'data', info.fileName);
  const raw = await fs.readFile(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw mzError(
      'schema_validation_failed',
      `Arquivo ${info.fileName} tem JSON inválido: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw mzError(
      'schema_validation_failed',
      `Arquivo ${info.fileName} esperava array, encontrou ${typeof parsed}.`,
    );
  }
  // Filtra null inicial (e qualquer null intermediário — IDs deletados)
  return parsed.filter((r) => r !== null && typeof r === 'object') as DbRecord[];
}

/** Lê o arquivo cru (com nulls). Útil pra operações que precisam preservar índices. */
export async function loadDbRaw(
  config: Config,
  category: DbCategory,
): Promise<(DbRecord | null)[]> {
  const info = getCategoryInfo(category);
  const filePath = path.join(config.project.path, 'data', info.fileName);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as (DbRecord | null)[];
}

/**
 * Salva o array de volta no disco. Faz:
 *   1. Check de lock do editor (config.editor.onLock)
 *   2. Snapshot se autoBackup ligado e isDestructive
 *   3. SafeWrite atômico
 *   4. Bump versionId do System.json
 *   5. Prune de snapshots antigos
 */
export async function saveDbRaw(
  config: Config,
  category: DbCategory,
  raw: (DbRecord | null)[],
  opts: { destructive?: boolean; snapshotLabel?: string } = {},
): Promise<void> {
  const info = getCategoryInfo(category);
  const filePath = path.join(config.project.path, 'data', info.fileName);

  // 1. Lock check
  const lock = await detectEditorLock();
  if (lock === 'locked') {
    if (config.editor.onLock === 'block') {
      throw mzError(
        'editor_locked',
        `Editor RPG Maker MZ está aberto com o projeto. Feche-o antes de escrever (config editor.onLock=block).`,
      );
    } else if (config.editor.onLock === 'warn') {
      logger.warn(
        `Editor MZ parece aberto. Mudanças vão forçar reload via versionId, mas conflitos podem acontecer. (config editor.onLock=warn)`,
      );
    }
  }

  // 2. Snapshot
  if (opts.destructive && config.project.autoBackup) {
    await createSnapshot(
      config.project.path,
      config.project.backupDir,
      opts.snapshotLabel ?? `before-${category}-write`,
    );
    await pruneSnapshots(
      config.project.path,
      config.project.backupDir,
      config.project.backupRetention,
    );
  }

  // 3. Write — formato MZ canônico: sem indent, array de uma linha
  const serialized = JSON.stringify(raw);
  await safeWrite(filePath, serialized);

  // 4. Bump versionId pra forçar reload do editor
  try {
    await bumpSystemVersionId(config.project.path);
  } catch (err) {
    logger.warn(`Falha bumpando versionId após escrever ${info.fileName}: ${(err as Error).message}`);
  }
}

/**
 * Pega o próximo ID livre. Se há "buracos" (records null no meio do array),
 * usa o menor buraco. Senão usa array.length (próximo após o último).
 */
export function nextFreeId(raw: (DbRecord | null)[]): number {
  // Começa em 1 (índice 0 é reservado)
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === null) return i;
  }
  return raw.length;
}

/** Insere ou atualiza um record na posição correta. */
export function setRecordAtId(raw: (DbRecord | null)[], record: DbRecord): void {
  const id = record.id;
  // Estende o array com nulls se necessário
  while (raw.length <= id) {
    raw.push(null);
  }
  raw[id] = record;
}

/** Remove um record (substitui por null, preservando IDs vizinhos). */
export function clearRecordAtId(raw: (DbRecord | null)[], id: number): boolean {
  if (id <= 0 || id >= raw.length) return false;
  if (raw[id] === null) return false;
  raw[id] = null;
  return true;
}
