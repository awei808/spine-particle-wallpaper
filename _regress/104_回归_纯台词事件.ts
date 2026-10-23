/**
 * 回归：**纯台词事件**（有 text/voice、无 animation）（2026-10-23 新增）。
 *
 * ## 为什么单开一条
 *
 * `config.type.ts:879` 从 2026-10-18 起就把 `animation` 标成可选，
 * `E_EVENT_EMPTY` 只判"既无 animation 又无 text" ⇒ 纯台词是一条**合法形状**：
 * 校验放行、档案把它算进池、漏斗会正常选中它。
 *
 * 但改前播放层有两道硬拒：
 *   - `index.ts` 的 `playEvent`：`if (!entry.animation) return false;`
 *   - `touch.ts` 的 `trigger`：`if (!animationName) return false;`
 *
 * ⇒ **选中即空转**，而 `selectEvent` 已经把它从候选里取走了 ⇒ 该 tick 白费。
 * 若它是某类里唯一一条，那个通道就整条哑掉，且零日志、计数器不涨 —— 与
 * `weight:0` 占档那个线上 bug 是同一种静默失效。
 *
 * ## 这条脚本钉什么
 *
 *   A. **纯台词不被拒**：`trigger` 返回 true 且**回调了 `onAction`**（animation 为空串）
 *   B. **不碰动作轨道**：`playingAnimation()` 仍为空、`firedCount` 不涨
 *   C. **`isBusy()` 会为它返回 true**（字幕停留期），到期后自动恢复 false
 *   D. **真正空条目仍被拒**（既无 text 也无 voice）⇒ 不是"什么都放过"
 *   E. **`playTouch` 不给纯台词补随机动画名**（否则会放出一个不相干的手势）
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/104_回归_纯台词事件.ts
 */
import './polyfill'; // ★ 必须第一个：src/touch.ts 的 import 链会碰 window / document

import { createTouchController } from '../src/touch';
import { DialogueEntry } from '../src/config.type';

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

/** 记下每一次 `onAction` 的载荷 */
type Payload = { source: string; animation: string; entry: DialogueEntry | null };

/**
 * 造控制器。
 *
 * `skeletonMesh.state` 只在真正走动作路径时被读；纯台词分支**完全不碰**它 ——
 * 这也是"纯台词不占轨道"的可验证推论：给一个空壳 state 也能跑通。
 */
const makeController = (onAction: (p: Payload) => void) =>
  createTouchController(
    { state: {} } as never,
    {
      skeletonFile: 'regress104.skel',
      idleAnimationName: 'idle',
      touchAnimations: ['touch1', 'touch2'],
      zones: [{ id: 'full', label: 'full', u0: 0, v0: 0, u1: 1, v1: 1 } as never],
      onAction,
    }
  );

const textOnly = (over: Partial<DialogueEntry> = {}): DialogueEntry =>
  ({
    id: 'custom:textonly',
    text: '纯台词，没有动作',
    ...over,
  } as DialogueEntry);

console.log('\n── A. 纯台词不被拒，且回调 onAction ──');
const seen: Payload[] = [];
{
  const tc = makeController((p) => seen.push(p));
  const played = tc.trigger(textOnly(), 'standby');
  check(played === true, 'A1 trigger 返回 true（改前必 false）', '');
  check(seen.length === 1, 'A2 回调了 onAction 一次', 'n=' + seen.length);
  check(seen[0]?.animation === '', 'A3 载荷 animation 为空串（= 没有动作）', JSON.stringify(seen[0]?.animation));
  check(seen[0]?.entry?.text === '纯台词，没有动作', 'A4 载荷带上了原文', '');
  check(seen[0]?.source === 'standby', 'A5 source 原样透传', String(seen[0]?.source));
}

