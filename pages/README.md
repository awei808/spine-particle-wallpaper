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

### 加载：为什么没有黑屏

这是整个展示页**唯一有工程含量**的地方，改动前线上有十几秒黑屏。

原因：Three.js 在 renderer 初始化那一刻就把 `<canvas>` 挂上去了，但此刻贴图还一张没到。
原先拿「canvas 出现」当"画面就绪"的信号去淡出门层 —— 于是门一开，露出的是还没上色的画面，
CDN 限速时就是十几秒纯黑。

修法分两步：

1. **门层期间先按字节把画面必需的资源全拉完**（进 HTTP 缓存），再注入 bundle。
   bundle 随后请求同一批 URL 全部命中缓存 ⇒ 开门即是成品画面。
2. **开门前再让两帧过去**（`requestAnimationFrame` 套两层），
   等第一帧真正画出来再淡出，避免淡出的 0.7 秒里露出上色过程。

进度条是**字节加权**的，不是数文件个数 —— 3.6MB 的 BGM 和 5KB 的星点贴图不是一个量级。
字节数由 `deployPages.ts` 在打包时写进 `assets/manifest.json`（从 config 反查资源，
顺带校验引用到的文件真实存在）。

几个边界情况都处理了：

| 情况 | 行为 |
| --- | --- |
| `manifest.json` 拿不到 | 降级为直接注入 bundle，不显示进度条，不卡住访客 |
| 单个文件 404 / 超时 | **跳过并继续**，宁可少一张贴图也不能卡在 97% |
| BGM（3.6MB） | 划到音频组，与画面并行后台下载，**不阻塞出画面** |
| 语音 | 完全不预取，引擎按需只拉抽到的那一条 |

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
| **调试默认关闭** | `deployPages.ts` 把 `assets/config.json` 的 `probe` 改成 `{enabled: false, hud: false}`。demo 工程里两个都是 `true`（本机调试用）。`enabled` 一旦为真，`probeEnabled` 缺省就跟着为真 ⇒ 右上角「调试」入口一进去就是开着的，还会把 `__WB_DIALOGUE__` / `__WB_FX__` 挂到 window；`hud` 为真则屏幕上直接挂一层诊断数字。代价是失去那两个远程排查抓手 —— 面向访客的展示页，默认整洁优先 |
| **额外产物 `manifest.json`** | 打包时生成的资源清单（画面必需 33 项 / 7.9MB）。**改了 config 里的贴图或骨架后必须重跑脚本**，否则进度条会算错 |
| **体积** | 约 12.8 MB / 57 个文件。GitHub Pages 单文件上限 100MB、仓库建议 1GB，远没到线。脚本会在 bundle > 25MB 或总量 > 900MB 时报错 |
| **`.nojekyll`** | 不加的话 Jekyll 会按自己的规则筛掉一部分路径，且多一层重定向 |
| **og:image** | 复用 `preview.jpg`，不额外出图。改预览图记得同步换 demo 工程里那份 |
| **素材版权** | 角色模型 / 贴图 / 语音 / BGM 版权归各自权利人，此处仅作技术演示，不随仓库授权。页面右下角「这是什么」弹窗里已写明，也留了下架联系方式 |

---

## 五、验收过什么

用无头 Chrome（`--enable-unsafe-swiftshader` 软件 WebGL）实测：

| 项 | 结论 |
| --- | --- |
| 入场门 | 海报背景、标题、特性标签、进入按钮正常 |
| 场景初始态 | 22 图层全部渲染，左上胶囊 / 右上框架入口列 / 右下 dock / 提示气泡都在 |
| 运行 20 秒后 | 事件系统正常触发（字幕气泡出现），UI 已按设计自动淡出 |
| 调试关闭 | 画面无 HUD、无诊断数字、无帧率面板，右上角无按钮处于打开态 |
| 事件表 | `scripts/validateEvents.ts`：15 条，0 reject / 0 coerce / 0 report |

黑屏修复是用**限速服务器 + 请求时间线**验证的（本机千兆看不出问题，压到 1MB/s 才复现）：

```
4.390  index.html
4.625  assets/manifest.json
4.669  assets/bgm/Anniversary_03.ogg   ← 音频组，后台并行
4.679… assets/config.json / events.jsonc / 全部贴图骨架（6 并发）
5.634  bundle.js                        ← 预加载收尾
       （此后无第二条 bundle.js / 贴图请求 ⇒ 全部命中 HTTP 缓存）
```

**整条时间线里 `bundle.js`、贴图、config、events 各只出现一次** —— 证明 bundle 注入后
再没为等网络停留过一帧，这正是黑屏消失的直接证据。

> 想自己复现：
> `python scripts/slowServer.py <端口> <每秒字节数> <站点目录> <日志路径>`
> 例：`python scripts/slowServer.py 8881 307200 ../_ghpages ../_access.log`
> （给 `SimpleHTTPRequestHandler` 加限速 + 带时间戳的请求日志，专门用来验收加载表现）
