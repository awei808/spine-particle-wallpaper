# WE 壁纸 CPU 占用（交互 / 事件机制向）· 静态分析报告

- 日期：2026-10-19
- 对象：`D:\SteamLibrary\...\wallpaper_engine\projects\myprojects\星语心恋S8`（WE 当前实际在用的壁纸）
- 源码：`D:\手游文件夹\spine-wallpaper-engine`
- 方法：**只做静态分析**（读仓库源码 + 读 WE 本机配置 + 查 WE 官方文档），不做实测、不起服务、不抓帧。
- 前置：`REPORT_WE_CPU占用归因_2026-10-19.md`、`REPORT_降低CPU占用_实施与验证_2026-10-19.md`（上一轮）

---

## 0. 一句话结论

不是"某个算法慢"，而是**三层叠加**：

1. **壁纸从未真正限帧**——它不读 WE 的 FPS 设置，也不因"用户在别的窗口里工作"而降速；
2. **交互期间每帧还多一层固定开销**（拖尾几何全量重传、全局鼠标监听、布局读取）；
3. **WE 的暂停策略当前是"其他应用获得焦点 = 继续运行"**，于是"打开 VS Code 干活"恰好落在"壁纸全速跑"的区间里。

第 3 条是**一键可改的设置**，第 1 条是**代码结构性缺失**，第 2 条是**每帧浪费**。

---

## 0.5 与上一轮（同日「交互机制静态分析」）的关系

上一轮已得出的、本轮**保留不重复**的结论：

- WE 的 web 壁纸跑在 CEF 离屏渲染（OSR）里，鼠标事件由**宿主主动投递**
  ⇒ 鼠标在别的应用窗口里移动，壁纸仍可能收到 `mousemove`；
- `setPaused` 的两个订阅者**只管音频/问候**，`render()` 里没有任何暂停判断；
- `visibilitychange` / `focus` / `blur` 在 WE 下不可靠（`wePauseSignal.ts:37` 自证）；
- 探针 HUD + 拖尾是被 `mousemove` 点燃的两条主链；
- WE 性能页「其他应用**焦点**时」是唯一能覆盖"窗口没最大化但你在用"的规则。

本轮的**新增证据 / 修正**：

| # | 上一轮 | 本轮（读文件得到的事实） |
|---|---|---|
| 1 | WE 里跑的是 S9（按 S9 的 23 个 update 回调推算） | **实际是 `星语心恋S8`**；S8 = 6 spine + 4 texture + 1 particle + 1 trail = **12 个 update 回调** |
| 2 | 「WE 焦点设置」列为**待用户确认**的 P0 前提 | **已读到值：`playbackfocus = 'run'`** ⇒ 前提成立，且现状就是"继续运行" |
| 3 | 未提 WE 的 FPS 设置 | **`general.user.fps = 30`**，而代码**从未注册 `applyGeneralProperties`** ⇒ 这个 30 对壁纸零约束 |
| 4 | 「帧率优化已做但未部署」 | **补两层**：S8 的 bundle 是 10-17 旧包（`maxFps` 命中 0），**且 S8 的 config 没有 `maxFps` 键** ⇒ 只换 bundle 也仍是 `0` |
| 5 | 拖尾"每帧全量重写 4 个 attribute" | 补：还会**每帧读 `clientHeight`**（布局读取）、**每颗粒子 new 4 个临时数组**（GC） |

⇒ 上一轮的方向（交互链路）成立；本轮把它落到**具体部署态与具体配置值**上，并补了"WE 的 FPS 契约根本没接"这一层。

---

## 1. 先纠一个事实：上一轮优化从未进入 WE

| 证据 | 值 | 判读 |
|---|---|---|
| `wallpaper_engine/config.json` → `general.wallpaperconfig.selectedwallpapers.Monitor0.file` | `...\myprojects\星语心恋S8\index.html` | **WE 跑的是 S8，不是 S9** |
| `星语心恋S8\bundle.js` mtime | 2026-10-17 20:18 | 10-19 的优化包没部署 |
| `星语心恋S8\bundle.js` 里 `maxFps` 命中数 | **0** | 该包**没有任何帧率上限** |
| `星语心恋S8\bundle.js` 里 `applyGeneralProperties` 命中数 | **0** | 不读 WE 的 FPS 设置 |
| `星语心恋S8\bundle.js` md5 | `266971f0…` | 与 `dist/bundle.js`（`b22f5ee3…`）**不同** |
| `星语心恋S8\assets\config.json` 的键 | 无 `antialias`、无 `maxFps` | 即使换新 bundle，S8 **也拿不到这两个值** |

