/**
 * Especificação dos formatos de asset do RPG Maker MZ.
 *
 * Cada categoria de imagem tem uma pasta-alvo em img/ e dimensões esperadas.
 * Validação é warning-only por padrão (algumas categorias aceitam variações).
 */

export type ImageCategory =
  | 'characters'
  | 'faces'
  | 'tilesets'
  | 'parallaxes'
  | 'pictures'
  | 'enemies'
  | 'animations'
  | 'battlebacks1'
  | 'battlebacks2'
  | 'sv_actors'
  | 'sv_enemies'
  | 'icons'
  | 'system'
  | 'titles1'
  | 'titles2';

export type AudioCategory = 'bgm' | 'bgs' | 'me' | 'se';

export interface ImageSpec {
  folder: string;
  /** Dimensões esperadas. undefined = qualquer. */
  expectedWidth?: number;
  expectedHeight?: number;
  /** Categoria aceita variações (apenas warning, não erro). */
  flexible?: boolean;
  notes?: string;
}

export const IMAGE_SPECS: Record<ImageCategory, ImageSpec> = {
  characters: {
    folder: 'img/characters',
    notes: 'Sheet padrão: 12 chars (3x4 grid), cada char 144x192 (3 cols x 4 rows de 48x48). Total 576x384.',
    flexible: true,
  },
  faces: {
    folder: 'img/faces',
    expectedWidth: 576,
    expectedHeight: 384,
    notes: '4x2 grid de faces, cada uma 144x144. Sheet padrão 576x288 — mas 576x384 também ocorre.',
    flexible: true,
  },
  tilesets: {
    folder: 'img/tilesets',
    notes: 'Sheets A1-A5 e B-E têm tamanhos específicos. A4=768x720, B-E=768x768.',
    flexible: true,
  },
  parallaxes: { folder: 'img/parallaxes', flexible: true, notes: 'Background — tamanho livre.' },
  pictures: { folder: 'img/pictures', flexible: true, notes: 'Show Picture — qualquer dimensão.' },
  enemies: { folder: 'img/enemies', flexible: true, notes: 'Battler frontview — recomendado dimensões pares.' },
  animations: { folder: 'img/animations', flexible: true, notes: 'Frame sheet de animação.' },
  battlebacks1: {
    folder: 'img/battlebacks1',
    expectedWidth: 1000,
    expectedHeight: 740,
    notes: 'Floor da batalha.',
  },
  battlebacks2: {
    folder: 'img/battlebacks2',
    expectedWidth: 1000,
    expectedHeight: 740,
    notes: 'Wall/background da batalha.',
  },
  sv_actors: { folder: 'img/sv_actors', flexible: true, notes: 'Side-view actor sprite.' },
  sv_enemies: { folder: 'img/sv_enemies', flexible: true, notes: 'Side-view enemy sprite.' },
  icons: {
    folder: 'img/system',
    expectedWidth: 512,
    expectedHeight: 512,
    notes: 'IconSet.png — 32x32 grid de ícones 16x16.',
  },
  system: { folder: 'img/system', flexible: true, notes: 'UI elements.' },
  titles1: { folder: 'img/titles1', expectedWidth: 816, expectedHeight: 624, notes: 'Title bg.' },
  titles2: { folder: 'img/titles2', expectedWidth: 816, expectedHeight: 624, notes: 'Title frames.' },
};

export const AUDIO_SPECS: Record<AudioCategory, { folder: string; extensions: string[]; notes?: string }> = {
  bgm: { folder: 'audio/bgm', extensions: ['.ogg', '.m4a'], notes: 'Background music — loops.' },
  bgs: { folder: 'audio/bgs', extensions: ['.ogg', '.m4a'], notes: 'Background sound (ambient).' },
  me: { folder: 'audio/me', extensions: ['.ogg', '.m4a'], notes: 'Music effect (jingles).' },
  se: { folder: 'audio/se', extensions: ['.ogg', '.m4a'], notes: 'Sound effects.' },
};

export function isImageCategory(s: string): s is ImageCategory {
  return s in IMAGE_SPECS;
}
export function isAudioCategory(s: string): s is AudioCategory {
  return s in AUDIO_SPECS;
}
