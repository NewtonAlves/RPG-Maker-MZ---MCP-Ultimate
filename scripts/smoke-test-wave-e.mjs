// Smoke test Onda E: catálogos + helpers que escondem códigos crípticos.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wE-'));
await copyDir(NEWDATA, tempDir);

const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: 39898, tokenFile: '.mz-mcp/companion.token' },
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wE', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- EVENT COMMAND CATALOG ---');
  const cmd = await call('event_command_describe', { codeOrName: 111 });
  console.log(`[smoke] code 111 → ${cmd.name} (${cmd.category}) com ${cmd.params.length} params`);
  if (cmd.name !== 'Conditional Branch') throw new Error('describe falhou');

  const byName = await call('event_command_describe', { codeOrName: 'Show Text' });
  console.log(`[smoke] 'Show Text' → code ${byName.code}`);

  const messages = await call('event_command_search', { category: 'message' });
  console.log(`[smoke] category=message: ${messages.count} commands`);

  const cats = await call('event_command_categories', {});
  console.log(`[smoke] categories: ${cats.count}`);

  console.log('\n--- EFFECT HELPERS ---');
  const effectKinds = await call('effect_list_kinds', {});
  console.log(`[smoke] ${effectKinds.count} effect kinds`);

  const skillAddEffect = await call('skill_add_effect', { skillId: 1, kind: 'recover_hp', value1: 0.25, value2: 50 });
  console.log(`[smoke] added recover_hp to skill 1: code=${skillAddEffect.addedEffect.code}, dataId=${skillAddEffect.addedEffect.dataId}, v1=${skillAddEffect.addedEffect.value1}, v2=${skillAddEffect.addedEffect.value2}`);
  if (skillAddEffect.addedEffect.code !== 11) throw new Error('effect code 11 esperado');

  console.log('\n--- TRAIT HELPERS ---');
  const trait = await call('db_add_trait', { category: 'actor', id: 1, kind: 'param_rate', dataId: 2, value: 1.5 });
  console.log(`[smoke] added param_rate to actor 1: code=${trait.addedTrait.code}, dataId=${trait.addedTrait.dataId}, value=${trait.addedTrait.value}`);
  if (trait.addedTrait.code !== 21) throw new Error('trait code 21 esperado');

  const decoded = await call('db_list_traits_decoded', { category: 'actor', id: 1 });
  console.log(`[smoke] actor 1 traits decoded: ${decoded.count}`);
  const pr = decoded.traits.find(t => t.kind === 'param_rate');
  console.log(`[smoke] param_rate human: "${pr?.human}"`);
  if (!pr?.human?.includes('ATK')) throw new Error('decoded human errado');

  console.log('\n--- TILESET FLAGS ---');
  const blockSouth = await call('tileset_set_passage', { tilesetId: 1, tileIdx: 100, blockedDirs: ['down'] });
  console.log(`[smoke] tileset 1 tile 100: passage set, newFlag=${blockSouth.newFlag}`);

  const setLadder = await call('tileset_set_flag', { tilesetId: 1, tileIdx: 100, kind: 'ladder', value: true });
  console.log(`[smoke] ladder set: newFlag=${setLadder.newFlag}`);

  const setTerrain = await call('tileset_set_terrain_tag', { tilesetId: 1, tileIdx: 100, tag: 5 });
  console.log(`[smoke] terrain_tag=5 set: newFlag=${setTerrain.newFlag}`);

  const flagsDecoded = await call('tileset_get_flags_decoded', { tilesetId: 1, tileIdx: 100 });
  console.log(`[smoke] decoded: passage.down=${flagsDecoded.decoded.passage.down}, ladder=${flagsDecoded.decoded.ladder}, terrain_tag=${flagsDecoded.decoded.terrain_tag}`);
  if (flagsDecoded.decoded.passage.down !== false) throw new Error('south não bloqueado');
  if (!flagsDecoded.decoded.ladder) throw new Error('ladder não set');
  if (flagsDecoded.decoded.terrain_tag !== 5) throw new Error('terrain_tag errado');

  console.log('\n--- NOTETAGS ---');
  const skillTags = await call('note_list_known_tags', { category: 'skill' });
  console.log(`[smoke] notetags pra skill: ${skillTags.count}`);

  await call('note_add_tag', { category: 'weapon', id: 1, tag: 'element', value: 'fire' });
  const parsed = await call('note_parse_tags', { category: 'weapon', id: 1 });
  console.log(`[smoke] weapon 1 tags after add: ${parsed.count}, raw="${parsed.rawNote}"`);
  const elementTag = parsed.tags.find(t => t.tag === 'element');
  if (elementTag?.value !== 'fire') throw new Error('tag não foi parseada corretamente');

  console.log('\n--- COMPAT ---');
  const compat = await call('plugin_check_compatibility', { name: 'VisuMZ_1_BattleCore' });
  console.log(`[smoke] VisuMZ_1_BattleCore: ${compat.issueCount} issues`);
  if (compat.issueCount === 0) throw new Error('esperava issues pra VisuMZ_1_BattleCore');

  const yep = await call('plugin_check_compatibility', { name: 'YEP_SkillCore' });
  console.log(`[smoke] YEP_SkillCore: ${yep.issueCount} issues (deveria detectar YEP_* wildcard)`);
  if (!yep.issues.some(i => i.id === 'yep_ports_deprecated')) throw new Error('YEP wildcard não detectado');

  const order = await call('plugin_recommend_load_order', {});
  console.log(`[smoke] load order recommendation: ${order.recommendedOrder.length} positions`);

  console.log('\n--- DAMAGE FORMULAS ---');
  const physical = await call('damage_formula_list_presets', { tags: ['physical'] });
  console.log(`[smoke] physical formulas: ${physical.count}`);

  const preset = await call('damage_formula_get_preset', { id: 'drain_hp' });
  console.log(`[smoke] drain_hp preset: type=${preset.type}, formula="${preset.formula}"`);
  if (preset.type !== 5) throw new Error('drain_hp deveria ter type=5');

  console.log('\n--- SKILL_CREATE_DAMAGE COM PRESET ---');
  const skillFromPreset = await call('skill_create_damage', {
    name: 'Drain Attack',
    formulaPreset: 'drain_hp',
    mpCost: 15,
  });
  console.log(`[smoke] skill from preset: id=${skillFromPreset.id}, usedPreset=${skillFromPreset.usedPreset}, damage.type=${skillFromPreset.skill.damage.type}`);
  if (skillFromPreset.skill.damage.type !== 5) throw new Error('preset não aplicou type correto');

  console.log('\n[smoke] ALL WAVE E CHECKS PASSED ✓');
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
