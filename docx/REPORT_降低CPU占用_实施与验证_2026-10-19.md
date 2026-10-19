# 降低 WE 壁纸 CPU 占用 · 实施方案与验证

- 日期：2026-10-19
- 前置：`REPORT_WE_CPU占用归因_2026-10-19.md`（归因）
- 状态：**代码已改+ 验证通过，暂未部署到 WE**（等用户看效果后决定）

---

## 1. 纠错：第一轮报告里 dpr 的结论是错的

第一轮报告写「dpr:auto → 固定 1.0 提速 2.6×」。**那是噪声，不是信号。**

根因：所有旧脚本的 `Emulation.setDeviceMetricsOverride` 都写了 `deviceScaleFactor: 1`
⇒ `window.devicePixelRatio === 1` ⇒ `resolveDpr('auto')` 返回 **1.0**
⇒ 「auto」与「固定 1.0」渲染**完全相同的缓冲**，那 2.6× 差异无从存在。

在 `deviceScaleFactor=2`（2K 屏 + Windows 缩放，即 WE 真机常态）重测后，dpr 才显出真实收益。

---

## 2. 三个指标必须分清（本轮最大的方法论收获）

| 指标 | 定义 | 回答什么问题 |踩过的坑 |
|---|---|---|---|
| rAF 帧间隔 | 相邻回调的时间差 | "画面卡不卡" | ❌ 受调度抖动污染，出现「限 30fps 反而慢 37%」 |
| 主线程忙碌率 | `TaskDuration` / 墙钟 | "任务管理器里的 CPU %" | ❌ **= 每帧成本 × 帧数**，关 MSAA 后浏览器补帧 ⇒ 不降反升 96% |
| **每帧成本** | `TaskDuration` / 帧数 | "这个改动省不省" | ✅ 需**锁定同一帧率**才可比 |

**忙碌率 = 每帧成本 × 帧数**。单帧变便宜时浏览器会自动多跑帧把时间填掉，
所以"降本"不等于"降 CPU"——**只有主动限帧能真正压住用户看到的百分比**。

---

## 3. 改了什么

### 3.1 `antialias` 可配置，缺省 `false`
`src/initScene.ts` —— 原为写死 `new THREE.WebGLRenderer({ antialias: true })`。

```ts
renderer = new THREE.WebGLRenderer({
  antialias: configs.antialias ?? false,
});
```

MSAA 让每个片元按 **4× 采样**跑，而这画面是12 层全屏半透明叠加，填充率本就吃紧。
锁 30fps 实测每帧成本 3.38ms → 2.64ms（**−22%**，3 次重复区间完全分离）。

### 3.2 新增 `maxFps` 帧率上限
`src/index.ts` 的 `render()` —— 此前是**裸 rAF、零节流**。

```ts
const maxFps = configs.maxFps ?? 0;
const minFrameGap = maxFps > 0 ? 1000 / maxFps : 0;

const render = () => {
  const nowMs = Date.now();
  if (minFrameGap > 0) {
    const elapsedMs = nowMs - lastRenderMs;
    if (elapsedMs < minFrameGap) {
      requestAnimationFrame(render);   // ★ 跳过整个回调 = 真节流
      return;
    }
  }
  lastRenderMs = nowMs;
  ...
};
```

★ **关键设计**：`lastRenderMs` 只在**真正渲染时**更新，而 `lastFrameTime` 记的是动画推进时刻。
被跳过的帧**不更新** `lastRenderMs` ⇒ 省下的时间累加进下一帧 delta
⇒ 动画按真实经过的时间推进，**不会因为限帧而变慢**。

实测：不限帧忙碌率 87% → 限 30fps 后 22%；动画推进同步率 **0.996**（没被拖慢）。

### 3.3 类型定义
`src/config.type.ts` 新增 `antialias?: boolean` 与 `maxFps?: number`，都写了完整注释与实测依据。

### 3.4 配置值
`public/assets/config.json`：

```json
"dpr": "auto",
"antialias": false,
"maxFps": 60,
```

⚠️ `maxFps` 最终取 **60**（用户选择：保持流畅）。实测 30 能多省 CPU，60 接近不限帧。
`dpr` 保持 `auto` —— 用户未要求改清晰度。

---

## 4. 验证

### 4.1 限帧不变量回归（`_regress/40_`）—— 7/7 通过

| 断言 | 实测 |
|---|---|
| 不限帧时 fps > 45（证明是 opt-in） | 143.9 |
| `maxFps=20` 落在 [14,26] | 18.5 |
| `maxFps=20` 远低于不限帧 | 18.5 < 143.9/2 |
| `maxFps=30` 高于 20 且≤ 38 | 27.5 |
| **限帧后动画推进同步率 > 0.8** | **0.992** |
| 限帧前后同步率接近 | 0.94 vs 0.99 |

