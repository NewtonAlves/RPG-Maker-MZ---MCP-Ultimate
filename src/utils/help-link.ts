/**
 * Mapeia tópicos do mz-mcp pra páginas HTML da ajuda local do RPG Maker MZ.
 *
 * Usado por mensagens de erro pra dar deep-link pra documentação oficial quando
 * a instalação do MZ está detectada.
 */

import path from 'node:path';

/** Tópicos conhecidos — extensível conforme novas categorias de tool. */
export type HelpTopic =
  | 'actor'
  | 'class'
  | 'skill'
  | 'item'
  | 'weapon'
  | 'armor'
  | 'enemy'
  | 'troop'
  | 'state'
  | 'animation'
  | 'tileset'
  | 'common_event'
  | 'system'
  | 'map'
  | 'event_command'
  | 'plugin'
  | 'asset_character'
  | 'asset_face'
  | 'asset_tileset'
  | 'asset_audio'
  | 'switch_variable';

/** Topic → caminho relativo dentro de help-en/ (ou help-ja/, help-zh-cn/) */
const TOPIC_TO_PAGE: Record<HelpTopic, string> = {
  actor: '01_08_01.html',
  class: '01_08_02.html',
  skill: '01_08_03.html',
  item: '01_08_04.html',
  weapon: '01_08_05.html',
  armor: '01_08_06.html',
  enemy: '01_08_07.html',
  troop: '01_08_08.html',
  state: '01_08_09.html',
  animation: '01_08_11.html',
  tileset: '01_08_10.html',
  common_event: '01_08_13.html',
  system: '01_08_12.html',
  map: '01_07_01.html',
  event_command: '01_10.html',
  plugin: '01_11_05.html',
  asset_character: '01_11_01.html',
  asset_face: '01_11_01.html',
  asset_tileset: '01_11_01.html',
  asset_audio: '01_11_02.html',
  switch_variable: '01_10_02.html',
};

/**
 * Retorna o caminho file:// absoluto pra página de ajuda do tópico, ou undefined
 * se a instalação MZ não foi detectada.
 *
 * Ex.: helpUrl(installPath, 'actor', 'en') → file:///C:/.../help-en/01_08_01.html
 */
export function helpUrl(
  installPath: string | undefined,
  topic: HelpTopic,
  lang: 'en' | 'ja' | 'zh-cn' = 'en',
): string | undefined {
  if (!installPath || installPath === 'auto') return undefined;
  const page = TOPIC_TO_PAGE[topic];
  if (!page) return undefined;
  const helpDir = `help-${lang}`;
  const abs = path.join(installPath, helpDir, page);
  // file:// URL com forward slashes
  return 'file:///' + abs.replace(/\\/g, '/');
}
