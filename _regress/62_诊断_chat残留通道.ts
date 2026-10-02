/**
 * 诊断 62（只读）：定位「chat 被打断后残留的通道」并验证三种收尾方案。
 *
 * ★ 干净对照（时长严格对齐，唯一差别 = 中间那 3 秒播没播 chat）：
 *     组 P（纯净）  ：idle 2s → 空等 3s            → touch1 2s  （共 7s）
 *     组 Q（被污染）：idle 2s → track2 播 chat 3s → 打断 → touch1 2s（共 7s）
 *   两组的 idle 相位、touch1 相位完全一致 ⇒ 任何差异都只能来自 chat。
 *
 * ★ 判定"残留"的权威口径：
 *     把每个通道的值与 **setup pose**（new Skeleton 的初始值）比较。
 *     动作收尾后若某通道 == chat 最后的值 ≠ setup 值 ⇒ 残留（卡住）。
 *
 * 用法：npx ts-node --transpile-only _regress/62_诊断_chat残留通道.ts
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
const steps = (sec: number) => Math.max(0, Math.round(sec / DT));

function newRig() {
  return { sk: new Skeleton(sd), st: new AnimationState(new AnimationStateData(sd)) };
}
function step(r: any) { r.st.update(DT); r.st.apply(r.sk); r.sk.updateWorldTransform(); }

const R3 = (v: number) => Number(v.toFixed(3));
function boneVals(sk: any): Map<string, string> {
  const m = new Map<string, string>();
  (sk.bones as any[]).forEach((b: any) => {
    m.set(b.data.name,
      [R3(b.rotation), R3(b.x), R3(b.y), R3(b.scaleX), R3(b.scaleY)].join(','));
  });
  return m;
}
function slotVals(sk: any): Map<string, string> {
  const m = new Map<string, string>();
  (sk.slots as any[]).forEach((sl: any) => {
    const at = sl.getAttachment();
    const def = at && at.vertices
      ? Array.from(at.vertices as number[]).slice(0, 6).map((v: number) => R3(v)).join('/')
      : '';
    m.set(sl.data.name, (at ? String(at.name) : '(null)') + '|a=' + R3(sl.color.a) + '|d=' + def);
  });
  return m;
}
function maxWorldJump(sk: any, prev: number[]): number {
  let m = 0;
  (sk.bones as any[]).forEach((b: any, i: number) => {
    const d = Math.hypot(b.worldX - prev[i * 2], b.worldY - prev[i * 2 + 1]);
    if (d > m) m = d;
  });
  return m;
}
const worldOf = (sk: any) => (sk.bones as any[]).flatMap((b: any) => [b.worldX, b.worldY]);

/** 通道标签（chat 独有的那批） */
const tag = (t: any) => {
  const c = String(t.constructor?.name ?? '').replace(/Timeline$/, '');
  const tgt = typeof t.slotIndex === 'number' ? 'slot:' + sd.slots[t.slotIndex].name
    : typeof t.boneIndex === 'number' ? 'bone:' + sd.bones[t.boneIndex].name : 'global';
  return c + '@' + tgt;
};
const setOf = (n: string) => {
  const a = sd.animations.find((x: any) => x.name === n);
  const s = new Set<string>();
  if (a) for (const t of a.timelines) s.add(tag(t));
  return s;
};
const idleS = setOf('idle'), t1S = setOf('touch1');
/** chat 有、而 idle 与 touch1 都没有 ⇒ 收尾后无人覆盖，必然残留 */
const CHAT_ONLY = [...setOf('chat')].filter((x) => !idleS.has(x) && !t1S.has(x)).sort();
const CHAT_ONLY_BONES = new Set(
  CHAT_ONLY.filter((x) => x.includes('@bone:')).map((x) => x.split('@bone:')[1])
);
const CHAT_ONLY_SLOTS = new Set(
  CHAT_ONLY.filter((x) => x.includes('@slot:')).map((x) => x.split('@slot:')[1])
);

