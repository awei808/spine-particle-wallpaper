# spine-particle-wallpaper

**Spine 骨骼动画 + Unity 式粒子特效，转成 Wallpaper Engine 可交互桌面壁纸。**

把 Unity 手游里的 Spine 角色、粒子特效与触摸动作搬到桌面并保持原有手感：多套触摸动作、念白语音与字幕气泡、BGM、指针拖尾、画幅自适应，以及一套内置设置面板。

[English](./README.md)

> 本仓库衍生自 [spicy-wolf/spine-wallpaper-engine](https://github.com/spicy-wolf/spine-wallpaper-engine)（GPL-3.0），在其 Spine 动画播放内核之上扩展为可交互角色壁纸框架。归属与许可见 [NOTICE.md](./NOTICE.md)。

## 能力对比

上游是一个 Spine 动画播放器：把 Spine 文件放进 `assets/`，在桌面上循环播放。本仓库在同一渲染内核之上提供完整的交互层：

| 能力 | 上游 | 本仓库 |
| --- | --- | --- |
| 多层场景编排（背景 / 角色 / 粒子 / 前景） | 支持 | 支持，含 `particle` 层与分层 z 序 |
| 触摸交互与动作调度 | — | 热区命中、动作互斥与打断闸门 |
| 念白语音 + 字幕气泡 | — | 跟随角色锚点、自动换行、淡入淡出 |
| BGM | — | 循环播放与音量控制 |
| 暂停 / 恢复 | — | 统一音频总闸（WE `setPaused` + 页面可见性两路信号） |
| 指针拖尾 | — | 跟随鼠标移动发射 |
| 内置设置面板 | — | 6 个分页（末页「壁纸独立设置」按壁纸声明出现），运行时改配置并持久化 |
| 档案面板 / 免责声明 | — | 按当前生效配置列出事件 / 触发条件 / 动作 / 特效 / 念白 / 语音 |
| 调试探针 | — | 独立入口 + HUD 与 CDP 快照接口 |

设置面板的 6 个分页：音乐 / 字幕气泡 / 事件触发 / 事件池 / 画面调整 / **壁纸独立设置**。末页是条件页，仅在壁纸于自己的 `config.json` 中声明 `wallpaperSettings` 时出现（见下文「壁纸独立设置」）。

调试面板是右上角入口列中「设置」按钮下方的独立按钮，与设置面板互斥展开。面板含「调试总开关 / HUD 文字 / 鼠标红圈 / 热区框」四项，对应 `probeEnabled` 等四个字段，改完就地「保存并应用」。下半另有两组触发按钮：**触发动作**列出骨架全部动画（点击只播动画），**触发事件**列出全部念白条目（点击按 `actionId` 走完整播放路径：动画 + 字幕 + 语音，含打断闸门）。条目多时 chips 自动换行铺开。

## 功能一览

- **多层场景**：`texture` / `spine` / `particle` / `video` 四种层按 `position.z` 排布，全屏适配（`fitAspect` 锁高或锁宽），DPI 自适应（`dpr: "auto"`）。露黑检测按真实覆盖计算：逐层投影到屏幕、逐边算缺口。
- **触摸交互**：矩形热区 + 动作序列；`touch` / `greet` / `standby` 三类来源遵循明确的互斥与打断规则。热区在 `config.json` 的 `touch.zones` 中自定义（增删改、单区 `enabled`、`priority`），多个区重叠时按 `enabled → priority 降序 → 面积升序 → 数组下标` 裁决出唯一一条。
  - 热区坐标用 `design` 写设计像素：`{"id":"hand","design":{"x":1012,"y":96,"w":88,"h":126}}`，原点左上，分母 = `config.width × config.height`。引擎按当前取景把设计像素投影为视口矩形，换分辨率或宽高比时热区跟随画面移动。
  - 热区按 `touch.zones` 命中；`touch.fullscreen` 置 `true` 时整块画面视为单一热区。事件侧用 `when.ctx.zone` 引用区 id，写错会在启动校验时报 `E_ZONE_UNKNOWN`。
- **语音与字幕**：字幕气泡跟随角色锚点，语音走独立播放器，两者都接入音频总闸。
- **音频总闸**（`src/audioMaster.ts`）：BGM 与语音登记到同一处，暂停/恢复统一处理，语音从暂停处续播。
- **粒子与拖尾**：`ParticleAnimator` 负责场景粒子，`PointerTrail` 负责鼠标拖尾，两者独立实现。
- **设置面板**：运行时修改并持久化到 WE 属性。
- **调试探针**：`__WB_DIALOGUE__` / `__WB_FX__` 快照接口，配合 headless Chrome + CDP 做自动化回归。

## 事件列表与触发规则

「什么情况下角色说哪句话」全部写在 **`assets/events.jsonc`**（与 `config.json` 同目录）。一条事件自带**分组标记、条件、动画、粒子、念白、语音**；改完在 Wallpaper Engine 里重新加载壁纸即生效，无需重新构建。

事件单独成文件的原因：该文件支持 `//`、`/* */` 注释与行尾逗号，可离线校验（`npm run validate-events`），文件开头附完整字段表与示例，打开即可照着改。

```jsonc
{
  "schema": 1,
  "events": [
    {
      "id": "game:64001", "actionId": 64001, "label": "晴日上午问候",
      "on": ["resume"], "kind": "greet",
      "when": { "time": { "start": 5, "end": 12 } },   // 05:00–12:00（start>end = 跨零点）
      "animation": "greet",
      "text": "早上好。", "textTime": 6,
      "voice": "CV/character/Morning_01.ogg"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `on` | **分组标记**：`touch`（点击热区）/ `standby`（静置）/ `resume`（载入、回到桌面、回到前台），可写数组。事件能否被某个入口播放，由面板勾选的类别决定；需要锁定时机时用 `when.ctx.signal` / `when.ctx.zone`。`on: []` 表示永不播放 |
| `kind` | 类别：`touch` / `chat` / `greet`。省略时按 `on[0]` 推断 |
| `when` | 条件：`time{start,end}`、`calendar{month,day}`、`dates["MM-DD" / "YYYY-MM-DD", …]`（农历节日用它）、`ctx{idleMs,zone,signal}`，可用 `all` / `any` / `not` 组合 |
| `animation` | spine 动画名；留空即纯台词事件 |
| `particles` | 本条专用粒子组（`config.meshes[].name`）；留空时按动画名回落 |
| `variants` | 整包随机：动作 + 台词 + 语音来自同一包 |
| `pick` | `priority`（同次触发先比档）、`weight`（同档加权；`0` = 仅手动触发）、`group`（互斥）、`cooldownMs`、`quota`、`interrupt` |
| `enabled` | `false` = 作者默认关闭（用户仍可在面板打开） |

新增一条事件 = 往 `events` 数组里加一个对象；删除 = 删掉该对象。面板里的「事件开关」是本机开关（写入 `localStorage`），`events.jsonc` 由作者维护。

### 「恢复默认」的两个层级

| 按钮 | 位置 | 清理范围 | 生效时机 |
| --- | --- | --- | --- |
| **恢复本页默认** | 「事件开关」页右上角 | 本页的开关，全部回落到 `events.jsonc` 里的 `enabled` 缺省 | 点底部「保存并应用」后重载 |
| **恢复默认**（页脚常驻） | 面板底部，每页都有 | 全部设置覆盖层 + 本机事件开关 | 立即重载 |

- 统计行的「已改 N 项」= 与文件缺省不同的条数；开关点两下点回原位不计入。
- 页脚「恢复默认」作用于设置层；`wb.swe.eventlog.v1`（冷却 / 配额 / 互斥组的播放记录）记录的是已经发生的播放历史，清空它会令 `quota.ever` 的事件重新可播，属独立操作。

注意：某个入口勾中的类别里若所有事件均为 `weight: 0`，该入口不会自动触发（启动时会打 warn）。`pick.priority` 是**全局档位**，高优先级事件会从所有入口抢戏；需要每个入口各播各的，把它们放在同一档（缺省 0）或用 `when` 分流。

### 语音文件格式：`ogg` / `mp3` / `wav` / `m4a` 混装

`subtitle.dialogues[].voice` 只写文件名，扩展名由播放时的候选顺序决定：先原样试（写 `X.ogg` 就试 `X.ogg`），失败后按 `subtitle.audio.extOrder` 换扩展名重试，每个候选只试一次。解包产物从 ogg 转成 mp3 时，config 一行都不用改。

```json
"audio": { "enabled": true, "volume": 1.0, "path": "./assets/voice/",
           "extOrder": ["ogg", "mp3", "wav", "m4a"] }
```

| 情况 | 行为 |
| --- | --- |
| `voice` 带扩展名 | 先试该扩展名；失败后按 `extOrder` 把词干换扩展名重试 |
| `voice` 不带扩展名 | 按 `extOrder` 依次拼接（`X.ogg` → `X.mp3` → …） |
| 格式明显不支持 | `canPlayType` 判否的直接跳过；全部判否时按原顺序实测 |
| 全部候选缺失 | 静音播放，字幕照常显示，控制台每个文件 warn 一次 |
| `extOrder: []` | 只试 `voice` 里写的扩展名 |
| 某词干上次用 mp3 成功 | 同词干下次优先试 mp3 |

自动播放被拦（`NotAllowedError`）属浏览器策略，点击一次热区即可，与文件格式无关。`m4a` 排在最后，是因为 WE 的 CEF 对 AAC 支持不稳，靠前会先撞到解不了的候选。

离线核对目录与 config 是否对应（列出各格式数量、同词干多格式冲突、config 引用但目录缺失的语音）：

```bash
npm run voice-manifest                                     # 只报告
npm run voice-manifest -- --write                           # 同时产出 voice/manifest.json
npx ts-node --transpile-only scripts/voiceManifest.ts <语音目录> <config 路径>
```

### 两页分工：事件触发 / 事件池

内置设置面板把触发拆成两页（`id` 是历史值，改 id 会打断既有锚点与验证脚本）：

| 页 | `id` | 管什么 | 设置项 |
| --- | --- | --- | --- |
| **事件触发** | `sequence` | 什么时候 / 在哪里触发——触发条件与规则 | 常驻动作序列与间隔、待机时长、触摸热区范围改为全屏、播放动作时点击、问候触发方式 |
| **事件池** | `touch` | 触发后能抽到哪些内容 / 播哪套动画 | 前三个入口的类别多选（同构连排）+ 末尾两行：点击触摸的事件族、spine 动作族显示 |

行序：三个**入口**先列完（待机 / 触摸 / 回到壁纸），再收两层筛子（事件族 → spine 动作族显示）。同构的三行连排，筛子排在入口之后。

另有两个可在「事件触发」页修改的行为开关：

- `touchFeedbackMode` —— 已有动作在演时再点一下：**`legacy`**（默认，问候 / 聊天时立即播新的；演触摸动作时点击不响应）/ **`immediate`**（立即播新的）/ **`queue`**（等当前这条演完接上）/ **`none`**（无反馈）。
- `greetMode` —— 问候取条方式：**`time`**（默认，按系统时间）/ **`random`**（随机）。

### 「事件池」页 · 三个「可触发的事件」多选（`*Kinds`）

**三项同构**的多选，每项决定**那一个入口**能播哪几类事件（选项为 `"chat"` / `"greet"` / `"touch"`，即 chat 类 / greet 类 / touch 类）：

| 设置项 | 字段 | 触发时机 | 缺省 |
| --- | --- | --- | --- |
| 长时间待机可触发的事件 | `standbyKinds` | 静置超过「事件触发」页设定的时长 | `["chat"]` |
| 触摸可触发的事件 | `touchKinds` | 点中任一热区 | `["touch"]` |
| 回到壁纸可触发的事件 | `resumeKinds` | 载入后 / 回到桌面 / 回到前台 / WE 暂停恢复 | `["greet"]` |

三个缺省分别对应各自入口的默认类别，既有工程无需改动即可保持原有触发行为。勾了多类时把各类的池**并成一个大池**随机取一条（池内每条等概率，类别之间按条目数加权）；写成空数组即关闭该入口。唯一例外：某个入口**只勾 `greet` 一类**时按 `greetMode` 取条，以保留「按系统时间问候」。

### 「事件池」页 · 两层正交的筛子：事件族（`eventFamilies` + `phases`）与动作族（`actionPhase`）

面板「事件池」页最后两行是两个独立机制：

| 面板项 | 字段 | 管什么 | 作用域 |
| --- | --- | --- | --- |
| **事件族** | `subtitle.phases` | 哪些念白能被抽到（族级许可） | 全局：一项都不勾 ⇒ 所有事件都不触发 |
| **spine 动作族显示** | `subtitle.actionPhase` | 播哪一套动画名（`greet` vs `greet_alt`） | 全局：常驻 / 问候 / 待机 / 点击 / 常驻序列 |

事件族对**所有入口**生效：只勾一个族时，其余族的事件在问候、待机、点击等所有通道同时失效；一项都不勾时所有事件都不触发，档案里没有任何事件行。

#### 两族制：动作族与事件族

同一套动作在不同形态下使用不同动画名的情形（例：`greet` ↔ `greet_alt`），由两个正交机制处理：

- **动作族**（`actionPhase`）负责动画名替换，并决定「属别的动作族的条目能否进池」；
- **事件族**（`phases`，全局闸门）负责「哪些族允许被触发」，四个入口共用同一道闸门。

不带后缀的基础形态归缺省族（`fallback`）。

```jsonc
// 声明两个族；只有单一形态的工程可整块省略（见下面的缺省）
"eventFamilies": [
  { "id": "alt", "label": "变体事件", "actionLabel": "变体",
    "default": true, "matchSuffix": "_alt" },
  { "id": "normal", "label": "普通事件", "default": true, "fallback": true }
],
"phases": ["alt", "normal"],   // 事件族（全局闸门；[] = 全关）
"actionPhase": "alt",          // 「spine 动作族显示」= 变体（缺省）
"actionPhaseBaseLabel": "基础"  // 不换名那一档的显示名
```

| 注册表字段 | 必填 | 含义 |
| --- | --- | --- |
| `id` | 是 | 事件族 id，条目 `phase` 引用它，自由字符串 |
| `label` | | 面板 / 档案里显示的名称，缺省回落成 `id` |
| `actionLabel` | | 「spine 动作族显示」单选里的短名（如「变体」），缺省回落 `label` |
| `default` | | 面板缺省勾选（可标多个；都没标时只勾缺省族） |
| `fallback` | | 缺省族（唯一）：条目未标族时归入本族，也是「不换名」的那一族 |
| `matchSuffix` | | 动作变体后缀：① 条目未写 `phase` 时用它判族；② `actionPhase` 指向本族时按「原名 + 后缀」换名。声明它即令本族出现在「spine 动作族显示」的选项里 |
| `keyPrefix` | | 按事件键前缀归族：如 `"custom:"` 令所有 `custom:*` 条目缺省落本族，无需逐条写 `phase` |

条目归属事件族的四段判据（引擎 `dialogue.resolveDialoguePhase`）：① 条目显式 `phase` 且在注册表里 ⇒ 采用它；② 否则按各族的 `keyPrefix` 匹配事件键前缀（先声明先赢）；③ 否则按各族的 `matchSuffix` 匹配动画名；④ 都不中 ⇒ 缺省族。

前缀判据排在动画后缀之前：事件键是来源声明（`custom:` = 自建、`game:` = 游戏表出身），比「动画名以 `_alt` 结尾」更可靠。自建事件需要归属某个动作族时，写显式 `phase`。

#### 节日族与自定义族

```jsonc
"eventFamilies": [
  { "id": "normal",   "label": "普通事件",   "fallback": true, "default": true },
  { "id": "festival", "label": "节日事件",   "default": true },
  { "id": "custom",   "label": "自定义事件", "default": true, "keyPrefix": "custom:" }
]
```

- **节日类**：情人节 / 元旦 / 春节等条目写 `"phase": "festival"`。农历节日（春节 / 中秋 / 端午）的公历日期逐年漂移，用 `when.dates` 直接列出：`{"dates": ["2026-02-17", "2027-02-06", "2028-01-26"]}`，每年追加一行。引擎按 `dates` 精确比对，农历换算由内容侧维护（错一天等于过节过错了）。
- **自定义类**：所有 `custom:*` 由 `keyPrefix` 自动认领，无需逐条写 `phase`；面板可整族关闭用户自建事件，内置事件不受影响。
- 三族都标 `default` ⇒ 面板缺省全勾，行为与「没有族」时逐条一致。
- 存档同步：`phases` 由面板写入 `localStorage`。新增事件族后到「事件池 → 事件族」勾上需要的族（或点面板底部「恢复默认」，一并清理该存档）。未勾选的族在档案面板中标为「所属事件族「custom」未勾选 ⇒ 当前不可触发」。

**换名**（引擎 `dialogue.resolveEntryAnimation`，三分支、显式优先）：① `DialogueEntry.phaseAnimations[actionPhase]` ⇒ 采用它（覆盖 `chat` → `chat_alt` 这类不符合「原名 + 后缀」的命名）；② 原名已以该族后缀结尾 ⇒ 原样；③ 其余 ⇒ 原名 + 后缀。换名只改动画名，`actionId` / `text` / `voice` 保持原值。

| `subtitle.eventFamilies` | 结果 |
| --- | --- |
| 未配置 / 非数组 / 数组内无合法项 | 内置缺省：只有一族 `normal`，单一形态的工程不显示「事件族」与「动作族」两行 |
| 空数组 `[]` | 该壁纸不启用事件族机制：两行都不建，不按族筛，不换名 |
| 合法数组 | 原样归一（丢弃非法项、按 `id` 去重、保持声明顺序） |

| 设置项 | 字段 | 缺省 | 说明 |
| --- | --- | --- | --- |
| 触摸热区范围改为全屏 | `touch.fullscreen` | `false` | 位于「事件触发」页：打开后忽略 `touch.zones`，整块画面都是热区 |
| 事件族 | `subtitle.phases` | 注册表的缺省勾选 | 位于「事件池」页倒数第二行；全局：先按族筛、再按类别随机；`[]` = 全关 |
| spine 动作族显示 | `subtitle.actionPhase` | 第一个带 `matchSuffix` 的族 | 位于「事件池」页末行（单选）；`""` = 不换名 |

`phases` 的缺省 = 注册表里标 `default` 的族（都没标时取缺省族）；写成空数组即全关（所有池为空）。注册表为空或无动作族时，对应那一行不建。三个自动通道（待机 / 回到壁纸 / 常驻序列）与点击**共用同一套池**、受**同一道族闸门**约束 —— 只勾一族时其余族在四个通道里同时失效。池成员资格由 `dialogue.isEntryVisibleInPhase` 判定：在当前动作族下，属其他族的条目留在池外。

> 兼容字段：`greeting`（时段 → actionId 的映射）、`standby`（单条 actionId）与两个布尔 `standbyGreetEnabled` / `standbyTouchEnabled` 仍被读取（两个布尔只作用于待机通道），老配置照常工作；新配置直接用上面的三条数组 + 三个 `*Kinds`。`greet` / `chat` 写成**空数组**时视同未配置，退回旧字段，避免静默关掉整类事件。`greetInTouchPool` 的语义由「触摸可触发的事件」勾选 greet 类表达。

### 「壁纸独立设置」页 —— 只对本壁纸生效的项

面板标签条**最后一页**，收只对某一张壁纸有意义的设置项（通用页只留通用项），由**壁纸自己的 `config.json`** 声明：

```jsonc
"wallpaperSettings": {
  "label": "本壁纸",            // 页内分组标题
  "items": ["<itemId>"]         // 面板已实现的项 id，数组顺序 = 面板行序
}
```

| 字段 | 含义 |
| --- | --- |
| `wallpaperSettings.label` | 页内**分组标题**，缺省 `"本壁纸"` |
| `wallpaperSettings.items` | 本壁纸声明的独立设置项（数组顺序 = 面板里的行序） |

`items` 的取值需为面板已实现渲染的项 id（见 `src/settingsPanel.ts` 的 `KNOWN_WALLPAPER_ITEMS`）；未知 id 与重复项静默丢弃，新增一项时在面板侧同步补渲染分支。未声明、`items` 为空或全部 id 无效时，面板连这一页（含标签按钮）都不建，避免出现永远空着或永远无效的页。

`wallpaperSettings` 只声明「展示什么」，各项的值仍在自己所属的正式字段里，覆盖层字段名与落盘格式保持一致。「画面调整」页保留「画面对齐基准」与「鼠标粒子拖尾」两项通用设置。

## 快速开始

### 制作壁纸（免构建、免 Node.js）

下载 [Releases](https://github.com/awei808/spine-particle-wallpaper/releases) 里的**引擎包**（约 300 KB，只含引擎，不含素材）：

1. 解压，把 Spine 三件套（`*.skel` / `*.atlas` / `*.png`）放进 `assets/`
2. 把 `assets/config.example.json` 复制成 `config.json`，按素材修改
3. 整个目录放进 `<WE>/projects/myprojects/`，在 Wallpaper Engine 里应用

详见包内的「使用说明.md」。换素材、改配置、写台词都在运行时生效：`config.json` 与 `events.jsonc` 从 `assets/` 读取，`bundle.js` 是通用引擎，重新打包仅在做引擎改动时需要。

### 从源码构建

```bash
git clone --recurse-submodules https://github.com/awei808/spine-particle-wallpaper.git
cd spine-particle-wallpaper
npm ci
```

`--recurse-submodules` 为必需参数：`packages/threejs-spine-3.8-runtime-es6` 是子模块，缺它构建即失败。

打引擎包分发给他人：`npm run pack`（构建 + 剔除本地素材 + 产出 zip，见 `scripts/packEngine.ts`）。

放置素材与配置：

1. 把 Spine 三件套（`*.skel` / `*.atlas` / `*.png`）拷进 `public/assets/`
2. 复制示例配置：`cp public/assets/config.example.json public/assets/config.json`
3. 按素材修改 `config.json` —— 字段说明见 [public/assets/README.zh.md](./public/assets/README.zh.md)

本地预览与构建：

```bash
npm start          # 起 dev server
npm run build      # 产出 dist/bundle.js
```

导入 Wallpaper Engine：把 `dist/` 的内容连同 `assets/` 一起放进一个 WE 工程目录，再按[官方教程](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html)导入。

## 目录结构

```
src/
  index.ts                装配与主循环
  initScene.ts            场景、相机、画幅自适应
  audioMaster.ts          音频总闸（BGM + 语音的暂停控制点）
  bgmPlayer.ts            BGM 播放器
  voicePlayer.ts          念白语音播放器（ogg/mp3/wav/m4a 多格式兜底）
  voiceBubble.ts          字幕气泡
  dialogue.ts             念白调度
  touch.ts                触摸热区与动作闸门
  touchZones.ts           热区数据层：归一 / 校验 / 命中 / 重叠裁决
  pointerTrail.ts         指针拖尾
  settingsPanel.ts        内置设置面板
  settingsStore.ts        设置读写与覆盖
  archive.ts              档案面板
  disclaimer.ts           免责声明
  wePauseSignal.ts        WE setPaused 信号的安装点
  idleSequence.ts         常驻动作序列
  probe.ts / probeHud.ts  调试探针
  animator/               texture / spine / video / particle 四种层
_regress/                 回归脚本（ts-node）
scripts/voiceManifest.ts  语音清单与引用校验（npm run voice-manifest）
public/assets/            素材与 config.json（素材已 gitignore）
```

## 已知缺陷

- 指针拖尾的发射间距由光标速度决定，快速划动时分布不均；计数逻辑正确，分布逻辑待优化。

## 许可证

- 本仓库：**GPL-3.0**，见 [LICENSE.txt](./LICENSE.txt)。
- Spine 运行时：**Spine Runtimes License Agreement**，见 [LICENSE.spine.txt](./LICENSE.spine.txt)。
- 衍生自 spicy-wolf/spine-wallpaper-engine（GPL-3.0），详见 [NOTICE.md](./NOTICE.md)。

### Spine Runtimes 的许可约束

Spine Runtimes 采用独立的商业许可。按其协议原文：

1. **每一位使用者都须自行取得 Spine Editor 许可证**；
2. **以任何形式再分发本作品时，必须随附该许可证与版权声明**。

也就是说：本框架免费开源，**用它播放 Spine 动画的人需要自己持有合法的 Spine 授权**。许可证原文：<https://esotericsoftware.com/spine-runtimes-license>

壁纸内置同一份声明的弹窗，在壁纸属性里勾选「显示免责声明与许可证要求」即可向最终使用者展示。

## 免责声明

- **本仓库仅供个人学习与技术交流**，使用范围限于非商业用途。
- **Spine 授权由使用者自行判断与负责**——是否需要 Spine Editor 许可证、如何取得，请自行确认。
- 仓库内的示例素材（第三方游戏的角色立绘、Spine 骨架、语音与音乐）著作权归原权利人所有，仅作技术示例。**请勿单独提取或再分发这些素材**，亦请勿宣称本作品为官方内容。`public/assets/*` 本身不含任何素材。
- 使用本程序的风险与后果由使用者自行承担；因素材权利、授权资质或任何使用行为引发的纠纷与责任，**原作者不承担任何责任**。
