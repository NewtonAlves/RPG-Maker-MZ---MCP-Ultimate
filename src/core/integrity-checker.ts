/**
 * Verificador de integridade do database MZ.
 *
 * Detecta referências quebradas: skills apontando pra states deletados, weapons
 * com wtypeId inexistente, troops referenciando enemies inválidos, etc.
 *
 * Retorna lista de issues com path + severity + suggested fix. Não modifica nada.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Config } from '../config.js';
import { loadDbRecords } from './db-io.js';

export interface IntegrityIssue {
  severity: 'error' | 'warning';
  category: string;
  recordId: number;
  recordName: string;
  field: string;
  detail: string;
  suggestion?: string;
}

export async function checkConsistency(config: Config): Promise<{
  totalChecks: number;
  issues: IntegrityIssue[];
  summary: Record<string, number>;
}> {
  const issues: IntegrityIssue[] = [];
  let totalChecks = 0;

  // Carrega tudo (records sem nulls)
  const [
    sysRaw,
    actors,
    classes,
    skills,
    items,
    weapons,
    armors,
    enemies,
    troops,
    states,
    animations,
    tilesets,
    commonEvents,
  ] = await Promise.all([
    fs.readFile(path.join(config.project.path, 'data', 'System.json'), 'utf-8').then(JSON.parse),
    loadDbRecords(config, 'actor'),
    loadDbRecords(config, 'class'),
    loadDbRecords(config, 'skill'),
    loadDbRecords(config, 'item'),
    loadDbRecords(config, 'weapon'),
    loadDbRecords(config, 'armor'),
    loadDbRecords(config, 'enemy'),
    loadDbRecords(config, 'troop'),
    loadDbRecords(config, 'state'),
    loadDbRecords(config, 'animation'),
    loadDbRecords(config, 'tileset'),
    loadDbRecords(config, 'common_event'),
  ]);

  // Sets de IDs válidos pra lookup rápido
  const ids = {
    actor: new Set(actors.map((r) => r.id)),
    class: new Set(classes.map((r) => r.id)),
    skill: new Set(skills.map((r) => r.id)),
    item: new Set(items.map((r) => r.id)),
    weapon: new Set(weapons.map((r) => r.id)),
    armor: new Set(armors.map((r) => r.id)),
    enemy: new Set(enemies.map((r) => r.id)),
    troop: new Set(troops.map((r) => r.id)),
    state: new Set(states.map((r) => r.id)),
    animation: new Set(animations.map((r) => r.id)),
    tileset: new Set(tilesets.map((r) => r.id)),
    commonEvent: new Set(commonEvents.map((r) => r.id)),
  };

  const wtypeCount = (sysRaw.weaponTypes as string[] | undefined)?.length ?? 0;
  const atypeCount = (sysRaw.armorTypes as string[] | undefined)?.length ?? 0;
  const etypeCount = (sysRaw.equipTypes as string[] | undefined)?.length ?? 0;
  const stypeCount = (sysRaw.skillTypes as string[] | undefined)?.length ?? 0;
  const elementCount = (sysRaw.elements as string[] | undefined)?.length ?? 0;
  const switchCount = (sysRaw.switches as string[] | undefined)?.length ?? 0;
  const variableCount = (sysRaw.variables as string[] | undefined)?.length ?? 0;

  const push = (issue: IntegrityIssue): void => {
    issues.push(issue);
  };

  /* ===== Actors ===== */
  for (const a of actors) {
    totalChecks++;
    const classId = a.classId as number | undefined;
    if (classId && !ids.class.has(classId)) {
      push({
        severity: 'error',
        category: 'actor',
        recordId: a.id,
        recordName: (a.name as string) ?? '',
        field: 'classId',
        detail: `Actor referencia classId=${classId} que não existe em Classes.`,
        suggestion: 'Crie a classe ou troque pro classId válido.',
      });
    }
    const equips = a.equips as number[] | undefined;
    if (Array.isArray(equips)) {
      for (let i = 0; i < equips.length; i++) {
        totalChecks++;
        const id = equips[i];
        if (!id || id === 0) continue;
        // Slot 0 = weapon, slots 1-4 = armor (típico). Verifica como weapon OU armor.
        if (i === 0) {
          if (!ids.weapon.has(id)) {
            push({
              severity: 'error',
              category: 'actor',
              recordId: a.id,
              recordName: (a.name as string) ?? '',
              field: `equips[${i}]`,
              detail: `Equip slot ${i} aponta pra weaponId=${id} inexistente.`,
            });
          }
        } else {
          if (!ids.armor.has(id)) {
            push({
              severity: 'error',
              category: 'actor',
              recordId: a.id,
              recordName: (a.name as string) ?? '',
              field: `equips[${i}]`,
              detail: `Equip slot ${i} aponta pra armorId=${id} inexistente.`,
            });
          }
        }
      }
    }
    checkTraits(a, 'actor', push, ids, { stypeCount, elementCount });
  }

  /* ===== Classes ===== */
  for (const c of classes) {
    totalChecks++;
    const learnings = c.learnings as Array<{ skillId: number; level: number }> | undefined;
    if (Array.isArray(learnings)) {
      for (let i = 0; i < learnings.length; i++) {
        const l = learnings[i]!;
        if (l.skillId && !ids.skill.has(l.skillId)) {
          push({
            severity: 'error',
            category: 'class',
            recordId: c.id,
            recordName: (c.name as string) ?? '',
            field: `learnings[${i}].skillId`,
            detail: `Class.learnings[${i}] aprende skillId=${l.skillId} que não existe.`,
          });
        }
      }
    }
    checkTraits(c, 'class', push, ids, { stypeCount, elementCount });
  }

  /* ===== Skills ===== */
  for (const s of skills) {
    totalChecks++;
    if (s.stypeId !== undefined && s.stypeId !== 0 && stypeCount > 0) {
      const sid = s.stypeId as number;
      if (sid >= stypeCount) {
        push({
          severity: 'warning',
          category: 'skill',
          recordId: s.id,
          recordName: (s.name as string) ?? '',
          field: 'stypeId',
          detail: `stypeId=${sid} fora do range de System.skillTypes (${stypeCount}).`,
        });
      }
    }
    if (s.animationId !== undefined) {
      const aid = s.animationId as number;
      if (aid > 0 && !ids.animation.has(aid)) {
        push({
          severity: 'warning',
          category: 'skill',
          recordId: s.id,
          recordName: (s.name as string) ?? '',
          field: 'animationId',
          detail: `animationId=${aid} não existe.`,
        });
      }
    }
    const damage = s.damage as { elementId?: number } | undefined;
    if (damage && typeof damage.elementId === 'number' && damage.elementId > 0) {
      if (damage.elementId >= elementCount) {
        push({
          severity: 'warning',
          category: 'skill',
          recordId: s.id,
          recordName: (s.name as string) ?? '',
          field: 'damage.elementId',
          detail: `elementId=${damage.elementId} fora do range de System.elements (${elementCount}).`,
        });
      }
    }
    checkEffects(s, 'skill', push, ids);
    checkTraits(s, 'skill', push, ids, { stypeCount, elementCount });
  }

  /* ===== Items ===== */
  for (const i of items) {
    totalChecks++;
    if (i.animationId !== undefined) {
      const aid = i.animationId as number;
      if (aid > 0 && !ids.animation.has(aid)) {
        push({
          severity: 'warning',
          category: 'item',
          recordId: i.id,
          recordName: (i.name as string) ?? '',
          field: 'animationId',
          detail: `animationId=${aid} não existe.`,
        });
      }
    }
    checkEffects(i, 'item', push, ids);
    checkTraits(i, 'item', push, ids, { stypeCount, elementCount });
  }

  /* ===== Weapons ===== */
  for (const w of weapons) {
    totalChecks++;
    const wtype = w.wtypeId as number | undefined;
    if (wtype !== undefined && wtype > 0 && wtype >= wtypeCount) {
      push({
        severity: 'error',
        category: 'weapon',
        recordId: w.id,
        recordName: (w.name as string) ?? '',
        field: 'wtypeId',
        detail: `wtypeId=${wtype} fora do range de System.weaponTypes (${wtypeCount}).`,
      });
    }
    const etype = w.etypeId as number | undefined;
    if (etype !== undefined && etype > 0 && etype >= etypeCount) {
      push({
        severity: 'warning',
        category: 'weapon',
        recordId: w.id,
        recordName: (w.name as string) ?? '',
        field: 'etypeId',
        detail: `etypeId=${etype} fora do range de System.equipTypes (${etypeCount}).`,
      });
    }
    if (w.animationId !== undefined) {
      const aid = w.animationId as number;
      if (aid > 0 && !ids.animation.has(aid)) {
        push({
          severity: 'warning',
          category: 'weapon',
          recordId: w.id,
          recordName: (w.name as string) ?? '',
          field: 'animationId',
          detail: `animationId=${aid} não existe.`,
        });
      }
    }
    checkTraits(w, 'weapon', push, ids, { stypeCount, elementCount });
  }

  /* ===== Armors ===== */
  for (const arm of armors) {
    totalChecks++;
    const atype = arm.atypeId as number | undefined;
    if (atype !== undefined && atype > 0 && atype >= atypeCount) {
      push({
        severity: 'error',
        category: 'armor',
        recordId: arm.id,
        recordName: (arm.name as string) ?? '',
        field: 'atypeId',
        detail: `atypeId=${atype} fora do range de System.armorTypes (${atypeCount}).`,
      });
    }
    const etype = arm.etypeId as number | undefined;
    if (etype !== undefined && etype > 0 && etype >= etypeCount) {
      push({
        severity: 'warning',
        category: 'armor',
        recordId: arm.id,
        recordName: (arm.name as string) ?? '',
        field: 'etypeId',
        detail: `etypeId=${etype} fora do range de System.equipTypes (${etypeCount}).`,
      });
    }
    checkTraits(arm, 'armor', push, ids, { stypeCount, elementCount });
  }

  /* ===== Enemies ===== */
  for (const e of enemies) {
    totalChecks++;
    const actions = e.actions as Array<{ skillId: number }> | undefined;
    if (Array.isArray(actions)) {
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i]!;
        if (a.skillId && !ids.skill.has(a.skillId)) {
          push({
            severity: 'error',
            category: 'enemy',
            recordId: e.id,
            recordName: (e.name as string) ?? '',
            field: `actions[${i}].skillId`,
            detail: `Enemy action referencia skillId=${a.skillId} inexistente.`,
          });
        }
      }
    }
    const drops = e.dropItems as Array<{ kind: number; dataId: number; denominator: number }> | undefined;
    if (Array.isArray(drops)) {
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i]!;
        if (d.kind === 0 || d.dataId === 0) continue;
        const lookupSet = d.kind === 1 ? ids.item : d.kind === 2 ? ids.weapon : d.kind === 3 ? ids.armor : null;
        if (lookupSet && !lookupSet.has(d.dataId)) {
          const kindName = d.kind === 1 ? 'item' : d.kind === 2 ? 'weapon' : 'armor';
          push({
            severity: 'error',
            category: 'enemy',
            recordId: e.id,
            recordName: (e.name as string) ?? '',
            field: `dropItems[${i}]`,
            detail: `Drop kind=${kindName} aponta pra dataId=${d.dataId} inexistente.`,
          });
        }
      }
    }
    checkTraits(e, 'enemy', push, ids, { stypeCount, elementCount });
  }

  /* ===== Troops ===== */
  for (const t of troops) {
    totalChecks++;
    const members = t.members as Array<{ enemyId: number }> | undefined;
    if (Array.isArray(members)) {
      for (let i = 0; i < members.length; i++) {
        const m = members[i]!;
        if (m.enemyId && !ids.enemy.has(m.enemyId)) {
          push({
            severity: 'error',
            category: 'troop',
            recordId: t.id,
            recordName: (t.name as string) ?? '',
            field: `members[${i}].enemyId`,
            detail: `Troop member referencia enemyId=${m.enemyId} inexistente.`,
          });
        }
      }
    }
  }

  /* ===== States ===== */
  for (const s of states) {
    totalChecks++;
    checkTraits(s, 'state', push, ids, { stypeCount, elementCount });
  }

  /* ===== CommonEvents ===== */
  for (const ce of commonEvents) {
    totalChecks++;
    const sw = ce.switchId as number | undefined;
    if (sw !== undefined && sw > 0 && sw >= switchCount) {
      push({
        severity: 'warning',
        category: 'common_event',
        recordId: ce.id,
        recordName: (ce.name as string) ?? '',
        field: 'switchId',
        detail: `switchId=${sw} fora do range (${switchCount} switches).`,
      });
    }
  }

  const summary: Record<string, number> = {};
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.category}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }

  void variableCount; // futuro: validar event commands com variableId

  return { totalChecks, issues, summary };
}

