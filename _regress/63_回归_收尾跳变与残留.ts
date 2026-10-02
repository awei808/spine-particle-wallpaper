/**
 * 回归 63：**动作收尾的"跳变"与"通道残留"**（2026-09-28）
 *
 * 跑的是真实模块 `src/touch.ts` + 真实 `.skel`（不是复刻逻辑）。
 *
 * 背景（用户报的两个现象）：
 *   ① 动作结束后回到默认待机时，人物图层会有一帧突兀变化
 *   ② 待机 chat 正在播、嘴型在动时点击触摸 ⇒ 嘴型固定不变
 * 根因（`_regress/61|62` 已取证）：
 *   `clearTrack(2)` 是瞬间移除；而 threejs-spine 的 `SkeletonMesh.update()`
 *   从不 `setToSetupPose()`，`AnimationState.apply()` 只写"在播动画拥有的通道"
 *   ⇒ ① 骨骼从触摸末帧瞬间跳到 idle 当前相位；② chat 独占通道停在 chat 末帧。
 *
 * 判据：
 *   A. 打断场景（chat 播到中途 → 点击触摸）：
 *      A1 触摸动作完整播完
 *      A2 ★ chat 独占通道**全部回到 setup pose**（修前 4/4 残留）
 *      A3 track 2 最终清空
 *   B. 自然播完场景（chat 播完 → 自动收尾）：
 *      B1 ★ 收尾那一帧的骨位移 ≤ 25（修前 154.2，修后实测 19.2；idle 稳态仅 3.7）
 *      B2 ★ chat 独占通道全部回到 setup pose
 *      B3 收尾后 track 2 被清空（`<empty>` 不留残）
 *   C. touch2 / touch3 同样过一遍 A 的判据（用户说"特定的触摸动作"）
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
const sd: any = binary.readSkeletonData(new Uint8Array(fs.readFileSync(SKEL)) as any);
const DT = 1 / 30;
const steps = (sec: number) => Math.max(0, Math.round(sec / DT));
const dur = (n: string) => (sd.animations.find((a: any) => a.name === n)?.duration ?? 0);
const TOUCHES = ['touch1', 'touch2', 'touch3'];

// ---------- 断言工具 ----------
let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) pass++; else fail++;
  console.log('  [%s] %s%s', ok ? ' OK ' : 'FAIL', label, detail ? '  ' + detail : '');
};

// ---------- setup pose 基准 ----------
const R3 = (v: number) => Number(v.toFixed(3));
const boneVals = (sk: any): Map<string, string> => {
  const m = new Map<string, string>();
  (sk.bones as any[]).forEach((b: any) => {
    m.set(b.data.name, [R3(b.rotation), R3(b.x), R3(b.y), R3(b.scaleX), R3(b.scaleY)].join(','));
  });
  return m;
};
const slotVals = (sk: any): Map<string, string> => {
  const m = new Map<string, string>();
  (sk.slots as any[]).forEach((sl: any) => {
    const at = sl.getAttachment();
    const def = at && at.vertices
      ? Array.from(at.vertices as number[]).slice(0, 6).map((v: number) => R3(v)).join('/')
      : '';
    m.set(sl.data.name, (at ? String(at.name) : '(null)') + '|a=' + R3(sl.color.a) + '|d=' + def);
  });
  return m;
};
const setupSk = new Skeleton(sd);
const SETUP_BONES = boneVals(setupSk);
const SETUP_SLOTS = slotVals(setupSk);

// ---------- chat 独占通道（自动推导，避免硬编码漂移）----------
const tag = (t: any) => {
  const c = String(t.constructor?.name ?? '').replace(/Timeline$/, '');
  const tgt = typeof t.slotIndex === 'number' ? 'slot:' + sd.slots[t.slotIndex].name
    : typeof t.boneIndex === 'number' ? 'bone:' + sd.bones[t.boneIndex].name : 'global';
  return c + '@' + tgt;
};
const chanOf = (n: string) => {
  const a = sd.animations.find((x: any) => x.name === n);
  const s = new Set<string>();
  if (a) for (const t of a.timelines) s.add(tag(t));
  return s;
};
/**
 * ★ 口径必须**按具体触摸动作分别算**（2026-09-28 修正）：
 *   "chat 有、idle 没有、**这一个**触摸动作也没有"的通道，才是这次收尾真正会残留的。
 *   实测差异真实存在（见 `_regress/62` 输出）：
 *   `Rotate@bone93`、`Rotate@bone94`、`Scale@bone93` 在 touch2 / touch3 里**被覆盖**，
 *   只有 touch1 缺 ⇒ 用户说的"**特定的**触摸动作会卡住"由此得名。
 */
