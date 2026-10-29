/**
 * 把 `demo/S9_盛夏游乐场/` 组装成一份 **GitHub Pages 静态站**（demo 展示页）。
 *
 * ```bash
 * npx ts-node --transpile-only scripts/deployPages.ts "<目标目录>"
 * PAGES_DIR="<目标目录>" npx ts-node --transpile-only scripts/deployPages.ts
 * ```
 *
 * ## 产出物就是"一个能直接发布的静态站"
 *
 * ```
 * <目标目录>/
 *   index.html       ← pages/index.html（展示页外壳：入场门 + 薄 UI）
 *   bundle.js        ← 来自 demo 工程（已构建，不含 sourcemap）
 *   preview.jpg      ← 既是 WE 预览图，也被展示页当海报背景 / og:image 复用
 *   .nojekyll        ← 关掉 Jekyll，否则 GitHub Pages 会漏判某些路径
 *   assets/          ← 整个素材目录（config.json / events.jsonc / spine 三件套 / 贴图 / 语音 / BGM）
 * ```
 *
 * ## 为什么根目录必须平铺（不能套 `S9_盛夏游乐场/` 子目录）
 *
 * `src/constants.ts` 写死了 `ASSET_PATH = './assets/'` —— 相对**当前页面**，不是相对仓库根。
 * 页面在根 ⇒ `assets/` 必须也在根。同理 `bundle.js` 必须与 `index.html` 同级。
 * 这是 WE 壁纸目录的形态，Pages 这边照抄它最省事：一份产出，两个用途都对得上。
 *
 * ## ★ 这里会向 `assets/` 里额外写 `manifest.json`
 *
 * 从 `config.json` 反查出"画面出现之前必须到位"的文件清单（贴图 / 骨架 / atlas + 同名 png /
 * 拖尾贴图 / 气泡贴图 / config / events / bundle.js），连同**字节数**一起写进
 * `assets/manifest.json`。展示页靠它做真实的字节加权进度条。
 *
 * 为什么在这里算而不是让页面运行时解析 config：字节数只有打包时才知道，
 * 而按"文件个数"算进度会严重失真 —— 3.6MB 的 BGM 和 5KB 的星点贴图根本不是一个量级。
 *
 * 音频（BGM）**不进**画面必需组：单曲 3.6MB，让它跟画面并行在后台下，
 * 不为它多等一秒。语音更是按需拉取，只下抽到的那一条。
 *
 * ## ★ 这里唯一会改动素材内容的地方：`probe`
 *
 * demo 的 `config.json` 里 `probe: {enabled: true, hud: true}` —— 那是给作者在本机调试用的。
 * 公网 demo 必须**两个都关**：
 *
 * - `hud: true` 会在屏幕边上挂一层诊断数字，第一眼就出戏；
 * - `enabled: true` 会让 `probeEnabled` 缺省为真 ⇒ 右上角「调试」入口一进去就是开着的，
 *   还会把 `__WB_DIALOGUE__` / `__WB_FX__` 挂到 window 上。
 *
 * ⚠️ 代价：线上出问题时失去了那两个调试抓手。取舍是明确的 —— 面向访客的展示页，
 *   默认状态的整洁 > 作者的远程排查便利。真要排查，临时在本地跑一份改回 true 的包即可。
 *
 * 除此之外**一个字节都不改** —— 尤其是 `events.jsonc` 和各图层数值：Pages 上看到的
 * 必须跟在 WE 里看到的逐像素一致，否则这个 demo 就失去了"所见即所得"的意义。
 *
 * ## 幂等与安全
 *
 * - 复制口径分两级：
 *     · `assets/` 整棵**替换** —— 它完全由本脚本从 demo 工程复制而来。若做成"只增不删"，
 *       demo 里删掉的贴图会在 Pages 上长期残留，两边就不逐字节一致了。
 *     · 顶层其它文件一律**保留**（在 WE 语境下 `project.json`、手工改的预览图等不属于本脚本)。
 * - 不做 git 操作。提交/推送另说（见 `pages/README.md`）。
 */

import * as fs from 'fs';
import * as path from 'path';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => a.charAt(0) !== '-');

const repoRoot = path.resolve(__dirname, '..');
const shellDir = path.join(repoRoot, 'pages');
const demoDir = path.join(repoRoot, 'demo', 'S9_盛夏游乐场');

const target = path.resolve(positional[0] || process.env.PAGES_DIR || '');

