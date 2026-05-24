/**
 * SafeWriter — escrita atômica de arquivos com backup rotativo.
 *
 * Garante que:
 *   - Escrita parcial (crash mid-write) não corrompe o arquivo final
 *   - Cada escrita tem rollback via .bak
 *   - Operação registrada em log de operações
 *
 * Fluxo:
 *   1. Lê o arquivo original (se existir)
 *   2. Escreve em `<file>.tmp` (mesmo volume — atomic rename requer)
 *   3. Renomeia `<file>` → `<file>.bak`
 *   4. Renomeia `<file>.tmp` → `<file>`
 *   5. Rotaciona .bak.1, .bak.2, ... (até MAX_BAK)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { mzError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const MAX_BAK = 10;

export interface SafeWriteOptions {
  /** Se true, não rotaciona .bak — sobrescreve o .bak existente (default false) */
  skipBackup?: boolean;
  /** Encoding (default 'utf-8') */
  encoding?: BufferEncoding;
}

/**
 * Escreve dados num arquivo de forma atômica, com backup do conteúdo anterior.
 *
 * Aceita string ou Buffer. Para JSON, serializar antes (ou usar safeWriteJson).
 */
export async function safeWrite(
  filePath: string,
  data: string | Buffer,
  opts: SafeWriteOptions = {},
): Promise<void> {
  const encoding = opts.encoding ?? 'utf-8';
  const tmpPath = `${filePath}.tmp`;

  // 1. Escreve no .tmp
  try {
    await fs.writeFile(tmpPath, data, { encoding });
  } catch (err) {
    throw mzError(
      'backup_failed',
      `Falha escrevendo arquivo temporário ${tmpPath}: ${(err as Error).message}`,
    );
  }

  // 2. Rotaciona/cria .bak (se o arquivo original existir e backup ativo)
  if (!opts.skipBackup) {
    try {
      await rotateBackup(filePath);
    } catch (err) {
      // Tenta limpar .tmp órfão antes de propagar
      await safeUnlink(tmpPath);
      throw mzError(
        'backup_failed',
        `Falha rotacionando backups de ${filePath}: ${(err as Error).message}`,
      );
    }
  }

  // 3. Rename atômico .tmp → final
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await safeUnlink(tmpPath);
    throw mzError(
      'backup_failed',
      `Falha no rename atômico ${tmpPath} → ${filePath}: ${(err as Error).message}`,
    );
  }

  logger.debug(`safeWrite: ${filePath} (${typeof data === 'string' ? data.length : data.byteLength} bytes)`);
}

/**
 * Escreve um objeto JSON em arquivo de forma atômica.
 * Indentação padrão: 2 espaços. Acrescenta newline final.
 */
export async function safeWriteJson(
  filePath: string,
  data: unknown,
  opts: SafeWriteOptions & { indent?: number } = {},
): Promise<void> {
  const indent = opts.indent ?? 0; // MZ usa JSON sem indent por padrão
  const serialized = indent > 0 ? JSON.stringify(data, null, indent) : JSON.stringify(data);
  await safeWrite(filePath, serialized + '\n', opts);
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

async function rotateBackup(filePath: string): Promise<void> {
  // Se o arquivo original não existe, não tem backup pra fazer
  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  // Rotaciona .bak.{N-1} → .bak.N, .bak.{N-2} → .bak.{N-1}, ..., .bak → .bak.1
  for (let i = MAX_BAK - 1; i >= 1; i--) {
    const src = `${filePath}.bak.${i}`;
    const dst = `${filePath}.bak.${i + 1}`;
    if (await pathExists(src)) {
      // Sobrescreve dst se existir (caso degenerado)
      if (await pathExists(dst)) await fs.unlink(dst);
      await fs.rename(src, dst);
    }
  }

  // .bak → .bak.1
  const bakPath = `${filePath}.bak`;
  if (await pathExists(bakPath)) {
    const bak1 = `${filePath}.bak.1`;
    if (await pathExists(bak1)) await fs.unlink(bak1);
    await fs.rename(bakPath, bak1);
  }

  // Copia original → .bak (não rename, pra preservar o original durante a rotação)
  await fs.copyFile(filePath, bakPath);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    // ignore
  }
}

/** Helper pra construir caminho relativo ao projeto */
export function inProject(projectPath: string, ...segments: string[]): string {
  return path.join(projectPath, ...segments);
}
