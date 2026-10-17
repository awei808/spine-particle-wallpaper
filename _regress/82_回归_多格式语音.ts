// 多格式语音（TODO「语音文件支持多种类型的音频文件」，PLAN §8 / S7）
// 跑法（仓库根目录，不需要任何素材、不需要浏览器）：
//   npx ts-node --transpile-only _regress/82_回归_多格式语音.ts
//
// 为什么用 DOM 桩：要验的是**降级链的状态机**（试了哪几个候选、什么时候停、
// 探测/记忆/代际有没有生效），不需要真解码。桩能精确控制"哪个 URL 会失败、
// 以什么方式失败"，比准备 4 份真音频可靠得多。
//
// ⚠️ 编号跳过 77~81：那是 PLAN_自定义事件前置条件 里 S1~S5 的预留号（见 docx/）。
import {
  buildVoiceCandidates,
  normalizeExtOrder,
  splitVoiceName,
  DEFAULT_VOICE_EXT_ORDER,
  VOICE_MIME,
  createVoicePlayer,
} from '../src/voicePlayer';

declare const global: any;
const g = global as any;

type Kind =
  | 'ok'
  | 'notsupported'
  | 'notallowed'
  | 'abort'
  | 'error-event'
  | 'slow-notsupported';

/** 每个用例自己设：给一个 url，回答它"怎么失败/是否成功" */
let plan: (url: string) => Kind = () => 'ok';
/** 每次 `play()` 实际发起过的 url（按顺序），断言降级链就看它 */
let played: string[] = [];
/** 收集 console.warn（验"每个文件只 warn 一次"） */
let warns: string[] = [];

const els: any[] = [];
/**
 * 元素创建时套用的 `canPlayType` 回答模板。
 * ★ 必须在 `play()` 之前设好：元素是 `ensure()` 时懒建的，建完再改模板不生效。
 */
let capsTemplate: { [mime: string]: string } = {};

function makeEl(): any {
  const listeners: { [k: string]: Function[] } = {};
  const el: any = {
    _src: '',
    volume: 1,
    paused: true,
    currentTime: 0,
    duration: 0,
    loop: false,
    preload: '',
    error: null,
    /** 每个元素自己的 canPlayType 回答（mime ⇒ 'probably' | ''）。缺省"都支持" */
    caps: Object.assign({} as { [mime: string]: string }, capsTemplate),
    set src(v: string) {
      this._src = v;
      this.currentTime = 0;
      this.paused = true; // 换源 ⇒ 回到"停着"，与浏览器一致
    },
    get src() {
      return this._src;
    },
    canPlayType(mime: string) {
      const v = this.caps[mime];
      return v === undefined ? 'probably' : v;
    },
    addEventListener(type: string, fn: Function) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) {
        arr.splice(i, 1);
      }
    },
    _emit(type: string) {
      (listeners[type] || []).slice().forEach((fn) => fn({ type }));
    },
    removeAttribute() {},
    play() {
      played.push(this._src);
      const kind = plan(this._src);
      if (kind === 'ok') {
        this.paused = false;
        return Promise.resolve();
      }
      if (kind === 'notallowed') {
        this.paused = true;
        const e: any = new Error('autoplay');
        e.name = 'NotAllowedError';
        return Promise.reject(e);
      }
      if (kind === 'abort') {
        this.paused = true;
        const e: any = new Error('aborted');
        e.name = 'AbortError';
        return Promise.reject(e);
      }
      if (kind === 'error-event') {
        // play 先 resolve，**稍后**元素才发 error —— 真实浏览器里最常见的时序。
        // ★ 若期间源已被换掉，则不再上报（浏览器换 src 会 abort 旧加载，旧资源的
        //   失败不该记到新候选头上）。这条规则让"迟到 error"只可能来自当前候选。
        this.paused = false;
        const self = this;
        const from = this._src;
        setTimeout(() => {
          if (self._src !== from) {
            return;
          }
          self.paused = true;
          self.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED
          self._emit('error');
        }, 0);
        return Promise.resolve();
      }
      if (kind === 'slow-notsupported') {
        // 延迟拒绝：用来验"上一条的降级链在换条之后才回来"时会不会改写当前 src
        this.paused = true;
        return new Promise((_res, rej) => {
          setTimeout(() => {
            const e: any = new Error('not supported (late)');
            e.name = 'NotSupportedError';
            rej(e);
          }, 2);
        });
      }
      // notsupported
      this.paused = true;
      const e: any = new Error('not supported');
      e.name = 'NotSupportedError';
      return Promise.reject(e);
    },
    pause() {
      this.paused = true;
    },
  };
  return el;
}

