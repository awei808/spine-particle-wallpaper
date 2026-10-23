/**
 * 回归：**热区对齐基准 · 宽 ⇄ 高 换算**（2026-10-22 新增）。
 *
 * ## 为什么单开一条
 *
 * 用户报的现象：「换「画面调整」页的按宽/按高对齐，触摸热区**不动**，人却缩放了」
 * ⇒ 点手点到空白处。根因是 `u0..v1` 被当成**视口分数**，与取景完全无关。
 * 现在 `u/v` 有了 `fit`（缺省 `width`）+ `aspect`（缺省设计比例），引擎先把它
 * 还原成**设计画布像素**再投影 ⇒ 两种写法都跟着取景走。
 *
 * 这条脚本钉四类东西：
 *
 *   A. **换算自洽**：`fitRectToDesign` / `designRectToFit` 互为逆、两个基准 × 五个比例
 *   B. **设计比例下两基准重合** ⇒ `u/v` 等价于 `design`（旧数据为什么还认得出）
 *   C. **高 ⇄ 宽 = 绕 (0.5,1) 的均匀缩放** `k = (Wd/Hd)/A`，且换算前后**画布位置不变**
 *      （这条是"换基准后仍点得中"的数学保证）
 *   D. **接入后行为**：`normalizeZones` 的 u/v 区随基准/比例变化、`design` 与 `u/v`
 *      两种写法结果相同、非法 `fit`/`aspect` 降级并记账、真实 `config.json` 的兜底区
 *      在任何基准下仍然覆盖全屏
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/102_回归_热区对齐换算.ts [config.json 路径]
 */
import * as fs from 'fs';

import {
  alignedFrameOf,
  convertFitRect,
  designRectToFit,
  fitRectToDesign,
  normalizeZones,
  DesignFit,
  ZoneFit,
} from '../src/touchZones';

/** config 路径：命令行 > 环境变量 > 仓库缺省（同 77，不写死本机绝对路径） */
const CONFIG =
  process.argv[2] || process.env.WK_CONFIG || 'public/assets/config.json';

/** 本工程设计画幅 1700×750（`config.width × config.height`） */
const DW = 1700;
const DH = 750;
const AD = DW / DH;

const A169 = 16 / 9;
const A219 = 21 / 9;
const A1610 = 16 / 10;
const A43 = 4 / 3;

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

const near = (a: number, b: number, eps = 1e-9): boolean =>
  Math.abs(a - b) < eps;

/**
 * 造一个 `DesignFit`（按 `initScene.calc()` 的口径）：
 * `halfHD` 固定 1，`width` 基准下 `halfH = halfHD·Ad/A`（可见宽恒定），
 * `height` 基准下 `halfH = halfHD`（可见高恒定）。
 */
const frame = (aspect: number, mode: ZoneFit): DesignFit => ({
  halfH: mode === 'height' ? 1 : AD / aspect,
  halfHD: 1,
  aspect,
  aspectD: AD,
  designW: DW,
  designH: DH,
});

/** 设计画布像素点 → 视口归一化（与 `designRectToViewport` 同一套取景量） */
const projectPoint = (
  x: number,
  y: number,
  f: DesignFit
): { u: number; v: number } => {
  const kx = (f.halfHD * f.aspectD) / (f.halfH * f.aspect);
  const ky = f.halfHD / f.halfH;
  return {
    u: 0.5 + (x / f.designW - 0.5) * kx,
    v: 1 - (1 - y / f.designH) * ky,
  };
};

const fmt = (r: { u0: number; v0: number; u1: number; v1: number }): string =>
  '[' + [r.u0, r.v0, r.u1, r.v1].map((n) => n.toFixed(4)).join(', ') + ']';

const rectEq = (
  a: { u0: number; v0: number; u1: number; v1: number },
  b: { u0: number; v0: number; u1: number; v1: number },
  eps = 1e-9
): boolean =>
  near(a.u0, b.u0, eps) &&
  near(a.v0, b.v0, eps) &&
  near(a.u1, b.u1, eps) &&
  near(a.v1, b.v1, eps);

const codes = (issues: { code: string }[]): string[] =>
  issues.map((i) => i.code);

