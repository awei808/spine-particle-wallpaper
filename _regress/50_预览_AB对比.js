/**
 * 本地预览服务器 —— **同时起两个端口，便于直接对比效果**。
 *
 * 为什么要两个：当前 config 是「关 MSAA + maxFps 60」，用户想先看效果再决定。
 * 单端口只能看一个状态，没法A/B。所以：
 *   · **8931** = 现状（`antialias:true` + 无 `maxFps`）—— 改动前的原始行为
 *   · **8932** = 优化后（读`dist/assets/config.json` 实际值）
 *
 * 做法：起两个 `http.server`，但给 8931 那份用一个**临时目录**（软链/拷贝 dist 内容，
 *   config 被改回旧值），8932 直接serve 真实 dist。
 * ★ 不动仓库里的任何文件：8931 的副本建在系统 Temp 下。
 *
 * 用法：node50_预览_AB对比.js
 *   → 打印两个 URL；Ctrl-C 结束。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DIST = path.resolve(__dirname, '..', 'dist');
const PY = process.env.PY || 'C:/Users/19342/.workbuddy/binaries/python/versions/3.14.3/python.exe';
const PORT_OLD = 8931; // 现状
const PORT_NEW = 8932; // 优化后

/** 手写递归拷贝（记忆：本机 shutil.rmtree 不可用，走回收站会失败） */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-old-'));
copyDir(DIST, mirror);

// 把镜像里的 config 改回「改动前」的状态
const cfgPath = path.join(mirror, 'assets', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''));
delete cfg.maxFps;
delete cfg.antialias;
cfg.probe = { enabled: true, hud: false, crosshair: false }; // 关HUD 免得干扰看画面
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log('[镜像] 已还原为改动前状态：无 maxFps / 无 antialias');

// 真实 dist 也关掉探针 HUD，避免"画面上有调试字"影响对比
const realCfgPath = path.join(DIST, 'assets', 'config.json');
const realRaw = fs.readFileSync(realCfgPath, 'utf8');
const realCfg = JSON.parse(realRaw.replace(/^﻿/, ''));
const hadProbe = JSON.stringify(realCfg.probe);
realCfg.probe = { enabled: true, hud: false, crosshair: false };
fs.writeFileSync(realCfgPath, JSON.stringify(realCfg, null, 2), 'utf8');
process.on('exit', () => {
  //退出时还原真实 dist 的 config（避免留下改动）
  try {
    fs.writeFileSync(realCfgPath, realRaw, 'utf8');
    console.log('[还原] dist/assets/config.json 已恢复');
  } catch (e) {}
  try {
    const rm = (d) => {
      for (const f of fs.readdirSync(d)) {
        const fp = path.join(d, f);
        if (fs.statSync(fp).isDirectory()) rm(fp);
        else fs.unlinkSync(fp);
      }
      fs.rmdirSync(d);
    };
    rm(mirror);
  } catch (e) {}
});

const kids = [
  spawn(PY, ['-m', 'http.server', String(PORT_OLD), '--bind', '127.0.0.1'], { cwd: mirror, stdio: 'ignore' }),
  spawn(PY, ['-m', 'http.server', String(PORT_NEW), '--bind', '127.0.0.1'], { cwd: DIST, stdio: 'ignore' }),
];

setTimeout(() => {
  const real = JSON.parse(fs.readFileSync(realCfgPath, 'utf8').replace(/^﻿/, ''));
  console.log('\n══════════════════════════════════════════════');
  console.log('  A/B 预览已启动（Ctrl-C 结束）');
  console.log('──────────────────────────────────────────────');
  console.log(`  现状（改动前）: http://127.0.0.1:${PORT_OLD}/index.html`);
  console.log(`      无 maxFps · MSAA 开 · dpr=auto`);
  console.log('');
  console.log(`  优化后        : http://127.0.0.1:${PORT_NEW}/index.html`);
  console.log(`      maxFps=${real.maxFps} · antialias=${real.antialias} · dpr=${real.dpr}`);
  console.log('══════════════════════════════════════════════\n');
}, 1500);

process.on('SIGINT', () => {
  kids.forEach((k) => k.kill());
  process.exit(0);
});