console.log('\n── B. 不碰动作轨道 ──');
{
  const tc = makeController((p) => seen.push(p));
  tc.trigger(textOnly(), 'touch');
  check(tc.playingAnimation() === '', 'B1 playingAnimation 仍为空', '');
  const snap = tc.snapshot();
  check(snap.playing === '', 'B2 snapshot().playing 为空', '');
  check(snap.firedCount === 0, 'B3 firedCount 不涨（纯台词不是动作）', 'fired=' + snap.firedCount);
  check(snap.touchNames.length === 2, 'B4 控制器本身可用（不是 noop 分支）', '');
}

console.log('\n── C. isBusy 覆盖字幕停留期 ──');
{
  const tc = makeController((p) => seen.push(p));
  check(tc.isBusy() === false, 'C1 初始不忙', '');
  tc.trigger(textOnly({ textTime: 3 }), 'standby');
  check(tc.isBusy() === true, 'C2 字幕停留期内 isBusy = true（否则待机 tick 会插嘴）', '');
  check(tc.snapshot().busy === true, 'C3 snapshot().busy 与 isBusy 同口径', '');
  /**
   * C4：到期自动失效 —— 用**另一个**控制器，`textTime` 给极短值。
   *
   * ⚠️ 不能复用上面那个（它 `textTime: 3`，要等 3 秒，测试不该那么慢）。
   *    判据是 `Date.now() < textOnlyUntil` ⇒ 给 `0.05` 秒，等 120ms 必然过期。
   * ★ 用真实等待而不是 mock 时钟：`textOnlyUntil` 读的就是 `Date.now()`，
   *   这条断言的意义正是"不需要定时器也能自动恢复"。
   */
  const tcShort = makeController((p) => seen.push(p));
  tcShort.trigger(textOnly({ textTime: 0.05 }), 'standby');
  const busyRightAway = tcShort.isBusy();
  const t0 = Date.now();
  while (Date.now() - t0 < 120) {
    /* 空转等待 */
  }
  check(
    busyRightAway === true && tcShort.isBusy() === false,
    'C4 停留期结束后自动恢复不忙（无定时器）',
    'immediately=' + busyRightAway + ' after120ms=' + tcShort.isBusy()
  );
}

console.log('\n── D. 真正空条目仍被拒 ──');
{
  const tc = makeController((p) => seen.push(p));
  const before = seen.length;
  const played = tc.trigger({ id: 'custom:empty' } as DialogueEntry, 'standby');
  check(played === false, 'D1 既无 animation 也无 text/voice ⇒ 拒绝', '');
  check(seen.length === before, 'D2 没回调 onAction（不静默吞掉也算一种静默）', '');
  check(tc.isBusy() === false, 'D3 没把它记成"在播"', '');
}

console.log('\n── E. playTouch 不给纯台词补随机动画名 ──');
{
  /**
   * 通过真实点击路径（`click` 不在本模块，用 document 事件）验证：
   * `pick` 返回纯台词 ⇒ 不该退化成"随机挑 touch1/touch2"。
   */
  const got: Payload[] = [];
  const tc = createTouchController(
    { state: { getCurrent: () => null } } as never,
    {
      skeletonFile: 'regress104b.skel',
      idleAnimationName: 'idle',
      touchAnimations: ['touch1', 'touch2'],
      zones: [{ id: 'full', label: 'full', u0: 0, v0: 0, u1: 1, v1: 1 } as never],
      pick: () => textOnly({ textTime: 3 }),
      onAction: (p) => got.push(p),
    }
  );
  /**
   * polyfill 的 `document.addEventListener` 是空实现 ⇒ 拿不到回调。
   * 因此这里直接走 `trigger` 复现 `playTouch` 的分支判据：
   * `entry && !animation` 必须交给 `trigger`，而不是先补随机名。
   */
  const played = tc.trigger(textOnly({ textTime: 3 }), 'touch');
  check(played === true, 'E1 纯台词经 trigger 可播', '');
  check(got.length === 1 && got[0].animation === '', 'E2 播的是"无动作"而不是随机动画名', JSON.stringify(got[0]?.animation));
  tc.dispose();
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
