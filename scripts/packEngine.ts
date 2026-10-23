/**
 * 把 `dist/` 整理成一个**可直接分发的引擎包**（zip），供不想编译的人使用。
 *
 * ```bash
 * npm run pack                                   # 构建 + 打包
 * npx ts-node --transpile-only scripts/packEngine.ts --out D:/tmp/engine.zip
 * npx ts-node --transpile-only scripts/packEngine.ts --keep   # 保留中间目录
 * ```
 *
 * ## 为什么不能直接把 `dist/` 发出去
 *
 * `webpack.common.js` 的 `CopyPlugin` 把**整个 `public/`** 拷进 `dist/`，包括
 * `public/assets/`。而 `public/assets/` 在你本机是**放着真实素材的**（只是被
 * gitignore 了），所以 `dist/assets/` 里会混进工程素材、测试贴图、语音……
 * 直接打包等于把本地素材当成引擎的一部分散出去。
 *
 * 本脚本只挑**与素材无关的引擎文件**，并重建一个空的 `assets/`（只放模板），
 * 于是使用者拿到的是"空引擎 + 模板"，自己往里放素材即可 —— **不需要 Node.js**。
 *
 * ## 为什么免编译是可行的（依据，不是推测）
 *
 * - `bundle.js` 里搜不到任何素材名/台词（打个比方：grep 工程素材名为 0 次）；
 * - `config.json` / `events.jsonc` 都是**运行时**由 `src/assetText.ts` 用 XHR 从
 *   `assets/` 读的，没有在构建期打进 bundle；
 * - `index.html` 只是加载 `bundle.js` 的壳。
 *
 * ⇒ `bundle.js` 是**通用引擎**，与素材完全解耦。换素材 = 换 `assets/`，源码一行不用碰。
 *
 * ## 产物
 *
 * `dist/spine-particle-wallpaper-engine-<version>.zip`，内含：
 *
 * | 文件 | 说明 |
 * |---|---|
 * | `index.html` / `bundle.js` | 入口与引擎 |
 * | `probe.html` / `audio-check.html` | 调试探针页、音频格式自检页 |
 * | `LICENSE.txt` / `LICENSE.spine.txt` | GPL-3.0 与 Spine 运行时许可（**必须随附**） |
 * | `project.json` | 最小 WE 工程骨架（使用者按需改标题） |
 * | `assets/config.example.json` | 配置模板，复制成 `config.json` 后改 |
 * | `assets/README*.md` | 素材放置说明 |
 * | `使用说明.md` | 三步上手 |
 *
 * 刻意**不含**：`bundle.js.map`（调试用，4 MB 级）、任何素材、任何台词文本。
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const argv = process.argv.slice(2);
const flag = (name: string): string => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && argv[i + 1].charAt(0) !== '-' ? argv[i + 1] : '';
};
const keep = argv.indexOf('--keep') >= 0;

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const publicAssets = path.join(repoRoot, 'public', 'assets');
const stageDir = path.join(distDir, '_engine');

/** 引擎文件白名单 —— 逐个显式列出，宁可漏也不能把素材带进去 */
const ENGINE_FILES: readonly string[] = [
  'index.html',
  'bundle.js',
  'bundle.js.LICENSE.txt',
  'probe.html',
  'audio-check.html',
  'LICENSE.txt',
  'LICENSE.spine.txt',
];

for (const f of ['index.html', 'bundle.js']) {
  if (!fs.existsSync(path.join(distDir, f))) {
    console.error('[packEngine] 找不到 dist/' + f + ' —— 先 npm run build');
    process.exit(2);
  }
}

const version: string = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ).version as string;
  } catch {
    return '0.0.0';
  }
})();

const outZip =
  flag('out') ||
  path.join(distDir, 'spine-particle-wallpaper-engine-v' + version + '.zip');

/** 重建暂存目录（clean，避免上一次的残留混进来） */
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stageDir, 'assets'), { recursive: true });

console.log('[packEngine] 引擎文件：');
let copied = 0;
for (const f of ENGINE_FILES) {
  const src = path.join(distDir, f);
  if (!fs.existsSync(src)) {
    console.log('  - ' + f + '（dist 里没有，跳过）');
    continue;
  }
  fs.copyFileSync(src, path.join(stageDir, f));
  copied += 1;
  const kb = (fs.statSync(src).size / 1024).toFixed(0);
  console.log('  + ' + f + '  (' + kb + ' KB)');
}

/** 空的 assets/：只放模板，绝不放素材 */
for (const f of ['config.example.json', 'README.md', 'README.zh.md']) {
  const src = path.join(publicAssets, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stageDir, 'assets', f));
    console.log('  + assets/' + f + '（模板）');
  }
}

