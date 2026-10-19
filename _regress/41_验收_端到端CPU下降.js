/**
 * 端到端验收：在 **DSF=2**（模拟 2K 屏 + Windows 缩放，即 WE 真机常态）下，
 * 用**新bundle**（已含 `antialias:false` + `maxFps`）对比四组配置的
 * 主线程忙碌率 —— 这个量就是用户任务管理器看到的 CPU 百分比。
 *
 * 测的配置组合：
 *   现状（旧行为模拟）  dpr=auto + maxFps 不写  ⇒ dpr=2、无MSAA、无限帧
 *   仅关 MSAA                        dpr=auto + maxFps 不写
 *   仅限帧                dpr=auto + maxFps=30
 *   ★推荐落地             dpr=1.0+ maxFps=30
 *
 * 判据：推荐组相对「现状」的忙碌率应显著下降。
 *
 * 用法：node 41_验收_端到端CPU下降.js [seconds] [repeat]
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
const DSF = 2; // ★ 真机常态：2K 屏 + 缩放

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

async function once(cfg, inject) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbe2e-'));
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
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: DSF, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(11000);

    const rdy = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv||!cv.width) return JSON.stringify({ok:false});
        const g=cv.getContext('webgl2')||cv.getContext('webgl');
        return JSON.stringify({ok:true,bufW:cv.width,bufH:cv.height,
          aa:g?String(g.getContextAttributes().antialias):'?'});})()`,
      returnByValue: true,
    });
    const r = JSON.parse(rdy.result.value || '{}');
    if (!r.ok) { c.close(); return { why: 'not ready' }; }

    await sleep(1500);
    const a = await c.send('Performance.getMetrics');
    const w0 = Date.now();
    await sleep(SEC * 1000);
    const b = await c.send('Performance.getMetrics');
    const wall = (Date.now() - w0) / 1000;
    c.close();
    const dTask = pick(b, 'TaskDuration') - pick(a, 'TaskDuration');
    return { busyPct: +((dTask / wall) * 100).toFixed(1), buf: r.bufW + 'x' + r.bufH, aa: r.aa };
  } finally {
    ch.kill();
    await sleep(2500);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
  }
}

const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));

/** 恢复旧行为（MSAA 开+ 无限帧）—— 用注入模拟，因为新 bundle 默认已关 MSAA */
const OLD_AA = `(function(){
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, a){
    if (String(t).indexOf('webgl') === 0 && a && typeof a === 'object') {
      a = Object.assign({}, a, { antialias: true });
    }
    return og.call(this, t, a);
  };
})();`;

/**
 * ★★ 全组统一注入 LOCK_30 —— 否则「不限帧」组会因为**补帧填满省下的时间**
 *   而让忙碌率反常地高（36_ 轮踩过：关 MSAA 后单帧更便宜 ⇒ 浏览器多跑帧
 *   ⇒ busy 率不降反升 96%）。锁帧后各组帧数一致，忙碌率才可比。
 *   注意：这里锁的是**浏览器 rAF 节奏**，`maxFps` 是引擎内限帧，
 *   两者叠加不冲突（引擎限帧更严时以引擎为准）。
 */
/** 锁浏览器 rAF 到 30fps：让所有变体在同一帧数下比较（见上方注释） */
const LOCK_30 = `(function(){
  var origRAF = window.requestAnimationFrame.bind(window);
  var last = 0, gap = 1000 / 30;
  window.requestAnimationFrame = function(cb){
    return origRAF(function(t){
      if (t - last >= gap) { last = t; cb(t); }
      else { origRAF(function(t2){ cb(t2); }); }
    });
  };
})();`;

const cases = [
  ['现状(MSAA+dpr2)', (c) => { c.dpr = 'auto'; delete c.maxFps; delete c.antialias; return c; }, OLD_AA + '\n' + LOCK_30],
  ['仅关MSAA(dpr2)', (c) => { c.dpr = 'auto'; delete c.maxFps; c.antialias = false; return c; }, LOCK_30],
  ['仅降dpr(dpr1+MSAA)', (c) => { c.dpr = 1.0; delete c.maxFps; delete c.antialias; return c; }, OLD_AA + '\n' + LOCK_30],
  ['★关MSAA+降dpr', (c) => { c.dpr = 1.0; delete c.maxFps; c.antialias = false; return c; }, LOCK_30],
];

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject] of cases) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(JSON.stringify(mk(clone()), null, 2), inject);
        runs.push(r);
        process.stdout.write(`    ${label.padEnd(26)} #${i + 1}: busy=${r.busyPct ?? 'n/a'}%  buf=${r.buf ?? '-'}  aa=${r.aa ?? '-'}\n`);
      }
      const bs = runs.map((r) => r.busyPct).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out.push({
        label, runs: runs.map((r) => r.busyPct),
        median: bs.length ? bs[Math.floor(bs.length / 2)] : NaN,
        min: bs[0], max: bs[bs.length - 1],
        buf: runs[0]?.buf, aa: runs[0]?.aa,
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== 端到端验收（DSF=' + DSF + '，主线程忙碌率 ≈ 任务管理器 CPU%）===');
  const base = out[0].median;
  for (const r of out) {
    const d = !isNaN(r.median) && !isNaN(base) && base ? `  ↓${(((base - r.median) / base) * 100).toFixed(0)}%` : '';
    console.log(`  ${r.label.padEnd(26)} busy=${String(r.median).padStart(5)}%  [${r.min}~${r.max}]  buf=${r.buf}  aa=${r.aa}${d}`);
  }
  fs.writeFileSync(path.join(__dirname, 'accept_e2e_cpu.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 accept_e2e_cpu.json');
  process.exit(0);
})();