'use strict';

/* ============================================================
   战斗引擎：8x6 战场 · 回合制自动战斗
   输出 events 供回放：frame（快照）/ attack（飘字）/ end
   ============================================================ */

const GRID_W = 8;
const GRID_H = 6;

function deployZone(side) {
  return side === 'A' ? [0, 1] : [6, 7];
}

function autoFormation(side, units) {
  const cols = deployZone(side);
  const rows = [2, 3, 1, 4, 0, 5];
  const melee = units.filter(u => u.range <= 1);
  const ranged = units.filter(u => u.range > 1);
  const ordered = melee.concat(ranged);

  ordered.forEach((u, i) => {
    const back = i >= 6;
    u.x = side === 'A' ? (back ? cols[1] : cols[0]) : (back ? cols[0] : cols[1]);
    u.y = rows[i % rows.length];
  });
  return units;
}

/** 近战站前（靠中线），远程站后 */
function smartFormation(side, units) {
  const front = side === 'A' ? 1 : 6;
  const back = side === 'A' ? 0 : 7;
  const melee = units.filter(u => u.range <= 1).sort((a, b) => b.maxHp - a.maxHp);
  const ranged = units.filter(u => u.range > 1);

  const rows = [2, 3, 1, 4, 0, 5];
  melee.forEach((u, i) => {
    u.x = i < 5 ? front : back;
    u.y = rows[i % rows.length];
  });
  ranged.forEach((u, i) => {
    const slot = melee.length + i;
    u.x = slot < 5 ? front : back;
    u.y = rows[slot % rows.length];
  });
  return units;
}

function makeTeam(side, hero, soldiers, formation) {
  const units = [];
  const h = Object.assign({}, hero);
  h.side = side;
  units.push(h);
  soldiers.forEach(s => {
    const c = Object.assign({}, s);
    c.side = side;
    units.push(c);
  });
  (formation === 'front' ? autoFormation : smartFormation)(side, units);
  dedupePositions(side, units);
  return units;
}

/** 无英雄的队伍（怪物点） */
function makeSoloTeam(side, soldiers) {
  const units = soldiers.map(s => Object.assign({}, s, { side }));
  smartFormation(side, units);
  dedupePositions(side, units);
  return units;
}

function dedupePositions(side, units) {
  const used = new Set();
  for (const u of units) {
    let k = u.x + ',' + u.y;
    if (used.has(k)) {
      for (let y = 0; y < GRID_H; y++) {
        for (const xx of deployZone(side)) {
          const kk = xx + ',' + y;
          if (!used.has(kk)) { u.x = xx; u.y = y; k = kk; break; }
        }
        if (!used.has(k)) break;
      }
    }
    used.add(k);
  }
}

function inBounds(x, y) { return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H; }

function occupied(units, x, y, ignoreUid) {
  return units.some(u => u.alive && u.uid !== ignoreUid && u.x === x && u.y === y);
}

