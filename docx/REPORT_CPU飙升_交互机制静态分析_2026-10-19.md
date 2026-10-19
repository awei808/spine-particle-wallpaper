# WE 壁纸 CPU 飙升 · 交互机制静态分析

- 日期：2026-10-19
- 方法：**纯静态分析**（读代码 + 联网核对官方文档），**未做任何测试**
- 触发问题：用户观察到「开 WE + 开其他应用（不全屏）⇒ CPU 飙到 90~100%」，
  而「只开 WE」能稳在 20% 内、「只开其他应用」也不超 70%。
- 结论：**用户的怀疑方向是对的**。这不是 MSAA / dpr / 帧率的问题（那是恒定开销，
  无法解释"随其他应用开关而跳变"），而是**鼠标事件驱动的每帧放大链路**，
  且引擎**在失去焦点时不降负载**。

---

## 0. 先排除上一轮的结论（它解释不了本现象）

上一轮归因出MSAA（−22%）、dpr（−61%）、帧率上限。这些是**恒定开销**：
壁纸一打开就在那里，与"有没有别的应用"无关。

用户的现象是**跳变**（20% ↔ 90~100%），且明确 correlates 于"是否操作其他窗口"。
恒定开销无法解释跳变 ⇒ 上一轮方向虽然没错（那些确实有效），但**不是本现象的主因**。

---

## 1. 根因：CEF 离屏渲染下宿主持续投递鼠标事件

### 1.1 平台机制（联网核对）

