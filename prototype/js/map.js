'use strict';

/* ============================================================
   地图生成：三层拓扑图
   - 节点数量更多（约 40 个）
   - 位置带随机扰动，不再是规则同心圆
   - 连线按「最小生成树 + 随机长边」生成，相邻节点不一定互通
   ============================================================ */

const MAP_W = 1000;
const MAP_H = 700;
const CENTER = { x: MAP_W / 2, y: MAP_H / 2 };

// 每地形一套结构参数：环半径 / 节点数 / 纵向压扁 / 怪物与物资配比
const ENV_MAP_PROFILE = {
  '森林': {
    radius: [100, 215, 330], count: [6, 13, 25], squash: 0.86,
    coreMonster: 1, midMonsters: 2, midHigh: 0.32, midRes: 0.38,
    restRes: 0.40, extraEdge: 0.10, exitSpread: 170
  },
  '冰原': {
    radius: [96, 205, 320], count: [5, 11, 18], squash: 0.70,
    coreMonster: 2, midMonsters: 1, midHigh: 0.40, midRes: 0.27,
    restRes: 0.30, extraEdge: 0.08, exitSpread: 150
  },
  '平原': {
    radius: [112, 232, 342], count: [6, 15, 23], squash: 0.90,
    coreMonster: 1, midMonsters: 2, midHigh: 0.26, midRes: 0.42,
    restRes: 0.45, extraEdge: 0.14, exitSpread: 180
  },
  '沙漠': {
    radius: [104, 220, 336], count: [7, 16, 17], squash: 0.76,
    coreMonster: 1, midMonsters: 2, midHigh: 0.34, midRes: 0.34,
    restRes: 0.34, extraEdge: 0.10, exitSpread: 170
  },
  '火山': {
    radius: [92, 196, 316], count: [8, 12, 16], squash: 0.66,
    coreMonster: 2, midMonsters: 2, midHigh: 0.42, midRes: 0.25,
    restRes: 0.28, extraEdge: 0.06, exitSpread: 160
  }
};
const DEFAULT_ENV_PROFILE = ENV_MAP_PROFILE['森林'];

let nodeSeq = 0;

function createNode(ring, x, y) {
  return {
    id: 'n' + (++nodeSeq),
    ring,
    x,
    y,
    type: 'normal',
    revealed: false,
    looted: false,
    neighbors: [],
    kind: 'normal',      // normal / normalRes / highRes / monster / treasure
    stock: null          // 本轮剩余物资
  };
}

function connect(a, b) {
  if (!a || !b || a === b) return;
  if (!a.neighbors.includes(b.id)) a.neighbors.push(b.id);
  if (!b.neighbors.includes(a.id)) b.neighbors.push(a.id);
}

function randFloat(a, b) { return a + Math.random() * (b - a); }

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function ellipsePoint(angle, radius, squash) {
  return {
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius * squash
  };
}

/** 在环上摆放节点：角度、半径都带扰动，并避免重叠 */
function placeRing(ring, count, radius, placed, squash) {
  const nodes = [];
  const gap = Math.PI * 2 / count;
  const start = Math.random() * Math.PI * 2;
  const minDist = ring === 0 ? 58 : ring === 1 ? 54 : 46;
  const minAll = 54;
  const marginX = 42, marginY = 36;

  for (let i = 0; i < count; i++) {
    const baseAngle = start + i * gap;
    let pt = null;
    for (let attempt = 0; attempt < 80 && !pt; attempt++) {
      const angle = baseAngle + randFloat(-gap * 0.34, gap * 0.34);
      const rr = radius + randFloat(-radius * 0.14, radius * 0.14);
      const p = ellipsePoint(angle, rr, squash);
      if (p.x < marginX || p.x > MAP_W - marginX) continue;
      if (p.y < marginY || p.y > MAP_H - marginY) continue;
      if (nodes.some(n => dist2(n, p) < minDist * minDist)) continue;
      if (placed && placed.some(n => dist2(n, p) < minAll * minAll)) continue;
      pt = p;
    }
    if (!pt) pt = ellipsePoint(baseAngle, radius, squash);
    const node = createNode(ring, pt.x, pt.y);
    nodes.push(node);
    if (placed) placed.push(node);
  }
  return nodes;
}

