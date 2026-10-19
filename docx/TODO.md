# TODO

> 最后更新：2026-10-18
> 本节的设计定稿：`PLAN_自定义事件系统_2026-10-18.md`（字段 / 条件 / 调度 / 校验 / 面板 / 迁移，唯一真相）

## 1. 自定义事件系统

- 支持自定义事件和修改项目自带的事件

  - 简述：提供事件编号、触发条件、触发的 spine 动作、触发的粒子效果、念白、语音文件，就可以让壁纸项目触发自定义事件
  - 允许对当前事件增和删，修改当前事件的所有字段
  - 触发条件支持事多件编排，以及默认的几种触发条件（特定时间段的问候、待机无互动一定时间、触摸）
  - 触发的 spine 动作、触发的粒子效果字段支持随机触发
  - 前置条件：
    - 将当前散在各个代码文件中的事件五要素（条件、spine 动作、粒子、念白、语音）整合至单个文件/单张表（ok 2026-10-18 —— `subtitle.dialogues[]` 唯一真相；归一层 `src/eventModel.ts`；回归 `_regress/83`）
    - 支持自定义触发条件（ok 2026-10-18 —— `when` AST：time / calendar / ctx；`src/conditions.ts`；回归 `_regress/85`）
    - 增加事件五要素的合法性校验（ok 2026-10-18 —— 16 码 + 三处置；`src/eventValidate.ts` + `scripts/validateEvents.ts`；回归 `_regress/88`；运行时只接 1 个点）
    - 语音文件支持多种类型的音频文件（ok 2026-10-17 —— 见 `PLAN_自定义事件系统_2026-10-18.md` §9；`_regress/82`；m4a 真机取证工具见下）
    - 触摸热区自定义和热区重叠的触发逻辑完善（ok，2026-10-17：见 `docx/PLAN_触摸热区自定义与重叠_2026-10-17.md`，回归 `_regress/77`）
    - 档案功能完善，显示触发的粒子效果（ok）
    - 除五要素外的事件字段设计，事件族，优先级等（ok 2026-10-18 —— `id/on/kind/when/pick/variants`；唯一漏斗 `resolveEvent`；回归 `_regress/84/86/87`）
  - 剩余（2026-10-18 收尾）：
    - **S8 迁移**（ok 2026-10-18）
      - 迁移器：`scripts/migrateEvents.ts`（幂等、只重写 `subtitle` 块、打印「位次 → 事件」对照、孤儿写 `enabled:false`）
      - 三份 config 已迁移：`public/assets`（S9）、`_work_星语心恋/step2_web/assets`（S8）、`_work_芙丽希娅_蝶语吟花/step2_web{,_p3}/assets`（S6）
      - `subtitle.touch` / `greeting` / `standby` / `greetInTouchPool` 四个旧键已删除，条件写在条目上；`*Kinds` 保留（用户开关不变）
      - 两个生成器已同步：`17_注入S8语音字幕.py`、`49_生成交互配置.py`（重跑生成不会退回旧形状）
      - 回归：`_regress/90`（迁移前后逐条等价 / 表内换序不漂移 / 孤儿不上线）
      - ⚠️ `greetingRanges` 按 PLAN §1 **保留**，但引擎已不再读它 —— 它现在只是"时段数值的出处"，改它不会改变行为
    - **S9 面板 v1**（ok 2026-10-18，零键盘）
      - 新页「自定义事件」：新建 / 停用 / 删除；通道 chip、条件模板（无/时段/日期/热区/静置 + 步进器）、
        动作 chip（多选=随机）、粒子 chip（多选=随机，与动作**整包配对**）、念白+语音**从现有条目继承**、优先级五档、每天一次
      - 存储：`localStorage['wb.swe.events.v1'] = {schema:1, added[], disabled[]}`（增量，不整表拷贝）
      - 合并：`src/eventOverrides.ts`（config → +added → **disabled 最后统一压**，见文件头对 PLAN §7.1 顺序的说明）
      - 编译：`src/eventBuilder.ts`（纯函数，回归 `_regress/89`）；档案同步显示用户新建的事件
      - 列表口径（2026-10-18 修）：**不再按 `custom:` 前缀过滤"内置"** —— 作者写在 config.json 里的
        `custom:*` 事件（下面两条示例就是）必须能在面板里停用；「删除」只对本机新建（`added`）开放
    - **`weight:0` 的可见性**（ok 2026-10-18，随示例暴露出来的问题）
      - `weight:0` = 不参与自动抽取（只能手动 trigger）。它**仍在池里**，所以原来的
        「池内随机 1 条（共 7 条）」会让人以为它有 1/7 概率 —— 实际是 0
      - 改动：档案的池计数改用 `autoCount`（剔 `weight:0`），这类条目的行名写「点击触摸 · 仅手动」、
        角标追加「· 仅手动」（不再与真的 #6 撞号），细则追加"另有 N 条仅手动"
    - **m4a 在 WE 的 CEF 里的真机实测**（工具已就绪，待真机取证）
      - 自检页：`audio-check.html`；**在 WE 里跑的办法已经做进部署脚本**：
        `npx ts-node --transpile-only scripts/deployWe.ts "<WE>\projects\myprojects\音频自检_验收" --audio-check`
        ⇒ 该项目的 `project.json` 的 `file` 指向 `audio-check.html`，WE 会用它自己的 CEF 渲染这一页
        （普通浏览器测的**不是** CEF，编解码器编译开关不同，不能替代）
      - 第 ④ 段用 `MediaRecorder` **现场录一段 AAC/MP4 再回读**（`decodeAudioData` + `<audio>`），
        不需要准备任何 m4a 素材
      - 本机（headless Chrome 155，`http://` 与 `file://` 各测一遍）：可录 `audio/mp4;codecs=mp4a.40.2`
        （约 9.3 KB），解码 `0.511s / 44100Hz`、`<audio>` 可播；`canPlayType` 全格式非空
      - ⚠️ `file://` 下 `SRC_NOT_SUPPORTED` 有歧义（"文件不存在"与"容器不支持"同码，且 fetch 预检被 CORS 拦）
        ⇒ 自检页底部已写明：用第 ④ 段交叉验证（同容器能录能解 ⇒ 解码器在，失败只能是文件不存在）
      - 结论回来后：若两行都绿，可把 `audio.extOrder` 里的 `m4a` 前移（当前已含 `m4a`，排在末位）
  - 自定义事件示例（以盛夏游乐场为例）：

    - |事件编号|触发条件|触发的 spine 动作|触发的粒子效果|念白|语音文件|备注
      |Custom-01|点击触摸热区“手”|touch1|null|“虽然会妨碍战斗，但在这之外的时间，牵着手也不错。”|Asuna_Touch_Hand_05.ogg|需先自定义热区“手”|
      |custom-情人节问候|2 月 14 日且符合问候触发条件|greet|null|“情人节快乐。锁定你的心。”|Asuna_Valentine_Greet.ogg|需处理好事件的触发优先级|
      |custom-晚安问候|每天 23 点以后至次日 4 点且回到桌面|random|null|“晚安，早点睡吧，我等你”|null|没有语音文件；random 代表随机触发|

    > 2026-10-18 状态：**①② 已经直接写进 `public/assets/config.json`**（不是文档里的想象值），
    > 两条语音也已从 `_work_星语心恋/星见亚砂_语音文件` 拷进 `assets/voice/`
    > （实测可解码：`Asuna_Touch_Hand_05.ogg` 4.99 s、`Asuna_Valentine_Greet.ogg` 2.72 s）。
    >
    > | 已落地                                 | 字段                                                                                           | 为什么这么写                                                                                                                                             |
    > | -------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
    > | `custom:hold-hand`（牵着手也不错）     | `on:["touch"] kind:"touch" animation:"touch1" pick:{weight:0,priority:80}`                     | S9 只有**整屏**热区 `hit1`，没有「手」这个分区 ⇒ `weight:0`：不参与自动抽取，可在调试面板手动触发；等 `PLAN_触摸热区` 那套分区做出来，把 weight 去掉即可 |
    > | `custom:valentine-greet`（情人节问候） | `on:["resume"] kind:"greet" when:{calendar:{2,14}} pick:{priority:50,quota:{max:1,per:"day"}}` | 优先级 50 压过普通问候（缺省 0）；每天一次；`audio.extOrder` 缺省含 ogg                                                                                  |
    >
    > ③「晚安问候」（23→4 时段 + 动作随机）**故意不预置**：它就是"随机"这条能力的演示，
    > 在面板里选时段 23→4、动作勾 2 个以上（生成 `variants` 整包随机）、念白挑一条现有台词即可。
    > ⚠️ "回到桌面"在 WE 默认设置下收不到（见 PLAN §2.4），文案已写明：多数机器上等价于"23 点后开机那次"。

