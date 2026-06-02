/**
 * Varredura completa de referências a assets em data files. Usado por
 * mz_clean_unused_assets.
 *
 * Coleta nomes (sem extensão) de imagens e áudio referenciados nos JSONs.
 * Imagens não têm `.png` no JSON; áudio referencia sem `.ogg`/`.m4a`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from '../config.js';
import { loadDbRecords } from './db-io.js';
import { listMapIds, loadMap } from './map-io.js';

export interface AssetReferences {
  imagesByFolder: Record<string, Set<string>>;
  audioByFolder: Record<string, Set<string>>;
}

const IMAGE_FOLDERS = [
  'characters', 'faces', 'tilesets', 'parallaxes', 'pictures', 'enemies',
  'animations', 'battlebacks1', 'battlebacks2', 'sv_actors', 'sv_enemies',
  'system', 'titles1', 'titles2',
];
const AUDIO_FOLDERS = ['bgm', 'bgs', 'me', 'se'];

export async function collectReferences(config: Config): Promise<AssetReferences> {
  const refs: AssetReferences = {
    imagesByFolder: Object.fromEntries(IMAGE_FOLDERS.map((f) => [f, new Set<string>()])),
    audioByFolder: Object.fromEntries(AUDIO_FOLDERS.map((f) => [f, new Set<string>()])),
  };

  // System.json — vehicles, titles, sounds
  const sysPath = path.join(config.project.path, 'data', 'System.json');
  try {
    const sys = JSON.parse(await fs.readFile(sysPath, 'utf-8'));
    pushAudio(refs, 'bgm', sys.titleBgm?.name);
    pushAudio(refs, 'bgm', sys.battleBgm?.name);
    pushAudio(refs, 'me', sys.defeatMe?.name);
    pushAudio(refs, 'me', sys.victoryMe?.name);
    pushAudio(refs, 'me', sys.gameoverMe?.name);
    pushImage(refs, 'titles1', sys.title1Name);
    pushImage(refs, 'titles2', sys.title2Name);
    for (const v of [sys.boat, sys.ship, sys.airship]) {
      if (v) {
        pushImage(refs, 'characters', v.characterName);
        pushAudio(refs, 'bgm', v.bgm?.name);
      }
    }
    if (Array.isArray(sys.sounds)) {
      for (const s of sys.sounds) pushAudio(refs, 'se', s?.name);
    }
    // testBattler battlerName
    if (Array.isArray(sys.testBattlers)) {
      // pode usar sv_actors do testBattlers
    }
  } catch {}

  // Actors
  for (const a of await loadDbRecords(config, 'actor')) {
    pushImage(refs, 'characters', a.characterName as string);
    pushImage(refs, 'faces', a.faceName as string);
    pushImage(refs, 'sv_actors', a.battlerName as string);
  }
  // Enemies
  for (const e of await loadDbRecords(config, 'enemy')) {
    pushImage(refs, 'enemies', e.battlerName as string);
    pushImage(refs, 'sv_enemies', e.battlerName as string);
  }
  // Animations (Effekseer effectName + img/animations fallback)
  for (const an of await loadDbRecords(config, 'animation')) {
    pushImage(refs, 'animations', an.effectName as string);
  }
  // Tilesets
  for (const t of await loadDbRecords(config, 'tileset')) {
    if (Array.isArray(t.tilesetNames)) {
      for (const n of t.tilesetNames as string[]) pushImage(refs, 'tilesets', n);
    }
  }

  // Maps
  const mapIds = await listMapIds(config);
  for (const id of mapIds) {
    try {
      const m = await loadMap(config, id);
      pushImage(refs, 'parallaxes', m.parallaxName);
      pushImage(refs, 'battlebacks1', m.battleback1Name);
      pushImage(refs, 'battlebacks2', m.battleback2Name);
      pushAudio(refs, 'bgm', m.bgm?.name);
      pushAudio(refs, 'bgs', m.bgs?.name);
      // events: Show Picture (231), Play SE (250), Play BGM (241), Play BGS (245), Play ME (249), Show Animation (212), etc.
      for (const ev of m.events) {
        if (!ev) continue;
        for (const page of ev.pages) {
          // Imagem do char
          if (page.image?.characterName) pushImage(refs, 'characters', page.image.characterName);
          for (const cmd of page.list) {
            scanCommand(refs, cmd);
          }
        }
      }
    } catch {}
  }

  // Common Events
  for (const ce of await loadDbRecords(config, 'common_event')) {
    const list = ce.list as { code: number; parameters: unknown[] }[] | undefined;
    if (!Array.isArray(list)) continue;
    for (const cmd of list) scanCommand(refs, cmd);
  }

  // Troops (battle event pages)
  for (const tr of await loadDbRecords(config, 'troop')) {
    const pages = tr.pages as { list?: { code: number; parameters: unknown[] }[] }[] | undefined;
    if (!Array.isArray(pages)) continue;
    for (const p of pages) {
      if (Array.isArray(p.list)) {
        for (const cmd of p.list) scanCommand(refs, cmd);
      }
    }
  }

  return refs;
}

function scanCommand(
  refs: AssetReferences,
  cmd: { code: number; parameters: unknown[] },
): void {
  // 101: Show Text faceName
  if (cmd.code === 101 && typeof cmd.parameters[0] === 'string') {
    pushImage(refs, 'faces', cmd.parameters[0]);
  }
  // 231: Show Picture
  if (cmd.code === 231 && typeof cmd.parameters[1] === 'string') {
    pushImage(refs, 'pictures', cmd.parameters[1]);
  }
  // 241: Play BGM
  if (cmd.code === 241 && typeof cmd.parameters[0] === 'object') {
    pushAudio(refs, 'bgm', (cmd.parameters[0] as { name?: string })?.name);
  }
  // 245: Play BGS
  if (cmd.code === 245 && typeof cmd.parameters[0] === 'object') {
    pushAudio(refs, 'bgs', (cmd.parameters[0] as { name?: string })?.name);
  }
  // 249: Play ME
  if (cmd.code === 249 && typeof cmd.parameters[0] === 'object') {
    pushAudio(refs, 'me', (cmd.parameters[0] as { name?: string })?.name);
  }
  // 250: Play SE
  if (cmd.code === 250 && typeof cmd.parameters[0] === 'object') {
    pushAudio(refs, 'se', (cmd.parameters[0] as { name?: string })?.name);
  }
  // 282: Change Parallax
  if (cmd.code === 282 && typeof cmd.parameters[0] === 'string') {
    pushImage(refs, 'parallaxes', cmd.parameters[0]);
  }
  // 283: Change Battleback
  if (cmd.code === 283) {
    if (typeof cmd.parameters[0] === 'string') pushImage(refs, 'battlebacks1', cmd.parameters[0]);
    if (typeof cmd.parameters[1] === 'string') pushImage(refs, 'battlebacks2', cmd.parameters[1]);
  }
}

function pushImage(refs: AssetReferences, folder: string, name: unknown): void {
  if (typeof name !== 'string' || name.length === 0) return;
  refs.imagesByFolder[folder]?.add(name);
}
function pushAudio(refs: AssetReferences, folder: string, name: unknown): void {
  if (typeof name !== 'string' || name.length === 0) return;
  refs.audioByFolder[folder]?.add(name);
}

/** Lista arquivos físicos numa pasta. */
export async function listAssetFiles(
  projectPath: string,
  folder: string,
  kind: 'image' | 'audio',
): Promise<string[]> {
  const dir = path.join(projectPath, kind === 'image' ? 'img' : 'audio', folder);
  try {
    const all = await fs.readdir(dir);
    if (kind === 'image') return all.filter((f) => f.endsWith('.png'));
    return all.filter((f) => f.endsWith('.ogg') || f.endsWith('.m4a'));
  } catch {
    return [];
  }
}