**结论**：你现在观察到的 WE 行为，是"MSAA 写死 true + 裸 rAF + 无任何节流"的旧包。
上一轮的 `antialias:false` / `maxFps:60` 只改了 `public/assets/config.json`（S9 那份），
**既没部署、S8 的 config 也没有这两个键**。所以"看起来不是帧率问题"是因为**帧率优化根本没上线**。

> ⚠️ 补一条更隐蔽的：`maxFps` 的取值是 `configs.maxFps ?? 0`。
> 换新 bundle 但 S8 的 config 不加 `maxFps` ⇒ 仍然 `0` ⇒ **照旧裸跑**。
> 而且即使写 `maxFps: 60`，在 60Hz 屏上 rAF 本来就在 16.7ms 附近，**几乎不减帧**。
> 想真正压住，必须 ≤30（与 WE 的设置对齐，见 §3.1）。

---

## 2. 代码侧：事件与每帧路径审计（按影响排序）

### 2.1 ★★★ 未实现 `applyGeneralProperties` ⇒ WE 的 FPS 限制对这张壁纸完全无效

WE 官方《FPS Limiter》文档（`docs.wallpaperengine.io/en/web/performance/fps.html`）明确：

> "The `wallpaperPropertyListener` provides the `applyGeneralProperties` event.
> Inside the `properties` parameter, you will find the value `fps`…
> **The page has to honour it**（帧率限制由壁纸自己执行，宿主不代劳）。"

而本机 WE 的配置里：

```
general.user.fps = 30
```

**你在 WE 里设的 30fps，这张壁纸一个字都没读。**
代码里 `wallpaperPropertyListener` 只补了两个字段：

| 字段 | 位置 | 作用 |
|---|---|---|
| `setPaused` | `src/wePauseSignal.ts:170` | 只用来停 BGM / 播"回到壁纸"问候，**不停渲染** |
| `applyUserProperties` | `src/settingsStore.ts:893` | 只处理属性面板的 5 个开关 |

`installWallpaperPropertyListener`（`settingsStore.ts:883`）从未注册 `applyGeneralProperties`。
⇒ **WE 的性能设置（Quality → FPS limit）对 web 壁纸的唯一生效途径被掐断了**。
这解释了为什么"别的壁纸开 30fps 很省，这张照样吃满"。

### 2.2 ★★★ 渲染循环没有任何"空闲 / 失焦降速"

`src/index.ts:2478-2516`：

```ts
const maxFps = configs.maxFps ?? 0;          // S8 的 config 没有这个键 ⇒ 0
const minFrameGap = maxFps > 0 ? ... : 0;    // ⇒ 0 ⇒ 不节流
const render = () => {
  ...
  meshUpdateCallbacks.forEach(cb => cb(d));  // 6 层骨架 + 4 层贴图 + 粒子 + 拖尾
  Scene.renderer?.render(...);               // 11 层透明叠加
  requestAnimationFrame(render);             // 裸 rAF
};
```

没有任何判据看"用户是不是正在用别的程序"。桌面壁纸的窗口**永远可见**（`visibilitychange` 在 WE 里基本收不到，代码注释 `wePauseSignal.ts:37` 已自证），
所以浏览器那套"后台标签页降频"在这里**完全不适用**。
⇒ 只要 WE 不主动暂停，壁纸就是满帧。

### 2.3 ★★ WE 当前的暂停策略：`focus = run`（这就是"打开 VS Code 就飙"的直接原因）

本机 WE 配置（`config.json` → `general.user`）：

```
playbackfullscreen  = 'pause'   ← 全屏时暂停
playbackmaximized   = 'pause'   ← 最大化时暂停
playbackfocus       = 'run'     ← ★ 其他应用获得焦点时：继续运行
playbackonbattery   = 'run'
playbacksleep       = 'pause'
apprules            = []        ← 没有任何应用规则
```

WE 的判定是**三条独立规则**：

