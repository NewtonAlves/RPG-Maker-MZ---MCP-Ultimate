// Smoke test Fase 6: companion bridge + runtime tools.
// Simula o MzMcpCompanion.js como um WS client em Node.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-p6-'));
await copyDir(NEWDATA, tempDir);

// Usa porta alternativa pra evitar conflito se outro test rodou
const PORT = 39893;
const env = {
  ...process.env,
  MZ_PROJECT_PATH: tempDir,
  MZ_MCP_LOG_LEVEL: 'info',
};

// Config file pra porta custom + enableEvalJs ligado pra teste
const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: true, companionPort: PORT, tokenFile: '.mz-mcp/companion.token' },
  plugins: { defaultNamingConvention: 'snake', knownBases: {} },
  logging: { level: 'info' },
};
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify(cfg, null, 2));

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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p6', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- companion_install ---');
  // Antes do install, runtime_status deve dizer connected=false
  const status0 = await call('runtime_status', {});
  console.log(`[smoke] runtime_status pre-install: connected=${status0.connected}, port=${status0.port}`);

  const inst = await call('companion_install', { enableEvalJs: true });
  console.log(`[smoke] companion_install: file=${path.basename(inst.file)}, port=${inst.port}`);

  // Espera a bridge estar listening (já deveria estar pelo registerRuntimeTools)
  await sleep(500);

  // Lê o token salvo no projeto
  const token = fsSync.readFileSync(path.join(tempDir, '.mz-mcp', 'companion.token'), 'utf-8').trim();
  console.log(`[smoke] token loaded (${token.length} chars)`);

  console.log('\n--- FAKE COMPANION (simula MzMcpCompanion.js) ---');
  const fakeCompanion = new WebSocket(`ws://127.0.0.1:${PORT}`);
  let _gameSwitches = {};
  let _gameVariables = {};
  let _player = { x: 5, y: 8, direction: 2, mapId: 1 };

  await new Promise((resolve) => { fakeCompanion.on('open', resolve); });
  console.log('[smoke] fake companion conectado');

  fakeCompanion.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'hello',
    params: {
      token,
      protocolVersion: '1.0',
      companionVersion: '0.1.0',
      gameTitle: 'Test Game',
    },
  }));

  // Handlers do fake companion
  fakeCompanion.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'helloAck') {
      console.log('[smoke] handshake ok');
      return;
    }
    if (typeof msg.id !== 'number') return;
    let result;
    try {
      switch (msg.method) {
        case 'ping': result = { pong: true, t: Date.now() }; break;
        case 'getState':
          result = {
            player: _player,
            party: { members: [{ id: 1, name: 'Reid', hp: 100, mp: 50, level: 5 }], gold: 250, steps: 42 },
            switches: Object.fromEntries(Object.entries(_gameSwitches).map(([k, v]) => [k, { name: `s${k}`, value: v }])),
            variables: Object.fromEntries(Object.entries(_gameVariables).map(([k, v]) => [k, { name: `v${k}`, value: v }])),
          };
          break;
        case 'getSwitch': result = { id: msg.params.id, value: !!_gameSwitches[msg.params.id] }; break;
        case 'setSwitch': _gameSwitches[msg.params.id] = !!msg.params.value; result = { id: msg.params.id, value: !!msg.params.value }; break;
        case 'getVariable': result = { id: msg.params.id, value: _gameVariables[msg.params.id] ?? 0 }; break;
        case 'setVariable': _gameVariables[msg.params.id] = msg.params.value; result = { id: msg.params.id, value: msg.params.value }; break;
        case 'transferPlayer':
          _player = { x: msg.params.x, y: msg.params.y, direction: msg.params.direction || 2, mapId: msg.params.mapId };
          result = { mapId: msg.params.mapId, x: msg.params.x, y: msg.params.y };
          break;
        case 'evalJs': result = { value: { evaluated: msg.params.code, fakeReturn: 42 } }; break;
        default: throw new Error(`fake companion não implementa ${msg.method}`);
      }
      fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    } catch (err) {
      fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(err.message) } }));
    }
  });

  // Aguarda handshake completar
  await sleep(500);

  console.log('\n--- RUNTIME TOOLS ---');
  const status1 = await call('runtime_status', {});
  console.log(`[smoke] runtime_status pos-conexao: connected=${status1.connected}, companion=${JSON.stringify(status1.companion)}`);
  if (!status1.connected) throw new Error('companion não conectou');

  const ping = await call('runtime_ping', {});
  console.log(`[smoke] runtime_ping: rttMs=${ping.rttMs}`);

  await call('runtime_set_switch', { id: 5, value: true });
  await call('runtime_set_switch', { id: 10, value: true });
  await call('runtime_set_variable', { id: 3, value: 99 });
  const s5 = await call('runtime_get_switch', { id: 5 });
  const v3 = await call('runtime_get_variable', { id: 3 });
  console.log(`[smoke] switch 5=${s5.value}, variable 3=${v3.value}`);
  if (!s5.value || v3.value !== 99) throw new Error('runtime get/set falhou');

  const state = await call('runtime_get_state', { scope: 'all' });
  console.log(`[smoke] runtime_get_state: player at (${state.player.x},${state.player.y}), party gold=${state.party.gold}`);

  await call('runtime_transfer_player', { mapId: 2, x: 15, y: 10, direction: 4 });
  const state2 = await call('runtime_get_state', { scope: 'player' });
  console.log(`[smoke] após transfer: player at (${state2.player.x},${state2.player.y}) mapId=${state2.player.mapId}`);

  const evalR = await call('runtime_eval_js', { code: '1+1' });
  console.log(`[smoke] runtime_eval_js: ${JSON.stringify(evalR.value)}`);

  console.log('\n[smoke] ALL PHASE 6 CHECKS PASSED ✓');
  fakeCompanion.close();
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
