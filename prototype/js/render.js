'use strict';

/* ============================================================
   渲染：地图画布 + 战斗画布
   ============================================================ */

function drawMap(ctx, map, players, opts) {
  opts = opts || {};
  const W = MAP_W, H = MAP_H;
  ctx.clearRect(0, 0, W, H);

  // 背景
  const g = ctx.createRadialGradient(CENTER.x, CENTER.y, 40, CENTER.x, CENTER.y, 360);
  g.addColorStop(0, '#2a2419');
  g.addColorStop(0.5, '#1b1f24');
  g.addColorStop(1, '#12151a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 核心区光晕
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, 95, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 200, 80, 0.06)';
  ctx.fill();

  // 连线
  ctx.lineWidth = 2;
  for (const n of map.nodes) {
    for (const nbId of n.neighbors) {
      if (n.id > nbId) continue;
      const nb = map.byId[nbId];
      if (!nb) continue;
      const bothRevealed = n.revealed && nb.revealed;
      ctx.strokeStyle = bothRevealed ? 'rgba(160,180,200,0.28)' : 'rgba(90,105,120,0.12)';
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }
  }

  // 可移动高亮
  const canMove = opts.movableIds || [];

  // 节点
  for (const n of map.nodes) {
    drawMapNode(ctx, n, map, opts, canMove.includes(n.id));
  }

  // 玩家标记
  const byNode = {};
  for (const p of players) {
    if (p.mapId !== opts.mapIndex) continue;
    if (p.mapNodeId == null) continue;
    (byNode[p.mapNodeId] = byNode[p.mapNodeId] || []).push(p);
  }
  for (const nodeId in byNode) {
    const node = map.byId[nodeId];
    if (!node) continue;
    const list = byNode[nodeId];
    list.forEach((p, i) => {
      const off = (i - (list.length - 1) / 2) * 22;
      drawPlayerToken(ctx, node.x + off, node.y - 26, p, opts);
    });
  }
}

function drawMapNode(ctx, n, map, opts, movable) {
  const core = n.ring === 0;
  const hidden = !n.revealed;

  let color = '#4a5261';
  let label = '';
  let icon = '';

  if (hidden) {
    color = '#3b414d';
    icon = '?';
  } else {
    switch (n.type) {
      case 'start': color = '#4a90d9'; icon = '入'; break;
      case 'exit': color = '#4ad0a0'; icon = '出'; break;
      case 'normal': color = '#525c6b'; icon = ''; break;
      case 'normalRes': color = '#3f8f5a'; icon = '物'; break;
      case 'highRes': color = '#c9a03a'; icon = '资'; break;
      case 'monster': color = '#b3453a'; icon = '怪'; break;
      case 'treasure': color = '#ffd76a'; icon = '宝'; break;
    }
  }

  if (n.looted && !hidden) {
    color = '#333238';
    icon = '空';
  }

  const r = core ? 17 : n.ring === 1 ? 14 : 12;

  // 寻宝图标记
  if (opts.highlightIds && opts.highlightIds.includes(n.id)) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,215,106,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 玩家当前所在
  if (opts.activeNodeId === n.id) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 可走
  if (movable) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,220,255,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // 核心金问号
  if (core && hidden) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#31281a';
    ctx.fill();
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ffd76a';
  } else {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#e8edf2';
  }

  if (icon) {
    ctx.font = `bold ${core ? 15 : 12}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, n.x, n.y + 1);
  }

  // 品质色点（已知未搜的物资点）
  if (!hidden && !n.looted && n.stock && n.stock.length) {
    const maxQ = n.stock.reduce((m, it) =>
      QINDEX[it.q] > QINDEX[m] ? it.q : m, 'white');
    ctx.beginPath();
    ctx.arc(n.x + r - 2, n.y - r + 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = QMAP[maxQ].color;
    ctx.fill();
    ctx.strokeStyle = '#12151a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawPlayerToken(ctx, x, y, p, opts) {
  const color = p.isHuman ? '#4ad0a0' : '#d9654a';
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0d1014';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#0d1014';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ch = p.name.slice(0, 1);
  ctx.fillText(ch, x, y + 1);

  // 职业标签（斗篷生效时隐藏）
  const showCls = p.isHuman || !opts.cloakActive || !opts.cloakActive(p);
  if (showCls) {
    ctx.font = '9px system-ui';
    ctx.fillStyle = CLASS_COLOR[p.cls];
    ctx.fillText(p.cls, x, y + 20);
  }
}

/* ---------------- 战斗渲染 ---------------- */

const CELL = 62;
const BATTLE_W = GRID_W * CELL;
const BATTLE_H = GRID_H * CELL;

function drawBattle(ctx, units, opts) {
  opts = opts || {};
  ctx.clearRect(0, 0, BATTLE_W, BATTLE_H);

  // 格子
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const inA = x <= 1, inB = x >= 6;
      ctx.fillStyle = inA ? 'rgba(74,208,160,0.07)'
        : inB ? 'rgba(217,101,74,0.07)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
    }
  }

  // 中缝
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CELL * 4, 0);
  ctx.lineTo(CELL * 4, BATTLE_H);
  ctx.stroke();

  // 单位
  for (const u of units) {
    if (!u.alive) continue;
    drawUnit(ctx, u, opts);
  }

  // 飘字
  if (opts.floats) {
    for (const f of opts.floats) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `bold ${f.crit ? 22 : 17}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - (1 - a) * 26);
      ctx.globalAlpha = 1;
    }
  }
}

function drawUnit(ctx, u, opts) {
  const cx = u.x * CELL + CELL / 2;
  const cy = u.y * CELL + CELL / 2;
  const r = u.kind === 'hero' ? 22 : 17;

  const base = u.side === 'A' ? '#3fa87c' : '#c2583f';
  const clsC = CLASS_COLOR[u.cls] || '#888';

  // 选中/受击
  if (opts.hitUid === u.uid) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,90,60,0.35)';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = clsC;
  ctx.stroke();

  // 兵种/职业字
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${u.kind === 'hero' ? 15 : 12}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(u.kind === 'hero' ? u.name.slice(0, 1) : CLASS_ICON[u.cls], cx, cy + 1);

  // 精英标记
  if (u.tier === 'elite') {
    ctx.beginPath();
    ctx.arc(cx + r - 3, cy - r + 3, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#e8b33a';
    ctx.fill();
  }

  // 血条
  const bw = r * 2 + 4, bh = 5;
  const bx = cx - bw / 2, by = cy + r + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx, by, bw, bh);
  const pct = clamp(u.hp / u.maxHp, 0, 1);
  ctx.fillStyle = u.side === 'A' ? '#4ad0a0' : '#e07050';
  ctx.fillRect(bx, by, bw * pct, bh);
}
