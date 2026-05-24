/**
 * Helper: skill_create_damage — cria uma habilidade de DANO com defaults razoáveis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config.js';
import { loadDbRaw, nextFreeId, saveDbRaw, setRecordAtId } from '../../../core/db-io.js';
import { DAMAGE_FORMULAS } from '../../../core/mz-codes-loader.js';
import { SkillSchema } from '../../../schemas/data/skill.js';
import { mcpReturn } from '../index.js';

export function registerSkillCreateDamageHelper(server: McpServer, config: Config): void {
  server.registerTool(
    'skill_create_damage',
    {
      description:
        'Cria habilidade de dano. Atalho pra db_create("skill",...) com defaults ' +
        'de combate (damage.type=1=HP Damage, scope=1=One Enemy).',
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().default(''),
        mpCost: z.number().int().nonnegative().default(0),
        tpCost: z.number().int().nonnegative().default(0),
        formula: z.string().default('a.atk * 4 - b.def * 2').describe('Fórmula JS de dano. Ignorada se formulaPreset for fornecido.'),
        formulaPreset: z.string().optional().describe('Preset id (ex.: "physical_basic", "magical_high"). Sobrescreve formula. Use damage_formula_list_presets.'),
        elementId: z.number().int().default(0).describe('0=No element, ou ID em System.elements'),
        variance: z.number().int().min(0).max(100).default(20),
        critical: z.boolean().default(true),
        animationId: z.number().int().default(0),
        iconIndex: z.number().int().nonnegative().default(0),
        stypeId: z.number().int().nonnegative().default(1).describe('Skill type (de System)'),
        scope: z.number().int().nonnegative().default(1).describe('1=1 Enemy, 2=All Enemies, etc.'),
        successRate: z.number().int().min(0).max(100).default(100),
        repeats: z.number().int().positive().default(1),
        message1: z.string().default(''),
        message2: z.string().default(''),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        // Aplica preset se fornecido
        let formula = args.formula;
        let variance = args.variance;
        let critical = args.critical;
        let damageType = 1;
        if (args.formulaPreset) {
          const preset = DAMAGE_FORMULAS[args.formulaPreset];
          if (!preset) {
            return { error: 'preset_not_found', message: `Preset "${args.formulaPreset}" não existe. Use damage_formula_list_presets.` };
          }
          formula = preset.formula;
          variance = preset.variance;
          critical = preset.critical;
          damageType = preset.type;
        }
        const raw = await loadDbRaw(config, 'skill');
        const id = nextFreeId(raw);
        const skill = SkillSchema.parse({
          id,
          name: args.name,
          description: args.description,
          iconIndex: args.iconIndex,
          stypeId: args.stypeId,
          mpCost: args.mpCost,
          tpCost: args.tpCost,
          scope: args.scope,
          occasion: 1,
          hitType: 1,
          animationId: args.animationId,
          damage: {
            type: damageType,
            elementId: args.elementId,
            formula,
            variance,
            critical,
          },
          effects: [],
          traits: [],
          message1: args.message1,
          message2: args.message2,
          messageType: 1,
          successRate: args.successRate,
          repeats: args.repeats,
          speed: 0,
          tpGain: 0,
          requiredWtypeId1: 0,
          requiredWtypeId2: 0,
          note: '',
        });
        setRecordAtId(raw, skill);
        await saveDbRaw(config, 'skill', raw, { destructive: false });
        return { id, skill, usedPreset: args.formulaPreset };
      }),
  );
}
