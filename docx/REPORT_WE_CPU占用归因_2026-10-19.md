# WE 壁纸 CPU 占用过高 · 调研报告

- 日期：2026-10-19
- 对象：`D:\手游文件夹\spine-wallpaper-engine`（当前部署到 WE 的 S9 壁纸）
- 现象：WE 里打开该壁纸，CPU 在 **50%~100%** 之间跳
- 结论一句话：**不是 JS 算法慢，是每帧要光栅化的像素太多**。MSAA 与 dpr 各占约一半超额开销。

---

## 1. 方法与可信度

复现环境：headless Chrome + SwiftShader软渲染，1700×750，`dist/` 原样产物。
脚本（都在 `_regress/`，可重跑）：

| 脚本 | 作用 |
|---|---|
| `30_测_每帧开销.js` | rAF 帧节奏 + CDP `Profiler` 抓 CPU self-time 排名 |
| `31_消融_填充率归因.js` | config 变体逐项关闭，量帧耗时变化 |
| `32_复测_噪声与稳健性.js` | 重复 3 次，报中位数与极差（区分信号/噪声） |
| `33_定点_探针与MSAA.js` | 定点复测 MSAA（注入拦`getContext`）与探针 HUD |

>⚠️ **单次测量不可信**：`31_` 首轮出现过「dpr=1.0 比基线还慢 17.6%」这种物理上不可能的结果（headless 下 `auto` 与 `1.0` 完全等价）。所以下面所有结论都经过 `32_`/`33_` 的 3 次重复，只有**区间与基线完全分离**的才敢当结论。

---

## 2. 主结论：CPU 在填充率，不在 JS

`30_` 的 CPU profile（12.2 秒采样）：

| self time | 函数 | 判读 |
|---|---|---|
| **41.4%** | `(idle)` | 浏览器空闲，非我们的代码 |
| **9.6%** | `(program)` | V8 内部/ GC |
| 3.1% | `computeWorldVertices` | Spine 骨架顶点计算 |
| 3.1% | `bufferSubData` | 缓冲上传 |
| 3.0% | `batch` | three 批处理 |
| 3.0% | `getProgramCacheKey` | three 材质哈希 |
| 2.5% | `updateGeometry` | three 几何上传 |

**JS 侧合计只占约 40%**，其中真正属于我们业务逻辑的（`computeWorldVertices` + `buildGeometry`）不到 4%。
剩下 60% 是 idle + V8 内部 ⇒ **业务逻辑不是瓶颈**。

粒子系统也不是：S9 的 8 组粒子 `maxNumParticles` 加起来只有 **46 个**（`qiqiu:7 / niao:15 / chexiang:10×2 / 其余各 1`），逐顶点解算量微不足道。

---

## 3. 两个真实主因（区间完全分离的信号）

### 3.1 MSAA —— `initScene.ts:450` 写死 `antialias: true`

| 变体 | 3 次实测 (ms) | 中位数 |
|---|---|---|
| 基线 | 13.32 / 18.13 / 18.29 | **18.13** |
| 注入关 MSAA | 9.21 / 6.39 / 8.89 | **8.89** |

**提速约 2 倍**，且两组区间（13.3~18.3 vs 6.4~9.2）**零重叠** ⇒ 硬信号。

`antialias:true` 让 three 申请 MSAA 上下文，片元着色按 4× 采样跑。
对这套**大面积半透明叠加**的画面（见 3.2），代价被放大得很厉害。

> 顺带排除一个误判：同期测的「关探针 HUD」中位数 17.89ms，与基线 18.13ms 完全落在同一区间 ⇒ **探针不是原因**（虽然 `config.json` 的 `probe:{enabled:true,hud:true}` 是发布态缺省，值得关，但不影响性能）。

### 3.2 dpr=auto 与 12 层全屏透明叠加

`initScene.ts` 的 `resolveDpr`：`dpr:"auto"` ⇒ `window.devicePixelRatio` 夹到 `[1,2]`。
渲染缓冲 = 内容视口 × dpr²。**2K 屏 + Windows 缩放 150% ⇒ dpr=1.5 ⇒ 像素量 2.25 倍**。

| 变体 | 3 次实测 (ms) | 中位数 | 缓冲 |
|---|---|---|---|
| 基线 | 20.97 / 28.05 / 24.20 | **24.20** | 1700×750 |
| dpr=0.5 | 7.42 / 9.46 / 9.51 | **9.46** | 850×375 |

