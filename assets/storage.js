/*! 减脂记录 · 数据层 (localStorage) — 零依赖，可在 file:// 与 GitHub Pages 下运行 */
(function (global) {
  'use strict';

  var RECORDS_KEY = 'fatloss.records.v1';
  var SETTINGS_KEY = 'fatloss.settings.v1';
  var SCHEMA_VERSION = 1;
  var APP_TAG = 'fatloss-log';

  var DEFAULT_SETTINGS = {
    weeklyGoalMin: null,
    targetWeight: null,
    dailyKcal: null,
    protein: null,
    carbs: null,
    fat: null,
    theme: 'system'
  };

  var MEALS = ['早餐', '午餐', '晚餐', '加餐'];
  var EX_TYPES = ['力量', '有氧', '球类', '步行', '其他'];
  var INTENSITIES = ['低', '中', '高'];

  /* ---------------- 基础工具 ---------------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function isDateStr(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function storageAvailable() {
    try {
      var k = '__fatloss_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      console.warn('[storage] 读取失败，使用默认值:', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[storage] 写入失败:', key, e);
      if (global.FatLossApp && global.FatLossApp.toast) {
        global.FatLossApp.toast('保存失败：浏览器存储空间可能已满', 'error');
      }
      return false;
    }
  }

  function emit() {
    try {
      global.dispatchEvent(new CustomEvent('fatloss:change'));
    } catch (e) { /* 老浏览器忽略 */ }
  }

  /* ---------------- schema 与迁移 ---------------- */

  function emptyRecords() {
    return { version: SCHEMA_VERSION, exercises: [], meals: [], weights: [], customFoods: [] };
  }

  function normalizeExercise(e) {
    if (!e || !isDateStr(e.date)) return null;
    var duration = num(e.durationMin);
    if (duration === null || duration <= 0) return null;
    return {
      id: e.id || uid(),
      date: e.date,
      type: EX_TYPES.indexOf(e.type) >= 0 ? e.type : '其他',
      durationMin: Math.min(1440, Math.round(duration)),
      intensity: INTENSITIES.indexOf(e.intensity) >= 0 ? e.intensity : '',
      calories: num(e.calories),
      note: typeof e.note === 'string' ? e.note : '',
      createdAt: e.createdAt || new Date().toISOString(),
      updatedAt: e.updatedAt || e.createdAt || new Date().toISOString()
    };
  }

  function normalizeMeal(m) {
    if (!m || !isDateStr(m.date) || !m.name) return null;
    var amount = num(m.amount);
    return {
      id: m.id || uid(),
      date: m.date,
      meal: MEALS.indexOf(m.meal) >= 0 ? m.meal : '加餐',
      name: String(m.name).slice(0, 60),
      amount: amount === null ? null : amount,
      unit: typeof m.unit === 'string' ? m.unit : 'g',
      kcal: num(m.kcal),
      protein: num(m.protein),
      carbs: num(m.carbs),
      fat: num(m.fat),
      note: typeof m.note === 'string' ? m.note : '',
      createdAt: m.createdAt || new Date().toISOString(),
      updatedAt: m.updatedAt || m.createdAt || new Date().toISOString()
    };
  }

  function normalizeWeight(w) {
    if (!w || !isDateStr(w.date)) return null;
    var kg = num(w.weight);
    if (kg === null || kg <= 0 || kg > 400) return null;
    return {
      id: w.id || uid(),
      date: w.date,
      weight: Math.round(kg * 10) / 10,
      createdAt: w.createdAt || new Date().toISOString()
    };
  }

  function normalizeFood(f) {
    if (!f || !f.name) return null;
    return {
      name: String(f.name).slice(0, 40),
      unit: typeof f.unit === 'string' ? f.unit : 'g',
      kcal: num(f.kcal) || 0,
      protein: num(f.protein) || 0,
      carbs: num(f.carbs) || 0,
      fat: num(f.fat) || 0
    };
  }

  /**
   * 把任意来源的数据（旧版本、导入文件、手改过的 localStorage）收敛成当前 schema。
   * 缺字段补默认、脏数据丢弃，保证页面不会因为一条坏记录整页崩掉。
   */
  function migrateRecords(raw) {
    var out = emptyRecords();
    if (!raw || typeof raw !== 'object') return out;

    // v1 之前的扁平结构：{items:[...]} 或直接数组
    var source = raw;
    if (Array.isArray(raw)) source = { exercises: raw };

    out.version = SCHEMA_VERSION;
    out.exercises = (Array.isArray(source.exercises) ? source.exercises : []).map(normalizeExercise).filter(Boolean);
    out.meals = (Array.isArray(source.meals) ? source.meals : []).map(normalizeMeal).filter(Boolean);
    out.weights = (Array.isArray(source.weights) ? source.weights : []).map(normalizeWeight).filter(Boolean);
    out.customFoods = (Array.isArray(source.customFoods) ? source.customFoods : []).map(normalizeFood).filter(Boolean);
    return out;
  }

  function migrateSettings(raw) {
    var out = Object.assign({}, DEFAULT_SETTINGS);
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      if (raw[k] === undefined || raw[k] === null) return;
      if (k === 'theme') {
        if (['system', 'light', 'dark'].indexOf(raw[k]) >= 0) out[k] = raw[k];
      } else {
        var n = num(raw[k]);
        if (n !== null && n >= 0) out[k] = n;
      }
    });
    return out;
  }

  /* ---------------- 读写 ---------------- */

  /* 缓存按「localStorage 里的原始串」失效：别的标签页写过、或用户清过浏览器数据后，
     这里读到的才是最新值，避免用旧缓存把别人的记录覆盖掉。 */
  var cache = { records: null, recordsRaw: null, settings: null, settingsRaw: null };

  function readRaw(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  function parseRaw(raw, label) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
      console.warn('[storage] 解析失败，按空数据处理:', label, e);
      return null;
    }
  }

  function loadRecords() {
    var raw = readRaw(RECORDS_KEY);
    if (cache.records && cache.recordsRaw === raw) return cache.records;
    cache.records = migrateRecords(parseRaw(raw, RECORDS_KEY));
    cache.recordsRaw = raw;
    return cache.records;
  }

  function saveRecords(records) {
    cache.records = records;
    var ok = writeJSON(RECORDS_KEY, records);
    cache.recordsRaw = ok === false ? null : JSON.stringify(records);
    emit();
    return records;
  }

  function loadSettings() {
    var raw = readRaw(SETTINGS_KEY);
    if (cache.settings && cache.settingsRaw === raw) return cache.settings;
    cache.settings = migrateSettings(parseRaw(raw, SETTINGS_KEY));
    cache.settingsRaw = raw;
    return cache.settings;
  }

  function saveSettings(s) {
    cache.settings = migrateSettings(s);
    var ok = writeJSON(SETTINGS_KEY, cache.settings);
    cache.settingsRaw = ok === false ? null : JSON.stringify(cache.settings);
    emit();
    return cache.settings;
  }

  function invalidate() {
    cache.records = null;
    cache.recordsRaw = null;
    cache.settings = null;
    cache.settingsRaw = null;
  }

  /* ---------------- 增删改 ---------------- */

  function addExercise(data) {
    var r = loadRecords();
    var item = normalizeExercise(Object.assign({}, data, { id: uid(), createdAt: new Date().toISOString() }));
    if (!item) return null;
    r.exercises.push(item);
    saveRecords(r);
    return item;
  }

  function updateExercise(id, patch) {
    var r = loadRecords();
    for (var i = 0; i < r.exercises.length; i++) {
      if (r.exercises[i].id === id) {
        var merged = Object.assign({}, r.exercises[i], patch, { updatedAt: new Date().toISOString() });
        r.exercises[i] = normalizeExercise(merged) || r.exercises[i];
        saveRecords(r);
        return r.exercises[i];
      }
    }
    return null;
  }

  function removeExercise(id) {
    var r = loadRecords();
    var before = r.exercises.length;
    r.exercises = r.exercises.filter(function (e) { return e.id !== id; });
    saveRecords(r);
    return r.exercises.length < before;
  }

  function addMeal(data) {
    var r = loadRecords();
    var item = normalizeMeal(Object.assign({}, data, { id: uid(), createdAt: new Date().toISOString() }));
    if (!item) return null;
    r.meals.push(item);
    saveRecords(r);
    return item;
  }

  function updateMeal(id, patch) {
    var r = loadRecords();
    for (var i = 0; i < r.meals.length; i++) {
      if (r.meals[i].id === id) {
        var merged = Object.assign({}, r.meals[i], patch, { updatedAt: new Date().toISOString() });
        r.meals[i] = normalizeMeal(merged) || r.meals[i];
        saveRecords(r);
        return r.meals[i];
      }
    }
    return null;
  }

  function removeMeal(id) {
    var r = loadRecords();
    var before = r.meals.length;
    r.meals = r.meals.filter(function (m) { return m.id !== id; });
    saveRecords(r);
    return r.meals.length < before;
  }

  /** 同一天只保留一条体重记录：存在则覆盖 */
  function upsertWeight(date, kg) {
    var r = loadRecords();
    var item = normalizeWeight({ date: date, weight: kg });
    if (!item) return null;
    var idx = -1;
    for (var i = 0; i < r.weights.length; i++) if (r.weights[i].date === date) idx = i;
    if (idx >= 0) {
      item.id = r.weights[idx].id;
      item.createdAt = r.weights[idx].createdAt;
      r.weights[idx] = item;
    } else {
      r.weights.push(item);
    }
    saveRecords(r);
    return item;
  }

  function removeWeight(id) {
    var r = loadRecords();
    r.weights = r.weights.filter(function (w) { return w.id !== id; });
    saveRecords(r);
  }

  function addCustomFood(food) {
    var r = loadRecords();
    var item = normalizeFood(food);
    if (!item) return null;
    var exists = r.customFoods.some(function (f) { return f.name === item.name && f.unit === item.unit; });
    if (!exists) r.customFoods.push(item);
    saveRecords(r);
    return item;
  }

  /* ---------------- 查询与汇总 ---------------- */

  function byDate(date) {
    var r = loadRecords();
    return {
      exercises: r.exercises.filter(function (e) { return e.date === date; }),
      meals: r.meals.filter(function (m) { return m.date === date; }),
      weights: r.weights.filter(function (w) { return w.date === date; })
    };
  }

  function sorted(list, key) {
    return list.slice().sort(function (a, b) {
      var av = a[key] || '', bv = b[key] || '';
      if (av === bv) return (b.createdAt || '').localeCompare(a.createdAt || '');
      return av < bv ? 1 : -1;
    });
  }

  function sum(list, key) {
    return list.reduce(function (acc, x) { return acc + (num(x[key]) || 0); }, 0);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function daySummary(date) {
    var d = byDate(date);
    var kcal = sum(d.meals, 'kcal');
    var protein = sum(d.meals, 'protein');
    var carbs = sum(d.meals, 'carbs');
    var fat = sum(d.meals, 'fat');
    var weightRow = d.weights[0] || null;
    return {
      date: date,
      exercises: d.exercises,
      meals: d.meals,
      weight: weightRow ? weightRow.weight : null,
      minutes: sum(d.exercises, 'durationMin'),
      exerciseCount: d.exercises.length,
      kcal: round1(kcal),
      protein: round1(protein),
      carbs: round1(carbs),
      fat: round1(fat),
      macroKcal: round1(protein * 4 + carbs * 4 + fat * 9)
    };
  }

  function addDays(dateStr, delta) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + delta);
    return toISO(d);
  }

  function toISO(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function today() { return toISO(new Date()); }

  /** 周一为一周起点 */
  function weekStart(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var dow = (d.getDay() + 6) % 7; // 周一=0
    d.setDate(d.getDate() - dow);
    return toISO(d);
  }

  function weekMinutes(dateStr) {
    var start = weekStart(dateStr);
    var r = loadRecords();
    return round1(sum(r.exercises.filter(function (e) {
      return e.date >= start && e.date <= dateStr;
    }), 'durationMin'));
  }

  /** 返回 [start, end] 连续的日期数组 */
  function dateRange(endDate, days) {
    var out = [];
    for (var i = days - 1; i >= 0; i--) out.push(addDays(endDate, -i));
    return out;
  }

  function series(dates, fn) {
    return dates.map(function (d) { return fn(d); });
  }

  function weightSeries(dates) {
    var r = loadRecords();
    var map = {};
    r.weights.forEach(function (w) { map[w.date] = w.weight; });
    var last = null;
    return dates.map(function (d) {
      if (map[d] !== undefined) last = map[d];
      return last; // 没有记录的日子沿用上一个已知体重，折线保持连续
    });
  }

  function storageBytes() {
    var a = global.localStorage.getItem(RECORDS_KEY) || '';
    var b = global.localStorage.getItem(SETTINGS_KEY) || '';
    return (a.length + b.length) * 2; // UTF-16 近似字节数
  }

  /* ---------------- 导入导出 ---------------- */

  function buildExport() {
    return {
      app: APP_TAG,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: loadRecords(),
      settings: loadSettings()
    };
  }

  function exportJSON() {
    return JSON.stringify(buildExport(), null, 2);
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    return '\ufeff' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n') + '\r\n';
  }

  function exercisesCSV() {
    var rows = [['日期', '运动类型', '时长(分钟)', '强度', '消耗(kcal)', '备注']];
    sorted(loadRecords().exercises, 'date').forEach(function (e) {
      rows.push([e.date, e.type, e.durationMin, e.intensity, e.calories, e.note]);
    });
    return toCSV(rows);
  }

  function mealsCSV() {
    var rows = [['日期', '餐次', '食物', '数量', '单位', '热量(kcal)', '蛋白质(g)', '碳水(g)', '脂肪(g)', '备注']];
    sorted(loadRecords().meals, 'date').forEach(function (m) {
      rows.push([m.date, m.meal, m.name, m.amount, m.unit, m.kcal, m.protein, m.carbs, m.fat, m.note]);
    });
    return toCSV(rows);
  }

  function weightsCSV() {
    var rows = [['日期', '体重(kg)']];
    sorted(loadRecords().weights, 'date').forEach(function (w) { rows.push([w.date, w.weight]); });
    return toCSV(rows);
  }

  function countRecords(rec) {
    return rec.exercises.length + rec.meals.length + rec.weights.length + rec.customFoods.length;
  }

  /**
   * mode: 'merge' 按 id 去重后追加 | 'replace' 清空后写入
   */
  function importJSON(text, mode) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败：不是合法的 JSON 文件' };
    }
    var payload = parsed && parsed.records ? parsed.records : parsed;
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: '文件结构不对：缺少 records 字段' };
    }
    var incoming = migrateRecords(payload);
    if (countRecords(incoming) === 0) {
      return { ok: false, error: '文件里没有可导入的记录' };
    }

    if (mode === 'replace') {
      saveRecords(incoming);
      if (parsed && parsed.settings) saveSettings(parsed.settings);
      invalidateAfterImport();
      return { ok: true, mode: 'replace', total: countRecords(incoming) };
    }

    var cur = loadRecords();
    var seen = {};
    cur.exercises.concat(cur.meals, cur.weights).forEach(function (x) { seen[x.id] = true; });
    var added = 0;
    incoming.exercises.forEach(function (e) { if (!seen[e.id]) { cur.exercises.push(e); seen[e.id] = true; added++; } });
    incoming.meals.forEach(function (m) { if (!seen[m.id]) { cur.meals.push(m); seen[m.id] = true; added++; } });
    incoming.weights.forEach(function (w) {
      var dupDate = cur.weights.some(function (x) { return x.date === w.date; });
      if (!seen[w.id] && !dupDate) { cur.weights.push(w); seen[w.id] = true; added++; }
    });
    incoming.customFoods.forEach(function (f) {
      if (!cur.customFoods.some(function (x) { return x.name === f.name; })) cur.customFoods.push(f);
    });
    saveRecords(cur);
    invalidateAfterImport();
    return { ok: true, mode: 'merge', added: added, total: countRecords(cur) };
  }

  function invalidateAfterImport() {
    cache.records = null;
    cache.settings = null;
    loadRecords();
    loadSettings();
  }

  function clearAll() {
    try {
      global.localStorage.removeItem(RECORDS_KEY);
      global.localStorage.removeItem(SETTINGS_KEY);
    } catch (e) { /* 忽略 */ }
    invalidate();
    loadRecords();
    loadSettings();
    emit();
  }

  /* 其它标签页写入/清空后，本页缓存失效并通知界面重绘 */
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e || e.key === null || e.key === RECORDS_KEY || e.key === SETTINGS_KEY) {
        invalidate();
        emit();
      }
    });
  }

  global.FatLossStorage = {
    RECORDS_KEY: RECORDS_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MEALS: MEALS,
    EX_TYPES: EX_TYPES,
    INTENSITIES: INTENSITIES,
    available: storageAvailable,
    loadRecords: loadRecords,
    saveRecords: saveRecords,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    migrateRecords: migrateRecords,
    addExercise: addExercise,
    updateExercise: updateExercise,
    removeExercise: removeExercise,
    addMeal: addMeal,
    updateMeal: updateMeal,
    removeMeal: removeMeal,
    upsertWeight: upsertWeight,
    removeWeight: removeWeight,
    addCustomFood: addCustomFood,
    byDate: byDate,
    sorted: sorted,
    sum: sum,
    daySummary: daySummary,
    weekStart: weekStart,
    weekMinutes: weekMinutes,
    dateRange: dateRange,
    series: series,
    weightSeries: weightSeries,
    storageBytes: storageBytes,
    exportJSON: exportJSON,
    exercisesCSV: exercisesCSV,
    mealsCSV: mealsCSV,
    weightsCSV: weightsCSV,
    importJSON: importJSON,
    clearAll: clearAll,
    today: today,
    addDays: addDays
  };
})(typeof window !== 'undefined' ? window : globalThis);
