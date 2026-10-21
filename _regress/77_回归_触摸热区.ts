/**
 * 回归：**触摸热区 · 自定义与重叠裁决**（2026-10-17 新增）。
 *
 * 验的是 `src/touchZones.ts` 这套**纯函数**（归一 / 校验 / 命中 / 裁决），
 * 不需要骨架、不需要浏览器 —— 但脚本仍先 import `polyfill`，因为同时要验
 * `src/touch.ts` 的 `hitTestZones` 已正确委派过来（那条 import 链会碰 `window`）。
 *
 * ## 为什么单开一个脚本
 *
 * 热区这套判据**以前没有独立回归**：`hitTestZones` 只是 `touch.ts` 里的一个函数，
 * 而 `touch.ts` 的回归（60/68）走的是"骨架 + 轨道"那条路，热区在里面只扮演
 * "能不能触发点击"的开关。现在热区有了自己的规则（自定义、重叠裁决），
 * 判据必须能被单独钉住 —— 尤其是**零回归**那条：改动不能影响既有工程。
 *
 * ## 判据
 *
 *   A. **归一**（`normalizeZones`）：id 缺失/重复、几何非法、端点反向自动交换、
 *      零面积、整块越界、priority 非法、非数组输入 —— 逐条对到 issue code
 *   B. **裁决**（`collectZoneHits` / `resolveZoneHit`）：
 *      `enabled` 过滤 → `priority` 降序 → 面积升序 → 数组下标，以及端点含、
 *      越界区仍命中、视口尺寸非正
 *   C. **零回归**：拿**改动前的旧口径**（"按数组顺序先命中先返回"）在同一批数据上
 *      逐点比对 ——
 *        C1 单区：全网格逐点相同
 *        C2 互不重叠的多区：全网格逐点相同
 *        C3 重叠的多区：**只在这个点上允许不同**（且必须真的不同，否则等于没改）
 *        C4 本工程真实 `config.json`：全网格逐点相同（证明线上工程不受影响）
 *   D. **委派**：`touch.ts` 的 `hitTestZones` 与新模块结果一致；`describeZoneHit` 文案
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/77_回归_触摸热区.ts [config.json 路径]
 * （路径解析规则见 `_regress/README.md`；不给路径就用仓库缺省，缺文件则 C4 跳过）
 */
import './polyfill';
import * as fs from 'fs';

import {
  collectZoneHits,
  collectZoneHitsAt,
  describeZoneHit,
  hitTestZonesDetailed,
  isZoneEnabled,
  designRectToViewport,
  normalizeZones,
  resolveZoneHit,
  TouchZone,
  zoneArea,
  ZoneIssueCode,
} from '../src/touchZones';
import { hitTestZones } from '../src/touch';

/** config 路径：命令行 > 环境变量 > 仓库缺省（不写死本机绝对路径，见 README） */
const CONFIG =
  process.argv[2] || process.env.WK_CONFIG || 'public/assets/config.json';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = ''): void => {
  if (ok) {
    pass++;
  } else {
    fail++;
  }
  console.log(
    '  [%s] %s%s',
    ok ? ' OK ' : 'FAIL',
    label,
    detail ? '  ' + detail : ''
  );
};

/** 视口取 1000×1000 ⇒ 归一化坐标与像素一一对应，断言里可以直接写 0.5 / 500 */
const VW = 1000;
const VH = 1000;

const z = (
  id: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  extra: Partial<TouchZone> = {}
): TouchZone => ({ id, u0, v0, u1, v1, ...extra });

const codes = (issues: { code: ZoneIssueCode }[]): string[] =>
  issues.map((i) => i.code);

