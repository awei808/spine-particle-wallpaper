/**
 * 语音清单：目录里有什么格式、config 里引用的文件在不在。
 *
 * ```bash
 * npx ts-node --transpile-only scripts/voiceManifest.ts
 * npx ts-node --transpile-only scripts/voiceManifest.ts public/assets/voice public/assets/config.json
 * npx ts-node --transpile-only scripts/voiceManifest.ts --write      # 顺手产出 manifest.json
 * ```
 *
 * ## 为什么是离线脚本、而不是运行时 `fetch()` 探测
 *
 * WE 里页面是 `file://`，`fetch()` 受 CORS 限制且各版本行为不一 —— 探测本身就会失败，
 * 把"文件不存在"和"探测不可用"混成一件事。所以：
 *   - **运行时**：存在性只由 `<audio>` 的真实加载结果回答（`voicePlayer.ts`，含多格式兜底）；
 *   - **离线**（本脚本）：遍历目录生成清单，给 plan §6.3 的 `E_VOICE_MISSING` 静态校验用，
 *     也顺手回答"我到底该往 config 里写哪个扩展名"。
 *
 * ## 单一真相
 *
 * 扩展名白名单与词干/候选规则**直接复用** `src/voicePlayer`（`VOICE_MIME` /
 * `splitVoiceName` / `buildVoiceCandidates`），脚本里不另写一份 —— 否则
 * "脚本说能找到、运行时却找不到"的分裂迟早发生。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildVoiceCandidates, splitVoiceName } from '../src/voicePlayer';

const argv = process.argv.slice(2);
const write = argv.indexOf('--write') >= 0;
const positional = argv.filter((a) => a.charAt(0) !== '-');

const repoRoot = path.resolve(__dirname, '..');
const voiceDir = path.resolve(
  repoRoot,
  positional[0] || process.env.WK_VOICE_DIR || 'public/assets/voice'
);
const configPath = path.resolve(
  repoRoot,
  positional[1] || process.env.WK_CONFIG || 'public/assets/config.json'
);

if (!fs.existsSync(voiceDir) || !fs.statSync(voiceDir).isDirectory()) {
  console.error('[voice-manifest] 语音目录不存在：' + voiceDir);
  process.exit(2);
}

/* ── 1. 扫目录 ─────────────────────────────────────────────── */

type Entry = { file: string; stem: string; ext: string };
const entries: Entry[] = [];
const byStem: { [stem: string]: Entry[] } = {};

for (const name of fs.readdirSync(voiceDir)) {
  const full = path.join(voiceDir, name);
  if (!fs.statSync(full).isFile()) {
    continue;
  }
  // 只收已知音频格式（manifest.json 之类的旁路文件不算）
  const { stem, ext } = splitVoiceName(name);
  if (!ext) {
    continue;
  }
  const e = { file: name, stem, ext };
  entries.push(e);
  (byStem[stem] = byStem[stem] || []).push(e);
}
entries.sort((a, b) => a.file.localeCompare(b.file));

const formats: { [ext: string]: number } = {};
for (const e of entries) {
  formats[e.ext] = (formats[e.ext] || 0) + 1;
}

console.log('[voice-manifest] 目录 ' + voiceDir);
console.log(
  '[voice-manifest] 音频 ' +
    entries.length +
    ' 个：' +
    (Object.keys(formats)
      .sort()
      .map((k) => k + '×' + formats[k])
      .join(' / ') || '(空)')
);

/* ── 2. 同名多格式 ─────────────────────────────────────────── */

const dupStems = Object.keys(byStem).filter((s) => byStem[s].length > 1);
if (dupStems.length) {
  console.log(
    '\n⚠️ 同一词干存在多种格式（兜底会按 extOrder 命中更靠前的那个）：'
  );
  for (const s of dupStems) {
    console.log('  ' + s + ' ⇒ ' + byStem[s].map((e) => e.file).join(', '));
  }
}

/* ── 3. 对照 config ────────────────────────────────────────── */

