/**
 * Detecta o caminho de instalação do RPG Maker MZ no sistema.
 *
 * Ordem de busca:
 *   1. Env var MZ_INSTALL_PATH (resolvida pelo loader de config antes daqui)
 *   2. Caminhos canônicos por OS
 *   3. (futuro) Steam library config
 *
 * Retorna o caminho absoluto se uma pasta MZ válida for encontrada, senão undefined.
 * "Válida" = tem subpasta `corescript/` OU `newdata/`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const WINDOWS_STEAM_PATHS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ',
  'C:\\Program Files\\Steam\\steamapps\\common\\RPG Maker MZ',
  'D:\\Steam\\steamapps\\common\\RPG Maker MZ',
  'D:\\SteamLibrary\\steamapps\\common\\RPG Maker MZ',
  'E:\\SteamLibrary\\steamapps\\common\\RPG Maker MZ',
];

const MAC_PATHS = [
  '/Applications/RPG Maker MZ.app',
  path.join(os.homedir(), 'Library/Application Support/Steam/steamapps/common/RPG Maker MZ'),
];

const LINUX_PATHS = [
  path.join(os.homedir(), '.steam/steam/steamapps/common/RPG Maker MZ'),
  path.join(os.homedir(), '.local/share/Steam/steamapps/common/RPG Maker MZ'),
];

export async function detectMzInstallPath(): Promise<string | undefined> {
  const candidates = pickCandidatesForPlatform();
  for (const candidate of candidates) {
    if (await isValidMzInstall(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function pickCandidatesForPlatform(): string[] {
  switch (process.platform) {
    case 'win32':
      return WINDOWS_STEAM_PATHS;
    case 'darwin':
      return MAC_PATHS;
    case 'linux':
      return LINUX_PATHS;
    default:
      return [];
  }
}

export async function isValidMzInstall(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isDirectory()) return false;
    // Marcadores: corescript/ ou newdata/
    const corescript = path.join(candidate, 'corescript');
    const newdata = path.join(candidate, 'newdata');
    const [a, b] = await Promise.allSettled([fs.stat(corescript), fs.stat(newdata)]);
    return (
      (a.status === 'fulfilled' && a.value.isDirectory()) ||
      (b.status === 'fulfilled' && b.value.isDirectory())
    );
  } catch {
    return false;
  }
}

/** Lista versões de corescript disponíveis na instalação (ex.: ["v1.6.0", "v1.9.0"]) */
export async function listCorescriptVersions(installPath: string): Promise<string[]> {
  const corescriptDir = path.join(installPath, 'corescript');
  try {
    const entries = await fs.readdir(corescriptDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith('v'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Resolve o caminho da pasta corescript pra uma versão específica */
export function corescriptPath(installPath: string, version: string): string {
  return path.join(installPath, 'corescript', version);
}
