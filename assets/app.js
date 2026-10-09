/*! 减脂记录 · 共享 UI 逻辑：路由高亮、提示、确认框、下载、食物库、主题 */
(function (global) {
  'use strict';

  var S = global.FatLossStorage;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var d = digits === undefined ? 0 : digits;
    var v = Number(n).toFixed(d);
    return v.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dateLabel(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }

  function shortDate(dateStr) {
    var p = dateStr.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  function relativeDay(dateStr) {
    var t = S.today();
    if (dateStr === t) return '今天';
    if (dateStr === S.addDays(t, -1)) return '昨天';
    if (dateStr === S.addDays(t, 1)) return '明天';
    return '';
  }

  /* ---------------- 提示与确认 ---------------- */

  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' toast-' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  function confirmDialog(opts) {
    var o = typeof opts === 'string' ? { text: opts } : (opts || {});
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-mask';
      wrap.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<h3>' + escapeHtml(o.title || '确认操作') + '</h3>' +
        '<p>' + escapeHtml(o.text || '') + '</p>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-act="cancel">取消</button>' +
        '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' +
        escapeHtml(o.okText || '确定') + '</button>' +
        '</div></div>';
      function close(val) {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      wrap.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        else if (act === 'cancel' || e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      var ok = wrap.querySelector('[data-act="ok"]');
      if (ok) ok.focus();
    });
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  function stamp() { return S.today(); }

  /* ---------------- 主题 ---------------- */

  function applyTheme() {
    var theme = S.loadSettings().theme || 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var dark = theme === 'dark' ||
        (theme === 'system' && global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
      meta.setAttribute('content', dark ? '#111513' : '#16a34a');
    }
  }

  /* ---------------- 导航 ---------------- */

  var NAV = [
    { href: 'index.html', label: '今日', icon: '🏠' },
    { href: 'log.html', label: '记录', icon: '✍️' },
    { href: 'stats.html', label: '统计', icon: '📈' },
    { href: 'settings.html', label: '设置', icon: '⚙️' }
  ];

  function renderNav(active) {
    var host = $('#nav');
    if (!host) return;
    var file = active || (location.pathname.split('/').pop() || 'index.html');
    host.innerHTML = NAV.map(function (n) {
      var on = n.href === file ? ' active' : '';
      return '<a class="nav-link' + on + '" href="' + n.href + '">' +
        '<span class="nav-icon" aria-hidden="true">' + n.icon + '</span>' +
        '<span class="nav-text">' + n.label + '</span></a>';
    }).join('');
  }

  /* ---------------- 食物库 ---------------- */

  // fetch('data/foods.json') 在 file:// 下会被浏览器拦掉，这里内嵌一份最小兜底库
  var FALLBACK_FOODS = [
    { name: '燕麦(干)', unit: 'g', kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
    { name: '米饭(生米)', unit: 'g', kcal: 346, protein: 7.4, carbs: 77.9, fat: 0.8 },
    { name: '鸡胸肉(生)', unit: 'g', kcal: 133, protein: 24.6, carbs: 0.6, fat: 3.2 },
    { name: '鸡蛋', unit: '个', kcal: 78, protein: 6.3, carbs: 0.6, fat: 5.3 },
    { name: '牛肉(瘦,生)', unit: 'g', kcal: 143, protein: 20.2, carbs: 1.2, fat: 6.2 },
    { name: '红薯', unit: 'g', kcal: 86, protein: 1.6, carbs: 20.1, fat: 0.1 },
    { name: '西兰花', unit: 'g', kcal: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
    { name: '橄榄油', unit: 'g', kcal: 884, protein: 0, carbs: 0, fat: 100 },
    { name: '混合坚果', unit: 'g', kcal: 600, protein: 18, carbs: 20, fat: 52 },
    { name: '蓝莓', unit: 'g', kcal: 57, protein: 0.7, carbs: 14.5, fat: 0.3 }
  ];

  var foodsCache = null;

  function loadFoods(force) {
    if (foodsCache && !force) return Promise.resolve(foodsCache);
    return fetch('data/foods.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (list) {
        return Array.isArray(list) ? list : FALLBACK_FOODS.slice();
      })
      .catch(function () {
        console.warn('[app] 食物库加载失败（file:// 打开时正常），已使用内置兜底食物库');
        return FALLBACK_FOODS.slice();
      })
      .then(function (list) {
        var custom = (S.loadRecords().customFoods || []).map(function (f) {
          return Object.assign({}, f, { custom: true });
        });
        foodsCache = list.map(function (f) { return Object.assign({}, f, { custom: false }); }).concat(custom);
        return foodsCache;
      });
  }

  /** 食物基准：unit 为 'g' 时数值是每 100g；其他单位（个/份/ml）为每 1 单位 */
  function calcNutrients(food, amount) {
    var a = parseFloat(amount);
    if (!food || !isFinite(a) || a <= 0) return { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    var factor = food.unit === 'g' ? a / 100 : a;
    return {
      kcal: Math.round((food.kcal || 0) * factor),
      protein: Math.round((food.protein || 0) * factor * 10) / 10,
      carbs: Math.round((food.carbs || 0) * factor * 10) / 10,
      fat: Math.round((food.fat || 0) * factor * 10) / 10
    };
  }

  /* ---------------- 小工具 ---------------- */

  function pct(part, whole) {
    if (!whole || !isFinite(whole) || whole <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
  }

  function progressHtml(value, goal, label) {
    var p = pct(value, goal);
    return '<div class="progress"><div class="progress-bar" style="width:' + p + '%"></div></div>' +
      '<div class="progress-meta"><span>' + escapeHtml(label || '') + '</span><span>' + p + '%</span></div>';
  }

  function flash(msg) { toast(msg, 'ok'); }

  global.FatLossApp = {
    $: $, $$: $$, escapeHtml: escapeHtml, fmtNum: fmtNum,
    dateLabel: dateLabel, shortDate: shortDate, relativeDay: relativeDay,
    toast: toast, confirmDialog: confirmDialog, download: download, stamp: stamp,
    applyTheme: applyTheme, renderNav: renderNav,
    loadFoods: loadFoods, calcNutrients: calcNutrients,
    pct: pct, progressHtml: progressHtml, flash: flash,
    MEAL_ORDER: S.MEALS
  };
})(typeof window !== 'undefined' ? window : globalThis);
