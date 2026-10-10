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

test('别的标签页改过数据后，本页读到的是最新值（缓存按原始串失效）', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 10 });
  assert.strictEqual(S.loadRecords().exercises.length, 1);
  const external = {
    version: 1,
    exercises: [{ id: 'ext1', date: '2026-10-08', type: '有氧', durationMin: 20, createdAt: '2026-10-08T00:00:00.000Z' }],
    meals: [], weights: [], customFoods: []
  };
  localStorage.setItem(S.RECORDS_KEY, JSON.stringify(external));
  const rec = S.loadRecords();
  assert.strictEqual(rec.exercises.length, 1, '不应沿用旧缓存');
  assert.strictEqual(rec.exercises[0].id, 'ext1');
  localStorage.removeItem(S.RECORDS_KEY);
  assert.strictEqual(S.loadRecords().exercises.length, 0, '外部清空后应立即反映');
});

test('写入被拒绝时不假装成功：标记未保存、磁盘不被写空', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 10 });
  const real = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => { const e = new Error('blocked'); e.name = 'QuotaExceededError'; throw e; };
  try {
    S.addExercise({ date: '2026-10-09', type: '有氧', durationMin: 20 });
  } finally {
    localStorage.setItem = real;
  }
  const d = S.diagnostics();
  assert.strictEqual(d.lastSaveOk, false, '应记录保存失败');
  assert.strictEqual(d.pending, true, '应标记有数据没落盘');
  assert.strictEqual(d.lastError.type, 'write');
  assert.strictEqual(S.loadRecords().exercises.length, 2, '内存里仍能看到刚才那条');
  assert.strictEqual(JSON.parse(localStorage.getItem(S.RECORDS_KEY)).exercises.length, 1, '磁盘上仍是旧数据');
});

test('被截断的 JSON 会被抢救回来，并留下损坏副本', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 30 });
  S.addExercise({ date: '2026-10-09', type: '有氧', durationMin: 20 });
  const full = localStorage.getItem(S.RECORDS_KEY);
  localStorage.setItem(S.RECORDS_KEY, full.slice(0, full.length - 20)); // 模拟写到一半被打断（尾巴丢一小段）

  const rec = S.loadRecords();
  assert.strictEqual(rec.exercises.length, 2, '应救回两条运动记录');
  assert.ok(S.quarantineText().length > 0, '损坏原文应留副本');
  assert.strictEqual(S.diagnostics().lastError.type, 'repair');
  assert.strictEqual(JSON.parse(localStorage.getItem(S.RECORDS_KEY)).exercises.length, 2, '修好的数据应写回');
});

test('修不了的损坏数据留副本而不是当空数据静默覆盖', () => {
  S.clearAll();
  localStorage.setItem(S.RECORDS_KEY, 'not json at all');
  assert.strictEqual(S.loadRecords().exercises.length, 0);
  assert.ok(S.quarantineText().includes('not json at all'), '原文应留副本');
  assert.strictEqual(S.diagnostics().lastError.type, 'corrupt');
});

test('每次改动前自动留快照，可以退回上一版', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 30 });
  S.addExercise({ date: '2026-10-09', type: '有氧', durationMin: 20 });
  S.addExercise({ date: '2026-10-09', type: '步行', durationMin: 40 });
  const snaps = S.listSnapshots();
  assert.ok(snaps.length >= 2, '应有多次快照，实际 ' + snaps.length);
  const target = snaps.filter(s => s.exercises === 1)[0];
  assert.ok(target, '应能找到只有 1 条运动的快照');
  const res = S.restoreSnapshot(target.id);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(S.loadRecords().exercises.length, 1);
});

test('清空数据前也留快照，清空后能退回来', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 25 });
  S.upsertWeight('2026-10-09', 72);
  S.clearAll();
  assert.strictEqual(S.loadRecords().exercises.length, 0);
  const snap = S.listSnapshots().filter(s => s.exercises === 1)[0];
  assert.ok(snap, '清空前应有快照');
  assert.strictEqual(S.restoreSnapshot(snap.id).ok, true);
  assert.strictEqual(S.loadRecords().exercises.length, 1);
  assert.strictEqual(S.loadRecords().weights[0].weight, 72);
});

test('自检信息结构完整（origin/容量/条数/日志）', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 15 });
  const d = S.diagnostics();
  assert.strictEqual(typeof d.available, 'boolean');
  assert.strictEqual(d.counts.exercises, 1);
  assert.ok(d.bytes > 0, '占用量应为正数');
  assert.ok(Array.isArray(d.snapshots));
  assert.ok(Array.isArray(d.log));
  assert.strictEqual(typeof d.pending, 'boolean');
});

test('备份提醒：标记导出与「7 天后再提醒」都能被自检读到', () => {
  S.clearAll();
  S.addExercise({ date: '2026-10-09', type: '力量', durationMin: 15 });
  const d1 = S.diagnostics();
  assert.strictEqual(d1.backupSnoozeUntil, null, '默认没有延后提醒');
  assert.strictEqual(typeof d1.standalone, 'boolean', '应报是否「添加到主屏幕」的独立窗口');
  assert.strictEqual(typeof d1.ios, 'boolean', '应报是否 iOS');

  S.markExported();
  assert.ok(S.diagnostics().lastExportAt, '标记导出后应能看到备份时间');

  const until = S.snoozeBackup(7);
  const days = Math.round((new Date(until) - Date.now()) / 86400000);
  assert.strictEqual(days, 7, '应写 7 天后的时间，实际 ' + days);
  assert.strictEqual(S.diagnostics().backupSnoozeUntil, until, '自检应能读到延后提醒时间');
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（有失败）' : '，全部通过'));
