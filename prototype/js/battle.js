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

    const order = all.filter(u => u.alive)
      .sort((a, b) => (b.speed - a.speed) || (a.range - b.range));

    for (const unit of order) {
      if (!unit.alive) continue;
      const enemies = all.filter(u => u.alive && u.side !== unit.side);
      if (!enemies.length) break;

      if (unit.stunned > 0) {
        unit.stunned--;
        events.push({ t: 'stun', uid: unit.uid });
        events.push({ t: 'frame', units: snapshotAll(all), round });
        continue;
      }

      if (unit.kind === 'hero' && shouldCastSkill(unit, round)) {
        castSkill(unit, enemies, all, events, round, textLog);
        events.push({ t: 'frame', units: snapshotAll(all), round });
        continue;
      }

      let target = pickTarget(unit, enemies);
      if (!target) continue;

      if (cheb(unit, target) > unit.range) {
        let steps = moveRangeOf(unit);
        while (steps-- > 0 && cheb(unit, target) > unit.range) {
          const np = stepToward(unit, target, all);
          if (!np) break;
          unit.x = np.x; unit.y = np.y;
          events.push({ t: 'frame', units: snapshotAll(all), round });
        }
        target = pickTarget(unit, all.filter(u => u.alive && u.side !== unit.side));
        if (!target) continue;
      }

      if (cheb(unit, target) <= unit.range) {
        doAttack(unit, target, all, events, round, 1, textLog);
      }
      events.push({ t: 'frame', units: snapshotAll(all), round });
    }

    const aAlive = all.some(u => u.alive && u.side === 'A');
    const bAlive = all.some(u => u.alive && u.side === 'B');
    if (!aAlive || !bAlive) break;
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

function doAttack(attacker, target, all, events, round, mult, textLog) {
  let m = mult;
  const cMod = counterMod(attacker.cls, target.cls);

  if (attacker.kind === 'hero') {
    if (attacker.heroId === 'warrior' && attacker.firstAttack) { m *= 1.8; attacker.firstAttack = false; }
    if (attacker.heroId === 'assassin' && target.hp / target.maxHp < 0.4) m *= 1.8;
    if (attacker.heroId === 'barbarian' && attacker.hp / attacker.maxHp < 0.5) m *= 1.5;
    if (attacker.heroId === 'archer') m *= 1.5;
  }

  let dmg = damageOf(attacker, target, m);

  if (target.kind === 'hero' && target.heroId === 'knight' && !target.guardedThisRound) {
    dmg = Math.round(dmg * 0.55);
    target.guardedThisRound = true;
  }

  target.hp -= dmg;
  let died = false;
  if (target.hp <= 0) { target.hp = 0; target.alive = false; died = true; }

  events.push({
    t: 'attack', round, uid: attacker.uid, target: target.uid,
    dmg, counter: cMod > 1 ? 'up' : cMod < 1 ? 'down' : 'none',
    x: target.x, y: target.y, died
  });

  if (textLog.length < 200) {
    textLog.push(`${attacker.name}${cMod > 1 ? '（克制）' : cMod < 1 ? '（被克）' : ''} → ${target.name} ${dmg}`);
  }
  if (attacker.heroId === 'warrior') attacker.firstAttack = false;
}

function shouldCastSkill(unit, round) {
  if (unit.heroId === 'dragon') return round % 3 === 0;
  if (unit.heroId === 'elf') return round % 3 === 0;
  return false;
}

function castSkill(unit, enemies, all, events, round, textLog) {
  if (unit.heroId === 'dragon') {
    const target = pickTarget(unit, enemies);
    if (!target) return;
    const area = enemies.filter(e => Math.abs(e.x - target.x) <= 1 && Math.abs(e.y - target.y) <= 1);
    for (const e of area) {
      const dmg = damageOf(unit, e, 1.25);
      e.hp -= dmg;
      const died = e.hp <= 0;
      if (died) { e.hp = 0; e.alive = false; }
      events.push({
        t: 'attack', round, uid: unit.uid, target: e.uid, dmg,
        counter: 'none', skill: '龙息', x: e.x, y: e.y, died
      });
    }
    if (textLog.length < 200) textLog.push(`龙族 龙息 → ${area.length} 个目标`);
    return;
  }

  if (unit.heroId === 'elf') {
    const cand = enemies.filter(e => cheb(unit, e) <= unit.range)
      .sort((a, b) => b.atk - a.atk)[0];
    if (!cand) {
      const t2 = pickTarget(unit, enemies);
      if (t2 && cheb(unit, t2) <= unit.range) {
        doAttack(unit, t2, all, events, round, 1, textLog);
      }
      return;
    }
    cand.stunned = 1;
    events.push({ t: 'skill', round, uid: unit.uid, target: cand.uid, skill: '藤蔓', x: cand.x, y: cand.y });
    if (textLog.length < 200) textLog.push(`精灵 藤蔓 定身 ${cand.name}`);
  }
}

/** 从战斗中移除阵亡的小兵 */
function applyBattleResult(player, result, side) {
  const alive = new Set(
    result.units.filter(u => u.side === side && u.alive).map(u => u.uid.replace(/[AB]$/, ''))
  );
  player.soldiers = player.soldiers.filter(s => alive.has(s.uid));
}
