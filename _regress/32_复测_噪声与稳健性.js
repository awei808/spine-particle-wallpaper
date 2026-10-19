/**
 * 重复性验证：`31_` 的消融噪声不小（dpr=1.0 竟比基线慢 17.6%，
 * 而 headless 软渲染下 auto 与 1.0 本应完全相同 ⇒ 那是噪声）。
 *
 * 本脚本只测 3 组，每组重复 N 次，报 **中位数 + 极差**，
 * 用来判断 31_ 里的结论哪些是真信号、哪些是抖动。
 *
 * 判据：若某变体的中位数远高于基线极差 ⇒ 结论可信；
 *       若落在极差内 ⇒ 不能当优化依据。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', 'dist');
const CFG = path.join(ROOT, 'assets', 'config.json');
const ORIG = JSON.parse(fs.readFileSync(CFG, 'utf8').replace(/^﻿/, ''));
const REPEAT = Number(process.argv[2] || 3);
const SEC = Number(process.argv[3] || 6);

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
    let id = 0;
    const pend = new Map();
    ws.on('open', () =>
      resolve({
        send(m, p = {}) {
          const i = ++id;
          ws.send(JSON.stringify({ id: i, method: m, params: p }));
          return new Promise((res, rej) => pend.set(i, { res, rej }));
        },
        close: () => ws.close(),
      })
    );
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id);
        pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  });
}

async function once(label, cfg) {
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbrep-'));
  const ch = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
      '--window-size=1700,750', '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required', 'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    const t = await waitCdp(port);
    const c = await cdp(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: 1, mobile: false });
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
        if(!s.length)return '';const cv=document.querySelector('canvas');
        return JSON.stringify({mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),
          p50:+s[Math.floor(s.length*0.5)].toFixed(2),canvas:cv?cv.width+'x'+cv.height:'?'});})()`,
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
const groups = [
  ['基线(12层+dpr auto)', () => clone()],
  ['dpr=0.5', () => { const c = clone(); c.dpr = 0.5; return c; }],
  ['12层→1层', () => { const c = clone(); const t = c.meshes.filter(m => m.type === 'texture'); c.meshes = c.meshes.filter(m => m.type !== 'texture').concat([t[0]]); return c; }],
  ['去掉全部贴图层', () => { const c = clone(); c.meshes = c.meshes.filter(m => m.type !== 'texture'); return c; }],
];

(async () => {
  const out = {};
  try {
    for (const [label, mk] of groups) {
      const runs = [];
      for (let i = 0; i < REPEAT; i++) {
        const r = await once(label, mk());
        runs.push(r.mean);
        process.stdout.write(`    ${label} #${i + 1}: ${r.mean}ms\n`);
      }
      const valid = runs.filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out[label] = {
        runs,
        median: valid.length ? valid[Math.floor(valid.length / 2)] : NaN,
        min: valid[0], max: valid[valid.length - 1],
      };
    }
  } finally {
    fs.writeFileSync(CFG, JSON.stringify(ORIG, null, 2), 'utf8');
  }
  console.log('\n=== 汇总（中位数 / 极差）===');
  for (const [k, v] of Object.entries(out)) {
    console.log(`  ${k.padEnd(22)} median=${v.median}ms  [${v.min} ~ ${v.max}]  runs=${JSON.stringify(v.runs)}`);
  }
  fs.writeFileSync(path.join(__dirname, 'perf_repeat.json'), JSON.stringify(out, null, 2));
  console.log('\n已写 perf_repeat.json');
  process.exit(0);
})();