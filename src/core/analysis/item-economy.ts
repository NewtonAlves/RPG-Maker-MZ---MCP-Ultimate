/**
 * Análise: item economy.
 *
 * Pra cada item/arma/armadura:
 *  - DROP: quais enemies podem dropar, com probability (1/denominator)
 *  - SHOP: quais map events vendem (code 302 Shop Processing)
 *  - TREASURE: quais map events dão como tesouro (code 126 Change Items / 127 Change Weapons / 128 Change Armors)
 *
 * Identifica:
 *  - Items inalcançáveis (sem nenhuma source)
 *  - Items raros vs comuns (frequência de sources)
 *  - Desbalanço entre price e drop rate
 */

import type { Config } from '../../config.js';
import {
  forEachCommonEventCommand,
  forEachMapEventCommand,
  forEachTroopEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './shared.js';

export type ItemKind = 'item' | 'weapon' | 'armor';

export interface DropSource {
  enemyId: number;
  enemyName: string;
  denominator: number;
  /** Probability como 1/denominator (ex: denominator=5 → 0.2 = 20%). */
  probability: number;
}

export interface ShopSource {
  mapId?: number;
  mapName?: string;
  eventId?: number;
  commonEventId?: number;
  /** Preço no shop (do shop event params; 0 = preço default do item). */
  price: number;
}

export interface TreasureSource {
  mapId?: number;
  mapName?: string;
  eventId?: number;
  commonEventId?: number;
  troopId?: number;
  amount: number;
}

export interface ItemEconomyEntry {
  kind: ItemKind;
  id: number;
  name: string;
  defaultPrice: number;
  drops: DropSource[];
  shops: ShopSource[];
  treasures: TreasureSource[];
  /** True se nenhuma source — item inalcançável. */
  unreachable: boolean;
  /** Soma de probability de drops + count de shops + count de treasures. */
  availabilityScore: number;
}

export interface ItemEconomyAnalysis {
  totalItems: number;
  totalWeapons: number;
  totalArmors: number;
  unreachableCount: number;
  items: ItemEconomyEntry[];
  weapons: ItemEconomyEntry[];
  armors: ItemEconomyEntry[];
}

interface SourceCollector {
  drops: globalThis.Map<string, DropSource[]>; // key: "kind:id"
  shops: globalThis.Map<string, ShopSource[]>;
  treasures: globalThis.Map<string, TreasureSource[]>;
}

function k(kind: ItemKind, id: number): string {
  return `${kind}:${id}`;
}

function pushTo<T>(m: globalThis.Map<string, T[]>, key: string, v: T): void {
  const list = m.get(key) ?? [];
  list.push(v);
  m.set(key, list);
}

function collectDrops(snapshot: ProjectSnapshot, c: SourceCollector): void {
  for (const enemy of snapshot.enemies) {
    if (!enemy || typeof enemy.id !== 'number') continue;
    const enemyId = enemy.id as number;
    const enemyName = (enemy.name as string) ?? '';
    const dropItems = enemy.dropItems as Array<{ kind: number; dataId: number; denominator: number }> | undefined;
    if (!dropItems) continue;
    for (const drop of dropItems) {
      if (!drop || drop.kind === 0 || drop.dataId === 0) continue;
      const kindMap: Record<number, ItemKind> = { 1: 'item', 2: 'weapon', 3: 'armor' };
      const kind = kindMap[drop.kind];
      if (!kind) continue;
      const denom = drop.denominator > 0 ? drop.denominator : 1;
      pushTo(c.drops, k(kind, drop.dataId), {
        enemyId,
        enemyName,
        denominator: denom,
        probability: 1 / denom,
      });
    }
  }
}

function processItemChangeCommand(
  c: SourceCollector,
  cmd: { code: number; parameters: unknown[] },
  loc: Omit<TreasureSource, 'amount'>,
): void {
  // 126 = Change Items: [itemId, op, operandType, operandValue]
  // 127 = Change Weapons: [weaponId, op, operandType, operandValue, includeEquipment]
  // 128 = Change Armors: [armorId, op, operandType, operandValue, includeEquipment]
  const { code, parameters: p } = cmd;
  const codeMap: Record<number, ItemKind> = { 126: 'item', 127: 'weapon', 128: 'armor' };
  const kind = codeMap[code];
  if (!kind) return;
  const dataId = p[0] as number;
  if (typeof dataId !== 'number' || dataId === 0) return;
  const op = p[1] as number; // 0 = increase, 1 = decrease
  if (op !== 0) return; // só pega "ganho" (operação de aumento)
  const operandType = p[2] as number; // 0 = constant, 1 = variable
  let amount = 1;
  if (operandType === 0 && typeof p[3] === 'number') {
    amount = p[3] as number;
  }
  pushTo(c.treasures, k(kind, dataId), { ...loc, amount });
}

function processShopCommand(
  c: SourceCollector,
  cmd: { code: number; parameters: unknown[] },
  loc: Omit<ShopSource, 'price'>,
): void {
  // 302 = Shop Processing (first item)
  // 605 = Shop Processing (additional items)
  // Params: [kind, dataId, priceType, price, purchaseOnly?]
  if (cmd.code !== 302 && cmd.code !== 605) return;
  const p = cmd.parameters;
  const kindNum = p[0] as number;
  const dataId = p[1] as number;
  const priceType = p[2] as number;
  const price = (priceType === 0 ? 0 : (p[3] as number)) ?? 0;
  if (typeof dataId !== 'number' || dataId === 0) return;
  const kindMap: Record<number, ItemKind> = { 0: 'item', 1: 'weapon', 2: 'armor' };
  const kind = kindMap[kindNum];
  if (!kind) return;
  pushTo(c.shops, k(kind, dataId), { ...loc, price });
}

function collectShopsAndTreasures(snapshot: ProjectSnapshot, c: SourceCollector): void {
  // Maps
  for (const map of snapshot.maps) {
    const mapId = map.mapId;
    const mapName = mapDisplayName(snapshot, mapId);
    forEachMapEventCommand(map, (_mapId, eventId, _pageIndex, _cmdIndex, cmd) => {
      processShopCommand(c, cmd, { mapId, mapName, eventId });
      processItemChangeCommand(c, cmd, { mapId, mapName, eventId });
    });
  }

  // Common events
  forEachCommonEventCommand(snapshot.commonEvents, (id, _i, cmd) => {
    processShopCommand(c, cmd, { commonEventId: id });
    processItemChangeCommand(c, cmd, { commonEventId: id });
  });

  // Troop events (raro, mas possível)
  forEachTroopEventCommand(snapshot.troops, (troopId, _pageIndex, _i, cmd) => {
    processItemChangeCommand(c, cmd, { troopId });
  });
}

function buildEntries(
  kind: ItemKind,
  records: Array<Record<string, unknown>>,
  c: SourceCollector,
): ItemEconomyEntry[] {
  const out: ItemEconomyEntry[] = [];
  for (const r of records) {
    if (!r || typeof r.id !== 'number') continue;
    const id = r.id as number;
    if (id <= 0) continue;
    const name = (r.name as string) ?? '';
    const defaultPrice = (r.price as number) ?? 0;
    const drops = c.drops.get(k(kind, id)) ?? [];
    const shops = c.shops.get(k(kind, id)) ?? [];
    const treasures = c.treasures.get(k(kind, id)) ?? [];
    const unreachable = drops.length === 0 && shops.length === 0 && treasures.length === 0;
    const availabilityScore =
      drops.reduce((sum, d) => sum + d.probability, 0) +
      shops.length +
      treasures.length;
    out.push({
      kind,
      id,
      name,
      defaultPrice,
      drops,
      shops,
      treasures,
      unreachable,
      availabilityScore: Math.round(availabilityScore * 1000) / 1000,
    });
  }
  return out;
}

export async function analyzeItemEconomy(config: Config): Promise<ItemEconomyAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): ItemEconomyAnalysis {
  const c: SourceCollector = {
    drops: new Map(),
    shops: new Map(),
    treasures: new Map(),
  };
  collectDrops(snapshot, c);
  collectShopsAndTreasures(snapshot, c);

  const items = buildEntries('item', snapshot.items, c);
  const weapons = buildEntries('weapon', snapshot.weapons, c);
  const armors = buildEntries('armor', snapshot.armors, c);

  const unreachableCount =
    items.filter((e) => e.unreachable && e.name).length +
    weapons.filter((e) => e.unreachable && e.name).length +
    armors.filter((e) => e.unreachable && e.name).length;

  return {
    totalItems: items.length,
    totalWeapons: weapons.length,
    totalArmors: armors.length,
    unreachableCount,
    items,
    weapons,
    armors,
  };
}
