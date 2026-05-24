/**
 * Análise: skill distribution.
 *
 * Pra cada skill:
 *  - Quais classes aprendem (via class.learnings)
 *  - Quais actors têm skill nativa (via actor.equips, actor inicial)
 *  - Quais states aplicam (via state.traits com code 43 = Add Skill)
 *  - Em qual nível é aprendida
 *  - Stat principal usado na formula (a.atk vs a.mat vs a.agi etc — heurística regex)
 *
 * Identifica:
 *  - Skills inacessíveis (criadas mas ninguém aprende)
 *  - Skills aprendidas por muitas classes (genéricas)
 *  - Skills aprendidas tarde no jogo (nível alto)
 */

import type { Config } from '../../config.js';
import { loadProjectSnapshot, type ProjectSnapshot } from './shared.js';

export interface SkillLearner {
  kind: 'class' | 'state';
  classId?: number;
  className?: string;
  stateId?: number;
  stateName?: string;
  level?: number;
}

export interface SkillEntry {
  id: number;
  name: string;
  mpCost: number;
  tpCost: number;
  damageType: number;
  formula: string;
  mainStat: string | null;
  learners: SkillLearner[];
  unreachable: boolean;
}

export interface SkillDistributionAnalysis {
  totalSkills: number;
  unreachableCount: number;
  skills: SkillEntry[];
}

const STAT_REGEX = /\ba\.(atk|def|mat|mdf|agi|luk|hp|mp|mhp|mmp|tp|level|exp)\b/gi;

function detectMainStat(formula: string): string | null {
  if (!formula) return null;
  const matches = formula.match(STAT_REGEX);
  if (!matches || matches.length === 0) return null;
  // Conta ocorrências, retorna o stat mais usado
  const counts = new Map<string, number>();
  for (const m of matches) {
    const stat = m.slice(2).toLowerCase();
    counts.set(stat, (counts.get(stat) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [stat, count] of counts) {
    if (count > bestCount) {
      best = stat;
      bestCount = count;
    }
  }
  return best;
}

export async function analyzeSkillDistribution(config: Config): Promise<SkillDistributionAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: false, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): SkillDistributionAnalysis {
  // Indexa learnings por skillId
  const learnersBySkill = new Map<number, SkillLearner[]>();
  const push = (skillId: number, l: SkillLearner) => {
    const arr = learnersBySkill.get(skillId) ?? [];
    arr.push(l);
    learnersBySkill.set(skillId, arr);
  };

  // Classes → learnings
  for (const cls of snapshot.classes) {
    if (!cls || typeof cls.id !== 'number') continue;
    const classId = cls.id as number;
    const className = (cls.name as string) ?? '';
    const learnings = cls.learnings as Array<{ level: number; skillId: number }> | undefined;
    if (!learnings) continue;
    for (const learn of learnings) {
      if (!learn || typeof learn.skillId !== 'number' || learn.skillId === 0) continue;
      push(learn.skillId, {
        kind: 'class',
        classId,
        className,
        level: learn.level,
      });
    }
  }

  // States com trait code 43 (Add Skill) ou 44 (Seal Skill)
  for (const state of snapshot.states) {
    if (!state || typeof state.id !== 'number') continue;
    const stateId = state.id as number;
    const stateName = (state.name as string) ?? '';
    const traits = state.traits as Array<{ code: number; dataId: number; value: number }> | undefined;
    if (!traits) continue;
    for (const tr of traits) {
      // 43 = Add Skill (trait dá acesso à skill enquanto state ativo)
      if (tr.code === 43 && typeof tr.dataId === 'number' && tr.dataId > 0) {
        push(tr.dataId, {
          kind: 'state',
          stateId,
          stateName,
        });
      }
    }
  }

  // Actors também podem ter traits 43 (skills permanentes via Actor.traits)
  for (const actor of snapshot.actors) {
    if (!actor || typeof actor.id !== 'number') continue;
    const traits = actor.traits as Array<{ code: number; dataId: number; value: number }> | undefined;
    if (!traits) continue;
    for (const tr of traits) {
      if (tr.code === 43 && typeof tr.dataId === 'number' && tr.dataId > 0) {
        // Trata como aprendizagem da classe principal do actor
        const classId = actor.classId as number | undefined;
        const cls = classId ? snapshot.classes.find((c) => c?.id === classId) : undefined;
        push(tr.dataId, {
          kind: 'class',
          classId,
          className: ((cls as { name?: string } | undefined)?.name) ?? (actor.name as string) ?? '',
          level: 1,
        });
      }
    }
  }

  // Constrói entradas
  const skills: SkillEntry[] = [];
  let unreachableCount = 0;
  for (const sk of snapshot.skills) {
    if (!sk || typeof sk.id !== 'number') continue;
    const id = sk.id as number;
    if (id <= 0) continue;
    const name = (sk.name as string) ?? '';
    const learners = learnersBySkill.get(id) ?? [];
    const damage = sk.damage as { type?: number; formula?: string } | undefined;
    const formula = damage?.formula ?? '';
    const unreachable = learners.length === 0 && name.trim().length > 0;
    if (unreachable) unreachableCount++;
    skills.push({
      id,
      name,
      mpCost: (sk.mpCost as number) ?? 0,
      tpCost: (sk.tpCost as number) ?? 0,
      damageType: damage?.type ?? 0,
      formula,
      mainStat: detectMainStat(formula),
      learners,
      unreachable,
    });
  }

  // Sort: mais learners primeiro (skills genéricas no topo)
  skills.sort((a, b) => b.learners.length - a.learners.length);

  return {
    totalSkills: skills.length,
    unreachableCount,
    skills,
  };
}
