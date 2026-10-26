'use strict';

/* ============================================================
   节点搜打撤 · 数据表
   数值基准见 GAME_DESIGN.md v0.3
   ============================================================ */

const QUALITIES = [
  { key: 'white',   name: '普通', color: '#d9d9d9', value: 1,  mult: 1,  price: 10  },
  { key: 'blue',    name: '良品', color: '#5aa9e6', value: 2,  mult: 2,  price: 22  },
  { key: 'purple',  name: '稀有', color: '#b06fe0', value: 3,  mult: 3,  price: 48  },
  { key: 'gold',    name: '史诗', color: '#e8b33a', value: 5,  mult: 5,  price: 85  },
  { key: 'red',     name: '神话', color: '#e3503f', value: 8,  mult: 8,  price: 140 },
  { key: 'rainbow', name: '传说', color: '#ff7ad9', value: 12, mult: 12, price: null }
];
const QMAP = {};
QUALITIES.forEach(q => { QMAP[q.key] = q; });
const QINDEX = {};
QUALITIES.forEach((q, i) => { QINDEX[q.key] = i; });

/* ---------------- 职业与克制环 ---------------- */

const CLASSES = ['重装', '近战', '远程', '骑兵', '法术'];

// 我 → 我克制的职业
const COUNTER = {
  '重装': '近战',
  '近战': '远程',
  '远程': '骑兵',
  '骑兵': '法术',
  '法术': '重装'
};

const CLASS_COLOR = {
  '重装': '#8fa3b8',
  '近战': '#e0b34a',
  '远程': '#69c47e',
  '骑兵': '#d97a4a',
  '法术': '#a880e6'
};

const CLASS_ICON = {
  '重装': '盾',
  '近战': '剑',
  '远程': '弓',
  '骑兵': '骑',
  '法术': '法'
};

function counterMod(atkCls, defCls) {
  if (COUNTER[atkCls] === defCls) return 1.5;
  if (COUNTER[defCls] === atkCls) return 0.75;
  return 1;
}

/* ---------------- 环境与材料 ---------------- */

const ENVS = ['森林', '冰原', '平原', '沙漠', '火山'];

const ENV_MATERIALS = {
  '森林': ['硬木', '兽筋'],
  '冰原': ['兽筋', '秘银'],
  '平原': ['铁锭', '皮革'],
  '沙漠': ['皮革', '魔晶'],
  '火山': ['铁锭', '魔晶']
};

const ENV_COLOR = {
  '森林': '#2f6b45',
  '冰原': '#4a6f8c',
  '平原': '#6b7a44',
  '沙漠': '#9a7c3f',
  '火山': '#7a3a2c'
};

const MATERIAL_NAMES = ['铁锭', '皮革', '硬木', '兽筋', '魔晶', '秘银'];

/* ---------------- 节点类型 ---------------- */

const NODE_TYPES = {
  start:       { name: '入口',       color: '#4a90d9', ring: 2 },
  exit:        { name: '出口',       color: '#4ad0a0', ring: 2 },
  normal:      { name: '普通节点',   color: '#5a6270', ring: 0 },
  normalRes:   { name: '普通物资点', color: '#3f8f5a', ring: 1 },
  highRes:     { name: '高级物资点', color: '#c9a03a', ring: 1 },
  monster:     { name: '怪物点',     color: '#b3453a', ring: 1 },
  treasure:    { name: '宝藏点',     color: '#ffd76a', ring: 1 }
};

// 品质判定表（权重，缺额归蓝）
const DROP_TABLE = {
  normal:    [['white', 60], ['blue', 30], ['purple', 8], ['red', 2]],
  normalRes: [['white', 30], ['blue', 40], ['purple', 20], ['gold', 8], ['red', 1.5], ['rainbow', 0.5]],
  highRes:   [['white', 14], ['blue', 30], ['purple', 30], ['gold', 18], ['red', 5], ['rainbow', 3]],
  monster:   [['white', 10], ['blue', 20], ['purple', 30], ['gold', 22], ['red', 12], ['rainbow', 6]],
  treasure:  [['white', 5],  ['blue', 20], ['purple', 30], ['gold', 25], ['red', 12], ['rainbow', 8]]
};

