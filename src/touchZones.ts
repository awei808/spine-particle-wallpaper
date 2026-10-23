/**
 * @license
 * Spine Wallpaper Engine. This is a Spine animation player for wallpaper engine.
 * Copyright (C) 2023 Spicy Wolf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 触摸热区的**数据层**：归一、校验、命中判定与**重叠裁决**。
 *
 * ## 为什么从 `touch.ts` 里分出来（2026-10-17）
 *
 * `touch.ts` 是"动作播放控制器"（轨道、混出、闸门），热区是**纯几何 + 纯规则**，
 * 两者混在一起时，`hitTestZones` 只能拿到"骨架就绪之后"的上下文才能测
 * （`createTouchController` 在 `state` 为空时直接返回空实现）。
 * 而热区现在要承担两个新职责：
 *
 *   1. **自定义**：热区表要能被独立归一/校验，将来 `when.zone`（事件条件）要靠 id 引用它；
 *   2. **重叠裁决**：解包侧**真实存在**多热区且互相重叠的皮肤 —— 见皮肤热区普查总表
 *      （`_work_全皮肤热区扫描/全皮肤触摸热区总表.csv`）：118 个皮肤里 106 个只有 1 个区，
 *      **11 个有 2~4 个区且彼此相交**（如 `tsukinomiyo_s3` 的 `base` 把 `touch2` /
 *      `greet` 整块包住）。
 *
 * 判据必须是**纯函数**（`zones` + 坐标进、热区出），才能脱离 DOM / spine 单测。
 *
 * ## 几何口径
 *
 * 归一化视口坐标 **0~1、原点左上**，与 `clientX/clientY` 同向。
 * 因此与分辨率、窗口比例无关，也能直接喂给 DOM 覆盖层的百分比定位。
 *
 * ⚠️ **允许越界**：解包数据里真实存在远超视口的区（本工程 S9 的 `hit1` 是
 * `u[-2.609, 1.590] v[-4.197, 3.089]`），它们的作用是"整屏兜底"。
 * 越界**不裁剪**（判定用原值），只有覆盖层画图时才裁剪到视口
 * （见 `touchZoneOverlay.ts`）。
 *
 * ## ★ 重叠裁决：`resolve`（2026-10-17 用户拍板）
 *
 * 旧口径是"按数组顺序**先命中先返回**" ⇒ 重叠处谁吃掉点击取决于数组顺序，
 * 既不可预测也不可调。新规则（**恒生效，无开关**）：
 *
 * | 序 | 判据 | 方向 | 理由 |
 * |---|---|---|---|
 * | ① | `enabled !== false` | 过滤 | 单区开关（关掉的区不参与判定，调试框仍画出来并标「关」） |
 * | ② | `priority` | **降序**（缺省 0） | 显式声明 > 隐式推断；用户想让"手"压过"身体"就给 priority |
 * | ③ | **面积** | **升序** | 小的区更具体 —— `touch2`（局部）压过 `base`（整屏兜底）正是解包数据的本意 |
 * | ④ | 数组下标 | 升序 | 兜底，保证**完全确定**（不会出现"两条一样、随机取一条"） |
 *
 * ⇒ 只有一条命中时结果与旧口径**逐字相同**；不重叠的多区也逐字相同。
 *   **仅"多区重叠"这一格的行为变了**（用户明确接受，见 `docx/PLAN_触摸热区*`）。
 *
 * ## ★ 对齐基准：`fit` / `aspect`（2026-10-22 用户拍板）
 *
 * 背景：`fitAspect`（「画面调整」页）切换"按画布宽 / 按画布高"时，**取景会整体缩放**
 * （见 `initScene.ts` 的 `calc`），角色、背景、粒子都跟着变 —— 但热区此前只有
 * `u0..v1` 这一种写法，它是"视口分数"，与取景无关 ⇒ **热区钉在屏幕上不动，人却动了**。
 * 表现为"换了对齐基准后，点手要点到空白处"。
 *
 * 现在 `u0..v1` 也有**基准**了：`zones[].fit`（缺省 **`'width'`**，即按画布宽对齐）
 * + `zones[].aspect`（**量这些数时的视口比例**，缺省 = 设计画幅比例 `Wd/Hd`）。
 * 引擎按"**声明基准的可见框**"把分数还原成**设计画布像素**，再按本帧真实取景投影
 * ⇒ 同一组数字在任何视口比例 / 任何基准下都落在**同一块身体**上。
 *
 * 两种基准的可见框（单位 = 设计画布像素，锚点：**水平居中 + 底边**）：
 *
 * ```
 * fit='width'  ⇒  w = Wd            h = Wd / A        （可见宽恒 = 设计宽）
 * fit='height' ⇒  w = Hd · A        h = Hd            （可见高恒 = 设计高）
 * ```
 *
 * 分数 ⇄ 设计画布像素（`A` = 该帧视口比例，`Wd/Hd` = `config.width/height`）：
 *
 * ```
 * x = Wd/2 + (u − 0.5) · w        u = 0.5 + (x − Wd/2) / w
 * y = Hd − (1 − v) · h            v = 1 − (Hd − y) / h
 * ```
 *
 * ★ **两种基准之间是一步均匀缩放**（同一锚点）：
 * `k = w_from / w_to = h_from / h_to`
 * `u_to = 0.5 + (u_from − 0.5)·k`、`v_to = 1 − (1 − v_from)·k`
 * 其中 `width → height` 时 `k = (Wd/Hd) / A`，反向取倒数。
 * ⇒ 换算代码只有 `alignedFrameOf` / `fitRectToDesign` / `designRectToFit` /
 *   `convertFitRect` 四个纯函数（末者就是"高 ⇄ 宽"的直接换算）。
 *
 * ⚠️ **在设计比例下两种基准完全重合**（`w = Wd`、`h = Hd` 同时成立）⇒ 那时
 *   `fit` 取什么值都一样，`u/v` 就等价于"设计画布分数"（= `design` 除以画布尺寸）。
 *   这也是旧 `u/v` 数据（在 1700×750 上量的）默认仍然对得上的原因：缺省
 *   `aspect = Wd/Hd` ⇒ 旧数字被解释成设计画布分数 ⇒ **从此跟着取景缩放**，
 *   而不是继续钉在视口上。
 *
 * ## 不做的事
 *
 * - **不做圆形/多边形**：解包侧只有矩形（`SoulSpineHitArea` 是 RectTransform），
 *   没有第二种形状 ⇒ 不提前造形状抽象。
 * - **不做"热区 → 动作/念白"绑定**：命中哪个区只决定"这次点击归属谁"，
 *   "播什么"由自定义事件的 `when.ctx.zone` 条件表达（见 `docx/PLAN_自定义事件系统_2026-10-18.md` §2.2）。
 *   两套绑定口径并存必然打架。
 */