/* ══════════════════════════════════════════════════════════════
 * A. 归一与校验
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── A. normalizeZones（归一 + 校验） ──');
{
  const r = normalizeZones([
    { id: 'hit1', label: '整屏', u0: 0, v0: 0, u1: 1, v1: 1 },
  ]);
  check(r.zones.length === 1, 'A1 合法单区保留', 'n=' + r.zones.length);
  check(
    r.zones[0].label === '整屏' && r.zones[0].priority === 0,
    'A1b 未知字段保留、priority 补缺省 0',
    'label=' + r.zones[0].label + ' p=' + r.zones[0].priority
  );
  check(
    r.issues.length === 0,
    'A1c 干净输入不产生告警',
    String(r.issues.length)
  );
}
{
  const r = normalizeZones([
    { id: 'ok', u0: 0, v0: 0, u1: 1, v1: 1 },
    { u0: 0, v0: 0, u1: 1, v1: 1 },
    { id: '', u0: 0, v0: 0, u1: 1, v1: 1 },
    'not an object',
  ] as any);
  check(
    r.zones.length === 1 && r.zones[0].id === 'ok',
    'A2 id 缺失 / 空串 / 非对象 ⇒ 丢弃',
    'n=' + r.zones.length
  );
  check(
    codes(r.issues).filter((c) => c === 'E_ZONE_ID_MISSING').length === 3,
    'A2b 三条 E_ZONE_ID_MISSING',
    codes(r.issues).join(',')
  );
}
{
  const r = normalizeZones([
    { id: 'dup', u0: 0, v0: 0, u1: 1, v1: 1 },
    { id: 'dup', u0: 0.2, v0: 0.2, u1: 0.4, v1: 0.4 },
  ]);
  check(r.zones.length === 1, 'A3 id 重复 ⇒ 只留第一条');
  check(
    r.zones[0].u1 === 1,
    'A3b 留下的是**第一条**（不是后写的那条）',
    'u1=' + r.zones[0].u1
  );
  check(
    codes(r.issues).indexOf('E_ZONE_ID_DUP') >= 0,
    'A3c 记一条 E_ZONE_ID_DUP'
  );
}
{
  const r = normalizeZones([
    { id: 'nan', u0: 0, v0: 0, u1: Number.NaN, v1: 1 },
    { id: 'str', u0: 0, v0: 0, u1: '1', v1: 1 } as any,
    { id: 'miss', u0: 0, v0: 0 } as any,
  ]);
  check(
    r.zones.length === 0,
    'A4 几何非有限数 / 缺字段 ⇒ 丢弃',
    'n=' + r.zones.length
  );
  check(
    codes(r.issues).filter((c) => c === 'E_ZONE_GEOM').length === 3,
    'A4b 三条 E_ZONE_GEOM',
    codes(r.issues).join(',')
  );
}
{
  const r = normalizeZones([
    { id: 'flip', u0: 0.8, v0: 0.9, u1: 0.2, v1: 0.3 },
  ]);
  check(
    r.zones.length === 1 &&
      r.zones[0].u0 === 0.2 &&
      r.zones[0].u1 === 0.8 &&
      r.zones[0].v0 === 0.3 &&
      r.zones[0].v1 === 0.9,
    'A5 端点反向 ⇒ 自动交换（解包 y 轴方向相反的救火路径）',
    JSON.stringify(r.zones[0])
  );
  check(
    codes(r.issues).indexOf('W_ZONE_FLIPPED') >= 0,
    'A5b 记一条 W_ZONE_FLIPPED'
  );
  check(
    collectZoneHitsAt(r.zones, 0.5, 0.5).length === 1,
    'A5c 交换后命中判定正常（点在交换前的"区间外"、交换后的区间内）'
  );
}
{
  const r = normalizeZones([
    { id: 'flat', u0: 0.2, v0: 0.2, u1: 0.2, v1: 0.8 },
  ]);
  check(
    r.zones.length === 1 && codes(r.issues).indexOf('W_ZONE_DEGENERATE') >= 0,
    'A6 零宽/零高 ⇒ 保留但告警（不静默丢弃数据）',
    codes(r.issues).join(',')
  );
}
{
  const r = normalizeZones([{ id: 'far', u0: 2, v0: 2, u1: 3, v1: 3 }]);
  check(
    r.zones.length === 1 && codes(r.issues).indexOf('W_ZONE_OUT_OF_VIEW') >= 0,
    'A7 整块落在视口外 ⇒ 保留但告警',
    codes(r.issues).join(',')
  );
}
{
  const r = normalizeZones([
    { id: 'p1', u0: 0, v0: 0, u1: 1, v1: 1, priority: 10 },
    { id: 'p2', u0: 0, v0: 0, u1: 1, v1: 1, priority: Number.NaN },
    { id: 'p3', u0: 0, v0: 0, u1: 1, v1: 1, priority: 'x' } as any,
  ]);
  check(
    r.zones[0].priority === 10 &&
      r.zones[1].priority === 0 &&
      r.zones[2].priority === 0,
    'A8 priority：合法值保留、非有限数归 0',
    r.zones.map((x) => x.priority).join('/')
  );
  check(
    codes(r.issues).filter((c) => c === 'W_ZONE_PRIORITY').length === 2,
    'A8b 两条 W_ZONE_PRIORITY',
    codes(r.issues).join(',')
  );
}
{
  const a = normalizeZones(undefined);
  const b = normalizeZones('nope' as any);
  check(
    a.zones.length === 0 && a.issues.length === 0,
    'A9 未配置（undefined）⇒ 空表且**不告警**（缺 touch.zones 另有 warn 管）'
  );
  check(
    b.zones.length === 0 && codes(b.issues).indexOf('E_ZONES_NOT_ARRAY') >= 0,
    'A9b 非数组 ⇒ 空表 + E_ZONES_NOT_ARRAY'
  );
}

/* ══════════════════════════════════════════════════════════════
 * B. 命中与重叠裁决
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── B. 命中与重叠裁决 ──');
{
  const zones = [z('only', 0.2, 0.2, 0.6, 0.6)];
  check(resolveZoneHit(zones, 500, 500, VW, VH)?.id === 'only', 'B1 单区命中');
  check(
    resolveZoneHit(zones, 100, 100, VW, VH) === null,
    'B1b 单区不命中 ⇒ null'
  );
  check(
    resolveZoneHit(zones, 200, 200, VW, VH)?.id === 'only' &&
      resolveZoneHit(zones, 600, 600, VW, VH)?.id === 'only',
    'B1c 端点**含**（u0/u1 上算命中，与改动前逐字一致）'
  );
}
{
  const zones = [z('a', 0, 0, 0.4, 0.4), z('b', 0.6, 0.6, 1, 1)];
  check(
    resolveZoneHit(zones, 200, 200, VW, VH)?.id === 'a' &&
      resolveZoneHit(zones, 800, 800, VW, VH)?.id === 'b',
    'B2 互不重叠 ⇒ 各命中各的（与旧口径等价，C2 会全网格复核）'
  );
}
{
  // 大区在前、小区在后（旧口径 ⇒ 大区赢；新口径 ⇒ 小区赢）
  const zones = [z('big', 0, 0, 1, 1), z('small', 0.4, 0.4, 0.6, 0.6)];
  const hit = hitTestZonesDetailed(zones, 500, 500, VW, VH);
  check(
    hit.zone?.id === 'small',
    'B3 重叠 + 同优先级 ⇒ **面积小的赢**',
    hit.zone?.id
  );
  check(
    hit.candidates.length === 2 && hit.candidates[0].id === 'small',
    'B3b candidates 已按裁决序排好（[0] 就是赢家）',
    hit.candidates.map((x) => x.id).join('>')
  );
}
{
  // priority 高的**面积更大** —— 验证 priority 压过面积判据
  const zones = [
    z('big', 0, 0, 1, 1, { priority: 10 }),
    z('small', 0.4, 0.4, 0.6, 0.6),
  ];
  check(
    resolveZoneHit(zones, 500, 500, VW, VH)?.id === 'big',
    'B4 priority 降序**优先于**面积（大区也能赢）',
    resolveZoneHit(zones, 500, 500, VW, VH)?.id
  );
}
{
  // 面积相等（一个越界拉大）⇒ 落到数组下标
  const zones = [z('first', 0, 0, 1, 1), z('second', -1, 0, 1, 0.5)];
  check(
    Math.abs(zoneArea(zones[0]) - zoneArea(zones[1])) < 1e-9,
    'B5 两区面积相等（前置条件）',
    zoneArea(zones[0]) + ' vs ' + zoneArea(zones[1])
  );
  check(
    resolveZoneHit(zones, 100, 100, VW, VH)?.id === 'first',
    'B5b 面积相同 ⇒ **数组靠前的赢**（保证全序，不存在并列）',
    resolveZoneHit(zones, 100, 100, VW, VH)?.id
  );
}
{
  const zones = [
    z('big', 0, 0, 1, 1),
    z('off', 0.4, 0.4, 0.6, 0.6, { enabled: false }),
  ];
  check(
    resolveZoneHit(zones, 500, 500, VW, VH)?.id === 'big',
    'B6 enabled:false ⇒ 不参与判定，让给下一条',
    resolveZoneHit(zones, 500, 500, VW, VH)?.id
  );
  check(
    collectZoneHits(zones, 500, 500, VW, VH).length === 1,
    'B6b 候选集合里也不出现被停用的区'
  );
  check(isZoneEnabled(z('x', 0, 0, 1, 1)) === true, 'B6c enabled 缺省 = true');
}
{
  // 三区重叠：priority 5 的大区 / 中 / 小
  const zones = [
    z('mid', 0.1, 0.1, 0.9, 0.9),
    z('top', 0, 0, 1, 1, { priority: 5 }),
    z('tiny', 0.4, 0.4, 0.6, 0.6),
  ];
  const got = collectZoneHits(zones, 500, 500, VW, VH).map((x) => x.id);
  check(
    got.join('>') === 'top>tiny>mid',
    'B7 三区重叠 ⇒ 裁决序 = priority → 面积 → 下标',
    got.join('>')
  );
}
{
  const zones = [z('over', -2.6, -4.2, 1.6, 3.1)];
  check(
    resolveZoneHit(zones, 500, 500, VW, VH)?.id === 'over',
    'B8 越界区（远超视口）照样命中 —— 判定用原值，不裁剪'
  );
  check(
    resolveZoneHit(zones, 500, 500, 0, 0) === null &&
      resolveZoneHit(zones, 500, 500, -1, VW) === null,
    'B8b 视口宽/高非正 ⇒ 不命中（与改动前一致）'
  );
}

/* ══════════════════════════════════════════════════════════════
 * C. 零回归：与改动前的旧口径逐点比对
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── C. 零回归（对比"数组顺序先命中先返回"的旧口径） ──');

/** 改动前的实现，逐字抄回来做对照（只允许在"多区重叠"处与新口径不同） */
const legacyHit = (
  zones: TouchZone[],
  clientX: number,
  clientY: number,
  viewW: number,
  viewH: number
): TouchZone | null => {
  if (!(viewW > 0) || !(viewH > 0)) {
    return null;
  }
  const u = clientX / viewW;
  const v = clientY / viewH;
  for (let i = 0; i < zones.length; i++) {
    const zz = zones[i];
    if (u >= zz.u0 && u <= zz.u1 && v >= zz.v0 && v <= zz.v1) {
      return zz;
    }
  }
  return null;
};

