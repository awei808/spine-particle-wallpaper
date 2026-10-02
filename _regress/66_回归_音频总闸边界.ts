// 边界验证：语音纳入总闸后的各条边界。
// 跑法（在仓库根目录，不需要任何外部素材）：
//   npx ts-node --transpile-only _regress/66_回归_音频总闸边界.ts
//
// 为什么用 DOM 桩而不是 headless Chrome：这里要验的是**状态机**（wasPlaying /
// currentTime 的取值），不需要真解码；桩能精确定时，比等真实 ogg 播完稳得多。
import { createVoicePlayer } from '../src/voicePlayer';
import { createAudioMaster } from '../src/audioMaster';

declare const global: any;
const g = global as any;

/** 极简 DOM 桩：只实现 voicePlayer / audioMaster 用到的那几个 audio 接口 */
function makeEl(): any {
  const el: any = {
    _src: '',
    volume: 1,
    paused: true,
    currentTime: 0,
    duration: 0,
    loop: false,
    preload: '',
    set src(v: string) {
      this._src = v;
      this.currentTime = 0;
      this.paused = true; // 换源 ⇒ 回到"停着"，与浏览器一致
    },
    get src() {
      return this._src;
    },
    removeAttribute() {},
    play() {
      if (!this._src) {
        const e: any = new Error('no src');
        e.name = 'NotAllowedError';
        return Promise.reject(e);
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
  return el;
}

g.document = {
  createElement: (t: string) => (String(t).toLowerCase() === 'audio' ? makeEl() : {}),
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
};
g.window = {};

/**
 * 桩里创建的 `el` 按创建顺序落在 `g.__els` 里。
 * 真实运行时要拨进度得靠解码，桩里直接改元素即可 —— 目的只是把播放器
 * 置于"正在播且已播了 N 秒"这个状态，好验挂起/续播的语义。
 */
const els: any[] = [];
const origCreate = g.document.createElement;
g.document.createElement = (t: string) => {
  const el = origCreate(t);
  if (String(t).toLowerCase() === 'audio') {
    els.push(el);
  }
  return el;
};
/** 拨到"正在播 + 已播 N 秒"的状态（真实解码在桩里不存在） */
const seekTo = (player: any, n: number) => {
  const el = els[els.length - 1];
  el.paused = false;
  el.currentTime = n;
  void player;
};

let bad = 0;
const assert = (name: string, ok: boolean, extra = '') => {
  // ★ 用 padEnd 而不是 '%-42s'：Node 的 util.format **不支持** 左对齐宽度修饰符，
  //   写了会把整个格式化串当普通字符串、参数被丢弃（表现为"什么都没有"，
  //   曾导致本脚本一度假报"全部通过"）。
  console.log(
    '  [' + (ok ? 'PASS' : 'FAIL') + '] ' + name.padEnd(44, ' ') + extra
  );
  if (!ok) {
    bad++;
  }
};

const master = createAudioMaster({ log: false });
const voice = createVoicePlayer({ path: './v/', volume: 1 })!;
master.register('voice', voice);

console.log('边界 1：从未播过就 resume，不应凭空出声');
master.apply(false);
assert('未播过不被唤醒', voice.isPlaying() === false);

console.log('\n边界 2：播一条 → 暂停 → 恢复，从暂停处续');
voice.play('a.ogg');
seekTo(voice, 1.5);
assert('在播', voice.isPlaying() === true);
master.apply(true);
assert('暂停后停住', voice.isPlaying() === false);
assert('进度保留（未被清零）', voice.currentTime() === 1.5, 't=' + voice.currentTime());
master.apply(false);
assert('恢复后续播', voice.isPlaying() === true);
assert('从 1.5 续而非回 0', voice.currentTime() === 1.5, 't=' + voice.currentTime());

console.log('\n边界 3：连发两次暂停，进度不被清零（幂等）');
master.apply(true);
master.apply(true);
assert('进度未清零', voice.currentTime() === 1.5, 't=' + voice.currentTime());
master.apply(false);

console.log('\n边界 4：stop 后再 resume，不该复活（那条念白已作废）');
voice.stop();
assert('stop 归零', voice.currentTime() === 0);
master.apply(true);
master.apply(false);
assert('stop 后不被复活', voice.isPlaying() === false);

console.log('\n边界 5：暂停发生在语音播完后（ended），恢复不该从头重播');
voice.play('b.ogg');
seekTo(voice, 3.0);
master.apply(true);
master.apply(false);
assert('从 3.0 续而非回 0', voice.currentTime() === 3.0, 't=' + voice.currentTime());

console.log('\n边界 6：setVolume 生效且夹在 [0,1]');
voice.setVolume(0.3);
assert('音量 0.3', Math.abs(voice.getVolume() - 0.3) < 1e-9, 'v=' + voice.getVolume());
voice.setVolume(5);
assert('超范围夹到 1', voice.getVolume() === 1);
voice.setVolume(-2);
assert('负值夹到 0', voice.getVolume() === 0);

console.log('\n边界 7：enabled:false ⇒ createVoicePlayer 返回 null（总闸跳过登记）');
assert('禁用时为 null', createVoicePlayer({ enabled: false }) === null);

console.log('\n边界 8：登记/移除的幂等');
master.register('voice', voice);
assert('重复登记仍只一路', master.size() === 1, 'size=' + master.size());
master.unregister('voice');
assert('移除后 size=0', master.size() === 0);
master.apply(true);
assert('移除后暂停不生效于它', voice.isPlaying() === true);
master.unregister('voice'); // 重复移除不得抛
assert('重复移除不抛异常', master.size() === 0);

console.log('\n边界 9：登记时若已处于暂停态，立即补挂起（补上"信号先到"的窗口）');
const master2 = createAudioMaster({ log: false });
const voice2 = createVoicePlayer({ path: './v/' })!;
master2.apply(true); // 先来暂停
voice2.play('c.ogg');
master2.register('v2', voice2);
assert('登记瞬间即被挂起', voice2.isPlaying() === false);
master2.apply(false);
assert('恢复后正常续播', voice2.isPlaying() === true);

console.log('\n' + (bad ? 'FAIL ' + bad + ' 项' : '全部通过'));
process.exitCode = bad ? 1 : 0;
