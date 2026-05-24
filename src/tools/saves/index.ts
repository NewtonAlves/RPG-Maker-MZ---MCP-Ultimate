/**
 * Tools de Save edit. RPG Maker MZ usa LZString-compressed JSON em arquivos .rmmzsave.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import LZString from 'lz-string';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

/** Resolve path absoluto (relativo ao projeto se não absoluto). */
function resolvePath(config: Config, p: string): string {
  return path.isAbsolute(p) ? p : path.join(config.project.path, p);
}

/** Lê save, retorna objeto. */
async function readSaveFile(filePath: string): Promise<Record<string, unknown>> {
  const compressed = await fs.readFile(filePath, 'utf-8');
  const json = LZString.decompressFromBase64(compressed);
  if (!json) throw mzError('plugin_invalid', `Não consegui descomprimir ${filePath}.`);
  return JSON.parse(json);
}

/** Escreve save (recomprime + backup .bak). */
async function writeSaveFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  try {
    await fs.copyFile(filePath, filePath + '.bak');
  } catch {}
  const compressed = LZString.compressToBase64(JSON.stringify(data));
  await fs.writeFile(filePath, compressed, 'utf-8');
}

/** Helper pra acessar party object (lida com $gamePartyContents serializado). */
function getParty(save: Record<string, unknown>): Record<string, unknown> {
  const party = save.party as Record<string, unknown> | undefined;
  if (!party) throw mzError('plugin_invalid', 'Save sem objeto "party".');
  return party;
}

/** Helper pra acessar $gameActors._data (mapa de actorId → actor object). */
function getActor(save: Record<string, unknown>, actorId: number): Record<string, unknown> {
  const actors = save.actors as { _data?: Record<string, unknown> } | undefined;
  if (!actors?._data) throw mzError('plugin_invalid', 'Save sem "actors._data".');
  const actor = actors._data[String(actorId)] as Record<string, unknown> | undefined;
  if (!actor) throw mzError('file_not_found', `Actor ${actorId} não está no save.`);
  return actor;
}