/* ══════════════════════════════════════════════════════════════
 * A. 换算自洽（分数 ⇄ 设计画布像素）
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── A. fitRectToDesign ⇄ designRectToFit（往返一致） ──');
{
  const r = { u0: 0.42, v0: 0.13, u1: 0.47, v1: 0.31 };
  let worst = 0;
  let worstAt = '';
  (['width', 'height'] as ZoneFit[]).forEach((mode) => {
    [AD, A169, A219, A1610, A43].forEach((a) => {
      const back = designRectToFit(
        fitRectToDesign(r, mode, DW, DH, a),
        mode,
        DW,
        DH,
        a
      );
      const d = Math.max(
        Math.abs(back.u0 - r.u0),
        Math.abs(back.v0 - r.v0),
        Math.abs(back.u1 - r.u1),
        Math.abs(back.v1 - r.v1)
      );
      if (d > worst) {
        worst = d;
        worstAt = mode + '@' + a.toFixed(4);
      }
    });
  });
  check(
    worst < 1e-12,
    'A1 分数 → 设计画布 → 分数（10 组）逐项回原',
    'maxErr=' + worst + ' @' + worstAt
  );
}
{
  /** 反向：设计画布 → 分数 → 设计画布 */
  const d = { x: 1012, y: 96, w: 88, h: 126 };
  let ok = true;
  let detail = '';
  (['width', 'height'] as ZoneFit[]).forEach((mode) => {
    [AD, A169, A219, A43].forEach((a) => {
      const back = fitRectToDesign(
        designRectToFit(d, mode, DW, DH, a),
        mode,
        DW,
        DH,
        a
      );
      if (
        !near(back.x, d.x, 1e-9) ||
        !near(back.y, d.y, 1e-9) ||
        !near(back.w, d.w, 1e-9) ||
        !near(back.h, d.h, 1e-9)
      ) {
        ok = false;
        detail = mode + '@' + a.toFixed(3) + ' → ' + JSON.stringify(back);
      }
    });
  });
  check(ok, 'A2 设计画布 → 分数 → 设计画布（本工程 hand 区，8 组）', detail);
}
{
  /** 可见框尺寸本身就是定义的直接体现 */
  check(
    alignedFrameOf('width', DW, DH, A169).w === DW &&
      near(alignedFrameOf('width', DW, DH, A169).h, DW / A169),
    'A3 width 基准：可见宽 = 设计宽、可见高 = 宽/A',
    JSON.stringify(alignedFrameOf('width', DW, DH, A169))
  );
  check(
    near(alignedFrameOf('height', DW, DH, A169).w, DH * A169) &&
      alignedFrameOf('height', DW, DH, A169).h === DH,
    'A3b height 基准：可见高 = 设计高、可见宽 = 高·A',
    JSON.stringify(alignedFrameOf('height', DW, DH, A169))
  );
  check(
    alignedFrameOf('width', DW, DH, AD).w === DW &&
      near(alignedFrameOf('width', DW, DH, AD).h, DH) &&
      near(alignedFrameOf('height', DW, DH, AD).w, DW) &&
      alignedFrameOf('height', DW, DH, AD).h === DH,
    'A3c ★ 设计比例下两种基准的可见框**完全重合**（= 设计画布）'
  );
}