import { TouchZoneConfig } from './config.type';

/**
 * 一个触摸热区。
 *
 * 权威定义在 `config.type.ts`（`TouchZoneConfig`）—— 因为它的**唯一来源是 config.json**，
 * 这里只是同一个类型的别名，避免两处定义漂移。
 *
 * ⚠️ 旧代码从 `./touch` import 这个别名，`touch.ts` 有 re-export ⇒ 两条路径都可用。
 */
export type TouchZone = TouchZoneConfig & {
  /**
   * 归一后的**视口归一化**矩形 —— 恒存在。
   *
   * `config.type.ts` 里这四个字段是可选的（因为可以用 `design` 代替），
   * 但**出了 `normalizeZones` 之后一定有值**（`design` 已投影完毕）⇒ 归一表用这个类型，
   * 消费者不必到处判 undefined。
   */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /**
   * 归一这条区时用的**几何来源**（2026-10-22 加的诊断字段）：
   * `'design'` = 按设计画布像素投影；`'uv'` = 按 `fit`/`aspect` 声明的框还原后再投影。
   *
   * 为什么记下来：`u/v` 区在归一后与 `design` 区**长得一样**（都是视口分数），
   * 事后无法从结果反推"作者当初怎么写的"，而排查"点不中"恰恰需要这个信息。
   */
  geom?: 'design' | 'uv';
};

/** 面积比较的容差：两区面积差小于它就当作"一样大"，落到数组顺序判据 */
const AREA_EPS = 1e-9;

