/**
 * 回归：**跑真实模块**（`src/idleSequence.ts` + `src/touch.ts`），不是复刻逻辑。
 *
 * 判据：
 *   A. 序列启用（queueTrack=0）时
 *      A1 触摸最终排在 track 0 并**完整播完**（→ 之前"0 帧未播"的坑不再出现）
 *      A2 触摸播完后**序列自动恢复**（不是卡在触摸末帧）
 *      A3 触摸起始跳变 ≤ 5 单位（显式 mixDuration 生效）
 *      A4 触摸期间"由可见变不可见"的部件数 ≤ 6（基线：59 号脚本实测 5）
 *      A5 track 2 全程无残留（排队模式不该碰 track 2）
 *      A6 连点不会把队列堆起来（闸门有效）
 *   B. 纯 idle（queueTrack 不传）时
 *      B1 触摸叠加在 track 2、完整播完
 *      B2 播完走 `setEmptyAnimation(2, TOUCH_MIX_OUT)` 混出，1s 内 track2 清空（无残留）
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
import { createIdleSequence, IDLE_TRACK } from '../src/idleSequence';
import { createTouchController } from '../src/touch';

/**
 * 骨架文件路径。**不写死本机绝对路径**：命令行第 1 参 > 环境变量 `WK_SKEL` > 相对缺省。
 * 用法见 `_regress/README.md`。
 */
const SKEL = process.argv[2] || process.env.WK_SKEL || 'assets/character.skel';
const FAKE_REGION: any = {
  u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1,
  originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, degreesRotated: false,
};
class DummyLoader {
  private wrap(a: any) { a.region = FAKE_REGION; return a; }
  newRegionAttachment(_s: any, n: string) { return this.wrap(new RegionAttachment(n)); }
  newMeshAttachment(_s: any, n: string) { return this.wrap(new MeshAttachment(n)); }
  newBoundingBoxAttachment(_s: any, n: string) { return new BoundingBoxAttachment(n); }
  newPathAttachment(_s: any, n: string) { return new PathAttachment(n); }
  newClippingAttachment(_s: any, n: string) { return new ClippingAttachment(n); }
}
const binary = new SkeletonBinary(new DummyLoader() as any);
binary.scale = 0.7576;
const sd = binary.readSkeletonData(new Uint8Array(fs.readFileSync(SKEL)) as any);
const ANIM_NAMES: string[] = sd.animations.map((a) => a.name);
const DT = 1 / 30;
const dur = (n: string) => (sd.animations.find((a) => a.name === n)!.duration ?? 0);

// ---------- 断言工具 ----------
let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; } else { fail++; }
  console.log('  [%s] %s%s', ok ? ' OK ' : 'FAIL', label, detail ? '  ' + detail : '');
};

// ---------- 骨架 / 状态 ----------
function newRig() {
  const skeleton = new Skeleton(sd);
  const state = new AnimationState(new AnimationStateData(sd));
  return { skeleton, state };
}
function step(skeleton: any, state: any) { state.update(DT); state.apply(skeleton); skeleton.updateWorldTransform(); }
function world(s: any): number[] {
  const o: number[] = [];
  for (const b of s.bones) o.push(b.worldX, b.worldY);
  return o;
}
function visibleSet(s: any): Set<string> {
  const out = new Set<string>();
  (s.slots as any[]).forEach((sl: any) => {
    if (sl.getAttachment() != null && sl.color.a > 0.01) out.add(sl.data.name);
  });
  return out;
}
const nameOf = (state: any, track: number) => {
  const e = state.tracks[track];
  return e && e.animation ? e.animation.name : '';
};
const depth = (head: any) => { let n = 0, e = head; while (e) { n++; e = e.next; } return n; };

// ---------- 场景 ----------
type Opts = {
  label: string;
  seqEnabled: boolean;
  seqItems?: string[];
  touchAt: number;
  total: number;
  secondClickAt?: number;
  /** 在这一刻调 `seq.dispose()`，验证"销毁后 resume 不该复活序列" */
  disposeAt?: number;
};

