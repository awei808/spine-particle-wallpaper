# TODO

> 最后更新：2026-10-23
> 本文件只回答「下一步做什么」。**已完成的过程记录**（自定义事件系统、事件文件化 A/B/C/D 四批、
> `weight:0` bug 复盘、事件族 / 恢复默认首批）已整份归档到 `docx/_archive/2026-10/TODO_落地记录_2026-10-21.md`。
> 设计真相：`PLAN_自定义事件系统_2026-10-18.md`（字段 / 条件 / 调度 / 校验）、`PLAN_事件配置文件_2026-10-19.md`（文件格式）。
> 编号沿用旧 §4 的 1–9，新增项接 10 起，方便对旧记录。

## 0. 代码审查遗留（2026-10-23 全量审查的剩余项）

> 审查报告：`REVIEW_全面代码审查_2026-10-23.md`（6 P0 / 14 P1 / 33 P2）。
> **P0-1 ~ P0-6 已全部修复**，明细见 §4 的落地记录。下面只留未开工的部分。

### 0.1 P1 中等（14 条，按建议顺序）

| # | 项 | 位置 / 现状 |
|---|---|---|
| 12 | **面板缩放到下限后永久脱离全局缩放** | `settingsPanel.ts:1150-1169` 的 `fitPanelScale`：`panelK` 触底 `K_MIN` 后 `next === panelK` ⇒ 提前 `break` ⇒ **不写** `--wb-ui-s`。之后换显示器/改分辨率，面板内层与气泡/HUD 的缩放比例脱钩。`disclaimer.ts:345-372` 同构。修法：把"要不要写样式"的判据从 `panelK` 换成**实际要写入的值** |
| 13 | **滑块位置与数字读数不同量纲** | `settingsPanel.ts:3227-3232`。`gapMs=25000` 滑块被钳到第 100 格（=10s）而文字显示"25000 毫秒"；`standbyIdleSec=25` 出厂就有 ±1s 错位。修法：读数由**滑块当前格**反算；`syncFromDraft` 把钳位值回写 `draft` |
| 14 | **排队模式下 `onAction` 在"入队"而非"开播"回调** | `touch.ts:885` 的 `onAction` 在 `addAnimation` 之后同步触发，而 `trackEntry.listener.start` 被写成空函数。排队模式响应延迟 = 当前常驻动作剩余时长（最长 11s）⇒ 字幕/语音/配额**提前**落地。修法：把 `onAction` 挪进 `listener.start` |
| 15 | **常驻序列吞掉刚排上的自动通道动作** | `touch.ts:989` 的交接保护只判 `source === 'touch'`；greet/standby 在 `complete` 后的窗口里排上 `addAnimation`，随即被 `idleSequence.resume()` 的 `setAnimation(0,…)` 的 `disposeNext` 丢掉 ⇒ 字幕播了、动画没播。修法：判据放宽到所有 source |
| 16 | **漏斗池与档案池的 `enabled` 判据不一致** | `index.ts:1151` 的 `poolOfKind` 没判 `enabled !== false`，而 `archive.ts:635` 判了 ⇒ `poolSize` 虚高、`hasChat` 误判、"全 weight:0"告警漏报。修法：加一条判据 |
| 17 | **无 `texture` 层时相机 y = `Infinity`** | `initScene.ts:185/216`：`zMin` 初值 `Infinity` 且无兜底 ⇒ `halfH`/`camY` 全 NaN ⇒ 整屏不渲染，而红条只说"露黑"，排查方向被带偏 |
| 18 | **暂停期间"不许起播"只有语音实现** | `bgmPlayer.ts:173-200` 无 `suspended` 闸门（`voicePlayer.ts:599-603` 有）。加上 `audioMaster.paused` 从未读宿主（`audioMaster.ts:117` 的注释是假的），若 WE 在 `createAudioMaster` 之前下发过 `setPaused(true)`，恢复时 BGM 会在已暂停的壁纸上响 |
| 19 | **BGM 缺 `ended` 判据** | `loop:false` 时 `resume()` 对已 `ended` 的元素调 `play()` ⇒ 整条 BGM 从头重播。`voicePlayer` 已修过同款（`voicePlayer.ts:78-93`），BGM 侧没同步 |
| 20 | **JSONC 两条边界让"行:列"失效** | `eventsFile.ts:76-83` 行注释只认 `\n`（纯 `\r` 不退出）；`85-94` 块注释 EOF 未闭合无检测 ⇒ 都退化成 "Unexpected end of JSON input"，`positionOf` 拿不到位置 |
| 21 | **`time.start === end` 四处口径打架** | `config.type.ts:746` 说"= 全天"、`compileCondition:387` 也按全天；但 `inspectCondition:184` 报 `E_COND_INVALID`（strict 下 reject）、`describeCondition:506` 说"非法"。`_regress/85` 的 A4 还把这个不一致**钉成了测试** |
| 22 | **`conditions` 的 `month`/`day` 放过 `NaN`** | `conditions.ts:525` 用 `typeof` 判数 ⇒ 档案打出 `NaN月NaN日`。`compile`/`inspect`/`describe` 是**三份独立 switch**，建议抽共享 `parseLeaf` |
| 23 | **无 `test` 脚本、无 CI** | `package.json` 没有 `test`；仓库根无任何 CI 配置；67 个回归靠手工 `npx ts-node` 跑。且 64/65/67/69 依赖 `dist/bundle.js` ⇒ 测的是**上一次构建产物** |
| 24 | **`tsconfig` 没开 `strict`** | 无 `strictNullChecks` ⇒ 以下问题编译期全不可见（本次 P0-6 的类型收窄就因此踩了坑）。`scripts/` 与 `_regress/` 也不在 `include` 里 |
| 25 | **其余 P1/P2** | 见审查报告 §「P2 轻微」：死代码（`subEmitterConfig.ts` 361 行完全没接线、4 个 `dispose()` 零调用、`toNumber`/`toEnum`/`setVisible` 零调用）、监听器泄漏（`bgmPlayer.armUnlock` 重复累积、`settingsPanel` 的 flashTimer/drag 监听、`SpineAnimator` 无 dispose）、以及 `pointerTrail` / `ParticleAnimator` 的每帧分配 |

