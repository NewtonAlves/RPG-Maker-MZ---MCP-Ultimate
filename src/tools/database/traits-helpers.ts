/**
 * Helpers semânticos pra traits em records (actor/class/weapon/armor/enemy/state).
 *
 * Em vez de:  actor.traits.push({code: 21, dataId: 2, value: 1.2})
 * Use:        db_add_trait("actor", actorId, "param_rate", 2, 1.2)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadDbRaw, saveDbRaw, setRecordAtId, type DbRecord } from '../../core/db-io.js';
import { traitByName, TRAIT_CODES, PARAM_MAP, TRAIT_CODES_BY_CODE } from '../../core/mz-codes-loader.js';
import { DB_CATEGORY_NAMES, type DbCategory } from '../../schemas/registry.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from './index.js';

const TRAIT_KINDS = Object.keys(TRAIT_CODES) as [string, ...string[]];
const TRAIT_CATEGORIES = ['actor', 'class', 'weapon', 'armor', 'enemy', 'state'] as const;
const CategoryEnum = z.enum(TRAIT_CATEGORIES);

export function registerTraitHelperTools(server: McpServer, config: Config): void {
  server.registerTool(
    'db_add_trait',
    {
      description:
        'Adiciona um trait a um record (actor/class/weapon/armor/enemy/state) via nome semântico. ' +
        'kinds: element_rate, debuff_rate, state_rate, state_resist, param_rate, xparam_rate, sparam_rate, ' +
        'attack_element, attack_state, attack_speed, attack_times, attack_skill, stype_add/seal, ' +
        'skill_add/seal, equip_wtype/atype, equip_lock/seal, slot_type, action_plus, special_flag, ' +
        'collapse_type, party_ability.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
        kind: z.enum(TRAIT_KINDS),
        dataId: z.number().int().nonnegative().describe('Ex.: paramId, stateId, elementId — depende do kind'),
        value: z.number().describe('Ex.: multiplier (1.2), chance (0.3), turns (5) — depende do kind'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = traitByName(args.kind);
        if (!spec) throw mzError('schema_validation_failed', `Trait kind "${args.kind}" desconhecido.`);
        const raw = await loadDbRaw(config, args.category as DbCategory);
        const record = raw[args.id];
        if (!record) throw mzError('file_not_found', `${args.category} ${args.id} não existe.`);
        const trait = { code: spec.code, dataId: args.dataId, value: args.value };
        const traits = [...((record.traits as unknown[]) ?? []), trait];
        const updated = { ...record, traits };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, args.category as DbCategory, raw);
        return { category: args.category, id: args.id, addedTrait: trait, kind: args.kind, totalTraits: traits.length };
      }),
  );

  server.registerTool(
    'db_list_traits_decoded',
    {
      description:
        'Lista traits de um record decodificados pra forma human-readable: kind, paramName, ' +
        'multiplier/chance/value, e descrição em texto.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, args.category as DbCategory);
        const record = raw[args.id];
        if (!record) throw mzError('file_not_found', `${args.category} ${args.id} não existe.`);
        const traits = (record.traits as Array<{ code: number; dataId: number; value: number }> | undefined) ?? [];
        const decoded = traits.map((t) => {
          const spec = TRAIT_CODES_BY_CODE[t.code];
          if (!spec) return { ...t, kind: 'unknown', human: `unknown trait code ${t.code}` };
          let human = `${spec.display}: dataId=${t.dataId} value=${t.value}`;
          // Decorações específicas
          if (spec.name === 'param_rate' && PARAM_MAP[String(t.dataId)]) {
            const pct = Math.round((t.value - 1) * 100);
            human = `${PARAM_MAP[String(t.dataId)]?.toUpperCase()} ${pct >= 0 ? '+' : ''}${pct}%`;
          } else if (spec.name === 'element_rate') {
            const pct = Math.round(t.value * 100);
            human = `Element ${t.dataId} damage taken: ${pct}%`;
          } else if (spec.name === 'xparam_rate' && spec.xparamMap) {
            const xp = spec.xparamMap[String(t.dataId)] ?? `xparam ${t.dataId}`;
            const pct = Math.round(t.value * 100);
            human = `${xp.toUpperCase()} ${pct >= 0 ? '+' : ''}${pct}%`;
          } else if (spec.name === 'state_rate') {
            const pct = Math.round(t.value * 100);
            human = `State ${t.dataId} chance: ${pct}%`;
          } else if (spec.name === 'state_resist') {
            human = `Immune to state ${t.dataId}`;
          } else if (spec.name === 'attack_state') {
            const pct = Math.round(t.value * 100);
            human = `${pct}% chance to inflict state ${t.dataId} on attack`;
          }
          return { code: t.code, dataId: t.dataId, value: t.value, kind: spec.name, display: spec.display, human };
        });
        return { category: args.category, id: args.id, traits: decoded, count: decoded.length };
      }),
  );

  server.registerTool(
    'trait_describe',
    {
      description: 'Descreve um trait kind: o que dataId e value significam.',
      inputSchema: z.object({ kind: z.enum(TRAIT_KINDS) }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = traitByName(args.kind);
        if (!spec) throw mzError('file_not_found', `Trait kind "${args.kind}" não encontrado.`);
        return spec;
      }),
  );

  server.registerTool(
    'trait_list_kinds',
    {
      description: 'Lista todos os kinds de trait disponíveis.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({
        count: TRAIT_KINDS.length,
        kinds: TRAIT_KINDS.map((k) => ({ kind: k, display: TRAIT_CODES[k]!.display })),
      })),
  );

  void DB_CATEGORY_NAMES;
}
