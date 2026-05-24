/**
 * Loader singleton dos catálogos MZ (event commands, effects, traits, tileset flags)
 * + catálogos da comunidade (notetags, plugin compat, damage formulas).
 *
 * Carrega JSONs via fs.readFileSync no boot (Node 24+ não aceita import JSON
 * sem `with { type: 'json' }`, e TypeScript ES2022 não suporta essa sintaxe).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ============================ Types ============================ */

export interface ParamSpec {
  name: string;
  type: string;
  description?: string;
}

export interface EventCommandSpec {
  code: number;
  name: string;
  category: string;
  params: ParamSpec[];
  bodyCode?: number[];
  mzOnly?: boolean;
  description?: string;
}

export interface EffectSpec {
  code: number;
  name: string;
  display: string;
  dataIdMeaning: string;
  value1Meaning: string;
  value2Meaning: string;
  example: { dataId: number; value1: number; value2: number };
  humanExample?: string;
}

export interface TraitSpec {
  code: number;
  name: string;
  display: string;
  dataIdMeaning: string;
  valueMeaning: string;
  example: { dataId: number; value: number };
  humanExample?: string;
  xparamMap?: Record<string, string>;
  sparamMap?: Record<string, string>;
}

export interface TilesetFlagsSpec {
  version: string;
  description: string;
  bits: {
    passage: { bits: string; mask: number; description: string; directions: Record<string, string>; bitValues: Record<string, number> };
    ladder: { bit: number; mask: number; description: string };
    bush: { bit: number; mask: number; description: string };
    counter: { bit: number; mask: number; description: string };
    damage_floor: { bit: number; mask: number; description: string };
    terrain_tag: { bits: string; mask: number; shift: number; range: string; description: string };
  };
  formulas: Record<string, string>;
}

export interface NotetagSpec {
  id: string;
  tag: string;
  appliesTo: string[];
  source: string;
  syntax: string;
  description: string;
  example: string;
}

export interface CompatIssue {
  id: string;
  plugin: string;
  issue: string;
  target: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  fix: string;
}

export interface DamageFormulaPreset {
  id: string;
  displayName: string;
  formula: string;
  type: number;
  variance: number;
  critical: boolean;
  description: string;
  tags: string[];
  skillExample?: string;
}

/* ============================ Load JSONs from disk ============================ */

const __dirname_loader = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(__dirname_loader, '..', 'data');

function loadJson<T>(relPath: string): T {
  const full = path.join(dataRoot, relPath);
  return JSON.parse(fs.readFileSync(full, 'utf-8')) as T;
}

const eventCommandsRaw = loadJson<{ commands: EventCommandSpec[] }>('mz-codes/event-commands.json');
const effectCodesRaw = loadJson<{ effects: EffectSpec[] }>('mz-codes/effect-codes.json');
const traitCodesRaw = loadJson<{ traits: TraitSpec[]; paramMap: Record<string, string> }>('mz-codes/trait-codes.json');
const tilesetFlagsRaw = loadJson<TilesetFlagsSpec>('mz-codes/tileset-flags.json');
const notetagsRaw = loadJson<{ notetags: NotetagSpec[] }>('community/notetags.json');
const pluginCompatRaw = loadJson<{ issues: CompatIssue[]; recommendedLoadOrder: string[] }>('community/plugin-compat.json');
const damageFormulasRaw = loadJson<{ presets: DamageFormulaPreset[] }>('community/damage-formulas.json');

/* ============================ Indexed catalogs ============================ */

/** Indexed by code (number) */
export const EVENT_COMMANDS_BY_CODE: Record<number, EventCommandSpec> = Object.fromEntries(
  (eventCommandsRaw.commands as EventCommandSpec[]).map((c) => [c.code, c]),
);

/** Indexed by name (string, snake_case) */
export const EFFECT_CODES: Record<string, EffectSpec> = Object.fromEntries(
  (effectCodesRaw.effects as EffectSpec[]).map((e) => [e.name, e]),
);

/** Indexed by name */
export const TRAIT_CODES: Record<string, TraitSpec> = Object.fromEntries(
  (traitCodesRaw.traits as TraitSpec[]).map((t) => [t.name, t]),
);

/** Indexed by name + by code */
export const EFFECT_CODES_BY_CODE: Record<number, EffectSpec> = Object.fromEntries(
  (effectCodesRaw.effects as EffectSpec[]).map((e) => [e.code, e]),
);
export const TRAIT_CODES_BY_CODE: Record<number, TraitSpec> = Object.fromEntries(
  (traitCodesRaw.traits as TraitSpec[]).map((t) => [t.code, t]),
);

export const TILESET_FLAGS = tilesetFlagsRaw as unknown as TilesetFlagsSpec;
export const NOTETAGS = notetagsRaw.notetags as NotetagSpec[];
export const PLUGIN_COMPAT = pluginCompatRaw.issues as CompatIssue[];
export const PLUGIN_LOAD_ORDER = pluginCompatRaw.recommendedLoadOrder as string[];
export const DAMAGE_FORMULAS: Record<string, DamageFormulaPreset> = Object.fromEntries(
  (damageFormulasRaw.presets as DamageFormulaPreset[]).map((p) => [p.id, p]),
);