type Issue = { level: 'error' | 'warn'; text: string };
const issues: Issue[] = [];
let checked = 0;

if (fs.existsSync(configPath)) {
  let cfg: any = null;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[voice-manifest] config 解析失败：' + (e as Error).message);
  }
  const dialogues: any[] =
    (cfg && cfg.subtitle && cfg.subtitle.dialogues) || [];
  const audio = (cfg && cfg.subtitle && cfg.subtitle.audio) || {};
  const extOrder: string[] | undefined = audio.extOrder;

  for (const d of dialogues) {
    const voice = String(d.voice || '').trim();
    if (!voice) {
      continue;
    }
    checked++;
    const base = voice.split('/').pop() || voice;
    const { stem, ext } = splitVoiceName(base);
    const hits = byStem[stem];
    const id = d.actionId != null ? '#' + d.actionId : '(无 actionId)';

    if (!hits || hits.length === 0) {
      const tried = buildVoiceCandidates(base, extOrder)
        .map((c) => c.url)
        .join(' / ');
      issues.push({
        level: 'error',
        text:
          id +
          ' 语音缺失：' +
          voice +
          ' ⇒ 运行时不会出声（字幕照常）。会尝试：' +
          (tried || '(无候选)'),
      });
      continue;
    }
    if (ext && !hits.some((h) => h.ext === ext)) {
      issues.push({
        level: 'warn',
        text:
          id +
          ' 声明的扩展名与实际不符：' +
          voice +
          ' ⇒ 实际是 ' +
          hits.map((h) => h.file).join(', ') +
          '（运行时会兜底命中，但建议改正）',
      });
    }
  }

  const referenced = new Set(
    dialogues
      .map((d) => String(d.voice || '').trim())
      .filter(Boolean)
      .map((v) => splitVoiceName(v.split('/').pop() || v).stem)
  );
  const orphan = entries
    .filter((e) => !referenced.has(e.stem))
    .map((e) => e.file);
  if (orphan.length) {
    console.log(
      '\nℹ️ config 未引用的音频 ' +
        orphan.length +
        ' 个（正常：多解出的备选/未用台词）：' +
        orphan.slice(0, 8).join(', ') +
        (orphan.length > 8 ? ' …' : '')
    );
  }
} else {
  console.log('\nℹ️ 没有 config（' + configPath + '）⇒ 跳过引用校验');
}

if (issues.length) {
  console.log('\n引用校验（config.subtitle.dialogues[].voice）：');
  for (const it of issues) {
    console.log(
      '  [' + (it.level === 'error' ? 'ERROR' : 'WARN ') + '] ' + it.text
    );
  }
}
const errCount = issues.filter((i) => i.level === 'error').length;
console.log(
  '\n[voice-manifest] 校验 ' +
    checked +
    ' 条，' +
    (errCount ? '❌ ' + errCount + ' 条缺失' : '✅ 无缺失')
);

/* ── 4. （可选）写 manifest.json ──────────────────────────── */

if (write) {
  const stems: { [stem: string]: string } = {};
  for (const s of Object.keys(byStem).sort()) {
    // 多格式时写 extOrder 里最靠前的那个（= 运行时最可能命中的）；否则就那一个
    const order = ['ogg', 'mp3', 'wav', 'm4a'];
    const list = byStem[s].slice().sort((a, b) => {
      const ia = order.indexOf(a.ext);
      const ib = order.indexOf(b.ext);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    stems[s] = list[0].ext;
  }
  const manifest = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    // ★ 只写相对仓库根的路径：manifest 会跟着 assets 一起搬家，绝对路径没有意义
    dir: path.relative(repoRoot, voiceDir).split(path.sep).join('/'),
    formats,
    stems,
    files: entries.map((e) => e.file),
  };
  const out = path.join(voiceDir, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('[voice-manifest] 已写入 ' + out);
} else {
  console.log('[voice-manifest] （加 --write 可产出 manifest.json）');
}

process.exitCode = errCount ? 1 : 0;
