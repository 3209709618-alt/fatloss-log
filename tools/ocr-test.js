/* ============================================================
 * ocr-test.js —— 截图导入的「文字 → 运动记录」解析器单测
 * 运行：node tools/ocr-test.js
 * 解析器是纯函数，所以能脱离浏览器直接测。
 * ============================================================ */
const Ocr = require('../assets/ocr-import.js');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '\n      ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, msg, extra) { ok(a === b, msg + '（期望 ' + JSON.stringify(b) + '，得到 ' + JSON.stringify(a) + '）', extra); }

const TODAY = '2026-10-10';
function parse(text) { return Ocr.parseWorkoutText(text, { defaultDate: TODAY }).items; }

console.log('截图导入解析器自测');

/* 1. Keep 式「运动详情页」 */
{
  const t = [
    '运动记录',
    '2026年10月9日 19:30',
    '跑步',
    '运动时长',
    '42 分钟',
    '消耗',
    '312 千卡',
    '距离 5.02 公里',
    "平均配速 6'14\"",
    '平均心率 148 次/分'
  ].join('\n');
  const items = parse(t);
  eq(items.length, 1, '详情页只产出 1 条候选');
  const it = items[0] || {};
  eq(it.date, '2026-10-09', '识别出日期');
  eq(it.type, '有氧', '跑步归到「有氧」');
  eq(it.durationMin, 42, '识别出时长 42 分钟');
  eq(it.kcal, 312, '识别出消耗 312 千卡');
  ok(/跑步/.test(it.note) && /5\.02/.test(it.note), '备注里有原始运动名与距离', it.note);
  ok(/心率/.test(it.note), '备注里带上了心率', it.note);
}

/* 2. 周列表式截图 → 多条 */
{
  const t = [
    '本周运动',
    '10月5日 力量训练 60 分钟 320 千卡',
    '10月7日 跑步 32 分钟 268 千卡',
    '10月9日 羽毛球 45 分钟 300 千卡'
  ].join('\n');
  const items = parse(t);
  eq(items.length, 3, '列表截图拆出 3 条候选');
  eq(items[0] && items[0].date, '2026-10-05', '第 1 条日期');
  eq(items[0] && items[0].type, '力量', '第 1 条是力量');
  eq(items[1] && items[1].date, '2026-10-07', '第 2 条日期');
  eq(items[2] && items[2].type, '球类', '第 3 条是球类');
}

/* 3. 小时 + 分钟 */
{
  const items = parse('游泳\n运动时长 1小时20分钟\n消耗 560 千卡');
  eq(items[0] && items[0].durationMin, 80, '1小时20分钟 → 80 分钟');
  eq(items[0] && items[0].type, '有氧', '游泳归到「有氧」');
}

/* 4. 千焦换算 */
{
  const items = parse('骑行\n时长 45 分钟\n消耗 1255 千焦');
  eq(items[0] && items[0].kcal, 300, '1255 千焦 → 300 千卡');
}

/* 5. 相对日期 */
{
  const items = parse('昨天 慢跑 30 分钟 250 大卡');
  eq(items[0] && items[0].date, '2026-10-09', '「昨天」按基准日推前一天');
  const items2 = parse('前天 快走 40 分钟');
  eq(items2[0] && items2[0].date, '2026-10-08', '「前天」推前两天');
}

/* 6. 步数 / 爬升 / 强度 */
{
  const items = parse('登山 2小时10分钟 870 千卡 爬升 520 米 12800 步 中等强度');
  const it = items[0] || {};
  eq(it.durationMin, 130, '2小时10分钟 → 130 分钟');
  eq(it.type, '步行', '登山归到「步行」');
  eq(it.intensity, '中', '识别强度');
  ok(/12800 步/.test(it.note) && /爬升/.test(it.note), '备注含步数与爬升', it.note);
}

/* 7. 单条没有时长也没有消耗 → 不产出候选 */
{
  eq(parse('今天天气不错，随便走走').length, 0, '没有可量化字段时不产出候选');
  eq(parse('').length, 0, '空文本不产出候选');
}

/* 8. 时长上限与非法值 */
{
  eq(parse('运动 1500 分钟').length, 0, '1500 分钟超出上限被拒');
  eq(parse('拉伸 0 分钟').length, 0, '0 分钟被拒');
}

/* 9. 冒号时长（只在有「时长」标签时采用） */
{
  const items = parse('瑜伽\n总时长 1:15\n消耗 200 千卡');
  eq(items[0] && items[0].durationMin, 75, '「总时长 1:15」→ 75 分钟');
}

/* 10. 单位被识别花时，按「消耗」标签兜底取数 */
{
  const items = parse('运动记录\n2026年10月9日\n跑步\n运动时长\n42 分钟\n消耗\n312 FF\n距离\n5.02 公里\n平均心率 148 次/分');
  const it = items[0] || {};
  eq(it.kcal, 312, '单位没认出来时按「消耗」标签兜底');
  eq(it.durationMin, 42, '兜底时不影响时长');
  eq(it.type, '有氧', '兜底时类型仍正确');
}

console.log('\n通过 ' + pass + ' 项' + (fail ? '，失败 ' + fail + ' 项' : '，全部通过'));
process.exit(fail ? 1 : 0);
