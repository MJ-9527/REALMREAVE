'use strict';

/* ============================================================
   主控：阶段机 · 探索 · 战斗 · 商店 · 淘汰赛
   ============================================================ */

const $ = id => document.getElementById(id);
const mapCanvas = $('mapCanvas');
const mctx = mapCanvas.getContext('2d');

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
  pendingFoe: null
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function log(text, cls) {
  G.logs.push({ t: text, cls: cls || '' });
  if (G.logs.length > 80) G.logs.shift();
  renderSide();
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
  const envCount = Math.random() < 0.5 ? 2 : 3;
  const envs = shuffle(ENVS).slice(0, envCount);
  const list = envs.slice();
  while (list.length < 3) list.push(envs[randInt(0, envs.length - 1)]);
  G.maps = list.slice(0, 3).map(e => generateMap(e));
  G.avail = [0, 1, 2];
}

function startGame() {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
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
        <div class="d">核心区永不揭示，高级物资只在中核。第 ${G.round} 轮选择后本轮不可换图。</div>
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

function startRound() {
  for (const m of G.maps) refreshMapStock(m);
  for (const p of G.players) {
    if (!p.alive) { p.mapNodeId = null; continue; }
    if (p.mapId == null) p.mapId = G.me.mapId;
    const map = G.maps[p.mapId];
    p.mapNodeId = map.startId;
    p.prevNodeId = map.startId;
    p.ap = p.apMax;
    p.escapedThisRound = false;
    revealAround(map, map.startId);
  }
  updateHighlight();
  G.phase = 'explore';
  hideOverlay();
  log(`—— 第 ${G.round} 轮开始 ——`, 'hl');
  log(`你进入 ${G.maps[G.me.mapId].env}，行动点 ${G.me.ap}/${G.me.apMax}`);
  render();
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

function render() {
  renderTop();
  renderSide();
  renderActionbar();

  if (!G.me || G.me.mapId == null) return;
  const map = G.maps[G.me.mapId];
  if (!map) return;
  drawMap(mctx, map, G.players, {
    mapIndex: G.me.mapId,
    movableIds: movableIds(),
    highlightIds: G.highlight,
    activeNodeId: G.me.mapNodeId,
    cloakActive: cloakActive
  });
}

function renderTop() {
  $('phaseInfo').textContent = phaseLabel();
  const map = (G.me && G.me.mapId != null) ? G.maps[G.me.mapId] : null;
  const env = map ? `<span>环境 <b style="color:${ENV_COLOR[map.env]}">${map.env}</b></span>` : '';
  $('hud').innerHTML =
    `<span>第 <b>${G.round}</b> 轮</span>${env}` +
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

function renderSide() {
  const side = $('side');
  if (!G.me) {
    side.innerHTML = `<div class="block"><h3>状态</h3><div class="muted">尚未开局</div></div>`;
    return;
  }
  const p = G.me;

  const cnt = {};
  for (const it of p.materials) cnt[it.q] = (cnt[it.q] || 0) + 1;
  const chips = QUALITIES.slice().reverse()
    .filter(q => cnt[q.key])
    .map(q => `<span class="chip q-${q.key}">${q.name}<span class="c">${cnt[q.key]}</span></span>`)
    .join('') || `<span class="muted">背包空空</span>`;

  const slotNames = ['weapon', 'armor', 'trinket'];
  const slots = p.equips.map((e, i) => {
    if (!e) return `<div class="slot">${EQUIP_SLOT_NAME[slotNames[i]]}<div class="stype">空</div></div>`;
    return `<div class="slot filled"><div class="sname q-${e.quality}">${e.name}</div>
      <div class="stype">${EQUIP_SLOT_NAME[e.slot]} · ${QMAP[e.quality].name}</div></div>`;
  }).join('');

  const squad = p.soldiers.length
    ? p.soldiers.map(s => `<div class="unit-tile">
        <div class="nm" style="color:${CLASS_COLOR[s.cls]}">${s.name}</div>
        <div class="lv">${s.cls}·Lv${p.soldierLevels[s.cls]}</div>
      </div>`).join('')
    : `<div class="unit-tile empty">无兵</div>`;

  const logs = G.logs.slice(-14).map(l => `<div class="${l.cls}">${l.t}</div>`).join('');

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
    <div class="block">
      <h3>背包（${p.materials.length}）</h3>
      <div class="chips">${chips}</div>
    </div>
    <div class="block">
      <h3>装备</h3>
      <div class="slots">${slots}</div>
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

function renderActionbar() {
  const bar = $('actionbar');
  if (G.phase === 'explore' && G.me && G.me.alive && G.me.mapNodeId != null) {
    bar.innerHTML = `
      <span class="hint">点击青色圈出的相邻节点移动，每步 1 AP。AP 归零将就地强制结算，物资减半。</span>
      <span class="spacer"></span>
      <button class="btn" onclick="showRivals()">查看对手</button>
      <button class="btn warn" onclick="forceSettle()">就地结算</button>`;
    return;
  }
  if (G.phase === 'explore') {
    bar.innerHTML = `<span class="hint">你已离场，等待本轮其他人生还…</span>
      <span class="spacer"></span><button class="btn" onclick="showRivals()">查看对手</button>`;
    return;
  }
  bar.innerHTML = '';
}

/* ---------------- 移动与搜刮 ---------------- */

function movableIds() {
  if (G.phase !== 'explore') return [];
  if (!G.me || !G.me.alive || G.me.mapNodeId == null || G.me.ap <= 0) return [];
  const n = G.maps[G.me.mapId].byId[G.me.mapNodeId];
  return n ? n.neighbors.slice() : [];
}

function onMapClick(e) {
  if (G.phase !== 'explore' || !G.me || !G.me.alive || G.me.mapNodeId == null) return;
  const r = mapCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (mapCanvas.width / r.width);
  const my = (e.clientY - r.top) * (mapCanvas.height / r.height);
  const map = G.maps[G.me.mapId];
  let hit = null, bestD = 28 * 28;
  for (const n of map.nodes) {
    const d = (n.x - mx) * (n.x - mx) + (n.y - my) * (n.y - my);
    if (d < bestD) { bestD = d; hit = n; }
  }
  if (!hit) return;
  if (!movableIds().includes(hit.id)) return;
  moveTo(hit.id);
}

function moveTo(nodeId) {
  const me = G.me;
  me.prevNodeId = me.mapNodeId;
  me.mapNodeId = nodeId;
  me.ap = Math.max(0, me.ap - 1);
  revealAround(G.maps[me.mapId], nodeId);
  render();

  const foes = G.players.filter(p =>
    p.alive && p.id !== me.id && p.mapId === me.mapId && p.mapNodeId === nodeId);
  if (foes.length) { encounter(me, foes[0]); return; }

  resolveNode(me, G.maps[me.mapId].byId[nodeId]);
}

function resolveNode(p, node) {
  if (node.type === 'exit') {
    if (p.isHuman) log('抵达出口，安全撤离：物资全额保留', 'hl');
    extractPlayer(p);
    return;
  }
  if (node.type === 'start') { afterAction(); return; }
  if (node.type === 'monster') { fightMonster(p, node); return; }
  lootNode(p, node);
  afterAction();
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
      if (res.sold) log(`掉落 <span class="q-${res.eq.quality}">${res.eq.name}</span>（同类已有更好的，折价回收 +${res.gain}）`);
      else log(`掉落装备 <span class="q-${res.eq.quality}">${res.eq.name}</span>`, 'hl');
    }
  }
  updateHighlight();
}

const EQUIP_SLOT_INDEX = { weapon: 0, armor: 1, trinket: 2 };

/** 到手装备：空槽直接装，更好则替换，否则折价回收 */
function grantEquip(p, qKey) {
  const slot = ['weapon', 'armor', 'trinket'][randInt(0, 2)];
  const idx = EQUIP_SLOT_INDEX[slot];
  const eq = makeEquip(slot, qKey);
  const cur = p.equips[idx];

  if (!cur) { p.equips[idx] = eq; return { eq, sold: false }; }
  if (QINDEX[eq.quality] > QINDEX[cur.quality]) {
    p.equips[idx] = eq;
    const gain = Math.round(equipPrice(cur) * 0.5);
    p.credit += gain;
    return { eq, sold: false, replaced: cur, gain };
  }
  const gain = Math.round(equipPrice(eq) * 0.5);
  p.credit += gain;
  return { eq, sold: true, gain };
}

function dropHalfMaterials(p) {
  const list = p.materials.slice()
    .sort((a, b) => QMAP[b.q].value - QMAP[a.q].value);
  const n = Math.ceil(list.length / 2);
  const lost = list.slice(0, n);
  const keep = list.slice(n);
  p.materials = keep;
  return lost;
}

function extractPlayer(p) {
  p.mapNodeId = null;
  p.escapedThisRound = true;
  p.totalValue = playerValue(p);
  if (!p.isHuman) return;
  render();
  afterAction();
}

function forceSettle(p) {
  if (!p) {
    if (!G.me || G.me.mapNodeId == null) return;
    if (!confirm('就地结算会立刻结束本轮探索，且物资减半。确定？')) return;
    p = G.me;
  }
  if (p.mapNodeId == null) return;
  const lost = dropHalfMaterials(p);
  p.mapNodeId = null;
  p.escapedThisRound = true;
  p.totalValue = playerValue(p);
  log(`AP 耗尽，就地结算：丢失 ${lost.length} 件物资（${fmtMats(lost)}）`, 'hl');
  render();
  afterAction();
}

/** 一次行动结束后的统一推进 */
function afterAction() {
  if (G.phase !== 'over') G.phase = 'explore';
  if (G.me.alive && G.me.mapNodeId != null && G.me.ap <= 0) {
    forceSettle(G.me);
    return;
  }
  aiStep();
  render();
  checkRoundEnd();
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
  return Object.assign({}, s, { maxHp: st.hp, hp: st.hp, atk: st.atk, def: st.def });
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
  const plan = round <= 1 ? [['normal', 3]]
    : round === 2 ? [['normal', 4], ['elite', 1]]
      : [['elite', 5]];
  const list = [];
  for (const [tier, n] of plan) {
    for (let i = 0; i < n; i++) {
      const cls = CLASSES[randInt(0, CLASSES.length - 1)];
      const s = makeSoldier(cls, tier);
      const st = soldierStats(cls, tier, round);
      s.level = round;
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
    <div class="sub">${cfg.sub || '自动战斗 · 最多 12 回合'}　·　阵营色：<span style="color:#4ad0a0">你方</span> / <span style="color:#e07050">敌方</span></div>
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
    if (ev.t === 'attack') return 250 / speed;
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
  for (const s of p.soldiers) v += SOLDIERS[s.cls][s.tier].price;
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

  const finish = res => {
    applyBattleResult(a, res, 'A');
    applyBattleResult(b, res, 'B');
    cb(res);
  };

  if (!human) {
    const res = runBattle(teamA, teamB);
    finish(res);
    return;
  }
  playBattle({
    title: `${a.name} VS ${b.name}`,
    sub: `${env} 环境 · 自动战斗`,
    teamA, teamB, labelA, labelB, onEnd: finish
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

function encounter(human, foe) {
  G.phase = 'encounter';
  const env = G.maps[human.mapId].env;

  // 对冲：AI 判断打不过就丢一半物资跑路
  if (strengthOf(foe) < strengthOf(human) * 0.6 && Math.random() < 0.5) {
    const lost = dropHalfMaterials(foe);
    foe.mapNodeId = foe.prevNodeId;
    log(`${foe.name} 选择避战，丢下 ${lost.length} 件物资逃走`, 'hl');
    G.phase = 'explore';
    afterAction();
    return;
  }

  G.pendingFoe = foe;
  showOverlay(`
    <h2>遭遇战</h2>
    <div class="sub">同为 ${env} 环境 · 同一节点。打赢拿走对方一半物资，打输直接出局。</div>
    <div class="two-col">
      ${sideCard(human, '你')}
      ${sideCard(foe, '对手')}
    </div>
    <div class="mt center">
      <button class="btn ok" onclick="startEncounterBattle()">开战</button>
      <button class="btn warn" onclick="fleeEncounter()">撤退（丢一半物资）</button>
    </div>`);
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
        ? `击败 ${esc(foe.name)}，获得对方一半物资：${fmtMats(r.spoils) || '无'}<br>小兵损失已结算。`
        : `${esc(foe.name)} 获胜。你被淘汰，可继续观战或开下一局。`,
      () => {
        if (mine) { afterAction(); return; }
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
  me.escapedThisRound = true;
  me.totalValue = playerValue(me);
  log(`你选择撤退，丢下 ${lost.length} 件物资（${fmtMats(lost) || '无'}）`, 'hl');
  G.pendingFoe = null;
  G.phase = 'explore';
  hideOverlay();
  render();
  afterAction();
}

/* ---------------- 怪物点 ---------------- */

function fightMonster(p, node) {
  const env = G.maps[p.mapId].env;
  const teamA = teamOf(p, 'A', env);
  const teamB = monsterTeam(G.round);
  const isHuman = p.isHuman;

  const done = res => {
    applyBattleResult(p, res, 'A');
    if (res.winner === 'A') {
      const got = node.stock ? node.stock.slice() : [];
      lootNode(p, node);
      if (isHuman) log('怪物点清剿成功', 'hl');
      showBattleResult('战斗胜利', 'result-win',
        `怪物被清除。<br>${got.length ? '战利品：' + fmtMats(got) : '这里已经被搜空。'}`,
        () => { if (isHuman) afterAction(); });
      return;
    }
    // 打输不阵亡：损失一半小兵，被弹回相邻节点
    const half = Math.ceil(p.soldiers.length / 2);
    const lost = p.soldiers.splice(0, half);
    p.mapNodeId = p.prevNodeId;
    if (isHuman) {
      log(`败给怪物，损失 ${lost.length} 名小兵，退回上一节点`, 'hl');
      showBattleResult('战斗失败', 'result-lose',
        `你被怪物击退。<br>损失小兵：${lost.map(s => s.name).join('、') || '无'}<br>退回上一节点。`,
        () => { afterAction(); });
    }
  };

  if (!isHuman) {
    const res = runBattle(teamA, teamB);
    done(res);
    return;
  }
  playBattle({
    title: `怪物点 · 第 ${G.round} 轮`,
    sub: `${env} 环境 · 守军随轮次增强`,
    teamA, teamB,
    labelA: '你', labelB: '怪物',
    onEnd: done
  });
}

/** 玩家出局后的观战界面 */
function showSpectate() {
  showOverlay(`
    <h2 class="result-lose">你已出局</h2>
    <div class="sub">本局结束。剩余对手仍在争夺，你可以观战到本局结束。</div>
    <div class="mt center">
      <button class="btn" onclick="hideOverlay();aiStep()">继续观战</button>
      <button class="btn ok" onclick="startGame()">开下一局</button>
    </div>`);
}

/* ---------------- AI 行动 ---------------- */

let aiBusy = false;

function aiStep() {
  if (aiBusy) return;
  aiBusy = true;
  try {
    for (const p of G.players) {
      if (!p.alive || p.isHuman) continue;
      if (p.mapId == null || p.mapNodeId == null) continue;
      aiTurn(p);
    }
  } finally {
    aiBusy = false;
  }
  render();
  checkRoundEnd();
}

function aiTurn(p) {
  const map = G.maps[p.mapId];
  if (!map) { p.mapNodeId = null; return; }

  let guard = 0;
  while (p.alive && p.mapNodeId != null && p.ap > 0 && guard++ < 24) {
    const node = map.byId[p.mapNodeId];
    if (!node) break;
    const nbs = node.neighbors.map(id => map.byId[id]).filter(Boolean);
    if (!nbs.length) break;

    const wantExit = p.ap <= 2 || (p.soldiers.length === 0 && p.ap <= 6);
    let target = wantExit ? nbs.find(n => n.type === 'exit') : null;
    if (!target) {
      let best = -Infinity;
      for (const n of nbs) {
        const s = aiNodeScore(p, n);
        if (s > best) { best = s; target = n; }
      }
    }
    if (!target) break;

    p.prevNodeId = p.mapNodeId;
    p.mapNodeId = target.id;
    p.ap--;
    revealAround(map, target.id);

    // 同节点遭遇
    const foe = G.players.find(q =>
      q.alive && q.id !== p.id && q.mapId === p.mapId && q.mapNodeId === target.id);
    if (foe) {
      if (foe.isHuman) { log(`${p.name} 在同一节点撞上了你`, 'hl'); encounter(foe, p); return; }
      if (strengthOf(p) < strengthOf(foe) * 0.6 && Math.random() < 0.5) {
        const lost = dropHalfMaterials(p);
        p.mapNodeId = p.prevNodeId;
        log(`${p.name} 避战，丢下 ${lost.length} 件物资`, '');
        continue;
      }
      pvpBattle(p, foe, map.env, res => {
        const r = resolvePvp(p, foe, res);
        log(`${r.winner.name} 击败 ${r.loser.name}，${r.spoils.length} 件物资易主`, 'hl');
      });
      if (!p.alive) return;
      continue;
    }

    if (target.type === 'exit') {
      p.mapNodeId = null;
      p.escapedThisRound = true;
      p.totalValue = playerValue(p);
      log(`${p.name} 从出口撤离`, '');
      return;
    }
    if (target.type === 'monster') {
      const res = runBattle(teamOf(p, 'A', map.env), monsterTeam(G.round));
      applyBattleResult(p, res, 'A');
      if (res.winner === 'A') {
        lootNode(p, target);
      } else {
        p.soldiers.splice(0, Math.ceil(p.soldiers.length / 2));
        p.mapNodeId = p.prevNodeId;
      }
      continue;
    }
    if (target.type !== 'start') lootNode(p, target);
  }

  if (p.alive && p.mapNodeId != null && p.ap <= 0) {
    const lost = dropHalfMaterials(p);
    p.mapNodeId = null;
    p.escapedThisRound = true;
    p.totalValue = playerValue(p);
    log(`${p.name} 行动点耗尽，就地结算（丢 ${lost.length} 件）`, '');
  }
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
  if (n.type === 'monster') s += strengthOf(p) > 70 + G.round * 45 ? 8 : -25;
  return s;
}

/* ---------------- 商店 ---------------- */

function priceFor(p, base) {
  return p.heroId === 'merchant' ? Math.round(base * 0.7) : base;
}

/** 以物资支付：保留总价值 = 支付后余额，余额转为找零 */
function payFrom(p, amount) {
  const total = p.credit + materialsValue(p.materials);
  if (total < amount) return false;
  const keep = total - amount;
  const pool = p.materials.slice().sort((a, b) => QMAP[a.q].value - QMAP[b.q].value);
  const kept = [];
  let keptV = 0;
  for (const it of pool) {
    const v = QMAP[it.q].value;
    if (keptV + v <= keep) { kept.push(it); keptV += v; }
  }
  p.materials = kept;
  p.credit = keep - keptV;
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

  for (const p of G.players) if (p.alive && !p.isHuman) aiShop(p);

  renderShop();
  if (G.shopTimer) clearInterval(G.shopTimer);
  G.shopTimer = setInterval(() => {
    if (G.phase !== 'shop') { clearInterval(G.shopTimer); G.shopTimer = null; return; }
    G.shopLeft--;
    const el = $('shopTimer');
    if (el) el.textContent = G.shopLeft + 's';
    if (G.shopLeft <= 0) closeShop();
  }, 1000);
}

function closeShop() {
  if (G.shopTimer) { clearInterval(G.shopTimer); G.shopTimer = null; }
  const opts = G.shopOpts || {};
  G.shopOpts = null;
  hideOverlay();
  if (opts.next) opts.next();
}

/* ---------------- 商店界面 ---------------- */

function budgetOf(p) { return p.credit + materialsValue(p.materials); }

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
  for (const a of r.aux) takeMaterial(p, a);
  const eq = makeEquip(r.slot, chk.quality, r.name);
  const idx = EQUIP_SLOT_INDEX[r.slot];
  const cur = p.equips[idx];
  if (!cur || QINDEX[eq.quality] > QINDEX[cur.quality]) {
    p.equips[idx] = eq;
    return { eq, sold: false };
  }
  const gain = Math.round(equipPrice(eq) * 0.5);
  p.credit += gain;
  return { eq, sold: true, gain };
}

function renderShop() {
  if (!G.me || !G.shop) return;
  const me = G.me;
  const budget = budgetOf(me);

  const eqHtml = G.shop.equips.map((it, i) => {
    const price = priceFor(me, it.price);
    const cur = me.equips[EQUIP_SLOT_INDEX[it.eq.slot]];
    const better = !cur || QINDEX[it.eq.quality] > QINDEX[cur.quality];
    const can = !it.soldOut && budget >= price;
    return `<div class="pick-card" style="cursor:default">
      <div class="t q-${it.eq.quality}">${esc(it.eq.name)}</div>
      <div class="tag">${EQUIP_SLOT_NAME[it.eq.slot]} · ${QMAP[it.eq.quality].name}</div>
      <div class="stat">${better ? '优于当前装备' : '弱于当前（折价回收）'}</div>
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

  const recipeRows = RECIPES.map(r => ({ r, chk: craftCheck(me, r) }))
    .sort((a, b) => (b.chk ? 1 : 0) - (a.chk ? 1 : 0));
  const recipes = recipeRows.map(({ r, chk }) => {
    const clsTag = r.cls ? ` <span style="color:${CLASS_COLOR[r.cls]}">${r.cls}</span>` : '';
    return `<div class="recipe">
      <span class="rname">${r.name}${clsTag}</span>
      <span class="rmat">${r.main} + ${r.aux.join(' + ')}</span>
      <span class="rmat" style="flex:0 0 44px">${EQUIP_SLOT_NAME[r.slot]}</span>
      ${chk
        ? `<button class="btn ok" onclick="doCraft('${r.id}')">合成 <span class="q-${chk.quality}">${QMAP[chk.quality].name}</span></button>`
        : `<button class="btn" disabled>缺料</button>`}
    </div>`;
  }).join('');

  const cnt = {};
  for (const it of me.materials) cnt[it.q] = (cnt[it.q] || 0) + 1;
  const sell = QUALITIES.filter(q => cnt[q.key]).map(q => {
    const gain = Math.max(1, Math.round(q.value * 0.7));
    return `<span class="chip q-${q.key}" style="cursor:pointer"
      onclick="sellMaterial('${q.key}')"
      title="出售 1 件，回收 ${gain} 物资点">${q.name}<span class="c">${cnt[q.key]}</span></span>`;
  }).join(' ') || '<span class="muted">背包空空</span>';

  showOverlay(`
    <h2>第 ${G.round} 轮 · 战地补给
      <span class="muted" style="font-size:14px">（<span id="shopTimer">${G.shopLeft}s</span>）</span></h2>
    <div class="sub">可用物资点 <b>${budget}</b>　·　物资即货币，支付时按品质由低到高扣除，余数找回</div>
    <div class="shop-grid">
      <div><div class="shop-tag">装备 · 3 件</div>${eqHtml}</div>
      <div><div class="shop-tag">雇佣 · 2 类</div>${sdHtml}</div>
      <div><div class="shop-tag">兵种升级</div>${upHtml}</div>
    </div>
    <div class="mt">
      <div class="shop-tag">出售物资 · 7 折回收（点一次卖 1 件）</div>
      <div class="chips">${sell}</div>
    </div>
    <div class="mt">
      <div class="shop-tag">合成配方 · 主材 1 + 辅材 2（成品品质取主材品质）</div>
      <div class="recipe-list">${recipes}</div>
    </div>
    <div class="mt center">
      <button class="btn ok" onclick="closeShop()">完成补给</button>
    </div>
  `);
}

/* ---------------- 商店交互 ---------------- */

function buyEquip(i) {
  const me = G.me, it = G.shop && G.shop.equips[i];
  if (!me || !it || it.soldOut) return;
  const price = priceFor(me, it.price);
  if (budgetOf(me) < price) return;
  if (!payFrom(me, price)) return;
  it.soldOut = true;

  const idx = EQUIP_SLOT_INDEX[it.eq.slot];
  const cur = me.equips[idx];
  if (!cur) {
    me.equips[idx] = it.eq;
    log(`购入 <span class="q-${it.eq.quality}">${it.eq.name}</span>`, 'hl');
  } else if (QINDEX[it.eq.quality] > QINDEX[cur.quality]) {
    me.equips[idx] = it.eq;
    const gain = Math.round(equipPrice(cur) * 0.5);
    me.credit += gain;
    log(`购入 <span class="q-${it.eq.quality}">${it.eq.name}</span>，旧装备回收 +${gain}`, 'hl');
  } else {
    const gain = Math.round(equipPrice(it.eq) * 0.5);
    me.credit += gain;
    log(`购入 <span class="q-${it.eq.quality}">${it.eq.name}</span>，弱于当前装备，折价回收 +${gain}`);
  }
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

function sellMaterial(qKey) {
  const me = G.me;
  if (!me) return;
  const i = me.materials.findIndex(m => m.q === qKey);
  if (i < 0) return;
  const item = me.materials.splice(i, 1)[0];
  const gain = Math.max(1, Math.round(QMAP[qKey].value * 0.7));
  me.credit += gain;
  log(`出售 ${item.n}（${QMAP[qKey].name}）+${gain} 物资点`);
  renderShop();
  renderSide();
}

function doCraft(id) {
  const me = G.me;
  const r = RECIPES.find(x => x.id === id);
  if (!me || !r) return;
  const chk = craftCheck(me, r);
  if (!chk) return;
  const res = craftInto(me, r, chk);
  if (res.sold) log(`合成 <span class="q-${res.eq.quality}">${res.eq.name}</span>，弱于当前装备，折价回收 +${res.gain}`);
  else log(`合成 <span class="q-${res.eq.quality}">${res.eq.name}</span>`, 'hl');
  renderShop();
  renderSide();
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
    if (budgetOf(p) < price) break;
    if (!payFrom(p, price)) break;
    it.soldOut = true;
    addSoldierTo(p, it.cls, it.tier);
  }

  const up = shop.upgrade;
  const lv = p.soldierLevels[up.cls] || 1;
  const cost = upgradeCost(lv);
  if (cost != null) {
    const price = priceFor(p, cost);
    if (budgetOf(p) >= price && payFrom(p, price)) {
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
    if (budgetOf(p) < price) continue;
    const idx = EQUIP_SLOT_INDEX[it.eq.slot];
    const cur = p.equips[idx];
    if (cur && QINDEX[it.eq.quality] <= QINDEX[cur.quality]) continue;
    if (!payFrom(p, price)) continue;
    p.equips[idx] = it.eq;
  }

  for (const r of RECIPES) {
    const chk = craftCheck(p, r);
    if (chk) { craftInto(p, r, chk); break; }
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
  mapCanvas.addEventListener('click', onMapClick);
}

function init() {
  bindEvents();
  startGame();
}

init();