function run(opts: Opts) {
  const { skeleton, state } = newRig();
  const meshStub: any = { state };

  // ★ 真实顺序：`SpineAnimator` 构造时先 `setAnimation(0, 'idle', true)`（SpineAnimator.ts:82），
  //   之后 `createIdleSequence` 才用序列条目把它顶掉。
  //   不模拟这一步，`isIdle()` 会因为 track 0 空而判假 ⇒ 叠加模式下触摸被正确拦掉（测得假 FAIL）。
  state.setAnimation(0, 'idle', true);

  const seq = opts.seqEnabled
    ? createIdleSequence(
        { enabled: true, items: opts.seqItems ?? ['touch1', 'touch3', 'chat'], gapMs: 0, startIndex: 0 },
        meshStub,
        { availableAnimations: ANIM_NAMES, entries: [] }
      )
    : null;

  const tc = createTouchController(meshStub, {
    skeletonFile: 'regress',
    idleAnimationName: 'idle',
    extraIdleAnimations: seq ? seq.animationNames() : [],
    touchAnimations: ['touch2'],
    zones: [{ id: 'hit1', u0: 0, v0: 0, u1: 1, v1: 1 } as any],
    touchPool: [],
    random: () => 0,
    queueTrack: seq ? IDLE_TRACK : undefined,
    onActionFinished: (mixSeconds: number) => { if (seq) { seq.resume(mixSeconds); } },
  });

  console.log('\n================ %s ================', opts.label);
  console.log('  序列=%s  触摸=touch2(%ss)  %ss 时点击',
    seq ? (opts.seqItems ?? ['touch1', 'touch3', 'chat']).join('→') : '(未启用)',
    dur('touch2').toFixed(1), String(opts.touchAt));

  const touchTrack = seq ? IDLE_TRACK : 2;
  const frames = Math.round(opts.total / DT);
  const touchFrame = Math.round(opts.touchAt / DT);

  let touchStart = -1, touchEnd = -1, startJump = 0;
  let baseline: Set<string> | null = null;
  const gone = new Set<string>();
  let secondDone = false;
  let depthAtSecond = -1;
  let clicked = false;
  let disposedAt = -1;
  /** 交接窗口里再点一次的结果（`null` = 没测到） */
  let windowClickResult: boolean | null = null;
  let windowTested = false;
  const t0Log: string[] = [];
  let last0 = '';

  for (let f = 0; f < frames; f++) {
    flushTimers(); // 上一帧排的宏任务（setTimeout 0）在下一帧前跑掉

    if (!clicked && f === touchFrame) {
      clicked = true;
      tc.trigger({ actionId: 1, animation: 'touch2', label: 'x' } as any, 'touch');
    }
    if (opts.secondClickAt != null && !secondDone && f === Math.round(opts.secondClickAt / DT)) {
      secondDone = true;
      depthAtSecond = depth(state.tracks[IDLE_TRACK]);
      tc.trigger({ actionId: 1, animation: 'touch2', label: 'x' } as any, 'touch');
    }

    if (opts.disposeAt != null && seq && disposedAt < 0 && f === Math.round(opts.disposeAt / DT)) {
      disposedAt = f;
      seq.dispose();
    }

    const prev = world(skeleton);
    const visBefore = visibleSet(skeleton);
    step(skeleton, state);
    const after = world(skeleton);
    const visAfter = visibleSet(skeleton);

    const now = nameOf(state, touchTrack);
    if (touchStart < 0 && now === 'touch2') {
      touchStart = f;
      baseline = visBefore;
      let mx = 0;
      for (let i = 0; i < sd.bones.length; i++) {
        const d = Math.hypot(after[i * 2] - prev[i * 2], after[i * 2 + 1] - prev[i * 2 + 1]);
        if (d > mx) mx = d;
      }
      startJump = mx;
    }
    if (touchStart >= 0 && baseline) {
      baseline.forEach((n) => { if (!visAfter.has(n)) gone.add(n); });
    }
    if (touchStart >= 0 && touchEnd < 0 && now !== 'touch2') {
      touchEnd = f;
    }

    /**
     * ★ 交接窗口的精确捕捉（只在排队模式）。
     *
     * 窗口 = 「动作已 `complete`（`activeEntry` 空了、`decideAction` 会放行）
     * 但序列还没来得及 `setAnimation` 接管（轨道上仍挂着刚播完的那条动画）」。
     *
     * ⚠️ 别用 `touchEnd` 当信号 —— 它是在**序列已经接手之后**才检测到的
     * （`resume` 的宏任务在下一帧 `flush` 就跑了），那时窗口早过了（实测踩过）。
     */
    if (seq && touchStart >= 0 && !windowTested && !tc.isBusy() && now === 'touch2') {
      windowTested = true;
      windowClickResult = tc.trigger(
        { actionId: 1, animation: 'touch2', label: 'x' } as any,
        'touch'
      );
    }
    const n0 = nameOf(state, 0);
    if (n0 !== last0) { t0Log.push('f' + f + ':' + n0); last0 = n0; }
  }

  const played = touchStart >= 0 ? (touchEnd < 0 ? frames - touchStart : touchEnd - touchStart) : 0;
  const want = Math.round(dur('touch2') / DT);
  const track2 = state.tracks[2] ? nameOf(state, 2) : '';

  console.log('  track0 时间线: %s', t0Log.slice(0, 12).join(' | '));
  console.log('  track2 末态  : %s   pendingTimer=%d', track2 || '(空)', pendingTimers());

  if (seq && opts.disposeAt != null) {
    // C：排队期间销毁 ⇒ 触摸照样播完，但 resume 必须失效，序列不该被复活
    check(touchStart >= 0, 'C1 触摸仍正常排在 track0 并播到', '(起始帧 ' + touchStart + ')');
    check(played >= want - 4, 'C2 触摸完整播完', played + '/' + want + ' 帧');
    check(
      nameOf(state, 0) === 'touch2',
      'C3 dispose 后 resume 失效（序列未被复活）',
      '当前 track0=' + nameOf(state, 0) + '（期望停在 touch2）'
    );
    check(pendingTimers() === 0, 'C4 无残留定时器');
  } else if (seq) {
    check(touchStart >= 0, 'A1 触摸排在 track0 并被播到', '(起始帧 ' + touchStart + ')');
    check(played >= want - 4, 'A1b 触摸完整播完', played + '/' + want + ' 帧');
    check(touchEnd >= 0, 'A2 触摸结束（不是卡住）');
    check(nameOf(state, 0) !== 'touch2', 'A2b 序列已恢复', '当前 track0=' + nameOf(state, 0));
    /**
     * 交接点决定了落差大小：
     *  - 多条序列：交接在**上一动作末帧**（动作收尾姿态稳定）⇒ 很平（实测 2.3）
     *  - 单条序列（loop）：交接在循环点、任意相位，落差天然更大（实测 11.3）；
     *    仍远小于改造前"叠加 + 中途打断"的 134.3，也小于 idle 自身的帧间位移 32.0
     */
    const jumpLimit = (opts.seqItems ?? ['touch1', 'touch3', 'chat']).length === 1 ? 15 : 5;
    check(startJump <= jumpLimit, 'A3 起始跳变 ≤' + jumpLimit, startJump.toFixed(1) + ' 单位');
    check(gone.size <= 6, 'A4 消失部件 ≤6', gone.size + ' 个: ' + Array.from(gone).sort().join(','));
    check(!state.tracks[2], 'A5 track2 无残留');
    if (depthAtSecond >= 0) {
      check(depthAtSecond <= 2, 'A6 连点未堆积', '第二次点击时 track0 链长=' + depthAtSecond);
    }
    check(windowClickResult === false, 'A7 交接窗口内的点击被挡住（不会被丢）',
      '结果=' + String(windowClickResult));
  } else {
    check(touchStart >= 0, 'B1 触摸叠加在 track2 并被播到');
    check(played >= want - 4, 'B1b 触摸完整播完', played + '/' + want + ' 帧');
    check(!state.tracks[2], 'B2 混出收尾后 track2 清空（无残留）', '末态=' + (track2 || '(空)'));
  }
}

console.log('动画时长: ' + ['idle', 'touch1', 'touch2', 'touch3', 'chat', 'greet']
  .map((n) => n + '=' + dur(n).toFixed(2) + 's').join('  '));

// A. 序列启用（排队模式）
run({ label: 'A 序列启用 → 排队模式', seqEnabled: true, touchAt: 2, total: 30, secondClickAt: 3 });
// A2. 单条序列（loop）—— 最容易漏：它不挂 complete，靠 resume 无条件交还
run({ label: 'A2 单条序列(loop) → 排队模式', seqEnabled: true, seqItems: ['touch1'], touchAt: 2, total: 22 });
// B. 纯 idle（叠加模式，行为应与改造前一致）
run({ label: 'B 纯 idle → 叠加模式（行为不变）', seqEnabled: false, touchAt: 2, total: 22 });
// C. 触摸排队期间销毁序列 ⇒ 触摸播完后 resume 不该把序列复活
run({ label: 'C 排队期间 dispose ⇒ resume 失效', seqEnabled: true, touchAt: 2, total: 22, disposeAt: 9 });

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