/** 随机最小生成树：保证连通，又不会像整齐的环一样规律 */
function buildRingTree(nodes, extraRate) {
  if (nodes.length < 2) return;
  const visited = new Set([nodes[randInt(0, nodes.length - 1)].id]);

  while (visited.size < nodes.length) {
    let best = null, bestScore = Infinity;
    for (const n of nodes) {
      if (visited.has(n.id)) continue;
      let dmin = Infinity;
      for (const v of nodes) {
        if (visited.has(v.id)) dmin = Math.min(dmin, dist2(n, v));
      }
      const score = dmin * randFloat(0.65, 1.35);
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (!best) break;

    let from = null, dmin = Infinity;
    for (const v of nodes) {
      if (!visited.has(v.id)) continue;
      const d = dist2(best, v);
      if (d < dmin) { dmin = d; from = v; }
    }
    if (!from) break;
    connect(best, from);
    visited.add(best.id);
  }

  // 少量随机长边，制造环与岔路，但刻意不把整圈连满
  const extra = Math.round(nodes.length * (extraRate == null ? 0.1 : extraRate));
  for (let k = 0; k < extra; k++) {
    const a = nodes[randInt(0, nodes.length - 1)];
    const b = nodes[randInt(0, nodes.length - 1)];
    if (a !== b && !a.neighbors.includes(b.id)) connect(a, b);
  }
}

/**
 * 入口/出口至少要有两条路，避免一进图就被堵死
 * @param {Set<string>} [avoidIds] 补边时禁止连接的节点（出生点/出口之间不能直连）
 */
function ensureBranching(node, pool, avoidIds) {
  if (!node || node.neighbors.length >= 2) return;
  const sorted = pool.slice()
    .filter(n => n.id !== node.id && !node.neighbors.includes(n.id))
    .filter(n => !avoidIds || !avoidIds.has(n.id))
    .sort((a, b) => dist2(a, node) - dist2(b, node));
  if (sorted[0]) connect(node, sorted[0]);
}

function bfsDistances(nodes, fromId) {
  const byId = {};
  for (const n of nodes) byId[n.id] = n;
  const dist = { [fromId]: 0 };
  const q = [fromId];
  while (q.length) {
    const id = q.shift();
    const n = byId[id];
    if (!n) continue;
    for (const nb of n.neighbors) {
      if (dist[nb] === undefined) {
        dist[nb] = dist[id] + 1;
        q.push(nb);
      }
    }
  }
  return dist;
}

/** 切换节点类型（生成期与每轮出口开合共用） */
function setNodeType(n, type) {
  if (!n) return;
  n.type = type;
  n.kind = type;
}

/** 节点相对地图中心的象限（0 左上 / 1 右上 / 2 左下 / 3 右下） */
function quadrantOf(n) {
  const dx = n.x - CENTER.x, dy = n.y - CENTER.y;
  if (dy < 0) return dx < 0 ? 0 : 1;
  return dx < 0 ? 2 : 3;
}

/**
 * 出生点组合：4 个出生点两两无直接连线、BFS 距离 ≥2，
 * 并尽量分散在地图四周（象限覆盖优先，其次最小间距）
 */
function pickSpawnSet(outer, all) {
  const need = Math.min(4, outer.length);
  if (outer.length <= need) return outer.slice();

  const dist = {};
  for (const n of outer) dist[n.id] = bfsDistances(all, n.id);
  const bfs = (a, b) => {
    const d = dist[a.id][b.id];
    return d == null ? Infinity : d;
  };
  const linked = (a, b) => a.neighbors.includes(b.id);
  const euclid = (a, b) => Math.sqrt(dist2(a, b));

  const evaluate = cand => {
    let minBfs = Infinity, minEuc = Infinity;
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        if (linked(cand[i], cand[j])) return null;
        const d = bfs(cand[i], cand[j]);
        if (d < 2) return null;
        minBfs = Math.min(minBfs, d);
        minEuc = Math.min(minEuc, euclid(cand[i], cand[j]));
      }
    }
    const quads = new Set(cand.map(quadrantOf)).size;
    return quads * 10000 + minBfs * 100 + (isFinite(minEuc) ? minEuc : 0);
  };

  let best = null, bestScore = -1;
  for (let t = 0; t < 500; t++) {
    const cand = shuffle(outer).slice(0, need);
    const score = evaluate(cand);
    if (score != null && score > bestScore) { bestScore = score; best = cand; }
  }
  if (best) return best;

  // 兜底：每个象限各取一个，再按两两距离补足
  const picks = [];
  for (let q = 0; q < 4 && picks.length < need; q++) {
    const inQ = outer.filter(n => quadrantOf(n) === q && !picks.includes(n));
    if (inQ.length) picks.push(inQ[randInt(0, inQ.length - 1)]);
  }
  while (picks.length < need) {
    const rest = outer.filter(n => !picks.includes(n));
    if (!rest.length) break;
    let bestN = rest[0], bestD = -1;
    for (const n of rest) {
      const d = picks.length ? Math.min(...picks.map(p => bfs(p, n))) : 1;
      if (d > bestD) { bestD = d; bestN = n; }
    }
    picks.push(bestN);
  }
  return picks;
}