/** 11×11 网格（含 0 与 1 端点）⇒ 覆盖边界与内部 */
const GRID: { x: number; y: number }[] = [];
for (let i = 0; i <= 10; i++) {
  for (let j = 0; j <= 10; j++) {
    GRID.push({ x: i * 100, y: j * 100 });
  }
}

const diffCount = (zones: TouchZone[]): { diff: number; first: string } => {
  let diff = 0;
  let first = '';
  GRID.forEach((p) => {
    const a = legacyHit(zones, p.x, p.y, VW, VH)?.id ?? '';
    const b = resolveZoneHit(zones, p.x, p.y, VW, VH)?.id ?? '';
    if (a !== b) {
      diff++;
      if (!first) {
        first = '(' + p.x / VW + ',' + p.y / VH + ') 旧=' + a + ' 新=' + b;
      }
    }
  });
  return { diff, first };
};

{
  const one = [z('hit1', -2.609218, -4.19688, 1.589894, 3.089296)];
  const r = diffCount(one);
  check(
    r.diff === 0,
    'C1 单区（含越界大区）：121 点全部与旧口径相同',
    'diff=' + r.diff
  );
}
{
  const sep = [z('a', 0, 0, 0.4, 0.4), z('b', 0.6, 0.2, 1, 0.8)];
  const r = diffCount(sep);
  check(r.diff === 0, 'C2 互不重叠的多区：121 点全部相同', 'diff=' + r.diff);
}
{
  const overlap = [z('big', 0, 0, 1, 1), z('small', 0.4, 0.4, 0.6, 0.6)];
  const r = diffCount(overlap);
  check(
    r.diff > 0,
    'C3 ★重叠处**确实**与旧口径不同（否则等于没改规则）',
    'diff=' + r.diff + ' 例：' + r.first
  );
  check(
    r.diff === 9,
    'C3b 差异只出现在重叠那一块（0.4~0.6 的 3×3 = 9 点）',
    'diff=' + r.diff
  );
}
{
  /**
   * 真实工程：本仓库 `public/assets/config.json`
   *
   * ★ 2026-10-21 改口径：真实 `zones` 里出现了 `design`（设计画幅坐标）⇒ 归一**必须带取景信息**。
   *   这里拿**设计态自身**当取景（`halfH === halfHD`、`aspect === aspectD`）⇒ 投影是恒等变换，
   *   等价于"作者按设计比例写 u/v"，于是仍能继续和旧口径逐点对照。
   *   （旧版这里不传 fit：`design` 区会被 `E_ZONE_GEOM` 丢掉，`n=1` 却报 PASS —— 假通过。）
   *
   *   同时判据也要改：加分区**就是要**在它自己的矩形内改变归属，所以
   *   "121 点全同"不再成立 —— 改成"变化只发生在分区矩形内 + 确实有变化"。
   */
  let cfg: { width?: number; height?: number; touch?: { zones?: unknown } } | null =
    null;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf-8'));
  } catch (e) {
    cfg = null;
  }
  const rawZones = cfg?.touch?.zones;
  if (!rawZones) {
    console.log(
      '  [SKIP] C4 未读到 config（' + CONFIG + '）⇒ 跳过真实工程比对'
    );
  } else {
    const dw = Number(cfg?.width) || 1;
    const dh = Number(cfg?.height) || 1;
    /** 设计态自身：半高相等 ⇒ 两轴缩放系数都是 1（投影恒等） */
    const designFit = {
      halfH: 1,
      halfHD: 1,
      aspect: dw / dh,
      aspectD: dw / dh,
      designW: dw,
      designH: dh,
    };
    const { zones, issues } = normalizeZones(rawZones, designFit);
    const errs = issues.filter((it) => it.level === 'error');
    check(
      errs.length === 0,
      'C4a 真实 config 归一零 error（design 已按设计态投影）',
      'issues=' + issues.length + (errs.length ? ' 首个=' + errs[0].code : '')
    );
    check(
      zones.length === (rawZones as unknown[]).length,
      'C4b 真实 config 的区一个不少（design 没被丢弃）',
      'n=' + zones.length + '/' + (rawZones as unknown[]).length
    );

    /** 除整屏兜底以外的"具体分区" */
    const spec = zones.filter((zz) => zz.id !== 'hit1');
    const inSpec = (u: number, v: number): boolean =>
      spec.some(
        (zz) => u >= zz.u0 && u <= zz.u1 && v >= zz.v0 && v <= zz.v1
      );
    let changed = 0;
    let bad = 0;
    let first = '';
    GRID.forEach((p) => {
      const u = p.x / VW;
      const v = p.y / VH;
      const a = legacyHit(zones, p.x, p.y, VW, VH)?.id ?? '';
      const b = resolveZoneHit(zones, p.x, p.y, VW, VH)?.id ?? '';
      const s = inSpec(u, v);
      if (a !== b) {
        changed++;
        if (!s) {
          bad++;
          if (!first) {
            first =
              '区外却变了 (' + u.toFixed(1) + ',' + v.toFixed(1) + ') 旧=' + a + ' 新=' + b;
          }
        }
      } else if (s) {
        bad++;
        if (!first) {
          first =
            '区内却没变 (' + u.toFixed(1) + ',' + v.toFixed(1) + ') 仍是 ' + a;
        }
      }
    });
    check(
      bad === 0,
      'C4c 归属变化只发生在分区矩形内（区外逐点与旧口径相同）',
      'n=' + zones.length + ' 变化=' + changed + ' 异常=' + bad + (first ? ' 例：' + first : '')
    );
    check(
      changed > 0,
      'C4d 分区确实改变了命中归属（否则等于没加分区）',
      '变化=' + changed
    );
  }
}

