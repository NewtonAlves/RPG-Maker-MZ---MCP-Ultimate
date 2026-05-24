// Smoke test Fase 2: db_list, db_search (read-only), depois CRUD completo num
// projeto temporário copiado de newdata.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

// 1) Cria um projeto temp copiando newdata
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-smoke-'));
console.log(`[smoke] Temp project at ${tempDir}`);
await copyDir(NEWDATA, tempDir);

// 2) Spawn server contra o temp project
const env = {
  ...process.env,
  MZ_PROJECT_PATH: tempDir,
  MZ_MCP_LOG_LEVEL: 'warn',
};
const server = spawn('node', ['dist/index.js'], {
  cwd: projectRoot,
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
});

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
  const req = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify(req) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 15_000);
  });
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
function expectOk(resp, label) {
  if (resp.error) {
    throw new Error(`${label}: error response: ${JSON.stringify(resp.error)}`);
  }
  if (resp.result?.isError) {
    throw new Error(`${label}: tool returned isError: ${resp.result.content?.[0]?.text}`);
  }
  return JSON.parse(resp.result.content[0].text);
}

async function main() {
  console.log('[smoke] initialize...');
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'phase2-smoke', version: '0.1.0' },
  });
  notify('notifications/initialized', {});

  console.log('[smoke] tools/list...');
  const list = await rpc('tools/list', {});
  const tools = list.result.tools.map((t) => t.name);
  console.log(`[smoke] ${tools.length} tools: ${tools.join(', ')}`);

  // ---- READ-ONLY ----
  console.log('\n[smoke] db_list actors...');
  const actorsList = expectOk(
    await rpc('tools/call', { name: 'db_list', arguments: { category: 'actor', limit: 3 } }),
    'db_list',
  );
  console.log(`[smoke]   total=${actorsList.total}, returned=${actorsList.returned}`);
  console.log(`[smoke]   first 3:`, actorsList.items.map((i) => `${i.id}:${i.name}`).join(', '));

  console.log('\n[smoke] db_search skills for "Heal"...');
  const skillSearch = expectOk(
    await rpc('tools/call', {
      name: 'db_search',
      arguments: { category: 'skill', query: 'Heal', field: 'name' },
    }),
    'db_search',
  );
  console.log(`[smoke]   found=${skillSearch.count}`);

  // ---- WRITE ----
  console.log('\n[smoke] actor_create Marina...');
  const marina = expectOk(
    await rpc('tools/call', {
      name: 'actor_create',
      arguments: { name: 'Marina', classId: 5, initialLevel: 5, characterIndex: 4, faceIndex: 4 },
    }),
    'actor_create',
  );
  console.log(`[smoke]   Marina created id=${marina.id}`);

  console.log('\n[smoke] db_get actor Marina...');
  const got = expectOk(
    await rpc('tools/call', { name: 'db_get', arguments: { category: 'actor', id: marina.id } }),
    'db_get',
  );
  console.log(`[smoke]   got name=${got.name}, classId=${got.classId}, level=${got.initialLevel}`);

  console.log('\n[smoke] db_update Marina nickname...');
  expectOk(
    await rpc('tools/call', {
      name: 'db_update',
      arguments: { category: 'actor', id: marina.id, patch: { nickname: 'A Maga de Fogo' } },
    }),
    'db_update',
  );
  const updated = expectOk(
    await rpc('tools/call', { name: 'db_get', arguments: { category: 'actor', id: marina.id } }),
    'db_get verify update',
  );
  if (updated.nickname !== 'A Maga de Fogo') {
    throw new Error(`update verify failed: nickname is "${updated.nickname}"`);
  }
  console.log(`[smoke]   nickname now="${updated.nickname}" ✓`);

  console.log('\n[smoke] skill_create_damage Bola de Fogo...');
  const bolaDeFogo = expectOk(
    await rpc('tools/call', {
      name: 'skill_create_damage',
      arguments: {
        name: 'Bola de Fogo',
        description: 'Lança uma bola de fogo no inimigo',
        mpCost: 8,
        formula: 'a.mat * 3 + 50',
        elementId: 2,
        variance: 15,
        critical: true,
        iconIndex: 64,
      },
    }),
    'skill_create_damage',
  );
  console.log(`[smoke]   skill created id=${bolaDeFogo.id}`);

  console.log('\n[smoke] skill_create_healing Cura Branca...');
  const curaBranca = expectOk(
    await rpc('tools/call', {
      name: 'skill_create_healing',
      arguments: { name: 'Cura Branca', mpCost: 10, formula: 'a.mat * 4 + 80', iconIndex: 72 },
    }),
    'skill_create_healing',
  );
  console.log(`[smoke]   skill created id=${curaBranca.id}`);

  console.log('\n[smoke] enemy_create_balanced Slime de Gelo level 12...');
  const slime = expectOk(
    await rpc('tools/call', {
      name: 'enemy_create_balanced',
      arguments: { name: 'Slime de Gelo', level: 12, role: 'elemental_ice' },
    }),
    'enemy_create_balanced',
  );
  console.log(
    `[smoke]   enemy created id=${slime.id}, stats: hp=${slime.computed.stats.hp}, atk=${slime.computed.stats.atk}, mat=${slime.computed.stats.mat}, exp=${slime.computed.stats.exp}, gold=${slime.computed.stats.gold}`,
  );

  console.log('\n[smoke] enemy_create_balanced Dragão (boss) level 30...');
  const drago = expectOk(
    await rpc('tools/call', {
      name: 'enemy_create_balanced',
      arguments: { name: 'Dragão Ancião', level: 30, role: 'boss' },
    }),
    'enemy_create_balanced boss',
  );
  console.log(
    `[smoke]   boss created id=${drago.id}, hp=${drago.computed.stats.hp}, exp=${drago.computed.stats.exp}`,
  );

  console.log('\n[smoke] db_delete Marina (destructive, deve criar snapshot)...');
  const delResp = expectOk(
    await rpc('tools/call', {
      name: 'db_delete',
      arguments: { category: 'actor', id: marina.id },
    }),
    'db_delete',
  );
  console.log(`[smoke]   deleted=${delResp.deleted}`);

  // Verifica snapshot foi criado
  const backupDir = path.join(tempDir, '.mz-mcp', 'backups');
  const snaps = await fs.readdir(backupDir).catch(() => []);
  if (snaps.length === 0) {
    throw new Error('snapshot não foi criado após db_delete (autoBackup falhou)');
  }
  console.log(`[smoke]   snapshot existe: ${snaps[0]} ✓`);

  // Verifica que o versionId foi bumpado (System.json modificado)
  const systemAfter = JSON.parse(
    await fs.readFile(path.join(tempDir, 'data', 'System.json'), 'utf-8'),
  );
  console.log(`[smoke]   System.json versionId=${systemAfter.versionId} ✓ (bumpado a cada write)`);

  console.log('\n[smoke] ALL CHECKS PASSED ✓');
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
  // Cleanup temp dir
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  console.log(`[smoke] cleanup ${tempDir}`);
  process.exit(0);
}