WE 的网页壁纸跑在 **CEF 离屏渲染（Off-Screen Rendering, OSR）** 下。
CEF 官方文档对OSR 的原文（[cef general_usage](https://chromiumembedded.github.io/cef/general_usage.html)）：

> "With off-screen rendering CEF does not create a native browser window. Instead, CEF
> provides the host application with invalidated regions and a pixel buffer and **the host
> application notifies CEF of input events such as mouse, keyboard and focus**."
>
> "**Off-screen rendering does not currently support accelerated compositing** so performance
> may suffer as compared to a windowed browser."

DeepWiki 的 CEF 文档进一步指出 OSR 的输入走`CefRenderWidgetHostViewOSR`，
鼠标移动经`SendMouseEvent()` 投递，`MouseMove` 与 enter/leave 同属一路。

**关键推论**：OSR 模式下鼠标事件是**宿主主动投递**的，不是靠窗口消息循环。
⇒ 鼠标在 VSCode/WorkBuddy 窗口里移动时，**壁纸进程照样收到 `mousemove`**，
而它同时还在全速渲染、且收不到任何"我被遮住了"的信号。

### 1.2 引擎侧完全不知道"自己不可见"

`wePauseSignal.ts` 文件头把这件事写得很清楚（本项目已实测确认）：

> "WE **没有**'回到桌面'事件 —— 桌面壁纸窗口永远'可见'，
> `visibilitychange` / `focus` 在壁纸里基本收不到（早期版本就挂了这两个，实测 WE 下不触发）。"

代码印证（`grep document.hidden|hasFocus|blur`）：整个 `src/` 里
**没有任何一处**读`document.hidden`、`window.hasFocus()` 或 `blur` 事件来做降载决策。
`index.ts:1350` 挂了 `visibilitychange`，但注释自己写着"普通标签页场景的兜底"。

### 1.3 最关键的缺陷：`setPaused` 只管音频，不降渲染

WE 会调 `wpl.setPaused(true/false)`。本项目装了这个回调（`wePauseSignal.ts:170`），
两个订阅者：

| 订阅者 | 位置 | 收到 `setPaused(true)` 时做什么 |
|---|---|---|
| `audioMaster` | `audioMaster.ts:149` | 停/续 BGM 与语音 |
| `onPauseChange` | `index.ts:1239` | 记一个时间戳 `pausedAt`，供"回来超过 15 秒播问候"用 |

**两者都不碰渲染。** `render()` 循环里没有任何 `isPaused` 判断
（`index.ts` 的 `render()` 只有 `maxFps` 一个门控，而 `maxFps=60` 形同不限）。

⇒ 失焦期间壁纸照旧：全速渲染 + 所有交互链路照旧点燃。

---

## 2. 四条被 mousemove 点燃的每帧链路

`initScene.ts:493` 在 **document** 上挂了 `mousemove`（冒泡阶段），
每次调用 `preventDefault()` 并更新 `cursorX/cursorY`。
`cursorX/cursorY` 有三个消费方，加上渲染本身，共四条链路：

### 链 1 · 探针 HUD（**发布态默认开启**）

`probe.ts` 在 `mousemove` 与 `pointermove` 上各挂一个监听，两者都调 `touch(event)`，
而 `touch()` 内部（`probe.ts:470`）：

```ts
const touch = (event) => {
  lastScreenX = event.clientX; lastScreenY = event.clientY;
  if (hud) { hud.setCross(lastScreenX, lastScreenY); renderHud(); }
};
```

- `renderHud()` 会调 **11 次** `hud.setLine`
- `setLine` 有内容比较节流（`probeHud.ts:123`，2026-09-28 加的性能修复），
  所以静止时不碰 DOM —— **但 mousemove 计数、光标 px、光标 NDC 这几行每次都在变**
  ⇒ 节流在"动鼠标时"完全失效。
- `setCross` 写 `cross.style.left/top`（`probeHud.ts:157`）。它**只比较坐标是否变化**，
  而鼠标移动时坐标每次都变 ⇒ 每次都写 `left/top` 到一个 `position:fixed` 元素
  ⇒ **每次 mousemove 触发一次重排 + 重绘**。

⚠️ `config.json` 当前是 `"probe": {"enabled": true, "hud": true}`。
文件头自己的实测记录（`probeHud.ts:107-118`）写着：探针开时 `LayoutCount`
≈ **145 次/秒**，关时 ≈ 0.15 次/秒，**差约 1000 倍**，`TaskDuration` +64%。

### 链 2 · 鼠标拖尾（**config 里已启用**）

`pointerTrail.update(delta)` 挂在每帧回调上（`index.ts:1908`）。
它读 `Scene.cursorX/cursorY` 的**帧间位移**来发射粒子（`pointerTrail.ts:335`）：

```ts
const nx = Scene.cursorX, ny = Scene.cursorY;
const step = Math.hypot(nx - prev.x, ny - prev.y);
if (!(step > 0) || step > MAX_STEP_NDC) return;   // MAX_STEP_NDC = 0.25
...
while (this.travel >= spacing && budget > 0) { this.spawn(...); budget--; }  // MAX_SPAWN_PER_FRAME = 48
```

也就是说：**鼠标移动越快、每帧发射越多**（单帧上限 48 颗）。
`buildGeometry()` **每帧全量重写**全部存活粒子的顶点缓冲并标`needsUpdate`
（`pointerTrail.ts:422-461`），4 个 BufferAttribute 全量上传；
粒子满了走 `this.particles.shift()`（`:386`）—— 数组头删，**O(n)**。

⚠️ `config.json` 的 `pointerTrail` 是 `{"enabled": true}`，
`maxParticles` 未写 ⇒ 走默认 `DEFAULT_MAX_PARTICLES = 120`（`pointerTrail.ts:70`）。

**鼠标在其他应用窗口上移动 = 拖尾一直在发射**。这是"动鼠标就飙"的最直接解释。

### 链 3 · 骨架光标跟随 —— **本例不成立，已排除**

`SpineAnimator` 每帧调 `cursorActionAnimationUpdateFunc()`（`SpineAnimator.ts:168`），
若配了 `cursorFollow` 会重算骨骼世界坐标。
**但实测 config 里两个骨架都没有 `cursorFollow` 字段**（查 `public/assets/config.json` 确认）。
⇒ 该链在S9 这套配置下不产生开销。列出仅为完整性。

### 链 4 · 每帧 23 个 update 回调（恒定，与鼠标无关）

`meshUpdateCallbacks` 的订阅方：2 个 spine + 12 个 texture + 8 个 particle + 1 个 trail = **23 个**。
这部分是恒定开销（对应上一轮测出的每帧 3.38ms），
**它解释不了跳变，但它是"基线负载"，与交互链路叠加**。

---

## 3. 为什么"只开 VSCode"没事，"开 WE + VSCode"就飙

| 场景 | 鼠标是否高频移动 | 四条链路 | CPU |
|---|---|---|---|
| 只开 WE，不动鼠标 | 否 | 全静默 | ~20%（基线 = 链 4） |
| 只开 VSCode/WorkBuddy | 是（在**它自己**的窗口里） | **壁纸收不到事件** | ≤70% |
| 开 WE + VSCode，操作窗口 | 是（在**别的应用**里） | **全部点燃** | **90~100%** |

第二行是关键对照：**同一个物理鼠标动作，在"壁纸自己窗口内"壁纸收得到，
在"别的应用窗口内"壁纸也收得到** —— 区别只在于后者还叠加了另一个应用的 CPU 占用。

⇒ 不是"别的应用把壁纸拖慢了"，而是"**壁纸在被看不见的时候仍在满负荷 + 别的应用也要 CPU**"
⇒两者叠加 ⇒ 90~100%。**抢的是同一批核心。**

---

## 4. 修复建议（按性价比）

### ★★★ P0：让引擎在失焦时降载（最对症）

`setPaused` 已经有信号了，只是没用。**在 `render()` 里加一个 `isPaused` 门控**：

```ts
// 失焦时降到 1/4 帧率（不是完全停 —— 完全停会导致回来时 delta 巨大）
const gap = isPaused() ? minFrameGap * 4 : minFrameGap;
```

- `isPaused()` 已导出（`wePauseSignal.ts:207`）
- 代价极低：改一处判断
- 效果：失焦期间 CPU 降到 1/4，且用户完全看不见（壁纸被遮住）

⚠️ 前提是用户得把 WE 设置里的「其他应用程序获得焦点时」设成 **Pause**。
**这必须先跟用户确认当前设置** —— 默认值是 Keep running，那样`setPaused` 根本不会来。

### ★★ P1：关掉发布态探针（改动最小、见效最快）

`config.json` 改`"probe": {"enabled": false, "hud": false, "crosshair": false}`。
- 消掉链 1 整条链路（含每次 mousemove 的 DOM 重排）
- 依据是项目自己的实测：`LayoutCount` 145 次/秒 → 0.15 次/秒
- 调试时用 WE 属性面板的 `probeEnabled` 临时打开即可，不影响开发

### ★★ P2：拖尾加"失焦即停"或降低发射

- 最小改动：`pointerTrail` 在 `update()` 开头读 `isPaused()` 直接 return
- 或把 `MAX_SPAWN_PER_FRAME` 从 48 降到 16、`DEFAULT_MAX_PARTICLES` 从 120 降到 48
- 或改 `MAX_STEP_NDC`：鼠标快移时反而应该少发（现在是发得更多）

### ★ P3：`mousemove` 监听降频

`initScene.ts:493` 的处理器目前只做两件极轻的事（两次除法 + `preventDefault`）。
**问题在于它是三条链的共同源头**。可以加一个"每帧最多处理一次"的节流，
把事件频率从 ~1000Hz 压到帧率级别。这是从源头削减放大系数。

### ★ P3：面板 `SWALLOW_EVENTS` 缺 `mousemove`

`settingsPanel.ts:553` 的 `SWALLOW_EVENTS` 列了 11 个事件，
**独缺 `mousemove`**（`root` 又是 `pointer-events:none` 的全屏 fixed 盒子）。
⇒ 在面板附近移动鼠标时，事件照样冒泡到 document 点燃三条链。
把 `mousemove` 加进去是个一行修复。

### WE 侧设置（不改代码）

官方文档（[help.wallpaperengine.io](https://help.wallpaperengine.io/zh/performance/game.html)）确认
性能页有独立的三个选项：「其他应用程序**焦点**时/ **最大化**时 / **全屏**时」，
各自可选 Keep running / Pause / Stop。默认只对**全屏**暂停。
⇒ **把「焦点」也设成 Pause**，是零代码成本的最大杠杆。

---

## 5. 诚实标注

- **本轮未做任何测试**，全部为读代码 + 文档核对。上面每条因果链都给出了
  文件与行号，但**「哪条贡献了多少 CPU」没有量化**。
- 链 3（骨架光标跟随）经查 config 确认**不成立**，已排除，不是漏查。
- 探针的 145 次/秒布局是**项目自己的历史实测**（`probeHud.ts` 注释里记录），
  条件是 1700×750 无头 165fps，与你的真机场景不完全等同。
- WE「焦点时暂停」的**当前设置值我不知道**，需要你确认（见 §6）。
- 上一轮的 msaa/dpr/帧率结论依然有效（那些是真实收益），
  但**它们是恒定开销，解释不了你观察到的跳变**。

## 6. 需要你确认的两件事

1. WE 设置 → 性能 →「其他应用程序**焦点**时」当前是 Keep running 还是 Pause？
   如果是 Keep running，P0 的前提不成立，得先改这个设置。
2. 是否接受把探针在发布态关掉（P1）？它默认开着是历史遗留的调试便利，
   但代价是每次鼠标移动都触发 DOM 重排。