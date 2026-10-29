'use strict';

/* ============================================================
   主控：阶段机 · 探索 · 战斗 · 商店 · 淘汰赛
   ============================================================ */

const $ = id => document.getElementById(id);
const mapCanvas = $('mapCanvas');
const mctx = mapCanvas.getContext('2d');
const mapFxCanvas = $('mapFxCanvas');
const fxctx = mapFxCanvas.getContext('2d');

const RENDER_TOP = 1;
const RENDER_SIDE = 2;
const RENDER_ACTIONBAR = 4;
const RENDER_MAP = 8;
const RENDER_ALL = RENDER_TOP | RENDER_SIDE | RENDER_ACTIONBAR | RENDER_MAP;
let queuedRenderFlags = 0;
let renderFrameId = 0;
let mapFxTimer = null;

const G = {
  phase: 'title',
  round: 1,
  maps: [],
  avail: [],
  players: [],
  me: null,
  selHero: null,
  selGear: ['supply', 'map'],
  logs: [],
  tour: null,
  champion: null,
  highlight: [],
  aiTimer: null,
  battle: null,
  shop: null,
  shopOpts: null,
  shopLeft: 0,
  shopTimer: null,
  equipPick: null,
  pendingFoe: null,
  turn: null,
  plan: null,
  encounterDone: null,
  turnLabel: '',
  decision: null,
  form: null
};

/* 规划制规则：每个规划周期最多规划 3 步，限时 10 秒，然后全体同时移动 */
const TURN_STEPS = 3;
const TURN_SECONDS = 10;
const MOVE_STEP_MS = 320;

/* 战斗前：5 秒决定战斗/逃跑，10 秒布置阵型 */
const DECIDE_SECONDS = 5;
const FORMATION_SECONDS = 10;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function log(text, cls) {
  G.logs.push({ t: text, cls: cls || '' });
  if (G.logs.length > 80) G.logs.shift();
  renderSide();
}

/** 以绝对截止时间计算倒计时，避免后台标签页降频造成计时变慢。 */
function startDeadlineInterval(seconds, intervalMs, onTick) {
  const deadline = performance.now() + seconds * 1000;
  let timer = null;
  timer = setInterval(() => {
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    onTick(left);
    if (left <= 0) clearInterval(timer);
  }, intervalMs);
  return timer;
}

function showOverlay(html) {
  $('overlayInner').innerHTML = html;
  $('overlay').classList.remove('hidden');
}

function hideOverlay() {
  $('overlay').classList.add('hidden');
}

function alivePlayers() {
  return G.players.filter(p => p.alive);
}

/* ---------------- 开局 ---------------- */

function rollMaps() {
  // 本局三张图地形互不相同，每张图按各自地形生成结构
  const list = shuffle(ENVS).slice(0, 3);
  G.maps = list.map(e => generateMap(e));
  G.avail = [0, 1, 2];
}

function startGame() {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
  clearTurnTimer();
  clearBattlePrep();
  G.turn = null;
  G.plan = { ids: [], dragging: false };
  G.encounterDone = null;
  G.logs = [];
  G.round = 1;
  G.phase = 'title';
  G.champion = null;
  G.tour = null;
  G.players = [];
  G.me = null;
  G.selHero = null;
  G.selGear = ['supply', 'map'];
  G.highlight = [];
  G.battle = null;
  G.shop = null;
  G.shopOpts = null;
  G.shopLeft = 0;
  G.pendingFoe = null;
  hideOverlay();
  rollMaps();
  showHeroPick();
}

function showHeroPick() {
  G.phase = 'heroPick';
  const envs = G.maps.map(m =>
    `<span class="badge" style="color:${ENV_COLOR[m.env]}">${m.env}</span>`).join(' ');
  const cards = HEROES.map(h => `
    <div class="pick-card" data-hero="${h.id}" onclick="pickHero('${h.id}')">
      <div class="t">${h.name}</div>
      <div class="tag">${h.cls} · ${h.tag}</div>
      <div class="stat">HP ${h.hp} · ATK ${h.atk} · DEF ${h.def} · 射程 ${h.range} · 速度 ${h.speed}</div>
      <div class="d">${esc(h.skill)}：${esc(h.desc)}</div>
    </div>`).join('');
  const gear = META_GEAR.map(m => `
    <div class="pick-card${G.selGear.includes(m.id) ? ' sel' : ''}" data-gear="${m.id}" onclick="toggleGear('${m.id}')">
      <div class="t">${m.name}</div>
      <div class="d">${esc(m.desc)}</div>
    </div>`).join('');

  showOverlay(`
    <h2>选择角色</h2>
    <div class="sub">本局地图环境：${envs}　·　角色选定后本局不可更换</div>
    <div class="card-grid">${cards}</div>
    <h2 class="mt">局外装备（选 2）</h2>
    <div class="sub">2 个槽位，物资箱同样占槽——想发育快就得放弃一项信息优势</div>
    <div class="card-grid">${gear}</div>
    <div class="mt center">
      <button class="btn ok" id="btnStartRun" onclick="confirmHeroPick()">进入本局</button>
    </div>
  `);
  render();
}

function pickHero(id) {
  G.selHero = id;
  document.querySelectorAll('[data-hero]').forEach(el => {
    el.classList.toggle('sel', el.dataset.hero === id);
  });
}

function toggleGear(id) {
  const i = G.selGear.indexOf(id);
  if (i >= 0) G.selGear.splice(i, 1);
  else {
    if (G.selGear.length >= 2) G.selGear.shift();
    G.selGear.push(id);
  }
  document.querySelectorAll('[data-gear]').forEach(el => {
    el.classList.toggle('sel', G.selGear.includes(el.dataset.gear));
  });
}

function confirmHeroPick() {
  if (!G.selHero) { alert('请先选择一个角色'); return; }
  if (G.selGear.length !== 2) { alert('请选择 2 件局外装备'); return; }

  const pool = shuffle(HEROES.filter(h => h.id !== G.selHero).map(h => h.id));
  G.me = makePlayer('p0', true, G.selHero);
  G.me.metaGear = G.selGear.slice();
  G.players = [G.me];

  for (let i = 0; i < 3; i++) {
    const ai = makePlayer('p' + (i + 1), false, pool[i]);
    ai.metaGear = ['supply', 'map'];
    G.players.push(ai);
  }
  G.players.forEach(preparePlayerGear);
  G.phase = 'mapPick';
  showMapPick();
}

/** 局外装备落到实处 */
function preparePlayerGear(p) {
  p.apMax = 10 + (p.metaGear.includes('supply') ? 2 : 0);
  p.ap = 0;
}

/* ---------------- 选图 ---------------- */

function showMapPick() {
  G.phase = 'mapPick';
  const cards = G.avail.map(idx => {
    const m = G.maps[idx];
    const cnt = {};
    m.nodes.forEach(n => { cnt[n.kind] = (cnt[n.kind] || 0) + 1; });
    return `
      <div class="pick-card" data-map="${idx}" onclick="pickMap(${idx})">
        <div class="t" style="color:${ENV_COLOR[m.env]}">${m.env}</div>
        <div class="tag">第 ${G.round} 轮 · ${m.nodes.length} 个节点</div>
        <div class="stat">物资点 ${(cnt.normalRes || 0)} + 高级 ${(cnt.highRes || 0)} · 怪物 ${(cnt.monster || 0)} · 宝藏 ${(cnt.treasure || 0)}</div>
        <div class="d">${ENV_TRAIT[m.env]} · 核心区永不揭示，高级物资只在中核。第 ${G.round} 轮选择后本轮不可换图。</div>
      </div>`;
  }).join('');

  showOverlay(`
    <h2>第 ${G.round} 轮 · 选择地图</h2>
    <div class="sub">4 人同场，只有同一张地图上的角色才会相遇。第一轮 3 张图必有 2 人同图。</div>
    <div class="card-grid">${cards}</div>
    <div class="mt center"><button class="btn ok" id="btnPickMap" disabled>请选择一张地图</button></div>
  `);
  render();
}

function pickMap(idx) {
  document.querySelectorAll('[data-map]').forEach(el => {
    el.classList.toggle('sel', Number(el.dataset.map) === idx);
  });
  const btn = $('btnPickMap');
  btn.disabled = false;
  btn.textContent = '进入 ' + G.maps[idx].env;
  btn.onclick = () => assignMaps(idx);
}

function assignMaps(myIdx) {
  const others = shuffle(G.avail.filter(i => i !== myIdx));
  const ai = G.players.slice(1);
  ai.forEach((p, i) => {
    p.mapId = i < others.length ? others[i] : myIdx;
  });
  G.me.mapId = myIdx;
  startRound();
}

/* ---------------- 轮次 ---------------- */

function cloakActive(p) {
  return p.metaGear.includes('cloak') && G.round <= 2 && !p.foughtThisGame;
}

function updateHighlight() {
  G.highlight = [];
  if (!G.me || !G.me.alive || G.me.mapId == null) return;
  if (!G.me.metaGear.includes('map')) return;
  G.highlight = findBestLoot(G.maps[G.me.mapId]).nodes.map(n => n.id);
}

/** 每轮按该图存活人数开放出口：4 人 2 个，≤3 人 1 个 */
function applyMapRound(map, playerCount) {
  const openCount = playerCount >= 4 ? 2 : 1;
  map.exitIds = map.exitCandidates.slice(0, openCount);
  for (const id of map.exitCandidates) {
    const node = map.byId[id];
    if (!node) continue;
    if (map.exitIds.includes(id)) {
      setNodeType(node, 'exit');
      node.stock = [];
      node.looted = false;
    } else if (node.type === 'exit') {
      setNodeType(node, 'normal');
      node.stock = generateNodeStock(node, map.env);
      node.looted = false;
    }
  }
}

function startRound() {
  clearTurnTimer();
  clearBattlePrep();
  G.turn = null;
  for (const m of G.maps) refreshMapStock(m);

  // 按地图分组：出口数量随该图本轮存活人数变化
  const groups = {};
  for (const p of G.players) {
    if (!p.alive) { p.mapNodeId = null; continue; }
    if (p.mapId == null) p.mapId = G.me.mapId;
    if (!groups[p.mapId]) groups[p.mapId] = [];
    groups[p.mapId].push(p);
  }
  for (const key of Object.keys(groups)) {
    applyMapRound(G.maps[key], groups[key].length);
  }

  // 出生点：同一地图内互不重复，并尽量分散
  for (const key of Object.keys(groups)) {
    const map = G.maps[key];
    const spawns = shuffle(map.startIds).slice(0, groups[key].length);
    groups[key].forEach((p, i) => {
      p.mapNodeId = spawns[i];
      p.prevNodeId = spawns[i];
      p.ap = p.apMax;
      p.escapedThisRound = false;
      revealAround(map, spawns[i]);
    });
  }
  updateHighlight();
  G.phase = 'explore';
  hideOverlay();
  log(`—— 第 ${G.round} 轮开始 ——`, 'hl');
  log(`你进入 ${G.maps[G.me.mapId].env}，行动点 ${G.me.ap}/${G.me.apMax}`);
  log(`规划制：所有玩家限时 ${TURN_SECONDS} 秒各规划 1-${TURN_STEPS} 步，随后同时移动`, '');

  // 其他地图你看不到，直接推演到本轮结束
  fastForwardOtherMaps();
  // 你所在地图进入规划制
  initMapTurns();
  render();
  beginPlanPhase();
}

/* ---------------- 规划 / 同步移动 ---------------- */

function initMapTurns() {
  const map = G.maps[G.me.mapId];
  if (map) map.turns = { cycle: 0 };
}

/** 其他地图的 AI 一次性推演完，避免拖慢玩家所在地图 */
function fastForwardOtherMaps() {
  const ids = [...new Set(G.players
    .filter(p => p.alive && p.mapId != null && p.mapNodeId != null)
    .map(p => p.mapId))];
  for (const mapId of ids) {
    if (mapId === G.me.mapId) continue;
    let guard = 0;
    while (guard++ < 20) {
      const pending = G.players.filter(p =>
        p.alive && !p.isHuman && p.mapId === mapId && p.mapNodeId != null);
      if (!pending.length) break;
      for (const p of pending) {
        if (p.alive && p.mapNodeId != null) aiTurn(p);
      }
    }
  }
}

/** 玩家已离场/出局后，把同一张图剩下的 AI 推演完 */
function fastForwardHumanMap() {
  if (!G.me || G.me.mapId == null) return;
  const mapId = G.me.mapId;
  for (const p of G.players) {
    if (p.alive && !p.isHuman && p.mapId === mapId && p.mapNodeId != null) {
      aiTurn(p);
    }
  }
}

function clearTurnTimer() {
  if (G.turn && G.turn.timer) {
    clearInterval(G.turn.timer);
    G.turn.timer = null;
  }
}

function mapPlayersOnField(mapId) {
  return G.players.filter(p => p.alive && p.mapId === mapId && p.mapNodeId != null);
}

/** 人类已离场：结束当前规划周期，把剩下的 AI 推演完后检查本轮是否结束 */
function onHumanMapDone() {
  G.turn = null;
  G.plan = { ids: [], dragging: false };
  fastForwardHumanMap();
  render();
  checkRoundEnd();
}

/** 进入规划阶段：同图所有存活玩家一起规划 1-3 步 */
function beginPlanPhase() {
  if (G.phase !== 'explore') return;
  clearTurnTimer();
  G.plan = { ids: [], dragging: false };
  if (!G.me || G.me.mapId == null) return;
  if (!G.me.alive || G.me.mapNodeId == null) { onHumanMapDone(); return; }

  const map = G.maps[G.me.mapId];
  if (!map) { G.turn = null; checkRoundEnd(); return; }
  if (!map.turns) map.turns = { cycle: 0 };

  const list = mapPlayersOnField(G.me.mapId);
  if (!list.length) { G.turn = null; render(); checkRoundEnd(); return; }

  map.turns.cycle = (map.turns.cycle || 0) + 1;
  const plans = {};
  for (const p of list) {
    if (p.isHuman) continue;
    const path = planAIPath(p);
    if (path.length) plans[p.id] = path;
  }

  G.turn = {
    mapId: G.me.mapId,
    cycle: map.turns.cycle,
    phase: 'plan',
    busy: false,
    left: TURN_SECONDS,
    timer: null,
    plans,
    step: 0,
    maxLen: 0,
    order: list.map(p => p.id)
  };
  G.turn.timer = startDeadlineInterval(TURN_SECONDS, 100, tickPlanTimer);
  log(`规划阶段：${TURN_STEPS} 步内，限时 ${TURN_SECONDS} 秒；全体随后同时移动`, 'hl');
  render();
}

