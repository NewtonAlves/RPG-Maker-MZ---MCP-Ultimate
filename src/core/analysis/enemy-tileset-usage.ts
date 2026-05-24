/**
 * Análise: enemy_appearances + tileset_usage.
 *
 * Enemy:
 *  - Em que troops aparece
 *  - E essas troops em que map events são forçadas (battle command 301)
 *
 * Tileset:
 *  - Que mapas usam cada tileset (map.tilesetId)
 */

import type { Config } from '../../config.js';
import {
  forEachCommonEventCommand,
  forEachMapEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './shared.js';

/* ============================ Enemy appearances ============================ */

export interface TroopAppearance {
  troopId: number;
  troopName: string;
  position?: { x: number; y: number };
  count: number; // quantas vezes esse enemy aparece nessa troop
}

export interface BattleCallSite {
  troopId: number;
  troopName: string;
  /** Origem: map event ou common event. */
  source:
    | { kind: 'map_event'; mapId: number; mapName: string; eventId: number }
    | { kind: 'common_event'; commonEventId: number };
}

export interface EnemyAppearanceEntry {
  enemyId: number;
  enemyName: string;
  troops: TroopAppearance[];
  battleCalls: BattleCallSite[];
  totalEncounters: number;
  unreachable: boolean;
}

export interface EnemyAppearancesAnalysis {
  totalEnemies: number;
  unreachableCount: number;
  entries: EnemyAppearanceEntry[];
}

export async function analyzeEnemyAppearances(config: Config): Promise<EnemyAppearancesAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeEnemyAppearancesFromSnapshot(snapshot);
}

export function computeEnemyAppearancesFromSnapshot(
  snapshot: ProjectSnapshot,
): EnemyAppearancesAnalysis {
  // Indexa: enemyId → list of TroopAppearance
  const enemyToTroops = new Map<number, TroopAppearance[]>();
  // troopId → metadata
  const troopMeta = new Map<number, { name: string; encounters: number }>();

  for (const troop of snapshot.troops) {
    if (!troop || typeof troop.id !== 'number') continue;
    const troopId = troop.id as number;
    const troopName = (troop.name as string) ?? '';
    troopMeta.set(troopId, { name: troopName, encounters: 0 });
    const members = troop.members as Array<{ enemyId: number; x: number; y: number; hidden?: boolean }> | undefined;
    if (!members) continue;
    // Conta ocorrências do mesmo enemy
    const counts = new Map<number, { count: number; firstPos?: { x: number; y: number } }>();
    for (const m of members) {
      if (!m || typeof m.enemyId !== 'number' || m.enemyId === 0) continue;
      const existing = counts.get(m.enemyId);
      if (existing) {
        existing.count++;
      } else {
        counts.set(m.enemyId, { count: 1, firstPos: { x: m.x, y: m.y } });
      }
    }
    for (const [enemyId, info] of counts) {
      const list = enemyToTroops.get(enemyId) ?? [];
      list.push({
        troopId,
        troopName,
        position: info.firstPos,
        count: info.count,
      });
      enemyToTroops.set(enemyId, list);
    }
  }

  // Battle calls: code 301 = Battle Processing
  const troopBattleCalls = new Map<number, BattleCallSite[]>();
  const pushCall = (troopId: number, site: BattleCallSite) => {
    const list = troopBattleCalls.get(troopId) ?? [];
    list.push(site);
    troopBattleCalls.set(troopId, list);
    const meta = troopMeta.get(troopId);
    if (meta) meta.encounters++;
  };

  // Maps
  for (const map of snapshot.maps) {
    const mapId = map.mapId;
    const mapName = mapDisplayName(snapshot, mapId);
    // Map também tem encounterList — random battles
    const encounterList = (map as unknown as { encounterList?: Array<{ troopId: number; weight?: number }> }).encounterList;
    if (encounterList) {
      for (const enc of encounterList) {
        if (!enc || typeof enc.troopId !== 'number') continue;
        const meta = troopMeta.get(enc.troopId);
        if (meta) meta.encounters++;
        pushCall(enc.troopId, {
          troopId: enc.troopId,
          troopName: troopMeta.get(enc.troopId)?.name ?? '',
          source: { kind: 'map_event', mapId, mapName, eventId: 0 }, // 0 = random encounter
        });
      }
    }
    forEachMapEventCommand(map, (_mapId, eventId, _pageIndex, _cmdIndex, cmd) => {
      if (cmd.code !== 301) return;
      // 301 = Battle Processing: [troopType, troopId, canEscape, canLose]
      // troopType: 0=direct, 1=variable, 2=random (any from current map)
      const troopType = cmd.parameters[0] as number;
      if (troopType !== 0) return; // só conta direct refs
      const troopId = cmd.parameters[1] as number;
      if (typeof troopId !== 'number' || troopId === 0) return;
      pushCall(troopId, {
        troopId,
        troopName: troopMeta.get(troopId)?.name ?? '',
        source: { kind: 'map_event', mapId, mapName, eventId },
      });
    });
  }

  // Common events
  forEachCommonEventCommand(snapshot.commonEvents, (id, _i, cmd) => {
    if (cmd.code !== 301) return;
    const troopType = cmd.parameters[0] as number;
    if (troopType !== 0) return;
    const troopId = cmd.parameters[1] as number;
    if (typeof troopId !== 'number' || troopId === 0) return;
    pushCall(troopId, {
      troopId,
      troopName: troopMeta.get(troopId)?.name ?? '',
      source: { kind: 'common_event', commonEventId: id },
    });
  });

  // Constrói entradas
  const entries: EnemyAppearanceEntry[] = [];
  let unreachableCount = 0;
  for (const enemy of snapshot.enemies) {
    if (!enemy || typeof enemy.id !== 'number') continue;
    const enemyId = enemy.id as number;
    if (enemyId <= 0) continue;
    const enemyName = (enemy.name as string) ?? '';
    const troops = enemyToTroops.get(enemyId) ?? [];
    // Battle calls que envolvem esse enemy
    const battleCalls: BattleCallSite[] = [];
    let totalEncounters = 0;
    for (const t of troops) {
      const calls = troopBattleCalls.get(t.troopId) ?? [];
      for (const c of calls) battleCalls.push(c);
      totalEncounters += calls.length;
    }
    const unreachable = troops.length === 0 || totalEncounters === 0;
    if (unreachable && enemyName.trim().length > 0) unreachableCount++;
    entries.push({
      enemyId,
      enemyName,
      troops,
      battleCalls,
      totalEncounters,
      unreachable,
    });
  }

  entries.sort((a, b) => b.totalEncounters - a.totalEncounters);

  return {
    totalEnemies: entries.length,
    unreachableCount,
    entries,
  };
}

