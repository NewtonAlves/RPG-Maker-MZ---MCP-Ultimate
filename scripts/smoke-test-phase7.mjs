// Smoke test Fase 7: procgen, project utils, generator, samplemaps, mz_install extras.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-p7-'));
await copyDir(NEWDATA, tempDir);

// Porta diferente pra evitar conflito com runtime/server
const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: 39894, tokenFile: '.mz-mcp/companion.token' },
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15_000);
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p7', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- PROCGEN ---');
  const dungeon = await call('procgen_dungeon', { name: 'Dungeon Teste', width: 40, height: 30, seed: 42, floorTileId: 2816, wallTileId: 0 });
  console.log(`[smoke] procgen_dungeon mapId=${dungeon.mapId}, rooms=${dungeon.rooms}`);

  const cave = await call('procgen_cave', { name: 'Caverna Teste', width: 30, height: 25, seed: 100, floorTileId: 2049, wallTileId: 0 });
  console.log(`[smoke] procgen_cave mapId=${cave.mapId}`);

  const outdoor = await call('procgen_outdoor', { name: 'Campo Aberto', width: 50, height: 40, seed: 7 });
  console.log(`[smoke] procgen_outdoor mapId=${outdoor.mapId}`);

  console.log('\n--- PROJECT UTILS ---');
  const lockCheck = await call('project_lock_check', {});
  console.log(`[smoke] project_lock_check: ${lockCheck.status}`);

  const snap = await call('project_backup_create', { label: 'manual-test' });
  console.log(`[smoke] project_backup_create: ${snap.id}`);

  const snaps = await call('project_list_backups', {});
  console.log(`[smoke] project_list_backups: ${snaps.count} snapshots`);

  // Undo: deleta um actor, depois undo
  await call('db_delete', { category: 'actor', id: 8 });
  console.log('[smoke] db_delete actor 8');
  const undone = await call('project_undo_last_change', {});
  console.log(`[smoke] project_undo_last_change: ${undone.undone}, ${undone.targetsRestored} targets`);

  const actor8 = await call('db_get', { category: 'actor', id: 8 });
  console.log(`[smoke] actor 8 restaurado? name="${actor8.name}"`);
  if (!actor8.name) throw new Error('undo não funcionou');

  console.log('\n--- GENERATOR ---');
  const parts = await call('generator_list_parts', { kind: 'Face', gender: 'Female' });
  console.log(`[smoke] generator_list_parts Face/Female: ${parts.categories?.join(',') ?? 'unavailable'} (${parts.totalFiles} files)`);
  // actor_sprite_generate é exercitado em wave-A.mjs (com parts reais) — aqui só listamos


  console.log('\n--- MZ INSTALL EXTRAS ---');
  const cs = await call('mz_install_get_corescript_path', { version: 'v1.6.0' });
  console.log(`[smoke] corescript v1.6.0: ${cs.files?.length ?? 0} arquivos (${cs.files?.slice(0, 3).join(',') ?? 'N/A'})`);

  const dlc = await call('mz_install_list_dlc_plugins', {});
  console.log(`[smoke] DLC sets: ${dlc.available ? Object.keys(dlc.sets).length : 'unavailable'}`);
  if (dlc.available) {
    const first = Object.keys(dlc.sets)[0];
    if (first) console.log(`[smoke]   sample set "${first}": ${dlc.sets[first].length} plugins`);
  }

  const help = await call('mz_install_get_help_url', { topic: 'actor', lang: 'en' });
  console.log(`[smoke] help URL actor: ${help.url ? help.url.slice(0, 80) + '...' : 'N/A'}`);

  console.log('\n--- SAMPLE MAPS ---');
  const sm = await call('samplemaps_list', { limit: 5 });
  console.log(`[smoke] samplemaps_list: ${sm.count} retornados de ${sm.total} total`);
  console.log(`[smoke] sample: ${JSON.stringify(sm.items[0])}`);

  const search = await call('samplemaps_search_by_features', { minWidth: 100, maxWidth: 200, minEvents: 3, limit: 10 });
  console.log(`[smoke] samplemaps_search 100-200wide com 3+ eventos: ${search.count} matches`);

  if (search.count > 0) {
    const cloned = await call('samplemaps_clone_to_project', {
      sampleFile: search.items[0].file,
      newMapName: 'Cloned Sample',
    });
    console.log(`[smoke] samplemaps_clone_to_project: novo mapId=${cloned.newMapId}, dim ${cloned.dimensions.w}x${cloned.dimensions.h}`);
  }

  console.log('\n[smoke] ALL PHASE 7 CHECKS PASSED ✓');
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
