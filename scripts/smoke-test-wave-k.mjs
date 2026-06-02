// Smoke test Onda K: event_check_references + text_replace_all + event_template_shop.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wK-'));
await copyDir(NEWDATA, tempDir);
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify({
  project: { path: 'auto' }, runtime: { companionPort: 39950 }, logging: { level: 'warn' },
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wK', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools registradas`);

  console.log('\n--- K.1 EVENT CHECK REFERENCES ---');
  const baseline = await call('event_check_references', {});
  console.log(`[smoke] baseline newdata: ${baseline.totalCommands} comandos, errors=${baseline.errorCount}, warnings=${baseline.warningCount}`);

  // Injeta: cria Map002 com evento que (a) transfere pra mapa 888 inexistente, (b) chama common event 777, (c) texto com \V[999]
  const map2Path = path.join(tempDir, 'data', 'Map002.json');
  const map2 = { displayName: '', tilesetId: 1, width: 17, height: 13, scrollType: 0, autoplayBgm: false, bgm: { name: '', pan: 0, pitch: 100, volume: 90 }, autoplayBgs: false, bgs: { name: '', pan: 0, pitch: 100, volume: 90 }, disableDashing: false, encounterList: [], encounterStep: 30, parallaxLoopX: false, parallaxLoopY: false, parallaxName: '', parallaxShow: true, parallaxSx: 0, parallaxSy: 0, specifyBattleback: false, battleback1Name: '', battleback2Name: '', note: '', data: new Array(17*13*6).fill(0), events: [null, {
    id: 1, name: 'RefTest', note: '', x: 0, y: 0,
    pages: [{
      conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
      directionFix: false, image: { characterIndex: 0, characterName: '', direction: 2, pattern: 1, tileId: 0 },
      list: [
        { code: 201, indent: 0, parameters: [0, 888, 5, 5, 0, 0] },   // transfer pra mapa inexistente
        { code: 117, indent: 0, parameters: [777] },                   // call common event inexistente
        { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 0, parameters: ['Voce tem \\V[999] moedas'] }, // \V fora do range
        { code: 0, indent: 0, parameters: [] },
      ],
      moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }, moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true,
    }],
  }] };
  await fs.writeFile(map2Path, JSON.stringify(map2));
  const infosPath = path.join(tempDir, 'data', 'MapInfos.json');
  const infos = JSON.parse(await fs.readFile(infosPath, 'utf-8'));
  while (infos.length <= 2) infos.push(null);
  infos[2] = { id: 2, expanded: false, name: 'RefTest', order: 2, parentId: 0, scrollX: 0, scrollY: 0 };
  await fs.writeFile(infosPath, JSON.stringify(infos));

  const checked = await call('event_check_references', {});
  console.log(`[smoke] após injetar refs quebradas: errors=${checked.errorCount}, warnings=${checked.warningCount}, byRule=${JSON.stringify(checked.byRule)}`);
  const hasTransfer = checked.issues.some(i => i.rule === 'transfer_to_missing_map');
  const hasCall = checked.issues.some(i => i.rule === 'call_missing_common_event');
  const hasEscape = checked.issues.some(i => i.rule === 'escape_variable_out_of_range');
  console.log(`[smoke] transfer_to_missing_map=${hasTransfer}, call_missing_common_event=${hasCall}, escape_variable_out_of_range=${hasEscape}`);
  if (!hasTransfer || !hasCall || !hasEscape) throw new Error('event_check_references não pegou tudo');

  console.log('\n--- K.2 TEXT REPLACE ALL ---');
  // dry-run: procura "moedas" (1 ocorrência injetada acima)
  const dry = await call('text_replace_all', { find: 'moedas', replace: 'cristais', dryRun: true });
  console.log(`[smoke] dry-run 'moedas'→'cristais': ${dry.totalOccurrences} ocorrências, ${dry.filesAffected} arquivos, dryRun=${dry.dryRun}`);
  if (dry.totalOccurrences < 1) throw new Error('replace dry-run não achou');
  // aplica de verdade
  const applied = await call('text_replace_all', { find: 'moedas', replace: 'cristais', dryRun: false });
  console.log(`[smoke] aplicado: ${applied.totalOccurrences} substituições, ${applied.filesAffected} arquivos`);
  // confirma que mudou: re-procura "moedas" deve dar 0, "cristais" deve dar 1
  const after = await call('text_replace_all', { find: 'moedas', replace: 'X', dryRun: true });
  const afterNew = await call('text_replace_all', { find: 'cristais', replace: 'X', dryRun: true });
  console.log(`[smoke] após aplicar: 'moedas'=${after.totalOccurrences}, 'cristais'=${afterNew.totalOccurrences}`);
  if (after.totalOccurrences !== 0 || afterNew.totalOccurrences < 1) throw new Error('replace não persistiu');

  console.log('\n--- K.3 EVENT TEMPLATE SHOP ---');
  const shop = await call('event_template_shop', {
    mapId: 2, eventId: 1, pageIndex: 0,
    goods: [{ kind: 'item', dataId: 1, price: 0 }, { kind: 'weapon', dataId: 1, price: 500 }, { kind: 'armor', dataId: 1 }],
    purchaseOnly: false,
  });
  console.log(`[smoke] shop inserido: goodsCount=${shop.goodsCount}`);
  // confirma no disco: Map002 deve ter um code 302 e dois 605
  const map2after = JSON.parse(await fs.readFile(map2Path, 'utf-8'));
  const cmds = map2after.events[1].pages[0].list;
  const has302 = cmds.filter(c => c.code === 302).length;
  const has605 = cmds.filter(c => c.code === 605).length;
  console.log(`[smoke] no disco: ${has302}x code 302, ${has605}x code 605`);
  if (has302 !== 1 || has605 !== 2) throw new Error('shop template não inseriu certo (esperava 1x302 + 2x605)');

  console.log('\n[smoke] ALL WAVE K CHECKS PASSED ✓');
  server.kill();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) await copyDir(s, d); else if (e.isFile()) await fs.copyFile(s, d); }
}

try { await main(); } catch (err) { console.error('[smoke] FAILED:', err); server.kill(); process.exit(1); }
finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); process.exit(0); }
