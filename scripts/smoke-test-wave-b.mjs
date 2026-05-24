// Smoke test Onda B: CSV nested, plugin parser deep, runtime push events, map event search.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wB-'));
await copyDir(NEWDATA, tempDir);

const PORT = 39896;
const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: PORT, tokenFile: '.mz-mcp/companion.token' },
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
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wB', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- CSV NESTED (Onda B.1) ---');
  const exp = await call('db_export_csv', { category: 'skill' });
  const csvLines = exp.csv.split('\n');
  const header = csvLines[0];
  console.log(`[smoke] skill CSV header: ${header}`);
  if (!header.includes('damage') || !header.includes('effects') || !header.includes('traits')) {
    throw new Error('header sem nested fields');
  }
  // Linha 2 (skill 1 Attack) deve ter damage como JSON em uma das colunas
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse(exp.csv.trim(), { header: true, skipEmptyLines: true });
  const attack = parsed.data[0];
  console.log(`[smoke] skill 1 damage cell: ${attack.damage}`);
  if (!attack.damage.startsWith('{')) throw new Error('damage não foi serializado como JSON');

  // Modifica formula e re-importa
  const damage = JSON.parse(attack.damage);
  damage.formula = 'a.atk * 10 - b.def';
  attack.damage = JSON.stringify(damage);
  const newCsv = Papa.unparse(parsed.data);
  await call('db_import_csv', { category: 'skill', csvText: newCsv, dryRun: false });
  const after = await call('db_get', { category: 'skill', id: 1 });
  console.log(`[smoke] skill 1 damage.formula após import: "${after.damage.formula}"`);
  if (after.damage.formula !== 'a.atk * 10 - b.def') throw new Error('nested CSV import falhou');

  console.log('\n--- PLUGIN PARSER DEEP (Onda B.2) ---');
  await call('plugin_create_new', {
    name: 'StaminaBar',
    template: 'command_only',
    metadata: {
      target: 'MZ',
      plugindesc: 'Adds stamina bar',
      author: 'Test',
      help: 'Multi\nline\nhelp',
      params: [
        { name: 'maxStamina', type: 'number', text: 'Max', desc: 'Max stamina', default: 100, min: 1, max: 999 },
        { name: 'barColor', type: 'select', text: 'Color', options: ['red', 'blue', 'green'], default: 'red' },
        { name: 'enabled', type: 'boolean', on: 'On', off: 'Off', default: true },
      ],
      commands: [
        { name: 'setStamina', text: 'Set Stamina', args: [
          { name: 'value', type: 'number', default: 100, min: 0, max: 999 },
        ]},
      ],
    },
  });

  const deep = await call('plugin_parse_metadata_deep', { name: 'StaminaBar' });
  console.log(`[smoke] parsed: target=${deep.metadata.target}, params=${deep.metadata.params.length}, commands=${deep.metadata.commands.length}`);
  const maxStaminaParam = deep.metadata.params.find(p => p.name === 'maxStamina');
  console.log(`[smoke] maxStamina param: type=${maxStaminaParam.type}, default=${maxStaminaParam.default}, min=${maxStaminaParam.min}, max=${maxStaminaParam.max}`);
  const colorParam = deep.metadata.params.find(p => p.name === 'barColor');
  console.log(`[smoke] barColor options: ${colorParam.options?.join(',')}`);
  if (!colorParam.options?.includes('blue')) throw new Error('options não foram extraídas');

  const setStaminaCmd = deep.metadata.commands.find(c => c.name === 'setStamina');
  console.log(`[smoke] setStamina cmd: text="${setStaminaCmd.text}", args=${setStaminaCmd.args.length}`);
  if (setStaminaCmd.args[0]?.name !== 'value') throw new Error('args do command não extraídos');

  await call('plugin_uninstall', { name: 'StaminaBar' });

  console.log('\n--- RUNTIME PUSH EVENTS (Onda B.3) ---');
  // Conecta fake companion e simula eventos push
  const token = (await fs.readFile(path.join(tempDir, '.mz-mcp', 'companion.token'), 'utf-8')).trim();
  const fakeCompanion = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((resolve) => { fakeCompanion.on('open', resolve); });
  fakeCompanion.send(JSON.stringify({
    jsonrpc: '2.0', method: 'hello',
    params: { token, protocolVersion: '1.0', companionVersion: '0.1.0', gameTitle: 'Test' },
  }));
  await sleep(300);

  // Envia 3 eventos push
  fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { name: 'mapChanged', data: { mapId: 5, displayName: 'Vila' }, t: Date.now() } }));
  fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { name: 'switchChanged', data: { id: 3, value: true, name: 'QuestStarted' }, t: Date.now() } }));
  fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { name: 'goldChanged', data: { delta: 50, total: 200 }, t: Date.now() } }));
  await sleep(300);

  const drained = await call('runtime_drain_events', {});
  console.log(`[smoke] drain_events: ${drained.count} eventos`);
  if (drained.count !== 3) throw new Error(`esperado 3 eventos, got ${drained.count}`);

  // Testa waitForEvent
  setTimeout(() => {
    fakeCompanion.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { name: 'battleStarted', data: { troopId: 7 }, t: Date.now() } }));
  }, 200);
  const battleEv = await call('runtime_wait_for_event', { eventName: 'battleStarted', timeoutMs: 5000 });
  console.log(`[smoke] wait_for_event battleStarted: troopId=${battleEv.data.troopId}`);
  if (battleEv.data.troopId !== 7) throw new Error('waitForEvent retornou data errado');

  fakeCompanion.close();

  console.log('\n--- MAP EVENT SEARCH (Onda B.4) ---');
  // Adiciona evento de teste com diálogo
  const mapNew = await call('map_create', { name: 'TestMap', width: 17, height: 13 });
  const evCreate = await call('event_create', { mapId: mapNew.id, x: 5, y: 5, name: 'NPC Search' });
  await call('event_template_dialogue', {
    mapId: mapNew.id, eventId: evCreate.eventId,
    text: 'Bem-vindo, viajante de Aurora!\nQuer começar a aventura?',
  });

  const search = await call('map_event_search', { text: 'Aurora' });
  console.log(`[smoke] map_event_search "Aurora": ${search.count} matches`);
  console.log(`[smoke] match[0]: map ${search.matches[0].mapId}, event ${search.matches[0].eventId}, code ${search.matches[0].code}, preview="${search.matches[0].preview}"`);
  if (search.count === 0) throw new Error('search por texto não encontrou');

  const searchCode = await call('map_event_search', { codes: [101], mapId: mapNew.id });
  console.log(`[smoke] map_event_search code=101 in map ${mapNew.id}: ${searchCode.count} match`);

  // Switch search com includeMaps
  await call('event_template_conditional', { mapId: mapNew.id, eventId: evCreate.eventId, kind: 'switch', switchId: 42, switchOn: true });
  const swUses = await call('switch_search_uses', { id: 42, includeMaps: true });
  console.log(`[smoke] switch 42 uses: ${swUses.count} total (CommonEvents=${swUses.commonEventUses.length}, Maps=${swUses.mapUses.length})`);
  if (swUses.mapUses.length === 0) throw new Error('switch_search_uses não achou em maps');

  console.log('\n[smoke] ALL WAVE B CHECKS PASSED ✓');
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
