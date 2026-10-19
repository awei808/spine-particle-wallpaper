/**
 * 定点复测：`31_` 里两个高价值但噪声大的结论，单独复测。
 *
 * 1. **探针 HUD** —— `config.json` 的 `probe:{enabled:true, hud:true}` 是**发布态缺省**，
 *    而 `probe.ts` 的 tick **每帧 rAF 改 DOM 文本** + crosshair 每帧 move。
 *    在 WE 的 CEF 里，DOM 文本改动会触发合成，是真实成本。需确认关掉它值多少。
 * 2. **antialias** —— `initScene.ts:450` 写死 `new WebGLRenderer({antialias:true})`，
 *    MSAA 4×采样直接乘在填充率上。config 改不到，只能注入拦截 `getContext`。
 *
 * 注入方式：`Page.addScriptToEvaluateOnNewDocument` 在three 建renderer **之前**
 * 挂 `HTMLCanvasElement.prototype.getContext` 包装 —— 这比改源码轻，且不碰仓库。
 *
 * 判据：每组 3 次看中位数与极差是否分离；分离才当结论。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = JSON.parse(fs.readFileSync(CFG, 'utf8').replace(/^﻿/, ''));
const REPEAT = Number(process.argv[2] || 3);
const SEC = Number(process.argv[3] || 6);

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
  const WebSocket = require('ws');
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

/** 强制 WebGL 上下文关掉 MSAA（在 three 建 renderer 之前生效） */
const PATCH_NO_AA = `
(function(){
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attrs){
    if (String(type).indexOf('webgl') === 0 && attrs && typeof attrs === 'object') {
      attrs = Object.assign({}, attrs, { antialias: false });
    }
    return orig.call(this, type, attrs);
  };
})();`;

async function once(label, cfg, inject) {
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbfix-'));
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
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: 1, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(9000);
    await c.send('Runtime.evaluate', {
      expression: `(()=>{window.__P__=[];let l=performance.now();const t0=l;
        function f(){const n=performance.now();window.__P__.push(n-l);l=n;
          if(n-t0<${SEC * 1000})requestAnimationFrame(f);}
        requestAnimationFrame(f);return 1;})()`,
    });
    await sleep(SEC * 1000 + 400);
    const g = await c.send('Runtime.evaluate', {
      expression: `(()=>{const s=window.__P__.slice(2).sort((a,b)=>a-b);
        if(!s.length)return '';
        const probeEl=document.querySelector('[id*=probe],[class*=probe]');
        return JSON.stringify({mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),
          p50:+s[Math.floor(s.length*0.5)].toFixed(2),
          domCount:document.getElementsByTagName('*').length,
          probeFound:!!probeEl});})()`,
      returnByValue: true,
    });
    c.close();
    return g.result.value ? JSON.parse(g.result.value) : { mean: NaN };
  } finally {
    ch.kill();
    await sleep(700);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

const clone = () => JSON.parse(JSON.stringify(ORIG));
const noProbe = () => { const c = clone(); c.probe = { enabled: false, hud: false, crosshair: false }; return c; };
const noTrail = () => { const c = clone(); c.pointerTrail = { enabled: false }; return c; };

const groups = [
  ['基线', () => clone(), null],
  ['关探针HUD', noProbe, null],
  ['关MSAA(注入)', () => clone(), PATCH_NO_AA],
  ['关拖尾', noTrail, null],
  ['关探针+关MSAA', () => { const c = noProbe(); return c; }, PATCH_NO_AA],
];

(async () => {
  const out = {};
  try {
    for (const [label, mk, inject] of groups) {
      const runs = [];
      for (let i = 0; i < REPEAT; i++) {
        const r = await once(label, mk(), inject);
        runs.push(r.mean);
        process.stdout.write(`    ${label} #${i + 1}: ${r.mean}ms  dom=${r.domCount} probe=${r.probeFound}\n`);
      }
      const v = runs.filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out[label] = { runs, median: v.length ? v[Math.floor(v.length / 2)] : NaN, min: v[0], max: v[v.length - 1] };
    }
  } finally {
    fs.writeFileSync(CFG, JSON.stringify(ORIG, null, 2), 'utf8');
  }
  console.log('\n=== 汇总（中位数 / 极差）===');
  for (const [k, v] of Object.entries(out)) {
    console.log(`  ${k.padEnd(18)} median=${String(v.median).padStart(6)}ms  [${v.min} ~ ${v.max}]  ${JSON.stringify(v.runs)}`);
  }
  fs.writeFileSync(path.join(__dirname, 'perf_targeted.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig.json 已还原；已写 perf_targeted.json');
  process.exit(0);
})();