if (!positional[0] && !process.env.PAGES_DIR) {
  console.error(
    '[deployPages] 缺目标目录。用法：\n' +
      '  npx ts-node --transpile-only scripts/deployPages.ts "<目标目录>"\n' +
      '  或设 PAGES_DIR 环境变量'
  );
  process.exit(2);
}

/** 前置校验：缺哪一样都别开写，免得产出一半人不放 github */
const need = (abs: string, what: string) => {
  if (!fs.existsSync(abs)) {
    console.error('[deployPages] 找不到 ' + what + '：' + abs);
    process.exit(2);
  }
};
need(path.join(shellDir, 'index.html'), '展示页外壳 pages/index.html');
need(path.join(demoDir, 'bundle.js'), 'demo 工程的 bundle.js');
need(path.join(demoDir, 'preview.jpg'), 'demo 工程的 preview.jpg');
need(path.join(demoDir, 'assets', 'config.json'), 'demo 工程的 assets/config.json');

fs.mkdirSync(target, { recursive: true });

const bytes = (p: string) => fs.statSync(p).size;
const kb = (n: number) => (n / 1024).toFixed(0) + ' KB';

/* ------------------------------------------------------------------ */
/* 1. 外壳与顶层产物                                                    */
/* ------------------------------------------------------------------ */
fs.copyFileSync(path.join(shellDir, 'index.html'), path.join(target, 'index.html'));
fs.copyFileSync(path.join(demoDir, 'bundle.js'), path.join(target, 'bundle.js'));
fs.copyFileSync(path.join(demoDir, 'preview.jpg'), path.join(target, 'preview.jpg'));
// Jekyll 会跳过它认为"非站点内容"的路径；直接关掉最省事，网址也少一层重定向。
fs.writeFileSync(path.join(target, '.nojekyll'), '', 'utf8');

/* ------------------------------------------------------------------ */
/* 2. 素材树                                                            */
/* ------------------------------------------------------------------ */
let fileCount = 0;
let totalBytes = 0;
let biggest = { name: '', size: 0 };

const copyTree = (from: string, to: string) => {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((d) => {
    const src = path.join(from, d.name);
    const dst = path.join(to, d.name);
    if (d.isDirectory()) {
      copyTree(src, dst);
      return;
    }
    fs.copyFileSync(src, dst);
    const n = bytes(src);
    fileCount += 1;
    totalBytes += n;
    if (n > biggest.size) biggest = { name: d.name, size: n };
  });
};

const assetTarget = path.join(target, 'assets');
fs.rmSync(assetTarget, { recursive: true, force: true });
copyTree(path.join(demoDir, 'assets'), assetTarget);

/* ------------------------------------------------------------------ */
/* 3. 资源清单 manifest.json（供展示页做真实加载进度，详见文件头）          */
/* ------------------------------------------------------------------ */
/**
 * 从 config 里反查出"画面出现之前必须到位"的文件。
 *
 * 为什么不顺便加上 voice/*.ogg：语音是**按需**拉的（抽到哪条才下哪条），
 * 首屏为了它们多等 2MB 不划算；BGM 同理，单曲 3.6MB，让它跟画面并行、后台慢慢下。
 */