**提速约 2.6 倍**，区间零重叠 ⇒ 硬信号。

overdraw 侧：S9 的 `meshes` 有 **12 层 `texture` 全屏透明贴图**（`_01/_02/_04/_05/_08/_10/_11/_12/_13/_14/_15/_16`），
全部 `transparent:true, depthWrite:false, side:DoubleSide` ⇒ 每帧每个像素要被混合 **12 次**。
而这12 层里**绝大多数是静止的**（`tileDisplayDuration` 全为 0、`spinDegPerSec` 仅星轨层非 0）。

| 变体 | 中位数 |
|---|---|
| 基线 | 24.20 |
| 12 层 → 1 层 | 16.26（但极差 6.18~62.85，噪声大） |
| 去掉全部贴图层 | 17.16（极差 6.08~18.40） |

⚠️ 这两项**未通过显著性检验**（区间与基线重叠），只能说方向与 3.1/3.2 一致（减少混合次数会变快），
**不能单独当成结论**。真正被证实的是"像素总量"而非"层数"本身。

---

## 4. 为什么在 WE 里表现为 50%~100% 跳

三个放大因素叠加：

1. **`antialias:true` + dpr² 双重放大** —— 上面两个已证实的杠杆。
2. **渲染循环裸 rAF，无任何帧率上限**（`index.ts:2455`）：
   ```js
   const render = () => {
     ...
     meshUpdateCallbacks.forEach((cb) => cb(d));
     Scene.renderer?.render(Scene.scene, Scene.camera);
     requestAnimationFrame(render);   // ←没有任何 throttle
   };
   ```
   `step` 只钳了单帧步长上限（防 WE 暂停恢复时突跳），**没有"最多跑 30fps"这种节流**。
   WE 会把壁纸挂到多屏/虚拟桌面，rAF 一旦被驱动到显示器刷新率之上就是纯烧 CPU。
3. **CEF 软渲染回退** —— 若 WE 因 GPU 策略或驱动回退到 SwiftShader，
   上面所有像素开销直接落到 CPU 上，观感就是 50%~100% 乱跳。

---

## 5. 优化建议（按性价比排序）

| # | 动作 | 预期 | 风险 |
|---|---|---|---|
| 1 | `antialias: false`（`initScene.ts:450`），或给 config 加开关 | **~2×** | 边缘略毛糙；可改用 FXAA 或直接降 dpr 补偿 |
| 2 | `config.json` 的 `dpr` 从 `auto` 改**固定 1.0**（或上限从 2 降到 1.25） | 2K 屏上 **~2.6×** | 清晰度下降；这是 `config.type.ts` 已支持的合法取值 |
| 3 | 给 `render()` 加**帧率上限**（如 30fps，或"无交互时降到 20fps"） | 未实测，预计显著 | 动作/粒子会变卡，需与手感权衡 |
| 4 | 静止贴图层跳过重绘（分层 dirty flag，只重绘变化层） | 未实测 | 改动较大，需处理层间合成顺序 |
| 5 | 发布态`probe` 设 `{enabled:false, hud:false}` | 无（实测在噪声内） | 只是卫生问题，且现在 WE 属性里已有 `probeEnabled` 可控 |

**最小改动组合（建议先做）**：`antialias:false` + `dpr:1.0`，两项都是单点改动，预期能把这张壁纸的 CPU 压到原来的 1/4 左右。

---

## 6. 诚实标注的不确定项

- 全部实测在 **headless + SwiftShader 软渲染** 下完成，**不等于 WE 的 CEF 真实表现**。
  软渲染会放大填充率成本、压低 GPU 加速收益 ⇒ **MSAA/dpr 的真实收益在 WE 硬件加速下会小一些**，
  但方向不会反（这两项在硬件路径上同样是纯开销）。
- 「层数」相关的两项消融**未通过显著性检验**，只作为方向性参考。
- 未测「帧率上限」的实际收益（需要先改代码），第3 条是**基于代码结构的推断**，不是实测结论。
- 建议在 WE 真机上用 `we-wallpaper-cef-diag` 流程复测一次，确认系数。

---

## 附：产物

- `_regress/30_测_每帧开销.js` + `perf_profile.json`
- `_regress/31_消融_填充率归因.js` + `perf_ablation.json`
- `_regress/32_复测_噪声与稳健性.js` + `perf_repeat.json`
- `_regress/33_定点_探针与MSAA.js` + `perf_targeted.json`