/* ══════════════════════════════════════════════════════════════
 * D. touch.ts 的委派
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── D. touch.ts 委派与文案 ──');
{
  const zones = [
    z('big', 0, 0, 1, 1),
    z('small', 0.4, 0.4, 0.6, 0.6, { priority: 3 }),
  ];
  check(
    hitTestZones(zones, 500, 500, VW, VH)?.id === 'small' &&
      resolveZoneHit(zones, 500, 500, VW, VH)?.id === 'small',
    'D1 touch.ts 的 hitTestZones 与 touchZones.resolveZoneHit 同结果（已委派）'
  );
  check(
    hitTestZones(zones, 500, 500, VW, VH)?.id ===
      hitTestZonesDetailed(zones, 500, 500, VW, VH).zone?.id,
    'D1b 与 detailed 的赢家一致'
  );
  const outside = hitTestZonesDetailed([], 500, 500, VW, VH);
  check(
    describeZoneHit(outside) === '(区外)',
    'D2 没命中 ⇒ 文案 (区外)',
    describeZoneHit(outside)
  );
  const one = hitTestZonesDetailed([z('only', 0, 0, 1, 1)], 500, 500, VW, VH);
  check(
    describeZoneHit(one) === 'only',
    'D2b 单命中 ⇒ 只给 id',
    describeZoneHit(one)
  );
  const many = hitTestZonesDetailed(zones, 500, 500, VW, VH);
  check(
    describeZoneHit(many) === 'small ← [small, big]',
    'D2c 重叠 ⇒ "赢家 ← [候选]"（照抄归档/日志可直接用）',
    describeZoneHit(many)
  );
}

/* ══════════════════════════════════════════════════════════════
 * E. design 坐标的投影（2026-10-21：跨分辨率不漂）
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── E. design 投影（设计画幅 → 视口） ──');
{
  /** 设计画幅 1700×750（= 本工程），`aspectD = 2.2667` */
  const DW = 1700;
  const DH = 750;
  const aspectD = DW / DH;

  /** 设计态：半高相等 ⇒ 两轴缩放 1 */
  const atDesign = {
    halfH: 1,
    halfHD: 1,
    aspect: aspectD,
    aspectD,
    designW: DW,
    designH: DH,
  };
  const whole = designRectToViewport({ x: 0, y: 0, w: DW, h: DH }, atDesign);
  check(
    Math.abs(whole.u0) < 1e-12 &&
      Math.abs(whole.v0) < 1e-12 &&
      Math.abs(whole.u1 - 1) < 1e-12 &&
      Math.abs(whole.v1 - 1) < 1e-12,
    'E1 设计态投影是恒等变换（整幅 → [0,0,1,1]）',
    JSON.stringify(whole)
  );

  /**
   * 1920×1080（aspect 1.7778），`fitAspect: 'width'`
   * ⇒ `fov` 变小、可见高 = 1700/1.7778；以底边为锚 ⇒ 同一世界点整体**上移**
   * 即 v 变小…不对：可见高变大 ⇒ 顶部多露出 ⇒ 距顶距离变大 ⇒ v 变大。
   * 用真实公式核对：`ky = halfHD/halfH = aspect/aspectD = 0.78431`
   * `v_now = 1 − (1 − v_d)·0.78431`
   */
  const ky = 1.7777777777777777 / aspectD;
  const at169 = {
    halfH: 1 / ky, // halfH = halfHD/ky  ⇒ halfHD/halfH = ky
    halfHD: 1,
    aspect: 1.7777777777777777,
    aspectD,
    designW: DW,
    designH: DH,
  };
  const handDesign = { x: 1012, y: 96, w: 88, h: 126 };
  const p169 = designRectToViewport(handDesign, at169);
  const wantV0 = 1 - (1 - 96 / DH) * ky;
  const wantV1 = 1 - (1 - 222 / DH) * ky;
  check(
    Math.abs(p169.u0 - 1012 / DW) < 1e-9 &&
      Math.abs(p169.u1 - 1100 / DW) < 1e-9,
    'E2a 水平不漂（`width` 基准下可见宽恒定 ⇒ u 原样）',
    'u=' + p169.u0.toFixed(4) + '~' + p169.u1.toFixed(4)
  );
  check(
    Math.abs(p169.v0 - wantV0) < 1e-9 && Math.abs(p169.v1 - wantV1) < 1e-9,
    'E2b 垂直按半高比修正（16:9 下 v 下移，不是原样照搬）',
    'v=' +
      p169.v0.toFixed(4) +
      '~' +
      p169.v1.toFixed(4) +
      ' 期望=' +
      wantV0.toFixed(4) +
      '~' +
      wantV1.toFixed(4)
  );
  check(
    p169.v0 > 96 / DH + 0.15,
    'E2c ★漂移量确实很大（1700×750 的 v0.128 → 16:9 的 v≈0.316）—— 写死 u/v 必错',
    'v_design=' + (96 / DH).toFixed(4) + ' → v_16:9=' + p169.v0.toFixed(4)
  );

  /** 端点自动排序 + 负宽高 */
  const neg = designRectToViewport({ x: 1100, y: 222, w: -88, h: -126 }, atDesign);
  check(
    Math.abs(neg.u0 - 1012 / DW) < 1e-12 && Math.abs(neg.v1 - 222 / DH) < 1e-12,
    'E3 负宽高也能得到正向矩形（端点自动排序）',
    JSON.stringify(neg)
  );

  /** 没传 fit ⇒ design 区必须报错丢弃，而不是静默用 0 坐标 */
  const noFit = normalizeZones([
    { id: 'x', design: { x: 0, y: 0, w: 10, h: 10 } },
  ]);
  check(
    noFit.zones.length === 0 &&
      noFit.issues.some((it) => it.code === 'E_ZONE_GEOM' && it.level === 'error'),
    'E4 有 design 但没取景信息 ⇒ E_ZONE_GEOM 丢弃（不静默）',
    JSON.stringify(noFit.issues.map((it) => it.code))
  );

  /** design 优先于 u/v */
  const both = normalizeZones(
    [
      {
        id: 'both',
        u0: 0.9,
        v0: 0.9,
        u1: 0.99,
        v1: 0.99,
        design: { x: 0, y: 0, w: 170, h: 75 },
      },
    ],
    atDesign
  );
  check(
    both.zones.length === 1 &&
      Math.abs(both.zones[0].u0) < 1e-12 &&
      Math.abs(both.zones[0].u1 - 0.1) < 1e-12,
    'E5 design 与 u/v 同时写 ⇒ 以 design 为准',
    JSON.stringify(both.zones[0] && {
      u0: both.zones[0].u0,
      u1: both.zones[0].u1,
    })
  );

  /** 两个都不写 ⇒ 丢弃 */
  const none = normalizeZones([{ id: 'empty' }], atDesign);
  check(
    none.zones.length === 0 && none.issues.some((it) => it.code === 'E_ZONE_GEOM'),
    'E6 既无 design 也无 u/v ⇒ E_ZONE_GEOM 丢弃',
    JSON.stringify(none.issues.map((it) => it.code))
  );
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
