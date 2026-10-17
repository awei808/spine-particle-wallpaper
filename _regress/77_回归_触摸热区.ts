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
  // 真实工程：本仓库 public/assets/config.json
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG, 'utf-8'))?.touch?.zones;
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    console.log(
      '  [SKIP] C4 未读到 config（' + CONFIG + '）⇒ 跳过真实工程比对'
    );
  } else {
    const { zones, issues } = normalizeZones(raw);
    const r = diffCount(zones);
    check(
      r.diff === 0,
      'C4 真实 config 的 touch.zones：121 点全部与旧口径相同（线上零回归）',
      'n=' + zones.length + ' diff=' + r.diff + ' issues=' + issues.length
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

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
