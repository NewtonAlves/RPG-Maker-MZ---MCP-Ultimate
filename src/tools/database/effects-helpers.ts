/**
 * Helpers semânticos pra adicionar effects em skills/items (esconde códigos crípticos).
 *
 * Em vez de:  skill.effects.push({code: 11, dataId: 0, value1: 0.5, value2: 100})
 * Use:        skill_add_effect(skillId, "recover_hp", { value1: 0.5, value2: 100 })
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadDbRaw, saveDbRaw, setRecordAtId, type DbRecord } from '../../core/db-io.js';
import { effectByName, EFFECT_CODES } from '../../core/mz-codes-loader.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from './index.js';

const EFFECT_KINDS = Object.keys(EFFECT_CODES) as [string, ...string[]];

export function registerEffectHelperTools(server: McpServer, config: Config): void {
  server.registerTool(
    'skill_add_effect',
    {
      description:
        'Adiciona um effect a uma skill via nome semântico. Substitui montar `{code:N, dataId:N, value1:N, value2:N}` na mão. ' +
        'kinds: recover_hp, recover_mp, gain_tp, add_state, remove_state, add_buff, add_debuff, ' +
        'remove_buff, remove_debuff, special, grow, learn_skill, common_event. ' +
        'Cada kind tem semântica própria pros campos dataId/value1/value2 (use effect_describe pra ver).',
      inputSchema: z.object({
        skillId: z.number().int().positive(),
        kind: z.enum(EFFECT_KINDS),
        dataId: z.number().int().nonnegative().optional().describe('Ex.: stateId, paramId, skillId — depende do kind'),
        value1: z.number().optional(),
        value2: z.number().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = effectByName(args.kind);
        if (!spec) throw mzError('schema_validation_failed', `Effect kind "${args.kind}" desconhecido.`);
        const raw = await loadDbRaw(config, 'skill');
        const skill = raw[args.skillId];
        if (!skill) throw mzError('file_not_found', `Skill ${args.skillId} não existe.`);
        const effect = {
          code: spec.code,
          dataId: args.dataId ?? spec.example.dataId,
          value1: args.value1 ?? spec.example.value1,
          value2: args.value2 ?? spec.example.value2,
        };
        const effects = [...((skill.effects as unknown[]) ?? []), effect];
        const updated = { ...skill, effects };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, 'skill', raw);
        return { skillId: args.skillId, addedEffect: effect, kind: args.kind, totalEffects: effects.length };
      }),
  );

  server.registerTool(
    'item_add_effect',
    {
      description: 'Versão pra items. Mesma semântica de skill_add_effect.',
      inputSchema: z.object({
        itemId: z.number().int().positive(),
        kind: z.enum(EFFECT_KINDS),
        dataId: z.number().int().nonnegative().optional(),
        value1: z.number().optional(),
        value2: z.number().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = effectByName(args.kind);
        if (!spec) throw mzError('schema_validation_failed', `Effect kind "${args.kind}" desconhecido.`);
        const raw = await loadDbRaw(config, 'item');
        const item = raw[args.itemId];
        if (!item) throw mzError('file_not_found', `Item ${args.itemId} não existe.`);
        const effect = {
          code: spec.code,
          dataId: args.dataId ?? spec.example.dataId,
          value1: args.value1 ?? spec.example.value1,
          value2: args.value2 ?? spec.example.value2,
        };
        const effects = [...((item.effects as unknown[]) ?? []), effect];
        const updated = { ...item, effects };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, 'item', raw);
        return { itemId: args.itemId, addedEffect: effect, kind: args.kind, totalEffects: effects.length };
      }),
  );

  server.registerTool(
    'effect_describe',
    {
      description: 'Descreve um effect kind: o que cada campo significa, exemplo, code numérico interno.',
      inputSchema: z.object({
        kind: z.enum(EFFECT_KINDS),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = effectByName(args.kind);
        if (!spec) throw mzError('file_not_found', `Effect kind "${args.kind}" não encontrado.`);
        return spec;
      }),
  );

  server.registerTool(
    'effect_list_kinds',
    {
      description: 'Lista todos os kinds de effect disponíveis com display name.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({
        count: EFFECT_KINDS.length,
        kinds: EFFECT_KINDS.map((k) => ({ kind: k, display: EFFECT_CODES[k]!.display })),
      })),
  );
}
