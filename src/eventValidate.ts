/**
 * 事件表**合法性校验**（PLAN §6）。纯函数：不读 DOM、不碰骨架，由调用方把
 * "这个工程里真实存在什么"作为**上下文**传进来。
 *
 * ## 分层（§6.1，别把两层混在一起）
 *
 * | 层 | 能回答 |
 * |---|---|
 * | **运行时**（boot 后、骨架就绪） | 动画名、热区 id、族 id、粒子组名、条件结构、优先级、重复 id |
 * | **离线**（CLI） | 语音文件存在性、粒子贴图存在、manifest 过期、`W_FX_DIVERGED` |
 *
 * ⚠️ **运行时不报 `E_VOICE_MISSING`**：WE 是 `file://`，`fetch()` 受 CORS 限制，
 *   运行期无法遍历目录（`scripts/voiceManifest.ts` 文件头已写明）。硬要检查只会误报。
 *   这条必须留在代码里 —— 否则后人一定会"顺手加个语音检查"。
 *
 * ## 三种处置（§6.2）
 *
 * - `reject` ⇒ 该条**不可播**（`unplayable`，交给漏斗第 ① 层）
 * - `coerce` ⇒ **修好继续播**（`fixed[eventKey]` 里给出补丁，由装配方应用）
 * - `report` ⇒ 照播，只在档案/日志记一笔
 *
 * ★ 级别由处置派生（`levelOf`），每个码**只声明一个处置** —— 不再出现旧稿那种
 *   "error 却不拦播"的自相矛盾。
 */

import { DialogueEntry, EventKey, EventValidateMode } from './config.type';
import { inspectCondition } from './conditions';
import {
  Issue,
  IssueCode,
  IssueDisposition,
  eventKeyOf,
  isEventKey,
  makeIssue,
} from './eventModel';

/** 校验上下文：**只放"这个工程里有什么"**，不放任何行为开关 */
export type ValidateContext = {
  /** 骨架里真实存在的动画名。`undefined` ⇒ **跳过**动画检查（离线无骨架时） */
  animations?: readonly string[] | null;
  /** `config.meshes[].name`。`undefined` ⇒ 跳过粒子组检查 */
  particleNames?: readonly string[] | null;
  /** `config.touch.zones[].id`。`undefined` ⇒ 跳过热区检查 */
  zoneIds?: readonly string[] | null;
  /** 事件族注册表 id。`undefined` / 空数组 ⇒ 跳过族检查（本项目无族机制） */
  familyIds?: readonly string[] | null;
  /** 缺省族 id（`E_FAMILY_UNKNOWN` 的 coerce 落点） */
  fallbackFamilyId?: string | null;
  /** 用户勾选的事件族（`subtitle.phases`）。给了才会报 `W_FAMILY_NOT_ENABLED` */
  enabledFamilyIds?: readonly string[] | null;
  /**
   * 条目的**归属族**（`dialogue.resolveDialoguePhase` 的结果）。
   *
   * ★ 2026-10-21 补：族可以由 `keyPrefix` / `matchSuffix` / 缺省族**推导**出来，
   *   这时条目上**没有** `e.phase` 字段。只看 `e.phase` 的话，一条 `custom:*`
   *   明明被前缀归到了「自定义事件」族、又因为该族未勾选而永不触发，却**不会**
   *   出现在 `W_FAMILY_NOT_ENABLED` 里 —— 正是"静默失效"。
   * 不给 ⇒ 退回只看显式 `e.phase`（老调用方行为不变）。
   */
  familyOf?: (e: DialogueEntry) => string | null;
  /** 当前动作族（换名后的名字由 `projectAnimation` 给） */
  actionPhase?: string;
  /**
   * 换名函数：基准动画名 ⇒ **当前动作族下**要播的名字。
   * 给了才会报 `E_ANIM_MISSING` / `E_SUFFIX_MISSING`（否则只能拿原名比）。
   */
  projectAnimation?: (name: string) => string;
  /** 语音存在性判定（**仅离线**）。运行时不传 */
  voiceExists?: (voice: string) => boolean;
  /** 离线：同动画不同事件的 `particles` 是否一致（`W_FX_DIVERGED`） */
  checkFxDiverged?: boolean;
  /** `subtitle.validate`，缺省 `'warn'` */
  mode?: EventValidateMode;
};

