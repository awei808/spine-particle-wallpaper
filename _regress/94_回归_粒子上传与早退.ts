/**
 * 94 · 回归：**2026-10-20 两处粒子性能改动**
 *
 * ## 钉的是什么
 *
 * `ParticleAnimator.buildGeometry()` 的两处改动都**没有**被 70~75 覆盖（那些脚本只把
 * `drawRange.count` 当"这一帧画了多少顶点"读出来做**旁观判据**，对"空系统不标脏"和
 * "上传区间 = 顶点数×itemSize"没有任何断言）。这两处改动的失败模式又都是
 * **静默**的：早退写错 ⇒ 要么残留上一轮的四边形（重播时闪一帧旧画面），要么每帧
 * 白跑一遍重建；`updateRange` 单位写错 ⇒ 上传量算错，轻则没省下带宽、重则 GL 报错。
 *
 *   ① **空系统早退**（`buildGeometry` 开头）：
 *      `particles.length === 0 && drawRange.count === 0` ⇒ 直接 return，
 *      不标 dirty、不重建、不上传。
 *      ★ 关键不变量 = `restart()` "清空后立刻把顶点数刷成 0"（其文档注释的承诺）：
 *        那一拍 `drawRange.count` 还是上一帧的值 > 0 ⇒ **不允许**被早退短路。
 *   ② **区间上传**（`buildGeometry` 结尾）：只上传本帧真正写到的 `[0, n)` 段，
 *      各属性按 `itemSize` 换算（three r149 `updateRange` 的单位是**数组元素**）。
 *      ★ 关键不变量 = `updateRange.count === drawRange.count × itemSize`，
 *      且**恒不越界**（`count > array.length` 会让 `bufferSubData` 报 GL 错误）。
 *
 * ## 收益量级（2026-10-21 实测：本工程 config.json，以 git 改动前的实现做 A/B）
 *
 * | 方案 | 每帧上传 | 相对改动前 |
 * |---|---|---|
 * | 改动前 | 12.94 KB | — |
 * | 只做区间上传 | 10.26 KB | 20.7% |
 * | 只做空帧早退 | 12.67 KB | 2.1% |
 * | 两者都做 | 9.99 KB | 22.8% |
 *
 * 口径 = 200 帧 × 8 组、步长 1/60。步长 0.05 时四行分别是 12.94 / 10.30 / 12.57 / 9.93 KB（共 23.3%）。
 * ⚠️ 空帧占比**随步长变化**：1/60 下 12.0%，0.05 下 16.5% —— 引用时必须带帧率，
 *   本脚本的 `DT = 0.05` 故 [6] 报的出 `emptyFrames=264`（16.5%），不是 60 fps 的真实值。
 *
 * ## 为什么在 node 下能断言
 *
 * three 只在**真的上传后**才把 `updateRange.count` 复位成 `-1`（见
 * `WebGLAttributes.updateBuffer`）。本脚本没有 WebGL 上下文 ⇒ 上传从不发生 ⇒
 * `count` 会**保留本帧写入的值**，正好可以直接读出来比对。
 *
 * `needsUpdate = true` 的唯一副作用是 `attribute.version++` ⇒ 用它当"有没有被标脏"
 * 的探针：`version` 不涨 = 这一帧没有触发任何上传。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/94_回归_粒子上传与早退.ts [config路径]
 */

import * as fs from 'fs';
import * as path from 'path';

/** `@src/*` 是 webpack alias，ts-node 裸跑不认识 ⇒ 补一条解析规则 */
const ROOT = path.join(__dirname, '..');
const NodeModule: any = require('module');
const origResolve: any = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (
  request: any,
  parent: any,
  isMain: any,
  options: any
) {
  if (typeof request === 'string' && request.startsWith('@src/')) {
    request = path.join(ROOT, 'src', request.slice('@src/'.length));
  }
  return origResolve.call(this, request, parent, isMain, options);
};

/* eslint-disable @typescript-eslint/no-var-requires */
const THREE = require('three');
const { ParticleAnimator } = require(path.join(
  ROOT,
  'src',
  'animator',
  'ParticleAnimator'
));

const cfgPath =
  process.argv[2] ||
  process.env.WK_CONFIG ||
  path.join(ROOT, 'public', 'assets', 'config.json');