console.log('=== chat 独自拥有（idle 与 touch1 都没有）的通道：' + CHAT_ONLY.length + ' 个 ===');
CHAT_ONLY.forEach((x) => console.log('   ' + x));
console.log('其中 bone: ' + [...CHAT_ONLY_BONES].join(', '));
console.log('其中 slot: ' + [...CHAT_ONLY_SLOTS].join(', '));

// setup pose 基准
const setupSk = new Skeleton(sd);
const SETUP_BONES = boneVals(setupSk);
const SETUP_SLOTS = slotVals(setupSk);

type EndMode = 'clear' | 'clearReset' | 'emptyMix' | 'emptyMixReset';
function runQ(endMode: EndMode) {
  const r = newRig();
  r.st.setAnimation(0, 'idle', true);
  for (let i = 0; i < steps(2); i++) step(r);
  r.st.addAnimation(2, 'chat', false, 0);
  for (let i = 0; i < steps(3); i++) step(r);       // chat 播 3s（嘴在动）
  const chatEnd = boneVals(r.sk);

  const wBefore = worldOf(r.sk);
  // ---- 收尾 ----
  if (endMode === 'clear' || endMode === 'clearReset') {
    r.st.clearTrack(2);
    if (endMode === 'clearReset') r.sk.setToSetupPose();
  } else {
    r.st.setEmptyAnimation(2, 0.25);
    if (endMode === 'emptyMixReset') r.sk.setToSetupPose();
  }
  step(r);
  const jump = maxWorldJump(r.sk, wBefore);

  // 混出需要时间；跑 1s 让 empty 走完
  let settle = 0;
  for (let i = 0; i < steps(1.0); i++) {
    const w0 = worldOf(r.sk);
    step(r);
    settle = Math.max(settle, maxWorldJump(r.sk, w0));
  }
  // 再跑 1s 观察是否稳定（track2 是否残留）
  for (let i = 0; i < steps(1.0); i++) step(r);

  const afterBones = boneVals(r.sk);
  const afterSlots = slotVals(r.sk);

  // 关键通道现状：== setup？还是 == chat 末值？
  const lines: string[] = [];
  let stuck = 0;
  CHAT_ONLY_BONES.forEach((n) => {
    const now = afterBones.get(n)!;
    const isSetup = now === SETUP_BONES.get(n);
    const isChat = now === chatEnd.get(n);
    if (!isSetup) { stuck++; lines.push('   ' + n + '  现=' + now + (isChat ? '  ★==chat末值(残留)' : '  (中间值)')); }
  });
  CHAT_ONLY_SLOTS.forEach((n) => {
    const now = afterSlots.get(n)!;
    const isSetup = now === SETUP_SLOTS.get(n);
    if (!isSetup) { stuck++; lines.push('   ' + n + '  现=' + now + '  （setup=' + SETUP_SLOTS.get(n) + '）'); }
  });

  console.log('\n--- 收尾方案: ' + endMode + ' ---');
  console.log('  ★收尾那一帧最大骨位移 : ' + jump.toFixed(2));
  console.log('  收尾后 1s 内最大帧间位移: ' + settle.toFixed(2));
  console.log('  track2                 : ' + (r.st.tracks[2] ? '仍挂着(' + r.st.tracks[2].animation?.name + ')' : '已清空'));
  console.log('  chat 独有通道未回到 setup 的个数: ' + stuck + ' / ' + (CHAT_ONLY_BONES.size + CHAT_ONLY_SLOTS.size));
  lines.slice(0, 40).forEach((x) => console.log(x));
  return { jump, stuck };
}

console.log('\n================ 收尾方案对比 ================');
const a = runQ('clear');
const b = runQ('clearReset');
const c = runQ('emptyMix');
const d = runQ('emptyMixReset');
console.log('\nsummary:');
console.log('  clear          jump=' + a.jump.toFixed(2) + '  未复位通道=' + a.stuck);
console.log('  clear+reset    jump=' + b.jump.toFixed(2) + '  未复位通道=' + b.stuck);
console.log('  emptyMix       jump=' + c.jump.toFixed(2) + '  未复位通道=' + c.stuck);
console.log('  emptyMix+reset jump=' + d.jump.toFixed(2) + '  未复位通道=' + d.stuck);