export type ValidationReport = {
  issues: Issue[];
  /** `reject` 的事件（`validate:'warn'` 时为空 —— 降级成 report） */
  unplayable: EventKey[];
  /** `coerce` 的补丁（按事件键）。装配方**就地应用**即可 */
  fixed: { [key: string]: Partial<DialogueEntry> };
  counts: { reject: number; coerce: number; report: number };
};

const emptyReport = (): ValidationReport => ({
  issues: [],
  unplayable: [],
  fixed: {},
  counts: { reject: 0, coerce: 0, report: 0 },
});

/** 深度收集条件里的热区 id（只认显式 `ctx.zone`） */
const collectZoneIds = (cond: unknown, out: string[] = []): string[] => {
  if (!cond || typeof cond !== 'object') {
    return out;
  }
  const obj = cond as { [k: string]: unknown };
  if (Array.isArray(obj.all)) {
    obj.all.forEach((c) => collectZoneIds(c, out));
  }
  if (Array.isArray(obj.any)) {
    obj.any.forEach((c) => collectZoneIds(c, out));
  }
  if (obj.not) {
    collectZoneIds(obj.not, out);
  }
  const ctx = obj.ctx as { zone?: unknown } | undefined;
  if (ctx && typeof ctx.zone === 'string' && ctx.zone) {
    out.push(ctx.zone);
  }
  return out;
};

/** 条目里所有"要播的动画名"（基准 + 每个 variant） */
const animationNames = (e: DialogueEntry): string[] => {
  const out: string[] = [];
  if (typeof e.animation === 'string' && e.animation) {
    out.push(e.animation);
  }
  (e.variants ?? []).forEach((v) => {
    if (typeof v.animation === 'string' && v.animation) {
      out.push(v.animation);
    }
  });
  return out;
};

/** 条目里所有台词（基准 + 每个 variant） */
const texts = (e: DialogueEntry): string[] => {
  const out: string[] = [];
  if (typeof e.text === 'string' && e.text) {
    out.push(e.text);
  }
  (e.variants ?? []).forEach((v) => {
    if (typeof v.text === 'string' && v.text) {
      out.push(v.text);
    }
  });
  return out;
};

/**
 * 校验一张**已归一**的事件表。
 *
 * @remarks 归一（补默认值/丢非法 id）必须已经在 `normalizeEventTable` 做过；
 *          本函数只判"归一后的表在本工程里能不能播"。
 */
