/*:
 * @target MZ
 * @plugindesc RPG Maker MZ - MCP Companion — canal WebSocket para o servidor MCP controlar o jogo em runtime
 * @author Newton Alves
 * @help
 * Plugin companion do RPG Maker MZ - MCP. Quando o jogo inicia, este plugin
 * tenta conectar via WebSocket ao servidor MCP rodando localmente. Permite
 * que o agente de IA consulte ($gameSwitches, $gameVariables, party, etc.)
 * e atue (set switch, transfer player, etc.) ao vivo enquanto você joga.
 *
 * NÃO USE EM BUILDS PUBLICADAS. Apenas durante desenvolvimento/playtest.
 *
 * Config via parameters:
 *   - port: porta WS local (default 39872)
 *   - token: token de auth (deve bater com .mz-mcp/companion.token)
 *   - enableEvalJs: permite mz-mcp executar JS arbitrário via runtime_eval_js
 *
 * @param port
 * @text Porta WebSocket
 * @type number
 * @min 1024
 * @max 65535
 * @default 39872
 * @desc Porta local pra mz-mcp conectar.
 *
 * @param token
 * @text Token de autenticação
 * @type string
 * @default
 * @desc Token compartilhado com mz-mcp (deve bater com .mz-mcp/companion.token).
 *
 * @param enableEvalJs
 * @text Habilitar runtime_eval_js
 * @type boolean
 * @on Permitir
 * @off Bloquear
 * @default false
 * @desc Permite mz-mcp executar JS arbitrário no contexto do jogo. Use com cautela.
 *
 * @param verbose
 * @text Logs verbosos
 * @type boolean
 * @default false
 * @desc Mostra logs detalhados no console do dev tools.
 */

