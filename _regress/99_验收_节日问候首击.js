/**
 * 验收：**节日问候在"那一天的第一句问候"是不是就播出来**
 *
 * ## 为什么必须跑真实页面（不能只靠 `98` 的纯函数回归）
 *
 * `98` 只验漏斗：给定事件表 + 给定日期，`resolveEventFrom` 第一个 tick 选谁。
 * 但用户看到的是**运行时**：boot 定时器、5 秒去重、语音占用闸门、待机通道抢跑、
 * `lastGreetingAt` 与系统日期的先后关系 —— 这些都不在漏斗里。
 * "漏斗选对了、运行时却没播"是最容易假通过的一格，只能靠行为回答。
 *
 * ## 做法
 *
 * 用 CDP 在页面**任何脚本之前**注入一个可平移的假时钟（`__setAbs(epoch)`），
 * 于是能在真实页面里做纯函数做不到的事：
 *
 *   ① **干净载入**：页面一开机就"生活在" 2 月 14 日 / 1 月 1 日 / 12 月 25 日；
 *   ② **中途改日期**（模拟改系统日期但**不重启 WE**）：先让壁纸正常播一句，
 *      再把时钟拨回节日那天，看后续问候还出不出得来。
 *
 * ⚠️ 注入脚本必须**幂等**（`__CLOCK_HOOKED`）：`addScriptToEvaluateOnNewDocument`
 *   会随每次调用累积，重复注入时第二次的 `Date` 已经是假的 ⇒ 偏移量会叠加。
 *
 * ## 用法
 *
 *   python -m http.server 8931 --bind 127.0.0.1 --directory <工程目录>
 *   node _regress/99_验收_节日问候首击.js http://127.0.0.1:8931/index.html
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8931/index.html';
const W = 1920;
const H = 1080;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
async function waitCdp(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {
      /* 等 Chrome 起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}
function cdp(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });
    let id = 0;
    const pending = new Map();
    ws.on('open', () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        close: () => ws.close(),
      })
    );
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  });
}

/** 假时钟（幂等）：`__setAbs(目标 epoch)` 把整个页面的 `Date` 平移到那一天 */
const CLOCK_HOOK = `
(function () {
  if (window.__CLOCK_HOOKED) { return; }
  window.__CLOCK_HOOKED = true;
  var RD = Date;
  window.__SHIFT = 0;
  var D = function () {
    if (!(this instanceof D)) return new RD(RD.now() + window.__SHIFT).toString();
    var a = arguments;
    if (a.length === 0) return new RD(RD.now() + window.__SHIFT);
    if (a.length === 1) return new RD(a[0]);
    if (a.length === 2) return new RD(a[0], a[1]);
    if (a.length === 3) return new RD(a[0], a[1], a[2]);
    return new RD(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
  };
  D.prototype = RD.prototype;
  D.now = function () { return RD.now() + window.__SHIFT; };
  D.parse = RD.parse;
  D.UTC = RD.UTC;
  window.Date = D;
  /** 用**原生**时钟算偏移 ⇒ 多次调用不会叠加 */
  window.__setAbs = function (epoch) { window.__SHIFT = epoch - RD.now(); };
  window.__setShift = function (ms) { window.__SHIFT = ms; };
  window.__clockNow = function () { return new Date().toString(); };
})();
`;

/** 气泡文本 → 事件 id 的判据表（从 events.jsonc 读，避免脚本里写死文案） */
function loadTextMap(assetsDir) {
  const raw = fs.readFileSync(path.join(assetsDir, 'events.jsonc'), 'utf8');
  const body = raw
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
    .replace(/,(\s*[\]}])/g, '$1');
  const ev = JSON.parse(body).events;
  const map = {};
  ev.forEach((e) => {
    if (e.text) map[e.text.trim()] = e.id;
  });
  return map;
}

async function withBrowser(fn) {
  const PORT = 9700 + (process.pid % 200);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbfest-'));
  const chrome = spawn(
    process.env.CHROME ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profileDir,
      '--window-size=' + W + ',' + H,
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    const target = await waitCdp(PORT);
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: W,
      height: H,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await fn(c);
  } finally {
    chrome.kill();
  }
}

const EVAL = {
  bubble: `(() => { const n = document.querySelector('#spine-voice-bubble'); return n ? n.innerText.trim() : ''; })()`,
  snap: `(() => { const d = window.__WB_DIALOGUE__; if (!d) return null; const s = d.snapshot(); return s ? { source: s.source, greetCount: s.greetCount, standbyCount: s.standbyCount, firedCount: s.firedCount, playing: s.playing, busy: s.busy } : null; })()`,
  clock: `window.__clockNow ? __clockNow() : ''`,
  table: `(() => { const d = window.__WB_DIALOGUE__; return d ? d.events().map(e => e.id + '|' + e.kind + '|' + JSON.stringify(e.when)) : []; })()`,
};

