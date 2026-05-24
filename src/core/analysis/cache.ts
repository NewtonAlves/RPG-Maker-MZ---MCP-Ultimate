/**
 * Cache de análises baseado em mtime do diretório data/.
 *
 * Antes de re-executar uma análise pesada, checa o mtime mais recente entre
 * todos os arquivos JSON em data/. Se nenhuma mudança desde a última execução,
 * retorna o resultado cached. Caso contrário, re-executa e atualiza o cache.
 *
 * Cache em <project>/.mz-mcp/cache/analysis/<name>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';

interface CacheEnvelope<T> {
  version: 1;
  cachedAt: string;
  dataDirMtime: number;
  result: T;
}

function cachePath(config: Config, name: string): string {
  return path.join(config.project.path, '.mz-mcp', 'cache', 'analysis', `${name}.json`);
}

/**
 * Retorna o maior mtime entre todos os arquivos no diretório data/.
 * Recursivo: cobre Map###.json + json raiz + subpastas se houver.
 */
async function getDataDirLatestMtime(config: Config): Promise<number> {
  const dataDir = path.join(config.project.path, 'data');
  let latest = 0;
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const stat = await fs.stat(fullPath);
          const mtime = stat.mtimeMs;
          if (mtime > latest) latest = mtime;
        } catch {}
      }
    }
  }
  await walk(dataDir);
  return latest;
}

/**
 * Executa `compute` apenas se data/ mudou desde último cache.
 * `force=true` ignora cache e re-executa.
 */
export async function withCache<T>(
  config: Config,
  cacheName: string,
  compute: () => Promise<T>,
  force = false,
): Promise<{ result: T; fromCache: boolean; cachedAt?: string }> {
  const currentMtime = await getDataDirLatestMtime(config);
  const filePath = cachePath(config, cacheName);

  if (!force) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      if (envelope.dataDirMtime === currentMtime) {
        return { result: envelope.result, fromCache: true, cachedAt: envelope.cachedAt };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.debug(`analysis cache read failed for ${cacheName}: ${(err as Error).message}`);
      }
    }
  }

  // Executa
  const result = await compute();

  // Persiste
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const envelope: CacheEnvelope<T> = {
      version: 1,
      cachedAt: new Date().toISOString(),
      dataDirMtime: currentMtime,
      result,
    };
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(envelope), 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    logger.debug(`analysis cache write failed for ${cacheName}: ${(err as Error).message}`);
  }

  return { result, fromCache: false };
}

/**
 * Limpa todos os caches de análise. Útil pra debug ou após mudanças manuais.
 */
export async function clearAllCaches(config: Config): Promise<{ deleted: number }> {
  const dir = path.join(config.project.path, '.mz-mcp', 'cache', 'analysis');
  try {
    const entries = await fs.readdir(dir);
    let deleted = 0;
    for (const entry of entries) {
      try {
        await fs.unlink(path.join(dir, entry));
        deleted++;
      } catch {}
    }
    return { deleted };
  } catch {
    return { deleted: 0 };
  }
}
