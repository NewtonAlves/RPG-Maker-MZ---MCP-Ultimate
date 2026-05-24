/**
 * Detecta se o editor RPG Maker MZ está atualmente com o projeto aberto.
 *
 * Checagens (em ordem):
 *   1. Processo RPGMZ.exe rodando (Windows) / RPGMZ (Mac/Linux)
 *   2. Lockfile do MZ (futuro — depende de como o MZ trava o projeto)
 *
 * Retorna 'locked' se claramente travado, 'unlocked' se claramente livre,
 * 'unknown' se não foi possível determinar.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export type LockStatus = 'locked' | 'unlocked' | 'unknown';

export async function detectEditorLock(): Promise<LockStatus> {
  try {
    const running = await isMzEditorRunning();
    if (running) return 'locked';
    return 'unlocked';
  } catch (err) {
    logger.debug(`lock-detect: erro na checagem: ${(err as Error).message}`);
    return 'unknown';
  }
}

async function isMzEditorRunning(): Promise<boolean> {
  if (process.platform === 'win32') {
    return await processExistsWindows('RPGMZ.exe');
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return await processExistsUnix('RPGMZ');
  }
  return false;
}

async function processExistsWindows(processName: string): Promise<boolean> {
  try {
    // tasklist é nativo do Windows; filtrar pela imagem
    const { stdout } = await execAsync(
      `tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`,
    );
    return stdout.toLowerCase().includes(processName.toLowerCase());
  } catch {
    return false;
  }
}

async function processExistsUnix(processName: string): Promise<boolean> {
  try {
    // pgrep retorna 0 se acha, 1 se não
    await execAsync(`pgrep -x "${processName}"`);
    return true;
  } catch {
    return false;
  }
}