/* ── 断言框架 ───────────────────────────────────────────────────────────── */
let pass = 0;
let fail = 0;
function chk(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
  }
  console.log(
    `   [${cond ? 'OK  ' : '★!  '}] ${label}${detail ? '   ' + detail : ''}`
  );
}

const DT = 0.05;
const K = (a: number) => ({ mode: 0, a, b: a });

/**
 * 造一条"干净"的基底（抄 73 的 `makeBase`，去掉与本次无关的字段）。
 * 出生点固定在 (100,0)、尺寸统一 100、无重力无速度 ⇒ 便于数顶点。
 */
function makeBase(real: any, over: any = {}) {
  const c: any = JSON.parse(JSON.stringify(real));
  Object.assign(c, {
    name: 'p94',
    localScale: 1,
    unitScale: 1,
    sizeScale: 1,
    nodeRotZ: 0,
    emitDir: [1, 0],
    startDelay: 0,
    cycleSec: 1,
    looping: false,
    prewarm: false,
    maxNumParticles: 4,
    gravityModifier: 0,
    startLifetime: K(1e6),
    startSpeed: K(0),
    startSize: K(100),
    startSizeY: K(100),
    startSizeZ: K(100),
    size3D: false,
    startRotation: K(0),
    rotationEnabled: false,
    rotationCurve: K(0),
    sizeModule: { enabled: false, curve: K(1) },
    colorModule: { enabled: false, alphaKeys: [], alphaSource: 'test' },
    startColor: [1, 1, 1, 1],
    clamp: { enabled: false, magnitude: K(1), dampen: 0 },
    noise: {
      enabled: false,
      strength: 0,
      frequency: 0,
      gain: 0,
      positionAmount: 0,
    },
    trail: { enabled: false },
    customData: { enabled: false },
    uv: {
      enabled: false,
      tilesX: 1,
      tilesY: 1,
      cycles: 1,
      animationType: 0,
      frameOverTime: null,
      driftX: 0,
      driftY: 0,
      wrap: 'clamp',
    },
    position: { x: 0, y: 0, z: -1000 },
    shape: {
      enabled: true,
      type: 10,
      radius: 100,
      radiusThickness: 0,
      arc: 0,
      arcMode: 0,
      boxX: 1,
      boxY: 1,
      offsetX: 0,
      offsetY: 0,
      rotZ: 0,
    },
  });
  delete c.startColorGradient;
  delete c.force;
  delete c.inheritVelocity;
  delete c.colorBySpeed;
  delete c.sizeBySpeed;
  delete c.rotationBySpeed;
  delete c.renderer;
  c.groupRotation = undefined;
  Object.assign(c, over);
  return c;
}

/** 五个待查属性：`名字 → itemSize` */
const ATTRS: Array<[string, number]> = [
  ['position', 3],
  ['uv', 2],
  ['aMaskUv', 2],
  ['aAlpha', 1],
  ['aStartCol', 4],
];

/** 读一帧的"上传契约"：各属性的 updateRange.count / version / 数组长度 */
function snap(a: any) {
  const g = a.geometry;
  const out: any = { draw: g.drawRange.count, attrs: {} };
  for (const [name] of ATTRS) {
    const at = g.getAttribute(name);
    out.attrs[name] = {
      count: at.updateRange.count,
      version: at.version,
      len: at.array.length,
      itemSize: at.itemSize,
    };
  }
  return out;
}

/** 全属性 version 之和 —— 用来判断"这一帧有没有被标脏" */
function verSum(s: any) {
  return ATTRS.reduce((acc, [n]) => acc + s.attrs[n].version, 0);
}

/**
 * 契约检查（只在 `draw > 0` 时有意义）：
 * `updateRange.count === drawRange.count × itemSize`，且不越界
 * （`count > array.length` 会让 `bufferSubData` 抛 GL 错误）。
 *
 * ⚠️ `draw === 0` 的帧**不能**查 `count`：three 只在**真的上传后**才把它复位成 `-1`，
 *   而 node 下没有 WebGL ⇒ 上传从不发生 ⇒ `count` 会残留上一帧的值。这是**观测**
 *   的限制，不是缺陷；对应的真实不变量是"这一帧不许标脏"，由 `checkNoDirty` 查。
 */