/** Lista arquivos Effekseer (.efkefc) em effects/ — animações MZ. */
export async function listEffectFiles(projectPath: string): Promise<string[]> {
  const dir = path.join(projectPath, 'effects');
  try {
    const all = await fs.readdir(dir);
    return all.filter((f) => f.endsWith('.efkefc'));
  } catch {
    return [];
  }
}

export interface MissingReference {
  /** Pasta lógica (ex: "img/characters", "audio/bgm", "effects"). */
  folder: string;
  /** Nome referenciado (sem extensão) que não foi encontrado exato. */
  name: string;
  kind: 'image' | 'audio' | 'effect';
  /** "missing" = nenhum arquivo; "case_mismatch" = existe com case diferente (quebra em export web/Linux). */
  severity: 'missing' | 'case_mismatch';
  /** Se case_mismatch, o nome real do arquivo no disco. */
  actualFile?: string;
}

/**
 * Computa referências de asset que apontam pra arquivos AUSENTES no disco.
 * É a direção inversa de computeUnusedAssets: pra cada nome referenciado no
 * banco/mapas, verifica se o arquivo físico existe.
 *
 * Distingue:
 *  - missing: nenhum arquivo com aquele nome → sprite em branco / áudio mudo / crash
 *  - case_mismatch: existe com case diferente → funciona no Windows mas QUEBRA em
 *    export web/Linux (filesystem case-sensitive)
 *
 * Animações são checadas em effects/*.efkefc (Effekseer), não img/animations.
 */