/* ══════════════════════════════════════════════════════════════
 * B. 设计比例下 u/v ≡ design 分数
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── B. 设计比例：两种基准与 design 等价 ──');
{
  const r = { u0: 0.2, v0: 0.4, u1: 0.5, v1: 0.6 };
  const want = { x: 0.2 * DW, y: 0.4 * DH, w: 0.3 * DW, h: 0.2 * DH };
  const dw = fitRectToDesign(r, 'width', DW, DH, AD);
  const dh = fitRectToDesign(r, 'height', DW, DH, AD);
  check(
    near(dw.x, want.x) &&
      near(dw.y, want.y) &&
      near(dw.w, want.w) &&
      near(dw.h, want.h),
    'B1 width@设计比例 ⇒ 就是"设计画布分数 × 画布尺寸"',
    JSON.stringify(dw)
  );
  check(
    near(dh.x, want.x) &&
      near(dh.y, want.y) &&
      near(dh.w, want.w) &&
      near(dh.h, want.h),
    'B1b height@设计比例 ⇒ 同上（两基准在设计比例重合）',
    JSON.stringify(dh)
  );
  check(
    rectEq(convertFitRect(r, 'width', 'height', DW, DH, AD), r, 1e-12),
    'B2 设计比例下 高⇄宽 换算是**恒等变换**'
  );
}

/* ══════════════════════════════════════════════════════════════
 * C. 高 ⇄ 宽 = 绕 (0.5, 1) 的均匀缩放
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── C. convertFitRect：绕 (0.5,1) 均匀缩放 k=(Wd/Hd)/A ──');
{
  const r = { u0: 0.4, v0: 0.2, u1: 0.6, v1: 0.4 };
  const k = AD / A169; // width → height 的放大倍数 ≈ 1.275
  const got = convertFitRect(r, 'width', 'height', DW, DH, A169);
  const want = {
    u0: 0.5 + (0.4 - 0.5) * k,
    u1: 0.5 + (0.6 - 0.5) * k,
    v0: 1 - (1 - 0.2) * k,
    v1: 1 - (1 - 0.4) * k,
  };
  check(
    rectEq(got, want, 1e-12),
    'C1 width→height：u/v 同一个标量 k=' + k.toFixed(6) + ' 缩放',
    fmt(got)
  );
  check(
    near(got.u1 - got.u0, (r.u1 - r.u0) * k, 1e-12) &&
      near(got.v1 - got.v0, (r.v1 - r.v0) * k, 1e-12) &&
      got.u1 - got.u0 > r.u1 - r.u0,
    'C1b 16:9 下 k>1 ⇒ 框在同一画布上**占的比例变大**（按高把画布放大了）',
    'Δu ' + (r.u1 - r.u0).toFixed(3) + '→' + (got.u1 - got.u0).toFixed(3)
  );
  check(
    rectEq(convertFitRect(got, 'height', 'width', DW, DH, A169), r, 1e-12),
    'C2 反向换算回到原值（互逆）'
  );
  check(
    rectEq(convertFitRect(r, 'width', 'width', DW, DH, A169), r, 1e-15),
    'C3 同基准 ⇒ 原样返回（不做多余浮点运算）'
  );
  {
    const k219 = AD / A219;
    const got219 = convertFitRect(
      { u0: 0.4, v0: 0.2, u1: 0.6, v1: 0.4 },
      'width',
      'height',
      DW,
      DH,
      A219
    );
    const want219 = {
      u0: 0.5 + (0.4 - 0.5) * k219,
      u1: 0.5 + (0.6 - 0.5) * k219,
      v0: 1 - (1 - 0.2) * k219,
      v1: 1 - (1 - 0.4) * k219,
    };
    check(
      k219 < 1 && rectEq(got219, want219, 1e-12),
      'C4 21:9（比设计比例更宽）⇒ k<1，框**变小**',
      'k=' + k219.toFixed(4) + ' ' + fmt(got219)
    );
  }
  check(
    fmt(
      convertFitRect(
        { u0: 0, v0: 0, u1: 1, v1: 1 },
        'width',
        'height',
        DW,
        DH,
        A169
      )
    ) === fmt({ u0: 0.5 - 0.5 * k, v0: 1 - k, u1: 0.5 + 0.5 * k, v1: 1 }),
    'C5 整幅区（0~1）换算后对称放大（以底边中点为中心）',
    fmt(
      convertFitRect(
        { u0: 0, v0: 0, u1: 1, v1: 1 },
        'width',
        'height',
        DW,
        DH,
        A169
      )
    )
  );
  /** ★ 关键不变式：换算前后**落在同一块画布位置** */
  let ok = true;
  let detail = '';
  [A169, A219, A43].forEach((a) => {
    const d1 = fitRectToDesign(r, 'width', DW, DH, a);
    const d2 = fitRectToDesign(
      convertFitRect(r, 'width', 'height', DW, DH, a),
      'height',
      DW,
      DH,
      a
    );
    if (
      !near(d1.x, d2.x, 1e-9) ||
      !near(d1.y, d2.y, 1e-9) ||
      !near(d1.w, d2.w, 1e-9) ||
      !near(d1.h, d2.h, 1e-9)
    ) {
      ok = false;
      detail =
        'a=' +
        a.toFixed(4) +
        ' ' +
        JSON.stringify(d1) +
        ' vs ' +
        JSON.stringify(d2);
    }
  });
  check(
    ok,
    'C6 ★换算前后**画布位置完全相同**（换基准不换位置，只是换个单位写）',
    detail
  );
}