/**
 * ## 设计画幅坐标 → 视口归一化（2026-10-21）
 *
 * 为什么需要：热区默认写的是**视口归一化坐标**（`u0/v0/u1/v1`），它只对"量的时候那个
 * 宽高比"成立。而 `fitAspect: 'width'` 下可见**宽**恒定、可见**高**随视口比例变
 * （`visibleH = 设计可见宽 / aspect`）⇒ 同一块矩形在 16:9 与 21:9 上会整体上下漂，
 * 比例差得越多漂得越狠（1700×750 上 v=0.14 的手，到 1920×1080 变 v≈0.33）。
 *
 * ⇒ 作者按**设计画幅像素**写 `zones[].design`（原点左上，分母 = `config.width × config.height`，
 *   与 `subtitle.charAnchor` 同一套分母），引擎在装配时按**本帧真实取景**投影一次。
 *
 * 换算（`camY = halfH + base.bottom` ⇒ 底边锚点是同一条世界线，可直接按半高比缩放）：
 *
 * ```
 * u_now = 0.5 + (u_d − 0.5) · (halfHD · aspectD) / (halfH · aspect)
 * v_now = 1 − (1 − v_d) · halfHD / halfH          ← 以底边为锚，向下为正
 * ```
 *
 * 设计比例下 `halfH === halfHD && aspect === aspectD` ⇒ 投影是**恒等变换**（自检点）。
 * `fitAspect: 'height'` 下 `halfHD === halfH` ⇒ v 不动、只有 u 按比例缩，同样适用。
 */
export type DesignRect = { x: number; y: number; w: number; h: number };

/** 投影所需的取景量（来自 `initScene` 的 `FitResult`，不在热区模块里重算） */
export type DesignFit = {
  /** 本帧可见半高（世界单位） */
  halfH: number;
  /** 设计态可见半高（世界单位） */
  halfHD: number;
  /** 本帧视口比例 */
  aspect: number;
  /** 设计态比例 = `config.width / config.height` */
  aspectD: number;
  /** 设计画幅宽（`config.width`）—— `design.x/w` 的分母 */
  designW: number;
  /** 设计画幅高（`config.height`）—— `design.y/h` 的分母 */
  designH: number;
};

/** 把一块设计画幅矩形投影成当前视口的归一化矩形（结果端点已保证 `u0<=u1`、`v0<=v1`） */
export const designRectToViewport = (
  r: DesignRect,
  f: DesignFit
): { u0: number; v0: number; u1: number; v1: number } => {
  /** 设计画幅 → 设计态归一化 */
  const uA = r.x / f.designW;
  const uB = (r.x + r.w) / f.designW;
  const vA = r.y / f.designH;
  const vB = (r.y + r.h) / f.designH;
  /** 两轴各自的可见范围比 */
  const kx = (f.halfHD * f.aspectD) / (f.halfH * f.aspect);
  const ky = f.halfHD / f.halfH;
  const u0 = 0.5 + (uA - 0.5) * kx;
  const u1 = 0.5 + (uB - 0.5) * kx;
  /** v 以**底边**为锚：距底份额按半高比缩放 */
  const v0 = 1 - (1 - vA) * ky;
  const v1 = 1 - (1 - vB) * ky;
  return {
    u0: Math.min(u0, u1),
    u1: Math.max(u0, u1),
    v0: Math.min(v0, v1),
    v1: Math.max(v0, v1),
  };
};

/* ── 对齐基准：宽 ⇄ 高 的换算（2026-10-22） ────────────────── */

/**
 * 对齐基准，**与 `config.fitAspect` 同字符串**（便于直接比较/透传）。
 *
 * - `'width'`（缺省）= 按画布宽对齐：可见**宽**恒 = 设计画布宽；
 * - `'height'` = 按画布高对齐：可见**高**恒 = 设计画布高（同游戏内取景）。
 */
export type ZoneFit = 'width' | 'height';

/** 某基准下"可见框"的尺寸（单位 = **设计画布像素**，锚点见文件头 §对齐基准） */
export type AlignedFrame = { w: number; h: number };

/**
 * 算出某基准在比例 `aspect` 下的**可见框**尺寸（设计画布像素）。
 *
 * `aspect` 非正 / 非有限 ⇒ 该基准退化（`width` 时高为 `Infinity`、`height` 时宽为 0）
 * ⇒ 调用方必须先保证它有效（`normalizeZones` 里由 `resolveSrcAspect` 兜住）。
 */
export const alignedFrameOf = (
  fit: ZoneFit,
  designW: number,
  designH: number,
  aspect: number
): AlignedFrame =>
  fit === 'height'
    ? { w: designH * aspect, h: designH }
    : { w: designW, h: designW / aspect };

/**
 * **归一化矩形（声明基准下）→ 设计画布像素矩形**。
 *
 * 这是 `designRectToViewport` 的**逆向第一步**：先把"分数"还原成"画布上的绝对位置"，
 * 再交给按本帧取景的投影。结果端点已排序（`w/h >= 0`）。
 */