- `fullscreen`：其他应用**独占全屏**；
- `maximized`：其他应用**最大化**；
- `focus`：其他应用**获得焦点**（哪怕只占屏幕一角）。

你的用法是"VS Code / WorkBuddy **不全屏**"——既不是全屏、也不是最大化，
**唯一能覆盖这个场景的就是 `focus`，而它当前是 `run`**。
⇒ WE 认为"没有触发暂停条件"，壁纸继续 60fps 全速跑。

这就是"打开 WE 只占 20%，再开编辑器就 90~100%"的机制：
**不是壁纸变重了，是它压根没让路**，两边抢同一批核心。

> 这属于 WE 的设计口径，不是本仓库的 bug；但它正好是你怀疑的"WE 交互逻辑"。

### 2.4 ★★ 拖尾 `PointerTrail`：每帧无条件重建几何 + 每帧读布局

`src/pointerTrail.ts:322-327`：

```ts
public update(delta: number): void {
  this.frames++;
  this.spawnAlongCursor();
  this.advance(delta);
  this.buildGeometry();     // ← 无条件，哪怕 0 颗粒子
}
```

`buildGeometry()`（`pointerTrail.ts:422-461`）每帧做四件事：

1. `worldPerPx()`（`:472-481`）里读 `renderer.domElement.clientHeight` —— **每帧一次布局读取**；
2. 循环里**每颗粒子新建 4 个临时数组**（`qx/qy/qu/qv`，`:438-441`）⇒ 120 颗 = 480 次小数组分配/帧 ⇒ GC 压力；
3. 全量重写 `pos/uv/color/alpha` 四个 `BufferAttribute` 的整个数组；
4. 四个 `needsUpdate = true`（`:456-459`）⇒ 每帧 4 次 `bufferSubData` 上传，**即使 `n=0` 也照传**。

S8 的配置：`pointerTrail.enabled = true`、`trailA: spacing 19px / maxParticles 120 / life 0.5s`。
⇒ **鼠标一动就撒粒子**，这正是"交互期间 CPU 抬升"的确定性来源。
同时 `clientHeight` 与任何同帧 DOM 写入（probe 的 `setCross`、气泡、面板）会形成**强制同步重排**。

### 2.5 ★★ 鼠标监听：重复绑定 + 全局 `preventDefault`

| 位置 | 监听 | 说明 |
|---|---|---|
| `src/initScene.ts:493` | `document mousemove` | 内部 `event.preventDefault()`（`:496`），**非 passive** |
| `src/probe.ts:487` | `document mousemove` | 仅 `probe.enabled` 时挂（S9 是 true，S8 是 false） |
| `src/probe.ts:497` | `document pointermove` | 同上 |
| `src/initScene.ts:502` | `document mousedown` | |
| `src/touch.ts:1058` | `document mousedown` | 热区判定 + 播动作 |
| `src/animator/SpineAnimator.ts:128/145` | `document mousedown` / `mouseup` | **每个骨架实例各挂一份** |

S8 有 **6 个 spine 实例**（主体 + `BJ_01~05` 五个挂件，均为独立 `.skel/.atlas`，见 §2.6），
⇒ **12 个 document 级 mousedown/mouseup 监听**，每次点击全部触发一遍 `preventDefault()`。
`mouseup` 若在壁纸外松开（桌面场景很常见），还会残留"按下"状态。

`preventDefault()` 在 `mousemove` 上是纯负担：壁纸没有滚动、没有文本选择，取消默认行为毫无收益，
却让 Chromium 无法把该监听当作 passive 快速路径处理。

### 2.6 ★★ S8 的每帧固定成本：6 个独立骨架 + 4 张全屏贴图

`星语心恋S8/assets/config.json` 的 11 个 mesh：

| 层 | 内容 |
|---|---|
| 4 × `texture` | 1754×1167 / **2536×2536（星轨，`spinDegPerSec:4`）** / 1741×1158 / 1734×1153 —— 全是**全屏尺寸**透明贴图 |
| 6 × `spine` | `SoulDress_Asuna_08` + `BJ_01~05`，**6 个不同骨架文件**，4 个播 `idle`、2 个播 `animation` |
| 1 × `particle` | `trail01` |