function checkTraits(
  record: { id: number; name?: unknown; traits?: unknown },
  category: string,
  push: (i: IntegrityIssue) => void,
  ids: Record<string, Set<number>>,
  context: { stypeCount: number; elementCount: number },
): void {
  const traits = record.traits as Array<{ code: number; dataId: number; value: number }> | undefined;
  if (!Array.isArray(traits)) return;
  for (let i = 0; i < traits.length; i++) {
    const t = traits[i]!;
    // code 13 (state_rate), 14 (state_resist) → dataId é stateId
    if (t.code === 13 || t.code === 14 || t.code === 32) {
      if (t.dataId && !ids.state.has(t.dataId)) {
        push({
          severity: 'warning',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `traits[${i}]`,
          detail: `Trait code=${t.code} (state-related) referencia stateId=${t.dataId} inexistente.`,
        });
      }
    }
    // code 11 (element_rate), 31 (attack_element) → dataId é elementId
    if (t.code === 11 || t.code === 31) {
      if (t.dataId > 0 && t.dataId >= context.elementCount) {
        push({
          severity: 'warning',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `traits[${i}]`,
          detail: `Trait code=${t.code} (element) referencia elementId=${t.dataId} fora do range (${context.elementCount}).`,
        });
      }
    }
    // code 41 (stype_add), 42 (stype_seal) → dataId é stypeId
    if (t.code === 41 || t.code === 42) {
      if (t.dataId > 0 && t.dataId >= context.stypeCount) {
        push({
          severity: 'warning',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `traits[${i}]`,
          detail: `Trait code=${t.code} (stype) referencia stypeId=${t.dataId} fora do range (${context.stypeCount}).`,
        });
      }
    }
    // code 43 (skill_add), 44 (skill_seal) → dataId é skillId
    if (t.code === 43 || t.code === 44) {
      if (t.dataId && !ids.skill.has(t.dataId)) {
        push({
          severity: 'warning',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `traits[${i}]`,
          detail: `Trait code=${t.code} (skill) referencia skillId=${t.dataId} inexistente.`,
        });
      }
    }
  }
}

