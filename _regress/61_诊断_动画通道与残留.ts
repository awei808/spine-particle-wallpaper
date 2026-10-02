/**
 * 诊断（只读，不改 src）：亚砂 S9 骨架
 *   ① 各动画的「通道覆盖差集」—— 找 "chat 有、idle/touch 没有" 的通道
 *   ② 实测「track2 播 chat → clearTrack(2)」那一帧的跳变与残留
 *   ③ 对比备选收尾方案 `setEmptyAnimation(2, mixOut)` 的跳变/残留/是否留残 track
 *
 * 用法：npx ts-node _regress/61_诊断_动画通道与残留.ts
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
const steps = (sec: number) => Math.max(1, Math.round(sec / DT));
const dur = (n: string) => (sd.animations.find((a: any) => a.name === n)?.duration ?? 0);

// ---------------- ① 通道差集 ----------------
function timelineTag(t: any): string {
  const ctor = String(t.constructor?.name ?? 'Timeline').replace(/Timeline$/, '');
  let target = 'global';
  if (typeof t.slotIndex === 'number') target = 'slot:' + sd.slots[t.slotIndex].name;
  else if (typeof t.boneIndex === 'number') target = 'bone:' + sd.bones[t.boneIndex].name;
  return ctor + '@' + target;
}
const chanOf = (name: string): Set<string> => {
  const a = sd.animations.find((x: any) => x.name === name);
  const out = new Set<string>();
  if (!a) return out;
  for (const t of a.timelines) out.add(timelineTag(t));
  return out;
};

console.log('=== 骨架规模 ===');
console.log('slots=' + sd.slots.length + '  bones=' + sd.bones.length +
  '  animations=' + sd.animations.map((a: any) => a.name).join('/'));

const ANIMS = ['idle', 'chat', 'greet', 'touch1', 'touch2', 'touch3'];
console.log('\n=== 各动画 timeline 数 / 时长 ===');
for (const n of ANIMS) {
  const a = sd.animations.find((x: any) => x.name === n);
  console.log('  ' + n.padEnd(8) + ' dur=' + dur(n).toFixed(2) + 's  timelines=' +
    (a ? a.timelines.length : -1));
}

const sets: Record<string, Set<string>> = {};
for (const n of ANIMS) sets[n] = chanOf(n);

const only = (a: string, b: Set<string>) => [...sets[a]].filter((x) => !b.has(x)).sort();
console.log('\n=== ★ chat 有、idle 没有的通道（= clearTrack 后会残留的通道） ===');
const chatOnlyIdle = only('chat', sets['idle']);
chatOnlyIdle.forEach((c) => console.log('  ' + c));
if (!chatOnlyIdle.length) console.log('  (无)');

console.log('\n=== ★ chat 有、touch1 没有的通道 ===');
const chatOnlyTouch = only('chat', sets['touch1']);
chatOnlyTouch.forEach((c) => console.log('  ' + c));
if (!chatOnlyTouch.length) console.log('  (无)');

console.log('\n=== chat 的 slot 类通道全表 ===');
{
  const a = sd.animations.find((x: any) => x.name === 'chat');
  for (const t of a.timelines) {
    const tag = timelineTag(t);
    if (tag.startsWith('slot:')) console.log('  ' + tag);
  }
}

console.log('\n=== idle 的 slot 类通道全表 ===');
{
  const a = sd.animations.find((x: any) => x.name === 'idle');
  for (const t of a.timelines) {
    const tag = timelineTag(t);
    if (tag.startsWith('slot:')) console.log('  ' + tag);
  }
}

// ---------------- ② / ③ 实测 ----------------
const ANIM_IDLE = 'idle';
const ANIM_TALK = 'chat';

function world(s: any): number[] {
  const o: number[] = [];
  for (const b of s.bones) o.push(b.worldX, b.worldY);
  return o;
}
function maxDelta(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i += 2) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
    if (d > m) m = d;
  }
  return m;
}
/** slot → attachment 名（null = 无） */
function attOf(s: any): Map<string, string> {
  const m = new Map<string, string>();
  (s.slots as any[]).forEach((sl: any) => {
    const at = sl.getAttachment();
    m.set(sl.data.name, at ? String(at.name) : '(null)');
  });
  return m;
}
function attDiff(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  a.forEach((v, k) => { if (b.get(k) !== v) out.push(k + ': ' + v + ' → ' + b.get(k)); });
  return out.sort();
}