export const fitRectToDesign = (
  r: { u0: number; v0: number; u1: number; v1: number },
  fit: ZoneFit,
  designW: number,
  designH: number,
  aspect: number
): DesignRect => {
  const fr = alignedFrameOf(fit, designW, designH, aspect);
  const xa = designW / 2 + (r.u0 - 0.5) * fr.w;
  const xb = designW / 2 + (r.u1 - 0.5) * fr.w;
  const ya = designH - (1 - r.v0) * fr.h;
  const yb = designH - (1 - r.v1) * fr.h;
  return {
    x: Math.min(xa, xb),
    y: Math.min(ya, yb),
    w: Math.abs(xb - xa),
    h: Math.abs(yb - ya),
  };
};

/**
 * **设计画布像素矩形 → 归一化矩形（指定基准下）**。
 *
 * 给"按设计画布量好、想写成 `u/v`（某个对齐基准）"的场景 —— 也就是把 `design`
 * 反向写成两种分数格式。结果端点已排序。
 */
export const designRectToFit = (
  r: DesignRect,
  fit: ZoneFit,
  designW: number,
  designH: number,
  aspect: number
): { u0: number; v0: number; u1: number; v1: number } => {
  const fr = alignedFrameOf(fit, designW, designH, aspect);
  const uA = 0.5 + (r.x - designW / 2) / fr.w;
  const uB = 0.5 + (r.x + r.w - designW / 2) / fr.w;
  const vA = 1 - (designH - r.y) / fr.h;
  const vB = 1 - (designH - (r.y + r.h)) / fr.h;
  return {
    u0: Math.min(uA, uB),
    u1: Math.max(uA, uB),
    v0: Math.min(vA, vB),
    v1: Math.max(vA, vB),
  };
};

/**
 * ★ **高对齐 ⇄ 宽对齐 的直接换算**（用户 2026-10-22 点名要的那段代码）。
 *
 * 两种可见框是**同一锚点的均匀缩放**（水平居中、底边对齐）⇒ 换算是**一个标量**
 * `k = w_from / w_to`，绕锚点 `(0.5, 1)` 缩放：
 *
 * ```
 * u_to = 0.5 + (u_from − 0.5)·k
 * v_to = 1 − (1 − v_from)·k
 * ```
 *
 * `width → height` 时 `k = (Wd/Hd)/A`（16:9、1700×750 下 ≈ 1.275 ⇒ 框**放大** 27.5%，
 * 因为按高对齐把设计画布放大了），`height → width` 取倒数。
 *
 * `from === to` ⇒ 原样返回（只做端点排序，不引入浮点误差）。
 */
export const convertFitRect = (
  r: { u0: number; v0: number; u1: number; v1: number },
  from: ZoneFit,
  to: ZoneFit,
  designW: number,
  designH: number,
  aspect: number
): { u0: number; v0: number; u1: number; v1: number } => {
  const ua = Math.min(r.u0, r.u1);
  const ub = Math.max(r.u0, r.u1);
  const va = Math.min(r.v0, r.v1);
  const vb = Math.max(r.v0, r.v1);
  if (from === to) {
    return { u0: ua, v0: va, u1: ub, v1: vb };
  }
  const a = alignedFrameOf(from, designW, designH, aspect);
  const b = alignedFrameOf(to, designW, designH, aspect);
  /**
   * 两轴的比**相等**（`a.w/b.w === a.h/b.h`，因为两种框互为等比缩放）⇒ 一个标量就够。
   * 这里取宽度比：`width` 基准的 `w ≡ designW` 是**与比例无关的常量**，数值上最稳。
   */
  const k = a.w / b.w;
  const f = (u: number) => 0.5 + (u - 0.5) * k;
  const g = (v: number) => 1 - (1 - v) * k;
  const p = [f(ua), f(ub)];
  const q = [g(va), g(vb)];
  return {
    u0: Math.min(p[0], p[1]),
    u1: Math.max(p[0], p[1]),
    v0: Math.min(q[0], q[1]),
    v1: Math.max(q[0], q[1]),
  };
};

/**
 * **分数（声明基准 @ 声明比例）→ 本帧视口归一化**（`normalizeZones` 的 u/v 分支用这条）。
 *
 * 两步走：`fitRectToDesign`（还原画布位置）→ `designRectToViewport`（按本帧取景投影）。
 * 走这条路而不是直接套 `convertFitRect`，是为了**只保留一份取景数学**
 * （`halfH/halfHD` 的真相在 `initScene`）。
 */
