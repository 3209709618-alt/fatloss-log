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

  /* 防丢数据用的辅助键：快照、损坏副本、日志、上次导出时间 */
  var SNAPSHOT_KEY = 'fatloss.snapshots.v1';
  var CORRUPT_KEY = 'fatloss.corrupt.v1';
  var LOG_KEY = 'fatloss.log.v1';
  var EXPORT_KEY = 'fatloss.lastexport.v1';
  var SNOOZE_KEY = 'fatloss.backupsnooze.v1';
  var SNAPSHOT_MAX = 6;
  var LOG_MAX = 20;

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

  /**
   * 本机存储是否真的能写：写进去、读回来、比对，再删掉。
   * 无痕模式 / 被系统限制存储时，setItem 可能抛异常或静默失效，这里都要能识别出来。
   */
  function storageAvailable() {
    try {
      var k = '__fatloss_probe__';
      var v = '1';
      global.localStorage.setItem(k, v);
      var back = global.localStorage.getItem(k);
      global.localStorage.removeItem(k);
      return back === v;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 运行状态（给界面用的诊断信息） ---------------- */

  var state = {
    lastError: null,      // { type: 'write' | 'corrupt' | 'repair', message, at }
    lastSaveAt: null,
    lastSaveOk: null,
    writeFails: 0,
    persisting: null      // null | 'asking' | 'granted' | 'denied' | 'error'
  };

  function nowIso() { return new Date().toISOString(); }

  function metaList(key) {
    try {
      var v = JSON.parse(global.localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function metaSave(key, list) {
    try { global.localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* 辅助键写不进不影响主流程 */ }
  }

  function logEvent(kind, message) {
    var list = metaList(LOG_KEY);
    list.unshift({ at: nowIso(), kind: kind, message: message });
    metaSave(LOG_KEY, list.slice(0, LOG_MAX));
  }

  function noteError(type, message) {
    state.lastError = { type: type, message: message, at: nowIso() };
    if (type === 'write') state.writeFails++;
    logEvent(type, message);
    console.warn('[storage]', type, message);
  }

  function clearError() { state.lastError = null; }

  function safeStringify(value) {
    try { return JSON.stringify(value); } catch (e) { return null; }
  }

  /**
   * 写入 + 回读校验：写成功后必须能从 localStorage 读回一模一样的字符串。
   * 只写不校验的话，无痕模式/空间满时页面会「假装保存成功」，刷新后数据全没了。
   */
  function writeJSON(key, value) {
    var str = safeStringify(value);
    if (str === null) { noteError('write', '数据无法序列化'); return false; }
    try {
      global.localStorage.setItem(key, str);
    } catch (e) {
      noteError('write', '浏览器拒绝保存（' + ((e && e.name) || '未知错误') + '）');
      return false;
    }
    var back = null;
    try { back = global.localStorage.getItem(key); } catch (e) { back = null; }
    if (back !== str) { noteError('write', '写入后校验不一致，数据可能没真正落盘'); return false; }
    return true;
  }

  function bytesSafe() {
    try {
      var a = global.localStorage.getItem(RECORDS_KEY) || '';
      var b = global.localStorage.getItem(SETTINGS_KEY) || '';
      return (a.length + b.length) * 2;
    } catch (e) { return 0; }
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
      weight: Math.round(kg * 100) / 100,
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
     这里读到的才是最新值，避免用旧缓存把别人的记录覆盖掉。
     pending=true 表示内存里有一条「没能写进磁盘」的新数据，此时界面继续显示它，
     同时顶部横幅提醒用户马上导出备份。 */
  var cache = { records: null, recordsRaw: null, settings: null, settingsRaw: null, pending: false, brokenRaw: null };

  function readRaw(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  function parseRaw(raw, label) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {
      console.warn('[storage] 解析失败:', label, e);
      return null;
    }
  }

  /** 损坏的原文留一份副本，绝不静默丢弃 */
  function quarantine(from, raw) {
    var list = metaList(CORRUPT_KEY);
    if (list.length && list[0].raw === raw) return;
    list.unshift({ at: nowIso(), from: from, raw: raw });
    metaSave(CORRUPT_KEY, list.slice(0, 3));
  }

  /**
   * 被截断的 JSON（写到一半被系统打断）通常只是结尾少了括号：
   * 从后往前找最后一个完整的 }，补上收尾括号试解析，能救回多少算多少。
   */
  function salvageRecords(raw) {
    if (typeof raw !== 'string' || raw.length < 2) return null;
    var tries = 0;
    for (var i = raw.length - 1; i > 1 && tries < 500; i--) {
      if (raw.charAt(i) !== '}') continue;
      tries++;
      var head = raw.slice(0, i + 1);
      var candidates = [head + ']}', head + ']}}', head + '}}', head + ']'];
      for (var c = 0; c < candidates.length; c++) {
        var obj = null;
        try { obj = JSON.parse(candidates[c]); } catch (e) { obj = null; }
        if (!obj) continue;
        var rec = migrateRecords(obj);
        if (countRecords(rec) > 0) return rec;
      }
    }
    return null;
  }

  function loadRecords() {
    if (cache.pending && cache.records) return cache.records;
    var raw = readRaw(RECORDS_KEY);
    if (cache.records && cache.recordsRaw === raw) return cache.records;

    // 内容存在却解析不了 = 数据损坏，先留副本再尝试抢救，绝不直接当「没有记录」
    if (raw && cache.brokenRaw !== raw && parseRaw(raw, RECORDS_KEY) === null) {
      cache.brokenRaw = raw;
      quarantine(RECORDS_KEY, raw);
      var fixed = salvageRecords(raw);
      if (fixed) {
        cache.records = fixed;
        cache.recordsRaw = writeJSON(RECORDS_KEY, fixed) ? safeStringify(fixed) : raw;
        noteError('repair', '数据损坏，已自动修复并恢复 ' + countRecords(fixed) + ' 条记录（原始内容已留副本）');
        return cache.records;
      }
      noteError('corrupt', '数据损坏且无法自动修复；原始内容已留副本，请到「设置 → 数据安全」导出');
    }

    cache.records = migrateRecords(parseRaw(raw, RECORDS_KEY));
    cache.recordsRaw = raw;
    return cache.records;
  }

  /** 每次真正写入前，把「上一版」存成快照，误删/误导入都能退回去 */
  function takeSnapshot(rawRecords, reason) {
    if (!rawRecords) return;
    var list = metaList(SNAPSHOT_KEY);
    if (list.length && list[0].raw === rawRecords) return;
    // 同一毫秒内可能连着写多次，所以快照要独立 id，不能只靠时间戳
    list.unshift({ id: uid(), at: nowIso(), reason: reason || 'save', raw: rawRecords });
    metaSave(SNAPSHOT_KEY, list.slice(0, SNAPSHOT_MAX));
  }

  function listSnapshots() {
    return metaList(SNAPSHOT_KEY).map(function (s) {
      var m = migrateRecords(parseRaw(s.raw, 'snapshot'));
      return {
        id: s.id || s.at, at: s.at, reason: s.reason || 'save',
        exercises: m.exercises.length, meals: m.meals.length, weights: m.weights.length,
        total: countRecords(m)
      };
    });
  }

  function restoreSnapshot(id) {
    var list = metaList(SNAPSHOT_KEY);
    for (var i = 0; i < list.length; i++) {
      if ((list[i].id || list[i].at) !== id) continue;
      var target = migrateRecords(parseRaw(list[i].raw, 'snapshot'));
      if (countRecords(target) === 0) return { ok: false, error: '这个快照里没有记录' };
      takeSnapshot(cache.recordsRaw || readRaw(RECORDS_KEY), 'restore');
      saveRecords(target, 'restore');
      return { ok: true, total: countRecords(target) };
    }
    return { ok: false, error: '找不到这个快照' };
  }

  function saveRecords(records, reason) {
    var prev = cache.pending ? null : cache.recordsRaw;
    var str = safeStringify(records);
    if (prev && str && prev !== str) takeSnapshot(prev, reason || 'save');
    cache.records = records;
    var ok = writeJSON(RECORDS_KEY, records);
    if (ok) {
      cache.recordsRaw = str;
      cache.pending = false;
      clearError();
    } else {
      cache.recordsRaw = null;
      cache.pending = true;   // 内存里留着，界面继续显示，但顶部会挂红条
    }
    state.lastSaveAt = nowIso();
    state.lastSaveOk = ok;
    requestPersistOnce();
    emit();
    return records;
  }

  function loadSettings() {
    var raw = readRaw(SETTINGS_KEY);
    if (cache.settings && cache.settingsRaw === raw) return cache.settings;
    if (raw && cache.settingsRaw !== raw && parseRaw(raw, SETTINGS_KEY) === null) quarantine(SETTINGS_KEY, raw);
    cache.settings = migrateSettings(parseRaw(raw, SETTINGS_KEY));
    cache.settingsRaw = raw;
    return cache.settings;
  }

  function saveSettings(s) {
    cache.settings = migrateSettings(s);
    var ok = writeJSON(SETTINGS_KEY, cache.settings);
    cache.settingsRaw = ok === false ? null : safeStringify(cache.settings);
    if (ok) clearError();
    emit();
    return cache.settings;
  }

  function invalidate() {
    cache.records = null;
    cache.recordsRaw = null;
    cache.settings = null;
    cache.settingsRaw = null;
    cache.pending = false;
    cache.brokenRaw = null;
  }

  /** 向浏览器申请「持久化存储」，降低被系统自动清理的概率 */
  function requestPersistOnce() {
    if (state.persisting || !global.navigator || !global.navigator.storage || !global.navigator.storage.persist) return;
    state.persisting = 'asking';
    try {
      global.navigator.storage.persist().then(function (granted) {
        state.persisting = granted ? 'granted' : 'denied';
        logEvent('persist', granted ? '已获得持久化存储' : '浏览器未授予持久化存储');
      }).catch(function () { state.persisting = 'error'; });
    } catch (e) { state.persisting = 'error'; }
  }

  function requestPersist() {
    state.persisting = null;
    requestPersistOnce();
    return state.persisting;
  }

  /** 给界面用的整体体检结果 */
  function diagnostics() {
    var rec = loadRecords();
    var lastExport = null;
    try { lastExport = global.localStorage.getItem(EXPORT_KEY); } catch (e) { lastExport = null; }
    return {
      origin: (global.location && global.location.origin) || '',
      available: storageAvailable(),
      pending: !!cache.pending,
      lastSaveAt: state.lastSaveAt,
      lastSaveOk: state.lastSaveOk,
      lastError: state.lastError,
      writeFails: state.writeFails,
      persisting: state.persisting,
      lastExportAt: lastExport,
      backupSnoozeUntil: (function () { try { return global.localStorage.getItem(SNOOZE_KEY); } catch (e) { return null; } })(),
      standalone: !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || (global.navigator && global.navigator.standalone === true),
      ios: /iPad|iPhone|iPod/.test((global.navigator && global.navigator.userAgent) || ''),
      counts: {
        exercises: rec.exercises.length,
        meals: rec.meals.length,
        weights: rec.weights.length,
        customFoods: rec.customFoods.length
      },
      bytes: bytesSafe(),
      snapshots: listSnapshots(),
      quarantine: metaList(CORRUPT_KEY).length,
      log: metaList(LOG_KEY).slice(0, 8),
      ua: (global.navigator && global.navigator.userAgent) || ''
    };
  }

  function quarantineText() {
    var list = metaList(CORRUPT_KEY);
    return list.length ? list[0].raw : '';
  }

  function markExported() {
    var at = nowIso();
    try { global.localStorage.setItem(EXPORT_KEY, at); } catch (e) { /* 忽略 */ }
    logEvent('export', '导出了 JSON 备份');
    return at;
  }

  /** 「7 天后再提醒」：到期前不再弹备份提醒 */
  function snoozeBackup(days) {
    var until = new Date(Date.now() + (days || 7) * 86400000).toISOString();
    try { global.localStorage.setItem(SNOOZE_KEY, until); } catch (e) { /* 忽略 */ }
    return until;
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
    return bytesSafe(); // UTF-16 近似字节数
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
    invalidate();
    loadRecords();
    loadSettings();
  }

  function clearAll() {
    // 先留一份快照，清空后还能从「设置 → 数据安全」退回来
    takeSnapshot(cache.recordsRaw || readRaw(RECORDS_KEY), 'clear');
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
    addDays: addDays,
    /* 数据安全 / 自检 */
    diagnostics: diagnostics,
    requestPersist: requestPersist,
    listSnapshots: listSnapshots,
    restoreSnapshot: restoreSnapshot,
    quarantineText: quarantineText,
    markExported: markExported,
    snoozeBackup: snoozeBackup
  };
})(typeof window !== 'undefined' ? window : globalThis);