/**
 * 生成一张图
 * @param {string} env 环境名
 */
function generateMap(env) {
  const pf = ENV_MAP_PROFILE[env] || DEFAULT_ENV_PROFILE;
  const rings = [];
  const placed = [];
  for (let r = 0; r < 3; r++) {
    rings.push(placeRing(r, pf.count[r], pf.radius[r], placed, pf.squash));
  }

  rings.forEach(ring => buildRingTree(ring, pf.extraEdge));

  // 跨环连线：每个节点接到内层最近的节点
  const core = rings[0];
  const mid = rings[1];
  const outer = rings[2];

  for (const o of outer) {
    const sorted = mid.slice().sort((a, b) => dist2(a, o) - dist2(b, o));
    connect(o, sorted[0]);
  }
  for (const m of mid) {
    const sorted = core.slice().sort((a, b) => dist2(a, m) - dist2(b, m));
    connect(m, sorted[0]);
  }

  const all = rings.flat();

  // ---- 节点类型分配 ----
  const setType = setNodeType;

  // 核心区：宝藏 + 怪物 + 高级物资
  const corePlan = ['treasure'];
  for (let i = 0; i < pf.coreMonster; i++) corePlan.push('monster');
  while (corePlan.length < core.length) corePlan.push('highRes');
  shuffle(corePlan).forEach((k, i) => setType(core[i], k));

  // 中间层：普通物资为主 + 少量高级 + 怪物
  const midPlan = [];
  for (let i = 0; i < pf.midMonsters; i++) midPlan.push('monster');
  const midHigh = Math.max(2, Math.round(mid.length * pf.midHigh));
  for (let i = 0; i < midHigh; i++) midPlan.push('highRes');
  const midRes = Math.round(mid.length * pf.midRes);
  for (let i = 0; i < midRes; i++) midPlan.push('normalRes');
  while (midPlan.length < mid.length) midPlan.push('normal');
  shuffle(midPlan).forEach((k, i) => setType(mid[i], k));

  // 外围：多个出生点 + 出口候选 + 普通/普通物资
  const outerOrder = shuffle(outer);
  const spawns = pickSpawnSet(outer, all);
  const spawnSet = new Set(spawns.map(n => n.id));

  // 先补齐出生点的第二条路（不互相直连），再算距离，出口才有准确依据
  spawns.forEach(n => ensureBranching(n, outer, spawnSet));

  // 出口要对每一个出生点都足够远
  const spawnDist = {};
  for (const s of spawns) {
    const d = bfsDistances(all, s.id);
    for (const n of outer) {
      const cur = spawnDist[n.id] == null ? Infinity : spawnDist[n.id];
      const nd = d[n.id] == null ? Infinity : d[n.id];
      spawnDist[n.id] = Math.min(cur, nd);
    }
  }
  const exitDist = n => (spawnDist[n.id] == null ? Infinity : spawnDist[n.id]);

  const others = outer.filter(n => !spawnSet.has(n.id));
  // 出口补边后仍不会离出生点太近：自身 ≥3 步，且所有邻居离出生点 ≥2 步
  const branchSafe = n => exitDist(n) >= 3 && n.neighbors.every(m => exitDist(m) >= 2);
  const byExitDist = (a, b) => exitDist(b) - exitDist(a);
  const safePool = others.filter(branchSafe).sort(byExitDist);
  const exitPool = safePool.concat(
    others.filter(n => !branchSafe(n)).sort(byExitDist));

  // 固定生成 2 个出口候选：优先离出生点足够远的，再尽量彼此拉开
  const exits = [];
  if (exitPool[0]) exits.push(exitPool[0]);
  const farExit = safePool.find(n =>
    n.id !== exits[0].id && dist2(n, exits[0]) > pf.exitSpread * pf.exitSpread);
  if (farExit) exits.push(farExit);
  else if (exitPool[1]) exits.push(exitPool[1]);
  if (exits.length < 2) {
    const spare = others.filter(n => !exits.some(e => e.id === n.id))
      .sort((a, b) => exitDist(b) - exitDist(a));
    if (spare[0]) exits.push(spare[0]);
  }

  spawns.forEach(n => setType(n, 'start'));

  const exitSet = new Set(exits.map(n => n.id));
  const rest = outerOrder.filter(n =>
    !spawnSet.has(n.id) && !exitSet.has(n.id));
  const restPlan = [];
  const restRes = Math.round(rest.length * pf.restRes);
  for (let i = 0; i < restRes; i++) restPlan.push('normalRes');
  while (restPlan.length < rest.length) restPlan.push('normal');
  shuffle(restPlan).forEach((k, i) => setType(rest[i], k));

  // ---- 可见性 ----
  for (const n of all) {
    // 外围全可见；中层灰问号；核心金问号永不揭示
    n.revealed = n.ring === 2;
  }

  // 出口也至少两条路；补边不得把出生点/出口彼此直连，避免开局就贴脸
  const spawnExitIds = new Set(spawns.concat(exits).map(n => n.id));
  exits.forEach(n => ensureBranching(n, outer, spawnExitIds));

  const map = {
    env,
    profile: pf,
    nodes: all,
    byId: {},
    startIds: spawns.map(n => n.id),
    exitCandidates: exits.map(n => n.id),
    exitIds: [],
    rings
  };
  for (const n of all) map.byId[n.id] = n;

  refreshMapStock(map);
  return map;
}