---

## 1.1 本节之外的新增遗留（2026-10-18 记录，未开工）

- 面板 v2：自绘单行文本输入（隐藏 `<textarea>` + 自绘 caret）⇒ 才能新建**全新台词**（v1 只能继承）
- 面板开放 `pick.group`（互斥组）与 `pick.cooldownMs`（最短间隔）—— 引擎已支持，v1 只暴露优先级与「每天一次」
- `greetingRanges` 彻底退场（迁移已完成，它现在是纯参考值）
- 热区分区（「手」「头」……）：现在只有整屏 `hit1`，所以 `custom:hold-hand` 只能用 `weight:0` 当"手动事件"；
  分区做出来后把它的 `weight` 去掉、条件改成 `{ctx:{zone:"hand"}}` 即可（无需改引擎）

## 1.2 线上 bug 记录：点击无法触发触摸事件（2026-10-18 修复）

**现象**：WE 里点角色完全没反应；调试面板确认"点击被检测到"（热区命中、`lastHitZone` 有值），
且调试面板的「触发事件」按钮能正常播 —— 只有真实点击不动。

**根因**（`src/eventScheduler.ts` `selectEvent` 的**顺序**错了）：

```
旧：① 取 priority 最高档  →  ② 档内剔掉 weight:0  →  ③ 加权随机
```