export const uvRectToViewport = (
  r: { u0: number; v0: number; u1: number; v1: number },
  srcFit: ZoneFit,
  srcAspect: number,
  f: DesignFit
): { u0: number; v0: number; u1: number; v1: number } =>
  designRectToViewport(
    fitRectToDesign(r, srcFit, f.designW, f.designH, srcAspect),
    f
  );

/** 一次点击的命中结果 */
export type ZoneHit = {
  /** 裁决出的**唯一**赢家（可能为 `null` = 没命中任何区） */
  zone: TouchZone | null;
  /** 本次命中的**全部**热区，已按裁决顺序排好 ⇒ `candidates[0] === zone` */
  candidates: TouchZone[];
};

/* ── 校验 ──────────────────────────────────────────────────── */

/** 热区校验问题的代码。**命名沿用事件校验的口径**（`E_` = 不入池 / `W_` = 照用但记档） */
export type ZoneIssueCode =
  /** `id` 不是非空字符串 ⇒ 该区丢弃（id 是 `when.zone` 的引用键，不能匿名） */
  | 'E_ZONE_ID_MISSING'
  /** `id` 与前面某条重复 ⇒ 保留第一条，后面的丢弃 */
  | 'E_ZONE_ID_DUP'
  /** `u0/v0/u1/v1` 里有非有限数 ⇒ 该区丢弃 */
  | 'E_ZONE_GEOM'
  /** `u0 > u1` 或 `v0 > v1` ⇒ 自动交换（多半是换算时漏了 y 轴翻转） */
  | 'W_ZONE_FLIPPED'
  /** `fit` 不是 `'width'` / `'height'` ⇒ 按缺省 `'width'` 处理 */
  | 'W_ZONE_FIT'
  /** `aspect` 不是正有限数 ⇒ 按设计画幅比例处理（否则 u/v 无法还原到画布） */
  | 'W_ZONE_ASPECT'
  /** 宽或高为 0 ⇒ 几乎点不中，保留但提醒 */
  | 'W_ZONE_DEGENERATE'
  /** 整块落在视口外 ⇒ 永远不可能被命中，保留但提醒 */
  | 'W_ZONE_OUT_OF_VIEW'
  /** `priority` 不是有限数 ⇒ 按 0 处理 */
  | 'W_ZONE_PRIORITY'
  /** 顶层 `zones` 不是数组 ⇒ 视为未配置 */
  | 'E_ZONES_NOT_ARRAY';

export type ZoneIssue = {
  code: ZoneIssueCode;
  /** `error` ⇒ 该区被丢弃；`warn` ⇒ 照常生效，只是值得看一眼 */
  level: 'error' | 'warn';
  /** 出问题的热区 id（拿不到就给下标文本 `#3`） */
  id: string;
  message: string;
};

export type NormalizeResult = {
  /** 归一后的热区表（保留原相对顺序；去重/丢弃后的结果） */
  zones: TouchZone[];
  issues: ZoneIssue[];
};

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && isFinite(v);

/**
 * 解析 `zones[].fit`（**缺省 `'width'`**，2026-10-22 用户拍板）。
 *
 * 判据写成"只认 `'height'`"而不是"只认 `'width'`" ⇒ 与 `initScene.ts` /
 * `settingsStore.readView` 的 `fitAspect` 解析口径**字字一致**（三处必须同向，
 * 否则会出现"面板显示按宽、热区按高算"的假象）。非法值额外记一条 `W_ZONE_FIT`。
 */
const resolveSrcFit = (
  raw: unknown,
  id: string,
  issues: ZoneIssue[]
): ZoneFit => {
  if (raw === undefined) {
    return 'width';
  }
  if (raw === 'width' || raw === 'height') {
    return raw;
  }
  issues.push({
    code: 'W_ZONE_FIT',
    level: 'warn',
    id,
    message: "fit 只能是 'width' | 'height' ⇒ 按缺省 'width' 处理",
  });
  return 'width';
};

/**
 * 解析 `zones[].aspect`（**量 `u/v` 时的视口比例**，缺省 = 设计画幅比例）。
 *
 * 为什么必须有它：分数只有在"已知可见框尺寸"时才能还原成画布位置，而可见框
 * 由比例决定（`width` 基准下 `h = Wd/A`、`height` 基准下 `w = Hd·A`）。
 * 缺省设计比例 ⇒ 旧 `u/v`（在 1700×750 上量的）被解释成设计画布分数，
 * 与 `design` 等价。
 */
