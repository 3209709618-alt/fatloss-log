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
    { href: 'history.html', label: '历史', cal: true },
    { href: 'stats.html', label: '统计', icon: '📈' },
    { href: 'settings.html', label: '设置', icon: '⚙️' }
  ];

  // 「历史」的图标画成日历，格子里显示当天日期（跟随系统日期）
  function todayDay() {
    return String(new Date().getDate());
  }

  function navIconHtml(n) {
    if (n.cal) {
      return '<span class="nav-icon nav-icon-cal" aria-hidden="true">' +
        '<span class="cal-ico"><i></i><b>' + todayDay() + '</b></span></span>';
    }
    return '<span class="nav-icon" aria-hidden="true">' + n.icon + '</span>';
  }

  var navDayTimer = null;

  function renderNav(active) {
    var host = $('#nav');
    if (!host) return;
    var file = active || (location.pathname.split('/').pop() || 'index.html');
    host.innerHTML = NAV.map(function (n) {
      var on = n.href === file ? ' active' : '';
      return '<a class="nav-link' + on + '" href="' + n.href + '">' +
        navIconHtml(n) +
        '<span class="nav-text">' + n.label + '</span></a>';
    }).join('');
    // 页面一直开着跨过午夜时，把日期图标刷成新的「今天」
    if (!navDayTimer) {
      var shown = todayDay();
      navDayTimer = setInterval(function () {
        if (todayDay() === shown) return;
        shown = todayDay();
        if (document.body.contains(host)) renderNav(file);
      }, 60000);
    }
    // 导航在每个页面初始化时都会渲染一次，顺手做一次存储体检
    renderStorageBanner();
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

  function daysSince(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }

  /** 复制文本：优先 Clipboard API；失败时退回 textarea + execCommand（老版本 iOS Safari 用得上） */
  function copyText(text) {
    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  }

  /* ---------------- 数据安全横幅 ----------------
     一旦本机存储写不进去（无痕模式、被系统限制、空间满）或数据损坏过，
     必须在页面上明说，不能让用户以为已经保存好了。 */

  function storageIssues() {
    var d = S.diagnostics();
    var issues = [];
    if (!d.available) {
      issues.push({ level: 'danger', text: '本机浏览器不允许保存数据（常见于无痕/隐私模式，或系统限制了存储）：现在记的内容刷新后就会消失。请立刻到「设置 → 数据安全」导出 JSON 备份。' });
    } else if (d.pending) {
      issues.push({ level: 'danger', text: '刚才这条记录没有真正写进本机存储，刷新后会消失。请到「设置 → 数据安全」导出备份，并确认没有使用无痕窗口。' });
    }
    if (d.lastError && d.lastError.type === 'corrupt') {
      issues.push({ level: 'danger', text: '本机记录损坏且无法自动修复。原始内容已留副本，请到「设置 → 数据安全」导出后联系开发者。' });
    } else if (d.lastError && d.lastError.type === 'repair') {
      issues.push({ level: 'warn', text: '本机记录曾损坏，已自动修复：' + d.lastError.message });
    }

    // 备份提醒：数据只在这台设备的这个浏览器里，没备份过（或超过 7 天）就提醒一次
    var total = d.counts.exercises + d.counts.meals + d.counts.weights;
    var snoozed = d.backupSnoozeUntil && new Date(d.backupSnoozeUntil).getTime() > Date.now();
    if (d.available && !d.pending && total > 0 && !snoozed) {
      var ago = d.lastExportAt ? daysSince(d.lastExportAt) : null;
      if (ago === null || ago >= 7) {
        issues.push({
          level: 'warn',
          backup: true,
          text: (ago === null ? '这些记录只存在这台设备的这个浏览器里，还没有备份过。' : '上次备份是 ' + ago + ' 天前。') +
            'iPhone 上换成「主屏幕图标」打开、用过无痕模式、或清除过网站数据，都会看不到原记录。建议现在复制或导出一份备份。'
        });
      }
    }
    return issues;
  }

  function onBannerClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-banner]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-banner');
    if (act === 'copy') {
      copyText(S.exportJSON()).then(function (ok) {
        if (ok) {
          S.markExported();
          toast('备份已复制：粘贴到「备忘录」或存进「文件」App 就有一份了', 'ok');
        } else {
          toast('复制失败：请到「设置 → 数据安全」下载 JSON 文件', 'error');
        }
        renderStorageBanner();
      });
    } else if (act === 'snooze') {
      S.snoozeBackup(7);
      toast('好的，7 天后再提醒');
      renderStorageBanner();
    }
  }

  function renderStorageBanner() {
    var main = $('#main') || document.body;
    var host = $('#storageBanner');
    if (!host) {
      host = document.createElement('div');
      host.id = 'storageBanner';
      main.insertBefore(host, main.firstChild);
    }
    var issues = storageIssues();
    if (!issues.length) { host.className = ''; host.innerHTML = ''; return; }
    var worst = issues.some(function (i) { return i.level === 'danger'; }) ? 'danger' : 'warn';
    var hasBackup = issues.some(function (i) { return i.backup; });
    host.className = 'banner banner-' + worst;
    host.innerHTML = issues.map(function (i) {
      return '<div class="banner-line">' + (i.level === 'danger' ? '⚠️' : 'ℹ️') + ' ' + escapeHtml(i.text) + '</div>';
    }).join('') + '<div class="banner-actions">' +
      (hasBackup ? '<button class="btn btn-primary" type="button" data-banner="copy">复制备份</button>' : '') +
      '<a class="btn" href="settings.html#safe">' + (hasBackup ? '导出 JSON' : '去导出备份') + '</a>' +
      (hasBackup ? '<button class="btn" type="button" data-banner="snooze">7 天后再提醒</button>' : '') +
      '</div>';
    if (!host.__wired) {
      host.__wired = true;
      host.addEventListener('click', onBannerClick);
    }
  }

  if (global.addEventListener) global.addEventListener('fatloss:change', renderStorageBanner);

  global.FatLossApp = {
    $: $, $$: $$, escapeHtml: escapeHtml, fmtNum: fmtNum,
    dateLabel: dateLabel, shortDate: shortDate, relativeDay: relativeDay,
    toast: toast, confirmDialog: confirmDialog, download: download, stamp: stamp,
    applyTheme: applyTheme, renderNav: renderNav,
    loadFoods: loadFoods, calcNutrients: calcNutrients,
    pct: pct, progressHtml: progressHtml, flash: flash,
    copyText: copyText, daysSince: daysSince,
    storageIssues: storageIssues, renderStorageBanner: renderStorageBanner,
    MEAL_ORDER: S.MEALS
  };
})(typeof window !== 'undefined' ? window : globalThis);