`custom:hold-hand` 写了 `pick:{weight:0, priority:80}`（"只能手动播"），于是：
最高档 = 它自己 → 档内剔除后为空 → `return null` → **整条触摸通道抽不出任何东西**。

整个过程**零日志**：`firedCount` 不涨、`skippedCount` 不涨、没有异常、池大小看着仍是 7 条。
这就是"点击被识别、调试按钮也能播、但真实点击不动"的全部原因。

**修复**（三处，缺一不可）：

| #   | 位置                         | 改动                                                                                                                                                   |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `eventScheduler.selectEvent` | **先**剔 `weight:0`，**再**在剩下的人里取最高档 ⇒ `weight:0` 连"占档"都不做                                                                            |
| 2   | `touch.ts` `playTouch`       | `entry` 为 `null` 时用 `{animation}` 临时条目过闸门 —— 否则"池空退化随机动画"那条兜底也会被 `trigger` 的首行 `entry?.animation` 吃掉（同样是静默失效） |
| 3   | `index.ts` 启动自检          | 某通道**全部**候选都是 `weight:0` 时打一行 warn（点名通道与事件键）；这是唯一能在"没开档案面板"时看见该故障的地方                                      |

**回归**：`_regress/86` 新增 `A6b`（最高档全是 `weight:0` ⇒ 落到次档）、`A6c`（多档时按剔后最高档选）。
`_regress/89` 新增 `E1/E2`（`weight:0` 归一后必须原样保留）。

**教训（已写进 `agents.md` 与 `config.type.ts`）**：`weight:0` 的语义是"我**不参加**抽取"，
不是"我占住最高档、谁也别想抽"。这类"语义正确但顺序写反"的 bug 不会报错，只会有"没反应"。

---

## 1.3 事件文件化（2026-10-19 落地，A+B 批）

- 裁定：自定义事件**不再**面向 0 基础用户；作者层改为**专门的事件配置文件**（带注释），
  面板只保留开关。详见 `docx/PLAN_事件配置文件_2026-10-19.md`。
- ✅ 事件唯一来源 = `assets/events.jsonc`（JSONC：`//`、`/* */`、尾逗号、BOM、CRLF）
  - 解析：`src/eventsFile.ts`（剥注释**等长替换** ⇒ 报错给原始文件的行:列）
  - **无 fallback**：文件缺失 / 语法错 ⇒ 0 条 + 控制台 error + 面板红字（不回退 config）
- ✅ 面板第 5 页改名「事件开关」：只剩每行一个开关；`eventBuilder.ts` 整文件删除，
  `mergeEventOverrides` 的 `added` / `disabled` 双轨一并删除
- ✅ 开关状态：`localStorage['wb.events.state.v1'] = { schema:1, enabled:{key:bool} }`
  （双向：文件写 `enabled:false` 也能被用户打开）；`pruneEventState` 清悬空键
- ✅ `archive.ts` 不再自己归一（事件表由 `index.ts` 传入）⇒ 少一份"第二真相"
- ✅ 迁移器：`scripts/migrateEvents.ts <assets> --to-file [--write]`
  （写带注释头部的文件 + 从 config 删 `dialogues`；空表拒绝覆盖）
- ✅ 离线校验：`scripts/validateEvents.ts` 优先读 `events.jsonc`
- ✅ 回归：`_regress/91`（解析 43 条）、`_regress/89`（开关 18 条，已重写）
- ✅ 无头验收：`_work_事件文件验收/10_验证_事件开关.js`（26 条断言，dist 与 S9 探针各跑一轮）
- ✅ B 批：`12_探针_去灰线` 已迁移（10 条）+ 部署新 bundle（备份在 `_work_工坊更新/_备份/`）
- ⬜ C 批：`_work_星语心恋/step2_web`（S8）+ `17_注入S8语音字幕.py` 改产出 events.jsonc
- ⬜ D 批：`_work_芙丽希娅_蝶语吟花/step2_web{,_p3}`（S6）+ `49_生成交互配置.py`
- ⚠️ C/D 之前：**不要**对已迁移工程重跑生成器（会把 `dialogues` 写回 config，虽不生效但会误导）


## 2. 将 D:\手游文件夹\灵魂潮汐\12*探针*去灰线的项目示例作为 demo，搬进本 git 仓库。并作为未来的项目展示窗口。

## 3. 将 D:\手游文件夹\灵魂潮汐里的测试文件搬进 git 仓库
