// Smoke test Onda A: sprite composition, autotile procgen, clean unused, save helpers.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wA-'));
await copyDir(NEWDATA, tempDir);

const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: 39895, tokenFile: '.mz-mcp/companion.token' },
  plugins: { defaultNamingConvention: 'snake', knownBases: {} },
  logging: { level: 'warn' },
};
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify(cfg, null, 2));

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = ''; const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); } } catch {}
  }
});
let idCounter = 0;
function rpc(method, params) {
  const id = ++idCounter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 20_000);
  });
}
function notify(method, params) { server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
function expectOk(resp, label) {
  if (resp.error) throw new Error(`${label}: ${JSON.stringify(resp.error)}`);
  if (resp.result?.isError) throw new Error(`${label} isError: ${resp.result.content?.[0]?.text}`);
  return JSON.parse(resp.result.content[0].text);
}
async function call(name, args) { return expectOk(await rpc('tools/call', { name, arguments: args }), name); }

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wA', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- SPRITE COMPOSITION (Onda A.1) ---');
  const partsCheck = await call('generator_list_parts', { kind: 'TV', gender: 'Female' });
  console.log(`[smoke] TV/Female categories: ${partsCheck.categories?.join(',')} (total ${partsCheck.totalFiles} files)`);

  const bodyFiles = await call('generator_list_parts', { kind: 'TV', gender: 'Female', category: 'Body' });
  console.log(`[smoke] Body files: ${bodyFiles.count}`);
  const accAFiles = await call('generator_list_parts', { kind: 'TV', gender: 'Female', category: 'AccA' });

  if (bodyFiles.count > 0 && accAFiles.count > 0) {
    const sprite = await call('actor_sprite_generate', {
      actorName: 'Marina',
      gender: 'Female',
      parts: { Body: bodyFiles.files[0], AccA: accAFiles.files[0] },
    });
    console.log(`[smoke] actor_sprite_generate: ${sprite.layers} layers, ${sprite.width}x${sprite.height}, saved to ${path.basename(sprite.output)}`);
    // Verifica que o arquivo foi criado
    const stat = await fs.stat(sprite.output);
    console.log(`[smoke] arquivo gerado: ${stat.size} bytes ✓`);
    if (stat.size < 100) throw new Error('sprite gerado muito pequeno');
  }

  console.log('\n--- AUTOTILE PROCGEN (Onda A.2) ---');
  const dungeonAt = await call('procgen_dungeon', {
    name: 'Dungeon Autotile',
    width: 25, height: 20, seed: 42,
    autotileSheet: 'A2', autotileIndex: 0,
    wallTileId: 0,
  });
  console.log(`[smoke] procgen_dungeon autotile=true: mapId=${dungeonAt.mapId}, rooms=${dungeonAt.rooms}`);

  // Verifica que os tile IDs estão no range autotile (2816-2863 = A2 index 0 shapes)
  const mapGet = await call('map_get', { id: dungeonAt.mapId, includeTileData: true });
  const tileSet = new Set(mapGet.data.filter(t => t > 0));
  const autotileBase = 2816;
  const inRange = [...tileSet].filter(t => t >= autotileBase && t < autotileBase + 48);
  console.log(`[smoke] tile IDs únicos: ${tileSet.size}, no range autotile A2[0] (2816-2863): ${inRange.length}`);
  if (inRange.length < 2) throw new Error('autotile encoding não produziu múltiplos shapes');

  console.log('\n--- CLEAN UNUSED ASSETS (Onda A.3) ---');
  const cleanDry = await call('mz_clean_unused_assets', { dryRun: true, limit: 10 });
  console.log(`[smoke] mz_clean_unused_assets dryRun: ${cleanDry.totalUnused} unused detectados`);
  console.log(`[smoke] sample:`, cleanDry.unusedSample.slice(0, 3));
  console.log(`[smoke] referencedCounts img/characters: ${cleanDry.referencedCounts['img/characters']}`);

  // Não rodamos com dryRun=false pra não destruir o template, mas confirma que pode ser feito

  console.log('\n--- SAVE HELPERS (Onda A.4) ---');
  const savePath = path.join(tempDir, 'test01.rmmzsave');
  // Cria um save inicial com estrutura minimal-ish
  await call('save_create_test_state', { path: savePath, switchesOn: [1], variableValues: { 2: 100 } });
  // Adiciona estrutura party + actors manualmente via save_edit pra que helpers funcionem
  await call('save_edit', {
    path: savePath,
    patch: {
      party: { _gold: 50, _actors: [1, 2], _items: {}, _weapons: {}, _armors: {}, _steps: 0 },
      actors: { _data: { '1': { _level: 1, _hp: 100, _mp: 50, _skills: [1] }, '2': { _level: 1, _hp: 80, _mp: 40, _skills: [1] } } },
      player: { _x: 0, _y: 0, _direction: 2 },
      map: { _mapId: 1 },
    },
  });

  await call('save_set_gold', { path: savePath, amount: 9999 });
  await call('save_add_item', { path: savePath, kind: 'item', dataId: 1, count: 5 });
  await call('save_add_item', { path: savePath, kind: 'item', dataId: 1, count: 3 });
  await call('save_set_actor_level', { path: savePath, actorId: 1, level: 25 });
  await call('save_set_actor_hp_mp', { path: savePath, actorId: 1, hp: 250, mp: 120 });
  await call('save_learn_skill', { path: savePath, actorId: 1, skillId: 42 });
  await call('save_set_party_members', { path: savePath, actorIds: [1, 2, 3] });
  await call('save_set_player_position', { path: savePath, mapId: 5, x: 10, y: 8, direction: 4 });
  await call('save_set_switch', { path: savePath, id: 10, value: true });
  await call('save_set_variable', { path: savePath, id: 5, value: 42 });

  const final = await call('save_read', { path: savePath });
  console.log(`[smoke] gold=${final.party._gold} (esperado 9999)`);
  console.log(`[smoke] items[1]=${final.party._items['1']} (esperado 8)`);
  console.log(`[smoke] actor 1 level=${final.actors._data['1']._level}, hp=${final.actors._data['1']._hp}, skills=${final.actors._data['1']._skills}`);
  console.log(`[smoke] party members=${final.party._actors}`);
  console.log(`[smoke] player at map=${final.map._mapId} (${final.player._x},${final.player._y}) dir=${final.player._direction}`);
  console.log(`[smoke] switch[10]=${final.switches._data[10]}, var[5]=${final.variables._data[5]}`);

  if (final.party._gold !== 9999) throw new Error('gold falhou');
  if (final.party._items['1'] !== 8) throw new Error('add_item falhou');
  if (final.actors._data['1']._level !== 25) throw new Error('level falhou');
  if (!final.actors._data['1']._skills.includes(42)) throw new Error('learn_skill falhou');
  if (final.map._mapId !== 5) throw new Error('player position falhou');

  console.log('\n[smoke] ALL WAVE A CHECKS PASSED ✓');
  server.kill();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else if (e.isFile()) await fs.copyFile(s, d);
  }
}

try { await main(); } catch (err) { console.error('[smoke] FAILED:', err); server.kill(); process.exit(1); }
finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); process.exit(0); }