/* ══════════════════════════════════════════════════════════════
 * D. 接入 normalizeZones 后的行为
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── D. normalizeZones：u/v 跟着基准 / 比例走 ──');
{
  /** 一条纯 u/v 区（缺省 fit/aspect） */
  const raw = [{ id: 'hand', u0: 0.4, v0: 0.4, u1: 0.5, v1: 0.5 }];
  const w = normalizeZones(raw, frame(A169, 'width'));
  const h = normalizeZones(raw, frame(A169, 'height'));
  check(
    codes(w.issues).length === 0 && w.zones.length === 1,
    'D1 缺省 fit/aspect 的 u/v 区零告警',
    codes(w.issues).join(',')
  );
  check(
    !rectEq(w.zones[0], h.zones[0], 1e-6),
    'D2 ★同一组 u/v 在两种对齐基准下结果**不同**（改前是不变的）',
    fmt(w.zones[0]) + ' vs ' + fmt(h.zones[0])
  );
  /** 但**画布位置相同** ⇒ 角色缩放后仍点得中同一块身体 */
  const cx = 0.45 * DW;
  const cy = 0.45 * DH;
  const pw = projectPoint(cx, cy, frame(A169, 'width'));
  const ph = projectPoint(cx, cy, frame(A169, 'height'));
  const inside = (
    z: { u0: number; v0: number; u1: number; v1: number },
    p: { u: number; v: number }
  ): boolean => p.u >= z.u0 && p.u <= z.u1 && p.v >= z.v0 && p.v <= z.v1;
  check(
    inside(w.zones[0], pw) && inside(h.zones[0], ph),
    'D2b ★两种基准下，**同一个画布点**都落在区内（换基准后仍点得中）',
    'width:' + fmt(w.zones[0]) + ' height:' + fmt(h.zones[0])
  );

  /** 与 design 写法等价 */
  const asDesign = normalizeZones(
    [
      {
        id: 'hand',
        design: { x: 0.4 * DW, y: 0.4 * DH, w: 0.1 * DW, h: 0.1 * DH },
      },
    ],
    frame(A169, 'width')
  );
  check(
    rectEq(w.zones[0], asDesign.zones[0], 1e-12),
    'D3 缺省 u/v ≡ 同位置的 design（两种写法只是单位不同）',
    fmt(asDesign.zones[0])
  );

  /** 比例变了 ⇒ 结果也变（旧行为钉死不动，这里反向钉"会动"） */
  const w219 = normalizeZones(raw, frame(A219, 'width'));
  check(
    !rectEq(w.zones[0], w219.zones[0], 1e-6),
    'D4 同一基准、不同视口比例 ⇒ 结果随取景变（21:9 vs 16:9）',
    fmt(w219.zones[0])
  );
  check(
    w.zones[0].geom === 'uv' && asDesign.zones[0].geom === 'design',
    'D5 geom 诊断字段：u/v → uv、design → design'
  );
}
{
  /** 声明"量在 16:9 上" ⇒ 从 21:9 的机器上看，画布位置不漂 */
  const raw = [
    { id: 'hand', u0: 0.4, v0: 0.4, u1: 0.5, v1: 0.5, aspect: A169 },
  ];
  const at169 = normalizeZones(raw, frame(A169, 'width'));
  const at219 = normalizeZones(raw, frame(A219, 'width'));
  check(
    at169.issues.length === 0 && at219.issues.length === 0,
    'D6 写了 aspect ⇒ 零告警'
  );
  /**
   * ★ 用**反投影**把两台的归一化结果各自还原成设计画布像素
   * （`kx = halfHD·aspectD/(halfH·aspect)`、`ky = halfHD/halfH` 的逆），
   * 判据是"两家还原出**同一块画布矩形**" —— 这才是"跨分辨不漂"的硬证据。
   */
  const unproject = (
    r: { u0: number; v0: number; u1: number; v1: number },
    f: DesignFit
  ) => {
    const kx = (f.halfHD * f.aspectD) / (f.halfH * f.aspect);
    const ky = f.halfHD / f.halfH;
    const toX = (u: number) => (0.5 + (u - 0.5) / kx) * f.designW;
    const toY = (v: number) => (1 - (1 - v) / ky) * f.designH;
    return { x: toX(r.u0), y: toY(r.v0), x1: toX(r.u1), y1: toY(r.v1) };
  };
  const d169 = unproject(at169.zones[0], frame(A169, 'width'));
  const d219 = unproject(at219.zones[0], frame(A219, 'width'));
  check(
    near(d169.x, d219.x, 1e-6) &&
      near(d169.y, d219.y, 1e-6) &&
      near(d169.x1, d219.x1, 1e-6) &&
      near(d169.y1, d219.y1, 1e-6),
    'D6b ★声明量测比例后，16:9 与 21:9 上命中**同一块画布矩形**（跨分辨不漂）',
    '16:9→' + JSON.stringify(d169) + ' 21:9→' + JSON.stringify(d219)
  );
  /**
   * 声明比例是 16:9、基准是 width ⇒ 分数是"**屏幕上**的比例"：
   * `u` 相对设计宽（宽基准下 u 恒定）、`v` 相对该比例下的可见高 `Wd/A`，
   * 而可见框的**顶边在画布上方**（y = DH − Wd/A < 0）⇒ v 的分母不是 DH。
   */
  const visH = DW / A169;
  const topY = DH - visH;
  const want169 = {
    x: 0.4 * DW,
    y: topY + 0.4 * visH,
    x1: 0.5 * DW,
    y1: topY + 0.5 * visH,
  };
  check(
    near(d169.x, want169.x, 1e-6) &&
      near(d169.y, want169.y, 1e-6) &&
      near(d169.x1, want169.x1, 1e-6) &&
      near(d169.y1, want169.y1, 1e-6),
    'D6c 还原结果 = "屏幕上量到的分数"在画布上的真实位置（顶边在 y=' +
      topY.toFixed(1) +
      '）',
    JSON.stringify(d169) + ' 期望 ' + JSON.stringify(want169)
  );
}
{
  /** 非法 fit / aspect ⇒ 降级 + 记账，结果等于缺省 */
  const good = normalizeZones(
    [{ id: 'z', u0: 0.2, v0: 0.2, u1: 0.4, v1: 0.4 }],
    frame(A169, 'width')
  );
  const badFit = normalizeZones(
    [{ id: 'z', u0: 0.2, v0: 0.2, u1: 0.4, v1: 0.4, fit: 'WIDE' } as any],
    frame(A169, 'width')
  );
  check(
    codes(badFit.issues).indexOf('W_ZONE_FIT') >= 0 &&
      rectEq(good.zones[0], badFit.zones[0], 1e-12),
    'D7 非法 fit ⇒ W_ZONE_FIT，按缺省 width 处理',
    codes(badFit.issues).join(',')
  );
  [0, -1, Number.NaN, Infinity].forEach((bad, i) => {
    const r = normalizeZones(
      [{ id: 'z', u0: 0.2, v0: 0.2, u1: 0.4, v1: 0.4, aspect: bad }],
      frame(A169, 'width')
    );
    check(
      codes(r.issues).indexOf('W_ZONE_ASPECT') >= 0 &&
        rectEq(good.zones[0], r.zones[0], 1e-12),
      'D8.' +
        i +
        ' 非法 aspect=' +
        String(bad) +
        ' ⇒ W_ZONE_ASPECT，按设计比例处理'
    );
  });
}
{
  /** 端点反向仍先修再换算（0.8→0.2） */
  const r = normalizeZones(
    [{ id: 'flip', u0: 0.8, v0: 0.9, u1: 0.2, v1: 0.3 }],
    frame(A169, 'width')
  );
  const want = normalizeZones(
    [{ id: 'flip', u0: 0.2, v0: 0.3, u1: 0.8, v1: 0.9 }],
    frame(A169, 'width')
  );
  check(
    r.zones.length === 1 &&
      codes(r.issues).indexOf('W_ZONE_FLIPPED') >= 0 &&
      rectEq(r.zones[0], want.zones[0], 1e-12),
    'D9 端点反向：先交换再投影（与"本来就写对"逐字相同）',
    fmt(r.zones[0])
  );
}
{
  /** 不传 fit ⇒ 保持旧口径（视口分数透传），回归 77 的前提不能破 */
  const r = normalizeZones([{ id: 'z', u0: 0.2, v0: 0.3, u1: 0.4, v1: 0.5 }]);
  check(
    r.zones[0].u0 === 0.2 &&
      r.zones[0].v0 === 0.3 &&
      r.zones[0].u1 === 0.4 &&
      r.zones[0].v1 === 0.5,
    'D10 未传 DesignFit ⇒ u/v 原样透传（纯几何单测路径不变）'
  );
}