★ 验证口径修正过一次：页面内 rAF 计数统计的是**回调次数**，而限帧时回调照样会被调用
⇒ 那样量出来永远 ~165fps，会把"限帧没生效"读成"生效了但帧率高"。
改为**拦 WebGL `clear` 计数**（three 每帧开头必调一次）才是真实渲染帧数。

### 4.2 端到端验收（`_regress/41_`，DSF=2）

| 配置 | 主线程忙碌率 | 缓冲 | MSAA |
|---|---|---|---|
| 现状（MSAA + dpr2） | 56% | 3400×1500 | 开 |
| 仅关 MSAA（dpr2） | 68.7% ⚠️ | 3400×1500 | 关 |
| **仅降 dpr**（dpr1 + MSAA） | **21.8%**（↓61%） | 1700×750 | 开 |
| **关 MSAA + 降 dpr** | **18.5%**（↓67%） | 1700×750 | 关 |

⚠️ "仅关 MSAA"那组 68.7% 比现状还高，正是第 2 节说的**补帧效应**——不是 MSAA 无效，
而是它在 dpr=2（510 万像素）下省下的时间被浏览器用更多帧填掉了。
**dpr 才是这台机器上的主杠杆**（1/4 像素量），MSAA 的收益要降 dpr 后才显现。

### 4.3 既有回归未破坏
- `73_回归_渲染侧` 34/34
- `74_回归_UV与噪声` 65/65
- `86_回归_调度与限流` 29/29
- `tsc --noEmit`：src/ 无错误（仅 submodule 的已知 `MeshBatcher` 报错）

---

## 5. 用户怎么看效果

`_regress/50_预览_AB对比.js` 起两个端口（Ctrl-C 结束）：

- **http://127.0.0.1:8931** = 现状（无 maxFps、MSAA 开）
- **http://127.0.0.1:8932** = 优化后（maxFps=60、MSAA 关）

两边都关了探针 HUD，免得调试字干扰观感。

---

## 6. 待决与遗留

- ⬜ **未部署到 WE**（用户要先看效果）。部署走 `_work_工坊更新/10_部署bundle到WE工程.py`；
  ⚠️ 记忆红线：改完 bundle **必须**部署，否则 WE 里看不到效果；
  且 S8 不在 `10_` 默认目标里，需按记忆里的规则处理。
- ⬜ **真机复测**：全部数据来自 headless + SwiftShader **软渲染**，
  等于放大了填充率成本、压低了 GPU 加速收益 ⇒ 真机上收益会小一些，但方向不反。
  建议用 `we-wallpaper-cef-diag` 流程在 WE 里实测一次。
- ⬜ `maxFps` 是否要**做成 WE 属性面板可调**（目前只走 config）。
  按记忆里的口径，WE 属性是 5 项固定表，新增键要慎重。
- ⬜ 「12 层静态贴图层」的方向性建议（合并/跳过重绘）本轮**未做**：
  z 排序查过了，12 层**不连续**（被角色和粒子夹成三段），不能简单合成一张底图。

---

## 附：脚本清单

| 脚本 | 作用 |
|---|---|
| `_regress/30_测_每帧开销.js` | 帧节奏 + CPU self-time 排名 |
| `_regress/31_消融_填充率归因.js` | config 变体消融（**首轮数据有噪声，结论已被后续修正**） |
| `_regress/32_复测_噪声与稳健性.js` | 重复 3 次看区间是否分离 |
| `_regress/33_定点_探针与MSAA.js` | 定点复测 MSAA（注入拦 `getContext`） |
| `_regress/34_方案对比.js` | ⚠️ 口径错误（帧间隔当代理），已弃用 |
| `_regress/35_方案对比_CPU时间口径.js` | ⚠️ WMIC/PowerShell 被沙箱拦，未跑通 |
| `_regress/36_方案对比_TaskDuration.js` | 主线程忙碌率（但被补帧效应污染） |
| `_regress/37_单帧成本归因.js` | ★ 每帧成本（锁帧，可横向比） |
| `_regress/38_修正_dpr真实收益.js` | ★ DSF=2 下重测 dpr，纠了第一轮的错误 |
| `_regress/40_回归_限帧不变量.js` | ★ 限帧三条不变量，7/7 |
| `_regress/41_验收_端到端CPU下降.js` | ★ DSF=2 端到端验收 |
| `_regress/50_预览_AB对比.js` | ★ A/B 双端口预览 |