/** AI 预规划路径（对玩家不可见） */
function planAIPath(p) {
  const map = G.maps[p.mapId];
  if (!map) return [];
  const path = [];
  let cur = map.byId[p.mapNodeId];
  const steps = Math.min(TURN_STEPS, Math.max(0, p.ap));
  for (let i = 0; i < steps; i++) {
    if (!cur) break;
    const nbs = cur.neighbors.map(id => map.byId[id]).filter(Boolean);
    if (!nbs.length) break;
    const leftAp = p.ap - i;
    const wantExit = leftAp <= 2 || (p.soldiers.length === 0 && leftAp <= 6);
    let target = wantExit ? nbs.find(n => n.type === 'exit') : null;
    if (!target) {
      let best = -Infinity;
      for (const n of nbs) {
        const s = aiNodeScore(p, n);
        if (s > best) { best = s; target = n; }
      }
    }
    if (!target) break;
    path.push(target.id);
    cur = target;
  }
  return path;
}

function tickPlanTimer(left) {
  const T = G.turn;
  if (!T) { clearTurnTimer(); return; }
  if (G.phase !== 'explore' || T.phase !== 'plan') return;
  T.left = Math.max(0, left);
  updatePlanTimerDom();
  if (T.left <= 0) {
    log('规划时间到，按当前路径出发', 'hl');
    confirmPlan();
  }
}

function updatePlanTimerDom() {
  const T = G.turn;
  if (!T) return;
  const n = (G.plan && G.plan.ids.length) || 0;
  const cap = G.me ? Math.min(TURN_STEPS, G.me.ap) : TURN_STEPS;
  const t = $('turnTimer');
  const bar = $('turnBar');
  const steps = $('turnSteps');
  if (t) t.textContent = T.left.toFixed(1) + 's';
  if (bar) bar.style.width = clamp(T.left / TURN_SECONDS * 100, 0, 100) + '%';
  if (steps) steps.textContent = `${n}/${cap}`;
}

/** 确认路径：超时也走这里；未规划则原地不动 */
function confirmPlan() {
  const T = G.turn;
  if (!T || T.phase !== 'plan' || G.phase !== 'explore') return;
  if (!G.me || !G.me.alive || G.me.mapNodeId == null) return;
  const cap = Math.min(TURN_STEPS, G.me.ap);
  const ids = ((G.plan && G.plan.ids) || []).slice(0, cap);
  if (ids.length) T.plans[G.me.id] = ids;
  else delete T.plans[G.me.id];
  G.plan = { ids: [], dragging: false };
  clearTurnTimer();
  startMovePhase();
}

function clearPlan() {
  G.plan = { ids: [], dragging: false };
  if (G.turn && G.turn.phase === 'plan') updatePlanTimerDom();
  render();
}

function startMovePhase() {
  const T = G.turn;
  if (!T) return;
  clearTurnTimer();
  T.phase = 'move';
  T.busy = false;
  T.step = 0;
  let maxLen = 0;
  for (const id in T.plans) maxLen = Math.max(maxLen, T.plans[id].length);
  T.maxLen = Math.min(TURN_STEPS, maxLen);
  render();
  if (!T.maxLen) { finishMovePhase(); return; }
  setTimeout(runMoveStep, MOVE_STEP_MS);
}

/** 同步移动一步：先全体移动，再统一结算碰撞与到达事件 */
function runMoveStep() {
  const T = G.turn;
  if (!T || T.phase !== 'move' || T.busy) return;
  if (G.phase !== 'explore' && G.phase !== 'battle' && G.phase !== 'encounter') return;
  T.busy = true;

  const map = G.maps[T.mapId];
  const moved = [];
  for (const id of T.order) {
    const p = G.players.find(q => q.id === id);
    if (!p || !p.alive || p.mapNodeId == null || p.mapId !== T.mapId) continue;
    const plan = T.plans[p.id];
    const targetId = plan && plan[T.step];
    if (targetId == null) continue;
    const cur = map.byId[p.mapNodeId];
    if (!cur || !cur.neighbors.includes(targetId)) {
      delete T.plans[p.id];
      if (p.isHuman) log('路径中断，剩余步数取消', '');
      continue;
    }
    p.prevNodeId = p.mapNodeId;
    p.mapNodeId = targetId;
    p.ap = Math.max(0, p.ap - 1);
    revealAround(map, targetId);
    moved.push(p);
  }
  render();

  processStepEvents(buildStepEvents(T, moved), () => {
    if (G.turn !== T) return;
    // 本步事件都结算完，再处理行动点耗尽
    for (const id of T.order) {
      const p = G.players.find(q => q.id === id);
      if (!p || !p.alive || p.mapNodeId == null) continue;
      if (p.ap > 0) continue;
      delete T.plans[p.id];
      forceSettle(p);
      if (p.isHuman) log('行动点耗尽，就地强制结算', 'hl');
    }
    T.step++;
    T.busy = false;
    if (G.phase !== 'explore') return;
    if (!G.me || !G.me.alive || G.me.mapNodeId == null) { onHumanMapDone(); return; }
    if (T.step < T.maxLen) setTimeout(runMoveStep, MOVE_STEP_MS);
    else finishMovePhase();
  });
}

/** 收集本步事件：先同节点相遇，再各自的到达结算 */
function buildStepEvents(T, moved) {
  const map = G.maps[T.mapId];
  const queue = [];
  const byNode = {};
  for (const p of mapPlayersOnField(T.mapId)) {
    (byNode[p.mapNodeId] = byNode[p.mapNodeId] || []).push(p);
  }
  for (const nodeId in byNode) {
    if (byNode[nodeId].length >= 2) queue.push({ type: 'pvp', nodeId });
  }
  for (const p of moved) {
    if (!p.alive || p.mapNodeId == null) continue;
    const node = map.byId[p.mapNodeId];
    if (node && node.type !== 'start') queue.push({ type: 'arrive', p, nodeId: node.id });
  }
  return queue;
}

function processStepEvents(queue, done) {
  const T = G.turn;
  if (!T) { done(); return; }
  const step = () => {
    if (G.turn !== T) return;
    if (!queue.length) { done(); return; }
    const ev = queue.shift();
    if (ev.type === 'pvp') runPvpEvent(ev, step, () => queue.unshift(ev));
    else runArriveEvent(ev, step);
  };
  step();
}

/** 同节点相遇：人类走决策/布阵，AI 即时结算；同节点仍有 2 人时继续配对 */
function runPvpEvent(ev, next, retry) {
  const T = G.turn;
  const map = G.maps[T.mapId];
  if (!map) { next(); return; }
  const group = mapPlayersOnField(T.mapId).filter(p => p.mapNodeId === ev.nodeId);
  if (group.length < 2) { next(); return; }
  const ordered = T.order.map(id => group.find(p => p.id === id)).filter(Boolean);
  const a = ordered[0], b = ordered[1];
  const human = a.isHuman ? a : (b.isHuman ? b : null);

  const after = () => {
    if (G.turn !== T) return;
    const still = mapPlayersOnField(T.mapId).filter(p => p.mapNodeId === ev.nodeId);
    if (still.length >= 2) retry();
    else next();
  };

  const tryFlee = p => {
    const foe = p === a ? b : a;
    if (strengthOf(p) >= strengthOf(foe) * 0.6 || Math.random() >= 0.5) return false;
    const lost = dropHalfMaterials(p);
    p.mapNodeId = p.prevNodeId;
    delete T.plans[p.id];
    log(`${p.name} 避战，丢下 ${lost.length} 件物资`, '');
    return true;
  };

  if (human) {
    G.phase = 'encounter';
    encounter(human, human === a ? b : a, after);
    return;
  }
  if (tryFlee(a) || tryFlee(b)) { after(); return; }
  pvpBattle(a, b, map.env, res => {
    const r = resolvePvp(a, b, res);
    delete T.plans[r.loser.id];
    log(`${r.winner.name} 击败 ${r.loser.name}，${r.spoils.length} 件物资易主`, 'hl');
    after();
  });
}

/** 到达节点结算：出口 / 怪物点 / 搜刮 */
function runArriveEvent(ev, next) {
  const T = G.turn;
  const map = G.maps[T.mapId];
  const p = ev.p;
  if (!map || !p || !p.alive || p.mapNodeId == null || p.mapNodeId !== ev.nodeId) { next(); return; }
  const node = map.byId[ev.nodeId];
  if (!node) { next(); return; }

  if (node.type === 'exit') {
    extractPlayer(p);
    delete T.plans[p.id];
    next();
    return;
  }
  if (node.type === 'monster') {
    if (p.isHuman) { fightMonster(p, node, next); return; }
    const res = runBattle(teamOf(p, 'A', map.env), monsterTeam(G.round));
    if (res.winner === 'A') {
      lootNode(p, node);
    } else {
      p.mapNodeId = p.prevNodeId;
      delete T.plans[p.id];
    }
    next();
    return;
  }
  if (node.type !== 'start') lootNode(p, node);
  next();
}

function finishMovePhase() {
  const T = G.turn;
  if (!T) return;
  T.busy = false;
  if (!G.me || !G.me.alive || G.me.mapNodeId == null) { onHumanMapDone(); return; }

  // 行动点耗尽的玩家就地结算
  for (const p of mapPlayersOnField(T.mapId)) {
    if (p.ap <= 0) forceSettle(p);
  }
  const rest = mapPlayersOnField(T.mapId);
  if (!rest.length || !rest.some(p => p.ap > 0)) {
    G.turn = null;
    render();
    checkRoundEnd();
    return;
  }
  beginPlanPhase();
}

function forceSettleHuman() {
  if (G.phase !== 'explore' || !G.me || G.me.mapNodeId == null || !G.turn) return;
  if (!confirm('就地结算会立刻结束本轮探索，且物资减半。确定？')) return;
  forceSettle(G.me);
  onHumanMapDone();
}

function checkRoundEnd() {
  if (G.players.some(p => p.alive && p.mapNodeId != null)) return;
  G.phase = 'roundEnd';
  render();
  setTimeout(showShop, 260);
}

function advanceRound() {
  if (G.round >= 3) { startTournament(); return; }
  G.round++;
  retireMap();
  for (const p of G.players) p.mapId = null;
  G.phase = 'mapPick';
  showMapPick();
}

/** 每轮退役一张图：优先退役本轮人最少的那张 */
function retireMap() {
  const counts = {};
  G.avail.forEach(i => { counts[i] = 0; });
  for (const p of G.players) {
    if (p.mapId != null && counts[p.mapId] != null) counts[p.mapId]++;
  }
  let worst = G.avail[0];
  for (const i of G.avail) if (counts[i] < counts[worst]) worst = i;
  G.avail = G.avail.filter(i => i !== worst);
  if (!G.avail.length) G.avail = [worst];
  if (G.avail.length === 1) log(`只剩 ${G.maps[G.avail[0]].env} 一张图，四人必须同场`, 'hl');
}

/* ---------------- 渲染 ---------------- */

function phaseLabel() {
  switch (G.phase) {
    case 'heroPick': return '选择角色';
    case 'mapPick': return `第 ${G.round} 轮 · 选图`;
    case 'explore': return `第 ${G.round} 轮 · 探索`;
    case 'battle': return '战斗';
    case 'shop': return `第 ${G.round} 轮 · 补给`;
    case 'tour': return '决胜淘汰赛';
    case 'over': return '本局结束';
    default: return '';
  }
}

function mapDrawOpts() {
  return {
    mapIndex: G.me.mapId,
    movableIds: planNextIds(),
    pathIds: (G.plan && G.plan.ids) || [],
    highlightIds: G.highlight,
    currentPlayerId: G.turn && G.me.mapNodeId != null ? G.me.id : null,
    currentNodeId: G.me.mapNodeId,
    turnLabel: G.turn
      ? (G.turn.phase === 'plan' ? '规划 ' : '同步移动 ') + G.turn.cycle
      : '',
    cloakActive: cloakActive
  };
}

function queueRender(flags) {
  queuedRenderFlags |= flags;
  if (!renderFrameId) renderFrameId = requestAnimationFrame(flushRender);
}

function render() {
  queueRender(RENDER_ALL);
}

function renderSide() {
  queueRender(RENDER_SIDE);
}

function flushRender() {
  renderFrameId = 0;
  const flags = queuedRenderFlags;
  queuedRenderFlags = 0;

  if (flags & RENDER_TOP) renderTopNow();
  if (flags & RENDER_SIDE) renderSideNow();
  if (flags & RENDER_ACTIONBAR) renderActionbarNow();
  if (flags & RENDER_MAP) {
    if (!G.me || G.me.mapId == null) return;
    const map = G.maps[G.me.mapId];
    if (!map) return;
    syncMapFxCanvas();
    drawMap(mctx, map, G.players, mapDrawOpts());
    drawMapEffects(fxctx, map);
  }
}

function syncMapFxCanvas() {
  const wrap = mapFxCanvas.parentElement;
  const canvasRect = mapCanvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const style = getComputedStyle(mapCanvas);
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;

  mapFxCanvas.style.left = `${canvasRect.left - wrapRect.left + borderLeft}px`;
  mapFxCanvas.style.top = `${canvasRect.top - wrapRect.top + borderTop}px`;
  mapFxCanvas.style.width = `${Math.max(0, canvasRect.width - borderLeft - borderRight)}px`;
  mapFxCanvas.style.height = `${Math.max(0, canvasRect.height - borderTop - borderBottom)}px`;
}

/** 只重绘出口动画透明层；地图主体在状态变化时才重绘。 */
function renderMapOnly() {
  if (G.phase !== 'explore' || document.hidden || !G.me || G.me.mapId == null) return;
  const map = G.maps[G.me.mapId];
  if (!map) return;
  drawMapEffects(fxctx, map);
}

function startMapFxLoop() {
  if (mapFxTimer || document.hidden) return;
  mapFxTimer = setInterval(() => {
    if (G.phase === 'explore') renderMapOnly();
  }, 120);
}

function onVisibilityChange() {
  if (document.hidden) {
    if (mapFxTimer) clearInterval(mapFxTimer);
    mapFxTimer = null;
  } else {
    startMapFxLoop();
  }
}

