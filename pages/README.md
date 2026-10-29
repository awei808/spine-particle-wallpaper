# pages/ —— GitHub Pages 展示页

把 `demo/S9_盛夏游乐场` 那个 Wallpaper Engine 工程，包装成一个**能在公网页面上直接打开**的
Demo 展示页。访客点开链接就能看到实时渲染的 Spine 壁纸，不需要装 Wallpaper Engine。

线上地址：<https://awei808.github.io/spine-particle-wallpaper/>

---

## 一、目录里有什么

```
pages/
  index.html     展示页外壳（本目录唯一的手写文件）
  README.md      本文件
```

它**不是**一个能独立打开的页面 —— 它是外壳，素材要靠 `scripts/deployPages.ts`
从 `demo/S9_盛夏游乐场/` 组装过来。拼好之后的目标目录长这样：

```
<目标目录>/
  index.html     ← pages/index.html
  bundle.js      ← demo 的构建产物
  preview.jpg    ← 入场海报背景 + og:image（一图两用）
  .nojekyll      ← 关掉 Jekyll
  assets/        ← 整个素材目录
```

**根目录必须平铺，不能套进子目录**：`src/constants.ts` 里写死了
`ASSET_PATH = './assets/'`，是相对**当前页面**的路径。页面在根，`assets/` 就必须在根。

---

## 二、展示页做了什么

### 入场门（Gate）

先出海报，点「进入」之后才注入 `bundle.js`。

这么做只有一个目的：**绕开浏览器的自动播放限制**。
`bgmPlayer` 用的是 `HTMLAudioElement.play()`，页面一加载就调会被
`NotAllowedError` 拒绝（表现为"BGM 永远不响，且不报错"）。
把整个 bundle 的加载推迟到用户手势之后，音频就能正常播，不必再申请权限。

副产品：13MB 素材不在首屏白等，访客先看海报，体验比干等好。

### 薄 UI

- **左上角**：项目名胶囊（带一个绿色"live"小点）
- **右下角**：这是什么 / 全屏 / GitHub
- 鼠标静止 4.2 秒后整层淡到 18%，把画面让给壁纸本身
- 整层 `pointer-events: none`，只有按钮开 `auto`，并在按钮上 `stopPropagation()`
  —— 否则 dock 会吃掉 bundle 的触摸热区

**刻意避开了右上角**：那里是框架自带的入口列（设置 / 静音 / 调试 / 免责 / 档案），
重复造一个静音按钮就是冗余。

### `?auto=1`

自动触发「进入」，方便自己调试。此时没有真实用户手势，音频仍可能被拦 ——
这是浏览器策略，不是 bug。

---

## 三、部署

### 首次：组装 + 推送

```bash
# 1) 组装到任意目录
npm run deploy:pages -- "<目标目录>"

# 2) 目标目录建一个孤儿分支推上去（gh-pages 与 main 历史完全独立）
cd "<目标目录>"
git init -b gh-pages
git add -A
git commit -m "demo: S9 盛夏游乐场在线展示页"
git remote add origin https://github.com/awei808/spine-particle-wallpaper.git
git push -u origin gh-pages
```

### 首次：在 GitHub 上开 Pages

只做一次，之后推送即自动生效：

> 仓库 **Settings → Pages → Build and deployment**
> Source 选 **Deploy from a branch**
> Branch 选 **gh-pages** / **/(root)** → Save

生效要等 1–3 分钟。之后每次 `git push origin gh-pages` 会自动重新发布。

### 之后：更新

源码（外壳）或 demo 工程变了，就重跑一次：

```bash
npm run deploy:pages -- "<目标目录>"
cd "<目标目录>" && git add -A && git commit -m "demo: 更新展示页" && git push
```

> ⚠️ 改了 `src/` 下的源码，记得先 `npm run build` 再把新的 `bundle.js`
> 覆盖进 `demo/S9_盛夏游乐场/`（`bundle.js` 是一次构建产物，不会自动跟着源码更新）。

---

## 四、几个约定

| 项 | 说明 |
| --- | --- |
| **只改一处素材** | `deployPages.ts` 会把 `assets/config.json` 的 `probe.hud` 改成 `false`。demo 里开着是为了本机调试，公网页挂一层诊断数字很出戏。保留 `probe.enabled: true`，`window.__WB_DIALOGUE__` / `__WB_FX__` 才能用 —— 远程排查线上问题时这是唯一抓手 |
| **体积** | 约 12.8 MB / 57 个文件。GitHub Pages 单文件上限 100MB、仓库建议 1GB，远没到线。脚本会在 bundle > 25MB 或总量 > 900MB 时报错 |
| **`.nojekyll`** | 不加的话 Jekyll 会按自己的规则筛掉一部分路径，且多一层重定向 |
| **og:image** | 复用 `preview.jpg`，不额外出图。改预览图记得同步换 demo 工程里那份 |
| **素材版权** | 角色模型 / 贴图 / 语音 / BGM 版权归各自权利人，此处仅作技术演示，不随仓库授权。页面右下角「这是什么」弹窗里已写明，也留了下架联系方式 |

---

## 五、验收过什么

用无头 Chrome（`--enable-unsafe-swiftshader` 软件 WebGL）实测过三张截图：

| 截图 | 结论 |
| --- | --- |
| 入场门 | 海报背景、标题、特性标签、进入按钮正常 |
| 场景初始态 | 22 图层全部渲染，左上胶囊 / 右上框架入口列 / 右下 dock / 提示气泡都在 |
| 运行 20 秒后 | 事件系统正常触发（字幕气泡出现），UI 已按设计自动淡出 |

`events.jsonc` 也过了 `scripts/validateEvents.ts`：15 条事件，0 reject / 0 coerce / 0 report。
