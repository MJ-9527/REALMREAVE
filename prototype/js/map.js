'use strict';

/* ============================================================
   地图生成：三层同心拓扑图
   ============================================================ */

const MAP_W = 900;
const MAP_H = 640;
const CENTER = { x: 450, y: 320 };

const RING_RADIUS = [0, 200, 300];       // 层 → 半径
const RING_COUNT = [5, 9, 12];            // 层 → 节点数

let nodeSeq = 0;

function createNode(ring, angle, radius) {
  return {
    id: 'n' + (++nodeSeq),
    ring,
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius * 0.86,
    type: 'normal',
    revealed: false,
    looted: false,
    neighbors: [],
    kind: 'normal',      // normal / normalRes / highRes / monster / treasure
    stock: null          // 本轮剩余物资
  };
}

function connect(a, b) {
  if (a === b) return;
  if (!a.neighbors.includes(b.id)) a.neighbors.push(b.id);
  if (!b.neighbors.includes(a.id)) b.neighbors.push(a.id);
}

/**
 * 生成一张图
 * @param {string} env 环境名
 */
function generateMap(env) {
  const rings = [];

  for (let r = 0; r < 3; r++) {
    const count = RING_COUNT[r];
    const radius = RING_RADIUS[r];
    const nodes = [];
    const offset = r * 0.35;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + offset;
      nodes.push(createNode(r, angle, radius));
    }
    rings.push(nodes);
  }

  // 环内相邻连线
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      connect(ring[i], ring[(i + 1) % ring.length]);
    }
  }

  // 跨环连线：每个节点连到下一层最近的 1-2 个
  for (let r = 0; r < 2; r++) {
    const inner = rings[r];
    const outer = rings[r + 1];
    for (const o of outer) {
      const sorted = inner.slice().sort((a, b) =>
        dist2(a, o) - dist2(b, o)
      );
      connect(o, sorted[0]);
      if (Math.random() < 0.55 && sorted[1]) connect(o, sorted[1]);
    }
  }

  const all = rings.flat();

  // ---- 节点类型分配 ----
  const core = rings[0];
  const mid = rings[1];
  const outer = rings[2];

  // 核心区：高级物资 + 宝藏 + 怪物
  const corePlan = shuffle([
    'treasure', 'highRes', 'highRes', 'monster'
  ]);
  core.forEach((n, i) => {
    n.type = corePlan[i] || 'highRes';
    n.kind = n.type;
  });

  // 中间层：普通物资为主 + 少量高级 + 怪物
  const midPlan = shuffle([
    'normalRes', 'normalRes', 'normalRes', 'highRes', 'monster',
    'normal', 'normal', 'normalRes', 'normal'
  ]);
  mid.forEach((n, i) => {
    n.type = midPlan[i] || 'normal';
    n.kind = n.type;
  });

  // 外围：入口 + 出口 + 普通/普通物资
  const outerOrder = shuffle(outer);
  const start = outerOrder[0];
  start.type = 'start';
  start.kind = 'normal';

  const exitCount = Math.random() < 0.5 ? 1 : 2;
  for (let i = 1; i <= exitCount; i++) {
    outerOrder[i].type = 'exit';
    outerOrder[i].kind = 'normal';
  }

  const restPlan = ['normalRes', 'normalRes', 'normalRes', 'normalRes',
                    'normal', 'normal', 'normal', 'normalRes', 'normal'];
  let pi = 0;
  for (let i = exitCount + 1; i < outerOrder.length; i++) {
    const t = restPlan[pi++] || 'normal';
    outerOrder[i].type = t;
    outerOrder[i].kind = t;
  }

  // ---- 可见性 ----
  for (const n of all) {
    // 外围全可见；中层灰问号；核心金问号永不揭示
    n.revealed = n.ring === 2;
  }

  const map = {
    env,
    nodes: all,
    byId: {},
    startId: start.id,
    exitIds: outerOrder.slice(1, exitCount + 1).map(n => n.id),
    rings
  };
  for (const n of all) map.byId[n.id] = n;

  refreshMapStock(map);
  return map;
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
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