const chatOnlyFor = (touch: string) => {
  const cov = new Set<string>([...chanOf('idle'), ...chanOf(touch)]);
  return [...chanOf('chat')].filter((c) => !cov.has(c));
};
const bonesOf = (chs: string[]) => new Set(
  chs.filter((c) => c.includes('@bone:')).map((c) => c.split('@bone:')[1]));
const slotsOf = (chs: string[]) => new Set(
  chs.filter((c) => c.includes('@slot:')).map((c) => c.split('@slot:')[1]));

console.log('=== chat 独占通道（按触摸动作分别计算）===');
TOUCHES.forEach((t) => {
  const chs = chatOnlyFor(t).sort();
  console.log('  chat / %s 差集 %2d 条: %s', t, chs.length, chs.join(', ') || '(无)');
});
console.log('动画时长: ' + ['idle', 'chat', 'touch1', 'touch2', 'touch3']
  .map((n) => n + '=' + dur(n).toFixed(2) + 's').join('  '));

// ---------- 设备 ----------
const world = (sk: any) => (sk.bones as any[]).flatMap((b: any) => [b.worldX, b.worldY]);
function maxJump(a: number[], b: number[]) {
  let m = 0;
  for (let i = 0; i < a.length; i += 2) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
  return m;
}
const nameAt = (st: any, t: number) => st.tracks[t]?.animation?.name ?? '';
function newRig() {
  const sk = new Skeleton(sd);
  const st = new AnimationState(new AnimationStateData(sd));
  st.setAnimation(0, 'idle', true);
  return { sk, st, mesh: { state: st, skeleton: sk } as any };
}
function step(r: any) { r.st.update(DT); r.st.apply(r.sk); r.sk.updateWorldTransform(); }
function makeTc(r: any, touch: string) {
  return createTouchController(r.mesh, {
    skeletonFile: 'regress',
    idleAnimationName: 'idle',
    touchAnimations: [touch],
    zones: [{ id: 'hit1', u0: 0, v0: 0, u1: 1, v1: 1 } as any],
    touchPool: [],
    random: () => 0,
  });
}
/** 剩余未回到 setup 的 chat 独占通道（按具体触摸动作口径） */
function leftovers(sk: any, touch: string): string[] {
  const out: string[] = [];
  const b = boneVals(sk), s = slotVals(sk);
  const chs = chatOnlyFor(touch);
  bonesOf(chs).forEach((n) => { if (b.get(n) !== SETUP_BONES.get(n)) out.push(n); });
  slotsOf(chs).forEach((n) => { if (s.get(n) !== SETUP_SLOTS.get(n)) out.push(n); });
  return out;
}

// ============ A. 打断场景：chat 播到中途 → 点击触摸 ============
function scenarioInterrupt(touch: string) {
  const r = newRig();
  const tc = makeTc(r, touch);

  for (let i = 0; i < steps(0.5); i++) step(r);          // warmup
  for (let i = 0; i < steps(1.5); i++) step(r);          // idle 到 2s（track0 相位非首帧）
  tc.trigger({ actionId: 1, animation: 'chat', text: '' } as any, 'standby');
  for (let i = 0; i < steps(3); i++) step(r);            // chat 播 3s（嘴型在动）
  const chatOn = nameAt(r.st, 2) === 'chat';

  tc.trigger({ actionId: 1, animation: touch, text: '' } as any, 'touch');  // ★ 打断
  let touchEnd = -1;
  let maxJumpAfter = 0;
  const total = steps(dur(touch) + 2.0);
  for (let i = 0; i < total; i++) {
    const w0 = world(r.sk);
    step(r);
    maxJumpAfter = Math.max(maxJumpAfter, maxJump(w0, world(r.sk)));
    if (touchEnd < 0 && nameAt(r.st, 2) !== touch && nameAt(r.st, 2) !== 'chat') touchEnd = i;
  }

  const left = leftovers(r.sk, touch);
  return { chatOn, touchEnd, left, maxJumpAfter, busy: tc.isBusy(), t2: nameAt(r.st, 2) };
}