### 0.2 遗留观察

- ~~`_regress/93` 的 D3 FAIL~~ ⇒ **确认是既有失败**（HEAD 上也 FAIL），断言"touch 类条数 == 事件表 touch 类条数"与当前 config 数据不匹配，需按实际数据重算期望值
- `packages/threejs-spine-3.8-runtime-es6` 子模块指针指向 `b160f53`（`perf(mesh): only flag needsUpdate…`），**该提交不在任何远端分支上** ⇒ 别人 clone 会 fetch 失败。要么推到自己的 fork 并改 `.gitmodules` 的 url，要么退回 `bd54703`

---

## 1. 待办

### 1.1 事件 / 面板

| # | 项 | 现状 / 下一步 |
|---|---|---|
| 1 | **m4a 在 WE 的 CEF 里真机取证** | 工具就绪、未跑。`npx ts-node --transpile-only scripts/deployWe.ts "<WE>\projects\myprojects\音频自检_验收" --audio-check` ⇒ WE 用自己的 CEF 打开 `audio-check.html`（普通浏览器测的不是 CEF，编解码器编译开关不同，不能替代）。本机 headless 已绿：现场录 AAC/MP4 约 9.3 KB，解码 0.511s / 44100Hz。**取证前 `audio.extOrder` 的 m4a 保持末位** |
| 2 | 面板 v2：自绘单行文本输入 | 未开工。隐藏 `<textarea>` + 自绘 caret ⇒ 才能新建**全新台词**（v1 只能从现有条目继承） |
| 3 | 面板开放 `pick.group` / `pick.cooldownMs` | 未开工，已复核 `settingsPanel.ts` 里确实没有这两个控件。引擎已支持，v1 只暴露优先级与「每天一次」 |
| 4 | `greetingRanges` 彻底退场 | 只剩"时段数值的出处"身份，**引擎不读** —— 改它不会改变行为 |

