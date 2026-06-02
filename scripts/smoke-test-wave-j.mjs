// Smoke test Onda J: asset_check_missing_references + event_validate_structure.
// (runtime_get_console_log exige Playtest ao vivo — validado manualmente.)
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wJ-'));
await copyDir(NEWDATA, tempDir);
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify({
  project: { path: 'auto' }, runtime: { companionPort: 39940 }, logging: { level: 'warn' },
}, null, 2));

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = ''; const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8'); let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {}
  }
});
let idc = 0;
function rpc(method, params) { const id = ++idc; return new Promise((res, rej) => { pending.set(id, res); server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000); }); }
function notify(method, params) { server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
async function call(name, args) { const r = await rpc('tools/call', { name, arguments: args }); if (r.error) throw new Error(name + ': ' + JSON.stringify(r.error)); if (r.result?.isError) throw new Error(name + ' isError: ' + r.result.content[0].text); return JSON.parse(r.result.content[0].text); }

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wJ', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools registradas`);

  console.log('\n--- J.1 ASSET MISSING REFERENCES ---');
  const baseline = await call('asset_check_missing_references', {});
  console.log(`[smoke] baseline newdata: totalReferenced=${baseline.totalReferenced}, problems=${baseline.totalProblems} (missing=${baseline.missingCount}, caseMismatch=${baseline.caseMismatchCount})`);
  if (typeof baseline.totalReferenced !== 'number') throw new Error('shape errado');

  // Injeta ref faltando: actor com characterName inexistente
  const actor1 = await call('db_get', { category: 'actor', id: 1 });
  await call('db_update', { category: 'actor', id: 1, patch: { characterName: 'ArquivoQueNaoExiste_XYZ' } });
  const afterInject = await call('asset_check_missing_references', { severity: 'missing' });
  const caught = afterInject.items.find(i => i.name === 'ArquivoQueNaoExiste_XYZ');
  console.log(`[smoke] após injetar ref fantasma: missingCount=${afterInject.missingCount}, pegou='${caught ? caught.name : 'NÃO'}' em ${caught ? caught.folder : '?'}`);
  if (!caught) throw new Error('checker não pegou characterName inexistente');
  // restaura
  await call('db_update', { category: 'actor', id: 1, patch: { characterName: actor1.characterName } });

  console.log('\n--- J.2 EVENT STRUCTURE VALIDATION ---');
  const struct = await call('event_validate_structure', {});
  console.log(`[smoke] newdata: ${struct.totalLists} listas, ${struct.errorCount} errors, ${struct.warningCount} warnings`);
  if (typeof struct.totalLists !== 'number') throw new Error('shape errado');

  // Injeta lista corrompida: escreve Map002 com command list sem terminador + indent quebrado
  const map2Path = path.join(tempDir, 'data', 'Map002.json');
  let map2;
  try { map2 = JSON.parse(await fs.readFile(map2Path, 'utf-8')); } catch { map2 = null; }
  if (!map2) {
    // cria um mapa mínimo se newdata só tem Map001
    map2 = { displayName: '', tilesetId: 1, width: 17, height: 13, scrollType: 0, autoplayBgm: false, bgm: { name: '', pan: 0, pitch: 100, volume: 90 }, autoplayBgs: false, bgs: { name: '', pan: 0, pitch: 100, volume: 90 }, disableDashing: false, encounterList: [], encounterStep: 30, parallaxLoopX: false, parallaxLoopY: false, parallaxName: '', parallaxShow: true, parallaxSx: 0, parallaxSy: 0, specifyBattleback: false, battleback1Name: '', battleback2Name: '', note: '', data: new Array(17*13*6).fill(0), events: [null] };
    const infosPath = path.join(tempDir, 'data', 'MapInfos.json');
    const infos = JSON.parse(await fs.readFile(infosPath, 'utf-8'));
    while (infos.length <= 2) infos.push(null);
    infos[2] = { id: 2, expanded: false, name: 'Corrupt', order: 2, parentId: 0, scrollX: 0, scrollY: 0 };
    await fs.writeFile(infosPath, JSON.stringify(infos));
  }
  // Evento com command list MALFORMADA: indent salta de 0 pra 2, sem terminador code 0
  map2.events[1] = {
    id: 1, name: 'Corrupt', note: '', x: 0, y: 0,
    pages: [{
      conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
      directionFix: false, image: { characterIndex: 0, characterName: '', direction: 2, pattern: 1, tileId: 0 },
      list: [
        { code: 111, indent: 0, parameters: [0, 1, 0, 0, 0] },
        { code: 401, indent: 2, parameters: ['salto de indent ilegal'] }, // indent jump 0→2 + 401 órfão
      ],
      moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }, moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true,
    }],
  };
  while (map2.events.length <= 1) map2.events.push(null);
  await fs.writeFile(map2Path, JSON.stringify(map2));

  const struct2 = await call('event_validate_structure', { severity: 'error' });
  console.log(`[smoke] após injetar lista corrompida: errors=${struct2.errorCount}`);
  const hasJump = struct2.issues.some(i => i.rule === 'indent_jump');
  const hasNoTerm = struct2.issues.some(i => i.rule === 'missing_terminator');
  console.log(`[smoke] detectou indent_jump=${hasJump}, missing_terminator=${hasNoTerm}`);
  if (!hasJump || !hasNoTerm) throw new Error('validador não pegou corrupção injetada');

  console.log('\n--- J.3 runtime_get_console_log (só registro — precisa Playtest) ---');
  const hasConsoleTool = list.result.tools.find(t => t.name === 'runtime_get_console_log');
  if (!hasConsoleTool) throw new Error('runtime_get_console_log não registrada');
  console.log('[smoke] runtime_get_console_log registrada ✓ (validação ao vivo manual)');

  console.log('\n[smoke] ALL WAVE J CHECKS PASSED ✓');
  server.kill();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) await copyDir(s, d); else if (e.isFile()) await fs.copyFile(s, d); }
}

try { await main(); } catch (err) { console.error('[smoke] FAILED:', err); server.kill(); process.exit(1); }
finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); process.exit(0); }