function cheb(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function nearestEnemy(unit, enemies) {
  let best = null, bestD = Infinity;
  for (const u of enemies) {
    const d = cheb(unit, u);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

function stepToward(unit, target, all) {
  const dx = Math.sign(target.x - unit.x);
  const dy = Math.sign(target.y - unit.y);
  const cands = [];
  if (dx !== 0 && dy !== 0) cands.push([unit.x + dx, unit.y + dy]);
  if (dx !== 0) cands.push([unit.x + dx, unit.y]);
  if (dy !== 0) cands.push([unit.x, unit.y + dy]);
  cands.sort((a, b) => {
    const da = Math.abs(a[0] - target.x) + Math.abs(a[1] - target.y);
    const db = Math.abs(b[0] - target.x) + Math.abs(b[1] - target.y);
    return da - db;
  });
  for (const [nx, ny] of cands) {
    if (inBounds(nx, ny) && !occupied(all, nx, ny, unit.uid)) return { x: nx, y: ny };
  }
  return null;
}

function moveRangeOf(unit) {
  if (unit.range > 1) return 1;
  return unit.speed >= 8 ? 3 : 2;
}

function damageOf(attacker, defender, extraMult) {
  const mod = counterMod(attacker.cls, defender.cls);
  let def = defender.def;
  if (attacker.pierce) def *= 0.35;
  let dmg = attacker.atk * (50 / (50 + def)) * mod * (extraMult || 1);
  return Math.max(1, Math.round(dmg));
}

function snapshotAll(all) {
  return all.map(u => ({
    uid: u.uid, side: u.side, name: u.name, cls: u.cls, heroId: u.heroId || null,
    x: u.x, y: u.y, hp: Math.max(0, u.hp), maxHp: u.maxHp,
    alive: u.alive, kind: u.kind, tier: u.tier || null
  }));
}

/**
 * 跑一场战斗
 */
function runBattle(teamA, teamB) {
  const all = teamA.concat(teamB);
  const events = [];
  const textLog = [];

  all.forEach(u => {
    u.alive = true;
    u.hp = u.maxHp;
    u.stunned = 0;
    u.firstAttack = true;
    u.guardedThisRound = false;
  });

  events.push({ t: 'frame', units: snapshotAll(all), round: 0 });

  let round = 0;
  const MAX_ROUND = 12;

  while (round < MAX_ROUND) {
    round++;
    all.forEach(u => { u.guardedThisRound = false; });
    const keepGoing = resolveRound(all, round, events, textLog);
    if (!keepGoing) break;
  }

  const aAlive = all.some(u => u.alive && u.side === 'A');
  const bAlive = all.some(u => u.alive && u.side === 'B');

  let winner;
  if (aAlive && !bAlive) winner = 'A';
  else if (bAlive && !aAlive) winner = 'B';
  else {
    const ha = hpPct(all, 'A'), hb = hpPct(all, 'B');
    winner = ha > hb + 0.001 ? 'A' : hb > ha + 0.001 ? 'B' : 'draw';
  }

  events.push({ t: 'end', winner, units: snapshotAll(all), rounds: round });
  return { winner, events, units: all, log: textLog, rounds: round };
}

function hpPct(all, side) {
  let cur = 0, max = 0;
  for (const u of all) {
    if (u.side !== side) continue;
    cur += Math.max(0, u.hp);
    max += u.maxHp;
  }
  return max ? cur / max : 0;
}

function pickTarget(unit, enemies) {
  const inRange = enemies.filter(e => cheb(unit, e) <= unit.range);
  if (inRange.length) {
    return inRange.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
  }
  return nearestEnemy(unit, enemies);
}

/* ---------------- 同时出手结算 ---------------- */

function roundOrder(all) {
  return all.filter(u => u.alive)
    .sort((a, b) => (b.speed - a.speed) || (a.range - b.range));
}

function sideAlive(all, side) {
  return all.some(u => u.alive && u.side === side);
}

/**
 * 一轮结算：全体先移动，再全体同时出手，伤害在本轮末统一生效
 * @returns {boolean} 双方是否都还有人存活
 */
function resolveRound(all, round, events, textLog) {
  // 1. 定身：本轮无法出手
  const stunSkip = new Set();
  for (const u of roundOrder(all)) {
    if (u.stunned > 0) {
      u.stunned--;
      stunSkip.add(u.uid);
      events.push({ t: 'stun', round, uid: u.uid });
    }
  }

  // 2. 移动阶段：逐个移动避免重叠，但不造成伤害
  for (const u of roundOrder(all)) {
    if (stunSkip.has(u.uid)) continue;
    const enemies = all.filter(e => e.alive && e.side !== u.side);
    if (!enemies.length) break;
    const target = pickTarget(u, enemies);
    if (!target) continue;
    if (cheb(u, target) <= u.range) continue;
    let steps = moveRangeOf(u);
    let moved = false;
    while (steps-- > 0 && cheb(u, target) > u.range) {
      const np = stepToward(u, target, all);
      if (!np) break;
      u.x = np.x; u.y = np.y;
      moved = true;
    }
    if (moved) events.push({ t: 'frame', units: snapshotAll(all), round });
  }

  // 3. 出手意图：只记录，不扣血
  const intents = [];
  for (const u of roundOrder(all)) {
    if (stunSkip.has(u.uid)) continue;
    const enemies = all.filter(e => e.alive && e.side !== u.side);
    if (!enemies.length) break;
    if (u.kind === 'hero' && shouldCastSkill(u, round)) {
      intents.push({ unit: u, skill: true, enemies });
      continue;
    }
    const target = pickTarget(u, enemies);
    if (!target) continue;
    if (cheb(u, target) <= u.range) intents.push({ unit: u, target });
  }

  // 4. 伤害计算（骑士减伤在本轮统一取最重的一击）
  const hits = [];
  for (const it of intents) {
    if (it.skill) hits.push(...skillHits(it.unit, it.enemies, events, round, textLog));
    else hits.push(computeHit(it.unit, it.target, 1));
  }
  applyKnightGuard(all, hits);

  // 5. 统一结算：同轮伤害一起生效
  const dmgMap = new Map();
  for (const h of hits) dmgMap.set(h.target, (dmgMap.get(h.target) || 0) + h.dmg);
  for (const [target, dmg] of dmgMap) target.hp -= dmg;

  const died = [];
  for (const u of all) {
    if (u.alive && u.hp <= 0) { u.hp = 0; u.alive = false; died.push(u); }
  }
  resolveMutualKills(hits, died);

  // 6. 事件：同一轮的攻击一起播放
  const lastHit = new Map();
  for (const h of hits) {
    const prev = lastHit.get(h.target);
    if (!prev || h.dmg > prev.dmg) lastHit.set(h.target, h);
  }
  const ordered = hits.slice().sort((a, b) =>
    (b.attacker.speed - a.attacker.speed) || (a.attacker.range - b.attacker.range));
  for (const h of ordered) {
    events.push({
      t: 'attack', round, uid: h.attacker.uid, target: h.target.uid, dmg: h.dmg,
      counter: h.counter, skill: h.skill || null,
      x: h.target.x, y: h.target.y,
      died: !h.target.alive && lastHit.get(h.target) === h,
      simul: true
    });
    if (textLog.length < 200) {
      textLog.push(`${h.attacker.name}${h.counter === 'up' ? '（克制）' : h.counter === 'down' ? '（被克）' : ''} → ${h.target.name} ${h.dmg}`);
    }
  }
  events.push({ t: 'frame', units: snapshotAll(all), round });

  return sideAlive(all, 'A') && sideAlive(all, 'B');
}

/** 计算一次命中，不修改任何状态 */
function computeHit(attacker, target, mult) {
  let m = mult;
  if (attacker.kind === 'hero') {
    if (attacker.heroId === 'warrior' && attacker.firstAttack) { m *= 1.8; attacker.firstAttack = false; }
    if (attacker.heroId === 'assassin' && target.hp / target.maxHp < 0.4) m *= 1.8;
    if (attacker.heroId === 'barbarian' && attacker.hp / attacker.maxHp < 0.5) m *= 1.5;
    if (attacker.heroId === 'archer') m *= 1.5;
  }
  const cMod = counterMod(attacker.cls, target.cls);
  return {
    attacker, target,
    dmg: damageOf(attacker, target, m),
    counter: cMod > 1 ? 'up' : cMod < 1 ? 'down' : 'none'
  };
}

/** 骑士：每轮只减免一次，作用于本轮承受的最重一击 */
function applyKnightGuard(all, hits) {
  for (const k of all) {
    if (!k.alive || k.kind !== 'hero' || k.heroId !== 'knight' || k.guardedThisRound) continue;
    const own = hits.filter(h => h.target === k);
    if (!own.length) continue;
    own.sort((a, b) => b.dmg - a.dmg);
    own[0].dmg = Math.round(own[0].dmg * 0.55);
    k.guardedThisRound = true;
  }
}

/** 同归于尽：互相击杀时速度高者以 1 HP 存活 */
function resolveMutualKills(hits, died) {
  if (!died.length) return;
  const killersOf = new Map();
  for (const h of hits) {
    const list = killersOf.get(h.target);
    if (list) list.push(h.attacker);
    else killersOf.set(h.target, [h.attacker]);
  }
  const deadSet = new Set(died);
  const revived = new Set();
  const ordered = died.slice().sort((a, b) => (b.speed - a.speed) || (b.atk - a.atk));

  for (const d of ordered) {
    if (d.alive || revived.has(d.uid)) continue;
    const killers = (killersOf.get(d) || [])
      .filter(a => a !== d && deadSet.has(a) && !a.alive && !revived.has(a.uid));
    if (!killers.length) continue;

    // 速度高者存活；速度相同比攻击力；完全相同则双方阵亡
    const group = [d].concat(killers)
      .sort((a, b) => (b.speed - a.speed) || (b.atk - a.atk));
    const top = group[0], second = group[1];
    if (!second || (top.speed === second.speed && top.atk === second.atk)) continue;

    top.alive = true;
    top.hp = 1;
    revived.add(top.uid);
  }
}

function shouldCastSkill(unit, round) {
  if (unit.heroId === 'dragon') return round % 3 === 0;
  if (unit.heroId === 'elf') return round % 3 === 0;
  return false;
}

/** 技能产生的命中列表（不直接扣血） */
function skillHits(unit, enemies, events, round, textLog) {
  const out = [];
  if (unit.heroId === 'dragon') {
    const target = pickTarget(unit, enemies);
    if (!target) return out;
    const area = enemies.filter(e => Math.abs(e.x - target.x) <= 1 && Math.abs(e.y - target.y) <= 1);
    for (const e of area) {
      const h = computeHit(unit, e, 1.25);
      h.skill = '龙息';
      out.push(h);
    }
    if (textLog.length < 200) textLog.push(`龙族 龙息 → ${area.length} 个目标`);
    return out;
  }

  if (unit.heroId === 'elf') {
    const cand = enemies.filter(e => cheb(unit, e) <= unit.range)
      .sort((a, b) => b.atk - a.atk)[0];
    if (!cand) {
      const t2 = pickTarget(unit, enemies);
      if (t2 && cheb(unit, t2) <= unit.range) out.push(computeHit(unit, t2, 1));
      return out;
    }
    cand.stunned = 1;
    events.push({ t: 'skill', round, uid: unit.uid, target: cand.uid, skill: '藤蔓', x: cand.x, y: cand.y });
    if (textLog.length < 200) textLog.push(`精灵 藤蔓 定身 ${cand.name}`);
  }
  return out;
}