/* ══════════════════════════════════════════════════════════════
 * E. 真实 config.json：兜底区仍覆盖全屏
 * ══════════════════════════════════════════════════════════════ */
console.log('\n── E. 真实 config.json：兜底区在各基准下仍覆盖全屏 ──');
{
  let cfg: any = null;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf-8'));
  } catch (e) {
    cfg = null;
  }
  const rawZones = cfg?.touch?.zones;
  if (!rawZones) {
    console.log('  [SKIP] 未读到 ' + CONFIG + ' ⇒ 跳过真实工程比对');
  } else {
    let ok = true;
    let detail = '';
    (
      [
        [A169, 'width'],
        [A169, 'height'],
        [A219, 'width'],
        [A1610, 'height'],
        [A43, 'width'],
      ] as [number, ZoneFit][]
    ).forEach(([a, mode]) => {
      const r = normalizeZones(rawZones, frame(a, mode));
      const errs = r.issues.filter((it) => it.level === 'error');
      const hit1 = r.zones.filter((zz) => zz.id === 'hit1')[0];
      const covers =
        !!hit1 && hit1.u0 <= 0 && hit1.v0 <= 0 && hit1.u1 >= 1 && hit1.v1 >= 1;
      if (errs.length || !covers) {
        ok = false;
        detail =
          mode +
          '@' +
          a.toFixed(3) +
          ' errs=' +
          codes(errs) +
          ' hit1=' +
          (hit1 ? fmt(hit1) : 'missing');
      }
    });
    check(
      ok,
      'E1 hit1（u/v 整屏兜底）在 5 组基准/比例下零 error 且覆盖 [0,1]²',
      detail
    );

    /** design 区随基准移动（与 u/v 同向）—— 说明两者已统一到画布坐标 */
    const handW = normalizeZones(
      rawZones.filter((zz: any) => zz.id === 'hand'),
      frame(A169, 'width')
    ).zones[0];
    const handH = normalizeZones(
      rawZones.filter((zz: any) => zz.id === 'hand'),
      frame(A169, 'height')
    ).zones[0];
    /**
     * `design` 区在两种基准下的差异方向（16:9，`Wd/A = 956 > Hd = 750`）：
     * - 按宽：可见宽 = 1700 ⇒ `kx = 1`、`ky = A/Ad = 0.784`；
     * - 按高：可见宽 = 1333 ⇒ `kx = Ad/A = 1.275`、`ky = 1`。
     * ⇒ 按高时**同一画布点在屏幕上更靠右（u 更大）、更靠上（v 更小）**：
     *   框被放大，而可见框的顶边正好是画布顶边。
     */
    check(
      !!handW &&
        !!handH &&
        handH.u0 > handW.u0 + 1e-3 &&
        handH.v0 < handW.v0 - 1e-3,
      'E2 hand（design 区）：按高比按宽**更靠右且更靠上**（取景整体放大 1.275×）',
      'width=' + fmt(handW) + ' height=' + fmt(handH)
    );
  }
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
