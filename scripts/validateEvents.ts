/**
 * 事件表**离线校验 CLI**（PLAN §6.4 / S7）。
 *
 * ```bash
 * npx ts-node --transpile-only scripts/validateEvents.ts public/assets
 * npx ts-node --transpile-only scripts/validateEvents.ts public/assets --json
 * npx ts-node --transpile-only scripts/validateEvents.ts public/assets --strict   # CI：任何 issue 都算失败
 * ```
 *
 * ## 为什么必须有离线一半
 *
 * 运行时跑在 WE 的 `file://` 里，`fetch()` 受 CORS 限制 ⇒ **无法遍历目录**
 * （`scripts/voiceManifest.ts` 文件头已写明）。所以下面这些只能在脚本里答：
 *
 * | 检查 | 数据源 |
 * |---|---|
 * | 语音文件存在性 | 目录遍历 + `buildVoiceCandidates`（多格式兜底） |
 * | 粒子贴图存在 | `meshes[].textureFileName` 在 assets 下存在 |
 * | `W_FX_DIVERGED` | 同动画不同事件的 `particles` 对比 |
 * | manifest 过期 | `voice/manifest.json` mtime vs 语音目录 mtime |
 *
 * ★ **全部运行时检查都复用 `src/eventValidate.ts`**，不另写一份 ——
 *   与 `voiceManifest.ts` 复用 `voicePlayer` 是同一条纪律。
 *
 * ⚠️ **动画名检查在本脚本里是跳过的**（`animations: null`）：解析 `.skel` 需要完整
 *   spine 运行时 + three，而"骨架里到底有哪些动画"本来就该由运行时（骨架就绪后）
 *   回答。想离线查就先把动画名导出成清单（TODO），不要在这里塞一个半吊子解析器。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Configs } from '../src/config.type';
import { normalizeEventTable } from '../src/eventModel';
import { summarizeReport, validateEvents } from '../src/eventValidate';
import {
  buildFamilyRegistry,
  resolveActionPhase,
  resolveAnimationName,
  resolvePhases,
} from '../src/dialogue';
import { buildVoiceCandidates } from '../src/voicePlayer';

const argv = process.argv.slice(2);
const asJson = argv.indexOf('--json') >= 0;
const strict = argv.indexOf('--strict') >= 0;
const positional = argv.filter((a) => a.charAt(0) !== '-');

const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.resolve(
  repoRoot,
  positional[0] || process.env.WK_ASSETS || 'public/assets'
);
const configPath = path.join(assetsDir, 'config.json');

const die = (msg: string): never => {
  console.error('[validateEvents] ' + msg);
  process.exit(2);
};

if (!fs.existsSync(configPath)) {
  die('找不到 config.json: ' + configPath);
}

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Configs;
const sub = cfg.subtitle;

/* ── 归一（与运行时同一入口） ───────────────────────────── */
const normalized = normalizeEventTable(sub?.dialogues ?? [], {
  legacy: {
    touch: sub?.touch,
    chat: sub?.chat,
    standby: sub?.standby,
    greet: sub?.greet,
    greeting: sub?.greeting,
    greetingRanges: sub?.greetingRanges,
    greetMode: sub?.greetMode,
  },
});

/* ── 语音清单（递归收集 basename） ──────────────────────── */
/**
 * ⚠️ `subtitle.audio.path` 是**相对 index.html** 的（缺省 `./assets/voice/`），
 * 而 index.html 在 `assets/` 的**上一级** ⇒ 必须先上跳一层。
 * 兼容写法：上跳后的目录不存在时，再试"相对 assets 目录"。
 */
const audioPath = sub?.audio?.path ?? './assets/voice/';
const voiceDirCandidates = [
  path.resolve(assetsDir, '..', audioPath),
  path.resolve(assetsDir, audioPath),
];
const voiceDir =
  voiceDirCandidates.find((d) => fs.existsSync(d)) ?? voiceDirCandidates[0];
const voiceFiles: { [base: string]: boolean } = {};
const walk = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      walk(p);
      return;
    }
    voiceFiles[d.name.toLowerCase()] = true;
  });
};
walk(voiceDir);