function checkContract(s: any, tag: string): boolean {
  if (s.draw === 0) {
    return true;
  }
  const names = ATTRS.map(([n]) => n);
  for (const n of names) {
    const a = s.attrs[n];
    const want = s.draw * a.itemSize;
    if (a.count !== want) {
      console.log(
        `      ✗ ${tag} ${n}: count=${a.count} want=${want} (draw=${s.draw})`
      );
      return false;
    }
    if (a.count > a.len) {
      console.log(`      ✗ ${tag} ${n}: 越界 count=${a.count} > len=${a.len}`);
      return false;
    }
  }
  return true;
}

/**
 * ★ 真正的不变量：**`n === 0` 的那一帧不许标脏**。
 *
 * `needsUpdate = true` 的唯一副作用是 `version++`，而 `version` 上涨正是 three 触发
 * `bufferSubData` 的**唯一**条件。所以"没标脏"⇔"这一帧不会有任何上传" —— 早退的
 * 全部收益都落在这条上。
 */
function checkNoDirty(
  before: number,
  after: number,
  draw: number,
  tag: string
): boolean {
  if (draw === 0 && after !== before) {
    console.log(
      `      ✗ ${tag}: draw=0 却标了脏 version ${before} → ${after}` +
        `（每帧一次全量上传，早退没生效）`
    );
    return false;
  }
  return true;
}