/* ============================ Tileset usage ============================ */

export interface TilesetUsageEntry {
  tilesetId: number;
  tilesetName: string;
  mapCount: number;
  maps: Array<{ mapId: number; mapName: string; width: number; height: number }>;
}

export interface TilesetUsageAnalysis {
  totalTilesets: number;
  unusedCount: number;
  entries: TilesetUsageEntry[];
}

export async function analyzeTilesetUsage(config: Config): Promise<TilesetUsageAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeTilesetUsageFromSnapshot(snapshot);
}

export function computeTilesetUsageFromSnapshot(snapshot: ProjectSnapshot): TilesetUsageAnalysis {
  const byTileset = new Map<number, Array<{ mapId: number; mapName: string; width: number; height: number }>>();
  for (const map of snapshot.maps) {
    const tilesetId = map.tilesetId ?? 0;
    if (tilesetId === 0) continue;
    const list = byTileset.get(tilesetId) ?? [];
    list.push({
      mapId: map.mapId,
      mapName: mapDisplayName(snapshot, map.mapId),
      width: map.width ?? 0,
      height: map.height ?? 0,
    });
    byTileset.set(tilesetId, list);
  }

  const entries: TilesetUsageEntry[] = [];
  let unusedCount = 0;
  for (const ts of snapshot.tilesets) {
    if (!ts || typeof ts.id !== 'number') continue;
    const tilesetId = ts.id as number;
    if (tilesetId <= 0) continue;
    const tilesetName = (ts.name as string) ?? '';
    const maps = byTileset.get(tilesetId) ?? [];
    if (maps.length === 0 && tilesetName.trim().length > 0) unusedCount++;
    entries.push({
      tilesetId,
      tilesetName,
      mapCount: maps.length,
      maps,
    });
  }
  entries.sort((a, b) => b.mapCount - a.mapCount);

  return {
    totalTilesets: entries.length,
    unusedCount,
    entries,
  };
}
