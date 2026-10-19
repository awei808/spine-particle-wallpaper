/**
 * 单帧成本归因：**把"每帧干多少活"与"跑多少帧"彻底解耦**。
 *
 * ## 前两轮为何全错（这轮踩坑的根因，务必先读）
 * · `34_`：用 rAF 帧间隔当 CPU 代理 ⇒ 出现「限 30fps 反而慢 37%」。
 * · `36_`：用主线程忙碌率 `TaskDuration/墙钟` ⇒ 出现「关 MSAA 反而忙 16%」。
 *
 * 两者错在**同一个地方**：
 *   「忙碌率」= 每帧成本 × **帧数**。
 *   关掉 MSAA 后单帧更便宜 ⇒ 浏览器**多跑帧**（实测 fps 123→139）⇒ 总时间反而上升。
 *   限帧同理：帧数被压⇒ 忙碌率必然下降，但那是"少干活"不是"干得便宜"。
 *
 * ⇒ 用户在任务管理器看到的百分比 = 忙碌率，**确实**会因限帧而下降（这是好事）；
 *   但要判断"某个改动是否让单帧更便宜"，必须用**每帧成本**。
 *
 * ## 本脚本的两个指标
 * 1. **每帧成本** = TaskDuration 增量 / 实际帧数  （单位 ms/帧，**与帧数解耦**）
 *    —— 这个才回答"关 MSAA / 降 dpr 到底省不省"。
 * 2. **忙碌率** = TaskDuration 增量 / 墙钟（≈ 用户看到的 CPU %，含帧数效应）
 *    —— 这个才回答"限帧能降多少 CPU"。
 *
 * 另外用 `requestAnimationFrame` 在**页面内**精确数帧，避免 CDP 往返误差。
 *
 * 用法：node 37_单帧成本归因.js [seconds] [repeat]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = fs.readFileSync(CFG, 'utf8');
const SEC = Number(process.argv[2] || 8);
const REP = Number(process.argv[3] || 3);
const WS = path.resolve(__dirname, '..', 'node_modules', 'ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (u) =>
  new Promise((res, rej) => {
    http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
async function waitCdp(port, t = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    try {
      const l = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const p = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}
function cdp(u) {
  const WebSocket = require(WS);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u, { perMessageDeflate: false, maxPayload: 2e8 });
    let id = 0; const pend = new Map();
    ws.on('open', () => resolve({
      send(m, p = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => pend.set(i, { res, rej })); },
      close: () => ws.close(),
    }));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    });
  });
}
const pick = (res, k) => { const m = res.metrics.find((x) => x.name === k); return m ? m.value : null; };

const NO_AA = `(function(){
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, a){
    if (String(t).indexOf('webgl') === 0 && a && typeof a === 'object') {
      a = Object.assign({}, a, { antialias: false });
    }
    return og.call(this, t, a);
  };
})();`;

/** ★ 关键：**注入后立刻锁死帧率**，让所有变体在**同一帧数**下比较。
 * 这样"每帧成本"的差异才是干净的，不会被"跑多少帧"污染。
 */
const LOCK_30FPS = `(function(){
  var origRAF = window.requestAnimationFrame.bind(window);
  var last = 0, gap = 1000 / 30;
  window.requestAnimationFrame = function(cb){
    return origRAF(function(t){
      if (t - last >= gap) { last = t; cb(t); }
      else { origRAF(function(t2){ cb(t2); }); }
    });
  };
})();`;

