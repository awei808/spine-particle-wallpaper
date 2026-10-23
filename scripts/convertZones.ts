/**
 * 热区**对齐基准换算 CLI**（2026-10-22）。
 *
 * ```bash
 * # 看某个 config 里的 u/v 区在"按宽 @ 16:9"下是什么分数（dry-run，只打印，不写文件）
 * npx ts-node --transpile-only scripts/convertZones.ts public/assets/config.json \
 *   --from height --from-aspect 1.7778 --to width --to-aspect 1.7778
 *
 * # 直接换算成**设计画布像素**（推荐写法，与基准无关）
 * npx ts-node --transpile-only scripts/convertZones.ts public/assets/config.json --to design
 *
 * # 机器可读（给出可直接粘进 config.json 的新 zones 数组）
 * npx ts-node --transpile-only scripts/convertZones.ts public/assets/config.json --to design --json
 * ```
 *
 * ## 干什么
 *
 * 对 `touch.zones` 里**用 `u0..v1` 写的**每一条：
 *
 * 1. 按它自己声明的基准还原成**设计画布像素**（`fit` 缺省 `width`、`aspect` 缺省设计比例）；
 * 2. 按 `--to`（`width` / `height` / `design`）以 `--to-aspect`（缺省设计比例）重新写一遍；
 * 3. 打印"现在 → 画布像素 → 目标写法"。
 *
 * `design` 区原样跳过（它本来就与基准无关）。
 *
 * ## ★ 为什么不写文件
 *
 * 整份 `config.json` 走 `JSON.parse → stringify` 会把 `0.0` 写成 `0`、改写缩进，
 * 在 100 KB 级的 config 上产生几千行伪 diff（与 `migrateEvents.ts` 同一个理由）。
 * 这里是**只读工具**：`--json` 给出的新条目直接粘回 `touch.zones` 即可，改动面最小。
 *
 * ## 口径来源
 *
 * 换算**全部复用** `src/touchZones.ts` 的纯函数（`fitRectToDesign` / `designRectToFit`），
 * 不在这里重写一遍 —— 与运行时逐位一致，`_regress/102` 钉住。
 */
import * as fs from 'fs';
import { designRectToFit, fitRectToDesign, TouchZone } from '../src/touchZones';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.indexOf('--' + name) >= 0;

