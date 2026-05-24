/**
 * Validação e introspecção de projeto RPG Maker MZ.
 *
 * Um projeto MZ válido tem (no mínimo):
 *   - data/System.json
 *   - data/Actors.json
 *   - data/MapInfos.json
 *   - js/plugins.js
 *   - game.rmmzproject  (marcador do projeto MZ — pode estar com nome variável)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { mzError } from '../utils/errors.js';

export interface ProjectInfo {
  path: string;
  hasMzMarker: boolean;
  mzMarkerFile?: string;
  dataFiles: string[];
  mapCount: number;
  pluginCount: number;
  systemVersionId?: number;
  gameTitle?: string;
}

const REQUIRED_DATA_FILES = [
  'System.json',
  'Actors.json',
  'Classes.json',
  'Skills.json',
  'Items.json',
  'Weapons.json',
  'Armors.json',
  'Enemies.json',
  'Troops.json',
  'States.json',
  'Animations.json',
  'Tilesets.json',
  'CommonEvents.json',
  'MapInfos.json',
];

/** Verifica se o caminho é um projeto MZ válido (lança MzMcpError se não for). */
export async function validateProject(projectPath: string): Promise<void> {
  const dataDir = path.join(projectPath, 'data');
  const jsDir = path.join(projectPath, 'js');

  try {
    const dataStat = await fs.stat(dataDir);
    if (!dataStat.isDirectory()) {
      throw mzError('project_invalid', `${dataDir} existe mas não é uma pasta.`);
    }
  } catch {
    throw mzError(
      'project_invalid',
      `Pasta "data/" não encontrada em ${projectPath}. Isso não parece um projeto RPG Maker MZ.`,
    );
  }

  try {
    await fs.stat(jsDir);
  } catch {
    throw mzError(
      'project_invalid',
      `Pasta "js/" não encontrada em ${projectPath}. Isso não parece um projeto RPG Maker MZ.`,
    );
  }
}

/** Coleta informação básica sobre o projeto. */
export async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
  await validateProject(projectPath);

  const dataDir = path.join(projectPath, 'data');
  const dataEntries = await fs.readdir(dataDir);
  const dataFiles = dataEntries.filter((f) => f.endsWith('.json')).sort();

  // Verifica todos os arquivos requeridos estão presentes
  const missing = REQUIRED_DATA_FILES.filter((req) => !dataFiles.includes(req));
  if (missing.length > 0) {
    throw mzError(
      'project_invalid',
      `Projeto incompleto. Faltam: ${missing.join(', ')}`,
      { details: { missing } },
    );
  }

  // Conta mapas (Map###.json)
  const mapCount = dataFiles.filter((f) => /^Map\d{3,}\.json$/.test(f)).length;

  // Plugin count via plugins.js
  let pluginCount = 0;
  try {
    const pluginsJs = await fs.readFile(path.join(projectPath, 'js', 'plugins.js'), 'utf-8');
    // Conta entradas do array $plugins de forma simples (não-parsing)
    // Cada plugin tem um '"name":' entry
    const matches = pluginsJs.match(/"name"\s*:/g);
    pluginCount = matches?.length ?? 0;
  } catch {
    // sem plugins.js — projeto recém-criado talvez
  }

  // Marcador do projeto
  const rootEntries = await fs.readdir(projectPath);
  const mzMarkerFile = rootEntries.find((f) => f.endsWith('.rmmzproject'));

  // versionId + título do System.json
  let systemVersionId: number | undefined;
  let gameTitle: string | undefined;
  try {
    const systemRaw = await fs.readFile(path.join(dataDir, 'System.json'), 'utf-8');
    const system = JSON.parse(systemRaw);
    if (typeof system.versionId === 'number') systemVersionId = system.versionId;
    if (typeof system.gameTitle === 'string') gameTitle = system.gameTitle;
  } catch {
    // ignore — System.json pode estar quebrado e queremos info parcial
  }

  return {
    path: projectPath,
    hasMzMarker: !!mzMarkerFile,
    mzMarkerFile,
    dataFiles,
    mapCount,
    pluginCount,
    systemVersionId,
    gameTitle,
  };
}