// ============ N. 负向对照：模拟"旧实现"（clearTrack 硬清 + 不复位）============
/**
 * 这一组**必须残留**。否则说明测例没有区分能力（假通过）——
 * 用它反证 A2/B2 的"0 残留"确实是修复带来的，而不是骨架本来就不残留。
 */
function scenarioOldBehaviour(touch: string): string[] {
  const r = newRig();
  for (let i = 0; i < steps(0.5); i++) step(r);
  for (let i = 0; i < steps(1.5); i++) step(r);
  r.st.addAnimation(2, 'chat', false, 0);
  for (let i = 0; i < steps(3); i++) step(r);
  r.st.clearTrack(2);                        // ★ 旧实现：硬切（不复位）
  r.st.addAnimation(2, touch, false, 0);
  for (let i = 0; i < steps(dur(touch) + 1.0); i++) step(r);
  r.st.clearTrack(2);                        // ★ 旧实现的收尾：也是硬切
  for (let i = 0; i < steps(0.5); i++) step(r);
  return leftovers(r.sk, touch);
}

// ============ B. 自然播完：chat 播完 → 自动收尾 ============
function scenarioNatural() {
  const r = newRig();
  const tc = makeTc(r, 'touch1');
  for (let i = 0; i < steps(0.5); i++) step(r);
  for (let i = 0; i < steps(1.5); i++) step(r);
  tc.trigger({ actionId: 1, animation: 'chat', text: '' } as any, 'standby');

  let jumpAtEnd = 0;
  let sawChatEnd = false;
  // chat 播完那一刻（track2 的 current 从 chat 变成 '' / empty）
  const total = steps(dur('chat') + 1.2);
  for (let i = 0; i < total; i++) {
    const before = nameAt(r.st, 2);
    const w0 = world(r.sk);
    step(r);
    const after = nameAt(r.st, 2);
    const j = maxJump(w0, world(r.sk));
    if (!sawChatEnd && before === 'chat' && after !== 'chat') {
      sawChatEnd = true;
      jumpAtEnd = j;
    }
  }
  // 再跑 1s 确保混出走完
  for (let i = 0; i < steps(1.0); i++) step(r);

  const left = leftovers(r.sk, 'touch1');
  return { sawChatEnd, jumpAtEnd, left, t2: nameAt(r.st, 2), busy: tc.isBusy() };
}

// ================= __MAIN__ =================
console.log('\n================ A. 打断场景（chat 播到中途 → 点击触摸）================');
for (const touch of TOUCHES) {
  const r = scenarioInterrupt(touch);
  console.log('  --- chat → %s ---', touch);
  check(r.chatOn, 'A0 chat 确实在 track2 上播着（场景成立）');
  check(r.touchEnd >= 0, 'A1 触摸动作播完（不是卡住）', '末帧 ' + r.touchEnd);
  check(r.left.length === 0, 'A2 ★chat 独占通道全部回到 setup pose（修前会残留）',
    r.left.length ? '残留 ' + r.left.join(',') : '0 残留');
  check(!r.busy, 'A3 track2 最终被清空', '末态=' + (r.t2 || '(空)'));
  if (touch === 'touch1') {
    console.log('     （参考）打断后全程最大帧间骨位移 = %s', r.maxJumpAfter.toFixed(1));
  }
}

console.log('\n================ B. 自然播完（chat → 自动收尾）================');
{
  const r = scenarioNatural();
  check(r.sawChatEnd, 'B0 捕捉到 chat 的收尾帧');
  check(r.jumpAtEnd > 0 && r.jumpAtEnd <= 25, 'B1 ★收尾那一帧骨位移 ≤25（修前 154.2）',
    r.jumpAtEnd.toFixed(2) + ' 单位');
  check(r.left.length === 0, 'B2 ★chat 独占通道全部回到 setup pose',
    r.left.length ? '残留 ' + r.left.join(',') : '0 残留');
  check(!r.busy, 'B3 收尾后 track2 被清空（<empty> 不留残）', '末态=' + (r.t2 || '(空)'));
}

console.log('\n================ N. 负向对照（模拟旧实现：clearTrack 硬清 + 不复位）================');
for (const touch of TOUCHES) {
  const left = scenarioOldBehaviour(touch);
  check(left.length > 0, 'N ★旧实现下必然残留 ⇒ 证明 A2/B2 的 0 残留是修复带来的  chat/' + touch,
    left.length ? '残留 ' + left.join(',') : '⚠ 竟然无残留 —— 测例可能失真');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
