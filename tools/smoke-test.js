/**
 * 数据层自测：node tools/smoke-test.js
 * 用内存 localStorage 顶替浏览器环境，验证 CRUD、schema 迁移、导入导出与统计汇总。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---- 浏览器环境替身 ---- */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
};
globalThis.dispatchEvent = () => true;
globalThis.window = globalThis;

require(path.join(__dirname, '..', 'assets', 'storage.js'));
const S = globalThis.FatLossStorage;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

console.log('数据层自测');

test('新增运动记录并写入 localStorage', () => {
  S.clearAll();
  const e = S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 45, intensity: '中' });
  assert.ok(e.id, '应生成 id');
  assert.strictEqual(S.loadRecords().exercises.length, 1);
  assert.ok(localStorage.getItem(S.RECORDS_KEY).includes('"durationMin":45'));
});

test('非法运动记录被拒绝（时长 <= 0）', () => {
  assert.strictEqual(S.addExercise({ date: '2026-10-09', type: '有氧', durationMin: 0 }), null);
  assert.strictEqual(S.addExercise({ date: 'not-a-date', type: '有氧', durationMin: 30 }), null);
});

test('运动时长上限裁剪到 1440 分钟', () => {
  const e = S.addExercise({ date: '2026-10-08', type: '步行', durationMin: 9999 });
  assert.strictEqual(e.durationMin, 1440);
});

test('新增饮食并汇总当日营养', () => {
  S.addMeal({ date: '2026-10-09', meal: '午餐', name: '鸡胸肉(生)', amount: 150, unit: 'g', kcal: 180, protein: 34.5, carbs: 1.5, fat: 3.8 });
  S.addMeal({ date: '2026-10-09', meal: '早餐', name: '燕麦片(干)', amount: 70, unit: 'g', kcal: 272, protein: 11.8, carbs: 46.4, fat: 4.8 });
  const s = S.daySummary('2026-10-09');
  assert.strictEqual(s.meals.length, 2);
  assert.strictEqual(s.kcal, 452);
  assert.strictEqual(s.protein, 46.3);
  assert.strictEqual(s.minutes, 45);
});

test('同一天体重重复保存为覆盖而不是新增', () => {
  S.upsertWeight('2026-10-09', 72.4);
  S.upsertWeight('2026-10-09', 72.1);
  const w = S.loadRecords().weights;
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].weight, 72.1);
});

test('更新与删除记录', () => {
  const e = S.addExercise({ date: '2026-10-07', type: '有氧', durationMin: 30 });
  assert.strictEqual(S.updateExercise(e.id, { durationMin: 50 }).durationMin, 50);
  assert.ok(S.removeExercise(e.id));
  assert.strictEqual(S.loadRecords().exercises.filter(x => x.id === e.id).length, 0);
});

test('周运动时长按周一起算', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-05', type: '力量', durationMin: 40 }); // 周一
  S.addExercise({ date: '2026-10-08', type: '有氧', durationMin: 30 }); // 周四
  S.addExercise({ date: '2026-10-04', type: '步行', durationMin: 60 }); // 上周日，不计入
  assert.strictEqual(S.weekStart('2026-10-08'), '2026-10-05');
  assert.strictEqual(S.weekMinutes('2026-10-08'), 70);
});

test('脏数据迁移：丢弃坏记录、补齐缺字段', () => {
  const dirty = {
    exercises: [{ date: '2026-10-09', durationMin: '30' }, { date: 'bad', durationMin: 10 }, {}],
    meals: [{ date: '2026-10-09', name: 'x' }],
    weights: [{ date: '2026-10-09', weight: '70.55' }]
  };
  const clean = S.migrateRecords(dirty);
  assert.strictEqual(clean.exercises.length, 1);
  assert.strictEqual(clean.exercises[0].durationMin, 30);
  assert.strictEqual(clean.exercises[0].type, '其他');
  assert.strictEqual(clean.meals[0].meal, '加餐');
  assert.strictEqual(clean.weights[0].weight, 70.6);
  assert.strictEqual(clean.version, S.SCHEMA_VERSION);
});

test('数组形式的旧数据也能迁移', () => {
  const clean = S.migrateRecords([{ date: '2026-10-09', durationMin: 20 }]);
  assert.strictEqual(clean.exercises.length, 1);
});

test('JSON 导出 → 清空 → 覆盖导入，数据无损', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 45 });
  S.addMeal({ date: '2026-10-09', meal: '午餐', name: '米饭(生米)', amount: 93, unit: 'g', kcal: 322 });
  S.upsertWeight('2026-10-09', 72.4);
  const snapshot = S.exportJSON();

  S.clearAll();
  assert.strictEqual(S.loadRecords().exercises.length, 0);

  const res = S.importJSON(snapshot, 'replace');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(S.loadRecords().exercises.length, 1);
  assert.strictEqual(S.loadRecords().meals.length, 1);
  assert.strictEqual(S.loadRecords().weights[0].weight, 72.4);
});

test('合并导入按 id 去重，不会翻倍', () => {
  const snapshot = S.exportJSON();
  const before = S.loadRecords().exercises.length;
  S.importJSON(snapshot, 'merge');
  assert.strictEqual(S.loadRecords().exercises.length, before);
});

test('非法导入被拒绝并给出原因', () => {
  assert.strictEqual(S.importJSON('{ not json', 'merge').ok, false);
  assert.strictEqual(S.importJSON('{"foo":1}', 'merge').ok, false);
  assert.strictEqual(S.importJSON('{"records":{"exercises":[]}}', 'merge').ok, false);
});

test('CSV 导出含表头与数据行，逗号字段被转义', () => {
  const csv = S.mealsCSV();
  assert.ok(csv.startsWith('\ufeff'), '应带 BOM');
  assert.ok(csv.includes('日期,餐次,食物'));
  assert.ok(csv.includes('米饭(生米)'));
  S.addMeal({ date: '2026-10-10', meal: '晚餐', name: '带,逗号的名称', amount: 1, unit: '份' });
  assert.ok(S.mealsCSV().includes('"带,逗号的名称"'));
});

test('体重序列对空缺日期沿用上一个值', () => {
  S.clearAll();
  S.upsertWeight('2026-10-07', 73);
  S.upsertWeight('2026-10-09', 72);
  const series = S.weightSeries(['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepStrictEqual(series, [73, 73, 72]);
});

test('换档系数换算与视频示例一致（85kg × 2–3 小时档）', () => {
  // 视频口径：碳水 2.2 / 蛋白 1.4 / 脂肪 0.8 g·kg⁻¹
  const raw = [Math.round(85 * 2.2), Math.round(85 * 1.4), Math.round(85 * 0.8)];
  assert.deepStrictEqual(raw, [187, 119, 68]);
  // 口播把蛋白取整成 120 g，任务一文档沿用视频的 120 g
  assert.strictEqual(Math.round(raw[1] / 5) * 5, 120);
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（有失败）' : '，全部通过'));