export async function computeMissingReferences(config: Config): Promise<{
  totalReferenced: number;
  missing: MissingReference[];
  byCategory: Record<string, number>;
}> {
  const refs = await collectReferences(config);
  const missing: MissingReference[] = [];
  const byCategory: Record<string, number> = {};
  let totalReferenced = 0;

  // Helper: dado um Set de nomes referenciados + lista de arquivos físicos (com ext),
  // produz missing/case_mismatch. stripExt remove a extensão pra comparar basename.
  const diff = (
    logicalFolder: string,
    referenced: Set<string>,
    physicalFiles: string[],
    stripExt: (f: string) => string,
    kind: MissingReference['kind'],
  ) => {
    totalReferenced += referenced.size;
    // Mapa lowercase → nome real, pra detectar case mismatch
    const exactSet = new Set<string>();
    const lowerToReal = new Map<string, string>();
    for (const f of physicalFiles) {
      const base = stripExt(f);
      exactSet.add(base);
      lowerToReal.set(base.toLowerCase(), f);
    }
    for (const name of referenced) {
      if (exactSet.has(name)) continue; // existe exato — ok
      const lowerHit = lowerToReal.get(name.toLowerCase());
      if (lowerHit) {
        missing.push({ folder: logicalFolder, name, kind, severity: 'case_mismatch', actualFile: lowerHit });
        byCategory[logicalFolder] = (byCategory[logicalFolder] ?? 0) + 1;
      } else {
        missing.push({ folder: logicalFolder, name, kind, severity: 'missing' });
        byCategory[logicalFolder] = (byCategory[logicalFolder] ?? 0) + 1;
      }
    }
  };

  for (const folder of IMAGE_FOLDERS) {
    const referenced = refs.imagesByFolder[folder] ?? new Set();
    if (referenced.size === 0) continue;
    if (folder === 'animations') {
      // Animações MZ = Effekseer em effects/*.efkefc
      const effects = await listEffectFiles(config.project.path);
      diff('effects', referenced, effects, (f) => f.replace(/\.efkefc$/i, ''), 'effect');
    } else {
      const files = await listAssetFiles(config.project.path, folder, 'image');
      diff(`img/${folder}`, referenced, files, (f) => f.replace(/\.png$/i, ''), 'image');
    }
  }
  for (const folder of AUDIO_FOLDERS) {
    const referenced = refs.audioByFolder[folder] ?? new Set();
    if (referenced.size === 0) continue;
    const files = await listAssetFiles(config.project.path, folder, 'audio');
    diff(`audio/${folder}`, referenced, files, (f) => f.replace(/\.(ogg|m4a)$/i, ''), 'audio');
  }

  return { totalReferenced, missing, byCategory };
}

/** Computa lista de assets não-referenciados. */
export async function computeUnusedAssets(config: Config): Promise<{
  unused: { folder: string; file: string; kind: 'image' | 'audio' }[];
  referencedCounts: Record<string, number>;
}> {
  const refs = await collectReferences(config);
  const unused: { folder: string; file: string; kind: 'image' | 'audio' }[] = [];
  const referencedCounts: Record<string, number> = {};

  for (const folder of IMAGE_FOLDERS) {
    const files = await listAssetFiles(config.project.path, folder, 'image');
    const referenced = refs.imagesByFolder[folder] ?? new Set();
    referencedCounts[`img/${folder}`] = referenced.size;
    for (const f of files) {
      const baseName = f.replace(/\.png$/i, '');
      if (!referenced.has(baseName)) {
        unused.push({ folder: `img/${folder}`, file: f, kind: 'image' });
      }
    }
  }
  for (const folder of AUDIO_FOLDERS) {
    const files = await listAssetFiles(config.project.path, folder, 'audio');
    const referenced = refs.audioByFolder[folder] ?? new Set();
    referencedCounts[`audio/${folder}`] = referenced.size;
    for (const f of files) {
      const baseName = f.replace(/\.(ogg|m4a)$/i, '');
      if (!referenced.has(baseName)) {
        unused.push({ folder: `audio/${folder}`, file: f, kind: 'audio' });
      }
    }
  }
  return { unused, referencedCounts };
}