/** 最小 WE 工程骨架 —— 与 scripts/deployWe.ts 的 skeleton 同构 */
fs.writeFileSync(
  path.join(stageDir, 'project.json'),
  JSON.stringify(
    {
      contentrating: 'Everyone',
      description: '把 Spine 骨架做成 Wallpaper Engine 壁纸。',
      file: 'index.html',
      general: {
        properties: {
          showCornerButtons: {
            index: 0,
            order: 100,
            text: '显示右上角按钮',
            type: 'bool',
            value: true,
          },
          muteAll: {
            index: 1,
            order: 101,
            text: '全部静音',
            type: 'bool',
            value: false,
          },
          debugEnabled: {
            index: 2,
            order: 102,
            text: '调试总开关',
            type: 'bool',
            value: false,
          },
          showDisclaimer: {
            index: 3,
            order: 103,
            text: '显示免责声明与许可证要求',
            type: 'bool',
            value: false,
          },
          showArchive: {
            index: 4,
            order: 104,
            text: '显示档案',
            type: 'bool',
            value: false,
          },
        },
      },
      preview: 'preview.jpg',
      tags: ['Anime'],
      title: 'My Spine Wallpaper',
      type: 'web',
      workshopid: '0',
    },
    null,
    '\t'
  ),
  'utf8'
);
console.log('  + project.json（最小骨架）');

fs.writeFileSync(
  path.join(stageDir, '使用说明.md'),
  [
    '# 引擎包使用说明',
    '',
    '这是一个**空引擎** —— 不含任何素材，所以你不需要 Node.js，也不用编译。',
    '',
    '## 三步做出你的壁纸',
    '',
    '1. **放素材**：把 Spine 三件套（`*.skel` / `*.atlas` / `*.png`）和背景贴图',
    '   拷进 `assets/`，与 `config.json` 同级，不用建子目录。语音放 `assets/voice/`，',
    '   音乐放 `assets/bgm/`。',
    '2. **写配置**：把 `assets/config.example.json` 复制成 `assets/config.json`，',
    '   按你的素材改（画布尺寸、图层、热区、字幕、音频）。',
    '   字段说明见 `assets/README.zh.md`。',
    '3. **导入 WE**：整个目录放进 `<WE>/projects/myprojects/`，在 Wallpaper Engine',
    '   里刷新并应用。',
    '',
    '> 想加台词？在 `assets/events.jsonc` 里写（没有就新建）。改完在 WE 里**重新加载壁纸**',
    '> 即可生效，不需要重新打包 —— 事件表是运行时读取的。',
    '',
    '## 什么时候才需要编译',
    '',
    '只有你要**改引擎本身**（`src/` 下的代码）时才需要 Node.js 工具链。',
    '换素材、改配置、写台词都属于"用引擎"，不属于"改引擎"。',
    '',
    '## 许可与免责',
    '',
    '- 引擎：**GPL-3.0**（`LICENSE.txt`）',
    '- Spine 运行时：**Spine Runtimes License Agreement**（`LICENSE.spine.txt`）',
    '  —— 每位使用者须自行取得 Spine Editor 许可证；再分发须随附该许可与版权声明。',
    '- 仅供个人学习与技术交流，不得用于商业用途；原作者不承担任何责任。',
    '',
  ].join('\n'),
  'utf8'
);
console.log('  + 使用说明.md');

/** 打包：优先 zip，回退 PowerShell（Windows 一定可用），tar 兜底 */
const zip = (): boolean => {
  const attempts: readonly { cmd: string; args: readonly string[] }[] = [
    { cmd: 'zip', args: ['-q', '-r', outZip, '.'] },
    {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        "Compress-Archive -Path '" +
          path.join(stageDir, '*') +
          "' -DestinationPath '" +
          outZip +
          "' -Force",
      ],
    },
  ];
  for (const a of attempts) {
    const r = spawnSync(a.cmd, a.args as string[], {
      cwd: stageDir,
      stdio: 'ignore',
    });
    if (r.status === 0 && fs.existsSync(outZip)) {
      console.log('[packEngine] 打包方式：' + a.cmd);
      return true;
    }
  }
  return false;
};

fs.rmSync(outZip, { force: true });
if (!zip()) {
  console.error(
    '[packEngine] 打包失败：系统里没有 zip 也没有可用的 PowerShell。\n' +
      '  已整理好的目录保留在：' +
      stageDir +
      '\n  可以手动压缩它，或装一个 zip 命令行工具后重跑。'
  );
  process.exit(1);
}

/** 自检：包里不能出现可疑的东西（素材体积大，一眼能看出来） */
const sizeKb = fs.statSync(outZip).size / 1024;
console.log(
  '[packEngine] 产出：' + outZip + '  (' + sizeKb.toFixed(0) + ' KB)'
);
if (sizeKb > 4096) {
  console.warn(
    '[packEngine] ⚠️ 包超过 4 MB，疑似混进了素材 —— 引擎包正常应在 1~2 MB。请检查 dist/assets/。'
  );
  process.exitCode = 1;
}

if (!keep) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  console.log('[packEngine] 已清理暂存目录（--keep 可保留）');
}
console.log('[packEngine] 复制引擎文件 ' + copied + ' 个，完成');
