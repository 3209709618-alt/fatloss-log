/*! 减脂记录 · 轻量 Canvas 图表（零依赖，自适应 + 深色模式）：折线 / 柱状 / 环形 */
(function (global) {
  'use strict';

  var PALETTE = {
    brand: '#16a34a',
    weight: '#2563eb',
    kcal: '#f97316',
    protein: '#3b82f6',
    carbs: '#f59e0b',
    fat: '#ef4444'
  };

  var FONT = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function colors() {
    return {
      grid: cssVar('--chart-grid', 'rgba(128,138,134,.22)'),
      axis: cssVar('--text-dim', '#6b7280'),
      strong: cssVar('--text', '#111827'),
      card: cssVar('--bg-elev', '#ffffff'),
      border: cssVar('--line', '#e5e7eb')
    };
  }

  function setup(canvas, height) {
    var dpr = global.devicePixelRatio || 1;
    var w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 320;
    var h = height || Number(canvas.getAttribute('data-height')) || 220;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    return { ctx: ctx, w: w, h: h };
  }

  function niceMax(max) {
    if (!isFinite(max) || max <= 0) return 10;
    var exp = Math.floor(Math.log10(max));
    var base = Math.pow(10, exp);
    var n = max / base;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * base;
  }

  function emptyNote(ctx, w, h, text) {
    ctx.fillStyle = colors().axis;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT;
    ctx.fillText(text || '暂无数据', w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  function labelStep(count, maxTicks) {
    return Math.max(1, Math.ceil(count / (maxTicks || 6)));
  }

  /* ---------------- 折线图 ---------------- */
  // cfg: { labels:[], series:[{name,data:[num|null],color,fill}], unit, height, fmt }
  function line(canvas, cfg) {
    canvas.__cfg = cfg;
    var s = setup(canvas, cfg.height);
    var ctx = s.ctx, w = s.w, h = s.h, C = colors();
    var labels = cfg.labels || [];
    var series = (cfg.series || []).filter(function (x) { return x && x.data; });

    var flat = [];
    series.forEach(function (x) { x.data.forEach(function (v) { if (typeof v === 'number' && isFinite(v)) flat.push(v); }); });
    if (!flat.length) { emptyNote(ctx, w, h, cfg.emptyText); return; }

    var padL = 46, padR = 12, padT = 14, padB = 26;
    var iw = Math.max(10, w - padL - padR);
    var ih = Math.max(10, h - padT - padB);

    var dataMin = Math.min.apply(null, flat);
    var dataMax = Math.max.apply(null, flat);
    var pad = (dataMax - dataMin) * 0.15 || Math.max(1, dataMax * 0.1);
    var lo = typeof cfg.min === 'number' ? cfg.min : dataMin - pad;
    var hi = typeof cfg.max === 'number' ? cfg.max : dataMax + pad;
    if (hi === lo) hi = lo + 1;

    var xAt = function (i) { return padL + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw); };
    var yAt = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };

    // 网格与 Y 轴
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.axis;
    ctx.lineWidth = 1;
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = lo + ((hi - lo) * t) / ticks;
      var y = Math.round(yAt(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + iw, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.fmt ? cfg.fmt(v) : String(Math.round(v)), padL - 8, y);
    }

    // X 轴标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var step = labelStep(labels.length, 6);
    for (var i = 0; i < labels.length; i++) {
      if (i % step !== 0 && i !== labels.length - 1) continue;
      ctx.fillText(labels[i], Math.min(Math.max(xAt(i), padL + 8), padL + iw - 8), padT + ih + 6);
    }

    // 曲线
    series.forEach(function (sr) {
      var color = sr.color || PALETTE.brand;
      var pts = [];
      sr.data.forEach(function (v, idx) {
        if (typeof v === 'number' && isFinite(v)) pts.push({ x: xAt(idx), y: yAt(v), v: v, i: idx });
      });
      if (!pts.length) return;

      if (sr.fill !== false) {
        var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
        grad.addColorStop(0, hexA(color, 0.22));
        grad.addColorStop(1, hexA(color, 0.02));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT + ih);
        pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
        ctx.lineTo(pts[pts.length - 1].x, padT + ih);
        ctx.closePath();
        ctx.fill();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(function (p, idx) { idx ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();

      if (pts.length <= 40) {
        pts.forEach(function (p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = C.card;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.lineWidth = 2;
        });
      }
    });

    drawHover(canvas, ctx, cfg, { padL: padL, padT: padT, iw: iw, ih: ih, xAt: xAt, yAt: yAt, series: series, labels: labels });
  }

  /* ---------------- 柱状图 ---------------- */
  // cfg: { labels, data:[num], color, goal, goalLabel, unit, height, fmt }
  function bars(canvas, cfg) {
    canvas.__cfg = cfg;
    var s = setup(canvas, cfg.height);
    var ctx = s.ctx, w = s.w, h = s.h, C = colors();
    var labels = cfg.labels || [];
    var data = (cfg.data || []).map(function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; });

    if (!data.some(function (v) { return v > 0; }) && !cfg.goal) { emptyNote(ctx, w, h, cfg.emptyText); return; }

    var padL = 46, padR = 12, padT = 14, padB = 26;
    var iw = Math.max(10, w - padL - padR);
    var ih = Math.max(10, h - padT - padB);
    var hi = cfg.max || niceMax(Math.max.apply(null, data.concat([cfg.goal || 0])) * 1.1);
    var lo = 0;

    var yAt = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };

    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.axis;
    ctx.lineWidth = 1;
    for (var t = 0; t <= 4; t++) {
      var v = lo + ((hi - lo) * t) / 4;
      var y = Math.round(yAt(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + iw, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.fmt ? cfg.fmt(v) : String(Math.round(v)), padL - 8, y);
    }

    var slot = iw / Math.max(1, data.length);
    var bw = Math.max(2, Math.min(26, slot * 0.62));
    var color = cfg.color || PALETTE.brand;

    data.forEach(function (v, i) {
      var x = padL + slot * i + (slot - bw) / 2;
      var y = yAt(v);
      var bh = Math.max(v > 0 ? 2 : 0, padT + ih - y);
      if (bh <= 0) return;
      ctx.fillStyle = (cfg.colorFor && cfg.colorFor(v, i)) || color;
      roundRect(ctx, x, y, bw, bh, Math.min(4, bw / 2));
      ctx.fill();
    });

    if (cfg.goal) {
      var gy = Math.round(yAt(cfg.goal)) + 0.5;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = cssVar('--warn', '#d97706');
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + iw, gy);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = cssVar('--warn', '#d97706');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.goalLabel || ('目标 ' + cfg.goal), padL + 4, gy - 3);
    }

    ctx.fillStyle = C.axis;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var step = labelStep(labels.length, 7);
    labels.forEach(function (lb, i) {
      if (i % step !== 0 && i !== labels.length - 1) return;
      var cx = padL + slot * i + slot / 2;
      if (cx < padL + 10 || cx > padL + iw - 10) return;
      ctx.fillText(lb, cx, padT + ih + 6);
    });

    drawHover(canvas, ctx, cfg, {
      padL: padL, padT: padT, iw: iw, ih: ih,
      xAt: function (i) { return padL + slot * i + slot / 2; },
      yAt: yAt,
      series: [{ name: cfg.name || '数值', data: data, color: color }],
      labels: labels
    });
  }

  /* ---------------- 环形图 ---------------- */
  // cfg: { items:[{label,value,color}], centerTitle, centerValue, height }
  function donut(canvas, cfg) {
    canvas.__cfg = cfg;
    var s = setup(canvas, cfg.height || 200);
    var ctx = s.ctx, w = s.w, h = s.h, C = colors();
    var items = (cfg.items || []).filter(function (x) { return x.value > 0; });
    var total = items.reduce(function (a, b) { return a + b.value; }, 0);
    if (!total) { emptyNote(ctx, w, h, cfg.emptyText); return; }

    var cx = w / 2, cy = h / 2;
    var r = Math.min(w, h) / 2 - 8;
    var thick = Math.max(12, r * 0.34);
    var start = -Math.PI / 2;

    items.forEach(function (it) {
      var angle = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - thick / 2, start + 0.015, start + angle - 0.015);
      ctx.strokeStyle = it.color || PALETTE.brand;
      ctx.lineWidth = thick;
      ctx.lineCap = 'butt';
      ctx.stroke();
      start += angle;
    });

    ctx.fillStyle = C.strong;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(cfg.centerValue || String(Math.round(total)), cx, cy - 7);
    ctx.font = FONT;
    ctx.fillStyle = C.axis;
    ctx.fillText(cfg.centerTitle || '', cx, cy + 13);
  }

  /* ---------------- hover / touch 提示 ---------------- */
  function drawHover(canvas, ctx, cfg, geo) {
    var idx = canvas.__hover;
    if (idx === null || idx === undefined) return;
    if (idx < 0 || idx >= (geo.labels || []).length) return;
    var C = colors();
    var x = geo.xAt(idx);

    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, geo.padT);
    ctx.lineTo(x, geo.padT + geo.ih);
    ctx.stroke();
    ctx.restore();

    var lines = [geo.labels[idx]];
    var dotY = null;
    geo.series.forEach(function (sr) {
      var v = sr.data[idx];
      if (typeof v === 'number' && isFinite(v)) {
        lines.push(sr.name + '：' + fmtVal(v, cfg));
        if (sr.y != null) dotY = sr.y;
      } else {
        lines.push(sr.name + '：—');
      }
    });

    ctx.font = FONT;
    var tw = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 18;
    var th = lines.length * 16 + 12;
    var bx = Math.min(Math.max(x - tw / 2, 2), canvas.clientWidth - tw - 2);
    var by = Math.max(2, geo.padT + 4);

    ctx.fillStyle = hexA(C.strong === '#111827' ? '#111827' : '#111827', 0.85);
    roundRect(ctx, bx, by, tw, th, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach(function (l, i) { ctx.fillText(l, bx + 9, by + 7 + i * 16); });
  }

  function fmtVal(v, cfg) {
    var s = cfg.fmt ? cfg.fmt(v) : (Math.round(v * 10) / 10);
    return s + (cfg.unit ? ' ' + cfg.unit : '');
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* ---------------- 交互与自适应 ---------------- */
  function attach(canvas) {
    if (canvas.__attached) return;
    canvas.__attached = true;

    function nearest(clientX) {
      var cfg = canvas.__cfg;
      if (!cfg || !cfg.labels || !cfg.labels.length) return null;
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var n = cfg.labels.length;
      var padL = 46, padR = 12;
      var iw = Math.max(10, rect.width - padL - padR);
      var ratio = (x - padL) / iw;
      var i = Math.round(ratio * (n - 1));
      return Math.max(0, Math.min(n - 1, i));
    }

    canvas.addEventListener('mousemove', function (e) {
      var i = nearest(e.clientX);
      if (i === null || i === canvas.__hover) return;
      canvas.__hover = i;
      redraw(canvas);
    });
    canvas.addEventListener('mouseleave', function () {
      if (canvas.__hover === null || canvas.__hover === undefined) return;
      canvas.__hover = null;
      redraw(canvas);
    });
    canvas.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      var i = nearest(e.touches[0].clientX);
      if (i === null) return;
      canvas.__hover = i;
      redraw(canvas);
    }, { passive: true });

    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { redraw(canvas); });
      ro.observe(canvas.parentElement || canvas);
    } else {
      global.addEventListener('resize', function () { redraw(canvas); });
    }
  }

  function redraw(canvas) {
    if (!canvas.__cfg) return;
    var cfg = canvas.__cfg;
    if (canvas.__type === 'line') line(canvas, cfg);
    else if (canvas.__type === 'bars') bars(canvas, cfg);
    else if (canvas.__type === 'donut') donut(canvas, cfg);
  }

  function render(type, canvas, cfg) {
    if (!canvas) return;
    canvas.__type = type;
    canvas.__cfg = cfg;   // 必须先存 cfg，redraw 靠它判断是否已初始化
    attach(canvas);
    redraw(canvas);
  }

  global.Charts = {
    PALETTE: PALETTE,
    line: function (c, cfg) { render('line', c, cfg); },
    bars: function (c, cfg) { render('bars', c, cfg); },
    donut: function (c, cfg) { render('donut', c, cfg); },
    redrawAll: function () {
      Array.prototype.slice.call(document.querySelectorAll('canvas')).forEach(redraw);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
