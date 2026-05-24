// Smoke test Onda G: memória persistente + 6 análises semânticas.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wG-'));
await copyDir(NEWDATA, tempDir);

const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: 39920, tokenFile: '.mz-mcp/companion.token' },
  plugins: { defaultNamingConvention: 'snake', knownBases: {} },
  logging: { level: 'warn' },
  dashboard: { enabled: false, port: 39921 },
};
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify(cfg, null, 2));

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const pending = new Map();
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30_000);
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wG', version: '0' } });
  notify('notifications/initialized', {});

  const list = await rpc('tools/list', {});
  const total = list.result.tools.length;
  console.log(`[smoke] ${total} tools registradas`);

  console.log('\n--- G.1 MEMORY ROUND-TRIP ---');
  const cats0 = await call('project_memory_categories', {});
  console.log(`[smoke] categorias iniciais: ${cats0.categories.map(c => `${c.category}=${c.count}`).join(', ')}`);
  if (cats0.categories.length !== 7) throw new Error('esperava 7 categorias');

  const rem = await call('project_memory_remember', {
    category: 'design_decisions',
    key: 'reid_starts_weak',
    content: 'O Reid começa fraco propositalmente.',
    tags: ['protagonist'],
  });
  console.log(`[smoke] remembered: ${rem.key} (${rem.category})`);
  if (!rem.remembered) throw new Error('remember falhou');

  const rec = await call('project_memory_recall', { category: 'design_decisions' });
  console.log(`[smoke] recall: ${rec.count} entries, totalInProject=${rec.totalInProject}`);
  if (rec.count !== 1) throw new Error('esperava 1 entry');
  if (!rec.entries[0].content.includes('Reid')) throw new Error('content errado');

  // Update
  await call('project_memory_remember', {
    category: 'design_decisions',
    key: 'reid_starts_weak',
    content: 'O Reid começa fraco — IMPORTANTE: nivel 1 só com 1 skill.',
    tags: ['protagonist', 'tutorial'],
  });
  const rec2 = await call('project_memory_recall', { search: 'tutorial' });
  console.log(`[smoke] após update, search 'tutorial': ${rec2.count} hits`);
  if (rec2.count !== 1) throw new Error('search falhou');

  // Forget
  await call('project_memory_forget', { key: 'reid_starts_weak' });
  const after = await call('project_memory_recall', {});
  console.log(`[smoke] após forget: ${after.count} entries restantes`);
  if (after.count !== 0) throw new Error('forget não removeu');

  console.log('\n--- G.2 ANALYSIS NPC DIALOGUE ---');
  const npcs = await call('analysis_npc_dialogue_map', {});
  console.log(`[smoke] ${npcs.totalMaps} mapas, ${npcs.totalNpcsWithDialogue} NPCs com diálogo, ${npcs.totalDialogueLines} diálogos`);
  if (typeof npcs.totalMaps !== 'number') throw new Error('shape errado');

  console.log('\n--- G.3 SWITCH/VARIABLE GRAPH ---');
  const graph = await call('analysis_switch_variable_graph', {});
  console.log(`[smoke] switches: total=${graph.switches.total}, dead=${graph.switches.dead.length}, orphan=${graph.switches.orphan.length}`);
  console.log(`[smoke] variables: total=${graph.variables.total}, dead=${graph.variables.dead.length}, orphan=${graph.variables.orphan.length}`);

  console.log('\n--- G.4 ITEM ECONOMY ---');
  const econ = await call('analysis_item_economy', {});
  console.log(`[smoke] items=${econ.totalItems}, weapons=${econ.totalWeapons}, armors=${econ.totalArmors}, unreachable=${econ.unreachableCount}`);

  console.log('\n--- G.5 SKILL DISTRIBUTION ---');
  const skills = await call('analysis_skill_distribution', {});
  console.log(`[smoke] skills=${skills.totalSkills}, unreachable=${skills.unreachableCount}`);
  const topSkill = skills.skills.find(s => s.learners.length > 0);
  if (topSkill) console.log(`[smoke] skill mais ensinada: '${topSkill.name}' (${topSkill.learners.length} learners, mainStat=${topSkill.mainStat ?? '?'})`);

  console.log('\n--- G.6 ENEMY APPEARANCES + TILESET ---');
  const enemies = await call('analysis_enemy_appearances', {});
  console.log(`[smoke] enemies=${enemies.totalEnemies}, unreachable=${enemies.unreachableCount}`);
  const tilesets = await call('analysis_tileset_usage', {});
  console.log(`[smoke] tilesets=${tilesets.totalTilesets}, unused=${tilesets.unusedCount}`);

  console.log('\n--- G.7 CACHE ---');
  const start = Date.now();
  await call('analysis_npc_dialogue_map', {});
  const cachedMs = Date.now() - start;
  console.log(`[smoke] re-run cached: ${cachedMs}ms`);

  const start2 = Date.now();
  await call('analysis_npc_dialogue_map', { force: true });
  const freshMs = Date.now() - start2;
  console.log(`[smoke] re-run force: ${freshMs}ms`);

  await call('analysis_clear_cache', {});
  console.log(`[smoke] cache cleared`);

  console.log('\n[smoke] ALL WAVE G CHECKS PASSED ✓');
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