/* paramMap pra trait codes (0-7: mhp/mmp/atk/def/mat/mdf/agi/luk) */
export const PARAM_MAP = traitCodesRaw.paramMap as Record<string, string>;

/* ============================ Lookup helpers ============================ */

/** Acha event command por code ou name (case-insensitive em name). */
export function findEventCommand(codeOrName: number | string): EventCommandSpec | undefined {
  if (typeof codeOrName === 'number') return EVENT_COMMANDS_BY_CODE[codeOrName];
  const lower = codeOrName.toLowerCase();
  return (eventCommandsRaw.commands as EventCommandSpec[]).find(
    (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().replace(/\s+/g, '_') === lower,
  );
}

/** Lista de codes filtrados por categoria/mzOnly/text. */
export function searchEventCommands(opts: {
  category?: string;
  namePartial?: string;
  mzOnly?: boolean;
}): EventCommandSpec[] {
  return (eventCommandsRaw.commands as EventCommandSpec[]).filter((c) => {
    if (opts.category && c.category !== opts.category) return false;
    if (opts.mzOnly !== undefined && c.mzOnly !== opts.mzOnly) return false;
    if (opts.namePartial && !c.name.toLowerCase().includes(opts.namePartial.toLowerCase())) return false;
    return true;
  });
}

/** Lista todas as categorias únicas de event commands. */
export function listEventCommandCategories(): string[] {
  const set = new Set<string>();
  for (const c of eventCommandsRaw.commands as EventCommandSpec[]) set.add(c.category);
  return Array.from(set).sort();
}

export function effectByName(name: string): EffectSpec | undefined {
  return EFFECT_CODES[name];
}

export function traitByName(name: string): TraitSpec | undefined {
  return TRAIT_CODES[name];
}

/** Encode flag bits pra tileset a partir de struct legível. */
export function encodeTilesetFlag(opts: {
  blockedDirs?: ('down' | 'left' | 'right' | 'up')[];
  ladder?: boolean;
  bush?: boolean;
  counter?: boolean;
  damage_floor?: boolean;
  terrain_tag?: number;
}): number {
  let flag = 0;
  if (opts.blockedDirs) {
    for (const d of opts.blockedDirs) {
      flag |= TILESET_FLAGS.bits.passage.bitValues[d] ?? 0;
    }
  }
  if (opts.ladder) flag |= TILESET_FLAGS.bits.ladder.mask;
  if (opts.bush) flag |= TILESET_FLAGS.bits.bush.mask;
  if (opts.counter) flag |= TILESET_FLAGS.bits.counter.mask;
  if (opts.damage_floor) flag |= TILESET_FLAGS.bits.damage_floor.mask;
  if (opts.terrain_tag !== undefined && opts.terrain_tag >= 0 && opts.terrain_tag <= 7) {
    flag |= (opts.terrain_tag & 7) << TILESET_FLAGS.bits.terrain_tag.shift;
  }
  return flag;
}

/** Decode flag pra struct legível. */
export function decodeTilesetFlag(flag: number): {
  passage: { down: boolean; left: boolean; right: boolean; up: boolean };
  ladder: boolean;
  bush: boolean;
  counter: boolean;
  damage_floor: boolean;
  terrain_tag: number;
} {
  return {
    passage: {
      down: (flag & 1) === 0,
      left: (flag & 2) === 0,
      right: (flag & 4) === 0,
      up: (flag & 8) === 0,
    },
    ladder: (flag & TILESET_FLAGS.bits.ladder.mask) !== 0,
    bush: (flag & TILESET_FLAGS.bits.bush.mask) !== 0,
    counter: (flag & TILESET_FLAGS.bits.counter.mask) !== 0,
    damage_floor: (flag & TILESET_FLAGS.bits.damage_floor.mask) !== 0,
    terrain_tag: (flag >> TILESET_FLAGS.bits.terrain_tag.shift) & 7,
  };
}

/** Notetags filtrados por categoria de record (skill, weapon, etc.) */
export function notetagsForCategory(category: string): NotetagSpec[] {
  return NOTETAGS.filter((n) => n.appliesTo.includes(category));
}

/** Compat issues que mencionam um plugin específico. */
export function compatIssuesForPlugin(pluginName: string): CompatIssue[] {
  return PLUGIN_COMPAT.filter((i) => {
    if (i.plugin === pluginName) return true;
    if (i.target === pluginName) return true;
    // wildcard match (YEP_*)
    if (i.plugin.endsWith('*') && pluginName.startsWith(i.plugin.slice(0, -1))) return true;
    return false;
  });
}

/** Damage formula presets filtrados. */
export function searchDamageFormulas(opts: { tags?: string[]; type?: number }): DamageFormulaPreset[] {
  return Object.values(DAMAGE_FORMULAS).filter((p) => {
    if (opts.type !== undefined && p.type !== opts.type) return false;
    if (opts.tags && opts.tags.length > 0) {
      if (!opts.tags.every((t) => p.tags.includes(t))) return false;
    }
    return true;
  });
}