const rel = (p: string) => p.replace(/^\.\//, '').replace(/\\/g, '/');

const collectVisual = (cfg: any): string[] => {
  const files = new Set<string>();
  const push = (p?: string | null) => {
    if (p) files.add('assets/' + rel(String(p)));
  };
  // 这两个是 bundle 启动时自己要 fetch 的，预取掉能省一次往返
  files.add('assets/config.json');
  files.add('assets/events.jsonc');
  (cfg.meshes ?? []).forEach((m: any) => {
    push(m.textureFileName);
    push(m.skeletonFileName);
    push(m.maskFileName);
    if (m.atlasFileName) {
      push(m.atlasFileName);
      // .atlas 只描述切图，真正的像素在同名的 .png 里
      push(String(m.atlasFileName).replace(/\.atlas$/i, '.png'));
    }
  });
  (cfg.pointerTrail?.emitters ?? []).forEach((e: any) => push(e.textureFileName));
  push(cfg.subtitle?.skin?.image);
  return [...files].filter((f) => fs.existsSync(path.join(target, f)));
};

const collectAudio = (cfg: any): string[] => {
  const out: string[] = [];
  if (cfg.bgm?.enabled !== false && cfg.bgm?.file) {
    out.push(rel(String(cfg.bgm.path ?? './assets/bgm/') + cfg.bgm.file));
  }
  return out.filter((f) => fs.existsSync(path.join(target, f)));
};

const cfgPath = path.join(assetTarget, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const manifest = {
  generatedBy: 'scripts/deployPages.ts',
  note: '展示页专用资源清单：字节数用于加权进度条。改了 config.json 的贴图/骨架后重跑本脚本。',
  visual: collectVisual(cfg).map((p) => ({ p, n: bytes(path.join(target, p)) })),
  audio: collectAudio(cfg).map((p) => ({ p, n: bytes(path.join(target, p)) })),
};

/* ------------------------------------------------------------------ */
/* 4. 发布态覆盖：调试功能默认关闭（详见文件头）                           */
/* ------------------------------------------------------------------ */
const probeBefore = JSON.stringify(cfg.probe ?? null);
cfg.probe = { enabled: false, hud: false };
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

// 清单必须在 probe 覆盖**之后**写：两者读的是同一份 config，顺序反了会漏。
manifest.visual.push({ p: 'bundle.js', n: bytes(path.join(target, 'bundle.js')) });
const visualBytes = manifest.visual.reduce((s, e) => s + e.n, 0);
fs.writeFileSync(
  path.join(assetTarget, 'manifest.json'),
  JSON.stringify({ ...manifest, visualBytes }, null, 1),
  'utf8'
);

/* ------------------------------------------------------------------ */
/* 5. 自检报告                                                          */
/* ------------------------------------------------------------------ */
const voiceN = fs.existsSync(path.join(assetTarget, 'voice'))
  ? fs.readdirSync(path.join(assetTarget, 'voice')).length
  : 0;
const bgmN = fs.existsSync(path.join(assetTarget, 'bgm'))
  ? fs.readdirSync(path.join(assetTarget, 'bgm')).length
  : 0;

let failed = false;
const check = (ok: boolean, label: string) => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label);
  if (!ok) failed = true;
};

console.log('[deployPages] ' + target);
console.log(
  '  ' + (fileCount + 4) + ' 个文件 · ' + (totalBytes / 1024 / 1024).toFixed(1) + ' MB（含 ' +
    kb(bytes(path.join(target, 'bundle.js'))) + ' 的 bundle.js）'
);
console.log('  最大单文件：' + biggest.name + ' ' + kb(biggest.size));
check(fs.existsSync(path.join(target, 'index.html')), 'index.html 已写入');
check(fs.existsSync(path.join(target, 'bundle.js')), 'bundle.js 与页面同级');
check(fs.existsSync(path.join(target, 'preview.jpg')), 'preview.jpg（og:image + 海报背景）');
check(fs.existsSync(path.join(target, '.nojekyll')), '.nojekyll');
check(fs.existsSync(path.join(assetTarget, 'events.jsonc')), 'assets/events.jsonc（缺此 ⇒ 从不说话）');
check(
  fs.existsSync(path.join(assetTarget, 'SoulDress_Asuna_09.skel')),
  'assets/SoulDress_Asuna_09.skel（主骨架）'
);
console.log('  语音 ' + voiceN + ' 条 · BGM ' + bgmN + ' 首');
console.log('  probe: ' + probeBefore + ' → ' + JSON.stringify(cfg.probe) + '（调试默认关闭）');
console.log(
  '  manifest: 画面必需 ' +
    manifest.visual.length +
    ' 项 / ' +
    kb(visualBytes) +
    '（预热）· 音频 ' +
    manifest.audio.length +
    ' 项（后台并行，不阻塞出画面）'
);
// 清单里出现 0 字节的文件，说明 config 引用了不存在的资源 —— 线上会卡在进度条上
const emptyInManifest = manifest.visual.filter((e) => e.n === 0);
if (emptyInManifest.length) {
  console.error('  ★ manifest 里有 0 字节条目：' + emptyInManifest.map((e) => e.p).join(', '));
  failed = true;
}

const totalWithBundle =
  totalBytes + bytes(path.join(target, 'bundle.js')) + bytes(path.join(target, 'preview.jpg'));
if (bytes(path.join(target, 'bundle.js')) > 25 * 1024 * 1024) {
  console.error('  ★ bundle.js 超过 25MB，GitHub Pages 会很慢');
  failed = true;
}
if (totalWithBundle > 900 * 1024 * 1024) {
  console.error('  ★ 总体积逼近 1GB，GitHub Pages 会告警');
  failed = true;
}

if (failed) {
  console.error('[deployPages] 自检未通过，先别推。');
  process.exit(1);
}
console.log('[deployPages] 完成。提交推送的下一步见 pages/README.md。');
