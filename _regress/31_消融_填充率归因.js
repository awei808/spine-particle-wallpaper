/**
 * 消融实验（干净版）：用**config 变体**逐项关掉可疑因素，量帧节奏变化。
 *
 * 为什么改 config 而不是打运行时补丁：`dpr` / `meshes` 都是 config 驱动的，
 * 改 config 走的是真实加载路径，结论能直接当优化建议用。
 *
 * 变体：
 *   A基线      — 原样
 *   B  dpr=1   — 关掉 dpr=auto 的放大（像素量线性下降）
 *   C  dpr=0.5 — 像素量 1/4（若帧时间大幅下降 ⇒ 主因是填充率）
 *   D  0 张贴图— 只留骨架+粒子（量12 层全屏透明的overdraw 占比）
 *   E  1 张贴图— 12→1 层（与 D 对照，验证 overdraw 是否随层数线性）
 *   F  dpr=2   — 像素量 4x（反向验证 C 的结论）
 *
 * 判据：
 *   - C 明显变快 + F 明显变慢 ⇒ **填充率是主因**（优化= 降 dpr / 减层 / 关 AA）
 *   - D/E 变快幅度随层数线性⇒ overdraw 主导
 *   - 各变体几乎无差        ⇒ CPU 在别处（回查 30_ 的 profile）
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', 'dist');
const ASSETS = path.join(ROOT, 'assets');
const ORIG_CFG = path.join(ASSETS, 'config.json');
const ORIG = JSON.parse(fs.readFileSync(ORIG_CFG, 'utf8').replace(/^﻿/, ''));

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitCdp(port, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
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

async function measure(label, cfg, seconds) {
  fs.writeFileSync(ORIG_CFG, JSON.stringify(cfg, null, 2), 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbabl-'));
  const chrome = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profileDir,
      '--window-size=1700,750',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    const target = await waitCdp(port);
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1700,
      height: 750,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(9000);
    await c.send('Runtime.evaluate', {
      expression: `(() => {
        window.__P__ = [];
        let last = performance.now(); const t0 = last;
        function loop(){
          const now = performance.now();
          window.__P__.push(now-last); last = now;
          if (now - t0 < ${seconds * 1000}) requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop); return 1;
      })()`,
    });
    await sleep(seconds * 1000 + 500);
    const g = await c.send('Runtime.evaluate', {
      expression: `(() => {
        const s = window.__P__.slice(2).sort((a,b)=>a-b);
        if (!s.length) return '';
        const cv = document.querySelector('canvas');
        return JSON.stringify({
          n: s.length,
          mean: +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),
          p50: +s[Math.floor(s.length*0.5)].toFixed(2),
          p90: +s[Math.floor(s.length*0.9)].toFixed(2),
          canvas: cv ? cv.width+'x'+cv.height : '?'
        });
      })()`,
      returnByValue: true,
    });
    c.close();
    if (!g.result.value) return { label, mean: NaN, note: 'no samples' };
    return { label, ...JSON.parse(g.result.value) };
  } finally {
    chrome.kill();
    await sleep(700);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

const clone = () => JSON.parse(JSON.stringify(ORIG));
const variants = [
  ['A 基线 dpr=auto', () => clone()],
  ['B dpr=1.0', () => { const c = clone(); c.dpr = 1.0; return c; }],
  ['C dpr=0.5', () => { const c = clone(); c.dpr = 0.5; return c; }],
  ['D dpr=2.0', () => { const c = clone(); c.dpr = 2.0; return c; }],
  [
    'E 12层→1层',
    () => {
      const c = clone();
      const tex = c.meshes.filter((m) => m.type === 'texture');
      c.meshes = c.meshes.filter((m) => m.type !== 'texture').concat([tex[0]]);
      return c;
    },
  ],
  [
    'F 去掉全部贴图层',
    () => {
      const c = clone();
      c.meshes = c.meshes.filter((m) => m.type !== 'texture');
      return c;
    },
  ],
  [
    'G 去掉粒子层',
    () => {
      const c = clone();
      c.meshes = c.meshes.filter((m) => m.type !== 'particle');
      return c;
    },
  ],
  [
    'H 关探针HUD',
    () => {
      const c = clone();
      c.probe = { enabled: false, hud: false, crosshair: false };
      return c;
    },
  ],
  [
    'I 关拖尾',
    () => {
      const c = clone();
      c.pointerTrail = { enabled: false };
      return c;
    },
  ],
];

(async () => {
  const SEC = Number(process.argv[2] || 8);
  const out = [];
  try {
    for (const [label, mk] of variants) {
      const r = await measure(label, mk(), SEC);
      out.push(r);
      const m = r.mean;
      console.log(
        `  ${label.padEnd(18)} mean=${isNaN(m) ? '  n/a' : m.toFixed(2) + 'ms'}  p50=${
          r.p50 ?? 'n/a'
        }  canvas=${r.canvas ?? '?'}  fps=${isNaN(m) ? 'n/a' : (1000 / m).toFixed(1)}`
      );
    }
  } finally {
    fs.writeFileSync(ORIG_CFG, JSON.stringify(ORIG, null, 2), 'utf8'); // 还原
    console.log('\nconfig.json 已还原');
  }
  const base = out[0]?.mean;
  out.forEach((r) => {
    if (!isNaN(r.mean) && !isNaN(base)) r.speedup = +(((base - r.mean) / base) * 100).toFixed(1);
  });
  fs.writeFileSync(path.join(__dirname, 'perf_ablation.json'), JSON.stringify(out, null, 2));
  console.log('已写 perf_ablation.json（含各变体相对基线的提速 %）');
  process.exit(0);
})();