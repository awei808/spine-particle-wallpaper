/**
 * 回归：**播放动作事件时的触摸反馈四模式**（2026-10-08 新增，10-09 补 legacy + 改缺省）跑真实模块。
 *
 * 67 号脚本验的是**纯判定**（`decideAction` 这张表）与**配置链路**；本脚本验的是真正的
 * **播放行为** —— 走的是 `src/touch.ts` + spine runtime，骨架是真解出来的（与 60 号同一套脚手架）。
 *
 * ## 判据（叠加模式 = 纯 idle，未启用常驻序列）
 *
 *   A. `'queue'`：重要的不是在播放结束后要发生什么，而是**当前这条必须完整演完**
 *      A1 第一次点击 ⇒ 立刻播（`trigger` 返回 true）
 *      A2 第二次点击 ⇒ **本次不播**（返回 false）、但被记进待播槽（`queuedCount === 1`）
 *      A3 第一条**完整演完**（帧数与资源时长一致，没被掐断）
 *      A4 第一条演完后，待播那条**自动接上**（firedCount = 2）
 *      A5 待播槽容量 = 1 ⇒ 连点三次，队列长度**不超过 1**（不会攒一串让你等到天荒地老）
 *
 *   B. `'none'`：正在播时点击 ⇒ 第二次**既没播也没入队**，且只被计一次 `skipped`
 *   C. `'immediate'`：第二次点击 ⇒ **当场重放**（返回 true），拼起来的播放次数 = 2
 *   D. `'legacy'`（**缺省**）：分两半验 ——
 *      D2/D5 正在演**触摸动作**时点击 ⇒ 忽略（返回 false，计 skipped）= 改动前口径；
 *      D8/D9 正在演**问候**时点击 ⇒ 照样打断并立刻改播（返回 true，不计 skipped）
 *
 * ## 为什么只测叠加模式
 *
 * 排队模式（启用常驻序列）下 `'queue'` / `'immediate'` 都直接落在 spine 自己的
 * track 队列上（见 `touch.ts` 文件头），那条路径 60 号脚本已经守住（A6 连点不堆积）。
 * ★ 本脚本补的是**叠加模式那套自研待播槽**，以及四档在叠加模式下的真实手感。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/68_回归_触摸反馈三模式.ts [骨架路径]
 * （路径解析规则见 `_regress/README.md`）
 */
import './polyfill';
import * as fs from 'fs';

import { SkeletonBinary } from 'threejs-spine-3.8-runtime-es6/core/src/SkeletonBinary';
import { Skeleton } from 'threejs-spine-3.8-runtime-es6/core/src/Skeleton';
import { AnimationState } from 'threejs-spine-3.8-runtime-es6/core/src/AnimationState';
import { AnimationStateData } from 'threejs-spine-3.8-runtime-es6/core/src/AnimationStateData';
import { RegionAttachment } from 'threejs-spine-3.8-runtime-es6/core/src/attachments/RegionAttachment';
import { MeshAttachment } from 'threejs-spine-3.8-runtime-es6/core/src/attachments/MeshAttachment';
import { BoundingBoxAttachment } from 'threejs-spine-3.8-runtime-es6/core/src/attachments/BoundingBoxAttachment';
import { PathAttachment } from 'threejs-spine-3.8-runtime-es6/core/src/attachments/PathAttachment';
import { ClippingAttachment } from 'threejs-spine-3.8-runtime-es6/core/src/attachments/ClippingAttachment';

import { flushTimers, pendingTimers } from './polyfill';
import { createTouchController, TOUCH_QUEUE_MAX } from '../src/touch';
import { TouchFeedbackMode } from '../src/config.type';

/**
 * 骨架文件路径。**不写死本机绝对路径**：命令行第 1 参 > 环境变量 `WK_SKEL` > 相对缺省。
 * 用法见 `_regress/README.md`。
 */
const SKEL = process.argv[2] || process.env.WK_SKEL || 'assets/character.skel';

const FAKE_REGION: any = {
  u: 0,
  v: 0,
  u2: 1,
  v2: 1,
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
  offsetX: 0,
  offsetY: 0,
  degreesRotated: false,
};
class DummyLoader {
  private wrap(a: any) {
    a.region = FAKE_REGION;
    return a;
  }
  newRegionAttachment(_s: any, n: string) {
    return this.wrap(new RegionAttachment(n));
  }
  newMeshAttachment(_s: any, n: string) {
    return this.wrap(new MeshAttachment(n));
  }
  newBoundingBoxAttachment(_s: any, n: string) {
    return new BoundingBoxAttachment(n);
  }
  newPathAttachment(_s: any, n: string) {
    return new PathAttachment(n);
  }
  newClippingAttachment(_s: any, n: string) {
    return new ClippingAttachment(n);
  }
}
const binary = new SkeletonBinary(new DummyLoader() as any);
binary.scale = 0.7576;
const sd = binary.readSkeletonData(
  new Uint8Array(fs.readFileSync(SKEL)) as any
);
const DT = 1 / 30;
const dur = (n: string): number =>
  sd.animations.find((a) => a.name === n)!.duration ?? 0;

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