/**
 * 语音是否存在：`voice` 可带扩展名，也可能要按 `extOrder` 换格式
 * ⇒ 用**运行时同一个** `buildVoiceCandidates` 生成候选再查 basename。
 */
const voiceExists = (voice: string): boolean =>
  buildVoiceCandidates(voice, sub?.audio?.extOrder).some(
    (c) => voiceFiles[path.basename(c.url).toLowerCase()] === true
  );

/* ── 上下文 ─────────────────────────────────────────────── */
const families = buildFamilyRegistry(sub?.eventFamilies);
const actionPhase = resolveActionPhase(sub?.actionPhase, families);
const particleNames = (cfg.meshes ?? [])
  .map((m) => (m as { name?: string })?.name)
  .filter((n): n is string => typeof n === 'string' && !!n);
const zoneIds = (cfg.touch?.zones ?? []).map((z) => z.id);

const report = validateEvents(normalized.events, {
  /** ★ 离线不解析骨架（见文件头），动画存在性留给运行时 */
  animations: null,
  particleNames,
  zoneIds,
  familyIds: families.families.length ? families.ids : null,
  fallbackFamilyId: families.fallbackId,
  enabledFamilyIds: families.families.length
    ? resolvePhases(sub?.phases, sub?.touchPhases, families)
    : null,
  actionPhase,
  projectAnimation: (n) => resolveAnimationName(n, families, actionPhase),
  voiceExists,
  checkFxDiverged: true,
  mode: 'strict',
});

/** 归一阶段的 issue（ID 非法/重复、优先级夹取、W_LEGACY、W_ORPHAN）也要算进来 */
const issues = normalized.issues.concat(report.issues);
const counts = { reject: 0, coerce: 0, report: 0 };
issues.forEach((it) => {
  counts[it.disposition] += 1;
});

/* ── 粒子贴图存在性（离线专属；不设新错误码，按 report 记录） ── */
const missingTextures: string[] = [];
(cfg.meshes ?? []).forEach((m) => {
  const tex = (m as { textureFileName?: string }).textureFileName;
  if (!tex) {
    return;
  }
  if (!fs.existsSync(path.join(assetsDir, tex))) {
    missingTextures.push(tex);
  }
});

/** manifest 过期（只提示，不改判定：mtime 在 git checkout 后会不可靠） */
const manifestPath = path.join(voiceDir, 'manifest.json');
const manifestNote = (() => {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(voiceDir)) {
    return '';
  }
  try {
    const mt = fs.statSync(manifestPath).mtimeMs;
    const dirMt = fs.statSync(voiceDir).mtimeMs;
    return dirMt > mt + 1000
      ? 'voice/manifest.json 比语音目录旧 ⇒ 可能已过期（重跑 npm run voice-manifest -- --write）'
      : '';
  } catch (err) {
    return '';
  }
})();

/* ── 输出 ───────────────────────────────────────────────── */
if (asJson) {
  console.log(
    JSON.stringify(
      {
        config: path.relative(repoRoot, configPath),
        summary: summarizeReport({ ...report, issues, counts }),
        counts,
        issues,
        missingTextures,
        manifestNote,
      },
      null,
      2
    )
  );
} else {
  console.log('事件表校验：' + path.relative(repoRoot, configPath));
  console.log('  ' + summarizeReport({ ...report, issues, counts }));
  if (!issues.length) {
    console.log('  ✅ 没有发现问题');
  }
  const order = ['reject', 'coerce', 'report'] as const;
  order.forEach((d) => {
    const list = issues.filter((it) => it.disposition === d);
    if (!list.length) {
      return;
    }
    console.log('\n  ── ' + d + '（' + list.length + '）──');
    list.forEach((it) => {
      console.log(
        '  [' + it.code + '] ' + (it.id || '(工程)') + '  ' + it.detail
      );
    });
  });
  if (missingTextures.length) {
    console.log('\n  ── 粒子贴图缺失（' + missingTextures.length + '）──');
    missingTextures.forEach((t) => console.log('  ' + t));
  }
  if (manifestNote) {
    console.log('\n  ⚠️ ' + manifestNote);
  }
}

const failed = strict
  ? issues.length > 0
  : counts.reject > 0 || missingTextures.length > 0;
process.exit(failed ? 1 : 0);