async function once(cfg, inject) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbfrm-'));
  const ch = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--window-size=1700,750', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const t = await waitCdp(port);
    const c = await cdp(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Performance.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: 1, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(9000);

    const ready = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv||!cv.width||!cv.height) return JSON.stringify({ok:false,why:'canvas'});
        return JSON.stringify({ok:true});})()`,
      returnByValue: true,
    });
    if (!JSON.parse(ready.result.value || '{}').ok) { c.close(); return { why: 'not ready' }; }

    await sleep(1500);
    // 页面内精确数帧（与 TaskDuration 同一时间窗）
    await c.send('Runtime.evaluate', {
      expression: `(()=>{window.__N__=0;const t0=performance.now();window.__T0__=t0;
        (function cnt(){window.__N__++;if(performance.now()-t0<${SEC * 1000})requestAnimationFrame(cnt);})();
        return 1;})()`,
    });
    const a = await c.send('Performance.getMetrics');
    const w0 = Date.now();
    await sleep(SEC * 1000 + 400);
    const b = await c.send('Performance.getMetrics');
    const wall = (Date.now() - w0) / 1000;
    const fr = await c.send('Runtime.evaluate', {
      expression: `JSON.stringify({n:window.__N__,elapsed:(performance.now()-window.__T0__)/1000})`,
      returnByValue: true,
    });
    c.close();
    const f = JSON.parse(fr.result.value || '{"n":0,"elapsed":0}');
    const dTask = pick(b, 'TaskDuration') - pick(a, 'TaskDuration');
    const dScript = pick(b, 'ScriptDuration') - pick(a, 'ScriptDuration');
    if (!f.n) return { why: 'no frames' };
    return {
      wall: +wall.toFixed(2),
      frames: f.n,
      fps: +(f.n / f.elapsed).toFixed(1),
      busyPct: +((dTask / wall) * 100).toFixed(1),
      msPerFrame: +((dTask * 1000) / f.n).toFixed(2),
      scriptMsPerFrame: +((dScript * 1000) / f.n).toFixed(2),
    };
  } finally {
    ch.kill();
    await sleep(2500);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
  }
}

const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));
const dpr1 = () => { const c = clone(); c.dpr = 1.0; return c; };
const noProbe = () => { const c = clone(); c.probe = { enabled: false, hud: false, crosshair: false }; return c; };
const dpr1NoProbe = () => { const c = noProbe(); c.dpr = 1.0; return c; };

/**
 * ★ 全部变体都锁 30fps —— 只有这样"每帧成本"才是可比的。
 * 最后一组「不限帧」单独用来量"限帧本身降多少忙碌率"。
 */
const cases = [
  ['基线', () => clone(), LOCK_30FPS],
  ['① 关MSAA', () => clone(), NO_AA + '\n' + LOCK_30FPS],
  ['② dpr=1.0', () => dpr1(), LOCK_30FPS],
  ['③ ①+②', () => dpr1(), NO_AA + '\n' + LOCK_30FPS],
  ['⑥ ①+②+关探针', dpr1NoProbe, NO_AA + '\n' + LOCK_30FPS],
  ['★不限帧(仅①+②)', () => dpr1(), NO_AA],
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject] of cases.filter((c) => !ONLY || ONLY.includes(c[0][0]))) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(JSON.stringify(mk(), null, 2), inject);
        runs.push(r);
        process.stdout.write(
          `    ${label.padEnd(18)} #${i + 1}: ${r.msPerFrame ?? 'n/a'}ms/帧  busy=${r.busyPct ?? '-'}%  fps=${r.fps ?? '-'}\n`
        );
      }
      const pf = runs.map((r) => r.msPerFrame).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      const bs = runs.map((r) => r.busyPct).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out.push({
        label,
        msPerFrameRuns: runs.map((r) => r.msPerFrame),
        msPerFrame: pf.length ? +pf[Math.floor(pf.length / 2)].toFixed(2) : NaN,
        pfMin: pf[0], pfMax: pf[pf.length - 1],
        busyPct: bs.length ? bs[Math.floor(bs.length / 2)] : NaN,
        fps: runs.map((r) => r.fps).filter(Boolean).slice(-1)[0] ?? null,
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== 每帧成本（全部锁 30fps，可横向比）===');
  const base = out.find((r) => r.label === '基线');
  for (const r of out) {
    const d = base && base.msPerFrame && !isNaN(r.msPerFrame) ? `单帧${(((r.msPerFrame - base.msPerFrame) / base.msPerFrame) * 100).toFixed(0)}%` : '';
    console.log(`  ${r.label.padEnd(18)} ${String(r.msPerFrame).padStart(6)} ms/帧  [${r.pfMin}~${r.pfMax}]  busy=${r.busyPct}%  fps=${r.fps ?? '-'}  ${d}`);
  }
  fs.writeFileSync(path.join(__dirname, 'perf_perframe.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 perf_perframe.json');
  process.exit(0);
})();