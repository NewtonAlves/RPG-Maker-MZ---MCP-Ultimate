/**
 * Registro central de todas as tools do mz-mcp.
 *
 * Cada categoria tem sua própria pasta e expõe uma função `register*Tools(server, config)`.
 * Esta entry só orquestra os registros.
 *
 * Conforme as fases avançam, mais imports são adicionados aqui.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Config } from '../config.js';
import { registerAssetTools } from './assets/index.js';
import { registerBuildTools } from './build/index.js';
import { registerCodesTools } from './codes/index.js';
import { registerCompatTools } from './compat/index.js';
import { registerCsvTools } from './csv/index.js';
import { registerDamageFormulaTools } from './damage-formulas/index.js';
import { registerDatabaseTools } from './database/index.js';
import { registerEffectHelperTools } from './database/effects-helpers.js';
import { registerTraitHelperTools } from './database/traits-helpers.js';
import { registerEventTools } from './events/index.js';
import { registerAnalysisTools } from './analysis/index.js';
import { registerLocalizationTools } from './localization/index.js';
import { registerGeneratorTools } from './generator/index.js';
import { registerMemoryTools } from './memory/index.js';
import { registerMapTools } from './maps/index.js';
import { registerMzInstallTools } from './mz-install/index.js';
import { registerNotetagTools } from './notetags/index.js';
import { registerPluginTools } from './plugins/index.js';
import { registerProcgenTools } from './procgen/index.js';
import { registerProjectTools } from './project/index.js';
import { registerSampleMapsTools } from './samplemaps/index.js';
import { registerRuntimeTools } from './runtime/index.js';
import { registerSaveTools } from './saves/index.js';
import { registerSwitchVariableTools } from './switches/index.js';
import { registerSystemTools } from './system/index.js';
import { registerTilesetFlagTools } from './tileset-flags/index.js';
import { registerTroopTools } from './troops/index.js';

export async function registerAllTools(server: McpServer, config: Config): Promise<void> {
  // Fase 1: ferramentas de núcleo
  registerMzInstallTools(server, config);
  registerProjectTools(server, config);

  // Fase 2: database CRUD genérico + helpers especializados
  registerDatabaseTools(server, config);

  // Fase 3: maps, events, troops
  registerMapTools(server, config);
  registerEventTools(server, config);
  registerTroopTools(server, config);

  // Fase 4: plugins, assets, system
  registerPluginTools(server, config);
  registerAssetTools(server, config);
  registerSystemTools(server, config);

  // Fase 5: switches/vars, csv, build, localization, saves
  registerSwitchVariableTools(server, config);
  registerCsvTools(server, config);
  registerBuildTools(server, config);
  registerLocalizationTools(server, config);
  registerSaveTools(server, config);

  // Fase 6: runtime (companion bridge + tools)
  registerRuntimeTools(server, config);

  // Fase 7: polish (procgen, generator, samplemaps, mz-install extras, project extras)
  registerProcgenTools(server, config);
  registerGeneratorTools(server, config);
  registerSampleMapsTools(server, config);

  // Onda E: knowledge distillation
  registerCodesTools(server, config);
  registerEffectHelperTools(server, config);
  registerTraitHelperTools(server, config);
  registerTilesetFlagTools(server, config);
  registerNotetagTools(server, config);
  registerCompatTools(server, config);
  registerDamageFormulaTools(server, config);

  // Onda G: memória persistente do projeto + análises semânticas
  registerMemoryTools(server, config);
  registerAnalysisTools(server, config);
}
