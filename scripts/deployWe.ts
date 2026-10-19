/**
 * 把 `dist/` 同步成一个 **Wallpaper Engine 本地项目**，供真机验收。
 *
 * ```bash
 * # 目标目录用参数 / 环境变量传，不写死本机路径（见 agents.md）
 * npx ts-node --transpile-only scripts/deployWe.ts "<WE>\projects\myprojects\<项目名>"
 * WE_PROJECT_DIR="<...>" npx ts-node --transpile-only scripts/deployWe.ts
 * npx ts-node --transpile-only scripts/deployWe.ts --name 自定义事件_验收
 *
 * # 音频格式自检（把 audio-check.html 当成壁纸加载 ⇒ 在 **WE 的 CEF 里**跑一次）
 * npx ts-node --transpile-only scripts/deployWe.ts "<...>\myprojects\音频自检_验收" --audio-check
 * ```
 *
 * ## `--audio-check` 是干什么的
 *
 * WE 没有开发者工具，普通浏览器又**不能代表 CEF**（编解码器编译开关不同）。
 * 唯一可靠的办法是"让自检页成为壁纸本身"：`project.json` 的 `file` 指向
 * `audio-check.html`，WE 就会在它自己的 CEF 里渲染这一页 —— 页面上的
 * `canPlayType` / 真实解码 / MediaRecorder 录 AAC 再回读，全都是 CEF 的真实读数。
 * 看完截图后把壁纸换回正式项目即可。
 *
 * ## 为什么需要它（而不是让用户手动拷）
 *
 * WE 的「web 壁纸」项目就是"一个目录 + project.json + index.html + bundle.js + assets"。
 * 手工拷容易漏三样东西，每一件都表现为"点了没反应/没声音"这类**看不出原因**的现象：
 *
 * | 漏了 | 现象 |
 * |---|---|
 * | `assets/voice/*.ogg` | 字幕有、没声音（`fetch` 在 file:// 下拿不到目录，引擎无从发现） |
 * | `assets/config.json` 与 bundle 不同步 | 引擎按旧表抽条、按新代码判定 ⇒ 池空/条件永不命中 |
 * | `project.json` 的 `type: "Web"` | WE 当成普通视频/场景壁纸，根本不加载页面 |
 *
 * ## 幂等与安全
 *
 * - **只覆盖本脚本管理的文件**（`index.html` / `bundle.js` / `assets/**` / 两个 LICENSE），
 *   不删用户在该目录里放的其他东西（`preview.jpg`、`project.json` 的手工改动都保留）；
 * - `project.json` **已存在就不覆盖**（里面有 workshopid / 用户改过的属性），
 *   只在缺失时生成一份开发用的最小骨架。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseEventsFile } from '../src/eventsFile';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => a.charAt(0) !== '-');
const nameFlag = (() => {
  const i = argv.indexOf('--name');
  return i >= 0 ? argv[i + 1] : '';
})();
/** `--audio-check`：把这个项目做成"壁纸即自检页"（见文件头） */
const audioCheck = argv.indexOf('--audio-check') >= 0;

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

const target = path.resolve(
  positional[0] || process.env.WE_PROJECT_DIR || '',
  nameFlag || ''
);

if (!positional[0] && !process.env.WE_PROJECT_DIR) {
  console.error(
    '[deployWe] 缺目标目录。用法：\n' +
      '  npx ts-node --transpile-only scripts/deployWe.ts "<WE>/projects/myprojects/<项目名>"\n' +
      '  或设 WE_PROJECT_DIR 环境变量'
  );
  process.exit(2);
}
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('[deployWe] 找不到 dist/index.html —— 先 npm run build');
  process.exit(2);
}

/** 递归拷贝（覆盖同名；不删除目标里多出来的文件） */
const copyTree = (from: string, to: string): number => {
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((d) => {
    const src = path.join(from, d.name);
    const dst = path.join(to, d.name);
    if (d.isDirectory()) {
      n += copyTree(src, dst);
      return;
    }
    fs.copyFileSync(src, dst);
    n += 1;
  });
  return n;
};

