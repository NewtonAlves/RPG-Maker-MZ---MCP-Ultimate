/**
 * Helpers compartilhados pelas análises do projeto.
 *
 * Centraliza a leitura de TODOS os mapas + eventos numa única passada, evitando
 * que cada análise re-leia o projeto inteiro. Análises declaram quais dados precisam.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from '../../config.js';
import { listMapIds, loadMap, mapFileName } from '../map-io.js';
import type { Map } from '../../schemas/data/map.js';
import { loadDbRaw } from '../db-io.js';

/** Map carregado com mapId anexado (vem do nome do arquivo, não do schema). */
export type MapWithId = Map & { mapId: number };

/* ============================ Tipos ============================ */

/**
 * Snapshot consolidado do projeto pra análises. Usado como entrada de cada analyzer.
 * Carrega lazy: cada campo só é populado se solicitado em loadProjectSnapshot.
 */
export interface ProjectSnapshot {
  maps: MapWithId[];
  mapInfos: Record<number, { name?: string; parentId?: number; order?: number }>;
  actors: Array<Record<string, unknown>>;
  classes: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  weapons: Array<Record<string, unknown>>;
  armors: Array<Record<string, unknown>>;
  enemies: Array<Record<string, unknown>>;
  troops: Array<Record<string, unknown>>;
  states: Array<Record<string, unknown>>;
  animations: Array<Record<string, unknown>>;
  tilesets: Array<Record<string, unknown>>;
  commonEvents: Array<Record<string, unknown>>;
  system: Record<string, unknown>;
}

export interface LoadSnapshotOptions {
  /** Carrega maps (default: true). Off pra análises que não precisam de eventos. */
  maps?: boolean;
  /** Carrega database completo (default: true). */
  database?: boolean;
}

/* ============================ Loader principal ============================ */

/**
 * Carrega snapshot consolidado do projeto. Por padrão carrega TUDO.
 */
export async function loadProjectSnapshot(
  config: Config,
  options: LoadSnapshotOptions = {},
): Promise<ProjectSnapshot> {
  const includeMaps = options.maps !== false;
  const includeDb = options.database !== false;

  const snapshot: ProjectSnapshot = {
    maps: [],
    mapInfos: {},
    actors: [],
    classes: [],
    skills: [],
    items: [],
    weapons: [],
    armors: [],
    enemies: [],
    troops: [],
    states: [],
    animations: [],
    tilesets: [],
    commonEvents: [],
    system: {},
  };

  const tasks: Array<Promise<void>> = [];

  if (includeMaps) {
    tasks.push(
      (async () => {
        const ids = await listMapIds(config);
        const loadedMaps: MapWithId[] = [];
        const concurrency = 8;
        for (let i = 0; i < ids.length; i += concurrency) {
          const chunk = ids.slice(i, i + concurrency);
          const results = await Promise.all(
            chunk.map(async (id) => {
              const m = await loadMap(config, id).catch(() => null);
              return m ? Object.assign(m, { mapId: id }) : null;
            }),
          );
          for (const m of results) if (m) loadedMaps.push(m);
        }
        snapshot.maps = loadedMaps;

        // MapInfos
        try {
          const infoPath = path.join(config.project.path, 'data', 'MapInfos.json');
          const raw = await fs.readFile(infoPath, 'utf-8');
          const parsed = JSON.parse(raw) as Array<{ id?: number; name?: string; parentId?: number; order?: number } | null>;
          for (const info of parsed) {
            if (info && typeof info.id === 'number') {
              snapshot.mapInfos[info.id] = {
                name: info.name,
                parentId: info.parentId,
                order: info.order,
              };
            }
          }
        } catch {}
      })(),
    );
  }

  if (includeDb) {
    const cats: Array<[keyof ProjectSnapshot, Parameters<typeof loadDbRaw>[1]]> = [
      ['actors', 'actor'],
      ['classes', 'class'],
      ['skills', 'skill'],
      ['items', 'item'],
      ['weapons', 'weapon'],
      ['armors', 'armor'],
      ['enemies', 'enemy'],
      ['troops', 'troop'],
      ['states', 'state'],
      ['animations', 'animation'],
      ['tilesets', 'tileset'],
      ['commonEvents', 'common_event'],
    ];
    for (const [field, cat] of cats) {
      tasks.push(
        loadDbRaw(config, cat)
          .then((raw) => {
            (snapshot as unknown as Record<string, unknown>)[field as string] = raw;
          })
          .catch(() => {}),
      );
    }
    // System
    tasks.push(
      fs
        .readFile(path.join(config.project.path, 'data', 'System.json'), 'utf-8')
        .then((raw) => {
          snapshot.system = JSON.parse(raw);
        })
        .catch(() => {}),
    );
  }

  await Promise.all(tasks);
  return snapshot;
}

/* ============================ Helpers de evento ============================ */

/**
 * Itera todos os event commands de um mapa, chamando o callback pra cada comando.
 * cb recebe (mapId, eventId, pageIndex, commandIndex, command).
 */
export function forEachMapEventCommand(
  map: MapWithId,
  cb: (
    mapId: number,
    eventId: number,
    pageIndex: number,
    commandIndex: number,
    command: { code: number; parameters: unknown[]; indent?: number },
  ) => void,
): void {
  if (!map.events) return;
  for (const event of map.events) {
    if (!event) continue;
    const eventId = event.id;
    if (!event.pages) continue;
    for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
      const page = event.pages[pageIndex];
      if (!page || !page.list) continue;
      for (let cmdIndex = 0; cmdIndex < page.list.length; cmdIndex++) {
        const cmd = page.list[cmdIndex];
        if (!cmd) continue;
        cb(map.mapId, eventId, pageIndex, cmdIndex, cmd as { code: number; parameters: unknown[]; indent?: number });
      }
    }
  }
}

/**
 * Itera commands de TODOS os common events.
 */
export function forEachCommonEventCommand(
  commonEvents: Array<Record<string, unknown>>,
  cb: (
    commonEventId: number,
    commandIndex: number,
    command: { code: number; parameters: unknown[]; indent?: number },
  ) => void,
): void {
  for (const ce of commonEvents) {
    if (!ce || typeof ce.id !== 'number') continue;
    const id = ce.id as number;
    const list = ce.list as Array<{ code: number; parameters: unknown[]; indent?: number }> | undefined;
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const cmd = list[i];
      if (!cmd) continue;
      cb(id, i, cmd);
    }
  }
}

/**
 * Itera commands de eventos de TODAS as troops (battle events).
 */
export function forEachTroopEventCommand(
  troops: Array<Record<string, unknown>>,
  cb: (
    troopId: number,
    pageIndex: number,
    commandIndex: number,
    command: { code: number; parameters: unknown[]; indent?: number },
  ) => void,
): void {
  for (const troop of troops) {
    if (!troop || typeof troop.id !== 'number') continue;
    const troopId = troop.id as number;
    const pages = troop.pages as Array<{ list?: Array<{ code: number; parameters: unknown[]; indent?: number }> }> | undefined;
    if (!pages) continue;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const list = pages[pageIndex]?.list;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const cmd = list[i];
        if (!cmd) continue;
        cb(troopId, pageIndex, i, cmd);
      }
    }
  }
}

/** Resolve nome amigável de mapa (do MapInfos), fallback pra "MapNNN". */
export function mapDisplayName(snapshot: ProjectSnapshot, mapId: number): string {
  const info = snapshot.mapInfos[mapId];
  if (info?.name) return info.name;
  return mapFileName(mapId).replace('.json', '');
}