(() => {
  'use strict';

  const pluginName = 'MzMcpCompanion';
  const params = PluginManager.parameters(pluginName);
  const fallbackPort = Number(params.port || 39872);
  const token = String(params.token || '');
  const enableEvalJs = String(params.enableEvalJs) === 'true';
  const verbose = String(params.verbose) === 'true';

  /**
   * Lê a porta do arquivo .mz-mcp/companion.port se existir. Esse arquivo é
   * escrito pelo MCP server quando ele binda — permite múltiplas instâncias
   * do MCP em portas diferentes (39872, 39873, ...) coexistirem. Se o arquivo
   * não existir, usa o param padrão.
   */
  function readPortFromFile() {
    try {
      if (typeof require === 'function') {
        const fs = require('fs');
        const data = fs.readFileSync('.mz-mcp/companion.port', 'utf-8').trim();
        const p = parseInt(data, 10);
        if (Number.isFinite(p) && p > 0 && p < 65536) return p;
      }
    } catch {
      // arquivo não existe ou sem acesso fs — segue pro fallback
    }
    return null;
  }

  // Resolve porta na ORDEM: arquivo .port → param do plugin → default 39872
  const portFromFile = readPortFromFile();
  const port = portFromFile ?? fallbackPort;

  const PROTOCOL_VERSION = '1.0';
  let ws = null;
  let reconnectTimer = null;
  let connected = false;

  function log(...args) {
    if (verbose) console.log('[MzMcpCompanion]', ...args);
  }

  function connect() {
    if (ws) return;
    // Re-lê o port file a cada tentativa (a porta pode mudar se o MCP for reiniciado)
    const currentPort = readPortFromFile() ?? port;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${currentPort}`);
    } catch (err) {
      log('connect error:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      log(`connected to ws://127.0.0.1:${port}`);
      // Handshake
      send({
        jsonrpc: '2.0',
        method: 'hello',
        params: {
          token,
          protocolVersion: PROTOCOL_VERSION,
          companionVersion: '0.1.0',
          gameTitle: $dataSystem ? $dataSystem.gameTitle : 'unknown',
        },
      });
      connected = true;
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        log('invalid json', e);
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = () => {
      log('closed');
      ws = null;
      connected = false;
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      log('error', err);
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(obj));
  }

  function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }
  function replyError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  function handleMessage(msg) {
    if (msg.method === 'helloAck') {
      log('handshake ok');
      return;
    }
    if (typeof msg.id === 'undefined' || !msg.method) return;
    const handler = HANDLERS[msg.method];
    if (!handler) {
      replyError(msg.id, -32601, `Method not found: ${msg.method}`);
      return;
    }
    try {
      const result = handler(msg.params || {});
      reply(msg.id, result);
    } catch (err) {
      replyError(msg.id, -32000, String(err && err.message ? err.message : err));
    }
  }

  /* ============================ HANDLERS ============================ */

  const HANDLERS = {
    ping: () => ({ pong: true, t: Date.now() }),

    getState: (params) => {
      const scope = (params && params.scope) || 'all';
      const out = {};
      if (scope === 'all' || scope === 'player') {
        out.player = $gamePlayer ? {
          x: $gamePlayer.x, y: $gamePlayer.y, direction: $gamePlayer.direction(),
          mapId: $gameMap ? $gameMap.mapId() : null,
        } : null;
      }
      if (scope === 'all' || scope === 'party') {
        out.party = $gameParty ? {
          members: $gameParty.members().map(a => ({ id: a.actorId(), name: a.name(), hp: a.hp, mp: a.mp, level: a._level })),
          gold: $gameParty.gold(),
          steps: $gameParty.steps(),
        } : null;
      }
      if (scope === 'all' || scope === 'map') {
        out.map = $gameMap ? { id: $gameMap.mapId(), name: $dataMap?.displayName ?? '', tileset: $gameMap.tilesetId() } : null;
      }
      if (scope === 'all' || scope === 'switches') {
        out.switches = collectSwitches();
      }
      if (scope === 'all' || scope === 'variables') {
        out.variables = collectVariables();
      }
      if (scope === 'all' || scope === 'system') {
        out.system = $gameSystem ? { saveCount: $gameSystem.saveCount(), playtime: $gameSystem.playtime() } : null;
      }
      return out;
    },

    getActorState: (p) => {
      const a = $gameActors ? $gameActors.actor(p.actorId) : null;
      if (!a) throw new Error(`actor ${p.actorId} não existe`);
      return {
        id: a.actorId(), name: a.name(), nickname: a.nickname(),
        level: a._level, exp: a.currentExp(),
        hp: a.hp, mp: a.mp, tp: a.tp,
        mhp: a.mhp, mmp: a.mmp,
        params: { atk: a.atk, def: a.def, mat: a.mat, mdf: a.mdf, agi: a.agi, luk: a.luk },
        states: a.states().map(s => ({ id: s.id, name: s.name })),
        equips: a.equips().map(e => e ? { id: e.id, name: e.name } : null),
        skills: a.skills().map(s => ({ id: s.id, name: s.name })),
      };
    },

    getSwitch: (p) => ({ id: p.id, value: $gameSwitches ? $gameSwitches.value(p.id) : false }),
    setSwitch: (p) => {
      if ($gameSwitches) $gameSwitches.setValue(p.id, !!p.value);
      return { id: p.id, value: !!p.value };
    },

    getVariable: (p) => ({ id: p.id, value: $gameVariables ? $gameVariables.value(p.id) : 0 }),
    setVariable: (p) => {
      if ($gameVariables) $gameVariables.setValue(p.id, p.value);
      return { id: p.id, value: p.value };
    },

    setSelfSwitch: (p) => {
      if (!$gameSelfSwitches) throw new Error('$gameSelfSwitches indisponível');
      const key = [$gameMap.mapId(), p.eventId, p.slot];
      $gameSelfSwitches.setValue(key, !!p.value);
      return { eventId: p.eventId, slot: p.slot, value: !!p.value };
    },

    setActorHp: (p) => {
      const a = $gameActors && $gameActors.actor(p.actorId);
      if (!a) throw new Error(`actor ${p.actorId} não existe`);
      a.setHp(p.value);
      return { actorId: p.actorId, hp: a.hp };
    },
    setActorMp: (p) => {
      const a = $gameActors && $gameActors.actor(p.actorId);
      if (!a) throw new Error(`actor ${p.actorId} não existe`);
      a.setMp(p.value);
      return { actorId: p.actorId, mp: a.mp };
    },

    callCommonEvent: (p) => {
      if (!$gameTemp) throw new Error('$gameTemp indisponível');
      $gameTemp.reserveCommonEvent(p.id);
      return { reserved: true, commonEventId: p.id };
    },

    forceBattle: (p) => {
      if (!$gameTroop || !BattleManager) throw new Error('Battle subsystem indisponível');
      BattleManager.setup(p.troopId, true, p.canLose === true);
      SceneManager.push(Scene_Battle);
      return { troopId: p.troopId };
    },

    transferPlayer: (p) => {
      if (!$gamePlayer) throw new Error('$gamePlayer indisponível');
      $gamePlayer.reserveTransfer(p.mapId, p.x, p.y, p.direction || 0, p.fadeType || 0);
      return { mapId: p.mapId, x: p.x, y: p.y };
    },

    evalJs: (p) => {
      if (!enableEvalJs) throw new Error('runtime_eval_js está desabilitado neste companion');
      // eslint-disable-next-line no-new-func
      const fn = new Function('return (' + p.code + ');');
      const value = fn();
      return { value: serializeSafe(value) };
    },

    hotReload: (p) => {
      const scope = (p && p.scope) || 'data';
      if (scope === 'data') {
        DataManager.loadDatabase();
        return { reloaded: 'data' };
      } else if (scope === 'map') {
        if ($gamePlayer && $gameMap) {
          $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y, $gamePlayer.direction(), 0);
        }
        return { reloaded: 'map' };
      }
      return { reloaded: scope };
    },

    /* ========== Structured runtime queries (alternativas seguras a evalJs) ========== */

    getSceneState: () => {
      const scene = SceneManager._scene;
      if (!scene) return { active: null };
      const name = scene.constructor?.name ?? 'unknown';
      const out = { active: name };
      if (name === 'Scene_Map') {
        out.mapId = $gameMap?.mapId();
        out.displayName = $dataMap?.displayName ?? '';
        out.playerX = $gamePlayer?.x;
        out.playerY = $gamePlayer?.y;
        out.messageBusy = $gameMessage?.isBusy() ?? false;
        out.eventRunning = $gameMap?.isEventRunning() ?? false;
      } else if (name === 'Scene_Battle') {
        out.troopId = $gameTroop?._troopId;
        out.turnCount = $gameTroop?.turnCount() ?? 0;
        out.phase = BattleManager._phase;
        out.battlerActive = BattleManager._subject?.name?.() ?? null;
      } else if (name === 'Scene_Menu') {
        out.menuCommand = scene._commandWindow?.currentSymbol?.();
      } else if (name === 'Scene_Title') {
        out.titleCommand = scene._commandWindow?.currentSymbol?.();
      }
      return out;
    },

    getWindowState: () => {
      const scene = SceneManager._scene;
      if (!scene || !scene._windowLayer) return { windows: [] };
      const windows = [];
      const children = scene._windowLayer.children || [];
      for (const child of children) {
        if (!child || !child.constructor) continue;
        const name = child.constructor.name || 'unknown';
        if (!name.startsWith('Window_')) continue;
        const info = {
          type: name,
          visible: !!child.visible,
          active: !!child.active,
          x: child.x,
          y: child.y,
          width: child.width,
          height: child.height,
        };
        // Selectable windows têm índice e commands
        if (typeof child.index === 'function') info.index = child.index();
        if (typeof child.maxItems === 'function') info.maxItems = child.maxItems();
        if (typeof child.currentSymbol === 'function') {
          try { info.currentSymbol = child.currentSymbol(); } catch {}
        }
        windows.push(info);
      }
      return { windows, count: windows.length };
    },

    getBattleState: () => {
      if (!$gameParty || !$gameParty.inBattle()) {
        return { inBattle: false };
      }
      const out = {
        inBattle: true,
        phase: BattleManager._phase,
        turnCount: $gameTroop.turnCount(),
        troopId: $gameTroop._troopId,
        subject: BattleManager._subject ? {
          name: BattleManager._subject.name(),
          isActor: BattleManager._subject.isActor(),
          hp: BattleManager._subject.hp,
          mp: BattleManager._subject.mp,
        } : null,
        partyAlive: $gameParty.aliveMembers().map(a => ({ id: a.actorId(), name: a.name(), hp: a.hp, mp: a.mp })),
        troopAlive: $gameTroop.aliveMembers().map(e => ({ id: e.enemyId(), name: e.name(), hp: e.hp, index: e.index() })),
        actionLog: BattleManager._logWindow?._lines ?? [],
      };
      return out;
    },

    getMessageState: () => {
      if (!$gameMessage) return { showing: false };
      const showing = $gameMessage.isBusy() || $gameMessage.hasText();
      return {
        showing,
        text: $gameMessage._texts ?? [],
        faceName: $gameMessage._faceName,
        faceIndex: $gameMessage._faceIndex,
        background: $gameMessage._background,
        position: $gameMessage._positionType,
        choices: $gameMessage._choices,
        choiceCallback: typeof $gameMessage._choiceCallback === 'function' ? 'set' : null,
      };
    },

    inspectPath: (p) => {
      // Safe dot-walk: parse path like "$gameParty._gold" or "$gameActors._data[1]._level"
      // Não usa eval. Aceita apenas identifiers + [number].
      const path = String(p.path);
      const tokens = parseTokens(path);
      if (!tokens) return { ok: false, error: 'invalid path syntax' };
      try {
        let curr = globalThis;
        for (const t of tokens) {
          if (curr == null) return { ok: false, error: 'null/undefined at ' + t };
          if (typeof t === 'number') curr = curr[t];
          else curr = curr[t];
        }
        return { ok: true, value: serializeSafe(curr) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    screenshot: () => {
      // MZ usa PIXI.js renderer WebGL. canvas.toDataURL() retorna PNG vazio em
      // contextos WebGL sem preserveDrawingBuffer. Usamos PIXI extract API que
      // re-renderiza o stage atual num canvas off-screen — esse SIM tem o conteúdo.
      //
      // CUIDADO: extract.canvas(stage) usa stage.getBounds() pra dimensionar o
      // canvas alvo. Se algum plugin (ex.: sistema de batalha tática) adiciona
      // sprites com bounds muito grandes, o extract tenta alocar GBs e estoura.
      // Solução: chamar extract.canvas com a textura do renderer.screen, que tem
      // exatamente o tamanho visível (Graphics.width × Graphics.height).
      const errors = [];
      try {
        const app = Graphics._app;
        if (app && app.renderer && app.renderer.extract) {
          const w = Graphics.width;
          const h = Graphics.height;
          const PIXIRef = typeof PIXI !== 'undefined' ? PIXI : null;

          // MZ corescript v1.6.0 usa PIXI 5.3.x → signature posicional:
          //   renderer.render(displayObject, renderTexture, clear, transform, skipUpdateTransform)
          // PIXI 6+ usa signature de options { renderTexture, clear, ... }
          // Tentamos as duas pra robustez.
          if (PIXIRef && PIXIRef.RenderTexture && PIXIRef.RenderTexture.create) {
            const rt = PIXIRef.RenderTexture.create({ width: w, height: h });
            try {
              // PIXI 5: posicional
              try {
                app.renderer.render(app.stage, rt, true);
              } catch (err5) {
                errors.push('render-pixi5: ' + (err5 && err5.message ? err5.message : err5));
                // PIXI 6+: options
                app.renderer.render(app.stage, { renderTexture: rt, clear: true });
              }
              const extracted = app.renderer.extract.canvas(rt);
              const dataUrl = extracted.toDataURL('image/png');
              try { rt.destroy(true); } catch (e2) {}
              return { ok: true, dataUrl: dataUrl, method: 'pixi-rendertexture', width: w, height: h };
            } catch (innerErr) {
              try { rt.destroy(true); } catch (e2) {}
              errors.push('rendertexture: ' + (innerErr && innerErr.message ? innerErr.message : innerErr));
            }
          }

          // Fallback 1: extract com frame fixo (limita região mesmo se bounds grandes)
          if (PIXIRef && PIXIRef.Rectangle) {
            try {
              const frame = new PIXIRef.Rectangle(0, 0, w, h);
              const extracted = app.renderer.extract.canvas(app.stage, frame);
              return { ok: true, dataUrl: extracted.toDataURL('image/png'), method: 'pixi-extract-frame', width: w, height: h };
            } catch (errFrame) {
              errors.push('extract-frame: ' + (errFrame && errFrame.message ? errFrame.message : errFrame));
            }
          }

          // Fallback 2: extract direto do stage (pode estourar se bounds grandes)
          try {
            const extracted = app.renderer.extract.canvas(app.stage);
            return { ok: true, dataUrl: extracted.toDataURL('image/png'), method: 'pixi-extract' };
          } catch (errDirect) {
            errors.push('extract-direct: ' + (errDirect && errDirect.message ? errDirect.message : errDirect));
          }
        }

        // Fallback 3: Canvas2D direto
        const canvas = Graphics._canvas || (Graphics._renderer && Graphics._renderer.domElement);
        if (!canvas) return { ok: false, error: 'canvas indisponível', attempted: errors };
        return { ok: true, dataUrl: canvas.toDataURL('image/png'), method: 'canvas-toDataURL' };
      } catch (err) {
        errors.push('outer: ' + (err && err.message ? err.message : err));
        return { ok: false, error: errors.join(' | ') };
      }
    },
  };

  function collectSwitches() {
    if (!$gameSwitches || !$dataSystem || !$dataSystem.switches) return {};
    const out = {};
    const len = $dataSystem.switches.length;
    for (let i = 1; i < len; i++) {
      const v = $gameSwitches.value(i);
      if (v) out[i] = { name: $dataSystem.switches[i] || '', value: true };
    }
    return out;
  }
  function collectVariables() {
    if (!$gameVariables || !$dataSystem || !$dataSystem.variables) return {};
    const out = {};
    const len = $dataSystem.variables.length;
    for (let i = 1; i < len; i++) {
      const v = $gameVariables.value(i);
      if (v !== 0 && v !== '' && v !== null) out[i] = { name: $dataSystem.variables[i] || '', value: v };
    }
    return out;
  }

  /**
   * Tokeniza path tipo "$gameParty._gold" ou "actors[1].name" em array de strings/numbers.
   * Retorna null se path tem char não permitido (proteção: sem eval, sem chamadas de função).
   */
  function parseTokens(path) {
    const tokens = [];
    let i = 0;
    let current = '';
    while (i < path.length) {
      const c = path[i];
      if (c === '.') {
        if (current) { tokens.push(current); current = ''; }
        i++;
      } else if (c === '[') {
        if (current) { tokens.push(current); current = ''; }
        i++;
        let num = '';
        while (i < path.length && path[i] !== ']') {
          if (!/[0-9]/.test(path[i])) return null;
          num += path[i];
          i++;
        }
        if (path[i] !== ']') return null;
        tokens.push(parseInt(num, 10));
        i++;
      } else if (/[A-Za-z0-9_$]/.test(c)) {
        current += c;
        i++;
      } else {
        return null; // caractere proibido
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function serializeSafe(v, depth = 0) {
    if (depth > 5) return '[max depth]';
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'function') return '[fn]';
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => serializeSafe(x, depth + 1));
    if (t === 'object') {
      const out = {};
      let n = 0;
      for (const k of Object.keys(v)) {
        if (n++ > 50) { out['...'] = 'truncated'; break; }
        try { out[k] = serializeSafe(v[k], depth + 1); } catch { out[k] = '[err]'; }
      }
      return out;
    }
    return String(v);
  }

  /* ============================ PUSH EVENTS ============================ */
  /* Envia eventos não-solicitados pro MCP. Lista de hooks abaixo. */

  function pushEvent(eventName, data) {
    if (!connected) return;
    send({ jsonrpc: '2.0', method: 'event', params: { name: eventName, data, t: Date.now() } });
  }

  /* Hook: transfer / mapa mudou */
  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function() {
    _Scene_Map_onMapLoaded.call(this);
    if ($gameMap && $dataMap) {
      pushEvent('mapChanged', {
        mapId: $gameMap.mapId(),
        displayName: $dataMap.displayName || '',
        playerX: $gamePlayer ? $gamePlayer.x : 0,
        playerY: $gamePlayer ? $gamePlayer.y : 0,
      });
    }
  };

  /* Hook: batalha iniciou */
  const _BattleManager_startBattle = BattleManager.startBattle;
  BattleManager.startBattle = function() {
    _BattleManager_startBattle.call(this);
    pushEvent('battleStarted', {
      troopId: $gameTroop ? $gameTroop._troopId : null,
      enemies: $gameTroop ? $gameTroop.aliveMembers().map(e => ({ id: e.enemyId(), name: e.name(), hp: e.hp })) : [],
    });
  };

  /* Hook: batalha acabou */
  const _BattleManager_endBattle = BattleManager.endBattle;
  BattleManager.endBattle = function(result) {
    _BattleManager_endBattle.call(this, result);
    pushEvent('battleEnded', { result });
  };

  /* Hook: level up — checa via Game_Actor.changeExp */
  const _Game_Actor_levelUp = Game_Actor.prototype.levelUp;
  Game_Actor.prototype.levelUp = function() {
    _Game_Actor_levelUp.call(this);
    pushEvent('levelUp', { actorId: this.actorId(), name: this.name(), newLevel: this._level });
  };

  /* Hook: switch mudou (significativo) — apenas se valor mudou de fato */
  const _Game_Switches_setValue = Game_Switches.prototype.setValue;
  Game_Switches.prototype.setValue = function(switchId, value) {
    const old = this.value(switchId);
    _Game_Switches_setValue.call(this, switchId, value);
    if (old !== value) {
      pushEvent('switchChanged', { id: switchId, value, name: ($dataSystem.switches[switchId] || '') });
    }
  };

  /* Hook: party gold mudou (eventos de loot/shop) */
  const _Game_Party_gainGold = Game_Party.prototype.gainGold;
  Game_Party.prototype.gainGold = function(amount) {
    _Game_Party_gainGold.call(this, amount);
    pushEvent('goldChanged', { delta: amount, total: this.gold() });
  };

  /* Hook: variable mudou (só dispara se o valor mudou de fato) */
  const _Game_Variables_setValue = Game_Variables.prototype.setValue;
  Game_Variables.prototype.setValue = function(variableId, value) {
    const old = this.value(variableId);
    _Game_Variables_setValue.call(this, variableId, value);
    if (old !== value) {
      pushEvent('variableChanged', {
        id: variableId,
        name: ($dataSystem && $dataSystem.variables && $dataSystem.variables[variableId]) || '',
        oldValue: old,
        newValue: value,
      });
    }
  };

  /* Hook: party ganhou ou perdeu item (loot, shop, evento). amount > 0 = ganho, < 0 = perda. */
  const _Game_Party_gainItem = Game_Party.prototype.gainItem;
  Game_Party.prototype.gainItem = function(item, amount, includeEquip) {
    _Game_Party_gainItem.call(this, item, amount, includeEquip);
    if (item && amount !== 0) {
      // Discrimina tipo: item, weapon, armor
      let kind = 'item';
      if (DataManager.isWeapon && DataManager.isWeapon(item)) kind = 'weapon';
      else if (DataManager.isArmor && DataManager.isArmor(item)) kind = 'armor';
      pushEvent('itemChanged', {
        kind,
        id: item.id,
        name: item.name,
        delta: amount,
        newCount: this.numItems(item),
      });
    }
  };

  /* Hook: personagem adicionado ao party */
  const _Game_Party_addActor = Game_Party.prototype.addActor;
  Game_Party.prototype.addActor = function(actorId) {
    const wasInParty = this._actors && this._actors.indexOf(actorId) >= 0;
    _Game_Party_addActor.call(this, actorId);
    if (!wasInParty && $gameActors) {
      const a = $gameActors.actor(actorId);
      pushEvent('partyMemberAdded', {
        actorId,
        name: a ? a.name() : '',
        level: a ? a._level : null,
        partySize: this.size(),
      });
    }
  };

  /* Hook: personagem removido do party */
  const _Game_Party_removeActor = Game_Party.prototype.removeActor;
  Game_Party.prototype.removeActor = function(actorId) {
    const wasInParty = this._actors && this._actors.indexOf(actorId) >= 0;
    _Game_Party_removeActor.call(this, actorId);
    if (wasInParty && $gameActors) {
      const a = $gameActors.actor(actorId);
      pushEvent('partyMemberRemoved', {
        actorId,
        name: a ? a.name() : '',
        partySize: this.size(),
      });
    }
  };

  /* Hook: common event reservado pra rodar (autorun/parallel ou chamado de evento) */
  const _Game_Temp_reserveCommonEvent = Game_Temp.prototype.reserveCommonEvent;
  Game_Temp.prototype.reserveCommonEvent = function(commonEventId) {
    _Game_Temp_reserveCommonEvent.call(this, commonEventId);
    if ($dataCommonEvents && $dataCommonEvents[commonEventId]) {
      pushEvent('commonEventStarted', {
        id: commonEventId,
        name: $dataCommonEvents[commonEventId].name || '',
      });
    }
  };

  /* ============================ Boot ============================ */
  /* Conecta depois que $dataSystem está carregado */
  const _DataManager_onLoad = DataManager.onLoad;
  let booted = false;
  DataManager.onLoad = function(object) {
    _DataManager_onLoad.call(this, object);
    if (!booted && DataManager.isDatabaseLoaded()) {
      booted = true;
      setTimeout(connect, 100);
    }
  };
})();