> ✅ 2026-10-21 已完成：**默认项 + 档案分页 + 事件文件指南**。
> ① 对齐基准缺省翻成**按画幅宽**（`initScene` / `settingsStore.readView` 两处同向、只认 `'height'` 例外值；`config.example.json` 显式写死）；
> ② **节日族默认打开** —— `config.example.json` 声明 normal/festival/custom 三族且都标 `default:true`，并给老存档做**一次性补勾**（`settingsStore.mergeNewFamilyDefaults` + 覆盖层新字段 `phasesSeen`：只补"没见过的新族"，用户之后取消勾选**不会**被回补）；
> ③ **档案分页** —— 顶部「全部 / 按事件族 / 按通道分组」三视图，后两种再按族 / 按组分页签（`archive.ts` 的 `Row.grp` / `Row.fam`，`rowCount()` 返回当前视图行数）；行数少了 ⇒ 缩放放大回 1 ⇒ 字变大；
> ④ **指南** —— 档案页脚与设置面板「事件开关」页都写明：详细信息（条件 / 动作 / 粒子 / 念白 / 语音）在 `assets/events.jsonc` 看，**自定义事件也在同一个文件里实现**。
> 回归：`_regress/100_回归_默认项与档案分页.ts`（25 条断言：默认项 4 + 补勾迁移 5 + 分页 13 + 指南 3），另附最小 DOM 替身 `_regress/100_dom_stub.ts`。

> ✅ 2026-10-22 已完成：**热区跟着对齐基准走**（用户报「换按宽/按高后热区不动，点手点不中」）。
> 根因：`u0..v1` 被当成**视口分数**，与取景无关；`design` 区虽会投影，但两种写法口径不统一。
> 落点：`zones[].fit`（缺省 **`width`**）+ `zones[].aspect`（缺省设计比例）—— 先把分数按
> 声明基准还原成**设计画布像素**，再按本帧取景投影（`touchZones.ts` 的
> `fitRectToDesign` / `designRectToFit` / `convertFitRect` / `uvRectToViewport`）；
> 换算工具：`scripts/convertZones.ts`（`npm run convert-zones -- <config> --to design`）。
> 回归：`_regress/102`（33 条：换算往返 / 两基准在设计比例重合 / 均匀缩放 k=(Wd/Hd)/A /
> 跨比例命中同一画布 / 非法值降级 / 真实 config 兜底仍覆盖全屏）+ `_regress/77`（55 条，零回归）
> + `_regress/97`（三分辨率真实点击，12 条）。

> ✅ 2026-10-21 已完成：**热区分区**（`hand` / `head` + `zones[].design` 跨分辨率坐标）。
> 落点：`config.json` 的 `touch.zones`、`events.jsonc` 的 `custom:hold-hand`（`when.ctx.zone="hand"`，已去掉 `weight:0`）。
> 回归：`_regress/77`（E 组 8 条投影断言）+ `_regress/97`（三分辨率真实点击）。
> 补记见 `PLAN_触摸热区自定义与重叠_2026-10-17.md` §10。

### 1.2 CPU（P2 清理项；分析报告已归档到 `_archive/2026-10/`）

| # | 项 | 现状 |
|---|---|---|
| 6 | `initScene.ts:517` 删掉 `mousemove` 的 `preventDefault()` | 仍在（行号已从 :496 移到 :517，2026-10-21 复核） |
| 7 | 6 个骨架的 mousedown / mouseup 收敛成共享分发器 | 未做，仍各自 `addEventListener` |
| 8 | ~~发布态探针默认关~~ | ✅ **2026-10-23 已完成**：`webpack.common.js` 改 `env?.probe ?? 'off'`；生产 `devtool: 'source-map'`（外置）；`config.json` 的 `probe.enabled → false`。★ 注意 `__PROBE__` 只是**缺省值**（`probe.ts` 不做 DCE），真正省 CPU 的是 config 那一刀 |
| 9 | `ParticleAnimator.buildGeometry` 加 dirty 判定 | 未做 |

