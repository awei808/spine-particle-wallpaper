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
    _handlers: {} as any,
    volume: 1,
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 0,
    loop: false,
    preload: '',
    set src(v: string) {
      this._src = v;
      this.currentTime = 0;
      this.paused = true; // 换源 ⇒ 回到"停着"，与浏览器一致
      this.ended = false;
    },
    get src() {
      return this._src;
    },
    removeAttribute() {},
    addEventListener(type: string, fn: any) {
      (this._handlers[type] = this._handlers[type] || []).push(fn);
    },
    removeEventListener(type: string, fn: any) {
      const list = this._handlers[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) {
        list.splice(i, 1);
      }
    },
    /** 桩专用：手动触发某个事件（真实浏览器由解码推进触发） */
    emit(type: string) {
      (this._handlers[type] || []).slice().forEach((fn: any) => fn());
    },
    play() {
      if (!this._src) {
        const e: any = new Error('no src');
        e.name = 'NotAllowedError';
        return Promise.reject(e);
      }
      if (holdPlay) {
        holdPlay = false;
        return new Promise<void>((res) => {
          pendingPlay = () => {
            this.ended = false;
            this.paused = false;
            res();
          };
        });
      }
      /**
       * ★★ 与浏览器一致：对 **ended** 元素调 `play()` 会先 seek 回最早位置。
       * 少了这条，桩里的 `currentTime` 不会回 0，"整条重播"这个 bug 根本复现不出来
       * —— 那测试就成了摆设（99 次绿、真机 1 次红）。
       */
      if (this.ended) {
        this.ended = false;
        this.currentTime = 0;
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
/**
 * 边界 10 专用：让**下一次** `play()` 延迟落定，模拟"已发起、但元素还没开始播"
 * （`paused` 仍为 true，数据到位才翻成 false）——这是"落定时已暂停"的唯一窗口。
 */
let holdPlay = false;
let pendingPlay: (() => void) | null = null;
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
/**
 * 模拟"**自然播完**"：`paused = true` + `ended = true` + `currentTime = duration`。
 *
 * ★ 三个值同时成立才是浏览器的真实语义（Chromium 实测：播完时 paused 也为 true）。
 * ⚠️ 只把 `paused` 设成 true 是**不够**的 —— 那只是"被挂起"，
 *   2026-10-20 的"恢复时重播整条"就是靠这个差别漏掉的。
 */
const markEnded = (dur: number) => {
  const el = els[els.length - 1];
  el.duration = dur;
  el.currentTime = dur;
  el.paused = true;
  el.ended = true;
  el.emit('ended');
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

console.log('\n边界 5a：暂停时语音仍在播（未播完）⇒ 从原处续');
voice.play('b.ogg');
seekTo(voice, 3.0);
master.apply(true);
master.apply(false);
assert('从 3.0 续而非回 0', voice.currentTime() === 3.0, 't=' + voice.currentTime());

/**
 * ★★ 2026-10-20 线上 bug 的最小复现（短语音最容易撞上）：
 * 动作还在演、语音已经播完 ⇒ 暂停 WE ⇒ 恢复。
 *
 * 旧实现：`resume()` 只判 `wasPlaying && el.paused`，而播完的元素 paused 也是 true
 * ⇒ 对 ended 元素调 play() ⇒ 浏览器 seek 回 0 ⇒ **整条重播**。
 */
console.log('\n边界 5b：语音已播完（ended）后暂停/恢复 ⇒ 不得整条重播');
markEnded(3.0);
master.apply(true);
master.apply(false);
assert(
  '不重播（仍停在结束位）',
  voice.currentTime() === 3.0 && voice.isPlaying() === false,
  't=' + voice.currentTime() + ' playing=' + voice.isPlaying()
);
master.apply(false); // 再来一次，确认意图已被彻底清掉（幂等）
assert(
  '连发恢复也不重播',
  voice.currentTime() === 3.0 && voice.isPlaying() === false,
  't=' + voice.currentTime()
);

console.log('\n边界 5c：播完之后再起一条新语音，照常播（不误伤）');
voice.play('d.ogg');
assert('新语音正常起播', voice.isPlaying() === true);

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

/**
 * ★★ 边界 10（**异步**）：`play()` 落定时总闸已经暂停。
 *
 * 窗口：`play()` 已发起、元素还在等数据（`paused` 仍是 true）⇒ 总闸那次 `pause()`
 * 什么都看不到、直接退了；随后 `play()` 的 promise 落定，元素开始出声 ——
 * 于是"暂停中的壁纸上突然响一句"。
 *
 * 桩故意让 `play()` **延迟落定**并把 `paused=false` 放到落定那一刻，
 * 否则这个窗口在桩里根本不存在（同步 `Promise.resolve()` 时 `pause()` 总能先看到在播）。
 */
(async () => {
  const master3 = createAudioMaster({ log: false });
  const voice3 = createVoicePlayer({ path: './v/' })!;
  master3.register('v3', voice3);

  holdPlay = true;
  voice3.play('e.ogg'); // 未落定 ⇒ 元素尚未起播
  assert('起播前仍未在播', voice3.isPlaying() === false);
  master3.apply(true); // 暂停先到（此刻 pause() 看不到"在播"）
  if (pendingPlay) {
    (pendingPlay as () => void)();
  }
  await Promise.resolve();
  await Promise.resolve();
  assert(
    '落定时已暂停 ⇒ 补挂起（不静默出声）',
    voice3.isPlaying() === false,
    'playing=' + voice3.isPlaying()
  );

  master3.apply(false);
  assert('恢复后从 0 续播（意图被保留）', voice3.isPlaying() === true);

  console.log('\n' + (bad ? 'FAIL ' + bad + ' 项' : '全部通过'));
  process.exitCode = bad ? 1 : 0;
})();
