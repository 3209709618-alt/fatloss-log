/* ============================================================
 * ocr-import.js —— 从运动 App 截图里读出运动记录
 *
 * 设计原则：
 *   1. 全部在本机浏览器里跑（Tesseract.js + WASM），图片不上传、不需要任何密钥；
 *   2. 引擎和语言包都放在本站 assets/ocr/ 下，首次使用时才懒加载（约 8.6 MB，
 *      之后浏览器会缓存）；不依赖外部 CDN，国内网络也能用；
 *   3. 识别只是「猜」，所以结果一定先进预览表让人确认/修改，再写入记录；
 *   4. 识别不出来时把原文摊开给用户看，并保留手动填写的入口，绝不静默失败。
 * ============================================================ */
(function (global) {
  'use strict';

  var OCR_DIR = 'assets/ocr/';
  var TESSERACT_SRC = OCR_DIR + 'tesseract.min.js';
  var CORE_FILE = OCR_DIR + 'tesseract-core-simd.wasm.js';
  var CORE_FALLBACK = OCR_DIR + 'tesseract-core.wasm.js';

  /* ================= 一、文字规整 ================= */

  function normalize(text) {
    if (!text) return '';
    var s = String(text);
    s = s.replace(/[\uFF10-\uFF19]/g, function (c) {           // 全角数字
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, function (c) { // 全角字母
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/：/g, ':').replace(/．/g, '.').replace(/，/g, ',')
         .replace(/（/g, '(').replace(/）/g, ')').replace(/／/g, '/')
         .replace(/[－—–−]/g, '-').replace(/～/g, '~').replace(/[　\u00a0]/g, ' ')
         .replace(/[ \t]+/g, ' ');
    return s;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(y, m, d) {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function addDays(dateStr, delta) {
    var p = String(dateStr).split('-');
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    dt.setDate(dt.getDate() + delta);
    return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  /* ================= 二、字段提取 ================= */

  /* 运动类型：按我们站点已有的 EX_TYPES 归类；原始词另外保留进备注 */
  var TYPE_RULES = [
    ['球类', /篮球|足球|羽毛球|乒乓|网球|排球|台球|高尔夫|棒球|橄榄球|壁球|门球|毽球/],
    ['力量', /力量|举铁|撸铁|哑铃|杠铃|壶铃|深蹲|卧推|硬拉|引体|俯卧撑|卷腹|平板支撑|核心|腹肌|马甲线|臀|胸肌|背|肩|腿|手臂|自重|器械|循环训练|tabata|hiit/i],
    ['步行', /走路|步行|散步|健走|快走|徒步|暴走|爬山|登山|爬楼|楼梯|越野走/],
    ['有氧', /跑步|慢跑|快跑|跑步机|椭圆|划船|单车|骑行|动感单车|游泳|跳绳|有氧|操课|健身操|跳操|舞蹈|瑜伽|普拉提|燃脂|滑雪|滑冰|溜冰|轮滑|太极|八段锦|拉伸/]
  ];

  function matchActivity(text) {
    for (var i = 0; i < TYPE_RULES.length; i++) {
      var m = text.match(TYPE_RULES[i][1]);
      if (m) return { type: TYPE_RULES[i][0], word: m[0] };
    }
    return null;
  }

  var DUR_LABELED = [
    { re: /(\d{1,2})\s*(?:个?小时|时|h)\s*(\d{1,2})\s*(?:分钟|分|min)/i, f: function (m) { return (+m[1]) * 60 + (+m[2]); } },
    { re: /(\d{1,2})\s*(?:个?小时|时|h)\s*半/i, f: function (m) { return (+m[1]) * 60 + 30; } },
    { re: /(\d{1,2}(?:\.\d)?)\s*(?:个?小时|时|h)(?![a-zA-Z\u4e00-\u9fa5])/i, f: function (m) { return Math.round((+m[1]) * 60); } },
    { re: /(\d{1,4})\s*(?:分钟|分|min|mins|minutes)(?![a-zA-Z])/i, f: function (m) { return +m[1]; } }
  ];

  function pickDuration(text) {
    for (var i = 0; i < DUR_LABELED.length; i++) {
      var m = text.match(DUR_LABELED[i].re);
      if (m) {
        var v = Math.round(DUR_LABELED[i].f(m));
        if (v > 0 && v <= 1440) return { value: v, raw: m[0] };
      }
    }
    /* 没有「分钟/小时」字样时，才把 时长 12:30 这种冒号写法当 h:mm */
    var c = text.match(/(?:时长|用时|持续|运动时间|训练时间|总时长)[^\d]{0,8}(\d{1,2}):(\d{2})/);
    if (c) {
      var v2 = (+c[1]) * 60 + (+c[2]);
      if (v2 > 0 && v2 <= 1440) return { value: v2, raw: c[0] };
    }
    return null;
  }

  function pickKcal(text) {
    var m = text.match(/(\d{1,5}(?:\.\d+)?)\s*(?:千卡|大卡|kcal|卡路里|卡)(?![a-zA-Z])/i);
    if (m) return { value: Math.round(+m[1]), raw: m[0] };
    var kj = text.match(/(\d{1,5}(?:\.\d+)?)\s*(?:千焦|kj)(?![a-zA-Z])/i);
    if (kj) return { value: Math.round(+kj[1] / 4.184), raw: kj[0] + '（千焦换算）' };
    /* 截图里单位常被识别花（例如「消耗 312 FF」）→ 退一步只看标签后面的数字 */
    var lab = text.match(/(?:消耗|热量|卡路里|千卡|大卡|kcal|千焦|kj)[\s\S]{0,10}?(\d{1,5})(?!\d)/i);
    if (lab) {
      var v = +lab[1];
      if (v >= 20 && v <= 20000) {
        var isKj = /千焦|kj/i.test(text);
        return { value: Math.round(isKj ? v / 4.184 : v), raw: lab[0].replace(/\s+/g, ' ').trim() + (isKj ? '（千焦换算）' : '（按标签推断）') };
      }
    }
    return null;
  }

  function pickDistance(text) {
    var m = text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(?:公里|千米|km)(?![a-zA-Z])/i);
    if (m) return { km: +m[1], raw: m[0] };
    var mt = text.match(/(\d{3,5})\s*米(?![a-zA-Z])/);
    if (mt) return { km: Math.round(+mt[1] / 10) / 100, raw: mt[0] };
    return null;
  }

  function pickDate(text, def) {
    var m = text.match(/(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
    if (m) { var d1 = ymd(+m[1], +m[2], +m[3]); if (d1) return d1; }
    m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      var y = Number(String(def).slice(0, 4)) || new Date().getFullYear();
      var d2 = ymd(y, +m[1], +m[2]);
      if (d2) return d2;
    }
    m = text.match(/(?:^|\s)(\d{1,2})[-\/](\d{1,2})(?=\s|$)/);
    if (m) {
      var y2 = Number(String(def).slice(0, 4)) || new Date().getFullYear();
      var d3 = ymd(y2, +m[1], +m[2]);
      if (d3) return d3;
    }
    if (/今天|今日|刚刚|刚才/.test(text)) return def;
    if (/昨天|昨日/.test(text)) return addDays(def, -1);
    if (/前天/.test(text)) return addDays(def, -2);
    return def;
  }

  function pickIntensity(text) {
    if (/高强度|剧烈|全力|冲刺|高强/.test(text)) return '高';
    if (/中强度|中等强度|适中|中等/.test(text)) return '中';
    if (/低强度|轻松|舒缓|低强/.test(text)) return '低';
    return '';
  }

  function pickExtras(text) {
    var extras = [];
    var steps = text.match(/([\d,]{3,7})\s*步(?![a-zA-Z])/);
    if (steps) extras.push(steps[1].replace(/,/g, '') + ' 步');
    var hr = text.match(/(\d{2,3})\s*(?:次\/分|次每分|bpm)(?![a-zA-Z])/i);
    if (hr) extras.push('心率 ' + hr[1]);
    var pace = text.match(/(\d{1,2}['′]\d{1,2}["″]?\s*\/?\s*(?:公里|km)?)/i);
    if (pace) extras.push('配速 ' + pace[1].replace(/\s+/g, ''));
    var climb = text.match(/(?:爬升|累计爬升)\s*(\d{1,5})\s*米/);
    if (climb) extras.push('爬升 ' + climb[1] + '米');
    return extras;
  }

  /* ================= 三、把 OCR 文本拆成若干条运动 ================= */

  var RE_METRIC = /(\d{1,4}\s*(?:分钟|分|个?小时|时)(?![a-zA-Z]))|(\d{1,5}\s*(?:千卡|大卡|kcal|卡路里|千焦|kj))|(\d{1,3}(?:\.\d{1,2})?\s*(?:公里|千米|km))/i;
  var RE_DATE = /(\d{1,2}\s*月\s*\d{1,2})|(20\d{2}\s*[-\/.]\s*\d{1,2}\s*[-\/.]\s*\d{1,2})|今天|昨日|昨天|前天/;

  function splitBlocks(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    var blocks = [], cur = [];
    lines.forEach(function (line) {
      var curHasMetric = cur.some(function (l) { return RE_METRIC.test(l); });
      var curHasType = cur.some(function (l) { return !!matchActivity(l); });
      var isNew = cur.length && RE_METRIC.test(line) &&
        (RE_DATE.test(line) || (matchActivity(line) && curHasMetric && curHasType));
      if (isNew) { blocks.push(cur); cur = []; }
      cur.push(line);
    });
    if (cur.length) blocks.push(cur);
    return blocks.length ? blocks : [lines];
  }

  function parseBlock(block, def) {
    var text = block.join('\n');
    var dur = pickDuration(text);
    var kcal = pickKcal(text);
    var dist = pickDistance(text);
    var act = matchActivity(text);
    var date = pickDate(text, def);
    var intensity = pickIntensity(text);
    var extras = pickExtras(text);

    if (!dur && !kcal) return null;                 // 什么都没读到，交给原文兜底

    var noteParts = [];
    if (act) noteParts.push(act.word);
    if (dist) noteParts.push('约 ' + dist.km + ' 公里');
    noteParts = noteParts.concat(extras);
    var note = noteParts.join(' · ').slice(0, 40);

    var found = 0;
    if (dur) found++;
    if (kcal) found++;
    if (act) found++;
    if (dist) found++;

    return {
      date: date,
      type: act ? act.type : '有氧',
      activity: act ? act.word : '',
      durationMin: dur ? dur.value : '',
      kcal: kcal ? kcal.value : '',
      intensity: intensity,
      note: note,
      confidence: found >= 3 ? '高' : (found === 2 ? '中' : '低'),
      raw: text
    };
  }

  /**
   * 把 OCR 出来的文字解析成运动记录候选。
   * @param {string} text OCR 原文
   * @param {{defaultDate?:string}} opts defaultDate 解析不到日期时用它（一般是今天）
   * @returns {{items:Array, text:string}}
   */
  function parseWorkoutText(text, opts) {
    var raw = String(text || '');
    var norm = normalize(raw);
    var def = (opts && opts.defaultDate) || new Date().toISOString().slice(0, 10);
    var items = [];
    splitBlocks(norm).forEach(function (block) {
      var item = parseBlock(block, def);
      if (item) items.push(item);
    });
    if (!items.length) {
      var whole = parseBlock(norm.split(/\r?\n/), def);
      if (whole) items.push(whole);
    }
    /* 去掉完全重复的候选（同一张图里 OCR 出重复文本时） */
    var seen = {}, out = [];
    items.forEach(function (it) {
      var key = [it.date, it.type, it.durationMin, it.kcal, it.note].join('|');
      if (seen[key]) return;
      seen[key] = 1;
      out.push(it);
    });
    return { items: out, text: raw };
  }

  /* ================= 四、OCR 引擎（懒加载） ================= */

  var enginePromise = null;
  var progressHandler = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('加载失败：' + src)); };
      (document.head || document.body).appendChild(s);
    });
  }

  function ensureEngine(onProgress) {
    if (onProgress) progressHandler = onProgress;
    if (enginePromise) return enginePromise;
    enginePromise = loadScript(TESSERACT_SRC).then(function () {
      if (!global.Tesseract) throw new Error('OCR 引擎没有正确加载');
      var opts = {
        workerPath: OCR_DIR + 'worker.min.js',
        corePath: CORE_FILE,
        langPath: OCR_DIR,
        logger: function (m) { if (progressHandler) progressHandler(m); }
      };
      return global.Tesseract.createWorker(['chi_sim', 'eng'], 1, opts).catch(function (err) {
        /* 老设备不支持 WASM SIMD 时，退到通用核心再试一次 */
        opts.corePath = CORE_FALLBACK;
        return global.Tesseract.createWorker(['chi_sim', 'eng'], 1, opts);
      });
    }).catch(function (err) {
      enginePromise = null;   // 允许用户重试
      throw err;
    });
    return enginePromise;
  }

  var STATUS_TEXT = {
    'loading tesseract core': '正在加载识别内核…',
    'initializing tesseract': '正在初始化…',
    'loading language traineddata': '正在加载中英文语言包（约 3.7 MB，只需一次）…',
    'initializing api': '正在准备识别…',
    'recognizing text': '正在识别文字…'
  };

  function ensureEngineText(status, progress) {
    var t = STATUS_TEXT[status] || status || '';
    if (typeof progress === 'number' && progress > 0 && progress < 1 && /识别|语言包/.test(t)) {
      t += ' ' + Math.round(progress * 100) + '%';
    }
    return t;
  }

  function recognize(file) {
    return ensureEngine().then(function (worker) {
      return worker.recognize(file).then(function (res) {
        return (res && res.data && res.data.text) || '';
      });
    });
  }

  var api = {
    OCR_DIR: OCR_DIR,
    normalize: normalize,
    parseWorkoutText: parseWorkoutText,
    parseSingle: function (text, def) { return parseBlock(normalize(text).split(/\r?\n/), def); },
    ensureEngine: ensureEngine,
    ensureEngineText: ensureEngineText,
    recognize: recognize,
    isEngineLoaded: function () { return !!enginePromise; }
  };

  global.OcrImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