### 1.3 恢复默认（首批已落地，收尾两项）

| # | 项 | 现状 |
|---|---|---|
| 10 | 页脚「恢复默认」加二次确认 | 现在**单击即重载**，没有确认 |
| 11 | 列表型覆盖（`phases` / `*Kinds`）的版本迁移机制 | 没有，与 §2 的存档兼容是同一件事 |

### 1.4 仓库打包（把 demo 搬进 git）

- 把 `D:\手游文件夹\灵魂潮汐\12_探针_去灰线` 作为 demo 搬进本仓库，作为未来的项目展示窗口
- 把 `D:\手游文件夹\灵魂潮汐` 里的测试文件搬进 git 仓库
- **前置未做**：两个目录都还没进 git —— 仓库口径是不带素材（`public/assets/*` 被 gitignore），
  要先定一个 `demo/` 之类的白名单方案

### 1.5 长期观察项

粒子系统：Sub Emitters 引擎接线（P5-b）、真皮肤验收（P5-c）、Shape 缺的 Donut / Rectangle /
BoxShell / BoxEdge / Mesh / Sprite —— 三个产物 0 用例。

### 1.6 文档债

`src/` 里 14 处注释还写着 `docx/TODO.md §2.1 / §2.5 / §2.6`（粒子分布口径、锥形发射、碰撞模块等），
**这些章节在本文件里已不存在**（§2 现在是"已知限制"）⇒ 引用全部失效，读者按图索骥会找不到。
需逐个改指到 `RESEARCH_粒子系统复刻参考.md` 或 `config.type.ts` 自身的注释。
涉及：`src/animator/ParticleAnimator.ts`（约 8 处）、`src/config.type.ts`（约 5 处）、`src/subEmitterConfig.ts`（2 处）。

---

## 1.9 2026-10-23 落地记录（代码审查 P0 全清）

> 审查报告 `REVIEW_全面代码审查_2026-10-23.md`；6 条 P0 已全部修完并各有回归 + 反向验证。

### P0-5 `eventLog.groups` 持久化 tick，重载后撞号（1 行代码，2 处）

`groups` 的值是自增的 `tick` 号（"本 tick 已出过同组的一条"），而 `tick` **每次重载从 0 重开**。
改前 `save()` 把它一起落盘 ⇒ 重载前最后用到 tick 7，新会话第 7 次 resolve 时
`groups['g'] === 7` **恰好命中** ⇒ 该互斥组整组被判"已消费" ⇒ 通道静默哑一次，零日志。

- `eventScheduler.ts` 的 `save()`：`copy.groups = {}`（不落盘）
- `createEventLog` 的读盘分支：`state.groups = {}`（**旧存档的脏值必须读进来就丢**，
  否则要撑到本次会话第一次 `commit` 才被覆盖）
- 保留字段本身而不是 `delete`：`save()`/读取分支都还判 `parsed.groups` 是否存在，
  删掉会让老存档走 catch 分支、把 `entries` 一起丢了
- 回归：`_regress/86` 新增 **B14/B15/B16**（用同一份 storage 建两个实例精确复现"重载"）

### P0-6 `main()` 裸 fetch，失败即黑屏 / 永远没字幕

WE 是 `file://`。工程自己在 `voicePlayer.ts:102-108` 与 `eventValidate.ts:12` 都记录过
"fetch 在此受 CORS 限制且各版本行为不一"，而**其它所有资源**（`.skel`/`.atlas`/贴图）
本来就靠 XHR（`AssetManager.ts:48`）—— 唯独 config 与事件表交给 fetch，是口径分裂。

失败后果分两档：config 读不到 ⇒ **黑屏**（`main()` 第一条语句，unhandled rejection，
桌面看不到 DevTools）；events 读不到 ⇒ **更隐蔽**：画面正常、BGM 正常、点击有动作，
只是字幕与语音永远不出现，用户只会报"没字幕"。