function renderTopNow() {
  $('phaseInfo').textContent = phaseLabel();
  const map = (G.me && G.me.mapId != null) ? G.maps[G.me.mapId] : null;
  const env = map ? `<span>环境 <b style="color:${ENV_COLOR[map.env]}">${map.env}</b></span>` : '';
  const turn = (G.phase === 'explore' && G.turn)
    ? `<span>规划周期 <b>${G.turn.cycle}</b> · ${G.turn.phase === 'plan'
      ? '正在规划' : '同步移动'}</span>`
    : '';
  $('hud').innerHTML =
    `<span>第 <b>${G.round}</b> 轮</span>${env}${turn}` +
    `<span>存活 <b>${alivePlayers().length}</b>/4</span>`;
}

function fmtMats(list) {
  const m = {};
  for (const it of list) {
    const k = it.n + '|' + it.q;
    m[k] = (m[k] || 0) + 1;
  }
  return Object.keys(m).map(k => {
    const p = k.split('|');
    return `<span class="q-${p[1]}">${p[0]}</span>×${m[k]}`;
  }).join(' ');
}

function renderSideNow() {
  const side = $('side');
  if (!G.me) {
    side.innerHTML = `<div class="block"><h3>状态</h3><div class="muted">尚未开局</div></div>`;
    return;
  }
  const p = G.me;

  const sideLocked = lockedMats(p);
  const chips = groupMaterials(p.materials)
    .map(g => {
      const lockCount = p.materials.filter(m => m.n === g.n && m.q === g.q && sideLocked.has(m)).length;
      const mark = lockCount > 0 ? `<span class="lock ro" title="补给窗口内可点锁标解锁">锁${lockCount}</span>` : '';
      return `<span class="chip q-${g.q}">${g.n}·${QMAP[g.q].name}<span class="c">×${g.count}</span>${mark}</span>`;
    })
    .join(' ') || `<span class="muted">背包空空</span>`;

  const slotNames = ['weapon', 'armor', 'trinket'];
  const slots = p.equips.map((e, i) => {
    if (!e) return `<div class="slot">${EQUIP_SLOT_NAME[slotNames[i]]}<div class="stype">空</div></div>`;
    const apt = aptitudeOf(p.cls, e);
    const typeTxt = `${EQUIP_SLOT_NAME[e.slot]} · ${QMAP[e.quality].name}`
      + (e.cls ? ` · ${e.cls}` : '')
      + (apt === 'partial' ? ' · <span class="apt-part">60%</span>' : '');
    return `<div class="slot filled"><div class="sname q-${e.quality}">${e.name}</div>
      <div class="stype">${typeTxt}</div></div>`;
  }).join('');

  const bagNames = p.equipBag.map(e => `<span class="q-${e.quality}">${esc(e.name)}</span>`).join('、');

  const squad = p.soldiers.length
    ? p.soldiers.map(s => `<div class="unit-tile">
        <div class="nm" style="color:${CLASS_COLOR[s.cls]}">${s.name}</div>
        <div class="lv">${s.cls}·Lv${p.soldierLevels[s.cls]}</div>
        <div class="eq ${s.equip ? 'q-' + s.equip.quality : 'muted'}">${s.equip ? esc(s.equip.name) : '空装备'}</div>
      </div>`).join('')
    : `<div class="unit-tile empty">无兵</div>`;

  const logs = G.logs.slice(-14).map(l => `<div class="${l.cls}">${l.t}</div>`).join('');

  // 同图玩家：和地图上的标记颜色一致，方便快速分辨自己和对手
  const map = (G.me.mapId != null) ? G.maps[G.me.mapId] : null;
  let turnBlock = '';
  if (G.phase === 'explore' && map && map.turns) {
    const list = G.players.filter(q =>
      q.alive && q.mapId === G.me.mapId && q.mapNodeId != null);
    const planning = G.turn && G.turn.phase === 'plan';
    const rows = list.map(q => {
      const node = map.byId[q.mapNodeId];
      const mySteps = q.isHuman
        ? ((G.plan && G.plan.ids.length) || (G.turn && G.turn.plans[q.id] ? G.turn.plans[q.id].length : 0))
        : 0;
      const state = q.isHuman
        ? (planning ? `已规划 ${mySteps} 步` : '移动中')
        : (planning ? '待出发' : '移动中');
      return `<div class="turn-row ${q.isHuman ? 'you' : ''}">
        <span class="turn-dot" style="background:${q.isHuman ? '#4ad0a0' : '#d9654a'}"></span>
        <span class="turn-name">${q.isHuman ? '你 · ' : ''}${q.name}
          <span class="turn-cls" style="color:${CLASS_COLOR[q.cls]}">${q.cls}</span></span>
        <span class="turn-pos">${node && node.revealed ? NODE_TYPES[node.type].name : '未知'}</span>
        <span class="turn-ap">${state} · AP ${q.ap}</span>
      </div>`;
    }).join('') || '<div class="muted">本轮已结束</div>';
    turnBlock = `<div class="block">
      <h3>同图玩家（${list.length} 人）</h3>
      <div class="turn-order">${rows}</div>
      <div class="turn-legend"><span class="turn-dot" style="background:#4ad0a0"></span>你
        <span class="turn-dot foe" style="background:#d9654a"></span>对手
        <span class="turn-gold">青色路径</span>=你的规划</div>
    </div>`;
  }

  side.innerHTML = `
    <div class="block">
      <div class="hero-line">
        <span class="nm">${p.name}</span>
        <span class="pill" style="color:${CLASS_COLOR[p.cls]}">${p.cls}</span>
        <span class="pill">${HEROES.find(h => h.id === p.heroId).tag}</span>
      </div>
      <div class="apbar"><i style="width:${clamp(p.ap / p.apMax * 100, 0, 100)}%"></i></div>
      <div class="apnum">行动点 ${p.ap} / ${p.apMax}　·　身家 ${playerValue(p)}</div>
    </div>
    ${turnBlock}
    <div class="block">
      <h3>背包（${p.materials.length}）</h3>
      <div class="chips">${chips}</div>
    </div>
    <div class="block">
      <h3>装备</h3>
      <div class="slots">${slots}</div>
      <div class="bagline">装备背包 ${p.equipBag.length} 件${bagNames ? '：' + bagNames : ''}</div>
    </div>
    <div class="block">
      <h3>部队 ${p.soldiers.length}/${MAX_SOLDIERS}</h3>
      <div class="squad">${squad}</div>
    </div>
    <div class="block">
      <h3>战报</h3>
      <div class="loglist">${logs}</div>
    </div>`;
}

function renderActionbarNow() {
  const bar = $('actionbar');

  if (G.phase !== 'explore' || !G.me) {
    bar.innerHTML = '';
    return;
  }

  if (G.me.alive && G.me.mapNodeId != null && G.turn) {
    if (G.turn.phase === 'plan') {
      const cap = Math.min(TURN_STEPS, G.me.ap);
      bar.innerHTML = `
        <span class="turn-pill you">规划阶段</span>
        <span class="turn-steps">步数 <b id="turnSteps">${(G.plan && G.plan.ids.length) || 0}/${cap}</b></span>
        <span class="turn-timer" id="turnTimer">${G.turn.left.toFixed(1)}s</span>
        <div class="turnbar"><i id="turnBar" style="width:${clamp(G.turn.left / TURN_SECONDS * 100, 0, 100)}%"></i></div>
        <span class="hint">按住拖动地图画 1-${cap} 步路径，松手后可继续调整</span>
        <span class="spacer"></span>
        <button class="btn ok" onclick="confirmPlan()">确认路径</button>
        <button class="btn" onclick="clearPlan()">清空路径</button>
        <button class="btn" onclick="showRivals()">查看对手</button>
        <button class="btn warn" onclick="forceSettleHuman()">就地结算</button>`;
      updatePlanTimerDom();
      return;
    }

    bar.innerHTML = `
      <span class="turn-pill foe">全体同时移动</span>
      <span class="turn-steps">第 <b>${Math.min(G.turn.step + 1, G.turn.maxLen)}/${G.turn.maxLen}</b> 步</span>
      <span class="hint">${G.turn.busy ? '本步结算中…' : '所有玩家正在同步移动…'}</span>
      <span class="spacer"></span>
      <button class="btn" onclick="showRivals()">查看对手</button>
      <button class="btn warn" onclick="forceSettleHuman()">就地结算</button>`;
    return;
  }

  if (G.me.alive && G.me.mapNodeId != null) {
    bar.innerHTML = `<span class="hint">等待规划开始…</span>`;
    return;
  }

  bar.innerHTML = `<span class="hint">你已离场，等待本轮其他人生还…</span>
    <span class="spacer"></span><button class="btn" onclick="showRivals()">查看对手</button>`;
}

/* ---------------- 规划路径与拖拽 ---------------- */

function canEditPath() {
  return G.phase === 'explore' && G.turn && G.turn.phase === 'plan'
    && G.me && G.me.alive && G.me.mapNodeId != null && G.me.ap > 0;
}

function planCap() {
  return G.me ? Math.min(TURN_STEPS, G.me.ap) : TURN_STEPS;
}

function pathTipId() {
  const ids = (G.plan && G.plan.ids) || [];
  return ids.length ? ids[ids.length - 1] : G.me.mapNodeId;
}

/** 路径末端（无路径则当前节点）的邻居；已到步数上限时不再高亮 */
function planNextIds() {
  if (!canEditPath()) return [];
  const ids = (G.plan && G.plan.ids) || [];
  if (ids.length >= planCap()) return [];
  const map = G.maps[G.me.mapId];
  const tip = map && map.byId[pathTipId()];
  if (!tip) return [];
  return tip.neighbors.filter(id => !ids.includes(id));
}

function mapHitNode(e) {
  if (!G.me || G.me.mapId == null) return null;
  const map = G.maps[G.me.mapId];
  if (!map) return null;
  const r = mapCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (mapCanvas.width / r.width);
  const my = (e.clientY - r.top) * (mapCanvas.height / r.height);
  let hit = null, bestD = 28 * 28;
  for (const n of map.nodes) {
    const d = (n.x - mx) * (n.x - mx) + (n.y - my) * (n.y - my);
    if (d < bestD) { bestD = d; hit = n; }
  }
  return hit;
}

/** 追加/回退路径；命中当前节点或路径上的节点时截断 */
function pathAdd(nodeId) {
  const ids = G.plan.ids;
  if (nodeId === G.me.mapNodeId) {
    if (!ids.length) return false;
    ids.length = 0;
    return true;
  }
  const existing = ids.indexOf(nodeId);
  if (existing >= 0) {
    if (existing === ids.length - 1) return false;
    ids.length = existing + 1;
    return true;
  }
  if (ids.length >= planCap() || ids.includes(nodeId)) return false;
  const map = G.maps[G.me.mapId];
  const tip = map && map.byId[pathTipId()];
  if (!tip || !tip.neighbors.includes(nodeId)) return false;
  ids.push(nodeId);
  return true;
}