const step = (state: any, skeleton: any): void => {
  state.update(DT);
  state.apply(skeleton);
  skeleton.updateWorldTransform();
};
const nameOf = (state: any, track: number): string => {
  const e = state.tracks[track];
  return e && e.animation ? e.animation.name : '';
};

/** 造一套 controller（叠加模式 = 不传 `queueTrack`）。`mode` 不传 ⇒ 走 `touch.ts` 的缺省档 */
function makeRig(mode?: TouchFeedbackMode) {
  const skeleton = new Skeleton(sd);
  const state = new AnimationState(new AnimationStateData(sd));
  state.setAnimation(0, 'idle', true); // 与真实装配顺序一致（见 60 号脚本的注释）
  const tc = createTouchController({ state, skeleton } as any, {
    skeletonFile: 'regress',
    idleAnimationName: 'idle',
    touchAnimations: ['touch2'],
    zones: [{ id: 'hit1', u0: 0, v0: 0, u1: 1, v1: 1 } as any],
    touchPool: [],
    random: () => 0,
    touchFeedbackMode: mode,
  });
  return { skeleton, state, tc };
}

/**
 * 跑一个场景。**叠加模式**（不传 `queueTrack`），因为常驻序列那套由 60 号守住。
 *
 * @param mode          触摸反馈模式
 * @param clickSeconds  依次在这些时刻模拟一次热区点击
 */
function run(mode: TouchFeedbackMode, clickSeconds: number[], total: number) {
  const { skeleton, state, tc } = makeRig(mode);

  const frame = (sec: number): number => Math.round(sec / DT);
  const results: boolean[] = [];
  let playStart = -1;
  let playEnd = -1;
  let lastQueued = 0;

  for (let f = 0; f < Math.round(total / DT); f++) {
    flushTimers(); // 待播那条排的宏任务要在下一帧前跑掉（同 60 号）
    if (clickSeconds.indexOf(Math.round(f * DT * 100) / 100) >= 0) {
      results.push(
        tc.trigger(
          { actionId: 1, animation: 'touch2', label: 'x' } as any,
          'touch'
        )
      );
    }
    step(state, skeleton);
    const now = nameOf(state, 2);
    if (playStart < 0 && now === 'touch2') {
      playStart = f;
    }
    if (playStart >= 0 && playEnd < 0 && now !== 'touch2') {
      playEnd = f;
    }
    lastQueued = tc.snapshot().queuedCount;
  }

  return {
    results,
    snap: tc.snapshot(),
    /** 第一条演了多久（帧） */
    firstFrames:
      playStart < 0
        ? 0
        : playEnd < 0
        ? Math.round(total / DT) - playStart
        : playEnd - playStart,
    wantFrames: Math.round(dur('touch2') / DT),
    lastQueued,
    disposeLeak: (() => {
      tc.dispose();
      return pendingTimers();
    })(),
  };
}

console.log(
  '\n动画时长: ' +
    ['idle', 'touch1', 'touch2', 'touch3', 'chat', 'greet']
      .map((n) => n + '=' + dur(n).toFixed(2) + 's')
      .join('  ')
);

/* ── A. queue：当前这条演完，待播自动接上 ─────────────────── */
console.log('\n================ A queue（排进播放队列） ================');
{
  const r = run('queue', [2, 5], 20);
  check(
    r.results.length === 2,
    'A0 两次点击都被收到（没有被 onerror 吞掉）',
    JSON.stringify(r.results)
  );
  check(r.results[0] === true, 'A1 第一次点击 ⇒ 立刻播', String(r.results[0]));
  check(
    r.results[1] === false,
    'A2 ★第二次点击 ⇒ 本次**不播**（排到队里）',
    String(r.results[1])
  );
  check(
    r.firstFrames >= r.wantFrames - 4,
    'A3 ★第一条**完整演完**（没被掐断）',
    r.firstFrames + '/' + r.wantFrames + ' 帧'
  );
  check(
    r.snap.firedCount === 2,
    'A4 ★队里那条自动接上了（共播 2 条）',
    'firedCount=' + r.snap.firedCount
  );
  check(
    r.disposeLeak === 0,
    'A5 dispose 后无残留 定时器',
    'pendingTimers=' + r.disposeLeak
  );
}

console.log(
  '\n================ A2 queue：连点不堆积（容量 ' +
    TOUCH_QUEUE_MAX +
    '） ================'
);
{
  const r = run('queue', [2, 3, 4, 5], 24);
  check(
    r.results.slice(1).every((v) => v === false),
    'A2-1 演出期间的点击都不当场播',
    JSON.stringify(r.results)
  );
  check(
    r.lastQueued <= TOUCH_QUEUE_MAX,
    'A2-2 ★连点 3 次 ⇒ 队列不超过 ' + TOUCH_QUEUE_MAX + ' 条（不攒一串）',
    'queuedCount=' + r.lastQueued
  );
  check(
    r.snap.firedCount <= 2,
    'A2-3 ★实际只多播了 1 条（多余的点击被丢掉而不是排队）',
    'firedCount=' + r.snap.firedCount
  );
}

