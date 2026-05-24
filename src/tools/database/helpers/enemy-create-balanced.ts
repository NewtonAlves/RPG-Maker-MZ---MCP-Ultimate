/**
 * Helper: enemy_create_balanced — cria inimigo com stats auto-balanceados por
 * level e role.
 *
 * Fórmulas baseadas em curvas similares às do default MZ. Cada "role" tem um
 * perfil diferente (tank, glass cannon, mage, balanced, boss, minion).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config.js';
import { loadDbRaw, nextFreeId, saveDbRaw, setRecordAtId } from '../../../core/db-io.js';
import { EnemySchema } from '../../../schemas/data/enemy.js';
import { mcpReturn } from '../index.js';

type Role = 'balanced' | 'tank' | 'glass_cannon' | 'mage' | 'boss' | 'minion' | 'elemental_ice' | 'elemental_fire';

interface RoleProfile {
  hpMul: number;
  mpMul: number;
  atkMul: number;
  defMul: number;
  matMul: number;
  mdfMul: number;
  agiMul: number;
  lukMul: number;
  expMul: number;
  goldMul: number;
}

const ROLES: Record<Role, RoleProfile> = {
  balanced: { hpMul: 1.0, mpMul: 0.5, atkMul: 1.0, defMul: 1.0, matMul: 1.0, mdfMul: 1.0, agiMul: 1.0, lukMul: 1.0, expMul: 1.0, goldMul: 1.0 },
  tank: { hpMul: 2.0, mpMul: 0.3, atkMul: 0.8, defMul: 2.0, matMul: 0.5, mdfMul: 1.5, agiMul: 0.6, lukMul: 0.8, expMul: 1.5, goldMul: 1.2 },
  glass_cannon: { hpMul: 0.5, mpMul: 0.5, atkMul: 2.0, defMul: 0.5, matMul: 1.0, mdfMul: 0.5, agiMul: 1.5, lukMul: 1.0, expMul: 1.2, goldMul: 0.8 },
  mage: { hpMul: 0.7, mpMul: 2.0, atkMul: 0.5, defMul: 0.8, matMul: 2.0, mdfMul: 1.5, agiMul: 1.0, lukMul: 1.0, expMul: 1.3, goldMul: 1.0 },
  boss: { hpMul: 5.0, mpMul: 2.0, atkMul: 1.5, defMul: 1.5, matMul: 1.5, mdfMul: 1.5, agiMul: 1.2, lukMul: 1.5, expMul: 10.0, goldMul: 5.0 },
  minion: { hpMul: 0.4, mpMul: 0.3, atkMul: 0.7, defMul: 0.5, matMul: 0.5, mdfMul: 0.5, agiMul: 1.2, lukMul: 0.5, expMul: 0.5, goldMul: 0.4 },
  elemental_ice: { hpMul: 0.9, mpMul: 1.5, atkMul: 0.8, defMul: 0.9, matMul: 1.8, mdfMul: 1.5, agiMul: 0.8, lukMul: 1.0, expMul: 1.2, goldMul: 1.1 },
  elemental_fire: { hpMul: 1.0, mpMul: 1.5, atkMul: 1.2, defMul: 0.8, matMul: 1.8, mdfMul: 1.2, agiMul: 1.2, lukMul: 1.0, expMul: 1.2, goldMul: 1.1 },
};

function computeStats(level: number, role: Role): {
  params: number[];
  exp: number;
  gold: number;
} {
  const p = ROLES[role];
  // Base curves — escala quadrática suave
  const hp = Math.round((50 + level * 30 + level * level * 1.5) * p.hpMul);
  const mp = Math.round((10 + level * 5) * p.mpMul);
  const atk = Math.round((10 + level * 2 + level * level * 0.1) * p.atkMul);
  const def = Math.round((5 + level * 1.5 + level * level * 0.08) * p.defMul);
  const mat = Math.round((5 + level * 1.8 + level * level * 0.09) * p.matMul);
  const mdf = Math.round((5 + level * 1.3 + level * level * 0.07) * p.mdfMul);
  const agi = Math.round((10 + level * 1.5) * p.agiMul);
  const luk = Math.round((10 + level * 1.0) * p.lukMul);

  const exp = Math.round((10 + level * 8 + level * level * 0.8) * p.expMul);
  const gold = Math.round((5 + level * 5 + level * level * 0.5) * p.goldMul);

  return { params: [hp, mp, atk, def, mat, mdf, agi, luk], exp, gold };
}

export function registerEnemyCreateBalancedHelper(server: McpServer, config: Config): void {
  server.registerTool(
    'enemy_create_balanced',
    {
      description:
        'Cria inimigo com stats auto-balanceados pelo level e role. Roles: ' +
        'balanced, tank, glass_cannon, mage, boss, minion, elemental_ice, elemental_fire. ' +
        'Inclui ação básica (Attack/skillId=1) como padrão. Personagem-sprite e drops ' +
        'ficam vazios pra você customizar via db_update depois.',
      inputSchema: z.object({
        name: z.string().min(1),
        level: z.number().int().positive().describe('Level alvo do encontro (1-99)'),
        role: z
          .enum([
            'balanced',
            'tank',
            'glass_cannon',
            'mage',
            'boss',
            'minion',
            'elemental_ice',
            'elemental_fire',
          ])
          .default('balanced'),
        battlerName: z.string().default('').describe('Nome do battler em img/enemies/'),
        note: z.string().default(''),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'enemy');
        const id = nextFreeId(raw);
        const stats = computeStats(args.level, args.role as Role);
        const enemy = EnemySchema.parse({
          id,
          name: args.name,
          battlerName: args.battlerName,
          battlerHue: 0,
          params: stats.params,
          exp: stats.exp,
          gold: stats.gold,
          dropItems: [
            { kind: 0, dataId: 0, denominator: 1 },
            { kind: 0, dataId: 0, denominator: 1 },
            { kind: 0, dataId: 0, denominator: 1 },
          ],
          actions: [
            { skillId: 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 },
          ],
          traits: [],
          note: args.note,
        });
        setRecordAtId(raw, enemy);
        await saveDbRaw(config, 'enemy', raw, { destructive: false });
        return {
          id,
          enemy,
          computed: {
            level: args.level,
            role: args.role,
            stats: {
              hp: stats.params[0],
              mp: stats.params[1],
              atk: stats.params[2],
              def: stats.params[3],
              mat: stats.params[4],
              mdf: stats.params[5],
              agi: stats.params[6],
              luk: stats.params[7],
              exp: stats.exp,
              gold: stats.gold,
            },
          },
        };
      }),
  );
}