g.document = {
  createElement: (t: string) => {
    const el = makeEl();
    if (String(t).toLowerCase() === 'audio') {
      els.push(el);
    }
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
};
g.window = {};

const realWarn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  warns.push(args.map((a) => String(a)).join(' '));
};

/** 让 promise 链 + 桩里的 setTimeout(error) 全部跑完 */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 10));
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

let bad = 0;
const assert = (name: string, ok: boolean, extra = '') => {
  // ★ padEnd 而不是 '%-42s'：Node 的 util.format 不支持左对齐宽度修饰符
  console.log(
    '  [' + (ok ? 'PASS' : 'FAIL') + '] ' + name.padEnd(50, ' ') + extra
  );
  if (!ok) {
    bad++;
  }
};
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const cnt = (kw: string) => warns.filter((w) => w.indexOf(kw) >= 0).length;

/** 新建一个播放器（每个用例独立：caps / 命中记忆 / warn 去重都不串） */
const newPlayer = (cfg: any = {}) => {
  played = [];
  capsTemplate = {};
  return createVoicePlayer({ path: './v/', volume: 1, ...(cfg || {}) })!;
};
const lastEl = () => els[els.length - 1];

async function main() {
  /* ── A. 纯函数：候选链 ───────────────────────────────────────── */
  console.log('A. buildVoiceCandidates / splitVoiceName / normalizeExtOrder');

  const A1 = buildVoiceCandidates('a.ogg').map((c) => c.url);
  assert(
    'A1 带 ogg ⇒ 原串在先 + 三个兜底',
    eq(A1, ['a.ogg', 'a.mp3', 'a.wav', 'a.m4a']),
    A1.join(',')
  );

  const A2 = buildVoiceCandidates('a.mp3').map((c) => c.url);
  assert(
    'A2 带 mp3 ⇒ mp3 先、ogg 第二、不重复 mp3',
    eq(A2, ['a.mp3', 'a.ogg', 'a.wav', 'a.m4a']),
    A2.join(',')
  );

  const A3 = buildVoiceCandidates('a').map((c) => c.url);
  assert(
    'A3 无扩展名 ⇒ 全按 extOrder 拼',
    eq(A3, ['a.ogg', 'a.mp3', 'a.wav', 'a.m4a']),
    A3.join(',')
  );

  const A4 = buildVoiceCandidates('CV/Asuna/A_X.ogg');
  assert(
    'A4 子目录保留（第一个是原串）',
    A4[0].url === 'CV/Asuna/A_X.ogg' && A4[1].url === 'CV/Asuna/A_X.mp3',
    A4.map((c) => c.url).join(',')
  );

  const A5 = buildVoiceCandidates('a.ogg', ['wav', 'ogg']).map((c) => c.ext);
  assert('A5 自定义 extOrder 生效且去重', eq(A5, ['ogg', 'wav']), A5.join(','));

  const A6 = buildVoiceCandidates('a.ogg', []).map((c) => c.ext);
  assert(
    'A6 extOrder:[] ⇒ 只试原扩展名（显式关兜底）',
    eq(A6, ['ogg']),
    A6.join(',')
  );

  const A7 = buildVoiceCandidates('a', []);
  assert(
    'A7 extOrder:[] + 无扩展名 ⇒ 无候选',
    A7.length === 0,
    'n=' + A7.length
  );

  const A8 = buildVoiceCandidates('Asuna_v1.2').map((c) => c.url);
  assert(
    'A8 非音频后缀不算扩展名（整串当词干）',
    A8[0] === 'Asuna_v1.2.ogg',
    A8[0]
  );

  const A9 = splitVoiceName('CV/Asuna/A.OGG');
  assert(
    'A9 大写扩展名归一为小写',
    A9.ext === 'ogg' && A9.stem === 'CV/Asuna/A',
    JSON.stringify(A9)
  );

  const A10 = normalizeExtOrder(['.MP3', 'ogg', 'mp3', '', 'x!']);
  assert(
    'A10 归一：去点/小写/去重/丢垃圾',
    eq(A10, ['mp3', 'ogg']),
    A10.join(',')
  );

  const A11 = normalizeExtOrder(undefined);
  assert('A11 没写 ⇒ 缺省表', eq(A11, DEFAULT_VOICE_EXT_ORDER), A11.join(','));

  const A12 = normalizeExtOrder(['zzz!!']);
  assert(
    'A12 全是垃圾 ⇒ 退回缺省（不当成关兜底）',
    eq(A12, DEFAULT_VOICE_EXT_ORDER),
    A12.join(',')
  );

  const A13 = Object.keys(VOICE_MIME).filter((k) => k !== k.toLowerCase());
  assert('A13 MIME 表键全小写', A13.length === 0, A13.join(','));

  /* ── B. 运行时：兜底链 ───────────────────────────────────────── */
  console.log('\nB. 降级链（谁先试、试到哪停）');

  const p1 = newPlayer();
  plan = (u) => (u.endsWith('.ogg') ? 'notsupported' : 'ok');
  p1.play('a.ogg');
  await settle();
  const B1 = played.slice();
  assert(
    'B1 ogg 不支持 ⇒ 自动降到 mp3',
    eq(B1, ['./v/a.ogg', './v/a.mp3']),
    B1.join(',')
  );
  assert('B1 命中后 isPlaying', p1.isPlaying() === true);
  assert(
    'B1 resolvedUrl 报实际命中',
    p1.resolvedUrl() === 'a.mp3',
    p1.resolvedUrl()
  );

  console.log('\nC. 命中记忆（同词干下次先试上次成功的扩展名）');
  played = [];
  p1.play('a.ogg');
  await settle();
  const C1 = played.slice();
  assert('C1 再播同词干 ⇒ 第一次就试 mp3', eq(C1, ['./v/a.mp3']), C1.join(','));
  assert('C1 不再白撞 ogg', C1.indexOf('./v/a.ogg') < 0);

  const p2 = newPlayer();
  played = [];
  p2.play('a.ogg');
  await settle();
  assert(
    'C2 换播放器不继承记忆（仍先撞 ogg）',
    eq(played.slice(), ['./v/a.ogg', './v/a.mp3']),
    played.join(',')
  );

  console.log('\nD. 全链失败：静音 + 字幕保留 + 每词干只 warn 一次');
  const p3 = newPlayer();
  plan = () => 'notsupported';
  warns = [];
  p3.play('b.ogg');
  await settle();
  assert(
    'D1 四个候选都试过',
    eq(played.slice(), ['./v/b.ogg', './v/b.mp3', './v/b.wav', './v/b.m4a']),
    played.join(',')
  );
  assert('D1 不再"在播"', p3.isPlaying() === false);
  assert('D1 resolvedUrl 为空', p3.resolvedUrl() === '');
  assert(
    'D1 warn 一次',
    cnt('语音文件不可用') === 1,
    'n=' + cnt('语音文件不可用')
  );

  played = [];
  p3.play('b.ogg');
  await settle();
  assert(
    'D2 二次失败仍重试（没有永久放弃）',
    played.length === 4,
    'n=' + played.length
  );
  assert(
    'D2 但 warn 不刷屏',
    cnt('语音文件不可用') === 1,
    'n=' + cnt('语音文件不可用')
  );

  console.log('\nE. NotAllowedError 不降级（自动播放拦截 ≠ 文件问题）');
  const p4 = newPlayer();
  played = [];
  warns = [];
  plan = () => 'notallowed';
  p4.play('c.ogg');
  await settle();
  assert(
    'E1 只发起一次播放（不连试 4 个）',
    played.length === 1,
    'n=' + played.length
  );
  assert('E1 未被当作在播', p4.isPlaying() === false);
  assert(
    'E1 自动播放提示只一条',
    cnt('自动播放限制') === 1,
    'n=' + cnt('自动播放限制')
  );
  assert('E1 没有报"文件不可用"', cnt('语音文件不可用') === 0);

  console.log('\nF. AbortError 不降级（我们自己打断的）');
  const p5 = newPlayer();
  played = [];
  plan = () => 'abort';
  p5.play('d.ogg');
  await settle();
  assert('F1 只发起一次', played.length === 1, 'n=' + played.length);

  console.log('\nG. 元素 error 事件（play 先 resolve、后报错）也能降级');
  const p6 = newPlayer();
  played = [];
  plan = (u) => (u.endsWith('c.ogg') ? 'error-event' : 'ok');
  p6.play('c.ogg');
  await settle();
  assert(
    'G1 从 error 事件降到 mp3',
    eq(played.slice(), ['./v/c.ogg', './v/c.mp3']),
    played.join(',')
  );
  assert('G1 最终在播', p6.isPlaying() === true);
  assert('G1 resolvedUrl', p6.resolvedUrl() === 'c.mp3', p6.resolvedUrl());

  console.log('\nH. 能力探测：明确不支持的格式直接跳过');
  const p7 = newPlayer();
  capsTemplate[VOICE_MIME.wav] = ''; // 桩说 wav 不能播
  played = [];
  plan = (u) => (u.endsWith('.ogg') ? 'notsupported' : 'ok');
  p7.play('e.ogg');
  await settle();
  assert(
    'H1 chain 里没有 wav（被探测滤掉）',
    played.slice().indexOf('./v/e.wav') < 0,
    played.join(',')
  );
  assert('H1 仍然降到 mp3', p7.resolvedUrl() === 'e.mp3', p7.resolvedUrl());

  console.log('\nI. 探测全否定 ⇒ fail-safe 按原顺序实测');
  const p8 = newPlayer();
  Object.keys(VOICE_MIME).forEach((k) => (capsTemplate[VOICE_MIME[k]] = ''));
  played = [];
  warns = [];
  plan = () => 'ok';
  p8.play('f.ogg');
  await settle();
  assert(
    'I1 没有被"全不支持"拦死',
    played.length === 1 && p8.isPlaying() === true,
    played.join(',')
  );
  assert(
    'I1 探测全否定只提示一次',
    cnt('忽略探测') === 1,
    'n=' + cnt('忽略探测')
  );

  console.log('\nJ. 代际：连点两条，前一条的降级链不得改写正在播的 src');
  const p9 = newPlayer();
  played = [];
  // g.ogg 的失败**延迟 2 ms** 才回来（模拟加载慢的文件），此时 h.ogg 已经在播
  plan = (u) => (u.endsWith('g.ogg') ? 'slow-notsupported' : 'ok');
  p9.play('g.ogg');
  p9.play('h.ogg');
  await settle();
  assert(
    'J1 没有去试 g.mp3（上一条的链已作废）',
    played.slice().indexOf('./v/g.mp3') < 0,
    played.join(',')
  );
  assert('J1 停在 h.ogg', lastEl().src === './v/h.ogg', lastEl().src);
  assert(
    'J1 resolvedUrl 是 h.ogg',
    p9.resolvedUrl() === 'h.ogg',
    p9.resolvedUrl()
  );

  console.log('\nK. stop() 之后的迟到 error 不复活降级');
  const p10 = newPlayer();
  played = [];
  plan = () => 'error-event';
  p10.play('i.ogg');
  p10.stop();
  await settle();
  assert(
    'K1 只试过 i.ogg',
    eq(played.slice(), ['./v/i.ogg']),
    played.join(',')
  );
  assert('K1 没有续播', p10.isPlaying() === false);

  console.log('\nL. extOrder:[] + 无扩展名 ⇒ 直接不播并说明原因');
  const p11 = newPlayer({ extOrder: [] });
  played = [];
  warns = [];
  p11.play('noext');
  await settle();
  assert('L1 一次都没发起', played.length === 0, 'n=' + played.length);
  assert('L1 有明确告警', cnt('没有扩展名') === 1, 'n=' + cnt('没有扩展名'));

  console.log('\nM. 回归：老 config（无 extOrder）逐字不变');
  const p12 = newPlayer();
  played = [];
  plan = () => 'ok';
  p12.play('Asuna_Touch_Head_03.ogg');
  await settle();
  assert(
    'M1 首个候选就是原串（不看兜底）',
    eq(played.slice(), ['./v/Asuna_Touch_Head_03.ogg']),
    played.join(',')
  );
  assert('M1 换了新 API 也照旧出声', p12.isPlaying() === true);

  console.log('\nN. 总闸暂停期间不起播（请求延后，恢复后从头重跑）');
  const p13 = newPlayer();
  played = [];
  plan = () => 'ok';
  p13.pause(); // 总闸先暂停（WE 启动即暂停 / 用户暂停后定时器才响）
  p13.play('j.ogg');
  await settle();
  assert(
    'N1 暂停期间一个候选都不试',
    played.length === 0,
    'n=' + played.length
  );
  assert('N1 不在播', p13.isPlaying() === false);
  p13.resume();
  await settle();
  assert(
    'N2 恢复后补播那条',
    eq(played.slice(), ['./v/j.ogg']) && p13.isPlaying() === true,
    played.join(',')
  );

  console.log('\nO. 降级到一半被暂停 ⇒ 不续试，恢复后整条重跑');
  const p14 = newPlayer();
  played = [];
  plan = (u) => (u.endsWith('k.ogg') ? 'slow-notsupported' : 'ok');
  p14.play('k.ogg'); // 先试 ogg（延迟 2ms 才失败）
  p14.pause(); // 就在这 2ms 里总闸暂停
  await settle();
  assert(
    'O1 暂停中不再试 k.mp3',
    played.slice().indexOf('./v/k.mp3') < 0,
    played.join(',')
  );
  assert('O1 暂停中不在播', p14.isPlaying() === false);
  p14.resume();
  await settle();
  assert(
    'O2 恢复后从头重跑并落到 mp3',
    p14.resolvedUrl() === 'k.mp3' && p14.isPlaying() === true,
    'resolved=' + p14.resolvedUrl() + ' played=' + played.join(',')
  );

  console.log('\n' + (bad ? 'FAIL ' + bad + ' 项' : '全部通过'));
  if (bad) {
    realWarn('\n被捕获的 warn（排查用）：\n' + warns.join('\n'));
  }
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => {
  realWarn(e);
  process.exitCode = 1;
});