- **新增 `src/assetText.ts`**：`readTextFile()`（XHR 封装）/ `readJsonFile()`。
  关键点：① ★ `file://` 下 `status` 恒为 **0**，只判 200 会让本地部署**全部**读不到 config；
  ② 必须设 `timeout`（路径写错时某些 CEF 既不 `onerror` 也不 `onload` ⇒ 永久 pending）；
  ③ `overrideMimeType('text/plain; charset=utf-8')`（`.jsonc` 扩展名不认识，否则中文乱码）；
  ④ 去 BOM（Windows 编辑器常见）；⑤ 失败**不抛异常**，返回人话 `reason`
- `eventsFile.ts` 的 `defaultFetcher` 改为基于 `readTextFile`
- `index.ts`：config 走 `readJsonFile`；新增 `showFatal()` 屏幕红条（id 用
  `#__fatalErr`，与 `initScene` 每帧增删的 `#__fitErr` 分开）；events 失败**也打红条
  但不 return**（画面还能用，只是不说话）；顶层 `main()` → `main().catch(...)`
- 回归：`_regress/106`（20 条断言：status=0 / 各类失败原因 / 超时 / MIME / BOM /
  JSON 语法错误 / 缺省读取器不是 fetch / 顶层是 `main().catch`）

### 顺带（本轮同批修的）

- **P0-3 纯台词事件**（见 `_regress/104`）：真支持"只播字幕"，新增 `textOnlyUntil`
  让 `isBusy()` 覆盖字幕停留期（否则待机 tick 会插嘴打断台词）
- **P0-4 手动触发记账**（见 `_regress/105`）：新增 `triggerManual` 统一入口，
  补三层闸门 + `beginTick`；`commit(manual=true)` 只写 `lastAt` 不涨配额
- **触摸通道漏抽变体**：`pick` 只调漏斗没调 `resolveEventVariant` ⇒ `variants` 在
  点击路径完全失效（永远播基准那条）
- **生产包体积**：6.61 MB → 1001 KB（内联 sourcemap 改外置 `bundle.js.map`）

---

## 2. 已知限制

| 坑 | 说明 |
|---|---|
| `step2_web_p3` 的 `events.jsonc` 不会自动同步 | `21_` / `22_` / `49_` 三个脚本只产出 `step2_web` 的；`_p3` 是手工渲染对照副本，重跑生成器不会同步过去 —— 要同步就重跑一次 `migrateEvents --to-file --write`，或整份复制 |
| 素材侧不在 git 里 | `config.json` 的事件族声明、`events.jsonc` 的节日 `phase`、语音 / BGM 都只在**本机**生效（仓库不带素材）；README 有声明配方 |
| ~~老存档的新事件族不会自动勾上~~ | ✅ 2026-10-21 已修：`mergeNewFamilyDefaults` 在启动时补勾"标了 `default` 且没见过"的族，并用 `phasesSeen` 记账 ⇒ 补一次、之后用户取消勾选不会被回补。**作者新增族时记得标 `default: true`**，否则不会被强加给用户 |
| 春节日期要每年手动追加 | `when.dates` **不做农历换算**（那是要每年校对的数据，错一天等于过节过错了），2026–2031 的初一已写进 `public/assets/events.jsonc`，**每年往数组追加一行** |

---

## 3. 归档去向

- 落地过程记录：`docx/_archive/2026-10/TODO_落地记录_2026-10-21.md`（本文件精简前的原样快照）
- 已完结的分析报告（CPU 五连等）：`docx/_archive/2026-10/`，索引见 `docx/_archive/README.md`
- `docx/` 现在只留：本清单 + 两份 PLAN（字段真相 / 文件格式真相）+ `PLAN_触摸热区`（§1.1-5 的前置设计）
  + `RESEARCH_粒子系统复刻参考`（引用型资料）