async function main() {
  const assetsDir =
    process.env.ASSETS ||
    'D:/SteamLibrary/steamapps/common/wallpaper_engine/projects/myprojects/星语心恋S8/assets';
  const textMap = loadTextMap(assetsDir);
  console.log('判据表：气泡文本 → 事件 id（共 %d 条）', Object.keys(textMap).length);

  /** 场景 ①：干净载入 —— 页面一开机就生活在目标日 */
  const SCENES = [
    { label: '情人节 2026-02-14', iso: '2026-02-14T10:00:00' },
    { label: '元旦   2026-01-01', iso: '2026-01-01T10:00:00' },
    { label: '圣诞   2026-12-25', iso: '2026-12-25T10:00:00' },
    { label: '春节   2026-02-17', iso: '2026-02-17T10:00:00' },
  ];

  await withBrowser(async (c) => {
    const evalJs = async (expr) => {
      const r = await c.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 240));
      }
      return r.result && r.result.value;
    };

    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_HOOK });

    for (const sc of SCENES) {
      const target = new Date(sc.iso).getTime();
      await c.send('Page.navigate', { url: URL_ });
      /** 导航后立刻把时钟定到目标日（注入脚本已跑，页面脚本刚开始） */
      await evalJs(`window.__setAbs(${target}); 1`);
      await sleep(300);
      await evalJs(`window.__setAbs(${target}); 1`);

      console.log('\n' + '='.repeat(74));
      console.log('【场景①】干净载入 · %s', sc.label);
      console.log('  页面时钟 =', await evalJs(EVAL.clock));

      /**
       * 从载入起**连续轮询**气泡（每 400ms）—— boot 那句只有几秒，
       * 事后再读一定错过（上一版脚本就漏了它）。
       */
      const seen = [];
      let last = '';
      const t0 = Date.now();
      /** 每 9 秒派一次 focus（> 5s 去重窗口） */
      let nextFocus = t0 + 20000;
      let focusN = 0;
      while (Date.now() - t0 < 62000) {
        const b = await evalJs(EVAL.bubble);
        if (b && b !== last) {
          last = b;
          const s = await evalJs(EVAL.snap);
          seen.push({
            t: ((Date.now() - t0) / 1000).toFixed(1),
            text: b,
            id: textMap[b] || '(未知文案)',
            snap: s,
          });
        }
        if (Date.now() >= nextFocus && focusN < 4) {
          focusN += 1;
          await evalJs(`window.dispatchEvent(new Event('focus')); 1`);
          nextFocus = Date.now() + 9000;
        }
        await sleep(400);
      }

      console.log('  实际播出的念白序列（t = 距载入秒数）：');
      seen.forEach((r) =>
        console.log(
          '    t=%ss  %-30s ← %s | source=%s greet=%s standby=%s',
          r.t,
          r.id,
          r.text.slice(0, 20),
          (r.snap || {}).source,
          (r.snap || {}).greetCount,
          (r.snap || {}).standbyCount
        )
      );
      const isFest = (id) =>
        /valentine|newyear|spring|christmas|qixi/.test(id || '');
      const first = seen[0];
      const firstFest = seen.findIndex((r) => isFest(r.id));
      console.log(
        '  ⇒ 第一句：%s%s；节日问候出现在第 %s 句',
        first ? first.id : '(一句都没播)',
        first && isFest(first.id) ? '  ★ 是节日' : '  （非节日）',
        firstFest >= 0 ? String(firstFest + 1) : '——（整个 62 秒都没出现）'
      );
    }

    /** 场景 ②：中途改系统日期（不重载页面）—— 用户实际的验收姿势 */
    console.log('\n' + '='.repeat(74));
    console.log('【场景②】先正常播一句，然后把时钟拨回元旦（不重载页面）');
    await c.send('Page.navigate', { url: URL_ });
    await sleep(18000);
    console.log('  拨回前时钟 =', await evalJs(EVAL.clock));
    const s0 = await evalJs(EVAL.snap);
    console.log('  拨回前 greet 已播：', (s0 || {}).greetCount);

    const target = new Date('2026-01-01T10:00:00').getTime();
    await evalJs(`window.__setAbs(${target}); 1`);
    console.log('  拨回后时钟 =', await evalJs(EVAL.clock));

    let prevGreet = (s0 || {}).greetCount || 0;
    for (let i = 1; i <= 6; i += 1) {
      const before = await evalJs(EVAL.snap);
      await evalJs(`window.dispatchEvent(new Event('focus')); 1`);
      await sleep(1600);
      const after = await evalJs(EVAL.snap);
      const b = await evalJs(EVAL.bubble);
      console.log(
        '    第%d次 focus ⇒ %s | greet %s→%s standby=%s busy=%s 气泡="%s"',
        i,
        ((after || {}).greetCount || 0) > ((before || {}).greetCount || 0)
          ? '播了'
          : '没播（被闸门/去重挡下）',
        (before || {}).greetCount,
        (after || {}).greetCount,
        (after || {}).standbyCount,
        (after || {}).busy,
        (b || '').slice(0, 16)
      );
      prevGreet = (after || {}).greetCount || 0;
    }
  });
}

main().catch((e) => {
  console.error('★ 失败：', e && e.message ? e.message : e);
  process.exit(1);
});