/** 第一个非选项、且不是"选项的值"的参数 = config 路径 */
let file = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (
    a === '--from' ||
    a === '--from-aspect' ||
    a === '--to' ||
    a === '--to-aspect'
  ) {
    i++;
    continue;
  }
  if (a.charAt(0) === '-') {
    continue;
  }
  if (!file) {
    file = a;
  }
}
if (!file) {
  console.error(
    '用法：ts-node --transpile-only scripts/convertZones.ts <config.json> ' +
      '[--from width|height] [--from-aspect 1.7778] ' +
      '[--to width|height|design] [--to-aspect 1.7778] [--json]'
  );
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
const W = Number(cfg?.width);
const H = Number(cfg?.height);
if (!(W > 0) || !(H > 0)) {
  console.error('[convert] config 缺少合法的 width/height ⇒ 无法换算');
  process.exit(2);
}
const AD = W / H;
const zones: TouchZone[] = (cfg?.touch?.zones ?? []) as TouchZone[];
if (!zones.length) {
  console.error('[convert] ' + file + ' 里没有 touch.zones');
  process.exit(2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const toFitRaw = flag('to') ?? 'design';
if (toFitRaw !== 'width' && toFitRaw !== 'height' && toFitRaw !== 'design') {
  console.error('--to 只能是 width | height | design');
  process.exit(2);
}
const fromFitFlag = flag('from');
if (
  fromFitFlag !== undefined &&
  fromFitFlag !== 'width' &&
  fromFitFlag !== 'height'
) {
  console.error('--from 只能是 width | height');
  process.exit(2);
}
const numFlag = (name: string): number | undefined => {
  const raw = flag(name);
  if (raw === undefined) {
    return undefined;
  }
  const v = Number(raw);
  if (!(v > 0) || !isFinite(v)) {
    console.error('--' + name + ' 必须是正数');
    process.exit(2);
  }
  return v;
};
/** 源比例（量 `u/v` 时那个比例）：缺省取 zone.aspect，再缺省取设计比例 */
const fromAspectFlag = numFlag('from-aspect');
/** 目标比例：`design` 与基准无关；`width`/`height` 缺省设计比例 */
const toAspectFlag = numFlag('to-aspect');

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const out: Record<string, unknown>[] = [];
/** 目标写法下的比例 */
const toAspect = toFitRaw === 'design' ? AD : toAspectFlag ?? AD;

zones.forEach((z) => {
  /** `design` 区与基准无关 ⇒ 原样跳过 */
  if (z.design && isNum(z.design.x) && isNum(z.design.w)) {
    console.log('  [跳过] %s 已是 design 区（与对齐基准无关）', z.id);
    return;
  }
  if (!isNum(z.u0) || !isNum(z.v0) || !isNum(z.u1) || !isNum(z.v1)) {
    console.log('  [跳过] %s 既无 design 也无完整 u/v', z.id);
    return;
  }
  const fromFit =
    (fromFitFlag as 'width' | 'height' | undefined) ??
    (z.fit === 'height' ? 'height' : 'width');
  const fromAspect =
    fromAspectFlag ?? (isNum(z.aspect) && z.aspect > 0 ? z.aspect : AD);
  const d = fitRectToDesign(
    { u0: z.u0, v0: z.v0, u1: z.u1, v1: z.v1 },
    fromFit,
    W,
    H,
    fromAspect
  );
  /** 保留身份与行为字段，只换几何 */
  const next: Record<string, unknown> = {
    id: z.id,
    ...(z.label !== undefined ? { label: z.label } : {}),
  };
  let desc: string;
  if (toFitRaw === 'design') {
    next.design = {
      x: Math.round(d.x * 1000) / 1000,
      y: Math.round(d.y * 1000) / 1000,
      w: Math.round(d.w * 1000) / 1000,
      h: Math.round(d.h * 1000) / 1000,
    };
    desc =
      'design{x:' +
      fmt(d.x) +
      ',y:' +
      fmt(d.y) +
      ',w:' +
      fmt(d.w) +
      ',h:' +
      fmt(d.h) +
      '}';
  } else {
    const r = designRectToFit(d, toFitRaw, W, H, toAspect);
    next.fit = toFitRaw;
    /** 只在比例 ≠ 设计比例时写 `aspect`（等于缺省就不写，少一个会漂的字段） */
    if (Math.abs(toAspect - AD) > 1e-9) {
      next.aspect = Math.round(toAspect * 1e6) / 1e6;
    }
    next.u0 = Math.round(r.u0 * 1e6) / 1e6;
    next.v0 = Math.round(r.v0 * 1e6) / 1e6;
    next.u1 = Math.round(r.u1 * 1e6) / 1e6;
    next.v1 = Math.round(r.v1 * 1e6) / 1e6;
    desc =
      'u/v=' +
      [r.u0, r.v0, r.u1, r.v1].map(fmt).join(',') +
      ' @ ' +
      toFitRaw +
      ' ' +
      fmt(toAspect);
  }
  if (z.enabled === false) {
    next.enabled = false;
  }
  if (isNum(z.priority) && z.priority !== 0) {
    next.priority = z.priority;
  }
  out.push(next);
  console.log(
    '  %s: %s @fit=%s aspect=%s → 画布 px [%s,%s ~ %s,%s] → %s',
    z.id,
    [z.u0, z.v0, z.u1, z.v1].map(fmt).join(','),
    fromFit,
    fmt(fromAspect),
    fmt(d.x),
    fmt(d.y),
    fmt(d.x + d.w),
    fmt(d.y + d.h),
    desc
  );
});

console.log(
  '\n画布 %s×%s（设计比例 %s）；目标基准 = %s%s',
  W,
  H,
  AD.toFixed(4),
  toFitRaw,
  toFitRaw === 'design' ? '' : ' @ ' + toAspect.toFixed(4)
);
if (has('json')) {
  console.log('\n-- 直接粘进 touch.zones（design 区不在此列，保持原样）--');
  console.log(JSON.stringify(out, null, 2));
}