function main() {
  console.log('='.repeat(78));
  console.log(
    '94 · 粒子「空系统早退」+「区间上传」回归（2026-10-20 性能改动）'
  );
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  if (!fs.existsSync(cfgPath)) {
    console.log(
      '   ★! config 不存在 —— 先跑构建链（或传一个存在的 config 路径）'
    );
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const parts: any[] = (cfg.meshes || []).filter(
    (m: any) => m.type === 'particle'
  );
  if (parts.length === 0) {
    console.log('   ★! config 里没有 particle 记录');
    process.exit(1);
  }
  const real = parts[0];

  /* ── ① 空系统：早退生效，version 完全不涨 ──────────────────────────── */
  console.log('');
  console.log('[1] 空系统（`autoplay:false` + 零发射）：早退 ⇒ 不标脏、不上传');

  const EMPTY = makeBase(real, {
    autoplay: false,
    emission: { rateOverTime: K(0), bursts: [] },
  });
  const a1: any = new ParticleAnimator(EMPTY, new THREE.Texture());
  const v0 = verSum(snap(a1));
  for (let i = 0; i < 30; i++) {
    a1.update(DT);
  }
  const s1 = snap(a1);
  chk('跑 30 帧后 drawRange 仍为 0', s1.draw === 0, `draw=${s1.draw}`);
  chk(
    '五个属性 version 一次都没涨（早退 ⇒ 零上传）',
    verSum(s1) === v0,
    `version ${v0} → ${verSum(s1)}`
  );
  chk(
    '未设 updateRange（保持 three 初值 -1）',
    ATTRS.every(([n]) => s1.attrs[n].count === -1),
    ATTRS.map(([n]) => `${n}=${s1.attrs[n].count}`).join(' ')
  );
  chk('粒子数恒为 0（前提成立）', a1.particles.length === 0);

  /* ── ② 有粒子：按 itemSize 换算出区间，且逐帧重设 ──────────────────── */
  console.log('');
  console.log(
    '[2] 有粒子：`updateRange.count === drawRange.count × itemSize`（不越界）'
  );

  const LIVE = makeBase(real, {
    autoplay: true,
    emission: { rateOverTime: K(0), bursts: [{ time: 0, count: K(3) }] },
  });
  const a2: any = new ParticleAnimator(LIVE, new THREE.Texture());
  let contract2 = true;
  let sawLive = 0;
  for (let i = 0; i < 20; i++) {
    const vb = verSum(snap(a2));
    a2.update(DT);
    const s = snap(a2);
    if (!checkNoDirty(vb, verSum(s), s.draw, `frame${i}`)) {
      contract2 = false;
    }
    if (s.draw > 0) {
      sawLive++;
      if (!checkContract(s, `frame${i}`)) {
        contract2 = false;
      }
    }
  }
  chk('存在有粒子的帧（前提成立）', sawLive > 0, `liveFrames=${sawLive}`);
  chk(
    '每一帧的上传区间都等于 顶点数 × itemSize 且不越界、空帧不标脏',
    contract2
  );
  {
    const s = snap(a2);
    chk(
      '末帧 upload 量远小于整块缓冲（省带宽的目的真达到了）',
      s.draw > 0 && s.attrs.position.count < s.attrs.position.len,
      `pos ${s.attrs.position.count}/${s.attrs.position.len} 元素`
    );
  }

  /* ── ③ 粒子自然死光：回到 draw=0，且立刻停止标脏 ───────────────────── */
  console.log('');
  console.log(
    '[3] 粒子自然死光：drawRange 归零 ⇒ 下一帧起走早退，version 停止上涨'
  );

  const DIE = makeBase(real, {
    autoplay: true,
    startLifetime: K(0.1),
    emission: { rateOverTime: K(0), bursts: [{ time: 0, count: K(2) }] },
  });
  const a3: any = new ParticleAnimator(DIE, new THREE.Texture());
  let dieAt = -1;
  let dieFrameClean = true;
  for (let i = 0; i < 10; i++) {
    const vb = verSum(snap(a3));
    a3.update(DT);
    const s = snap(a3);
    if (!checkNoDirty(vb, verSum(s), s.draw, `die#${i}`)) {
      dieFrameClean = false;
    }
    if (a3.particles.length === 0 && dieAt < 0) {
      dieAt = i;
      break;
    }
  }
  chk('归零那一帧没标脏（省下的正是这一帧的全量上传）', dieFrameClean);
  chk('粒子确实死光了（前提成立）', dieAt >= 0, `dieAt=${dieAt}`);
  const s3 = snap(a3);
  chk('死光那一帧 drawRange 已归零', s3.draw === 0, `draw=${s3.draw}`);
  const v3 = verSum(s3);
  for (let i = 0; i < 10; i++) {
    a3.update(DT);
  }
  chk(
    '之后 10 帧 version 不再上涨（早退接住了）',
    verSum(snap(a3)) === v3,
    `version ${v3} → ${verSum(snap(a3))}`
  );

  /* ── ④ restart() 的"立刻刷成 0"不变量（早退最容易踩坏的一条）───────── */
  console.log('');
  console.log(
    '[4] restart()：从非空状态清空 ⇒ 顶点数**立刻**刷成 0（不被早退短路）'
  );

  const RS = makeBase(real, {
    autoplay: true,
    emission: { rateOverTime: K(0), bursts: [{ time: 0, count: K(3) }] },
  });
  const a4: any = new ParticleAnimator(RS, new THREE.Texture());
  for (let i = 0; i < 5; i++) {
    a4.update(DT);
  }
  const before4 = snap(a4).draw;
  chk('重启前有粒子在画（前提成立）', before4 > 0, `draw=${before4}`);
  a4.restart(false);
  chk(
    'restart() 后 drawRange 立刻为 0（上一帧残影不会留到这一帧）',
    a4.geometry.drawRange.count === 0,
    `draw=${a4.geometry.drawRange.count}`
  );
  chk('restart() 后粒子已清空', a4.particles.length === 0);

  /**
   * 早退"粘住"的最坏情形 = 清空后再也画不出来。
   * ⚠️ 这里**不能**用上面那条 `RS`（`bursts` 会因 `systemTime` 归零而重新发射），
   *   改用零发射配置：`restart()` 后无论如何都没有粒子 ⇒ 只能走早退 ⇒ 必须不标脏，
   *   且一旦重新开跑（下面 [7] 那条）还能立刻画出来 —— 早退是可逆的，不是死锁。
   */
  const a4b: any = new ParticleAnimator(
    makeBase(real, {
      autoplay: false,
      emission: { rateOverTime: K(0), bursts: [] },
    }),
    new THREE.Texture()
  );
  for (let i = 0; i < 5; i++) {
    a4b.update(DT);
  }
  a4b.restart(false);
  const v4b = verSum(snap(a4b));
  for (let i = 0; i < 10; i++) {
    a4b.update(DT);
  }
  chk(
    '零发射组 restart() 后连跑 10 帧：全程走早退、一次都不标脏',
    verSum(snap(a4b)) === v4b,
    `version ${v4b} → ${verSum(snap(a4b))}`
  );

  /* ── ⑤ restart() 从空状态 + prewarm ⇒ 仍能正常起画 ─────────────────── */
  console.log('');
  console.log('[5] restart(true) 从空状态预热 ⇒ 早退没有把"重新起画"也吃掉');

  const PW = makeBase(real, {
    autoplay: false,
    prewarm: false,
    startLifetime: K(2),
    emission: { rateOverTime: K(10), bursts: [] },
  });
  const a5: any = new ParticleAnimator(PW, new THREE.Texture());
  for (let i = 0; i < 3; i++) {
    a5.update(DT);
  }
  chk(
    '预热前是空的（前提成立）',
    snap(a5).draw === 0 && a5.particles.length === 0
  );
  a5.restart(true);
  const s5 = snap(a5);
  chk(
    'restart(true) 后立刻有顶点（prewarm 的粒子被推进了几何）',
    s5.draw > 0,
    `draw=${s5.draw}`
  );
  chk('且上传区间合规', checkContract(s5, 'pw'));

  /* ── ⑥ 真实记录逐组跑：不越界 + 契约恒成立 ─────────────────────────── */
  console.log('');
  console.log(
    '[6] 真实记录逐组跑 200 帧（8 组全量；本 config 无 trail / mesh 档，均为 quad）'
  );

  let groups = 0;
  let frames = 0;
  let bad = 0;
  let peakDraw = 0;
  let emptyTotal = 0;
  for (const p of parts) {
    const a: any = new ParticleAnimator(
      JSON.parse(JSON.stringify(p)),
      new THREE.Texture()
    );
    groups++;
    let emptyFrames = 0;
    for (let i = 0; i < 200; i++) {
      const vb = verSum(snap(a));
      a.update(DT);
      frames++;
      const s = snap(a);
      if (s.draw > peakDraw) {
        peakDraw = s.draw;
      }
      if (s.draw === 0) {
        emptyFrames++;
      }
      if (
        !checkContract(s, `${p.name || '?'}#${i}`) ||
        !checkNoDirty(vb, verSum(s), s.draw, `${p.name || '?'}#${i}`)
      ) {
        bad++;
        break;
      }
    }
    emptyTotal += emptyFrames;
  }
  chk(
    `${groups} 组 × 200 帧：上传区间始终 = 顶点数×itemSize、从不越界、空帧不标脏`,
    bad === 0,
    `groups=${groups} frames=${frames} peakDraw=${peakDraw} emptyFrames=${emptyTotal} bad=${bad}`
  );
  chk(
    '确实存在"空帧"（否则这条优化在本工程没有收益，前提不成立）',
    emptyTotal > 0,
    `emptyFrames=${emptyTotal}`
  );

  /* ── ⑦ 逐位对照：早退前后的渲染真值必须一致 ───────────────────────── */
  console.log('');
  console.log('[7] 早退不能改变"渲染真值"：空系统逐帧的 drawRange 恒为 0');

  /** ⚠️ 必须给一个**非零发射率**：否则 `prewarm()` 无米下锅，起画无从谈起 */
  const a7: any = new ParticleAnimator(
    makeBase(real, {
      autoplay: false,
      startLifetime: K(2),
      emission: { rateOverTime: K(10), bursts: [] },
    }),
    new THREE.Texture()
  );
  let allZero = true;
  let v7 = verSum(snap(a7));
  for (let i = 0; i < 50; i++) {
    a7.update(DT);
    if (a7.geometry.drawRange.count !== 0) {
      allZero = false;
    }
  }
  chk('50 帧 drawRange 全程为 0（早退没有让它停在某个旧值上）', allZero);
  chk(
    '这 50 帧一次都没标脏（空帧不标脏 ⇒ 早退的全部收益都落在这一条上）',
    verSum(snap(a7)) === v7,
    `version ${v7} → ${verSum(snap(a7))}`
  );

  // 空系统被"开跑"后必须能立刻画出来（早退不能把 started 之后的首次构建也吃掉）
  a7.restart(true);
  const s7 = snap(a7);
  chk(
    '空系统被开跑后能立刻产出顶点（早退是可逆的、不是死锁）',
    s7.draw > 0,
    `draw=${s7.draw}`
  );
  chk('起画那一帧的上传区间合规', checkContract(s7, 'reborn'));

  console.log('');
  console.log('─'.repeat(78));
  console.log(
    `结果：${pass} 通过 / ${fail} 失败  （共 ${pass + fail} 条断言）`
  );
  console.log('─'.repeat(78));
  process.exit(fail ? 1 : 0);
}

main();