// 掉落数量分布 [[数量, 权重]]
const DROP_COUNT = {
  normal:    [[0, 50], [1, 25], [2, 25]],
  normalRes: [[2, 50], [3, 50]],
  highRes:   [[3, 50], [4, 50]],
  monster:   [[3, 34], [4, 33], [5, 33]],
  treasure:  [[4, 50], [5, 50]]
};

// 装备掉落率
const EQUIP_RATE = {
  normal: 0,
  normalRes: 0.10,
  highRes: 0.35,
  monster: 0.50,
  treasure: 0.35
};

/* ---------------- 小兵 ---------------- */

const SOLDIERS = {
  '重装': {
    normal: { name: '盾卫',   price: 12, hp: 130, atk: 14, def: 14, range: 1, speed: 4 },
    elite:  { name: '重甲兵', price: 26, hp: 195, atk: 20, def: 18, range: 1, speed: 4 }
  },
  '近战': {
    normal: { name: '剑士',   price: 12, hp: 95,  atk: 24, def: 6,  range: 1, speed: 6 },
    elite:  { name: '狂战士', price: 26, hp: 140, atk: 34, def: 8,  range: 1, speed: 6 }
  },
  '远程': {
    normal: { name: '弓手',   price: 14, hp: 65,  atk: 26, def: 3,  range: 4, speed: 5 },
    elite:  { name: '长弓手', price: 30, hp: 95,  atk: 37, def: 4,  range: 5, speed: 5 }
  },
  '骑兵': {
    normal: { name: '轻骑',   price: 16, hp: 105, atk: 28, def: 4,  range: 1, speed: 9 },
    elite:  { name: '重骑',   price: 34, hp: 155, atk: 40, def: 6,  range: 1, speed: 9 }
  },
  '法术': {
    normal: { name: '学徒',   price: 16, hp: 60,  atk: 28, def: 2,  range: 3, speed: 5, pierce: true },
    elite:  { name: '法师',   price: 34, hp: 88,  atk: 40, def: 3,  range: 3, speed: 5, pierce: true }
  }
};

const MAX_SOLDIERS = 5;

/* ---------------- 英雄 ---------------- */

const HEROES = [
  { id: 'warrior',   name: '战士',   cls: '近战', hp: 230, atk: 32, def: 9,  range: 1, speed: 7,
    skill: '冲锋', desc: '本场战斗的第一次攻击伤害 +80%', tag: '前排近战' },
  { id: 'knight',    name: '骑士',   cls: '重装', hp: 300, atk: 26, def: 16, range: 1, speed: 5,
    skill: '守护', desc: '每回合首次受到的伤害 -45%', tag: '坦克' },
  { id: 'archer',    name: '射手',   cls: '远程', hp: 170, atk: 34, def: 5,  range: 5, speed: 6,
    skill: '连射', desc: '每次攻击额外造成 50% 伤害', tag: '远程单体' },
  { id: 'assassin',  name: '刺客',   cls: '近战', hp: 180, atk: 38, def: 5,  range: 1, speed: 10,
    skill: '背刺', desc: '对生命低于 40% 的目标伤害 +80%', tag: '高爆发' },
  { id: 'merchant',  name: '商人',   cls: '近战', hp: 200, atk: 28, def: 7,  range: 1, speed: 6,
    skill: '议价', desc: '商店价格 -30%', tag: '经济' },
  { id: 'elf',       name: '精灵',   cls: '远程', hp: 180, atk: 32, def: 6,  range: 5, speed: 7,
    skill: '藤蔓', desc: '每 3 回合定身射程内一名敌人 1 回合', tag: '远程/辅助' },
  { id: 'barbarian', name: '蛮族',   cls: '近战', hp: 250, atk: 34, def: 6,  range: 1, speed: 7,
    skill: '狂暴', desc: '生命低于 50% 时攻击 +50%', tag: '前排输出' },
  { id: 'dragon',    name: '龙族',   cls: '法术', hp: 240, atk: 36, def: 8,  range: 3, speed: 5,
    skill: '龙息', desc: '每 3 回合对目标及相邻格造成范围伤害', tag: '后期强力', pierce: true }
];