⇒ 每帧：**6 次骨架解算 + 6 次蒙皮顶点重算 + 6 次 `bufferSubData`**，再叠 **10 层全屏半透明**。
`meshUpdateCallbacks` 合计 **12 个**（6 spine + 4 texture + 1 particle + 1 trail），全部每帧无条件执行（`index.ts:2508`）。
`ParticleAnimator.update`（`animator/ParticleAnimator.ts:2918`）同样是每帧无条件 `buildGeometry()`，
5 个 attribute 全量 `needsUpdate`（`:3480-3485`）。

> 这不是"交互 bug"，但它决定了**基线成本**：壁纸本来就吃掉 ~20%（与你观察一致）。
> 一旦别的应用再吃 30~50%，冲突就必然发生——**因为壁纸没让路**。

### 2.7 ★ 探针 HUD（只影响 S9，但会伪装成"限帧没用"）

`src/probe.ts:531-535`：

```ts
const tick = () => {
  renderHud();
  requestAnimationFrame(tick);   // ← 独立 rAF，不受 maxFps 节流
};
```

即使给 `render()` 加了 `maxFps`，**探针这条 rAF 仍按刷新率跑**，每帧 `renderHud()`。
`probeHud.setCross()`（`:143-160`）在每次 `mousemove` 写 `left/top` ⇒ fixed 元素重定位。
S9 的 `config.json` 是 `probe:{enabled:true,hud:true}`；S8 是 `false`。
⇒ 若你之后切到 S9 验证"限帧生效没"，**探针会把结论污染成"没生效"**。

### 2.8 ★ 其他零散项（量级小，但都是"交互触发"）

| 项 | 位置 | 量级 |
|---|---|---|
| `focus` 监听 → `tryResumeEvent('focus')` | `index.ts:1357` | 每次点桌面可能触发一次问候（5s 去重），会切动作 ⇒ 瞬时峰值 |
| `setInterval(tickStandby, 1000)` | `index.ts:1368` | 1Hz，可忽略 |
| BGM 常驻 ogg 解码（`bgm.enabled=true`, loop） | `config.json` | 音频线程持续解码 |
| `writeOverrides` 每次属性下发都写 localStorage | `index.ts:227` | 同步 IO，仅属性变更时 |
| 免责声明常驻（`showDisclaimer=true`） | `project.json` | 一层静态 DOM，无滤镜，成本低 |

---

## 3. 外部机制（联网核实，非臆测）

| 事实 | 来源 |
|---|---|
| **FPS 限制必须由壁纸自己实现**，WE 只通过 `applyGeneralProperties(fps)` 通知 | WE 官方《FPS Limiter》文档 |
| web 壁纸跑在 CEF 里，"interactive mouse-tracking / 复杂 JS" 是 CPU 尖峰的头号来源 | WE 社区/性能指南（多篇一致） |
| WE 的暂停规则是 **fullscreen / maximized / focused** 三条独立规则，"focused" 会在**你与任何窗口交互时**停渲染（哪怕没盖满屏幕） | WE 性能设置说明 |
| WE 通过**全局低层鼠标钩子（WH_MOUSE_LL）**把鼠标转发给壁纸（壁纸在桌面图标层之下，收不到常规鼠标消息） | Windows 桌面嵌入 + 全局钩子实现分析 |
| `msaa / preset / postprocessing / resolution` 是**scene 壁纸**的画质项，对 web 壁纸无效 | WE 设置项语义 |

这最后一条顺带解释了："在 WE 里把画质调低没感觉"——因为那些旋钮管不到 CEF。

---

## 4. 成本模型：为什么是"50~100% 跳动"而不是稳定值

```
任务管理器 CPU ≈ (每帧成本 × 实际帧率) + 其他进程
```

- **基线**：11 层透明 + 6 骨架 ⇒ 60fps 下约 15~25%（与"只开 WE 时 20% 以内"吻合）；
- **交互期**：拖尾发射 + 4 次全量上传 + 12 个监听 + 可能的问候动作 ⇒ 每帧成本上浮，出现**尖峰**；
- **叠加期**：VS Code（Electron，自带 GPU/CEF 进程）+ WorkBuddy（CEF）进来抢核心与 GPU 进程，
  壁纸**不让路** ⇒ 总占用被推到 90~100%，且随两边负载波动 ⇒ 表现为"跳"；
- **GC**：拖尾每帧 480 次小数组分配，会让 V8 周期性做 minor GC ⇒ 尖峰更碎。

