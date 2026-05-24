/**
 * Helper: skill_create_healing — cria habilidade de CURA com defaults razoáveis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config.js';
import { loadDbRaw, nextFreeId, saveDbRaw, setRecordAtId } from '../../../core/db-io.js';
import { DAMAGE_FORMULAS } from '../../../core/mz-codes-loader.js';
import { SkillSchema } from '../../../schemas/data/skill.js';
import { mcpReturn } from '../index.js';

export function registerSkillCreateHealingHelper(server: McpServer, config: Config): void {
  server.registerTool(
    'skill_create_healing',
    {
      description:
        'Cria habilidade de cura. damage.type=3=HP Recover, scope=7=One Ally. ' +
        'Use formula como "a.mat * 4 + 100" pra cura escalada.',
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().default(''),
        mpCost: z.number().int().nonnegative().default(8),
        tpCost: z.number().int().nonnegative().default(0),
        formula: z.string().default('a.mat * 4 + 100').describe('Fórmula JS de cura. Ignorada se formulaPreset for fornecido.'),
        formulaPreset: z.string().optional().describe('Preset id (ex.: "healing_low", "healing_percent"). Sobrescreve formula.'),
        variance: z.number().int().min(0).max(100).default(20),
        animationId: z.number().int().default(0),
        iconIndex: z.number().int().nonnegative().default(72),
        stypeId: z.number().int().nonnegative().default(1),
        scope: z
          .number()
          .int()
          .nonnegative()
          .default(7)
          .describe('7=1 Ally, 8=All Allies, 9=1 Ally Dead, 10=All Allies Dead, 11=User'),
        successRate: z.number().int().min(0).max(100).default(100),
        message1: z.string().default(''),
        message2: z.string().default(''),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let formula = args.formula;
        let variance = args.variance;
        if (args.formulaPreset) {
          const preset = DAMAGE_FORMULAS[args.formulaPreset];
          if (!preset) {
            return { error: 'preset_not_found', message: `Preset "${args.formulaPreset}" não existe.` };
          }
          formula = preset.formula;
          variance = preset.variance;
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
          occasion: 0,
          hitType: 0,
          animationId: args.animationId,
          damage: {
            type: 3,
            elementId: 0,
            formula,
            variance,
            critical: false,
          },
          effects: [],
          traits: [],
          message1: args.message1,
          message2: args.message2,
          messageType: 1,
          successRate: args.successRate,
          repeats: 1,
          speed: 0,
          tpGain: 0,
          requiredWtypeId1: 0,
          requiredWtypeId2: 0,
          note: '',
        });
        setRecordAtId(raw, skill);
        await saveDbRaw(config, 'skill', raw, { destructive: false });
        return { id, skill };
      }),
  );
}
