/**
 * 诊断：**改了系统日期但页面没重载** 时，节日问候还出不出来 / 出在第几句
 *
 * 与 `99` 的分工：`99` 验"干净载入"（页面一开机就在节日当天）；
 * 本脚本验用户最容易踩的那种姿势 —— **壁纸一直在跑，直接改系统日期**。
 *
 * 三个实验（**每个实验都开全新 Chrome profile**，隔离 `localStorage` 里的配额）：
 *
 *   A. 平时 → 拨到元旦 → 第一次 focus：出不出元旦问候？（无历史配额）
 *   B. 接着 A：拨到 3 月 15 日再拨回元旦 → 还出不出？（验 `quota.per:'day'` 持久化）
 *   C. 清掉 `wb.swe.eventlog.v1` 后重载 → 是不是立刻回到"第一句就是节日"
 *
 * 判据：气泡文本 + `snapshot().greetCount` + localStorage 里的事件日志原文。
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8931/index.html';
const W = 1280;
const H = 720;
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
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}
function cdp(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
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
  D.parse = RD.parse; D.UTC = RD.UTC;
  window.Date = D;
  window.__setAbs = function (epoch) { window.__SHIFT = epoch - RD.now(); };
  window.__clockNow = function () { return new Date().toString(); };
})();
`;

function loadTextMap(assetsDir) {
  const raw = fs.readFileSync(path.join(assetsDir, 'events.jsonc'), 'utf8');
  const body = raw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/,(\s*[\]}])/g, '$1');
  const map = {};
  JSON.parse(body).events.forEach((e) => {
    if (e.text) map[e.text.trim()] = e.id;
  });
  return map;
}

const EVAL = {
  bubble: `(() => { const n = document.querySelector('#spine-voice-bubble'); return n ? n.innerText.trim() : ''; })()`,
  snap: `(() => { const d = window.__WB_DIALOGUE__; if (!d) return null; const s = d.snapshot(); return { source: s.source, greetCount: s.greetCount, standbyCount: s.standbyCount, playing: s.playing, busy: s.busy }; })()`,
  clock: `window.__clockNow ? __clockNow() : ''`,
  log: `(() => { try { const r = localStorage.getItem('wb.swe.eventlog.v1'); if (!r) return '(空)'; const s = JSON.parse(r); return Object.keys(s.entries || {}).map(k => k + ' day=' + s.entries[k].day + ' dayCount=' + s.entries[k].dayCount).join(' | '); } catch (e) { return '(读不到: ' + e.message + ')'; } })()`,
};

/** 每个实验一个全新 profile（隔离 localStorage） */
async function runCase(name, fn) {
  const PORT = 9800 + (process.pid % 90);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbfest2-'));
  const chrome = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir,
      '--window-size=' + W + ',' + H, '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    const target = await waitCdp(PORT);
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_HOOK });
    const evalJs = async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
      return r.result && r.result.value;
    };
    console.log('\n' + '─'.repeat(74));
    console.log('【%s】', name);
    await fn(c, evalJs);
  } finally {
    chrome.kill();
  }
}

/** 派一次 focus + 等 1.6s，返回"这一枪播了什么" */
async function shoot(evalJs, textMap) {
  const before = await evalJs(EVAL.snap);
  const bubbleBefore = await evalJs(EVAL.bubble);
  await evalJs(`window.dispatchEvent(new Event('focus')); 1`);
  await sleep(1800);
  const after = await evalJs(EVAL.snap);
  const bubble = await evalJs(EVAL.bubble);
  const played = ((after || {}).greetCount || 0) > ((before || {}).greetCount || 0);
  const fresh = bubble && bubble !== bubbleBefore;
  return {
    played,
    id: fresh ? textMap[bubble] || '(未知文案)' : played ? '(播了，但气泡没换文)' : '(没播)',
    greet: (after || {}).greetCount,
    busy: (after || {}).busy,
    playing: (after || {}).playing,
  };
}

async function main() {
  const assetsDir =
    process.env.ASSETS ||
    'D:/SteamLibrary/steamapps/common/wallpaper_engine/projects/myprojects/星语心恋S8/assets';
  const textMap = loadTextMap(assetsDir);
  const EPOCH = (iso) => new Date(iso).getTime();

  await runCase('A 平时载入 → 拨到元旦 → 连打 3 次 focus', async (c, evalJs) => {
    await c.send('Page.navigate', { url: URL_ });
    await sleep(16000);
    console.log('  拨前时钟 =', await evalJs(EVAL.clock));
    console.log('  拨前事件日志 =', await evalJs(EVAL.log));
    await evalJs(`window.__setAbs(${EPOCH('2026-01-01T10:00:00')}); 1`);
    console.log('  拨后时钟 =', await evalJs(EVAL.clock));
    for (let i = 1; i <= 3; i += 1) {
      const r = await shoot(evalJs, textMap);
      console.log('    第%d次 focus ⇒ id=' + r.id + ' greet=' + r.greet + ' busy=' + r.busy + ' playing=' + r.playing, i);
      await sleep(8000);
    }
    console.log('  事后事件日志 =', await evalJs(EVAL.log));
  });

  await runCase('B 元旦那天已经播过一次 → 拨走再拨回 → 还出不出', async (c, evalJs) => {
    await c.send('Page.navigate', { url: URL_ });
    await evalJs(`window.__setAbs(${EPOCH('2026-01-01T10:00:00')}); 1`);
    await sleep(16000);
    console.log('  首次载入（元旦）播了：', (await evalJs(EVAL.bubble) || '').slice(0, 18));
    console.log('  日志 =', await evalJs(EVAL.log));
    /** 拨到 3 月 15 日（非节日）再拨回元旦 —— 模拟"来回改日期" */
    await evalJs(`window.__setAbs(${EPOCH('2026-03-15T10:00:00')}); 1`);
    await sleep(9000);
    let r = await shoot(evalJs, textMap);
    console.log('    在 3-15 打一次 ⇒ id=' + r.id + ' greet=' + r.greet);
    await evalJs(`window.__setAbs(${EPOCH('2026-01-01T10:00:00')}); 1`);
    console.log('  拨回元旦，时钟 =', await evalJs(EVAL.clock));
    for (let i = 1; i <= 3; i += 1) {
      r = await shoot(evalJs, textMap);
      console.log('    回到 1-1 第' + i + ' 次 ⇒ id=' + r.id + ' greet=' + r.greet + ' busy=' + r.busy);
      await sleep(8000);
    }
    console.log('  日志 =', await evalJs(EVAL.log));
  });

  await runCase('C 清掉事件日志后重载 → 第一句是不是立刻回到节日', async (c, evalJs) => {
    await c.send('Page.navigate', { url: URL_ });
    await evalJs(`window.__setAbs(${EPOCH('2026-01-01T10:00:00')}); 1`);
    await sleep(16000);
    console.log('  第一次载入播了：', ((await evalJs(EVAL.bubble)) || '').slice(0, 18));
    await evalJs(`try { localStorage.removeItem('wb.swe.eventlog.v1'); } catch (e) {}; 1`);
    console.log('  已清 wb.swe.eventlog.v1，日志 =', await evalJs(EVAL.log));
    await c.send('Page.navigate', { url: URL_ });
    await evalJs(`window.__setAbs(${EPOCH('2026-01-01T10:00:00')}); 1`);
    await sleep(16000);
    const b = await evalJs(EVAL.bubble);
    console.log('  重载后第一句 =', textMap[(b || '').trim()] || (b || '(无)'));
  });
}

main().catch((e) => {
  console.error('★ 失败：', e && e.message ? e.message : e);
  process.exit(1);
});