const resolveSrcAspect = (
  raw: unknown,
  aspectD: number,
  id: string,
  issues: ZoneIssue[]
): number => {
  if (raw === undefined) {
    return aspectD;
  }
  if (isFiniteNum(raw) && raw > 0) {
    return raw;
  }
  issues.push({
    code: 'W_ZONE_ASPECT',
    level: 'warn',
    id,
    message: 'aspect 必须是正有限数 ⇒ 按设计画幅比例处理',
  });
  return aspectD;
};

/**
 * 归一 + 校验热区表。**纯函数，不抛异常**（畸形输入只产出 `issues`）。
 *
 * 为什么"宽容"：热区来自解包换算，坐标越界、矩形方向写反都是家常便饭；
 * 一条坏数据不该让整张表失效（`touch.zones` 为空 ⇒ 触摸被整体禁用，代价太大）。
 * ⇒ 只有"身份（id）"和"几何是不是数"是硬错误，其余一律降级 + 记档。
 */
export const normalizeZones = (
  raw: unknown,
  /**
   * 取景信息（来自 `index.ts` 的 `designFitOf()`）。
   *
   * - 给了：`zones[].design` 按本帧取景投影；`u0..v1` 按 `zones[].fit/aspect`
   *   **还原到设计画布再投影** ⇒ 两种写法都随取景/对齐基准缩放；
   * - 不给：`design` 区报 `E_ZONE_GEOM` 丢弃；`u/v` 原样当作视口分数（纯几何单测用）。
   *
   * ⚠️ 入参必须是**原始 config 的 zones**：归一结果已经投影过，再喂回来会二次投影。
   */
  fit?: DesignFit
): NormalizeResult => {
  const issues: ZoneIssue[] = [];
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      issues.push({
        code: 'E_ZONES_NOT_ARRAY',
        level: 'error',
        id: '-',
        message: 'touch.zones 不是数组 ⇒ 视为未配置',
      });
    }
    return { zones: [], issues };
  }

  const zones: TouchZone[] = [];
  const seen: { [id: string]: boolean } = {};

  raw.forEach((item, index) => {
    const at = '#' + index;
    if (!item || typeof item !== 'object') {
      issues.push({
        code: 'E_ZONE_ID_MISSING',
        level: 'error',
        id: at,
        message: '热区不是对象 ⇒ 丢弃',
      });
      return;
    }
    const z = item as Partial<TouchZoneConfig> & Record<string, unknown>;
    const id = typeof z.id === 'string' && z.id.length > 0 ? z.id : '';
    if (!id) {
      issues.push({
        code: 'E_ZONE_ID_MISSING',
        level: 'error',
        id: at,
        message: '热区缺少非空 id ⇒ 丢弃（id 是事件条件 when.zone 的引用键）',
      });
      return;
    }
    if (seen[id]) {
      issues.push({
        code: 'E_ZONE_ID_DUP',
        level: 'error',
        id,
        message: '热区 id 重复 ⇒ 保留第一条，本条丢弃',
      });
      return;
    }
    /**
     * 几何来源二选一（2026-10-21；2026-10-22 起**两者都会投影**）：
     *   - `design`（**推荐**）：设计画布像素，装配时按本帧取景投影 ⇒ 换分辨率不漂；
     *   - `u0/v0/u1/v1`：**声明基准下的分数**（`fit` 缺省 `'width'`、`aspect` 缺省
     *     设计比例）⇒ 先还原成设计画布像素再投影。
     * `design` 优先（两个都写时以 design 为准）。
     *
     * ★ 2026-10-22 之前 `u/v` 是"视口分数"、**不随取景变** ⇒ 切对齐基准后热区留在
     *   原地而角色缩放/移动，点手点不中（用户报的正是这个）。现在两者等价于
     *   "设计画布位置"，只是书写单位不同。
     */
    const design = (z as { design?: DesignRect }).design;
    const hasDesign =
      !!design &&
      isFiniteNum(design.x) &&
      isFiniteNum(design.y) &&
      isFiniteNum(design.w) &&
      isFiniteNum(design.h);
    const hasUV =
      isFiniteNum(z.u0) &&
      isFiniteNum(z.v0) &&
      isFiniteNum(z.u1) &&
      isFiniteNum(z.v1);

    let u0: number;
    let u1: number;
    let v0: number;
    let v1: number;
    if (hasDesign) {
      if (!fit) {
        issues.push({
          code: 'E_ZONE_GEOM',
          level: 'error',
          id,
          message:
            '写了 design 但没有取景信息（未传 DesignFit）⇒ 该区丢弃：design 必须由 index.ts 在装配期投影',
        });
        return;
      }
      const p = designRectToViewport(design, fit);
      u0 = p.u0;
      u1 = p.u1;
      v0 = p.v0;
      v1 = p.v1;
    } else if (hasUV) {
      let ru0 = z.u0;
      let ru1 = z.u1;
      let rv0 = z.v0;
      let rv1 = z.v1;
      /**
       * ★ 端点方向**先修再换算**：负宽矩形进 `fitRectToDesign` 会被 `Math.min/max`
       *   悄悄吞成"看起来正常的反向框"，此时再报 W_ZONE_FLIPPED 就说不清是谁反了。
       *   （解包坐标系 Unity 的 y 轴**向上**、视口 y 轴**向下**，换算漏翻转就会整片反向。）
       */
      if (ru0 > ru1 || rv0 > rv1) {
        if (ru0 > ru1) {
          const t = ru0;
          ru0 = ru1;
          ru1 = t;
        }
        if (rv0 > rv1) {
          const t = rv0;
          rv0 = rv1;
          rv1 = t;
        }
        issues.push({
          code: 'W_ZONE_FLIPPED',
          level: 'warn',
          id,
          message:
            '矩形端点反向（已自动交换）：核对换算是否漏了 y 轴翻转（Unity y 向上、视口 y 向下）',
        });
      }
      if (fit) {
        const srcFit = resolveSrcFit(z.fit, id, issues);
        const srcAspect = resolveSrcAspect(z.aspect, fit.aspectD, id, issues);
        const p = uvRectToViewport(
          { u0: ru0, v0: rv0, u1: ru1, v1: rv1 },
          srcFit,
          srcAspect,
          fit
        );
        u0 = p.u0;
        u1 = p.u1;
        v0 = p.v0;
        v1 = p.v1;
      } else {
        /** 没有取景信息 ⇒ 保持旧口径（纯视口分数），只做几何单测时走这条 */
        u0 = ru0;
        u1 = ru1;
        v0 = rv0;
        v1 = rv1;
      }
    } else {
      issues.push({
        code: 'E_ZONE_GEOM',
        level: 'error',
        id,
        message:
          '既没有 design{x,y,w,h} 也没有 u0/v0/u1/v1 四个有限数 ⇒ 该区丢弃',
      });
      return;
    }
    /** 端点方向在 u/v 分支里已就地修正（见上面的 `W_ZONE_FLIPPED`）；投影结果天然有序 */

    if (u1 - u0 < AREA_EPS || v1 - v0 < AREA_EPS) {
      issues.push({
        code: 'W_ZONE_DEGENERATE',
        level: 'warn',
        id,
        message: '热区宽或高为 0 ⇒ 几乎不可能被点中（保留，不参与实际命中）',
      });
    }
    if (u1 < 0 || u0 > 1 || v1 < 0 || v0 > 1) {
      issues.push({
        code: 'W_ZONE_OUT_OF_VIEW',
        level: 'warn',
        id,
        message: '热区整块落在视口外 ⇒ 永远不会被命中',
      });
    }

    let priority = 0;
    if (z.priority !== undefined) {
      if (isFiniteNum(z.priority)) {
        priority = z.priority;
      } else {
        issues.push({
          code: 'W_ZONE_PRIORITY',
          level: 'warn',
          id,
          message: 'priority 不是有限数 ⇒ 按 0 处理',
        });
      }
    }

    seen[id] = true;
    zones.push({
      ...(z as TouchZoneConfig),
      id,
      u0,
      v0,
      u1,
      v1,
      priority,
      geom: hasDesign ? 'design' : 'uv',
    });
  });

  return { zones, issues };
};