/* ── B. none：演出期间点击完全无反馈 ─────────────────────── */
console.log('\n================ B none（不做任何反馈） ================');
{
  const r = run('none', [2, 5], 20);
  check(r.results[0] === true, 'B1 第一次点击 ⇒ 播', String(r.results[0]));
  check(
    r.results[1] === false,
    'B2 ★第二次点击 ⇒ 不播也不入队',
    String(r.results[1])
  );
  check(r.lastQueued === 0, 'B3 队列恒为空', 'queuedCount=' + r.lastQueued);
  check(
    r.snap.firedCount === 1,
    'B4 总共只播了 1 条（第 2 次点击没产生任何动作）',
    'firedCount=' + r.snap.firedCount
  );
  check(
    r.snap.skippedCount === 1,
    'B5 ★被吞的那次点了有计数（便于观测"用户点了没反应"）',
    'skippedCount=' + r.snap.skippedCount
  );
}

/* ── C. immediate：当场重放 ──────────────────────── */
console.log(
  '\n================ C immediate（立即播放新动作） ================'
);
{
  const r = run('immediate', [2, 5], 20);
  check(r.results[0] === true, 'C1 第一次点击 ⇒ 播', String(r.results[0]));
  check(
    r.results[1] === true,
    'C2 ★第二次点击 ⇒ **当场重放**（与改动前的"忽略"不同）',
    String(r.results[1])
  );
  check(
    r.lastQueued === 0,
    'C3 不入队（当场就播了）',
    'queuedCount=' + r.lastQueued
  );
  check(
    r.snap.firedCount === 2,
    'C4 共播 2 条',
    'firedCount=' + r.snap.firedCount
  );
}

/* ── D. legacy（缺省）：旧口径 —— 触摸在演忽略点击、问候/聊天在演被打断 ── */
console.log(
  '\n================ D legacy（仅问候/聊天时立即，**缺省档**） ================'
);
{
  // 显式传 'legacy'
  const r = run('legacy', [2, 5], 20);
  check(r.results[0] === true, 'D1 空闲时点击 ⇒ 播', String(r.results[0]));
  check(
    r.results[1] === false,
    'D2 ★正在演触摸动作时点击 ⇒ 忽略（= 改动前的 skip）',
    String(r.results[1])
  );
  check(
    r.snap.firedCount === 1 && r.snap.skippedCount === 1,
    'D3 ★只播了 1 条、且被吞的点击有计数',
    'fired=' + r.snap.firedCount + ' skipped=' + r.snap.skippedCount
  );
  check(r.lastQueued === 0, 'D4 不入队', 'queuedCount=' + r.lastQueued);
}
{
  // ★ 不传 touchFeedbackMode ⇒ 与 'legacy' 同（旧调用方与改动前完全同行为）
  //
  // ⚠️ 这里必须用 `tc.trigger` 起第一条，**不能**直接 `state.setAnimation(2, …)`：
  //    控制器只认自己播过的动作（`activeEntry`/`activeSource` 是它的私有状态），
  //    绕过它去改轨道 ⇒ 闸门看到的是"没有在播" ⇒ 恒判 play（本脚本初版就踩了这个自摆乌龙）。
  const { state, skeleton, tc } = makeRig();
  const first = tc.trigger(
    { actionId: 1, animation: 'touch2', label: 'x' } as any,
    'touch'
  );
  step(state, skeleton);
  const again = tc.trigger(
    { actionId: 1, animation: 'touch2', label: 'x' } as any,
    'touch'
  );
  check(first === true, 'D5a 先播一条触摸动作', String(first));
  check(
    again === false,
    'D5 ★缺省档 == legacy（不传字段时，"触摸在演再点击"被忽略）',
    String(again)
  );
  check(
    tc.snapshot().skippedCount === 1,
    'D6 该次点击计为 skipped（探针可观测）',
    'skipped=' + tc.snapshot().skippedCount
  );
  tc.dispose();
}
{
  // ★ legacy 的另一半：正在演**问候**时点击 ⇒ 打断并立刻播新的（旧口径）
  const { state, skeleton, tc } = makeRig();
  const greetOn = tc.trigger(
    { actionId: 1, animation: 'greet', label: 'greet' } as any,
    'greet'
  );
  step(state, skeleton);
  const before = nameOf(state, 2);
  const again = tc.trigger(
    { actionId: 1, animation: 'touch2', label: 'x' } as any,
    'touch'
  );
  check(greetOn === true && before === 'greet', 'D7 先播一条问候', before);
  check(
    again === true,
    'D8 ★legacy：正在演问候时点击 ⇒ 立刻改播新的（沿用旧口径，与 immediate 相同）',
    String(again)
  );
  check(
    tc.snapshot().skippedCount === 0,
    'D9 这次不算"被吞"（没计 skipped）',
    'skipped=' + tc.snapshot().skippedCount
  );
  tc.dispose();
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