type Rig = { sk: any; st: any };
function newRig(): Rig {
  const sk = new Skeleton(sd);
  const st = new AnimationState(new AnimationStateData(sd));
  return { sk, st };
}
function step(r: Rig) { r.st.update(DT); r.st.apply(r.sk); r.sk.updateWorldTransform(); }

/**
 * 跑一个场景：idle 常驻 track0 → 第 `talkAt` 秒在 track2 播 chat
 * → 播完后按 `endMode` 收尾，测收尾那一帧的跳变与 attachment 残留。
 */
function scenario(label: string, endMode: 'clear' | 'empty0' | 'emptyMix', mixOut = 0.25) {
  const r = newRig();
  r.st.setAnimation(0, ANIM_IDLE, true);

  // 先跑一段纯 idle，取「同一相位」的帧间跳变基线
  const preFrames = steps(2);
  let baseJump = 0;
  for (let i = 0; i < preFrames; i++) {
    const w0 = world(r.sk);
    step(r);
    baseJump = Math.max(baseJump, maxDelta(w0, world(r.sk)));
  }

  // track2 播 chat
  r.st.addAnimation(2, ANIM_TALK, false, 0);
  const talkFrames = steps(dur(ANIM_TALK));
  for (let i = 0; i < talkFrames; i++) step(r);

  const attDuringChat = attOf(r.sk);
  const wBefore = world(r.sk);

  // 收尾
  if (endMode === 'clear') {
    r.st.clearTrack(2);
  } else if (endMode === 'empty0') {
    r.st.setEmptyAnimation(2, 0);
  } else {
    r.st.setEmptyAnimation(2, mixOut);
  }
  step(r);
  const jumpAtEnd = maxDelta(wBefore, world(r.sk));

  // 收尾后继续跑 mixOut + 1s，看是否稳定 / track2 是否被清
  const afterFrames = steps(mixOut + 1.0);
  let tailJump = 0;
  for (let i = 0; i < afterFrames; i++) {
    const w0 = world(r.sk);
    step(r);
    tailJump = Math.max(tailJump, maxDelta(w0, world(r.sk)));
  }
  const attAfter = attOf(r.sk);
  const resid = attDiff(attDuringChat, attAfter);

  // 与「纯 idle 同相位」对照：再跑一个只播 idle 的骨架到同一时刻
  const ref = newRig();
  ref.st.setAnimation(0, ANIM_IDLE, true);
  for (let i = 0; i < preFrames + talkFrames + 1 + afterFrames; i++) step(ref);
  const refAtt = attOf(ref.sk);
  const vsIdleOnly = attDiff(refAtt, attAfter);

  console.log('\n--- 场景: ' + label + ' ---');
  console.log('  基线 idle 帧间最大位移 : ' + baseJump.toFixed(2));
  console.log('  ★收尾那一帧跳变        : ' + jumpAtEnd.toFixed(2));
  console.log('  收尾后 1s 内最大帧间位移: ' + tailJump.toFixed(2));
  console.log('  track2 是否还在         : ' +
    (r.st.tracks[2] ? '在（' + String(r.st.tracks[2].animation?.name) + '）' : '已清空'));
  console.log('  chat 期间 vs 收尾后 attachment 差集 (' + resid.length + '):');
  resid.slice(0, 30).forEach((x) => console.log('     ' + x));
  console.log('  vs「纯 idle 同相位」差集 (' + vsIdleOnly.length + '):');
  vsIdleOnly.slice(0, 30).forEach((x) => console.log('     ' + x));
}

console.log('\n================ 实测 ================');
scenario('叠加模式现状：clearTrack(2)（用户当前行为）', 'clear');
scenario('备选 A：setEmptyAnimation(2, 0)', 'empty0');
scenario('备选 B：setEmptyAnimation(2, 0.25)', 'emptyMix', 0.25);
