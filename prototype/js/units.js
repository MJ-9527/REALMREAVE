'use strict';

/* ============================================================
   角色 / 小兵 / 装备实例
   ============================================================ */

let unitSeq = 0;

function makeSoldier(cls, tier) {
  const def = SOLDIERS[cls][tier];
  return {
    uid: 'u' + (++unitSeq),
    kind: 'soldier',
    cls,
    tier,
    name: def.name,
    maxHp: def.hp,
    atk: def.atk,
    def: def.def,
    range: def.range,
    speed: def.speed,
    pierce: !!def.pierce,
    level: 1,
    x: 0, y: 0,
    hp: def.hp,
    alive: true,
    stunned: 0
  };
}

function soldierStats(cls, tier, level) {
  const def = SOLDIERS[cls][tier];
  const lv = level || 1;
  const k = 1 + (lv - 1) * 0.25;
  return {
    hp: Math.round(def.hp * k),
    atk: Math.round(def.atk * k),
    def: Math.round(def.def * k)
  };
}

function makeHero(heroId, level) {
  const base = HEROES.find(h => h.id === heroId) || HEROES[0];
  return {
    uid: 'h' + (++unitSeq),
    kind: 'hero',
    heroId: base.id,
    cls: base.cls,
    name: base.name,
    maxHp: base.hp,
    atk: base.atk,
    def: base.def,
    range: base.range,
    speed: base.speed,
    pierce: !!base.pierce,
    skill: base.skill,
    skillDesc: base.desc,
    level: level || 1,
    x: 0, y: 0,
    hp: base.hp,
    alive: true,
    stunned: 0,
    firstAttack: true,
    attackCount: 0,
    roundSeen: 0
  };
}

/* ---------------- 装备实例 ---------------- */

let equipSeq = 0;

const EQUIP_SLOT_NAME = { weapon: '武器', armor: '护甲', trinket: '饰品' };

function makeEquip(slot, qKey, name) {
  return {
    uid: 'e' + (++equipSeq),
    slot,
    quality: qKey,
    name: name || defaultEquipName(slot, qKey)
  };
}

const WEAPON_NAMES = { '近战': '剑', '远程': '弓', '法术': '法杖', '骑兵': '长枪', '重装': '战锤' };
const ARMOR_NAMES = ['皮甲', '锁甲', '板甲'];
const TRINKET_NAMES = ['护符', '戒指', '披风'];

function defaultEquipName(slot, qKey) {
  const q = QMAP[qKey];
  if (slot === 'weapon') {
    const cls = CLASSES[randInt(0, CLASSES.length - 1)];
    return q.name + (WEAPON_NAMES[cls] || '剑');
  }
  if (slot === 'armor') {
    return q.name + ARMOR_NAMES[randInt(0, 2)];
  }
  return q.name + TRINKET_NAMES[randInt(0, 2)];
}

function equipPrice(equip) {
  const q = QMAP[equip.quality];
  return q.price == null ? 999 : q.price;
}

/** 装备对英雄的加成 */
function equipBonus(equips) {
  let atk = 0, hp = 0, def = 0;
  for (const e of equips) {
    if (!e) continue;
    const m = QMAP[e.quality].mult;
    if (e.slot === 'weapon') atk += 4 * m;
    else if (e.slot === 'armor') { hp += 12 * m; def += 2 * m; }
    else { atk += 1.5 * m; hp += 6 * m; def += 1 * m; }
  }
  return { atk: Math.round(atk), hp: Math.round(hp), def: Math.round(def) };
}

/** 把装备加成后的英雄单位用于战斗 */
function heroToBattleUnit(player) {
  const h = makeHero(player.heroId, player.heroLevel);
  const b = equipBonus(player.equips);
  h.maxHp += b.hp;
  h.hp = h.maxHp;
  h.atk += b.atk;
  h.def += b.def;
  return h;
}

/* ---------------- 玩家 ---------------- */

function makePlayer(id, isHuman, heroId) {
  return {
    id,
    isHuman,
    heroId,
    heroLevel: 1,
    name: HEROES.find(h => h.id === heroId).name,
    cls: HEROES.find(h => h.id === heroId).cls,
    ap: 0,
    apMax: 10,
    materials: [],          // {n, q}
    credit: 0,              // 找零（物资点）
    equips: [null, null, null],  // weapon / armor / trinket
    soldiers: [],           // 小兵实例
    soldierLevels: { '重装': 1, '近战': 1, '远程': 1, '骑兵': 1, '法术': 1 },
    metaGear: ['supply', 'cloak'],
    mapId: null,
    mapNodeId: null,
    alive: true,
    escapedThisRound: false,
    foughtThisGame: false,
    totalValue: 0
  };
}

/** 物资折算成物资点 */
function materialsValue(list) {
  let v = 0;
  for (const it of list) v += QMAP[it.q].value;
  return v;
}

function playerValue(p) {
  let v = materialsValue(p.materials);
  for (const e of p.equips) if (e) v += Math.round(equipPrice(e) * 0.5);
  for (const s of p.soldiers) v += Math.round(SOLDIERS[s.cls][s.tier].price * 0.5);
  return v;
}

function soldierCount(p) { return p.soldiers.length; }

function canAddSoldier(p) { return p.soldiers.length < MAX_SOLDIERS; }