/** WE 项目骨架（只在 project.json 缺失时写） */
const skeleton = {
  contentrating: 'Everyone',
  description: audioCheck
    ? '音频格式自检（由 scripts/deployWe.ts --audio-check 生成）。' +
      '这一页在 WE 的 CEF 里跑：canPlayType / 真实解码 / MediaRecorder 录 AAC 再回读。' +
      '看完读数把壁纸换回正式项目即可 —— 本目录不是壁纸本体。'
    : '开发验收副本（由 scripts/deployWe.ts 生成）。内容与本仓库 dist/ 同步：' +
      '如需改文案/属性，请改源 project.json，不要在这里改。',
  file: audioCheck ? 'audio-check.html' : 'index.html',
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
      schemecolor: {
        order: 0,
        text: 'ui_browse_properties_scheme_color',
        type: 'color',
        value: '0.36 0.53 0.78',
      },
    },
  },
  tags: ['Anime'],
  title: audioCheck ? '音频格式自检（CEF 读数）' : '自定义事件 · 开发验收',
  type: 'Web',
  version: 4,
  visibility: 'private',
};

fs.mkdirSync(target, { recursive: true });

const copied = copyTree(distDir, target);

/** 顶层两个 LICENSE 由 `copyTree` 一起带过去了；project.json 只在缺失时写 */
const projectJson = path.join(target, 'project.json');
if (!fs.existsSync(projectJson)) {
  fs.writeFileSync(projectJson, JSON.stringify(skeleton, null, '\t'), 'utf8');
  console.log('  + project.json（新建）');
} else if (audioCheck) {
  /**
   * ⚠️ `--audio-check` 时**必须**把 `file` 改指自检页 —— 否则这个项目会变成
   *   "又一份壁纸副本"，自检页在 WE 里永远打不开（没法用默认浏览器打开它，
   *   那测的就不是 CEF 了）。只改 `file`，其它属性（用户手工调过的）原样保留。
   */
  const cur = JSON.parse(fs.readFileSync(projectJson, 'utf8'));
  cur.file = 'audio-check.html';
  cur.title = cur.title || skeleton.title;
  fs.writeFileSync(projectJson, JSON.stringify(cur, null, '\t'), 'utf8');
  console.log('  ~ project.json（file → audio-check.html）');
} else {
  console.log('  = project.json（已存在，保留原样）');
}

const voices = fs.existsSync(path.join(target, 'assets', 'voice'))
  ? fs.readdirSync(path.join(target, 'assets', 'voice')).length
  : 0;

console.log('[deployWe] ' + target);
console.log('  复制 ' + copied + ' 个文件');
/**
 * ★ 2026-10-19：事件的唯一来源是 `assets/events.jsonc`（不再读 `config.subtitle.dialogues`）。
 *   ⇒ 部署时必须单独报一句"事件文件在不在、能不能解析"，否则最容易出现的故障是
 *   **bundle 换新了、事件文件没跟着换/没放** —— 表现是"壁纸能显示，但从不说话"。
 */
const eventsPath = path.join(target, 'assets', 'events.jsonc');
let eventCount = 0;
let eventNote = '★ 缺 assets/events.jsonc ⇒ 本壁纸不会触发任何事件';
if (fs.existsSync(eventsPath)) {
  const parsed = parseEventsFile(fs.readFileSync(eventsPath, 'utf8'));
  eventCount = parsed.events.length;
  eventNote = parsed.ok ? '' : '★ events.jsonc 不可用：' + (parsed.error ?? '');
  if (!parsed.ok) {
    process.exitCode = 1;
  }
}
console.log(
  '  events: ' +
    eventCount +
    ' 条（' +
    (fs.existsSync(eventsPath) ? 'assets/events.jsonc' : '缺失') +
    '）· voice ' +
    voices +
    ' 个文件'
);
if (eventNote) {
  console.error('  ' + eventNote);
}
if (!fs.existsSync(path.join(target, 'assets', 'config.json'))) {
  console.error('  ★ 缺 assets/config.json ⇒ 壁纸会白屏');
  process.exit(1);
}
console.log(
  audioCheck
    ? '  下一步：WE → 创建壁纸 → 选「' +
        path.basename(target) +
        '」→ 桌面上会出现自检页，截图第 ③④ 段'
    : '  下一步：WE → 创建壁纸 → 打开 → 选「' +
        path.basename(target) +
        '」，或在「我的壁纸」里刷新本项目'
);