export const validateEvents = (
  events: readonly DialogueEntry[],
  ctx: ValidateContext = {}
): ValidationReport => {
  const report = emptyReport();
  const mode = ctx.mode ?? 'warn';
  if (mode === 'off') {
    return report;
  }

  /** 动画存在性：`animations` 没给 ⇒ 不判（离线无骨架） */
  const hasAnimTable = Array.isArray(ctx.animations);
  const animTable = ctx.animations ?? [];
  const project = ctx.projectAnimation ?? ((n: string) => n);
  const particleTable = ctx.particleNames;
  const zoneTable = ctx.zoneIds;
  const familyTable =
    Array.isArray(ctx.familyIds) && ctx.familyIds.length ? ctx.familyIds : null;

  const add = (
    code: IssueCode,
    d: IssueDisposition,
    detail: string,
    id: EventKey
  ): void => {
    report.issues.push(makeIssue(code, d, detail, id));
  };

  /**
   * **物理上不可播**的条目（与"reject 的处置"分开记）。
   *
   * `E_ID_INVALID` / `E_ID_DUP` / `E_EVENT_EMPTY` / `E_ANIM_MISSING` 这四条不是"作者语义
   * 有问题"，而是**播不出来**（没有身份 / 没有内容 / 骨架里没有这条 clip）。
   * `validate:'warn'` 可以把**报告级别**降成 info，但**不能把它们放回候选池** ——
   * 否则点击抽到它 ⇒ `playAction` 返回 false ⇒ 用户看到"点了没反应"，
   * 而且这一 tick 不会再换一条（PLAN §7 的售后问题）。
   */
  const hard: EventKey[] = [];
  /** 已见 id（`normalizeEventTable` 已去重，这里兜住"有人绕过归一直接调"的情况） */
  const seen: string[] = [];
  /** 动画 → 各事件的 particles 串（`W_FX_DIVERGED`） */
  const fxByAnim: { [anim: string]: { id: EventKey; sig: string }[] } = {};

  events.forEach((e) => {
    const key = eventKeyOf(e);
    if (!key || !isEventKey(key)) {
      add('E_ID_INVALID', 'reject', 'id 非法 ⇒ 丢弃本条', key || '');
      report.unplayable.push(key);
      hard.push(key);
      return;
    }
    if (seen.indexOf(key) >= 0) {
      add('E_ID_DUP', 'reject', '重复 id ⇒ 保留首条', key);
      report.unplayable.push(key);
      hard.push(key);
      return;
    }
    seen.push(key);

    /** ── 空事件（既没动作也没台词）── */
    const anims = animationNames(e);
    const ts = texts(e);
    if (!anims.length && !ts.length) {
      add(
        'E_EVENT_EMPTY',
        'reject',
        '既无 animation 也无 text（variants 也全空）',
        key
      );
      report.unplayable.push(key);
      hard.push(key);
    }
    if (!ts.length) {
      add('W_TEXT_EMPTY', 'report', '纯动作事件（合法）', key);
    }

    /** ── 动画名 ── */
    if (hasAnimTable && anims.length) {
      const missing: string[] = [];
      const fallbackable: { want: string; base: string }[] = [];
      anims.forEach((base) => {
        const want = project(base);
        if (animTable.indexOf(want) >= 0) {
          return;
        }
        if (want !== base && animTable.indexOf(base) >= 0) {
          fallbackable.push({ want, base });
          return;
        }
        missing.push(want);
      });
      if (missing.length) {
        add(
          'E_ANIM_MISSING',
          'reject',
          '动画在骨架里不存在: ' +
            missing.join(', ') +
            '（' +
            (ctx.actionPhase || '无动作族') +
            '）',
          key
        );
        report.unplayable.push(key);
        hard.push(key);
      }
      if (fallbackable.length) {
        const f = fallbackable[0];
        add(
          'E_SUFFIX_MISSING',
          'coerce',
          '换名后 "' + f.want + '" 不存在 ⇒ 退回原名 "' + f.base + '"',
          key
        );
        report.fixed[key] = { ...(report.fixed[key] ?? {}), animation: f.base };
      }
    }

    /**
     * ── 粒子组名（coerce：剔掉坏名，事件照播）──
     * ⚠️ **基准与每个 variant 都要查**：变体可能写自己的 `particles`，
     *   只查基准会让"抽到那个变体才出问题"的坑静默存在。
     */
    if (particleTable) {
      const clean = (list: string[]): string[] =>
        list.filter((n) => particleTable.indexOf(n) >= 0);
      const badAll: string[] = [];
      if (Array.isArray(e.particles) && e.particles.length) {
        badAll.push(...e.particles.filter((n) => particleTable.indexOf(n) < 0));
      }
      const fixedVariants = (e.variants ?? []).map((v) => {
        if (!Array.isArray(v.particles) || !v.particles.length) {
          return v;
        }
        const bad = v.particles.filter((n) => particleTable.indexOf(n) < 0);
        if (!bad.length) {
          return v;
        }
        badAll.push(...bad);
        return { ...v, particles: clean(v.particles) };
      });
      if (badAll.length) {
        add(
          'E_PARTICLES_UNKNOWN',
          'coerce',
          '粒子组不存在 ⇒ 剔掉: ' + badAll.join(', '),
          key
        );
        const patch: Partial<DialogueEntry> = {
          ...(report.fixed[key] ?? {}),
        };
        if (Array.isArray(e.particles) && e.particles.length) {
          patch.particles = clean(e.particles);
        }
        if (
          (e.variants ?? []).some(
            (v) => Array.isArray(v.particles) && v.particles.length
          )
        ) {
          patch.variants = fixedVariants;
        }
        report.fixed[key] = patch;
      }
    }

    /** ── 事件族 ── */
    if (
      familyTable &&
      typeof e.phase === 'string' &&
      e.phase &&
      familyTable.indexOf(e.phase) < 0
    ) {
      add(
        'E_FAMILY_UNKNOWN',
        'coerce',
        'phase="' + e.phase + '" 不在注册表 ⇒ 归缺省族',
        key
      );
      report.fixed[key] = {
        ...(report.fixed[key] ?? {}),
        phase: ctx.fallbackFamilyId ?? familyTable[0],
      };
    }

    /** ── 条件：结构 / 未知键 / 热区 ── */
    if (e.when !== undefined) {
      const ins = inspectCondition(e.when);
      ins.invalid.forEach((why) => add('E_COND_INVALID', 'reject', why, key));
      if (ins.invalid.length) {
        report.unplayable.push(key);
      }
      ins.unknown.forEach((k) =>
        add(
          'E_COND_UNKNOWN',
          'coerce',
          '未知条件键 "' + k + '" ⇒ 该叶子恒真',
          key
        )
      );
      if (zoneTable) {
        const zones = collectZoneIds(e.when);
        const badZones = zones.filter((z) => zoneTable.indexOf(z) < 0);
        if (badZones.length) {
          add(
            'E_ZONE_UNKNOWN',
            'reject',
            '热区不存在: ' + badZones.join(', ') + '（条件永假）',
            key
          );
          report.unplayable.push(key);
        }
      }
    }

    /** ── 当前是否可触发（`report`：最常见的售后问题，但不影响合法性）── */
    if (familyTable && Array.isArray(ctx.enabledFamilyIds)) {
      /**
       * ⚠️ 用 `familyOf`（推导后的族）而不是 `e.phase`：前缀族 / 后缀族 / 缺省族
       *   的条目身上根本没写 `phase`（见 `ValidateContext.familyOf` 注释）。
       */
      const ph =
        (ctx.familyOf ? ctx.familyOf(e) : null) ??
        (typeof e.phase === 'string' ? e.phase : '');
      if (ph && ctx.enabledFamilyIds.indexOf(ph) < 0) {
        add(
          'W_FAMILY_NOT_ENABLED',
          'report',
          '所属事件族「' + ph + '」未勾选 ⇒ 当前不可触发',
          key
        );
      }
    }

    /** ── 离线：语音存在性 ── */
    if (ctx.voiceExists) {
      const voices: string[] = [];
      if (e.voice) {
        voices.push(e.voice);
      }
      (e.variants ?? []).forEach((v) => {
        if (v.voice) {
          voices.push(v.voice);
        }
      });
      const miss = voices.filter((v) => !ctx.voiceExists?.(v));
      if (miss.length) {
        add(
          'E_VOICE_MISSING',
          'coerce',
          '语音文件不存在 ⇒ 静音保留字幕: ' + miss.join(', '),
          key
        );
      }
    }

    /** ── 离线：同动画特效分叉 ── */
    if (ctx.checkFxDiverged && anims.length) {
      const sig = JSON.stringify(e.particles ?? null);
      anims.forEach((a) => {
        (fxByAnim[a] ??= []).push({ id: key, sig });
      });
    }
  });

  if (ctx.checkFxDiverged) {
    Object.keys(fxByAnim).forEach((anim) => {
      const list = fxByAnim[anim];
      if (list.length < 2) {
        return;
      }
      const first = list[0].sig;
      const diff = list.filter((x) => x.sig !== first).map((x) => x.id);
      if (diff.length) {
        report.issues.push(
          makeIssue(
            'W_FX_DIVERGED',
            'report',
            '动画 "' +
              anim +
              '" 在不同事件上的 particles 不一致（' +
              list.map((x) => x.id).join(', ') +
              '）—— 是有意分开的吗',
            diff[0]
          )
        );
      }
    });
  }

  /** ── 处置汇总 ── */
  report.issues.forEach((it) => {
    report.counts[it.disposition] += 1;
  });

  /**
   * `validate: 'warn'`（缺省）⇒ `reject` **降级为 `report`**（照播）。
   *
   * ★ 理由：壁纸是"看的东西"，用户自己改坏一条台词就让整类事件静默消失，
   *   比"照播 + 档案红标"更难排查。作者期/CI 用 `'strict'`。
   * ⚠️ 例外：**物理上播不出来的**（`hard`：id 非法/重复、空事件、动画缺失）
   *   仍留在 `unplayable` —— "照播"在这几条上不成立，只会变成"点了没反应"。
   */
  if (mode === 'warn') {
    report.issues = report.issues.map((it) =>
      it.disposition === 'reject'
        ? {
            ...it,
            disposition: 'report' as IssueDisposition,
            level: 'info' as const,
          }
        : it
    );
    report.counts = { reject: 0, coerce: 0, report: 0 };
    report.issues.forEach((it) => {
      report.counts[it.disposition] += 1;
    });
    report.unplayable = hard.slice();
  }

  /** 去重 `unplayable`（同一条可能踩多个 reject 码） */
  report.unplayable = report.unplayable.filter(
    (k, i) => !!k && report.unplayable.indexOf(k) === i
  );
  return report;
};

/** 一行汇总（档案 `buildNotes` 与启动日志共用） */
export const summarizeReport = (report: ValidationReport): string =>
  '校验：' +
  report.counts.reject +
  ' reject / ' +
  report.counts.coerce +
  ' coerce / ' +
  report.counts.report +
  ' report';