/* ── 几何 ──────────────────────────────────────────────────── */

/**
 * 热区面积（**归一化**矩形的面积，越界部分照算）。
 *
 * 取绝对值：万一调用方拿到的是未经 `normalizeZones` 的原始数据，也不会算出负数面积
 * 而把裁决判据带偏。
 */
export const zoneArea = (z: TouchZone): number =>
  Math.abs((z.u1 ?? 0) - (z.u0 ?? 0)) * Math.abs((z.v1 ?? 0) - (z.v0 ?? 0));

/** 该区是否参与命中判定（缺省 `true`） */
export const isZoneEnabled = (z: TouchZone): boolean => z.enabled !== false;

/* ── 命中与裁决 ────────────────────────────────────────────── */

/**
 * 命中判定（**归一化坐标**输入，纯函数）。
 *
 * 端点**含**：`u0 <= u <= u1`（与改动前逐字一致 ⇒ 全屏区在画面边缘也命中）。
 */
export const hitsZoneAt = (z: TouchZone, u: number, v: number): boolean =>
  u >= (z.u0 ?? 0) && u <= (z.u1 ?? 0) && v >= (z.v0 ?? 0) && v <= (z.v1 ?? 0);

/**
 * 裁决比较器：**priority 降序 → 面积升序 → 数组下标升序**。
 *
 * 见文件头 §重叠裁决。三条判据全部可比 ⇒ 结果是**全序**，不存在并列
 * ⇒ 不需要"并列时随机"，回归可以写死断言。
 */
