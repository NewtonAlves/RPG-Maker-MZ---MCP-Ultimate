/* eslint-disable no-undef */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // === Mapa de labels PT-BR para tools (display amigável na atividade) ===
  // Os nomes técnicos (runtime_screenshot etc) são identificadores da API MCP e
  // não podem ser renomeados — esse mapa só serve pra UI.
  const TOOL_LABELS_PTBR = {
    // Runtime (companion)
    runtime_status: 'Status da conexão',
    runtime_ping: 'Ping no jogo',
    runtime_screenshot: 'Captura tela do jogo',
    runtime_inspect: 'Inspecionar dado',
    runtime_get_state: 'Estado do jogo',
    runtime_get_scene_state: 'Estado da cena',
    runtime_get_window_state: 'Janelas visíveis',
    runtime_get_battle_state: 'Estado da batalha',
    runtime_get_message_state: 'Estado da mensagem',
    runtime_get_actor_state: 'Estado do personagem',
    runtime_get_switch: 'Ler switch',
    runtime_get_variable: 'Ler variável',
    runtime_set_switch: 'Definir switch',
    runtime_set_variable: 'Definir variável',
    runtime_set_self_switch: 'Definir self switch',
    runtime_set_actor_hp: 'Definir HP',
    runtime_set_actor_mp: 'Definir MP',
    runtime_call_common_event: 'Chamar Common Event',
    runtime_force_battle: 'Forçar batalha',
    runtime_transfer_player: 'Teleportar jogador',
    runtime_eval_js: 'Executar JS no jogo',
    runtime_hot_reload: 'Recarregar assets',
    runtime_drain_events: 'Drenar eventos',
    runtime_wait_for_event: 'Aguardar evento',

    // Map
    map_list: 'Listar mapas',
    map_get: 'Ler mapa',
    map_create: 'Criar mapa',
    map_delete: 'Deletar mapa',
    map_set_properties: 'Editar propriedades do mapa',
    map_tile_set: 'Editar tile',
    map_tile_fill_rect: 'Preencher área de tiles',
    map_layer_clear: 'Limpar camada',
    map_event_search: 'Buscar eventos no mapa',
    map_render: 'Renderizar mapa',

    // Database CRUD
    db_list: 'Listar registros',
    db_get: 'Ler registro',
    db_create: 'Criar registro',
    db_update: 'Atualizar registro',
    db_delete: 'Deletar registro',
    db_search: 'Buscar no banco',
    db_check_consistency: 'Verificar integridade do banco',
    db_add_trait: 'Adicionar trait',
    db_list_traits_decoded: 'Listar traits decodificados',
    db_export_csv: 'Exportar pra CSV',
    db_import_csv: 'Importar de CSV',
    db_diff_csv: 'Comparar CSV',

    // Helpers especializados
    actor_create: 'Criar personagem',
    actor_sprite_generate: 'Gerar sprite de personagem',
    actor_face_generate: 'Gerar rosto',
    actor_battler_generate_sv: 'Gerar battler side-view',
    enemy_create_balanced: 'Criar inimigo balanceado',
    skill_create_damage: 'Criar habilidade de dano',
    skill_create_healing: 'Criar habilidade de cura',
    skill_add_effect: 'Adicionar efeito à skill',
    item_add_effect: 'Adicionar efeito ao item',

    // Eventos
    event_create: 'Criar evento',
    event_delete: 'Deletar evento',
    event_get: 'Ler evento',
    event_move: 'Mover evento',
    event_page_add: 'Adicionar página de evento',
    event_list_in_map: 'Listar eventos do mapa',
    event_template_dialogue: 'Adicionar diálogo',
    event_template_choices: 'Adicionar escolhas',
    event_template_conditional: 'Adicionar condicional',
    event_template_transfer: 'Adicionar transferência',
    event_template_battle: 'Adicionar batalha',
    event_template_play_sound: 'Adicionar som',
    event_template_change_party_member: 'Trocar membro do grupo',
    event_command_add_generic: 'Adicionar comando de evento',
    event_command_describe: 'Descrever comando',
    event_command_search: 'Buscar comando',
    event_command_categories: 'Listar categorias de comando',

    // Catálogos
    effect_describe: 'Descrever efeito',
    effect_list_kinds: 'Listar tipos de efeito',
    trait_describe: 'Descrever trait',
    trait_list_kinds: 'Listar tipos de trait',
    damage_formula_list_presets: 'Listar fórmulas de dano',
    damage_formula_get_preset: 'Ler fórmula de dano',
    damage_formula_list_all: 'Todas as fórmulas',

    // Troops
    troop_create: 'Criar grupo de batalha',
    troop_member_add: 'Adicionar inimigo ao grupo',
    troop_member_remove: 'Remover inimigo do grupo',
    troop_set_layout: 'Definir layout do grupo',
    troop_battle_event_add: 'Adicionar evento de batalha',

    // Plugins
    plugin_list_installed: 'Listar plugins instalados',
    plugin_install_from_file: 'Instalar plugin (arquivo)',
    plugin_install_from_dlc: 'Instalar plugin (DLC)',
    plugin_enable: 'Habilitar plugin',
    plugin_disable: 'Desabilitar plugin',
    plugin_uninstall: 'Desinstalar plugin',
    plugin_reorder: 'Reordenar plugins',
    plugin_set_param: 'Editar parâmetro de plugin',
    plugin_update_code: 'Atualizar código de plugin',
    plugin_create_new: 'Criar novo plugin',
    plugin_validate_metadata: 'Validar metadata de plugin',
    plugin_parse_metadata_deep: 'Analisar metadata profundo',
    plugin_check_compatibility: 'Verificar compatibilidade',
    plugin_compat_list_all: 'Listar compatibilidade',
    plugin_recommend_load_order: 'Recomendar ordem de plugins',

    // Tileset
    tileset_set_passage: 'Definir passagem de tile',
    tileset_set_terrain_tag: 'Definir terrain tag',
    tileset_set_flag: 'Definir flag de tile',
    tileset_get_flags_decoded: 'Ler flags de tile',
    tileset_encode_flag: 'Codificar flag',

    // Notetags
    note_add_tag: 'Adicionar notetag',
    note_list_known_tags: 'Listar notetags conhecidos',
    note_list_all_tags: 'Listar todos os notetags',
    note_parse_tags: 'Analisar notetags',

    // System
    system_get: 'Ler configurações do sistema',
    system_update_title: 'Atualizar título do jogo',
    system_update_terms: 'Atualizar termos',
    system_update_currency: 'Atualizar moeda',
    system_update_party: 'Atualizar grupo inicial',
    system_update_starting_position: 'Atualizar posição inicial',
    system_update_window_tone: 'Atualizar cor da janela',

    // Switches & Variables
    switch_list: 'Listar switches',
    switch_rename: 'Renomear switch',
    switch_resize: 'Redimensionar lista de switches',
    switch_search_uses: 'Buscar uso do switch',
    variable_list: 'Listar variáveis',
    variable_rename: 'Renomear variável',
    variable_resize: 'Redimensionar lista de variáveis',
    variable_search_uses: 'Buscar uso da variável',

    // Assets
    asset_list: 'Listar assets',
    asset_import: 'Importar asset',
    asset_delete: 'Deletar asset',
    asset_validate_format: 'Validar formato de asset',
    asset_get_info: 'Informações do asset',
    asset_categories_list: 'Listar categorias de asset',
    audio_import_bgm: 'Importar BGM',
    audio_import_bgs: 'Importar BGS',
    audio_import_me: 'Importar ME',
    audio_import_se: 'Importar SE',
    audio_list: 'Listar áudios',

    // Saves
    save_read: 'Ler save',
    save_edit: 'Editar save',
    save_create_test_state: 'Criar save de teste',
    save_add_item: 'Adicionar item ao save',
    save_learn_skill: 'Aprender skill no save',
    save_set_gold: 'Definir gold no save',
    save_set_actor_level: 'Definir nível no save',
    save_set_actor_hp_mp: 'Definir HP/MP no save',
    save_set_player_position: 'Definir posição no save',
    save_set_party_members: 'Definir grupo no save',
    save_set_switch: 'Definir switch no save',
    save_set_variable: 'Definir variável no save',

    // Procgen
    procgen_dungeon: 'Gerar dungeon',
    procgen_cave: 'Gerar caverna',
    procgen_outdoor: 'Gerar área externa',

    // Project
    project_get_info: 'Informações do projeto',
    project_init: 'Iniciar novo projeto',
    project_backup_create: 'Criar backup',
    project_list_backups: 'Listar backups',
    project_restore_from_backup: 'Restaurar backup',
    project_undo_last_change: 'Desfazer última mudança',
    project_lock_check: 'Verificar lock do editor',

    // Companion
    companion_install: 'Instalar companion no jogo',

    // Generator & Samplemaps
    generator_list_parts: 'Listar partes do gerador',
    generator_preview: 'Preview do gerador',
    samplemaps_list: 'Listar mapas de exemplo',
    samplemaps_search_by_features: 'Buscar mapas de exemplo',
    samplemaps_clone_to_project: 'Clonar mapa de exemplo',

    // MZ install
    mz_install_detect_path: 'Detectar instalação do MZ',
    mz_install_get_corescript_path: 'Caminho do corescript',
    mz_install_get_help_url: 'URL da ajuda do MZ',
    mz_install_list_dlc_plugins: 'Listar plugins do DLC',

    // Build
    mz_build: 'Build do jogo',
    mz_build_check_rpgmpacker: 'Verificar rpgmpacker',
    mz_validate_project: 'Validar projeto',
    mz_clean_unused_assets: 'Limpar assets não usados',
    mz_extract_translatable_text: 'Extrair textos pra tradução',
    mz_import_translations: 'Importar traduções',
    mz_localization_coverage: 'Cobertura de localização',
  };

  /** Retorna o label PT-BR de uma tool, ou o nome técnico se não mapeado. */
  function ptbrLabel(toolName) {
    return TOOL_LABELS_PTBR[toolName] || toolName;
  }

  // === State ===
  const state = {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    pushEvents: 0,
    durationsSum: 0,
    durationsCount: 0,
    pendingCalls: new Map(),
    activity: [],
    pushEventLog: [],
    autoRefreshTimer: null,
    liveStateTimer: null,
    currentMapId: null,
    lastRenderedMapId: null,
  };

  // === Helpers ===
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function fmtArgs(args) {
    if (args === undefined || args === null) return '';
    try {
      const s = JSON.stringify(args);
      return s.length > 80 ? s.substring(0, 77) + '...' : s;
    } catch {
      return String(args);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function refreshActivity() {
    const filter = $('filterInput').value.toLowerCase();
    const hideStatus = $('hideRuntimeStatus').checked;
    const list = $('activity');
    list.innerHTML = '';
    let shown = 0;
    for (const item of state.activity) {
      const label = ptbrLabel(item.name);
      const matchFilter = !filter
        || item.name.toLowerCase().includes(filter)
        || label.toLowerCase().includes(filter);
      if (!matchFilter) continue;
      // Esconde rotinas internas do dashboard pra não poluir
      if (hideStatus && (item.name === 'runtime_status' || item.internal)) continue;
      const div = document.createElement('div');
      div.className = 'entry ' + (item.success ? 'success' : item.success === false ? 'error' : '');
      div.innerHTML = `
        <span class="time">${fmtTime(item.timestamp)}</span>
        <span class="name">
          <span class="ptbr">${escapeHtml(label)}</span>
          <span class="tech">${escapeHtml(item.name)}</span>
        </span>
        <span class="duration">${item.durationMs != null ? item.durationMs + 'ms' : '...'}</span>
        <span class="args">${escapeHtml(fmtArgs(item.args))}</span>
      `;
      list.appendChild(div);
      shown++;
      if (shown >= 100) break;
    }
    $('activityCount').textContent = `(${state.activity.length}${shown < state.activity.length ? ` · ${shown} mostradas` : ''})`;
  }

  function refreshPushEvents() {
    const list = $('pushEvents');
    list.innerHTML = '';
    if (state.pushEventLog.length === 0) {
      list.innerHTML = '<em class="muted">Nenhum evento push recebido ainda.<br><br>O companion dispara eventos quando:<br>• o jogador <b>muda de mapa</b> → <code>mapChanged</code><br>• <b>começa</b>/<b>termina</b> batalha → <code>battleStarted</code>/<code>battleEnded</code><br>• personagem <b>sobe de nível</b> → <code>levelUp</code><br>• <b>switch</b> alterado → <code>switchChanged</code><br>• <b>variável</b> alterada → <code>variableChanged</code><br>• party <b>ganha/perde gold</b> → <code>goldChanged</code><br>• party <b>ganha/perde item/arma/armadura</b> → <code>itemChanged</code><br>• <b>membro entra/sai</b> do party → <code>partyMemberAdded</code>/<code>partyMemberRemoved</code><br>• um <b>Common Event</b> é chamado → <code>commonEventStarted</code><br><br>Movimento puro no mapa <b>não</b> dispara evento (seria spam — 1 por passo).</em>';
      return;
    }
    let shown = 0;
    for (const item of state.pushEventLog) {
      const div = document.createElement('div');
      div.className = 'entry event-push';
      div.innerHTML = `
        <span class="time">${fmtTime(item.timestamp)}</span>
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="args">${escapeHtml(fmtArgs(item.data))}</span>
      `;
      list.appendChild(div);
      shown++;
      if (shown >= 50) break;
    }
  }

  function refreshMetrics() {
    $('totalCalls').textContent = state.totalCalls;
    $('successCalls').textContent = state.successCalls;
    $('errorCalls').textContent = state.errorCalls;
    $('pushEventsCount').textContent = state.pushEvents;
    const avg = state.durationsCount > 0 ? Math.round(state.durationsSum / state.durationsCount) : 0;
    $('avgDuration').textContent = `${avg}ms`;
  }

  // === Event handlers ===
  function handleEvent(event) {
    switch (event.type) {
      case 'tool_call_start': {
        const entry = { id: event.id, name: event.name, args: event.args, timestamp: event.timestamp, success: null, durationMs: null };
        state.pendingCalls.set(event.id, entry);
        state.activity.unshift(entry);
        if (state.activity.length > 500) state.activity.pop();
        state.totalCalls++;
        refreshMetrics();
        refreshActivity();
        break;
      }
      case 'tool_call_end': {
        const entry = state.pendingCalls.get(event.id);
        if (entry) {
          entry.success = event.success;
          entry.durationMs = event.durationMs;
          if (event.error) entry.error = event.error;
          state.pendingCalls.delete(event.id);
        }
        if (event.success) state.successCalls++; else state.errorCalls++;
        state.durationsSum += event.durationMs;
        state.durationsCount++;
        refreshMetrics();
        refreshActivity();
        break;
      }
      case 'companion_connected': {
        if (event.info?.gameTitle) {
          $('gameTitle').textContent = event.info.gameTitle;
          $('companionStatus').innerHTML = `companion: <span class="tag ok">✓ ${escapeHtml(event.info.gameTitle)}</span>`;
        }
        $('companionConnected').innerHTML = '<span class="tag ok">sim</span>';
        $('liveStateInfo').textContent = 'conectado';
        setLiveCardsActive(true);
        startLiveStateLoop();
        break;
      }
      case 'companion_disconnected': {
        $('companionStatus').innerHTML = 'companion: <span class="tag err">✗ desconectado</span>';
        $('companionConnected').innerHTML = '<span class="tag err">não</span>';
        $('liveStateInfo').textContent = 'desconectado';
        setLiveCardsActive(false);
        stopLiveStateLoop();
        clearLiveState();
        break;
      }
      case 'push_event': {
        state.pushEvents++;
        state.pushEventLog.unshift({ name: event.name, data: event.data, timestamp: event.timestamp });
        if (state.pushEventLog.length > 200) state.pushEventLog.pop();
        refreshMetrics();
        refreshPushEvents();
        // Se for mudança de mapa, atualiza preview automaticamente
        if (event.name === 'mapChanged' && $('mapAutoOnChange').checked) {
          const newMap = event.data?.mapId;
          if (newMap && newMap !== state.lastRenderedMapId) {
            state.currentMapId = newMap;
            refreshMapPreview();
          }
        }
        break;
      }
    }
  }

  // === API calls ===
  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      $('mcpPort').textContent = data.mcpPort;
      $('companionPort').textContent = data.companionPort;
      $('companionConnected').innerHTML = data.companion?.connected ? '<span class="tag ok">sim</span>' : '<span class="tag err">não</span>';
      $('gameTitle').textContent = data.companion?.companion?.gameTitle ?? '—';
      // Status REAL do editor MZ (aberto/fechado/desconhecido)
      const lockMap = {
        locked: '<span class="tag err">aberto</span>',
        unlocked: '<span class="tag ok">fechado</span>',
        unknown: '<span class="tag">desconhecido</span>',
      };
      $('editorLockStatus').innerHTML = lockMap[data.editorLockStatus] || lockMap.unknown;
      // Política configurada (warn/block/ignore)
      const polMap = {
        warn: '<span class="tag">avisar e continuar</span>',
        block: '<span class="tag err">bloquear escritas</span>',
        ignore: '<span class="tag info">ignorar (escrever sempre)</span>',
      };
      $('editorOnLock').innerHTML = polMap[data.editorOnLock] || `<span class="tag">${escapeHtml(data.editorOnLock)}</span>`;
      $('autoBackup').innerHTML = data.autoBackup ? '<span class="tag ok">ligado</span>' : '<span class="tag">desligado</span>';
      $('activeClients').textContent = data.activeClients;
      $('projectPath').textContent = data.projectPath ?? '—';
      if (data.companion?.connected) {
        const gt = data.companion.companion?.gameTitle ?? 'conectado';
        $('companionStatus').innerHTML = `companion: <span class="tag ok">✓ ${escapeHtml(gt)}</span>`;
        $('liveStateInfo').textContent = 'conectado';
        setLiveCardsActive(true);
        if (!state.liveStateTimer) startLiveStateLoop();
      } else {
        $('companionStatus').innerHTML = 'companion: <span class="tag err">✗ desconectado</span>';
        $('liveStateInfo').textContent = 'desconectado';
        setLiveCardsActive(false);
        stopLiveStateLoop();
      }
    } catch (err) {
      console.error('refreshStatus error:', err);
    }
  }

  async function refreshScreenshot() {
    const wrap = $('screenshotWrap');
    const info = $('screenshotInfo');
    info.textContent = 'capturando…';
    try {
      // Dispara captura LIVE via companion (não só lê cache)
      const res = await fetch('/api/screenshot/capture', { method: 'POST' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        wrap.innerHTML = `<em class="muted">Falha: ${escapeHtml(errJson.error || res.statusText)} ${errJson.detail ? '— ' + escapeHtml(errJson.detail) : ''}</em>`;
        info.textContent = '—';
        return;
      }
      const method = res.headers.get('X-Screenshot-Method') ?? 'unknown';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      wrap.innerHTML = `<img src="${url}" alt="screenshot" />`;
      info.textContent = `${fmtTime(Date.now())} · ${(blob.size / 1024).toFixed(1)} KB · método: ${method}`;
    } catch (err) {
      wrap.innerHTML = `<em class="muted">Erro: ${escapeHtml(err.message)}</em>`;
      info.textContent = '—';
    }
  }

  function toggleAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    } else {
      state.autoRefreshTimer = setInterval(refreshScreenshot, 5000);
      refreshScreenshot();
    }
  }

  // === Live state ===
  function startLiveStateLoop() {
    if (state.liveStateTimer) return;
    refreshLiveState();
    if ($('liveAutoRefresh').checked) {
      state.liveStateTimer = setInterval(() => {
        if ($('liveAutoRefresh').checked) refreshLiveState();
      }, 3000);
    }
  }

  function stopLiveStateLoop() {
    if (state.liveStateTimer) {
      clearInterval(state.liveStateTimer);
      state.liveStateTimer = null;
    }
  }

  function clearLiveState() {
    $('liveScene').textContent = '—';
    $('liveMap').textContent = '—';
    $('livePlayerPos').textContent = '—';
    $('liveLeader').textContent = '—';
    $('liveHpMp').textContent = '—';
    $('liveGold').textContent = '—';
    $('liveEvent').textContent = '—';
  }

  /**
   * Aplica/remove a classe "dim" nos cards priority pra indicar visualmente
   * se o estado ao vivo está disponível (verde) ou aguardando (cinza).
   */
  function setLiveCardsActive(active) {
    document.querySelectorAll('.card.priority').forEach((c) => {
      if (active) c.classList.remove('dim');
      else c.classList.add('dim');
    });
  }

  /** Helper pra renderizar uma barra HP/MP visual. */
  function renderBar(label, current, max, kind) {
    if (current == null || max == null || max <= 0) return '';
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    const lowClass = kind === 'hp' && pct < 25 ? ' low' : '';
    return `
      <div class="bar-row">
        <span class="bar-label">${label}</span>
        <span class="bar-track"><span class="bar-fill ${kind}${lowClass}" style="width:${pct}%"></span></span>
        <span class="bar-text">${current}/${max}</span>
      </div>`;
  }

  async function refreshLiveState() {
    try {
      const res = await fetch('/api/runtime/snapshot');
      const data = await res.json();
      if (!data.connected) {
        clearLiveState();
        return;
      }
      const scene = data.scene || {};
      $('liveScene').textContent = scene.active ?? '—';
      const mapStr = scene.mapId ? `${scene.mapId}${scene.displayName ? ' — ' + scene.displayName : ''}` : '—';
      $('liveMap').textContent = mapStr;
      if (scene.mapId) {
        const before = state.currentMapId;
        state.currentMapId = scene.mapId;
        // Atualiza preview se mudou e auto-render tá ligado
        if (before !== scene.mapId && $('mapAutoOnChange').checked) {
          refreshMapPreview();
        }
        $('currentMapInfo').textContent = mapStr;
      }
      $('livePlayerPos').textContent = scene.playerX != null ? `(${scene.playerX}, ${scene.playerY})` : '—';
      $('liveEvent').innerHTML = scene.eventRunning ? '<span class="tag info">sim</span>' : '<span class="tag">não</span>';
      const goldVal = (data.gold && data.gold.ok ? data.gold.value : null);
      $('liveGold').textContent = goldVal != null ? String(goldVal) : '—';
      // Líder
      const leader = data.leaderState;
      if (leader && typeof leader === 'object') {
        const lvl = leader.level != null ? ` <span class="tag">Lv ${leader.level}</span>` : '';
        $('liveLeader').innerHTML = `${escapeHtml(leader.name ?? '?')}${lvl}`;
        const hp = leader.hp;
        const mhp = leader.mhp;
        const mp = leader.mp;
        const mmp = leader.mmp;
        const bars = `<div class="bar-pair">${renderBar('HP', hp, mhp, 'hp')}${renderBar('MP', mp, mmp, 'mp')}</div>`;
        $('liveHpMp').innerHTML = (hp != null || mp != null) ? bars : '—';
      } else {
        $('liveLeader').textContent = data.leaderActorId ? `id=${data.leaderActorId}` : '—';
        $('liveHpMp').textContent = '—';
      }
    } catch (err) {
      console.warn('liveState error:', err);
    }
  }

  // === Map preview ===
  async function refreshMapPreview() {
    const wrap = $('mapPreviewWrap');
    const mapId = state.currentMapId;
    if (!mapId) {
      wrap.innerHTML = '<em class="muted">Sem mapa atual (companion não conectado ou jogador fora de Scene_Map).</em>';
      return;
    }
    wrap.innerHTML = '<em class="muted">Renderizando…</em>';
    try {
      const res = await fetch('/api/map_render/' + mapId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        wrap.innerHTML = `<em class="muted">Falha ao renderizar mapa ${mapId}: ${escapeHtml(err.detail || res.statusText)}</em>`;
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      wrap.innerHTML = `<img src="${url}" alt="mapa ${mapId}" /><div class="muted" style="margin-top:6px;font-size:11px">mapa ${mapId} · ${(blob.size / 1024).toFixed(1)} KB</div>`;
      state.lastRenderedMapId = mapId;
    } catch (err) {
      wrap.innerHTML = `<em class="muted">Erro: ${escapeHtml(err.message)}</em>`;
    }
  }

  // === Quick actions ===
  async function runBackup() {
    const out = $('actionsOutput');
    out.textContent = 'Criando snapshot…';
    try {
      const res = await fetch('/api/backup/create', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        out.textContent = `✓ Backup criado em ${data.path}\nTamanho: ${(data.sizeBytes / 1024).toFixed(1)} KB`;
      } else {
        out.textContent = `✗ Falhou: ${data.error || res.statusText}\n${data.detail || ''}`;
      }
    } catch (err) {
      out.textContent = `✗ Erro: ${err.message}`;
    }
  }

  async function runIntegrity() {
    const out = $('actionsOutput');
    out.textContent = 'Verificando integridade…';
    try {
      const res = await fetch('/api/integrity_check');
      const data = await res.json();
      if (res.ok) {
        const lines = [`Total de verificações: ${data.totalChecks}`, `Problemas encontrados: ${data.issues.length}`];
        if (data.issues.length > 0) {
          lines.push('', 'Problemas:');
          for (const issue of data.issues.slice(0, 20)) {
            lines.push(`  [${issue.severity}] ${issue.category}#${issue.recordId} (${issue.recordName}) campo "${issue.field}": ${issue.detail}`);
          }
          if (data.issues.length > 20) lines.push(`  … +${data.issues.length - 20} outros`);
        } else {
          lines.push('✓ Banco está limpo');
        }
        out.textContent = lines.join('\n');
      } else {
        out.textContent = `✗ Falhou: ${data.error || res.statusText}\n${data.detail || ''}`;
      }
    } catch (err) {
      out.textContent = `✗ Erro: ${err.message}`;
    }
  }

  // === WebSocket ===
  let ws = null;
  let wsReconnectTimer = null;
  function connectWs() {
    const url = `ws://${location.host}/ws`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      $('wsStatus').classList.add('connected');
      $('wsLabel').textContent = 'ao vivo';
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        handleEvent(event);
      } catch (err) {
        console.error('parse error:', err);
      }
    };
    ws.onclose = () => {
      $('wsStatus').classList.remove('connected');
      $('wsLabel').textContent = 'desconectado · tentando reconectar…';
      wsReconnectTimer = setTimeout(connectWs, 3000);
    };
    ws.onerror = () => {};
  }

  // === Init ===
  $('refreshStatus').addEventListener('click', refreshStatus);
  $('refreshScreenshot').addEventListener('click', refreshScreenshot);
  $('autoRefresh').addEventListener('change', toggleAutoRefresh);
  $('clearActivity').addEventListener('click', () => {
    state.activity = [];
    refreshActivity();
  });
  $('filterInput').addEventListener('input', refreshActivity);
  $('hideRuntimeStatus').addEventListener('change', refreshActivity);
  $('refreshLiveState').addEventListener('click', refreshLiveState);
  $('liveAutoRefresh').addEventListener('change', () => {
    stopLiveStateLoop();
    startLiveStateLoop();
  });
  $('refreshMapPreview').addEventListener('click', refreshMapPreview);
  $('actionBackup').addEventListener('click', runBackup);
  $('actionIntegrity').addEventListener('click', runIntegrity);

  refreshStatus();
  refreshPushEvents();
  setInterval(refreshStatus, 10000);
  connectWs();
})();