export function registerSaveTools(server: McpServer, config: Config): void {
  server.registerTool(
    'save_read',
    {
      description:
        'Lê um arquivo .rmmzsave (descomprime LZString) e retorna o JSON decoded. ' +
        'Útil pra debug: ver $gameSwitches, $gameVariables, $gameParty.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Caminho do .rmmzsave (relativo ao projeto ou absoluto)'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = path.isAbsolute(args.path)
          ? args.path
          : path.join(config.project.path, args.path);
        const compressed = await fs.readFile(filePath, 'utf-8');
        const json = LZString.decompressFromBase64(compressed);
        if (!json) {
          throw mzError('plugin_invalid', `Não consegui descomprimir ${filePath}.`);
        }
        try {
          return JSON.parse(json);
        } catch (err) {
          throw mzError('plugin_invalid', `JSON inválido após descompressão: ${(err as Error).message}`);
        }
      }),
  );

  server.registerTool(
    'save_edit',
    {
      description:
        'Edita um arquivo .rmmzsave aplicando patch shallow no objeto raiz e recomprimindo. ' +
        'Cria backup do arquivo original como .bak.',
      inputSchema: z.object({
        path: z.string().min(1),
        patch: z.record(z.unknown()),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = path.isAbsolute(args.path)
          ? args.path
          : path.join(config.project.path, args.path);
        const compressed = await fs.readFile(filePath, 'utf-8');
        const json = LZString.decompressFromBase64(compressed);
        if (!json) throw mzError('plugin_invalid', `Falha descomprimir ${filePath}.`);
        const data = JSON.parse(json);
        const merged = { ...data, ...args.patch };
        // Backup
        await fs.copyFile(filePath, filePath + '.bak');
        const recompressed = LZString.compressToBase64(JSON.stringify(merged));
        await fs.writeFile(filePath, recompressed, 'utf-8');
        return { edited: true, file: filePath, patchedKeys: Object.keys(args.patch) };
      }),
  );

  /* -------------------- save_set_gold -------------------- */
  server.registerTool(
    'save_set_gold',
    {
      description: 'Define o gold da party no save.',
      inputSchema: z.object({
        path: z.string().min(1),
        amount: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const party = getParty(save);
        party._gold = args.amount;
        await writeSaveFile(filePath, save);
        return { ok: true, gold: args.amount };
      }),
  );

  /* -------------------- save_add_item -------------------- */
  server.registerTool(
    'save_add_item',
    {
      description:
        'Adiciona N de um item/weapon/armor ao inventário da party. kind: "item", "weapon", "armor".',
      inputSchema: z.object({
        path: z.string().min(1),
        kind: z.enum(['item', 'weapon', 'armor']),
        dataId: z.number().int().positive(),
        count: z.number().int().default(1).describe('Aceita negativo pra remover'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const party = getParty(save);
        const key = args.kind === 'item' ? '_items' : args.kind === 'weapon' ? '_weapons' : '_armors';
        const bag = (party[key] as Record<string, number>) ?? {};
        const idStr = String(args.dataId);
        const current = bag[idStr] ?? 0;
        const next = Math.max(0, current + args.count);
        if (next === 0) delete bag[idStr];
        else bag[idStr] = next;
        party[key] = bag;
        await writeSaveFile(filePath, save);
        return { ok: true, kind: args.kind, dataId: args.dataId, total: next };
      }),
  );

  /* -------------------- save_set_actor_level -------------------- */
  server.registerTool(
    'save_set_actor_level',
    {
      description: 'Define o level de um actor no save (modifica _level).',
      inputSchema: z.object({
        path: z.string().min(1),
        actorId: z.number().int().positive(),
        level: z.number().int().positive().max(99),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const actor = getActor(save, args.actorId);
        actor._level = args.level;
        await writeSaveFile(filePath, save);
        return { ok: true, actorId: args.actorId, level: args.level };
      }),
  );

  /* -------------------- save_set_actor_hp_mp -------------------- */
  server.registerTool(
    'save_set_actor_hp_mp',
    {
      description: 'Define HP/MP de um actor no save (campos _hp e _mp).',
      inputSchema: z.object({
        path: z.string().min(1),
        actorId: z.number().int().positive(),
        hp: z.number().int().nonnegative().optional(),
        mp: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const actor = getActor(save, args.actorId);
        if (args.hp !== undefined) actor._hp = args.hp;
        if (args.mp !== undefined) actor._mp = args.mp;
        await writeSaveFile(filePath, save);
        return { ok: true, actorId: args.actorId, hp: actor._hp, mp: actor._mp };
      }),
  );

  /* -------------------- save_learn_skill -------------------- */
  server.registerTool(
    'save_learn_skill',
    {
      description:
        'Adiciona uma skill ao array _skills de um actor (se ainda não está lá).',
      inputSchema: z.object({
        path: z.string().min(1),
        actorId: z.number().int().positive(),
        skillId: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const actor = getActor(save, args.actorId);
        const skills = (actor._skills as number[]) ?? [];
        if (!skills.includes(args.skillId)) skills.push(args.skillId);
        actor._skills = skills;
        await writeSaveFile(filePath, save);
        return { ok: true, actorId: args.actorId, skills };
      }),
  );

  /* -------------------- save_set_party_members -------------------- */
  server.registerTool(
    'save_set_party_members',
    {
      description: 'Define os membros ativos da party (array de actor IDs).',
      inputSchema: z.object({
        path: z.string().min(1),
        actorIds: z.array(z.number().int().positive()).min(1).max(4),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const party = getParty(save);
        party._actors = args.actorIds;
        await writeSaveFile(filePath, save);
        return { ok: true, actorIds: args.actorIds };
      }),
  );

  /* -------------------- save_set_player_position -------------------- */
  server.registerTool(
    'save_set_player_position',
    {
      description: 'Define onde o jogador está no save: mapa, x, y, direção.',
      inputSchema: z.object({
        path: z.string().min(1),
        mapId: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        direction: z.number().int().min(2).max(8).optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const player = (save.player as Record<string, unknown>) ?? {};
        const map = (save.map as Record<string, unknown>) ?? {};
        player._x = args.x;
        player._y = args.y;
        if (args.direction !== undefined) player._direction = args.direction;
        map._mapId = args.mapId;
        save.player = player;
        save.map = map;
        await writeSaveFile(filePath, save);
        return { ok: true, mapId: args.mapId, x: args.x, y: args.y };
      }),
  );

  /* -------------------- save_set_switch / variable -------------------- */
  server.registerTool(
    'save_set_switch',
    {
      description: 'Seta um switch no save (modifica switches._data[id]).',
      inputSchema: z.object({
        path: z.string().min(1),
        id: z.number().int().positive(),
        value: z.boolean(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const sw = (save.switches as { _data?: unknown[] }) ?? { _data: [] };
        const data = (sw._data as boolean[]) ?? [];
        while (data.length <= args.id) data.push(false);
        data[args.id] = args.value;
        sw._data = data;
        save.switches = sw;
        await writeSaveFile(filePath, save);
        return { ok: true, id: args.id, value: args.value };
      }),
  );

  server.registerTool(
    'save_set_variable',
    {
      description: 'Seta uma variable no save (modifica variables._data[id]).',
      inputSchema: z.object({
        path: z.string().min(1),
        id: z.number().int().positive(),
        value: z.union([z.number(), z.string()]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = resolvePath(config, args.path);
        const save = await readSaveFile(filePath);
        const vr = (save.variables as { _data?: unknown[] }) ?? { _data: [] };
        const data = (vr._data as unknown[]) ?? [];
        while (data.length <= args.id) data.push(0);
        data[args.id] = args.value;
        vr._data = data;
        save.variables = vr;
        await writeSaveFile(filePath, save);
        return { ok: true, id: args.id, value: args.value };
      }),
  );

  server.registerTool(
    'save_create_test_state',
    {
      description:
        'Cria um arquivo .rmmzsave básico pra debug, sem reproduzir o sistema completo do MZ. ' +
        'Útil pra testes automatizados que precisam de um save inicial.',
      inputSchema: z.object({
        path: z.string().min(1),
        switchesOn: z.array(z.number().int().positive()).default([]),
        variableValues: z.record(z.number().int()).default({}),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        // Estado mínimo — não substitui save real do MZ, mas é JSON válido pro tooling
        const switchesData: (boolean | undefined)[] = [];
        for (const id of args.switchesOn) {
          while (switchesData.length <= id) switchesData.push(false);
          switchesData[id] = true;
        }
        const variablesData: (number | undefined)[] = [];
        for (const [idStr, val] of Object.entries(args.variableValues)) {
          const id = parseInt(idStr, 10);
          while (variablesData.length <= id) variablesData.push(0);
          variablesData[id] = val;
        }
        const minState = {
          system: { saveCount: 0, versionId: 1 },
          switches: { _data: switchesData },
          variables: { _data: variablesData },
          createdBy: 'mz-mcp save_create_test_state',
        };
        const filePath = path.isAbsolute(args.path)
          ? args.path
          : path.join(config.project.path, args.path);
        const compressed = LZString.compressToBase64(JSON.stringify(minState));
        await fs.writeFile(filePath, compressed, 'utf-8');
        return { created: true, file: filePath };
      }),
  );
}
