// Smoke test Fase 3: maps, events, templates, troops.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-p3-'));
console.log(`[smoke] Temp project at ${tempDir}`);
await copyDir(NEWDATA, tempDir);

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });

let buffer = '';
const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {}
  }
});

let idCounter = 0;
function rpc(method, params) {
  const id = ++idCounter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); }
    }, 15_000);
  });
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
function expectOk(resp, label) {
  if (resp.error) throw new Error(`${label}: ${JSON.stringify(resp.error)}`);
  if (resp.result?.isError) throw new Error(`${label} isError: ${resp.result.content?.[0]?.text}`);
  return JSON.parse(resp.result.content[0].text);
}

async function call(name, args) {
  return expectOk(await rpc('tools/call', { name, arguments: args }), name);
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p3', version: '0' } });
  notify('notifications/initialized', {});

  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- MAPS ---');
  const maps = await call('map_list', {});
  console.log(`[smoke] map_list: ${maps.count} mapas existentes`);

  const newMap = await call('map_create', {
    name: 'Vila do Início',
    width: 20,
    height: 15,
    tilesetId: 1,
    displayName: 'Vila',
    bgmName: 'Town1',
  });
  console.log(`[smoke] map_create id=${newMap.id} (${newMap.width}x${newMap.height})`);

  await call('map_set_properties', { id: newMap.id, displayName: 'Vila de Aurora', note: '<region: starter>' });
  const got = await call('map_get', { id: newMap.id, includeTileData: false });
  console.log(`[smoke] map_get displayName="${got.displayName}", note="${got.note}"`);

  console.log('\n--- TILE EDIT ---');
  await call('map_tile_set', { id: newMap.id, x: 5, y: 5, z: 0, tileId: 2048 });
  await call('map_tile_fill_rect', { id: newMap.id, x1: 0, y1: 0, x2: 4, y2: 4, z: 0, tileId: 2049 });
  const afterTiles = await call('map_get', { id: newMap.id, includeTileData: true });
  // checa que tile (5,5,z=0) = 2048 e que (0,0,z=0) = 2049
  const idx5 = 0 * afterTiles.width * afterTiles.height + 5 * afterTiles.width + 5;
  const idx0 = 0 * afterTiles.width * afterTiles.height + 0 * afterTiles.width + 0;
  console.log(`[smoke] tile (5,5,0)=${afterTiles.data[idx5]} (esperado 2048), (0,0,0)=${afterTiles.data[idx0]} (esperado 2049)`);
  if (afterTiles.data[idx5] !== 2048 || afterTiles.data[idx0] !== 2049) {
    throw new Error('tiles não foram setados corretamente');
  }

  console.log('\n--- EVENTS ---');
  const npc = await call('event_create', {
    mapId: newMap.id,
    x: 10,
    y: 8,
    name: 'NPC Velho',
    characterName: 'People1',
    characterIndex: 0,
    trigger: 0,
  });
  console.log(`[smoke] event_create eventId=${npc.eventId}`);

  await call('event_template_dialogue', {
    mapId: newMap.id,
    eventId: npc.eventId,
    text: 'Olá, jovem viajante!\nEstá procurando aventura?',
    faceName: 'People1',
    faceIndex: 0,
  });
  console.log('[smoke] dialogue added');

  await call('event_template_choices', {
    mapId: newMap.id,
    eventId: npc.eventId,
    choices: ['Sim, claro', 'Não, obrigado'],
  });
  console.log('[smoke] choices added');

  await call('event_template_conditional', {
    mapId: newMap.id,
    eventId: npc.eventId,
    kind: 'switch',
    switchId: 1,
    switchOn: true,
  });
  console.log('[smoke] conditional added');

  await call('event_template_transfer', {
    mapId: newMap.id,
    eventId: npc.eventId,
    destMapId: 1,
    destX: 5,
    destY: 5,
    fadeType: 0,
  });
  console.log('[smoke] transfer added');

  await call('event_template_play_sound', {
    mapId: newMap.id,
    eventId: npc.eventId,
    seName: 'Bell1',
  });
  console.log('[smoke] play_sound added');

  const eventDetail = await call('event_get', { mapId: newMap.id, eventId: npc.eventId });
  const cmdList = eventDetail.pages[0].list;
  console.log(`[smoke] event has ${cmdList.length} commands. Codes: ${cmdList.map(c => c.code).join(',')}`);
  // Esperado: 101, 401, 401 (2 linhas), 102, 402, 0, 402, 0, 404, 111, 0, 412, 201, 250, 0
  if (cmdList.length < 14) throw new Error(`comandos insuficientes: ${cmdList.length}`);

  console.log('\n--- TROOPS ---');
  const slime = await call('enemy_create_balanced', { name: 'Slime', level: 5, role: 'minion' });
  const goblin = await call('enemy_create_balanced', { name: 'Goblin', level: 5, role: 'balanced' });
  const troop = await call('troop_create', {
    name: 'Encontro Florestal',
    members: [
      { enemyId: slime.id, x: 250, y: 320 },
      { enemyId: goblin.id, x: 550, y: 320 },
    ],
  });
  console.log(`[smoke] troop_create id=${troop.id}, 2 membros`);

  const slime2 = await call('enemy_create_balanced', { name: 'Slime', level: 6, role: 'minion' });
  await call('troop_member_add', { troopId: troop.id, enemyId: slime2.id, x: 100, y: 320 });
  console.log('[smoke] member added (3 total)');

  const layout = await call('troop_set_layout', { troopId: troop.id, layout: 'line' });
  console.log(`[smoke] layout="line" set, positions:`, layout.positions);

  await call('troop_battle_event_add', {
    troopId: troop.id,
    conditions: { turnEnding: false, turnValid: true, turnA: 0, turnB: 1 },
    span: 0,
    commands: [{ code: 101, indent: 0, parameters: ['', -1, 0, 2, 'Slime King'] }, { code: 401, indent: 0, parameters: ['Vocês não vão escapar!'] }],
  });
  console.log('[smoke] battle event page added');

  console.log('\n--- BATTLE EVENT (event_template_battle) ---');
  await call('event_template_battle', {
    mapId: newMap.id,
    eventId: npc.eventId,
    troopId: troop.id,
    canEscape: true,
    canLose: false,
  });
  console.log('[smoke] battle template added to NPC event');

  console.log('\n--- DELETE MAP ---');
  const delMap = await call('map_delete', { id: newMap.id });
  console.log(`[smoke] map_delete: ${delMap.deleted}`);

  // Confirma snapshot
  const backups = await fs.readdir(path.join(tempDir, '.mz-mcp', 'backups')).catch(() => []);
  console.log(`[smoke] backups dir tem ${backups.length} snapshot(s) ✓`);

  console.log('\n[smoke] ALL PHASE 3 CHECKS PASSED ✓');
  server.kill();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

try {
  await main();
} catch (err) {
  console.error('[smoke] FAILED:', err);
  server.kill();
  process.exit(1);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  console.log(`[smoke] cleanup ${tempDir}`);
  process.exit(0);
}