const compareForResolve = (
  a: { z: TouchZone; i: number },
  b: { z: TouchZone; i: number }
): number => {
  const pa = typeof a.z.priority === 'number' ? a.z.priority : 0;
  const pb = typeof b.z.priority === 'number' ? b.z.priority : 0;
  if (pa !== pb) {
    return pb - pa;
  }
  const aa = zoneArea(a.z);
  const ab = zoneArea(b.z);
  if (Math.abs(aa - ab) > AREA_EPS) {
    return aa - ab;
  }
  return a.i - b.i;
};

/**
 * 收集**所有**命中的热区，按裁决顺序排好（`[0]` 就是赢家）。
 *
 * @param u 归一化横坐标（0~1，左上原点）
 * @param v 归一化纵坐标
 */
export const collectZoneHitsAt = (
  zones: TouchZone[],
  u: number,
  v: number
): TouchZone[] => {
  const hits: { z: TouchZone; i: number }[] = [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!isZoneEnabled(z)) {
      continue;
    }
    if (hitsZoneAt(z, u, v)) {
      hits.push({ z, i });
    }
  }
  hits.sort(compareForResolve);
  return hits.map((h) => h.z);
};

/**
 * 收集**所有**命中的热区（**事件坐标**输入）。
 *
 * 坐标口径：`clientX/clientY` 与 `viewW/viewH` 必须是**同一坐标系**。
 * WE 桌面下 `window.innerWidth/innerHeight` = 工程分辨率，与事件坐标一致
 * （实测见 `_探针_实验结论.md`），所以直接相除即是归一化坐标。
 *
 * ⚠️ `viewW/viewH` 非正 ⇒ 返回空（无法归一化，与改动前一致）。
 */
export const collectZoneHits = (
  zones: TouchZone[],
  clientX: number,
  clientY: number,
  viewW: number,
  viewH: number
): TouchZone[] => {
  if (!(viewW > 0) || !(viewH > 0)) {
    return [];
  }
  return collectZoneHitsAt(zones, clientX / viewW, clientY / viewH);
};

/**
 * 完整命中结果：赢家 + 候选集合（**事件坐标**输入）。
 *
 * 候选集合给**覆盖层与探针**用 —— "点了却没反应"时，能看出是被谁压住的
 * （用户是强验证型，需要可观测而不只是"没命中"）。
 */
export const hitTestZonesDetailed = (
  zones: TouchZone[],
  clientX: number,
  clientY: number,
  viewW: number,
  viewH: number
): ZoneHit => {
  const candidates = collectZoneHits(zones, clientX, clientY, viewW, viewH);
  return { zone: candidates.length ? candidates[0] : null, candidates };
};

/**
 * 裁决出**唯一**赢家（事件坐标输入）；没命中返回 `null`。
 *
 * 这是 `touch.ts` 的 `hitTestZones` 的新实现 —— 名字与签名都没动，
 * 旧的"先命中先返回"语义只在**多区重叠**这一格上被替换成裁决。
 */
export const resolveZoneHit = (
  zones: TouchZone[],
  clientX: number,
  clientY: number,
  viewW: number,
  viewH: number
): TouchZone | null =>
  hitTestZonesDetailed(zones, clientX, clientY, viewW, viewH).zone;

/** 给日志 / 档案用的一句话描述（如 `hand ← [hand, body]`） */
export const describeZoneHit = (hit: ZoneHit): string => {
  if (!hit.zone) {
    return '(区外)';
  }
  const ids = hit.candidates.map((z) => z.id);
  return ids.length > 1 ? hit.zone.id + ' ← [' + ids.join(', ') + ']' : ids[0];
};