/** 每轮重置：所有物资点重新生成 */
function refreshMapStock(map) {
  for (const n of map.nodes) {
    n.looted = false;
    if (n.type === 'start' || n.type === 'exit') {
      n.stock = [];
    } else {
      n.stock = generateNodeStock(n, map.env);
    }
  }
}

function generateNodeStock(node, env) {
  const count = rollDropCount(node.kind);
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(rollMaterial(node.kind, env));
  }
  return items;
}

/** 揭晓相邻节点（走近 1 格） */
function revealAround(map, nodeId, radius = 1) {
  const n = map.byId[nodeId];
  if (!n) return;
  for (const nbId of n.neighbors) {
    const nb = map.byId[nbId];
    if (nb && nb.ring !== 0) nb.revealed = true;
    if (radius > 1 && nb) {
      for (const nb2Id of nb.neighbors) {
        const nb2 = map.byId[nb2Id];
        if (nb2 && nb2.ring !== 0) nb2.revealed = true;
      }
    }
  }
}

/** 寻宝图：找当前地图最高价值物资所在节点（不含宝藏点） */
function findBestLoot(map) {
  let best = -1;
  const result = [];
  for (const n of map.nodes) {
    if (n.kind === 'treasure') continue;
    if (n.looted) continue;
    if (!n.stock || !n.stock.length) continue;
    let v = 0;
    for (const it of n.stock) v += QMAP[it.q].value;
    if (v > best) { best = v; result.length = 0; result.push(n); }
    else if (v === best) result.push(n);
  }
  return { value: best, nodes: result };
}