function onMapPointerDown(e) {
  if (!canEditPath() || e.button !== 0) return;
  const hit = mapHitNode(e);
  if (!hit) return;
  if (!pathAdd(hit.id)) return;
  G.plan.dragging = true;
  try { mapCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  updatePlanTimerDom();
  render();
}

function onMapPointerMove(e) {
  if (!canEditPath() || !G.plan.dragging) return;
  const hit = mapHitNode(e);
  if (!hit) return;
  if (!pathAdd(hit.id)) return;
  updatePlanTimerDom();
  render();
}

function onMapPointerUp() {
  if (!G.plan) return;
  G.plan.dragging = false;
}

function lootNode(p, node) {
  if (node.looted || !node.stock || !node.stock.length) {
    if (p.isHuman) log(`${NODE_TYPES[node.type].name}已被搜空`);
    return;
  }
  const got = node.stock.slice();
  node.looted = true;
  node.stock = [];
  p.materials.push(...got);
  if (p.isHuman) log(`搜刮 ${NODE_TYPES[node.type].name}：${fmtMats(got)}`, 'hl');

  const rate = EQUIP_RATE[node.kind] || 0;
  if (Math.random() < rate) {
    let q = rollQuality(node.kind);
    if (QINDEX[q] < 1) q = 'blue';
    const res = grantEquip(p, q);
    if (p.isHuman) {
      log(`掉落装备 <span class="q-${res.eq.quality}">${res.eq.name}</span>（已放入装备背包）`, 'hl');
    }
  }
  updateHighlight();
}

const EQUIP_SLOT_INDEX = { weapon: 0, armor: 1, trinket: 2 };

/** 到手装备：直接进入装备背包，由玩家在补给窗口自行穿戴 */
function grantEquip(p, qKey) {
  const slot = ['weapon', 'armor', 'trinket'][randInt(0, 2)];
  const eq = makeEquip(slot, qKey);
  p.equipBag.push(eq);
  return { eq };
}

/** 随机丢失一半物资（按件数向上取整） */
function dropHalfMaterials(p) {
  const list = shuffle(p.materials);
  const n = Math.ceil(list.length / 2);
  const lost = list.slice(0, n);
  const lostSet = new Set(lost);
  p.materials = p.materials.filter(m => !lostSet.has(m));
  return lost;
}

function extractPlayer(p) {
  p.mapNodeId = null;
  p.escapedThisRound = true;
  p.totalValue = playerValue(p);
  if (p.isHuman) {
    log('抵达出口，安全撤离：物资全额保留', 'hl');
  } else {
    log(`${p.name} 从出口撤离`, '');
  }
}

function forceSettle(p) {
  if (!p || p.mapNodeId == null) return;
  const lost = dropHalfMaterials(p);
  p.mapNodeId = null;
  p.escapedThisRound = true;
  p.totalValue = playerValue(p);
  if (p.isHuman) {
    log(`就地强制结算：丢失 ${lost.length} 件物资（${fmtMats(lost) || '无'}）`, 'hl');
  } else {
    log(`${p.name} 行动点耗尽，就地结算（丢 ${lost.length} 件）`, '');
  }
}

function showRivals() {
  const rows = G.players.filter(p => p.alive).map(p => {
    const map = p.mapId != null ? G.maps[p.mapId] : null;
    const hideCls = cloakActive(p) && !p.isHuman;
    return `<div class="pick-card">
      <div class="t">${p.isHuman ? '你 · ' : ''}${p.name}</div>
      <div class="tag">${hideCls ? '职业未知' : p.cls} · ${map ? map.env : '—'} · 身家 ${playerValue(p)}</div>
      <div class="stat">部队 ${p.soldiers.length} 人${p.soldiers.length ? '：' + p.soldiers.map(s => s.name).join('、') : ''}</div>
      <div class="d">装备：${p.equips.filter(Boolean).map(e => `<span class="q-${e.quality}">${e.name}</span>`).join('、') || '无'}</div>
    </div>`;
  }).join('');

  showOverlay(`
    <h2>场上形势</h2>
    <div class="sub">第 ${G.round} 轮 · 存活 ${alivePlayers().length} 人</div>
    <div class="card-grid">${rows}</div>
    <div class="mt center"><button class="btn" onclick="hideOverlay();render()">关闭</button></div>
  `);
}

/* ============================================================
   Part 3 · 战斗 / AI / 商店 / 淘汰赛
   ============================================================ */

/* ---------------- 队伍构建 ---------------- */

function cloneSoldierForBattle(s) {
  const st = soldierStats(s.cls, s.tier, s.level);
  const b = s.equip ? equipBonus([s.equip], s.cls) : { atk: 0, hp: 0, def: 0 };
  return Object.assign({}, s, {
    maxHp: st.hp + b.hp,
    hp: st.hp + b.hp,
    atk: st.atk + b.atk,
    def: st.def + b.def
  });
}

/** 英雄上阵：装备加成 + 环境地形加成 */
function battleHeroOf(p, env) {
  const h = heroToBattleUnit(p);
  const t = HERO_TERRAIN[p.heroId];
  if (t && t.env === env) {
    h.maxHp = Math.round(h.maxHp * (1 + t.bonus));
    h.hp = h.maxHp;
    h.atk = Math.round(h.atk * (1 + t.bonus));
    h.terrain = t.env;
  }
  return h;
}

function teamOf(p, side, env) {
  return makeTeam(side, battleHeroOf(p, env), p.soldiers.map(cloneSoldierForBattle), 'smart');
}

/** 怪物点守军：按轮次固定增长 */
function monsterTeam(round) {
  const plan = round <= 1 ? [['normal', 2]]
    : round === 2 ? [['normal', 3]]
      : [['elite', 4]];
  const lv = Math.max(1, round - 1);
  const list = [];
  for (const [tier, n] of plan) {
    for (let i = 0; i < n; i++) {
      const cls = CLASSES[randInt(0, CLASSES.length - 1)];
      const s = makeSoldier(cls, tier);
      const st = soldierStats(cls, tier, lv);
      s.level = lv;
      s.maxHp = st.hp; s.hp = st.hp; s.atk = st.atk; s.def = st.def;
      list.push(s);
    }
  }
  return makeSoloTeam('B', list);
}

/* ---------------- 战斗回放 ---------------- */

function rosterHtml(units, side) {
  const list = units.filter(u => u.side === side);
  if (!list.length) return '<div class="row"><span class="muted">无</span></div>';
  return list.map(u => `<div class="row" data-ruid="${u.uid}">
      <span class="${u.kind === 'hero' ? 'hy' : ''}">${esc(u.name)}
        <span style="color:${CLASS_COLOR[u.cls] || '#888'}">${u.cls}</span></span>
      <span class="hpv">${Math.round(u.hp)}</span>
    </div>`).join('');
}

function syncRoster(units) {
  for (const u of units) {
    const el = document.querySelector(`[data-ruid="${u.uid}"] .hpv`);
    if (!el) continue;
    if (u.alive) {
      el.textContent = Math.round(u.hp);
      el.className = 'hpv';
    } else {
      el.textContent = '阵亡';
      el.className = 'hpv dead';
    }
  }
}

/* ---------------- 战斗前准备：5 秒决策 / 10 秒布阵 ---------------- */

function clearBattlePrep() {
  if (G.decision) {
    if (G.decision.timer) clearInterval(G.decision.timer);
    G.decision = null;
  }
  if (G.form) {
    if (G.form.timer) clearInterval(G.form.timer);
    G.form = null;
  }
}

/** 5 秒决定战斗 / 逃跑，超时默认开战 */
function battleDecision(cfg) {
  clearTurnTimer();
  G.phase = 'battle';
  const st = { left: DECIDE_SECONDS, timer: null, done: false, cfg };
  G.decision = st;

  showOverlay(`
    <h2>${esc(cfg.title)}</h2>
    <div class="sub">${cfg.sub || ''}</div>
    <div class="two-col">${cfg.sideCardsHtml || ''}</div>
    <div class="mt center">
      <span class="turn-timer" id="decisionTimer">${DECIDE_SECONDS.toFixed(1)}s</span>
      <div class="turnbar"><i id="decisionBar" style="width:100%"></i></div>
      <div class="mt">
        <button class="btn ok" onclick="decisionFight()">开战</button>
        <button class="btn warn" onclick="decisionFlee()">撤退（丢一半物资，结束本回合）</button>
      </div>
    </div>`);

  st.finish = fight => {
    if (st.done) return;
    st.done = true;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (G.decision === st) G.decision = null;
    if (fight) cfg.onFight();
    else cfg.onFlee();
  };

  st.timer = startDeadlineInterval(DECIDE_SECONDS, 100, left => {
    if (G.decision !== st) { clearInterval(st.timer); st.timer = null; return; }
    st.left = Math.max(0, left);
    const t = $('decisionTimer'), bar = $('decisionBar');
    if (t) t.textContent = st.left.toFixed(1) + 's';
    if (bar) bar.style.width = clamp(st.left / DECIDE_SECONDS * 100, 0, 100) + '%';
    if (st.left <= 0) {
      log('决策时间到，自动开战', 'hl');
      st.finish(true);
    }
  });
}

function decisionFight() { if (G.decision) G.decision.finish(true); }
function decisionFlee() { if (G.decision) G.decision.finish(false); }

/** 10 秒手动布阵：拖动或点击摆放己方单位 */
function openFormation(cfg) {
  clearTurnTimer();
  G.phase = 'battle';
  const teamA = cfg.teamA, teamB = cfg.teamB;
  const st = {
    left: FORMATION_SECONDS, timer: null, done: false,
    selUid: null, hoverCell: null, dragFrom: null, moved: false, cfg
  };
  G.form = st;

  showOverlay(`
    <h2>${esc(cfg.title)}</h2>
    <div class="sub">${cfg.sub || ''}</div>
    <div class="battle-wrap">
      <div id="formationHost"></div>
      <div class="battle-side">
        <h4>${esc(cfg.labelA)}</h4>
        <div class="roster">${rosterHtml(teamA, 'A')}</div>
        <h4>${esc(cfg.labelB)}</h4>
        <div class="roster">${rosterHtml(teamB, 'B')}</div>
        <div class="form-hint">拖动或点击己方单位，再点左侧两列的空格放置；点到己方单位会互换位置。</div>
        <div class="formation-ctrl">
          <span class="turn-timer" id="formTimer">${FORMATION_SECONDS.toFixed(1)}s</span>
          <div class="turnbar"><i id="formBar" style="width:100%"></i></div>
          <div class="mt">
            <button class="btn" onclick="autoFormationNow()">自动阵型</button>
            <button class="btn ok" onclick="finishFormation()">开始战斗</button>
          </div>
        </div>
      </div>
    </div>`);

  const canvas = document.createElement('canvas');
  canvas.id = 'formationCanvas';
  canvas.width = BATTLE_W;
  canvas.height = BATTLE_H;
  $('formationHost').appendChild(canvas);
  const ctx = canvas.getContext('2d');

  st.redraw = () => drawFormation(ctx, teamA, teamB, {
    selUid: st.selUid,
    hoverCell: st.hoverCell
  });
  st.redraw();

  const cellOf = e => {
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (canvas.width / r.width);
    const my = (e.clientY - r.top) * (canvas.height / r.height);
    return { x: Math.floor(mx / CELL), y: Math.floor(my / CELL) };
  };
  const unitAt = (x, y) => teamA.concat(teamB)
    .find(u => u.alive && u.x === x && u.y === y) || null;

  const placeSelected = (tx, ty) => {
    const sel = teamA.find(u => u.uid === st.selUid);
    st.selUid = null;
    st.hoverCell = null;
    st.dragFrom = null;
    if (!sel) { st.redraw(); return; }
    if ((tx !== 0 && tx !== 1) || ty < 0 || ty >= GRID_H) { st.redraw(); return; }
    const other = unitAt(tx, ty);
    if (other && other.side === 'B') { st.redraw(); return; }
    if (other && other.uid !== sel.uid) {
      const ox = other.x, oy = other.y;
      other.x = sel.x; other.y = sel.y;
      sel.x = ox; sel.y = oy;
    } else {
      sel.x = tx; sel.y = ty;
    }
    st.redraw();
  };

  canvas.addEventListener('pointerdown', e => {
    if (st.done) return;
    const c = cellOf(e);
    const u = unitAt(c.x, c.y);
    st.hoverCell = c;
    st.moved = false;
    if (u && u.side === 'A') {
      st.selUid = u.uid;
      st.dragFrom = c;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (st.selUid) {
      st.dragFrom = c;
      st.moved = true;
    }
    st.redraw();
  });

  canvas.addEventListener('pointermove', e => {
    if (st.done || !st.selUid) return;
    const c = cellOf(e);
    if (!st.hoverCell || st.hoverCell.x !== c.x || st.hoverCell.y !== c.y) {
      st.hoverCell = c;
      if (st.dragFrom && (st.dragFrom.x !== c.x || st.dragFrom.y !== c.y)) st.moved = true;
      st.redraw();
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (st.done || !st.selUid || !st.dragFrom) return;
    const c = cellOf(e);
    if (!st.moved && st.dragFrom.x === c.x && st.dragFrom.y === c.y) {
      st.hoverCell = c;
      st.redraw();
      return;
    }
    placeSelected(c.x, c.y);
  });

  st.timer = startDeadlineInterval(FORMATION_SECONDS, 100, left => {
    if (G.form !== st) { clearInterval(st.timer); st.timer = null; return; }
    st.left = Math.max(0, left);
    const t = $('formTimer'), bar = $('formBar');
    if (t) t.textContent = st.left.toFixed(1) + 's';
    if (bar) bar.style.width = clamp(st.left / FORMATION_SECONDS * 100, 0, 100) + '%';
    if (st.left <= 0) {
      log('布阵时间到，按当前阵型开战', 'hl');
      finishFormation();
    }
  });
}

function autoFormationNow() {
  const st = G.form;
  if (!st || st.done) return;
  smartFormation('A', st.cfg.teamA);
  dedupePositions('A', st.cfg.teamA);
  st.selUid = null;
  st.hoverCell = null;
  st.dragFrom = null;
  st.redraw();
}

function finishFormation() {
  const st = G.form;
  if (!st || st.done) return;
  st.done = true;
  if (st.timer) { clearInterval(st.timer); st.timer = null; }
  G.form = null;
  hideOverlay();
  st.cfg.onReady(st.cfg.teamA, st.cfg.teamB);
}

let battleDoneCb = null;

function playBattle(cfg) {
  const res = runBattle(cfg.teamA, cfg.teamB);
  G.phase = 'battle';

  const canvas = document.createElement('canvas');
  canvas.id = 'battleCanvas';
  canvas.width = BATTLE_W;
  canvas.height = BATTLE_H;
  const ctx = canvas.getContext('2d');
  const first = res.events[0].units;

  showOverlay(`
    <h2>${esc(cfg.title)}</h2>
    <div class="sub">${cfg.sub || '全体同时出手 · 最多 12 回合'}　·　阵营色：<span style="color:#4ad0a0">你方</span> / <span style="color:#e07050">敌方</span></div>
    <div class="battle-wrap">
      <div id="battleHost"></div>
      <div class="battle-side">
        <h4>${esc(cfg.labelA)}</h4>
        <div class="roster">${rosterHtml(first, 'A')}</div>
        <h4>${esc(cfg.labelB)}</h4>
        <div class="roster">${rosterHtml(first, 'B')}</div>
        <div class="battle-log" id="battleLog"></div>
        <div class="battle-ctrl" id="battleCtrl">
          <button class="btn" id="btnSpeed">×1</button>
          <button class="btn" id="btnSkip">跳过</button>
        </div>
      </div>
    </div>`);
  $('battleHost').appendChild(canvas);

  const nameOf = {};
  res.units.forEach(u => { nameOf[u.uid] = u.name; });

  const floats = [];
  let cursor = 0, cur = first, done = false;
  let nextAt = 0, lastT = 0, speed = 1;
  let hitUid = null, hitUntil = 0;

  const logEl = $('battleLog');
  let logCount = 0;
  function pushLog(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    logEl.appendChild(d);
    if (++logCount > 120) { logEl.removeChild(logEl.firstChild); logCount--; }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function apply(ev, t) {
    if (ev.t === 'frame') {
      cur = ev.units;
      syncRoster(ev.units);
      return;
    }
    if (ev.t === 'attack') {
      const up = ev.counter === 'up', down = ev.counter === 'down';
      floats.push({
        text: (up ? '↑' : down ? '↓' : '') + ev.dmg,
        x: ev.x * CELL + CELL / 2,
        y: ev.y * CELL + CELL / 2 - 18,
        color: ev.died ? '#ff6b52' : up ? '#ffd76a' : down ? '#8fa3b8' : '#e8eef6',
        crit: ev.dmg >= 40, life: 720, maxLife: 720
      });
      hitUid = ev.target; hitUntil = t + 170;
      pushLog(`${esc(nameOf[ev.uid] || '?')}${up ? '（克制）' : down ? '（被克）' : ''} → ${esc(nameOf[ev.target] || '?')} <b>${ev.dmg}</b>${ev.died ? ' <span style="color:#e3503f">击杀</span>' : ''}`);
      return;
    }
    if (ev.t === 'skill') {
      floats.push({
        text: ev.skill, x: ev.x * CELL + CELL / 2, y: ev.y * CELL + CELL / 2 - 26,
        color: '#b06fe0', crit: true, life: 860, maxLife: 860
      });
      pushLog(`<span style="color:#b06fe0">${esc(ev.skill)}</span> · ${esc(nameOf[ev.uid] || '?')}`);
      return;
    }
    if (ev.t === 'stun') pushLog(`<span style="color:#8fa3b8">${esc(nameOf[ev.uid] || '?')} 被定身</span>`);
  }

  function delayOf(ev) {
    if (ev.t === 'attack') return (ev.simul ? 180 : 250) / speed;
    if (ev.t === 'skill') return 320 / speed;
    return 58 / speed;
  }

  function showEnd() {
    const w = res.winner;
    const txt = w === 'draw' ? '平局'
      : `${esc(w === 'A' ? cfg.labelA : cfg.labelB)} 获胜`;
    $('battleCtrl').innerHTML =
      `<button class="btn ok" id="btnBattleDone">继续</button>
       <span class="muted">${txt} · ${res.rounds} 回合</span>`;
    $('btnBattleDone').onclick = () => { hideOverlay(); if (cfg.onEnd) cfg.onEnd(res); };
  }

  $('btnSkip').onclick = () => {
    while (cursor < res.events.length) {
      const ev = res.events[cursor++];
      if (ev.t === 'frame' || ev.t === 'end') cur = ev.units;
    }
    syncRoster(cur);
    done = true;
    showEnd();
  };

  $('btnSpeed').onclick = () => {
    speed = speed === 1 ? 3 : 1;
    $('btnSpeed').textContent = '×' + speed;
  };

  function loop(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(64, t - lastT);
    lastT = t;

    for (const f of floats) f.life -= dt;
    for (let k = floats.length - 1; k >= 0; k--) if (floats[k].life <= 0) floats.splice(k, 1);

    while (!done && cursor < res.events.length && t >= nextAt) {
      const ev = res.events[cursor++];
      apply(ev, t);
      if (ev.t === 'end') { done = true; showEnd(); break; }
      nextAt = t + delayOf(ev);
    }

    drawBattle(ctx, cur, {
      floats,
      hitUid: t < hitUntil ? hitUid : null
    });

    if (!done || floats.length) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

/* ---------------- 战后结算 ---------------- */

function showBattleResult(title, cls, lines, cb) {
  battleDoneCb = cb || null;
  showOverlay(`
    <h2 class="${cls || ''}">${title}</h2>
    <div class="sub">${lines}</div>
    <div class="mt center"><button class="btn ok" onclick="closeBattleResult()">继续</button></div>`);
}

function closeBattleResult() {
  const cb = battleDoneCb;
  battleDoneCb = null;
  hideOverlay();
  if (cb) cb();
}

function strengthOf(p) {
  let v = 40 + p.heroLevel * 10;
  for (const s of p.soldiers) {
    v += SOLDIERS[s.cls][s.tier].price;
    if (s.equip) v += QMAP[s.equip.quality].value * 3;
  }
  for (const e of p.equips) if (e) v += QMAP[e.quality].value * 3;
  return v;
}

/** 一场 PvP：返回结算信息 */
function pvpBattle(a, b, env, cb) {
  a.foughtThisGame = true;
  b.foughtThisGame = true;
  const teamA = teamOf(a, 'A', env);
  const teamB = teamOf(b, 'B', env);
  const labelA = a.name + (a.isHuman ? '（你）' : '');
  const labelB = b.name + (b.isHuman ? '（你）' : '');
  const human = a.isHuman || b.isHuman;

  // 战后阵亡小兵全部归队，不再从编制里删除
  const finish = res => cb(res);

  if (!human) {
    const res = runBattle(teamA, teamB);
    finish(res);
    return;
  }
  openFormation({
    title: `${a.name} VS ${b.name}`,
    sub: `${env} 环境 · 10 秒布置阵型，超时按当前阵型开战`,
    teamA, teamB, labelA, labelB,
    onReady: (fa, fb) => playBattle({
      title: `${a.name} VS ${b.name}`,
      sub: `${env} 环境 · 全体同时出手`,
      teamA: fa, teamB: fb, labelA, labelB, onEnd: finish
    })
  });
}

function resolvePvp(a, b, res) {
  let winner, loser;
  if (res.winner === 'A') { winner = a; loser = b; }
  else if (res.winner === 'B') { winner = b; loser = a; }
  else { winner = playerValue(a) >= playerValue(b) ? a : b; loser = winner === a ? b : a; }

  const spoils = dropHalfMaterials(loser);
  winner.materials.push(...spoils);
  loser.alive = false;
  loser.mapNodeId = null;
  loser.escapedThisRound = true;
  loser.totalValue = playerValue(loser);
  return { winner, loser, spoils };
}

/* ---------------- 遭遇战 ---------------- */

function sideCard(p, label) {
  const units = p.soldiers.map(s =>
    `<span style="color:${CLASS_COLOR[s.cls]}">${s.name}</span>`).join('、') || '无';
  const eq = p.equips.filter(Boolean).map(e => `<span class="q-${e.quality}">${e.name}</span>`).join('、') || '无';
  return `<div class="pick-card" style="cursor:default">
    <div class="t">${label} · ${p.name}</div>
    <div class="tag">${p.cls} · 身家 ${playerValue(p)}</div>
    <div class="stat">部队：${units}</div>
    <div class="d">装备：${eq}</div>
  </div>`;
}

function encounter(human, foe, onDone) {
  G.phase = 'encounter';
  G.encounterDone = onDone || null;
  const env = G.maps[human.mapId].env;

  // 对冲：AI 判断打不过就丢一半物资跑路
  if (!foe.isHuman && strengthOf(foe) < strengthOf(human) * 0.6 && Math.random() < 0.5) {
    const lost = dropHalfMaterials(foe);
    foe.mapNodeId = foe.prevNodeId;
    clearPlanFor(foe);
    log(`${foe.name} 选择避战，丢下 ${lost.length} 件物资逃走`, 'hl');
    G.phase = 'explore';
    G.encounterDone = null;
    render();
    if (onDone) setTimeout(onDone, 300);
    return;
  }

  G.pendingFoe = foe;
  battleDecision({
    title: '遭遇战',
    sub: `同为 ${env} 环境 · 同一节点。打赢拿走对方一半物资，打输直接出局。5 秒内决定，超时自动开战。`,
    sideCardsHtml: sideCard(human, '你') + sideCard(foe, '对手'),
    onFight: () => startEncounterBattle(),
    onFlee: () => fleeEncounter()
  });
}

/** 结束一次遭遇结算，继续本步剩余事件 */
function finishEncounter() {
  const cb = G.encounterDone;
  G.encounterDone = null;
  G.phase = 'explore';
  render();
  if (cb) cb();
}

/** 玩家放弃剩余规划步数 */
function clearPlanFor(p) {
  if (G.turn && G.turn.plans) delete G.turn.plans[p.id];
}

function startEncounterBattle() {
  const foe = G.pendingFoe;
  G.pendingFoe = null;
  if (!foe || !G.me) return;
  const me = G.me;
  const env = G.maps[me.mapId].env;

  pvpBattle(me, foe, env, res => {
    const r = resolvePvp(me, foe, res);
    const mine = r.winner === me;
    log(mine
      ? `${me.name} 击败 ${foe.name}，掠得 ${r.spoils.length} 件物资`
      : `${me.name} 被 ${foe.name} 击败，出局`, 'hl');

    showBattleResult(
      mine ? '战斗胜利' : '你已出局',
      mine ? 'result-win' : 'result-lose',
      mine
        ? `击败 ${esc(foe.name)}，获得对方一半物资：${fmtMats(r.spoils) || '无'}<br>你的部队已全员归队。`
        : `${esc(foe.name)} 获胜。你被淘汰，可继续观战或开下一局。`,
      () => {
        if (mine) { finishEncounter(); return; }
        G.encounterDone = null;
        G.phase = 'explore';
        render();
        showSpectate();
      }
    );
  });
}

function fleeEncounter() {
  const me = G.me;
  const lost = dropHalfMaterials(me);
  me.mapNodeId = me.prevNodeId;
  me.totalValue = playerValue(me);
  clearPlanFor(me);
  log(`你选择撤退，丢下 ${lost.length} 件物资（${fmtMats(lost) || '无'}）`, 'hl');
  G.pendingFoe = null;
  hideOverlay();
  finishEncounter();
}

/* ---------------- 怪物点 ---------------- */

function fightMonster(p, node, onDone) {
  const env = G.maps[p.mapId].env;
  const teamA = teamOf(p, 'A', env);
  const teamB = monsterTeam(G.round);
  const isHuman = p.isHuman;

  const done = res => {
    if (res.winner === 'A') {
      const got = node.stock ? node.stock.slice() : [];
      lootNode(p, node);
      if (isHuman) {
        log('怪物点清剿成功', 'hl');
        showBattleResult('战斗胜利', 'result-win',
          `怪物被清除。<br>${got.length ? '战利品：' + fmtMats(got) : '这里已经被搜空。'}`,
          () => {
            G.phase = 'explore';
            if (onDone) onDone();
          });
      } else if (onDone) {
        onDone();
      }
      return;
    }
    // 打输不阵亡、不扣兵：只退回上一节点，剩余路径作废
    p.mapNodeId = p.prevNodeId;
    clearPlanFor(p);
    if (isHuman) {
      log('败给怪物，部队无损，退回上一节点', 'hl');
      showBattleResult('战斗失败', 'result-lose',
        '你被怪物击退。<br>小兵不会永久损失，部队全员归队。<br>退回上一节点。',
        () => {
          G.phase = 'explore';
          if (onDone) onDone();
        });
    } else if (onDone) {
      onDone();
    }
  };

  if (!isHuman) {
    done(runBattle(teamA, teamB));
    return;
  }
  battleDecision({
    title: `怪物点 · 第 ${G.round} 轮`,
    sub: `${env} 环境 · 守军随轮次增强 · 5 秒内决定，超时自动开战`,
    sideCardsHtml: `
      <div class="pick-card" style="cursor:default">
        <div class="t">你 · ${p.name}</div>
        <div class="tag">${p.cls} · 部队 ${p.soldiers.length} 人</div>
      </div>
      <div class="pick-card" style="cursor:default">
        <div class="t">怪物守军</div>
        <div class="tag">${G.round <= 1 ? '普通' : G.round === 2 ? '普通 + 精英' : '精英'} · ${teamB.length} 个单位</div>
      </div>`,
    onFight: () => openFormation({
      title: `怪物点 · 第 ${G.round} 轮`,
      sub: `${env} 环境 · 10 秒布置阵型，超时按当前阵型开战`,
      teamA, teamB,
      labelA: '你', labelB: '怪物',
      onReady: (fa, fb) => playBattle({
        title: `怪物点 · 第 ${G.round} 轮`,
        sub: `${env} 环境 · 守军随轮次增强 · 全体同时出手`,
        teamA: fa, teamB: fb,
        labelA: '你', labelB: '怪物',
        onEnd: done
      })
    }),
    onFlee: () => fleeMonster(p, onDone)
  });
}

/** 避开怪物：丢一半物资、退回上一节点、放弃剩余路径 */
function fleeMonster(p, onDone) {
  const lost = dropHalfMaterials(p);
  p.mapNodeId = p.prevNodeId;
  p.totalValue = playerValue(p);
  clearPlanFor(p);
  log(`你选择避开怪物，丢下 ${lost.length} 件物资（${fmtMats(lost) || '无'}），退回上一节点`, 'hl');
  G.phase = 'explore';
  hideOverlay();
  render();
  if (onDone) onDone();
}

/** 玩家出局后的观战界面 */
function showSpectate() {
  clearTurnTimer();
  showOverlay(`
    <h2 class="result-lose">你已出局</h2>
    <div class="sub">本局结束。剩余对手仍在争夺，你可以观战到本局结束。</div>
    <div class="mt center">
      <button class="btn" onclick="hideOverlay();resumeAfterHumanOut()">继续观战</button>
      <button class="btn ok" onclick="startGame()">开下一局</button>
    </div>`);
}

function resumeAfterHumanOut() {
  G.phase = 'explore';
  G.turn = null;
  G.plan = { ids: [], dragging: false };
  fastForwardHumanMap();
  render();
  checkRoundEnd();
}

/* ---------------- AI 行动 ---------------- */

/** 一次性推演整轮（用于玩家看不到的其他地图） */
function aiTurn(p) {
  const map = G.maps[p.mapId];
  if (!map) { p.mapNodeId = null; return; }

  let guard = 0;
  while (p.alive && p.mapNodeId != null && p.ap > 0 && guard++ < 40) {
    const r = aiTakeStep(p);
    if (r === 'none' || r === 'paused' || r === 'exit' || r === 'dead') break;
  }

  if (p.alive && p.mapNodeId != null && p.ap <= 0) {
    forceSettle(p);
  }
}

/**
 * AI 走一步
 * @returns {'moved'|'none'|'exit'|'dead'|'paused'}
 */
function aiTakeStep(p) {
  const map = G.maps[p.mapId];
  if (!map) { p.mapNodeId = null; return 'exit'; }
  const node = map.byId[p.mapNodeId];
  if (!node) return 'none';
  const nbs = node.neighbors.map(id => map.byId[id]).filter(Boolean);
  if (!nbs.length) return 'none';

  const wantExit = p.ap <= 2 || (p.soldiers.length === 0 && p.ap <= 6);
  let target = wantExit ? nbs.find(n => n.type === 'exit') : null;
  if (!target) {
    let best = -Infinity;
    for (const n of nbs) {
      const s = aiNodeScore(p, n);
      if (s > best) { best = s; target = n; }
    }
  }
  if (!target) return 'none';

  p.prevNodeId = p.mapNodeId;
  p.mapNodeId = target.id;
  p.ap--;
  revealAround(map, target.id);

  // 同节点遭遇
  const foe = G.players.find(q =>
    q.alive && q.id !== p.id && q.mapId === p.mapId && q.mapNodeId === target.id);
  if (foe) {
    if (foe.isHuman) {
      log(`${p.name} 在同一节点撞上了你`, 'hl');
      encounter(foe, p);
      return 'paused';
    }
    if (strengthOf(p) < strengthOf(foe) * 0.6 && Math.random() < 0.5) {
      const lost = dropHalfMaterials(p);
      p.mapNodeId = p.prevNodeId;
      log(`${p.name} 避战，丢下 ${lost.length} 件物资`, '');
      return 'moved';
    }
    pvpBattle(p, foe, map.env, res => {
      const r = resolvePvp(p, foe, res);
      log(`${r.winner.name} 击败 ${r.loser.name}，${r.spoils.length} 件物资易主`, 'hl');
    });
    return p.alive ? 'moved' : 'dead';
  }

  if (target.type === 'exit') {
    extractPlayer(p);
    return 'exit';
  }
  if (target.type === 'monster') {
    const res = runBattle(teamOf(p, 'A', map.env), monsterTeam(G.round));
    if (res.winner === 'A') {
      lootNode(p, target);
    } else {
      p.mapNodeId = p.prevNodeId;
    }
    return p.alive ? 'moved' : 'dead';
  }
  if (target.type !== 'start') lootNode(p, target);
  return 'moved';
}

function aiNodeScore(p, n) {
  let s = Math.random() * 2;
  if (n.type === 'exit') s += 1;
  if (!n.revealed) s += 3;
  if (n.type !== 'start' && n.type !== 'exit' && !n.looted && n.stock && n.stock.length) {
    let v = 0;
    for (const it of n.stock) v += QMAP[it.q].value;
    s += v * 0.7;
  }
  if (n.type === 'monster') s += strengthOf(p) > 60 + G.round * 35 ? 8 : -25;
  return s;
}

/* ---------------- 商店 ---------------- */

function priceFor(p, base) {
  return p.heroId === 'merchant' ? Math.round(base * 0.7) : base;
}

/** 支付只能使用物资点：材料必须由玩家手动出售 */
function payFrom(p, amount) {
  if (p.credit < amount) return false;
  p.credit -= amount;
  return true;
}

function buildShop(round) {
  const pool = SHOP_QUALITY[round] || SHOP_QUALITY[1];
  const equips = [];
  const slots = shuffle(['weapon', 'armor', 'trinket', 'weapon', 'armor', 'trinket']);
  for (let i = 0; i < 3; i++) {
    let q = pickWeighted(pool);
    while (q === 'rainbow') q = pickWeighted(pool);
    const eq = makeEquip(slots[i], q);
    equips.push({ eq, price: equipPrice(eq), soldOut: false });
  }

  const soldiers = shuffle(CLASSES).slice(0, 2).map(cls => {
    const tier = round >= 3 && Math.random() < 0.5 ? 'elite' : 'normal';
    return { cls, tier, price: SOLDIERS[cls][tier].price };
  });

  const upCls = CLASSES[randInt(0, CLASSES.length - 1)];
  return { equips, soldiers, upgrade: { cls: upCls }, round };
}

function showShop(opts) {
  opts = opts || {};
  const next = opts.next || advanceRound;
  if (G.phase === 'over') return;
  if (!G.me || !G.me.alive) { next(); return; }

  G.phase = 'shop';
  G.shopOpts = { next };
  G.shop = buildShop(G.round);
  G.shopLeft = opts.limit || 60;
  G.equipPick = null;

  for (const p of G.players) if (p.alive && !p.isHuman) aiShop(p);

  renderShop();
  if (G.shopTimer) clearInterval(G.shopTimer);
  G.shopTimer = startDeadlineInterval(G.shopLeft, 1000, left => {
    if (G.phase !== 'shop') { clearInterval(G.shopTimer); G.shopTimer = null; return; }
    G.shopLeft = Math.ceil(left);
    const el = $('shopTimer');
    if (el) el.textContent = G.shopLeft + 's';
    if (left <= 0) closeShop();
  });
}

function closeShop() {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
  const opts = G.shopOpts || {};
  G.shopOpts = null;
  hideOverlay();
  if (opts.next) opts.next();
}

/* ---------------- 商店界面 ---------------- */

function budgetOf(p) { return p.credit; }

/* ---------------- 材料补给 ---------------- */

/** 当前轮开放的材料品质，从低到高 */
function matSupplyTiers(round) {
  return MAT_SUPPLY[round] || MAT_SUPPLY[1];
}

/** 当前轮开放的最高材料品质 */
function matSupplyTop(round) {
  const tiers = matSupplyTiers(round);
  return tiers[tiers.length - 1];
}

/** 商店是否售卖该「材料 + 品质」 */
function shopSellsMaterial(name, qKey) {
  return BASE_MATERIALS.includes(name) && matSupplyTiers(G.round).includes(qKey);
}

function buyMaterial(name, qKey) {
  const me = G.me;
  if (!me || !shopSellsMaterial(name, qKey)) return;
  const price = priceFor(me, MAT_PRICE[qKey]);
  if (budgetOf(me) < price) return;
  if (!payFrom(me, price)) return;
  me.materials.push({ n: name, q: qKey });
  log(`购入 ${name}（${QMAP[qKey].name}）-${price} 物资点`);
  renderShop();
  renderSide();
}

/** 配方缺料清单 + 补齐报价；不可补齐时 ok=false */
function fillQuote(p, r) {
  const need = {};
  need[r.main] = 1;
  for (const a of r.aux) need[a] = (need[a] || 0) + 1;

  const miss = [];
  for (const name in need) {
    const lack = need[name] - matCount(p, name);
    if (lack > 0) miss.push({ name, lack });
  }
  if (!miss.length) return null;

  const qu = matSupplyTop(G.round);
  for (const m of miss) {
    if (!BASE_MATERIALS.includes(m.name)) return { ok: false, miss, blocked: m.name };
  }
  const unit = priceFor(p, MAT_PRICE[qu]);
  const total = miss.reduce((s, m) => s + m.lack * unit, 0);
  return { ok: true, miss, qu, unit, total };
}

/** 该配方所有可执行的品质选项（高品质在前） */
function craftOptions(p, r) {
  const auxNeed = {};
  for (const a of r.aux) auxNeed[a] = (auxNeed[a] || 0) + 1;
  const out = [];
  for (let i = QUALITIES.length - 1; i >= 0; i--) {
    const q = QUALITIES[i].key;
    const hasMain = p.materials.some(m => m.n === r.main && m.q === q);
    const miss = [];
    let blocked = false;
    for (const name in auxNeed) {
      const lack = auxNeed[name] - matCount(p, name);
      if (lack <= 0) continue;
      if (!BASE_MATERIALS.includes(name)) { blocked = true; break; }
      miss.push({ name, lack, q: matSupplyTop(G.round) });
    }
    if (blocked) continue;
    if (!hasMain) {
      if (!BASE_MATERIALS.includes(r.main)) continue;
      if (!matSupplyTiers(G.round).includes(q)) continue;
      miss.push({ name: r.main, lack: 1, q });
    }
    const cost = miss.reduce((s, m) => s + m.lack * priceFor(p, MAT_PRICE[m.q]), 0);
    out.push({ q, miss, cost, can: cost <= p.credit });
  }
  return out;
}

/** 取指定材料里品质最低的一件（辅材优先吃低品质，保住高级材料） */
function takeLowestQuality(p, name) {
  let idx = -1;
  for (let i = 0; i < p.materials.length; i++) {
    const m = p.materials[i];
    if (m.n !== name) continue;
    if (idx < 0 || QINDEX[m.q] < QINDEX[p.materials[idx].q]) idx = i;
  }
  if (idx < 0) return null;
  return p.materials.splice(idx, 1)[0];
}

/** 按指定品质合成（必要时先按商店价补齐） */
function craftAt(id, qKey) {
  const me = G.me;
  const r = RECIPES.find(x => x.id === id);
  if (!me || !r) return;
  const opt = craftOptions(me, r).find(o => o.q === qKey);
  if (!opt) return;
  if (opt.cost > 0 && !opt.can) {
    log(`物资点不足：补齐需 ${opt.cost}，当前 ${budgetOf(me)}，差 ${opt.cost - budgetOf(me)}`, '');
    renderShop();
    return;
  }
  if (opt.cost > 0) {
    payFrom(me, opt.cost);
    for (const m of opt.miss) {
      for (let i = 0; i < m.lack; i++) me.materials.push({ n: m.name, q: m.q });
    }
  }
  takeMaterial(me, r.main, qKey);
  for (const a of r.aux) takeLowestQuality(me, a);
  const eq = makeEquip(r.slot, qKey, r.name, r.cls);
  me.equipBag.push(eq);
  log(`合成 <span class="q-${qKey}">${esc(eq.name)}</span>${opt.cost > 0 ? `（补齐 -${opt.cost} 物资点）` : ''}，已放入装备背包`, 'hl');
  renderShop();
  renderSide();
}

function upgradeCost(lv) { return lv === 1 ? 30 : lv === 2 ? 60 : null; }

function addSoldierTo(p, cls, tier) {
  if (!canAddSoldier(p)) return null;
  const s = makeSoldier(cls, tier);
  const lv = p.soldierLevels[cls] || 1;
  const st = soldierStats(cls, tier, lv);
  s.level = lv;
  s.maxHp = st.hp; s.hp = st.hp; s.atk = st.atk; s.def = st.def;
  p.soldiers.push(s);
  return s;
}

function matCount(p, name) {
  let n = 0;
  for (const m of p.materials) if (m.n === name) n++;
  return n;
}

function takeMaterial(p, name, q) {
  const i = p.materials.findIndex(m => m.n === name && (q == null || m.q === q));
  if (i < 0) return null;
  return p.materials.splice(i, 1)[0];
}

/** 配方可行性：返回主材（取最高品质）与成品品质 */
function craftCheck(p, r) {
  const need = {};
  need[r.main] = 1;
  for (const a of r.aux) need[a] = (need[a] || 0) + 1;
  for (const name in need) if (matCount(p, name) < need[name]) return null;
  const mains = p.materials.filter(m => m.n === r.main)
    .sort((a, b) => QINDEX[b.q] - QINDEX[a.q]);
  if (!mains.length) return null;
  return { main: mains[0], quality: mains[0].q };
}

function craftInto(p, r, chk) {
  takeMaterial(p, r.main, chk.quality);
  for (const a of r.aux) takeLowestQuality(p, a);
  const eq = makeEquip(r.slot, chk.quality, r.name, r.cls);
  p.equipBag.push(eq);
  return { eq };
}

/** 按「名称 + 品质」聚合材料清单，按材料表顺序、品质由高到低排序 */
function groupMaterials(list) {
  const map = new Map();
  for (const it of list) {
    const k = it.n + '|' + it.q;
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { n: it.n, q: it.q, count: 1 });
  }
  const orderOf = n => {
    const i = MATERIAL_NAMES.indexOf(n);
    return i < 0 ? 99 : i;
  };
  return [...map.values()].sort((a, b) =>
    orderOf(a.n) - orderOf(b.n) || QINDEX[b.q] - QINDEX[a.q]);
}

/** 品质锁：金 / 红 / 彩 默认锁定 */
function isQualityLocked(qKey) {
  return QINDEX[qKey] >= QINDEX.gold;
}

/** 当前可合成配方会消耗的那件主材实例（只锁主材，不锁辅材） */
function recipeMainMats(p) {
  const set = new Set();
  for (const r of RECIPES) {
    const chk = craftCheck(p, r);
    if (chk) set.add(chk.main);
  }
  return set;
}

/** 实际锁定的材料实例：品质锁 ∪ 配方主材锁，去掉玩家手动解锁的「名称|品质」 */
function lockedMats(p) {
  const set = new Set();
  for (const m of p.materials) if (isQualityLocked(m.q)) set.add(m);
  for (const m of recipeMainMats(p)) set.add(m);
  const un = new Set(p.matUnlocked || []);
  for (const m of [...set]) {
    if (un.has(m.n + '|' + m.q)) set.delete(m);
  }
  return set;
}

/** 点击锁标：解锁该「名称 + 品质」的全部材料 */
function unlockMaterial(name, qKey) {
  const me = G.me;
  if (!me) return;
  const key = name + '|' + qKey;
  me.matUnlocked = me.matUnlocked || [];
  if (!me.matUnlocked.includes(key)) me.matUnlocked.push(key);
  log(`解锁 ${name}（${QMAP[qKey].name}），现在可以出售`);
  renderShop();
  renderSide();
}

function renderShop() {
  if (!G.me || !G.shop) return;
  const me = G.me;
  const budget = budgetOf(me);

  const eqHtml = G.shop.equips.map((it, i) => {
    const price = priceFor(me, it.price);
    const can = !it.soldOut && budget >= price;
    const fit = aptitudeOf(me.cls, it.eq);
    const fitTxt = fit === 'perfect' ? '与你的职业契合，全额加成'
      : fit === 'partial' ? `<span class="apt-part">职业相近，只发挥 60%</span>`
        : `<span class="apt-bad">职业不符，你无法装备</span>`;
    return `<div class="pick-card" style="cursor:default">
      <div class="t q-${it.eq.quality}">${esc(it.eq.name)}</div>
      <div class="tag">${EQUIP_SLOT_NAME[it.eq.slot]} · ${QMAP[it.eq.quality].name}${it.eq.cls ? ' · <span style="color:' + CLASS_COLOR[it.eq.cls] + '">' + it.eq.cls + '</span>' : ''}</div>
      <div class="stat">${fitTxt}</div>
      <div class="d">购入后进入装备背包，可在下方自行穿戴</div>
      <div class="mt"><button class="btn ${can ? 'ok' : ''}" ${can ? '' : 'disabled'}
        onclick="buyEquip(${i})">${it.soldOut ? '已售出' : price + ' 物资点'}</button></div>
    </div>`;
  }).join('') || '<div class="muted">无货</div>';

  const sdHtml = G.shop.soldiers.map((it, i) => {
    const price = priceFor(me, it.price);
    const lv = me.soldierLevels[it.cls] || 1;
    const st = soldierStats(it.cls, it.tier, lv);
    const def = SOLDIERS[it.cls][it.tier];
    const full = !canAddSoldier(me);
    const can = !it.soldOut && !full && budget >= price;
    return `<div class="pick-card" style="cursor:default">
      <div class="t" style="color:${CLASS_COLOR[it.cls]}">${def.name}</div>
      <div class="tag">${it.cls} · ${it.tier === 'elite' ? '精英' : '普通'} · Lv${lv}</div>
      <div class="stat">HP ${st.hp} · ATK ${st.atk} · DEF ${st.def} · 射程 ${def.range}</div>
      <div class="d">克制 <span style="color:${CLASS_COLOR[COUNTER[it.cls]]}">${COUNTER[it.cls]}</span>
        · 被 <span style="color:${CLASS_COLOR[it.cls]}">${Object.keys(COUNTER).find(k => COUNTER[k] === it.cls)}</span> 克制</div>
      <div class="mt"><button class="btn ${can ? 'ok' : ''}" ${can ? '' : 'disabled'}
        onclick="buySoldier(${i})">${it.soldOut ? '已售出' : full ? '部队已满' : price + ' 物资点'}</button></div>
    </div>`;
  }).join('') || '<div class="muted">无货</div>';

  const up = G.shop.upgrade;
  const lv = me.soldierLevels[up.cls] || 1;
  const cost = upgradeCost(lv);
  const upPrice = cost == null ? null : priceFor(me, cost);
  const upCan = !up.done && upPrice != null && budget >= upPrice;
  const upHtml = `<div class="pick-card" style="cursor:default">
    <div class="t" style="color:${CLASS_COLOR[up.cls]}">${up.cls} 兵种</div>
    <div class="tag">当前 Lv${lv}${lv >= 3 ? ' · 已满级' : ''}</div>
    <div class="stat">该兵种全部小兵 HP/ATK/DEF 每级 +25%</div>
    <div class="d">新雇佣与已有小兵同时生效</div>
    <div class="mt"><button class="btn ${upCan ? 'ok' : ''}" ${upCan ? '' : 'disabled'}
      onclick="buyUpgrade()">${up.done ? '已升级' : upPrice == null ? '已满级' : upPrice + ' 物资点'}</button></div>
  </div>`;

  const tiers = matSupplyTiers(G.round);
  const matBtns = BASE_MATERIALS.map(name => {
    const btns = tiers.map(qKey => {
      const price = priceFor(me, MAT_PRICE[qKey]);
      const can = budget >= price;
      return `<button class="btn mat-btn" ${can ? '' : 'disabled'}
        onclick="buyMaterial('${name}','${qKey}')"
        title="买入 1 件 ${name}（${QMAP[qKey].name}）"><span class="q-${qKey}">${name}</span> ${price}</button>`;
    }).join('');
    return `<div class="mat-row">${btns}</div>`;
  }).join('');
  const matHtml = `<div class="pick-card" style="cursor:default">
    <div class="t">基础材料</div>
    <div class="tag">第 ${G.round} 轮开放 ${tiers.map(q => QMAP[q].name).join(' / ')}</div>
    <div class="d">魔晶 / 秘银不售卖，只能搜刮</div>
    <div class="mat-supply">${matBtns}</div>
  </div>`;

  const recipeRows = RECIPES.map(r => ({ r, opts: craftOptions(me, r) }))
    .sort((a, b) => b.opts.length - a.opts.length);
  const recipes = recipeRows.map(({ r, opts }) => {
    const clsTag = r.cls ? ` <span style="color:${CLASS_COLOR[r.cls]}">${r.cls}</span>` : '';
    const need = {};
    need[r.main] = 1;
    for (const a of r.aux) need[a] = (need[a] || 0) + 1;
    const matTxt = Object.keys(need).map(n => {
      const have = matCount(me, n);
      const ok = have >= need[n];
      return `<span class="${ok ? '' : 'miss'}">${n} ${have}/${need[n]}</span>`;
    }).join(' + ');
    const btns = opts.length
      ? opts.map(o => {
        const cls = o.cost > 0 ? (o.can ? 'warn' : '') : 'ok';
        const tip = o.cost > 0
          ? `补齐 ${o.miss.reduce((s, m) => s + m.lack, 0)} 件后合成，共 ${o.cost} 物资点`
          : '直接合成';
        return `<button class="btn q-btn ${cls}" ${o.cost > 0 && !o.can ? 'disabled' : ''}
          onclick="craftAt('${r.id}','${o.q}')" title="${tip}"><span class="q-${o.q}">${QMAP[o.q].name}</span>${o.cost > 0 ? ' ' + o.cost : ''}</button>`;
      }).join('')
      : `<button class="btn" disabled>缺料</button>`;
    return `<div class="recipe">
      <span class="rname">${r.name}${clsTag}</span>
      <span class="rmat">${matTxt}</span>
      <span class="rmat" style="flex:0 0 44px">${EQUIP_SLOT_NAME[r.slot]}</span>
      <span class="recipe-q">${btns}</span>
    </div>`;
  }).join('');

  const lockedSet = lockedMats(me);
  const freeMats = me.materials.filter(m => !lockedSet.has(m));
  const freeGain = freeMats.reduce((s, m) => s + Math.max(1, Math.round(QMAP[m.q].value * 0.7)), 0);
  const sell = groupMaterials(me.materials).map(g => {
    const gain = Math.max(1, Math.round(QMAP[g.q].value * 0.7));
    const lockCount = me.materials.filter(m => m.n === g.n && m.q === g.q && lockedSet.has(m)).length;
    const free = g.count - lockCount;
    const attr = free > 0
      ? `style="cursor:pointer" onclick="sellMaterialByName('${g.n}','${g.q}')" title="出售 1 件，回收 ${gain} 物资点"`
      : `title="金色及以上默认锁定／配方主材锁定，点「锁」标解锁后可出售"`;
    const lockMark = lockCount > 0
      ? `<span class="lock" onclick="event.stopPropagation();unlockMaterial('${g.n}','${g.q}')" title="点击解锁，解锁后可出售">锁${lockCount}</span>`
      : '';
    return `<span class="chip q-${g.q}${free > 0 ? '' : ' locked'}" ${attr}>${g.n}·${QMAP[g.q].name}<span class="c">×${g.count}</span>${lockMark}</span>`;
  }).join(' ') || '<span class="muted">背包空空</span>';

  showOverlay(`
    <h2>第 ${G.round} 轮 · 战地补给
      <span class="muted" style="font-size:14px">（<span id="shopTimer">${G.shopLeft}s</span>）</span></h2>
    <div class="sub">可用物资点 <b>${budget}</b>　·　材料不会自动抵扣，需在下方先出售　·　合成时点配方右侧的品质按钮，缺料可按商店价补齐</div>
    <div class="shop-grid">
      <div><div class="shop-tag">装备 · 3 件</div>${eqHtml}</div>
      <div><div class="shop-tag">雇佣 · 2 类</div>${sdHtml}</div>
      <div><div class="shop-tag">兵种升级</div>${upHtml}</div>
      <div><div class="shop-tag">材料补给</div>${matHtml}</div>
    </div>
    ${renderEquipPanel(me)}
    <div class="mt">
      <div class="sell-head">
        <div class="shop-tag">出售物资 · 7 折回收（点一次卖 1 件）　·　金色及以上默认锁定，配方主材也锁定；点「锁」标解锁</div>
        <button class="btn sell-all ${freeMats.length ? 'warn' : ''}" ${freeMats.length ? '' : 'disabled'}
          onclick="sellAllFreeMaterials()"
          title="一键出售全部未锁定材料，共 ${freeMats.length} 件">${freeMats.length ? `一键出售 ${freeMats.length} 件 · ${freeGain}` : '无可售物资'}</button>
      </div>
      <div class="chips">${sell}</div>
    </div>
    <div class="mt">
      <div class="shop-tag">合成配方 · 消耗 1 主材 + 2 辅材（辅材优先吃低品质）· 点品质按钮决定成品品质，缺料可按商店价补齐</div>
      <div class="recipe-list">${recipes}</div>
    </div>
    <div class="mt center">
      <button class="btn ok" onclick="closeShop()">完成补给</button>
    </div>
  `);
}

/** 装备加成摘要，如「ATK +20 · HP +60」；传 ownerCls 时按契合度打折 */
function equipBonusText(eq, ownerCls) {
  const b = equipBonus([eq], ownerCls);
  const parts = [];
  if (b.atk) parts.push('ATK +' + b.atk);
  if (b.hp) parts.push('HP +' + b.hp);
  if (b.def) parts.push('DEF +' + b.def);
  return parts.join(' · ') || '无加成';
}

/** 商店内装备背包面板：英雄 3 槽 / 小兵各 1 槽 / 背包列表 */
function renderEquipPanel(me) {
  const pick = G.equipPick ? findBagItem(me, G.equipPick) : null;
  const armed = pick ? ' armed' : '';
  const slotNames = ['weapon', 'armor', 'trinket'];

  // 选中件对某个槽位的状态：bad（不可装）/ part（60%）
  const aptCls = (cls, slot) => {
    if (!pick) return '';
    if (slot && pick.slot !== slot) return ' bad';
    const a = aptitudeOf(cls, pick);
    return a === 'none' ? ' bad' : a === 'partial' ? ' part' : '';
  };
  const aptTip = (cls, slot) => {
    if (!pick) return '放入选中的装备';
    if (slot && pick.slot !== slot) return '槽位不符';
    const a = aptitudeOf(cls, pick);
    return a === 'none' ? '职业不符，无法装备'
      : a === 'partial' ? '职业相近，只发挥 60% 性能' : '契合，全额加成';
  };

  const heroTargets = me.equips.map((e, i) => {
    const inner = `<div class="who">英雄 · ${EQUIP_SLOT_NAME[slotNames[i]]}</div>
      <div class="nm ${e ? 'q-' + e.quality : 'muted'}">${e ? esc(e.name) : '空'}</div>`;
    const act = pick ? ` onclick="equipHeroSlot(${i})" title="${aptTip(me.cls, slotNames[i])}"`
      : (e ? ` onclick="unequipSlot('hero',${i})" title="点击卸下"` : '');
    return `<div class="eq-target${armed}${e ? ' filled' : ''}${aptCls(me.cls, slotNames[i])}"${act}>${inner}</div>`;
  }).join('');

  const soldierTargets = me.soldiers.map((s, i) => {
    const e = s.equip;
    const inner = `<div class="who">${esc(s.name)} Lv${s.level}</div>
      <div class="nm ${e ? 'q-' + e.quality : 'muted'}">${e ? esc(e.name) : '空'}</div>`;
    const act = pick ? ` onclick="equipSoldierSlot(${i})" title="${pick.slot === 'trinket' ? '小兵不能装备饰品' : aptTip(s.cls)}"`
      : (e ? ` onclick="unequipSlot('soldier',${i})" title="点击卸下"` : '');
    const bad = pick && pick.slot === 'trinket' ? ' bad' : aptCls(s.cls);
    return `<div class="eq-target${armed}${e ? ' filled' : ''}${bad}"${act}>${inner}</div>`;
  }).join('') || '<div class="muted">无小兵</div>';

  const bag = me.equipBag.map(e => {
    const sel = G.equipPick === e.uid ? ' sel' : '';
    const gain = Math.round(equipPrice(e) * 0.5);
    const clsTag = e.cls ? ` · <span style="color:${CLASS_COLOR[e.cls]}">${e.cls}</span>` : '';
    const fit = aptitudeOf(me.cls, e);
    const fitTag = !e.cls ? ''
      : fit === 'perfect' ? ''
        : fit === 'partial' ? ' · <span class="apt-part">契合 60%</span>'
          : ' · <span class="apt-bad">职业不符</span>';
    return `<div class="eq-item${sel}" onclick="pickEquipBag('${e.uid}')" title="点击选中">
      <span class="nm q-${e.quality}">${esc(e.name)}</span>
      <span class="tag">${EQUIP_SLOT_NAME[e.slot]} · ${QMAP[e.quality].name}${clsTag}${fitTag}</span>
      <span class="bonus">${equipBonusText(e, me.cls)}</span>
      <button class="btn" onclick="event.stopPropagation();sellEquipFromBag('${e.uid}')">出售 ${gain}</button>
    </div>`;
  }).join('') || '<div class="muted">背包内暂无装备</div>';

  return `<div class="mt">
    <div class="shop-tag">装备背包 · 先点背包装备，再点英雄槽或小兵；点已穿戴的槽位可卸下　·　同职业全额，近战组（重装/近战/骑兵）与远程组（远程/法术）内部 60%，跨组无法装备</div>
    <div class="eq-manage">
      <div>
        <div class="eq-group">英雄（3 槽）</div><div class="eq-row">${heroTargets}</div>
        <div class="eq-group">小兵（每人 1 槽，仅武器 / 护甲）</div><div class="eq-row">${soldierTargets}</div>
      </div>
      <div class="eq-bag"><div class="eq-group">背包（${me.equipBag.length}）</div>${bag}</div>
    </div>
  </div>`;
}

/* ---------------- 商店交互 ---------------- */

function buyEquip(i) {
  const me = G.me, it = G.shop && G.shop.equips[i];
  if (!me || !it || it.soldOut) return;
  const price = priceFor(me, it.price);
  if (budgetOf(me) < price) return;
  if (!payFrom(me, price)) return;
  it.soldOut = true;

  me.equipBag.push(it.eq);
  log(`购入 <span class="q-${it.eq.quality}">${it.eq.name}</span>（已放入装备背包）`, 'hl');
  renderShop();
  renderSide();
}

function buySoldier(i) {
  const me = G.me, it = G.shop && G.shop.soldiers[i];
  if (!me || !it || it.soldOut) return;
  if (!canAddSoldier(me)) return;
  const price = priceFor(me, it.price);
  if (budgetOf(me) < price) return;
  if (!payFrom(me, price)) return;
  it.soldOut = true;
  const s = addSoldierTo(me, it.cls, it.tier);
  if (s) log(`雇佣 <span style="color:${CLASS_COLOR[it.cls]}">${s.name}</span>`, 'hl');
  renderShop();
  renderSide();
}

function buyUpgrade() {
  const me = G.me;
  const up = G.shop && G.shop.upgrade;
  if (!me || !up || up.done) return;
  const lv = me.soldierLevels[up.cls] || 1;
  const cost = upgradeCost(lv);
  if (cost == null) return;
  const price = priceFor(me, cost);
  if (budgetOf(me) < price) return;
  if (!payFrom(me, price)) return;
  up.done = true;

  me.soldierLevels[up.cls] = lv + 1;
  for (const s of me.soldiers) {
    if (s.cls !== up.cls) continue;
    const st = soldierStats(s.cls, s.tier, lv + 1);
    s.level = lv + 1;
    s.maxHp = st.hp; s.hp = st.hp; s.atk = st.atk; s.def = st.def;
  }
  log(`<span style="color:${CLASS_COLOR[up.cls]}">${up.cls}</span> 兵种升至 Lv${lv + 1}`, 'hl');
  renderShop();
  renderSide();
}

/** 出售指定「名称 + 品质」的一件材料 */
function sellMaterialByName(name, qKey) {
  const me = G.me;
  if (!me) return;
  const lockedSet = lockedMats(me);
  const i = me.materials.findIndex(m => m.n === name && m.q === qKey && !lockedSet.has(m));
  if (i < 0) return;
  const item = me.materials.splice(i, 1)[0];
  const gain = Math.max(1, Math.round(QMAP[qKey].value * 0.7));
  me.credit += gain;
  log(`出售 ${item.n}（${QMAP[qKey].name}）+${gain} 物资点`);
  renderShop();
  renderSide();
}

/** 一键出售：卖光全部非锁定材料 */
function sellAllFreeMaterials() {
  const me = G.me;
  if (!me) return;
  const lockedSet = lockedMats(me);
  const free = me.materials.filter(m => !lockedSet.has(m));
  if (!free.length) return;
  let gain = 0;
  for (const m of free) gain += Math.max(1, Math.round(QMAP[m.q].value * 0.7));
  const freeSet = new Set(free);
  me.materials = me.materials.filter(m => !freeSet.has(m));
  me.credit += gain;
  log(`一键出售 ${free.length} 件物资 +${gain} 物资点`, 'hl');
  renderShop();
  renderSide();
}

/* ---------------- 装备背包交互 ---------------- */

function findBagItem(p, uid) {
  return p.equipBag.find(e => e.uid === uid) || null;
}

/** 选中 / 取消选中背包内的一件装备 */
function pickEquipBag(uid) {
  G.equipPick = G.equipPick === uid ? null : uid;
  renderShop();
}

/** 把选中的背包装备放入英雄对应槽位，旧件回包 */
function equipHeroSlot(idx) {
  const me = G.me;
  const eq = me && G.equipPick ? findBagItem(me, G.equipPick) : null;
  if (!me || !eq) return;
  const slotNames = ['weapon', 'armor', 'trinket'];
  if (eq.slot !== slotNames[idx]) {
    log(`槽位不符：<span class="q-${eq.quality}">${eq.name}</span> 不能放进${EQUIP_SLOT_NAME[slotNames[idx]]}槽`);
    return;
  }
  const apt = aptitudeOf(me.cls, eq);
  if (apt === 'none') {
    log(`职业不符：<span class="q-${eq.quality}">${eq.name}</span>（${eq.cls}）无法给 ${me.cls} 使用`);
    renderShop();
    return;
  }
  me.equipBag.splice(me.equipBag.indexOf(eq), 1);
  const old = me.equips[idx];
  me.equips[idx] = eq;
  if (old) me.equipBag.push(old);
  G.equipPick = null;
  log(`英雄装备 <span class="q-${eq.quality}">${eq.name}</span>${old ? `，换下 ${old.name}` : ''}${apt === 'partial' ? '（职业相近，契合 60%）' : ''}`, 'hl');
  renderShop();
  renderSide();
}

/** 把选中的背包装备放入某名小兵（仅武器 / 护甲） */
function equipSoldierSlot(i) {
  const me = G.me;
  const s = me && me.soldiers[i];
  const eq = me && G.equipPick ? findBagItem(me, G.equipPick) : null;
  if (!s || !eq) return;
  if (eq.slot === 'trinket') {
    log('小兵不能装备饰品');
    return;
  }
  const apt = aptitudeOf(s.cls, eq);
  if (apt === 'none') {
    log(`职业不符：<span class="q-${eq.quality}">${eq.name}</span>（${eq.cls}）无法给 ${s.cls} 小兵使用`);
    renderShop();
    return;
  }
  me.equipBag.splice(me.equipBag.indexOf(eq), 1);
  const old = s.equip;
  s.equip = eq;
  if (old) me.equipBag.push(old);
  G.equipPick = null;
  log(`${s.name} 装备 <span class="q-${eq.quality}">${eq.name}</span>${old ? `，换下 ${old.name}` : ''}${apt === 'partial' ? '（职业相近，契合 60%）' : ''}`, 'hl');
  renderShop();
  renderSide();
}

/** 卸下英雄或小兵的装备，退回背包 */
function unequipSlot(kind, idx) {
  const me = G.me;
  if (!me) return;
  if (kind === 'hero') {
    const eq = me.equips[idx];
    if (!eq) return;
    me.equips[idx] = null;
    me.equipBag.push(eq);
    log(`英雄卸下 <span class="q-${eq.quality}">${eq.name}</span>（回到装备背包）`);
  } else {
    const s = me.soldiers[idx];
    if (!s || !s.equip) return;
    const eq = s.equip;
    s.equip = null;
    me.equipBag.push(eq);
    log(`${s.name} 卸下 <span class="q-${eq.quality}">${eq.name}</span>（回到装备背包）`);
  }
  G.equipPick = null;
  renderShop();
  renderSide();
}

/** 出售背包内的一件装备（5 折回收） */
function sellEquipFromBag(uid) {
  const me = G.me;
  const eq = me ? findBagItem(me, uid) : null;
  if (!me || !eq) return;
  const gain = Math.round(equipPrice(eq) * 0.5);
  me.equipBag.splice(me.equipBag.indexOf(eq), 1);
  me.credit += gain;
  if (G.equipPick === uid) G.equipPick = null;
  log(`出售 <span class="q-${eq.quality}">${eq.name}</span> +${gain} 物资点`);
  renderShop();
  renderSide();
}

/** AI 凑钱：按品质升序卖材料（跳过配方主材），直到物资点够用 */
function aiEnsureCredit(p, need) {
  if (p.credit >= need) return true;
  const mains = recipeMainMats(p);
  const pool = p.materials.filter(m => !mains.has(m))
    .sort((a, b) => QMAP[a.q].value - QMAP[b.q].value);
  let guard = 0;
  while (p.credit < need && pool.length && guard++ < 60) {
    const item = pool.shift();
    const i = p.materials.indexOf(item);
    if (i < 0) continue;
    p.materials.splice(i, 1);
    p.credit += Math.max(1, Math.round(QMAP[item.q].value * 0.7));
  }
  return p.credit >= need;
}

/** AI 补给：补兵 > 升级 > 买装备 > 合成（用自己的一份货源） */
function aiShop(p) {
  if (!p.alive) return;
  const shop = buildShop(G.round);

  let guard = 0;
  while (canAddSoldier(p) && guard++ < 3) {
    const it = shop.soldiers.find(s => !s.soldOut);
    if (!it) break;
    const price = priceFor(p, it.price);
    if (!aiEnsureCredit(p, price)) break;
    if (!payFrom(p, price)) break;
    it.soldOut = true;
    addSoldierTo(p, it.cls, it.tier);
  }

  const up = shop.upgrade;
  const lv = p.soldierLevels[up.cls] || 1;
  const cost = upgradeCost(lv);
  if (cost != null) {
    const price = priceFor(p, cost);
    if (aiEnsureCredit(p, price) && payFrom(p, price)) {
      p.soldierLevels[up.cls] = lv + 1;
      for (const s of p.soldiers) {
        if (s.cls !== up.cls) continue;
        const st = soldierStats(s.cls, s.tier, lv + 1);
        s.level = lv + 1;
        s.maxHp = st.hp; s.hp = st.hp; s.atk = st.atk; s.def = st.def;
      }
    }
  }

  for (const it of shop.equips) {
    const price = priceFor(p, it.price);
    const fit = aptitudeOf(p.cls, it.eq) !== 'none';
    const idx = EQUIP_SLOT_INDEX[it.eq.slot];
    const cur = p.equips[idx];
    const upgrade = fit && (!cur || equipScoreFor(p.cls, it.eq) > equipScoreFor(p.cls, cur));
    const forSoldier = it.eq.slot !== 'trinket' && p.soldiers.some(s => !s.equip && aptitudeOf(s.cls, it.eq) !== 'none');
    if (!upgrade && !forSoldier) continue;
    if (!aiEnsureCredit(p, price)) continue;
    if (!payFrom(p, price)) continue;
    p.equipBag.push(it.eq);
  }

  // 先用商店材料补齐缺料再合成（留 15 点余量，避免把钱花光）
  for (let guard2 = 0; guard2 < 3; guard2++) {
    let filled = false;
    for (const r of RECIPES) {
      if (craftCheck(p, r)) continue;
      const q = fillQuote(p, r);
      if (!q || !q.ok) continue;
      if (p.credit < q.total + 15) continue;
      if (!payFrom(p, q.total)) continue;
      for (const m of q.miss) {
        for (let i = 0; i < m.lack; i++) p.materials.push({ n: m.name, q: q.qu });
      }
      const chk = craftCheck(p, r);
      if (chk) { craftInto(p, r, chk); filled = true; }
      break;
    }
    if (!filled) break;
  }

  for (const r of RECIPES) {
    const chk = craftCheck(p, r);
    if (chk) { craftInto(p, r, chk); break; }
  }

  aiEquipBag(p);
}

/** AI 评分：职业不符记 -1，契合 60% 扣 0.5 */
function equipScoreFor(cls, eq) {
  if (!eq) return -1;
  const a = aptitudeOf(cls, eq);
  if (a === 'none') return -1;
  return QINDEX[eq.quality] + (a === 'perfect' ? 0 : -0.5);
}

/** AI 把背包装备穿上：英雄优先，其次给小兵，多余 5 折出售 */
function aiEquipBag(p) {
  let guard = 0;
  while (p.equipBag.length && guard++ < 12) {
    const eq = p.equipBag.shift();
    const idx = EQUIP_SLOT_INDEX[eq.slot];
    const cur = p.equips[idx];
    const score = equipScoreFor(p.cls, eq);
    if (score >= 0 && score > equipScoreFor(p.cls, cur)) {
      if (cur) p.equipBag.push(cur);
      p.equips[idx] = eq;
      continue;
    }
    if (eq.slot !== 'trinket') {
      const target = p.soldiers.find(s => !s.equip && aptitudeOf(s.cls, eq) !== 'none');
      if (target) { target.equip = eq; continue; }
    }
    p.credit += Math.round(equipPrice(eq) * 0.5);
  }
}

/* ---------------- 决胜淘汰赛 ---------------- */

function startTournament() {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
  const list = alivePlayers();
  if (!list.length) { settle(null); return; }
  G.phase = 'tour';
  G.tour = { stage: 0, alive: shuffle(list), pairs: [], idx: 0, survivors: [], bye: null, pending: false };
  log('—— 决胜图 · 抽签淘汰赛 ——', 'hl');
  tournamentStage();
}

function tournamentStage() {
  const list = G.tour.alive;
  if (list.length <= 1) { settle(list[0] || null); return; }

  G.tour.stage++;
  const arr = list.slice();
  G.tour.bye = arr.length % 2 === 1 ? arr.pop() : null;
  G.tour.pairs = [];
  for (let i = 0; i < arr.length; i += 2) G.tour.pairs.push([arr[i], arr[i + 1]]);
  G.tour.idx = 0;
  G.tour.survivors = G.tour.bye ? [G.tour.bye] : [];

  if (G.tour.bye) log(`${G.tour.bye.name} 抽到轮空，直接晋级`, 'hl');
  const txt = G.tour.pairs.map(([a, b]) => `${a.name} vs ${b.name}`).join('　·　');
  log(`第 ${G.tour.stage} 轮对阵：${txt}`, '');

  G.phase = 'tour';
  render();
  if (G.me && G.me.alive && G.tour.stage > 1) {
    showShop({ limit: 45, next: nextTournamentMatch });
  } else {
    nextTournamentMatch();
  }
}

function nextTournamentMatch() {
  if (!G.tour || G.tour.pending) return;
  if (G.tour.idx >= G.tour.pairs.length) {
    G.tour.alive = G.tour.survivors.slice();
    tournamentStage();
    return;
  }

  const [a, b] = G.tour.pairs[G.tour.idx++];
  if (!a.alive) { G.tour.survivors.push(b); nextTournamentMatch(); return; }
  if (!b.alive) { G.tour.survivors.push(a); nextTournamentMatch(); return; }

  G.phase = 'tour';
  log(`淘汰赛 · ${a.name} VS ${b.name}`, 'hl');
  pvpBattle(a, b, '决胜场', res => {
    if (!G.tour) return;
    G.phase = 'tour';
    const r = resolvePvp(a, b, res);
    G.tour.survivors.push(r.winner);
    log(`${r.winner.name} 淘汰 ${r.loser.name}（+${r.spoils.length} 件物资）`, 'hl');
    render();

    if (r.loser.isHuman) {
      G.tour.pending = true;
      const others = alivePlayers().map(p => p.name).join('、') || '无';
      showOverlay(`
        <h2 class="result-lose">你已出局</h2>
        <div class="sub">决胜场止步第 ${G.tour.stage} 轮，身家 ${playerValue(r.loser)}。剩余对手：${esc(others)}</div>
        <div class="mt center">
          <button class="btn" onclick="spectateTournament()">观战剩余比赛</button>
          <button class="btn ok" onclick="startGame()">开下一局</button>
        </div>`);
      return;
    }
    nextTournamentMatch();
  });
}

function spectateTournament() {
  hideOverlay();
  if (!G.tour) return;
  G.tour.pending = false;
  nextTournamentMatch();
}

/* ---------------- 结算 ---------------- */

function settle(champion) {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
  G.phase = 'over';
  G.champion = champion;
  const me = G.me;
  const win = !!(champion && me && champion.id === me.id);

  const rows = G.players.slice()
    .sort((a, b) => playerValue(b) - playerValue(a))
    .map((p, i) => `<div class="pick-card" style="cursor:default">
      <div class="t">${i + 1}. ${p.isHuman ? '你 · ' : ''}${p.name}
        ${champion && champion.id === p.id ? '<span class="badge" style="color:var(--gold)">冠军</span>' : ''}</div>
      <div class="tag">${p.cls} · ${p.alive ? '存活' : '已出局'}</div>
      <div class="stat">物资 ${p.materials.length} 件 · 装备 ${p.equips.filter(Boolean).length} 件 · 小兵 ${p.soldiers.length} 人</div>
      <div class="d">身家 ${playerValue(p)}</div>
    </div>`).join('');

  log(champion ? `${champion.name} 成为最后的幸存者` : '本局无人存活', 'hl');
  showOverlay(`
    <h2 class="${win ? 'result-win' : 'result-lose'} result-big">${win ? '你赢了' : champion ? '本局结束' : '同归于尽'}</h2>
    <div class="sub">${champion ? `${esc(champion.name)} 笑到最后` : '场上已无人生还'}　·　你的身家 ${me ? playerValue(me) : 0}</div>
    <div class="card-grid">${rows}</div>
    <div class="mt center"><button class="btn ok" onclick="startGame()">开下一局</button></div>`);
  render();
}

/* ---------------- 入口 ---------------- */

function bindEvents() {
  mapCanvas.addEventListener('pointerdown', onMapPointerDown);
  mapCanvas.addEventListener('pointermove', onMapPointerMove);
  mapCanvas.addEventListener('pointerup', onMapPointerUp);
  mapCanvas.addEventListener('pointercancel', onMapPointerUp);
}

function init() {
  bindEvents();
  startGame();
  window.addEventListener('resize', syncMapFxCanvas);
  document.addEventListener('visibilitychange', onVisibilityChange);
  syncMapFxCanvas();
  // 出口呼吸只刷新透明特效层；页面隐藏时暂停动画定时器。
  startMapFxLoop();
}

init();

