'use strict';

/* ============================================================
   渲染：地图画布 + 战斗画布
   ============================================================ */

function nodeRadius(n) {
  return n.ring === 0 ? 16 : n.ring === 1 ? 12 : 10;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawMap(ctx, map, players, opts) {
  opts = opts || {};
  const W = MAP_W, H = MAP_H;
  ctx.clearRect(0, 0, W, H);

  // 背景
  const g = ctx.createRadialGradient(
    CENTER.x, CENTER.y, 60, CENTER.x, CENTER.y, Math.max(W, H) * 0.62);
  g.addColorStop(0, '#2a2419');
  g.addColorStop(0.5, '#1b1f24');
  g.addColorStop(1, '#12151a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 核心区光晕
  const coreR = (map.profile ? map.profile.radius[1] : 228) * 0.62;
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, coreR, 0, Math.PI * 2);
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

  // 同节点玩家分组
  const byNode = {};
  for (const p of players) {
    if (p.mapId !== opts.mapIndex) continue;
    if (p.mapNodeId == null) continue;
    (byNode[p.mapNodeId] = byNode[p.mapNodeId] || []).push(p);
  }

  // 玩家所在节点先铺一层阵营色光圈，远看也能分清谁在哪
  for (const nodeId in byNode) {
    const node = map.byId[nodeId];
    if (!node) continue;
    const list = byNode[nodeId];
    const hasMe = list.some(p => p.isHuman);
    const r = nodeRadius(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 9, 0, Math.PI * 2);
    ctx.fillStyle = hasMe ? 'rgba(74, 208, 160, 0.18)' : 'rgba(224, 96, 72, 0.14)';
    ctx.fill();
    ctx.strokeStyle = hasMe ? 'rgba(125, 245, 200, 0.8)' : 'rgba(255, 132, 105, 0.65)';
    ctx.lineWidth = hasMe ? 3 : 2;
    ctx.stroke();
  }

  // 规划路径预览：青色折线 + 步序编号
  const pathIds = opts.pathIds || [];
  if (opts.currentNodeId != null && pathIds.length) {
    const pts = [];
    const start = map.byId[opts.currentNodeId];
    if (start) pts.push(start);
    for (const id of pathIds) {
      const n = map.byId[id];
      if (!n) break;
      pts.push(n);
    }
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(96, 214, 255, 0.85)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190, 240, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (let i = 1; i < pts.length; i++) {
      const n = pts[i];
      const r = nodeRadius(n) + 4;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(96, 214, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const bx = n.x + r + 7, by = n.y - r - 2;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 20, 28, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(96, 214, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#9fe8ff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i), bx, by + 0.5);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 可移动高亮
  const canMove = opts.movableIds || [];

  // 节点
  for (const n of map.nodes) {
    drawMapNode(ctx, n, map, opts, canMove.includes(n.id));
  }

  // 当前行动者所在节点：金色虚线环
  if (opts.currentNodeId != null) {
    const cn = map.byId[opts.currentNodeId];
    if (cn) {
      const r = nodeRadius(cn) + 13;
      ctx.beginPath();
      ctx.arc(cn.x, cn.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232, 179, 58, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 玩家标记：同节点多人时横向排开，并整体限制在画布内，避免边缘被裁掉
  const spacing = 48;
  for (const nodeId in byNode) {
    const node = map.byId[nodeId];
    if (!node) continue;
    const list = byNode[nodeId];
    list.sort((a, b) => (b.isHuman ? 1 : 0) - (a.isHuman ? 1 : 0));

    const total = (list.length - 1) * spacing;
    let baseX = node.x - total / 2;
    baseX = clamp(baseX, 44, W - 44 - total);

    list.forEach((p, i) => {
      const tx = baseX + i * spacing;
      let ty = node.y - 38;
      const r = p.isHuman ? 16 : 12.5;
      // 顶部节点如果放不下名字标签，就把标记改放到节点下方
      if (ty - r - 24 < 10) ty = node.y + 46;
      const isTurn = p.id === opts.currentPlayerId;
      drawPlayerToken(ctx, node, tx, ty, p, opts, isTurn);
    });
  }

  drawMapLegend(ctx, opts);
}

/** 出口呼吸光环独立绘制，避免动画帧重画整张地图。 */
function drawMapEffects(ctx, map) {
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  if (!map) return;

  const t = (performance.now() % 1600) / 1600;
  const pulse = t < 0.5 ? t * 2 : (1 - t) * 2;
  for (const n of map.nodes) {
    if (!n.revealed || n.type !== 'exit') continue;
    const r = nodeRadius(n) + 5;
    for (let i = 0; i < 2; i++) {
      const phase = (pulse + i * 0.5) % 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3 + phase * 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(74,222,159,${0.55 * (1 - phase)})`;
      ctx.lineWidth = 2.5 - phase * 1.5;
      ctx.stroke();
    }
  }
}

function drawMapNode(ctx, n, map, opts, movable) {
  const core = n.ring === 0;
  const hidden = !n.revealed;

  let color = '#4a5261';
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

  if (n.looted && !hidden && n.type !== 'exit') {
    color = '#333238';
    icon = '空';
  }

  const isExit = !hidden && n.type === 'exit';
  const r = nodeRadius(n) + (isExit ? 5 : 0);

  // 固定外圈底色留在地图层，动态扩散光环单独绘制。
  if (isExit) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(74,222,159,0.16)';
    ctx.fill();
  }

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

  // 可走
  if (movable) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,220,255,0.9)';
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
    ctx.font = `bold ${isExit ? 13 : core ? 14 : n.ring === 1 ? 11 : 9}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, n.x, n.y + 1);
  }

  // 出口：深色内描边 + 下方「出口」标注
  if (isExit) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(8,40,30,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4ad0a0';
    ctx.fillText('出口', n.x, n.y + r + 9);
  }

  // 品质色点（已知未搜的物资点）
  if (!hidden && !n.looted && n.stock && n.stock.length) {
    const maxQ = n.stock.reduce((m, it) =>
      QINDEX[it.q] > QINDEX[m] ? it.q : m, 'white');
    ctx.beginPath();
    ctx.arc(n.x + r - 2, n.y - r + 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = QMAP[maxQ].color;
    ctx.fill();
    ctx.strokeStyle = '#12151a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawPlayerToken(ctx, node, x, y, p, opts, isTurn) {
  const self = p.isHuman;
  const color = self ? '#4ad0a0' : '#d9654a';
  const r = self ? 16 : 12.5;

  // 与节点之间的引线 + 锚点，避免把角色看成漂浮的图标
  const below = y > node.y;
  const nr = nodeRadius(node);
  const lineStartY = below ? y - r - 2 : y + r + 2;
  const lineEndY = below ? node.y + nr + 1 : node.y - nr - 1;
  ctx.beginPath();
  ctx.moveTo(x, lineStartY);
  ctx.lineTo(node.x, lineEndY);
  ctx.strokeStyle = self ? 'rgba(125,245,200,0.55)' : 'rgba(255,132,105,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(node.x, lineEndY, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 自己的外圈光晕
  if (self) {
    ctx.beginPath();
    ctx.arc(x, y, r + 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(74, 208, 160, 0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220, 255, 242, 0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 当前行动者：金色虚线环
  if (isTurn) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#e8b33a';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  if (self) {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else {
    // 对手用菱形，形状一眼区分
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }
  ctx.fillStyle = self ? '#2fbf8f' : '#c04d38';
  ctx.fill();
  ctx.strokeStyle = self ? '#eafff6' : '#ffc9bb';
  ctx.lineWidth = self ? 3 : 2;
  ctx.stroke();

  // 内部职业图标（斗篷生效时隐藏）
  const hideCls = !self && opts.cloakActive && opts.cloakActive(p);
  ctx.fillStyle = '#08110d';
  ctx.font = `bold ${self ? 13 : 11}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hideCls ? '?' : (CLASS_ICON[p.cls] || p.name.slice(0, 1)), x, y + 1);

  // 名字标签：自己明确写「你」；放在远离节点的一侧，避免遮住节点
  const label = self ? `你 · ${p.name}` : p.name;
  const labelY = below ? y + r + 15 : y - r - 6;
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = below ? 'top' : 'bottom';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(8, 12, 16, 0.92)';
  ctx.strokeText(label, x, labelY);
  ctx.fillStyle = self ? '#9bffd9' : '#ffb4a2';
  ctx.fillText(label, x, labelY);
}

function drawMapLegend(ctx, opts) {
  const x = 16, y = 14, w = 336, h = 32;
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = 'rgba(10, 14, 19, 0.86)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const cy = y + h / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 你：绿色圆
  ctx.beginPath();
  ctx.arc(x + 18, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#2fbf8f';
  ctx.fill();
  ctx.strokeStyle = '#eafff6';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#9bffd9';
  ctx.fillText('你', x + 30, cy);

  // 对手：红色菱形
  const dx = x + 78;
  ctx.beginPath();
  ctx.moveTo(dx, cy - 7);
  ctx.lineTo(dx + 7, cy);
  ctx.lineTo(dx, cy + 7);
  ctx.lineTo(dx - 7, cy);
  ctx.closePath();
  ctx.fillStyle = '#c04d38';
  ctx.fill();
  ctx.strokeStyle = '#ffc9bb';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffb4a2';
  ctx.fillText('对手', dx + 13, cy);

  // 可走：青色圆环
  const mx = x + 148;
  ctx.beginPath();
  ctx.arc(mx, cy, 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120,220,255,0.95)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#9fe8ff';
  ctx.fillText('可走', mx + 11, cy);

  // 出口：绿色实心圆 + 光环
  const ex = x + 206;
  ctx.beginPath();
  ctx.arc(ex, cy, 8, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(74,222,159,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ex, cy, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#4ad0a0';
  ctx.fill();
  ctx.strokeStyle = '#08301f';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#8ef0c6';
  ctx.fillText('出口', ex + 13, cy);

  // 回合提示
  if (opts.turnLabel) {
    ctx.fillStyle = '#e8b33a';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText(opts.turnLabel, x + 256, cy);
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

/** 布阵界面：战场格子 + 双方单位 + 可放置格/选中高亮 */
function drawFormation(ctx, teamA, teamB, opts) {
  opts = opts || {};
  ctx.clearRect(0, 0, BATTLE_W, BATTLE_H);

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const inA = x <= 1, inB = x >= 6;
      const hover = opts.hoverCell && opts.hoverCell.x === x && opts.hoverCell.y === y;
      ctx.fillStyle = hover && inA ? 'rgba(255,215,106,0.16)'
        : inA ? 'rgba(74,208,160,0.10)'
          : inB ? 'rgba(217,101,74,0.07)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
    }
  }

  // 己方部署区边框
  ctx.strokeStyle = 'rgba(74,208,160,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CELL * 2 - 2, BATTLE_H - 2);

  // 中缝
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CELL * 4, 0);
  ctx.lineTo(CELL * 4, BATTLE_H);
  ctx.stroke();

  for (const u of teamA.concat(teamB)) {
    if (u.alive) drawUnit(ctx, u, opts);
  }
}

function drawUnit(ctx, u, opts) {
  const cx = u.x * CELL + CELL / 2;
  const cy = u.y * CELL + CELL / 2;
  const r = u.kind === 'hero' ? 22 : 17;

  const base = u.side === 'A' ? '#3fa87c' : '#c2583f';
  const clsC = CLASS_COLOR[u.cls] || '#888';

  // 布阵选中
  if (opts.selUid === u.uid) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

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
