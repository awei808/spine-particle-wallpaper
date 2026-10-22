# TODO

> 最后更新：2026-10-21
> 本文件只回答「下一步做什么」。**已完成的过程记录**（自定义事件系统、事件文件化 A/B/C/D 四批、
> `weight:0` bug 复盘、事件族 / 恢复默认首批）已整份归档到 `docx/_archive/2026-10/TODO_落地记录_2026-10-21.md`。
> 设计真相：`PLAN_自定义事件系统_2026-10-18.md`（字段 / 条件 / 调度 / 校验）、`PLAN_事件配置文件_2026-10-19.md`（文件格式）。
> 编号沿用旧 §4 的 1–9，新增项接 10 起，方便对旧记录。

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

> ✅ 2026-10-21 已完成：**热区分区**（`hand` / `head` + `zones[].design` 跨分辨率坐标）。
> 落点：`config.json` 的 `touch.zones`、`events.jsonc` 的 `custom:hold-hand`（`when.ctx.zone="hand"`，已去掉 `weight:0`）。
> 回归：`_regress/77`（E 组 8 条投影断言）+ `_regress/97`（三分辨率真实点击）。
> 补记见 `PLAN_触摸热区自定义与重叠_2026-10-17.md` §10。

### 1.2 CPU（P2 清理项；分析报告已归档到 `_archive/2026-10/`）

| # | 项 | 现状 |
|---|---|---|
| 6 | `initScene.ts:517` 删掉 `mousemove` 的 `preventDefault()` | 仍在（行号已从 :496 移到 :517，2026-10-21 复核） |
| 7 | 6 个骨架的 mousedown / mouseup 收敛成共享分发器 | 未做，仍各自 `addEventListener` |
| 8 | 发布态探针默认关 | 未做，`webpack.common.js:75` 仍是 `env?.probe ?? 'on'`（已复核） |
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

