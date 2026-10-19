/**
 * 修正上一轮的**错误结论**：dpr 到底值多少。
 *
 * ## 为什么要重测（重要纠错）
 * 第一轮报告写「dpr:auto→固定 1.0 提速 2.6×」。**那是错的。**
 * 原因：所有旧脚本的 `Emulation.setDeviceMetricsOverride` 都写了 `deviceScaleFactor: 1`
 *⇒ `window.devicePixelRatio === 1` ⇒ `resolveDpr('auto')` 返回 **1.0**
 *⇒ 「auto」与「固定 1.0」**渲染完全相同的缓冲**，测到的 2.6× 差异**纯属噪声**
 *   （后续用主线程忙碌率重测，dpr=1.0 与基线持平，已证伪）。
 *
 * ## 本脚本测什么
 * 在 `deviceScaleFactor=2`（模拟 2K 屏 + Windows 缩放 150~200%，也就是 WE 真机的常态）下：
 *   · auto  ⇒ dpr=2   ⇒ 缓冲 3400×1500 = 510万像素
 *   · 1.0   ⇒ dpr=1   ⇒ 缓冲 1700×750  = 128万像素（**1/4 像素量**）
 * 这才是 dpr 该发挥作用的场景，也是用户实际会遇到的情况。
 *
 * 全部锁 30fps（`37_` 已证：不限帧时浏览器会自己补帧，掩盖单帧差异）。
 *
 * 用法：node 38_修正_dpr真实收益.js [seconds] [repeat]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = fs.readFileSync(CFG, 'utf8');
const SEC = Number(process.argv[2] || 7);
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

async function once(cfg, inject, dsf) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdpr-'));
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
    // ★★ 关键：这里必须是 2，否则 auto 与 1.0 完全等价（就是上轮出错的原因）
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: dsf, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(10000);

    const ready = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv||!cv.width||!cv.height) return JSON.stringify({ok:false,why:'canvas'});
        return JSON.stringify({ok:true,bufW:cv.width,bufH:cv.height,dpr:window.devicePixelRatio});})()`,
      returnByValue: true,
    });
    const rdy = JSON.parse(ready.result.value || '{}');
    if (!rdy.ok) { c.close(); return { why: rdy.why }; }

    await sleep(1500);
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
    if (!f.n) return { why: 'no frames' };
    const dTask = pick(b, 'TaskDuration') - pick(a, 'TaskDuration');
    return {
      bufW: rdy.bufW, bufH: rdy.bufH, dpr: rdy.dpr,
      frames: f.n, fps: +(f.n / f.elapsed).toFixed(1),
      busyPct: +((dTask / wall) * 100).toFixed(1),
      msPerFrame: +((dTask * 1000) / f.n).toFixed(2),
    };
  } finally {
    ch.kill();
    await sleep(2500);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
  }
}

const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));
const setDpr = (v) => { const c = clone(); c.dpr = v; return c; };

/** 在 DSF=2 下：auto(⇒dpr2) vs 固定 1.0 vs 固定 1.5，各配/不配 MSAA */
const cases = [
  ['DSF2 auto(dpr2)+MSAA', () => setDpr('auto'), LOCK_30FPS, 2],
  ['DSF2 dpr1.0 +MSAA', () => setDpr(1.0), LOCK_30FPS, 2],
  ['DSF2 auto(dpr2) 关MSAA', () => setDpr('auto'), NO_AA + '\n' + LOCK_30FPS, 2],
  ['DSF2 dpr1.0 关MSAA', () => setDpr(1.0), NO_AA + '\n' + LOCK_30FPS, 2],
  ['DSF1.5 auto(dpr1.5)', () => setDpr('auto'), LOCK_30FPS, 1.5],
  ['DSF1.5 dpr1.0', () => setDpr(1.0), LOCK_30FPS, 1.5],
];

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject, dsf] of cases) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(JSON.stringify(mk(), null, 2), inject, dsf);
        runs.push(r);
        process.stdout.write(
          `    ${label.padEnd(24)} #${i + 1}: ${r.msPerFrame ?? 'n/a'}ms/帧  buf=${r.bufW ?? '-'}x${r.bufH ?? '-'}  dpr=${r.dpr ?? '-'}  busy=${r.busyPct ?? '-'}%\n`
        );
      }
      const pf = runs.map((r) => r.msPerFrame).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out.push({
        label, dsf,
        runs: runs.map((r) => r.msPerFrame),
        msPerFrame: pf.length ? +pf[Math.floor(pf.length / 2)].toFixed(2) : NaN,
        min: pf[0], max: pf[pf.length - 1],
        buf: runs[0]?.bufW + 'x' + runs[0]?.bufH,
        busy: runs.map((r) => r.busyPct).filter((x) => !isNaN(x)).sort((a, b) => a - b)[Math.floor(REP / 2)],
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== dpr 真实收益（全部锁 30fps）===');
  for (const r of out) {
    console.log(`  ${r.label.padEnd(24)} ${String(r.msPerFrame).padStart(6)} ms/帧  [${r.min}~${r.max}]  缓冲=${r.buf}  busy=${r.busy}%`);
  }
  console.log('\n--- 关键对比 ---');
  const g = (n) => out.find((r) => r.label.includes(n));
  const a = g('auto(dpr2)+MSAA'), b = g('dpr1.0 +MSAA');
  const c = g('auto(dpr2) 关MSAA'), d = g('dpr1.0 关MSAA');
  const cmp = (x, y, n) => {
    if (!x || !y || !x.msPerFrame || !y.msPerFrame) return;
    console.log(`  ${n}: ${x.msPerFrame} → ${y.msPerFrame} ms/帧  省 ${(((x.msPerFrame - y.msPerFrame) / x.msPerFrame) * 100).toFixed(0)}%`);
  };
  cmp(a, b, 'DSF2 降dpr (开MSAA)');
  cmp(c, d, 'DSF2 降dpr (关MSAA)');
  const e = g('DSF1.5 auto'), f = g('DSF1.5 dpr1.0');
  cmp(e, f, 'DSF1.5 降dpr');
  fs.writeFileSync(path.join(__dirname, 'perf_dpr_fix.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 perf_dpr_fix.json');
  process.exit(0);
})();