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
 * ## 不做的事
 *
 * - **不做圆形/多边形**：解包侧只有矩形（`SoulSpineHitArea` 是 RectTransform），
 *   没有第二种形状 ⇒ 不提前造形状抽象。
 * - **不做"热区 → 动作/念白"绑定**：命中哪个区只决定"这次点击归属谁"，
 *   "播什么"由自定义事件的 `when.zone` 条件表达（见 `docx/PLAN_自定义事件前置条件`）。
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
export type TouchZone = TouchZoneConfig;

/** 面积比较的容差：两区面积差小于它就当作"一样大"，落到数组顺序判据 */
const AREA_EPS = 1e-9;

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
 * 归一 + 校验热区表。**纯函数，不抛异常**（畸形输入只产出 `issues`）。
 *
 * 为什么"宽容"：热区来自解包换算，坐标越界、矩形方向写反都是家常便饭；
 * 一条坏数据不该让整张表失效（`touch.zones` 为空 ⇒ 触摸被整体禁用，代价太大）。
 * ⇒ 只有"身份（id）"和"几何是不是数"是硬错误，其余一律降级 + 记档。
 */
export const normalizeZones = (raw: unknown): NormalizeResult => {
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
    if (
      !isFiniteNum(z.u0) ||
      !isFiniteNum(z.v0) ||
      !isFiniteNum(z.u1) ||
      !isFiniteNum(z.v1)
    ) {
      issues.push({
        code: 'E_ZONE_GEOM',
        level: 'error',
        id,
        message: 'u0/v0/u1/v1 必须是有限数 ⇒ 该区丢弃',
      });
      return;
    }

    let u0 = z.u0;
    let u1 = z.u1;
    let v0 = z.v0;
    let v1 = z.v1;
    if (u0 > u1 || v0 > v1) {
      // ★ 解包坐标系（Unity 的 y 轴**向上**）与视口（y 轴**向下**）方向相反，
      //   换算时漏掉翻转就会整片反向 ⇒ 直接交换比"静默失效"友好得多，但要留痕。
      if (u0 > u1) {
        const t = u0;
        u0 = u1;
        u1 = t;
      }
      if (v0 > v1) {
        const t = v0;
        v0 = v1;
        v1 = t;
      }
      issues.push({
        code: 'W_ZONE_FLIPPED',
        level: 'warn',
        id,
        message:
          '矩形端点反向（已自动交换）：核对换算是否漏了 y 轴翻转（Unity y 向上、视口 y 向下）',
      });
    }

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
