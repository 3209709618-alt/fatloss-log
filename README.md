# 减脂记录 · GitHub Pages 本地版

纯静态的个人减脂记录网站：记录**每日运动时长**与**每日饮食**，带统计图表与数据导出。
零依赖、零构建，直接扔到 GitHub Pages 就能用；所有数据只存在你自己的浏览器里。

## 功能

| 页面 | 作用 |
|---|---|
| `index.html` | 今日看板：今日运动总时长、摄入热量与三大营养素、体重、本周目标进度、最近 7 天运动柱状图 |
| `log.html` | 记录页：顶部对称日期栏（‹ 日期 ›，点中间弹系统日期选择器），运动 / 饮食 / 体重三个分区，支持编辑、删除、复制昨天 |
| `history.html` | 历史页：月历视图，有记录的日子显示运动分钟徽标、运动类型与三色圆点；点某天在下方看当天明细，可跳去编辑 |
| `stats.html` | 统计页：体重趋势折线、每日运动柱状（含日均目标线）、每日摄入柱状（含热量目标线）、营养素占比环形、区间明细表 |
| `settings.html` | 设置页：周运动目标 / 目标体重 / 热量与营养素目标、深浅色主题、JSON 备份、CSV 导出、JSON 导入（合并或覆盖）、清空数据 |

细节：

- 运动字段：日期、类型、时长（分钟）、强度、消耗（可选）、备注。
- 饮食字段：日期、餐次、食物名称、数量 + 单位、热量、蛋白质、碳水、脂肪、备注；从内置食物库选择可自动换算营养。
- 食物库：`data/foods.json`，61 种常见食物；也可把常吃的东西「保存为自定义食物」。
- 存储：`localStorage`，键名 `fatloss.records.v1` / `fatloss.settings.v1`，带 schema 版本与迁移逻辑。
- 多标签页安全：读取缓存按 localStorage 里的原始串失效，并监听 `storage` 事件；同一浏览器开多个标签页不会互相覆盖记录。
- 导出：JSON 全量备份；运动 / 饮食 / 体重三张 CSV（带 BOM，Excel 直接打开不乱码）。
- 无网络请求、无统计脚本、无账号体系。

## 目录结构

```
fatloss-log/
├── index.html              今日看板
├── log.html                记录页
├── history.html            历史页（月历）
├── stats.html              统计页
├── settings.html           设置页
├── 404.html                Pages 兜底页
├── favicon.svg             站点图标
├── manifest.webmanifest    可「添加到主屏幕」
├── .nojekyll               关闭 Jekyll 处理，保证静态资源原样发布
├── assets/
│   ├── app.js              共享 UI：导航、提示、确认框、下载、食物库、主题
│   ├── storage.js          数据层：localStorage 读写、schema 迁移、导入导出
│   ├── charts.js           轻量 Canvas 图表：折线 / 柱状 / 环形
│   └── style.css           样式（移动优先 + 深色模式）
├── data/
│   └── foods.json          常见食物营养库
├── images/
│   └── tableA-coefficients.png  换算系数表 A（手机可保存的图片版）
└── tools/
    └── smoke-test.js       数据层自测脚本（不参与站点运行）
```

## 本地预览

`fetch('data/foods.json')` 在 `file://` 下会被浏览器拦截（页面仍可用，会退回内置的少量兜底食物），所以推荐起一个静态服务器：

```bash
cd fatloss-log
python -m http.server 8000
# 打开 http://localhost:8000
```

数据层自测（需要 Node）：

```bash
node tools/smoke-test.js
```

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库，例如 `fatloss-log`（公开仓库才能用免费的 Pages）。
2. 本地初始化并推送：

   ```bash
   cd fatloss-log
   git init
   git add .
   git commit -m "feat: 减脂记录网站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/fatloss-log.git
   git push -u origin main
   ```

3. 仓库页面 `Settings → Pages`：`Source` 选 `Deploy from a branch`，`Branch` 选 `main`、目录选 `/(root)`，保存。
4. 等 1–2 分钟，访问 `https://<你的用户名>.github.io/fatloss-log/`。
5. 手机打开同一地址，用浏览器菜单里的「添加到主屏幕」，就能像 App 一样用。

之后每次 `git push` 到 `main`，Pages 会自动重新发布。

## 数据结构

```json
{
  "version": 1,
  "exercises": [{ "id": "…", "date": "2026-10-09", "type": "力量", "durationMin": 45, "intensity": "中", "calories": 300, "note": "", "createdAt": "…", "updatedAt": "…" }],
  "meals": [{ "id": "…", "date": "2026-10-09", "meal": "午餐", "name": "鸡胸肉(生)", "amount": 150, "unit": "g", "kcal": 180, "protein": 34.5, "carbs": 1.5, "fat": 3.8, "note": "", "createdAt": "…", "updatedAt": "…" }],
  "weights": [{ "id": "…", "date": "2026-10-09", "weight": 72.4, "createdAt": "…" }],
  "customFoods": [{ "name": "自制鸡胸沙拉", "unit": "份", "kcal": 320, "protein": 35, "carbs": 12, "fat": 14 }]
}
```

导入时会经过 `migrateRecords()` 收敛：缺字段补默认、日期非法或时长为 0 的记录直接丢弃，因此手改过的旧数据也不会把页面弄崩。
体重折线对「没有记录的日子」沿用上一个已知体重，只为让曲线连续——图表上的点仍是真实记录值。

## 隐私

数据全部在浏览器本地，不经过任何服务器。换设备时用「设置 → 导出全部数据（JSON）」再在新设备导入。
清空数据只影响本机浏览器。

所以这个站点可以放心分享给朋友：大家打开的是同一个网址，但记录存在各自的浏览器里，互相看不到对方的数据，也不需要注册登录。目标值（周运动目标、目标体重、热量与营养素目标）默认全部留空，每人在「设置」里填自己的即可。

## 说明

内置食物营养值为常见食物成分表的近似值，仅供记录参考，不构成医疗或营养建议；需要精确值时请手动修改，或保存自己的自定义食物。