---

## 5. 建议（按性价比，标注"改设置 / 改代码"）

### P0 —— 现在就能做，不改一行代码

1. **WE 设置 → 性能 → "其他应用程序获得焦点时" = 暂停**
   这是唯一能覆盖"窗口没最大化但你在用它"的规则。当前是"继续运行"。
   （代价：点开任何窗口壁纸就停；回到桌面立刻恢复。对桌面壁纸来说正是想要的行为。）
2. **给 `Code.exe` / WorkBuddy 建应用规则**（性能 → 应用程序规则 → `Is running` → `Pause` 或 `Stop`）
   比 focus 规则更精准，不会影响其他小工具。
3. 确认 `FPS limit` 保持 **30**（当前已是 30；但见 P0-4，它现在不生效）。
4. **部署 10-19 的 bundle，并同步给 S8 的 config 加 `"maxFps": 30`**
   （只换 bundle 不加键 = 仍然 `maxFps=0`，白干。）

### P1 —— 代码，1~2 处小改，收益最大

5. **实现 `applyGeneralProperties`**（`src/wePauseSignal.ts` + `src/settingsStore.ts`）
   把 WE 的 `fps` 存成运行时值，渲染循环取 `min(configs.maxFps || ∞, weFps || ∞)`。
   这是"让 WE 的性能设置真正生效"的唯一正解，也让工坊用户自己就能调。
6. **空闲降帧**（`src/index.ts` 的 `render`）
   维护 `lastInteractionAt`（mousemove / mousedown / 事件播放时刷新）；
   超过 N 秒（建议 8~15s）无交互 ⇒ 上限降到 **20~24fps**；有交互立刻回 60。
   这是"壁纸在后台不该全速"的通用解，不依赖 WE 的暂停规则。
7. **`PointerTrail.update` 加空转短路**（`pointerTrail.ts:322`）
   `if (!particles.length && step === 0) return;` —— 静置时彻底不碰 buffer；
   `buildGeometry` 只在 `dirty` 时跑；`worldPerPx` 结果缓存（视口不变就不读 `clientHeight`）。

### P2 —— 清理项

8. `initScene.ts:496` 删除 `mousemove` 里的 `preventDefault()`；
9. 把 6 个骨架各自的 mousedown/mouseup 收敛成一个共享分发器（`SpineAnimator` 里注册、`dispose` 注销），
   顺带修"mouseup 丢失导致按下态残留"；
10. `probe` 的 rAF tick 跟随 `maxFps`（或改成 10Hz），发布态 `probe:{enabled:false}`；
11. `ParticleAnimator.buildGeometry` 同样加 dirty 判定（静置时粒子仍在跑的场景除外）。

---

## 6. 诚实标注的不确定项

- **未实测**：本报告全部结论来自源码 + 本机配置 + 官方文档，没有在 WE 里跑过任何 profile。
  因此"每帧成本 ≈ 15~25%"是**由结构推算的量级**，不是测量值。
- **WE 是否在你操作其他窗口时仍转发 mousemove**：只能确认 WE 用全局鼠标钩子转发，
  但**是否对"被窗口覆盖的区域"做过滤，官方没有文档**。如果它不过滤，
  那么拖尾在你不看壁纸时也在发射——这也是建议 P1-6（按"最近交互时间"降帧）
  而不是"按鼠标是否在壁纸上"降帧的原因：后者拿不到可靠判据。
- **CEF 的 rAF 上限**：通常跟随显示器刷新率。若你是 120/144Hz 屏，
  旧包就是 120~144fps 在跑，这会把 §4 的基线再放大一倍。建议顺手确认屏幕刷新率。
  （另：上一轮按 CEF OSR 官方文档核对过"宿主投递输入事件 / OSR 不走加速合成"，
  本轮**未重复取证**，沿用该结论。）
- **GPU 侧**：`uihardwareacceleration / videohardwareacceleration` 都是 true，
  `cefcommandline` 只有 `--remote-debugging-port=9222`（没有 `--disable-gpu`），
  所以 CEF 走硬件加速。但 GPU 进程与 VS Code 的 GPU 进程争用会表现为 CPU 侧等待，
  这部分无法从静态代码判断，需要真机看 `weblog.txt` 或 GPU 占用。