function checkEffects(
  record: { id: number; name?: unknown; effects?: unknown },
  category: string,
  push: (i: IntegrityIssue) => void,
  ids: Record<string, Set<number>>,
): void {
  const effects = record.effects as Array<{ code: number; dataId: number; value1: number; value2: number }> | undefined;
  if (!Array.isArray(effects)) return;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]!;
    // code 21 (add_state), 22 (remove_state) → dataId is stateId
    if (e.code === 21 || e.code === 22) {
      if (e.dataId && !ids.state.has(e.dataId)) {
        push({
          severity: 'error',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `effects[${i}]`,
          detail: `Effect code=${e.code} (state) referencia stateId=${e.dataId} inexistente.`,
        });
      }
    }
    // code 43 (learn_skill) → dataId is skillId
    if (e.code === 43) {
      if (e.dataId && !ids.skill.has(e.dataId)) {
        push({
          severity: 'error',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `effects[${i}]`,
          detail: `Effect learn_skill referencia skillId=${e.dataId} inexistente.`,
        });
      }
    }
    // code 44 (common_event) → dataId is commonEventId
    if (e.code === 44) {
      if (e.dataId && !ids.commonEvent.has(e.dataId)) {
        push({
          severity: 'error',
          category,
          recordId: record.id,
          recordName: (record.name as string) ?? '',
          field: `effects[${i}]`,
          detail: `Effect common_event referencia commonEventId=${e.dataId} inexistente.`,
        });
      }
    }
  }
}
