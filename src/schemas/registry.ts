/**
 * Registry de categorias de database.
 *
 * Mapeia o nome de categoria (snake_case usado nas tools) pra o arquivo JSON
 * e o schema Zod do record. Quase tudo é "array-of-records": arquivo é
 * `[null, record, record, ...]` (índice 0 reservado, IDs 1-based).
 *
 * Exceções:
 *   - System.json: single object (não é lista de records)
 *   - MapInfos.json / Map###.json: tratados em src/schemas/maps/ (Fase 3)
 */

import type { ZodTypeAny } from 'zod';

import { ActorSchema } from './data/actor.js';
import { AnimationSchema } from './data/animation.js';
import { ArmorSchema } from './data/armor.js';
import { ClassSchema } from './data/class.js';
import { CommonEventSchema } from './data/common-event.js';
import { EnemySchema } from './data/enemy.js';
import { ItemSchema } from './data/item.js';
import { SkillSchema } from './data/skill.js';
import { StateSchema } from './data/state.js';
import { TilesetSchema } from './data/tileset.js';
import { TroopSchema } from './data/troop.js';
import { WeaponSchema } from './data/weapon.js';
import { SystemSchema } from './data/system.js';

export type DbCategory =
  | 'actor'
  | 'class'
  | 'skill'
  | 'item'
  | 'weapon'
  | 'armor'
  | 'enemy'
  | 'troop'
  | 'state'
  | 'animation'
  | 'tileset'
  | 'common_event';

export interface CategoryInfo {
  /** Nome do arquivo dentro de data/ (ex.: "Actors.json") */
  fileName: string;
  /** Schema Zod do record */
  schema: ZodTypeAny;
  /** Nome legível em português */
  label: string;
  /** Plural */
  labelPlural: string;
}

/**
 * Categorias array-of-records (formato `[null, record, record, ...]`).
 * Estas suportam CRUD genérico (db_list, db_get, db_create, etc.).
 */
export const DB_CATEGORIES: Record<DbCategory, CategoryInfo> = {
  actor: {
    fileName: 'Actors.json',
    schema: ActorSchema,
    label: 'personagem',
    labelPlural: 'personagens',
  },
  class: {
    fileName: 'Classes.json',
    schema: ClassSchema,
    label: 'classe',
    labelPlural: 'classes',
  },
  skill: {
    fileName: 'Skills.json',
    schema: SkillSchema,
    label: 'habilidade',
    labelPlural: 'habilidades',
  },
  item: {
    fileName: 'Items.json',
    schema: ItemSchema,
    label: 'item',
    labelPlural: 'itens',
  },
  weapon: {
    fileName: 'Weapons.json',
    schema: WeaponSchema,
    label: 'arma',
    labelPlural: 'armas',
  },
  armor: {
    fileName: 'Armors.json',
    schema: ArmorSchema,
    label: 'armadura',
    labelPlural: 'armaduras',
  },
  enemy: {
    fileName: 'Enemies.json',
    schema: EnemySchema,
    label: 'inimigo',
    labelPlural: 'inimigos',
  },
  troop: {
    fileName: 'Troops.json',
    schema: TroopSchema,
    label: 'grupo de inimigos',
    labelPlural: 'grupos de inimigos',
  },
  state: {
    fileName: 'States.json',
    schema: StateSchema,
    label: 'estado',
    labelPlural: 'estados',
  },
  animation: {
    fileName: 'Animations.json',
    schema: AnimationSchema,
    label: 'animação',
    labelPlural: 'animações',
  },
  tileset: {
    fileName: 'Tilesets.json',
    schema: TilesetSchema,
    label: 'tileset',
    labelPlural: 'tilesets',
  },
  common_event: {
    fileName: 'CommonEvents.json',
    schema: CommonEventSchema,
    label: 'common event',
    labelPlural: 'common events',
  },
};

export const DB_CATEGORY_NAMES = Object.keys(DB_CATEGORIES) as DbCategory[];

/** System.json é tratado à parte (single object, não array-of-records). */
export const SYSTEM_INFO = {
  fileName: 'System.json',
  schema: SystemSchema,
};

export function isDbCategory(s: string): s is DbCategory {
  return s in DB_CATEGORIES;
}

export function getCategoryInfo(category: DbCategory): CategoryInfo {
  return DB_CATEGORIES[category];
}