const HERO_TERRAIN = {
  'elf':       { env: '森林', bonus: 0.15 },
  'barbarian': { env: '冰原', bonus: 0.15 },
  'dragon':    { env: '火山', bonus: 0.15 },
  'archer':    { env: '森林', bonus: 0.10 }
};

/* ---------------- 配方（12 条具名） ---------------- */

const RECIPES = [
  { id: 'iron_sword',  name: '铁剑',     slot: 'weapon',  main: '铁锭', aux: ['皮革', '皮革'], cls: '近战' },
  { id: 'hunt_bow',    name: '猎弓',     slot: 'weapon',  main: '硬木', aux: ['兽筋', '兽筋'], cls: '远程' },
  { id: 'staff',       name: '法杖',     slot: 'weapon',  main: '魔晶', aux: ['硬木', '硬木'], cls: '法术' },
  { id: 'spear',       name: '长枪',     slot: 'weapon',  main: '硬木', aux: ['铁锭', '铁锭'], cls: '骑兵' },
  { id: 'leather',     name: '皮甲',     slot: 'armor',   main: '皮革', aux: ['兽筋', '兽筋'], cls: null },
  { id: 'chain',       name: '锁甲',     slot: 'armor',   main: '铁锭', aux: ['皮革', '皮革'], cls: null },
  { id: 'plate',       name: '板甲',     slot: 'armor',   main: '铁锭', aux: ['铁锭', '皮革'], cls: null },
  { id: 'shield',      name: '战盾',     slot: 'armor',   main: '硬木', aux: ['铁锭', '铁锭'], cls: null },
  { id: 'mithril_s',   name: '秘银剑',   slot: 'weapon',  main: '秘银', aux: ['铁锭', '铁锭'], cls: '近战' },
  { id: 'mithril_a',   name: '秘银甲',   slot: 'armor',   main: '秘银', aux: ['皮革', '皮革'], cls: null },
  { id: 'star_staff',  name: '星辉法杖', slot: 'weapon',  main: '魔晶', aux: ['秘银', '秘银'], cls: '法术' },
  { id: 'gale_bow',    name: '疾风弓',   slot: 'weapon',  main: '秘银', aux: ['兽筋', '兽筋'], cls: '远程' }
];

/* ---------------- 饰品（仅商店/掉落） ---------------- */

const TRINKETS = ['护符', '戒指', '披风'];

/* ---------------- 局外装备 ---------------- */

const META_GEAR = [
  { id: 'supply',  name: '物资箱',   desc: '行动点 +2（10 → 12）' },
  { id: 'cloak',   name: '隐秘斗篷', desc: '前 2 轮且未交战前，地图上不显示你的职业' },
  { id: 'map',     name: '寻宝图',   desc: '开局显示当前地图最高价值物资的节点位置与品质色（不含宝藏点）' }
];

/* ---------------- 商店品质分布 ---------------- */

const SHOP_QUALITY = {
  1: [['white', 40], ['blue', 45], ['purple', 15]],
  2: [['white', 10], ['blue', 40], ['purple', 40], ['gold', 10]],
  3: [['blue', 10], ['purple', 40], ['gold', 40], ['red', 10]]
};

/* ---------------- 工具 ---------------- */

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function pickWeighted(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[list.length - 1][0];
}

function rollQuality(nodeType) {
  const table = DROP_TABLE[nodeType];
  if (!table) return 'white';
  return pickWeighted(table);
}

function rollDropCount(nodeType) {
  const dist = DROP_COUNT[nodeType];
  if (!dist) return 0;
  return parseInt(pickWeighted(dist), 10);
}

function rollMaterial(nodeType, env) {
  const pool = ENV_MATERIALS[env] || MATERIAL_NAMES;
  const n = pool[randInt(0, pool.length - 1)];
  return { n, q: rollQuality(nodeType) };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
