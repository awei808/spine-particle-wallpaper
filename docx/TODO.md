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
| 老存档的新事件族不会自动勾上 | `phases` 会被面板写进 localStorage，老存档里只有 `["normal"]` ⇒ 新加的两族不生效，档案会标「所属事件族未勾选 ⇒ 当前不可触发」。到「事件池 → 事件族」补勾，或用「恢复默认」 |
| 春节日期要每年手动追加 | `when.dates` **不做农历换算**（那是要每年校对的数据，错一天等于过节过错了），2026–2031 的初一已写进 `public/assets/events.jsonc`，**每年往数组追加一行** |

---

## 3. 归档去向

- 落地过程记录：`docx/_archive/2026-10/TODO_落地记录_2026-10-21.md`（本文件精简前的原样快照）
- 已完结的分析报告（CPU 五连等）：`docx/_archive/2026-10/`，索引见 `docx/_archive/README.md`
- `docx/` 现在只留：本清单 + 两份 PLAN（字段真相 / 文件格式真相）+ `PLAN_触摸热区`（§1.1-5 的前置设计）
  + `RESEARCH_粒子系统复刻参考`（引用型资料）

## 默认设置中将按画幅宽对齐和节日族事件默认打开设为默认项
## 档案中新增按事件族分页显示和按通道类分页显示功能，以缓解档案页字太多太小的问题
## 档案和设置-事件开关中新增指南：明确详细信息可在event.jsonc中查看，可在event.jsonc中实现自定义事件