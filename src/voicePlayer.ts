/**
 * @license
 * Spine Wallpaper Engine. This is a Spine animation player for wallpaper engine.
 * Copyright (C) 2023 Spicy Wolf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 语音播放器（`<audio>` 元素池）。
 *
 * ## 为什么用元素池而不是 `new Audio()` 现建
 *
 * 每次播放现建一个 `Audio` 对象，会不断产生新的媒体元素；快速连点时容易堆积、
 * 且旧元素的播放不会被中断（出现两条语音叠着响）。这里**只建一个元素**、
 * 播新的先把旧的 `pause()` + `currentTime = 0`，天然互斥。
 *
 * ## 为什么不预加载全部 10 条
 *
 * 10 条 ogg 合计 684 KB，一次性 `load()` 会占 10 个媒体元素。
 * 本项目的触发频率很低（点击/待机/问候），首次播放的加载延迟可以接受，
 * 而且浏览器本身会缓存 —— 第二次起就没有延迟。保持简单。
 *
 * ★ 多格式兜底（见下节）**没有**改动这一点：不给每个候选都建元素，
 * 始终复用同一个元素、逐条改 `src` 试。
 *
 * ## ★ 自动播放限制（必须知道，不是 bug）
 *
 * `play()` 返回 Promise，在"用户尚未与页面交互"时会以 `NotAllowedError` 被拒。
 * 所以：
 *   - **首次打开的问候语音大概率播不出来**（此时还没有任何点击）；
 *   - 点击触发的触摸语音一定能播（点击本身就是交互）；
 *   - 待机语音取决于此前是否点过。
 *
 * 这是浏览器/CEF 的硬限制。**字幕不受影响**（DOM 不走媒体权限），
 * 而且设计上刻意让 `voiceBubble.show()` **不等待** `play()` 的 promise ——
 * 否则一次被拒就会连带字幕也不出现。
 *
 * `play()` 的拒绝是**静默吞掉**的（只在首次失败时 `console.warn` 一次），
 * 避免每次问候都在控制台刷一屏错误。
 *
 * ## ★★ 多格式语音（2026-10-17，对应 TODO「语音文件支持多种类型的音频文件」）
 *
 * 解包链产出的语音可能是 `ogg` / `mp3` / `wav` / `m4a` 混装（不同皮肤、不同批次
 * 转码口径不一致），而 `DialogueEntry.voice` 只写了一个文件名。播放时的取文件规则：
 *
 * | 步 | 规则 |
 * |---|---|
 * | ① 原样尝试 | `voice` 带**已知音频扩展名**就先用它（`Asuna_X.ogg` ⇒ 先试 `Asuna_X.ogg`） |
 * | ② 扩展名兜底 | 失败后按 `subtitle.audio.extOrder`（缺省 `ogg → mp3 → wav → m4a`）把**词干**换扩展名重试，每个候选只试一次 |
 * | ③ 能力探测 | `canPlayType()` 说"不支持"的格式**直接跳过**，且结果按播放器实例缓存（不反复问） |
 * | ④ 命中记忆 | 某词干上次成功的是哪个扩展名 ⇒ 下次同词干**把它提到最前**（混装目录里少一次失败重试） |
 * | ⑤ 失败呈现 | **保留字幕**（现状已如此），每个词干**只 warn 一次**，且不再尝试 |
 *
 * ### 三条必须写死的判定口径（踩过就知道为什么）
 *
 * 1. **`NotAllowedError` 绝不触发降级。** 那是"用户还没交互"的自动播放拦截，
 *    与文件格式无关。若把它当失败去换扩展名，一次被拒就会连试 4 个文件、
 *    刷 4 条错误日志，最后仍然没声音 —— 症状与"文件真的不存在"完全混淆。
 *    只有 `NotSupportedError`（解码/容器不支持）与元素的 `error` 事件才降级。
 * 2. **`AbortError` 也不降级。** 它是我们自己的 `stop()` / 换 `src` 打断 pending
 *    `play()` 造成的，不是文件的错。
 * 3. **探测结果全否定时不信探测、按原顺序实测**（fail-safe）。WE 的 CEF 对
 *    `m4a/aac` 的 `canPlayType` 回答不可靠：说 "" 但实际能解码是真实存在的组合。
 *    "全都不支持 ⇒ 那就不播"会让整条语音静音且无从排查，代价远大于多试两次。
 *
 * ### 暂停期间不起播（不变式 1 的延伸）
 *
 * 降级链是异步的：候选 A 失败、正在试候选 B 的间隙里，WE 完全可能刚刚暂停壁纸。
 * 那时照常 `play()` 就会在"已暂停"的壁纸上突然出声。总闸是**唯一**的暂停控制点，
 * 播放器不能绕过它 ⇒ 暂停期间整个请求改为**待播**（`deferredFile`），`resume()`
 * 时**从头重跑整条链**（而不是续一个可能正好是坏格式的候选）。
 *
 * ### 为什么不做 `fetch()` 存在性探测
 *
 * WE 里页面是 `file://`，`fetch()` 受 CORS 限制且各版本行为不一 —— 探测本身
 * 就会失败，把"文件不存在"和"探测不可用"混成一件事。所以存在性**只**由
 * `<audio>` 的真实加载结果回答（`error` 事件 / `NotSupportedError`）。
 * 构建期的静态校验另走 `scripts/voiceManifest.ts`（`npm run voice-manifest`），
 * 那是离线检查，不在运行时。
 */

import { SubtitleAudioConfig } from './config.type';

/**
 * 已知音频扩展名 → 能力探测用的 MIME。
 *
 * 键一律**小写**（`splitVoiceName` 负责归一）；值必须是带 `codecs` 的完整串 ——
 * CEF 里 `canPlayType('audio/ogg')` 常回 `"maybe"`，而带 `codecs="vorbis"` 才回
 * `"probably"`，两者都算"能播"，但后者才是真的能播，日志里也好区分。
 *
 * ⚠️ 这张表同时是"什么算语音扩展名"的白名单：不在表里的后缀**不当作扩展名**
 * （避免把 `Asuna_v1.2` 的 `.2` 当格式），整串当词干去拼候选。
 */
export const VOICE_MIME: { [ext: string]: string } = {
  ogg: 'audio/ogg; codecs="vorbis"',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4; codecs="mp4a.40.2"',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

/**
 * 缺省兜底顺序。
 *
 * ⚠️ `m4a` **排在最后**是刻意的：WE 的 CEF 对 AAC 的支持不稳（PLAN §8 的实测待办），
 * 把它放前面会让"明明有 ogg、却先撞一条解不了的 m4a"变成常态。
 */
export const DEFAULT_VOICE_EXT_ORDER = ['ogg', 'mp3', 'wav', 'm4a'];

/** 一个播放候选 = 扩展名 + 拼在 `basePath` 后面的相对路径 */
export type VoiceCandidate = {
  /** 小写扩展名（无点），如 `ogg`。未知扩展名时为 `''` */
  ext: string;
  /** 相对路径（可含子目录），如 `CV/Asuna/Asuna_Touch_Head_03.ogg` */
  url: string;
};

/**
 * 归一 `subtitle.audio.extOrder`。
 *
 * | 输入 | 结果 | 为什么 |
 * |---|---|---|
 * | 没写 / 不是数组 | 缺省表 | 老 config 零变化 |
 * | `[]` | `[]` | **显式关闭兜底**（只试 `voice` 里写的那个扩展名），与 `*Kinds: []` 同一口径 |
 * | 有项但全是垃圾 | 缺省表 | 容忍拼错：写坏了等于没写，而不是"悄悄关掉兜底" |
 * | 正常 | 去点、小写、去重、保序 | `.MP3` / `mp3` 是同一个格式 |
 */
export const normalizeExtOrder = (raw?: string[]): string[] => {
  if (!Array.isArray(raw)) {
    return DEFAULT_VOICE_EXT_ORDER.slice();
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const ext = item.trim().replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext)) {
      continue;
    }
    if (out.indexOf(ext) < 0) {
      out.push(ext);
    }
  }
  if (out.length === 0 && raw.length > 0) {
    return DEFAULT_VOICE_EXT_ORDER.slice();
  }
  return out;
};

/**
 * 拆出词干与扩展名。只有 `VOICE_MIME` 认识的后缀才算扩展名。
 *
 * `'CV/Asuna/Asuna_X.ogg'` ⇒ `{ stem: 'CV/Asuna/Asuna_X', ext: 'ogg' }`
 * `'Asuna_v1.2'` ⇒ `{ stem: 'Asuna_v1.2', ext: '' }`（`.2` 不是音频格式）
 */
export const splitVoiceName = (file: string): { stem: string; ext: string } => {
  const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(file);
  if (m && VOICE_MIME[m[2].toLowerCase()]) {
    return { stem: m[1], ext: m[2].toLowerCase() };
  }
  return { stem: file, ext: '' };
};

/**
 * 生成播放候选链（**纯函数**，回归可直接断言）。
 *
 * - 第一个候选就是 `voice` 的**原串**（保留大小写/子目录，即"原样尝试"）；
 * - 其余候选 = `词干 + '.' + extOrder[i]`，已出现过的扩展名不重复；
 * - `voice` 不带扩展名时全部候选都是 `词干 + '.' + ext`（此时词干 = 原串）。
 *
 * `extOrder: []` ⇒ 只返回原串那一个候选（显式关掉兜底）。
 */
export const buildVoiceCandidates = (
  file: string,
  extOrder?: string[]
): VoiceCandidate[] => {
  const { stem, ext } = splitVoiceName(file);
  const out: VoiceCandidate[] = [];
  if (ext) {
    out.push({ ext, url: file });
  }
  for (const e of normalizeExtOrder(extOrder)) {
    if (out.some((c) => c.ext === e)) {
      continue;
    }
    out.push({ ext: e, url: stem + '.' + e });
  }
  return out;
};

export type VoicePlayer = {
  /** 播一条语音（`file` 是文件名，如 `Asuna_Touch_Head_03.ogg`）。返回是否成功发起播放 */
  play: (file: string) => void;
  /** 立即停止当前语音（换条/收起气泡时用）——**回到开头**，语义与 `pause()` 不同 */
  stop: () => void;
  /**
   * 挂起当前语音（WE 暂停壁纸 / 标签页隐藏），**保留 `currentTime`**。
   *
   * ★ 与 `stop()` 的区别就是这一条：挂起用于"外部要求安静一下"，
   *   恢复后从原处接着说；`stop()` 用于"这条不要了"，会把进度清零。
   *   幂等（重复调用不改变状态，也不清进度）。
   */
  pause: () => void;
  /**
   * 从暂停处续播（幂等）。
   *
   * ★ 只在 `pause()` 或 `play()` 时"正在播"才续 —— 从未播过、或已被
   *   `stop()`/`dispose()` 停掉的，不会被凭空唤醒。
   */
  resume: () => void;
  /** 当前是否在播（元素未创建时为 `false`） */
  isPlaying: () => boolean;
  /** 当前播放位置（秒）。元素未创建时为 0 */
  currentTime: () => number;
  /** 运行时改音量（0~1）。会记住，供下一次 `ensure()` 建元素时使用 */
  setVolume: (v: number) => void;
  /** 当前音量 */
  getVolume: () => number;
  /**
   * 最近一次**真正开始播**的候选相对路径（含实际命中的扩展名）。
   * 全部候选都失败、或还没播过时为 `''`。
   *
   * 只给诊断用（探针/控制台），播放逻辑不读它。
   */
  resolvedUrl: () => string;
  dispose: () => void;
};

/** 从 `DialogueEntry.voice`（形如 `CV/Asuna/Asuna_Touch_Head_03.ogg`）取文件名 */
export const voiceBasename = (voicePath: string): string => {
  if (!voicePath) {
    return '';
  }
  const parts = voicePath.split('/');
  return parts[parts.length - 1] ?? '';
};

/** 未启用时返回 `null`，调用方判空即可 */
export const createVoicePlayer = (
  cfg?: SubtitleAudioConfig
): VoicePlayer | null => {
  if (cfg?.enabled === false) {
    return null;
  }
  const basePath = cfg?.path ?? './assets/voice/';
  /** 当前音量。`setVolume` 会改它；`ensure()` 建元素时写入，故改音量后重载才彻底生效 */
  let volume = typeof cfg?.volume === 'number' ? cfg.volume : 1;
  /** 兜底顺序（已归一）。`[]` = 只用 `voice` 里写的扩展名 */
  const extOrder = normalizeExtOrder(cfg?.extOrder);

  let el: HTMLAudioElement = null;
  /** 自动播放被拒只警告一次，避免刷屏 */
  let warnedAutoplay = false;
  /**
   * ★ "暂停前是否在播" —— 决定 `resume()` 该不该续播。
   *
   * 与 `bgmPlayer` 同一口径。不能用 `!el.paused` 反推：外部的 `pause()` 幂等保护
   * 会让第二次调用看到 `el.paused === true`，从而把已记好的意图抹成"没在播"。
   */
  let wasPlaying = false;

  /* ── 多格式兜底的可变状态（全部按播放器实例隔离，避免多个播放器互相污染） ── */

  /**
   * 代际号：每次 `play()` / `stop()` / `dispose()` 都 +1。
   * 兜底链是**异步**的（等 `play()` 的 promise / `error` 事件），
   * 靠它把"上一条的失败回调"整批作废 —— 否则连点两下时，
   * 第一条的降级链会在第二条开始播之后继续改 `src`，出现"播着 A 突然跳成 B"。
   */
  let generation = 0;
  /** 当前候选挂的 `error` 监听（换候选/收尾时必须摘掉，否则旧候选的 error 会串台） */
  let activeOnError: (() => void) | null = null;
  /** `canPlayType` 结果缓存：ext ⇒ 是否支持。只在实例内有效 */
  const caps: { [ext: string]: boolean } = {};
  /** 命中记忆：词干 ⇒ 上次成功的扩展名（混装目录里下次直接用它先试） */
  const lastGood: { [stem: string]: string } = {};
  /** 已 warn 过的词干（每个文件只刷一条日志） */
  const warnedMissing: { [stem: string]: boolean } = {};
  /** 探测全否定只提示一次 */
  let warnedProbe = false;
  /** 最近一次真正开始播的候选 url（诊断用） */
  let resolved = '';
  /**
   * 总闸是否处于**暂停**态（`pause()` 之后、`resume()` 之前）。
   *
   * ★ 为什么需要：降级链是**异步**的。假如播 `a.ogg` 失败、正在试 `a.mp3` 的间隙里
   *   WE 暂停了壁纸，链路走到下一候选时照样会 `play()` —— 于是在"已暂停"的壁纸上
   *   突然出声。总闸是唯一的暂停控制点（agents.md 不变式 1），播放器不能自己绕过它。
   *   ⇒ 暂停期间整个请求**延后**，`resume()` 时从头重跑完整链路（而不是续一个可能
   *   正好是坏格式的候选）。
   */
  let suspended = false;
  /** 暂停期间被延后的念白（`resume()` 时重跑；同一时刻只有一条，新请求覆盖旧的） */
  let deferredFile: string | null = null;

  const ensure = (): HTMLAudioElement => {
    if (el) {
      return el;
    }
    el = document.createElement('audio');
    el.preload = 'none';
    el.volume = volume;
    // 不进 DOM 也能播（Chrome/CEF 均支持）；不 append 是为了不干扰页面结构
    return el;
  };

  /** 摘掉当前候选的 `error` 监听（DOM 桩可能没有这两个方法，故都做存在性判断） */
  const detach = () => {
    if (activeOnError && el && typeof el.removeEventListener === 'function') {
      el.removeEventListener('error', activeOnError);
    }
    activeOnError = null;
  };

  /** 作废所有在飞的异步回调（不动播放状态本身） */
  const cancelPending = () => {
    generation++;
    detach();
  };

  /**
   * 能力探测（带缓存）。
   *
   * - 表里没有的扩展名 ⇒ **不拦**（交给实测，未知格式不该被静默丢弃）；
   * - 元素没有 `canPlayType`（DOM 桩 / 极老环境）⇒ **不拦**；
   * - 只有明确回 `''`（= "cannot play"）才算"不支持"。
   */
  const canPlay = (audio: HTMLAudioElement, ext: string): boolean => {
    if (caps[ext] !== undefined) {
      return caps[ext];
    }
    const mime = VOICE_MIME[ext];
    if (!mime) {
      caps[ext] = true;
      return true;
    }
    const fn = (audio as any).canPlayType;
    if (typeof fn !== 'function') {
      caps[ext] = true;
      return true;
    }
    let verdict = '';
    try {
      verdict = String(fn.call(audio, mime) || '');
    } catch (e) {
      // 某些 CEF 版本对带 codecs 的串会抛 —— 当作"不知道"，交给实测
      verdict = 'maybe';
    }
    caps[ext] = verdict !== '';
    return caps[ext];
  };

  const warnMissingOnce = (
    stem: string,
    file: string,
    tried: VoiceCandidate[]
  ) => {
    if (warnedMissing[stem]) {
      return;
    }
    warnedMissing[stem] = true;
    console.warn(
      '[voice] 语音文件不可用，已尝试 [%s]：%s。字幕不受影响。' +
        '请确认文件在 subtitle.audio.path 目录下，或把扩展名加进 audio.extOrder。',
      tried.map((c) => c.ext || '(无)').join(' / '),
      file
    );
  };

  /**
   * 逐个候选尝试。异步递归，**token 与 `generation` 不等即整体作废**。
   *
   * 降级只在三种情况下发生：
   *   · 元素的 `error` 事件（解码失败 / 文件不存在 / 容器不支持）；
   *   · `play()` 被拒且 `err.name === 'NotSupportedError'`；
   *   · `play()` 同步抛异常（极少）。
   *
   * ★ `NotAllowedError`（自动播放拦截）与 `AbortError`（我们自己打断）**不降级**，见文件头注释。
   */
  const attempt = (
    chain: VoiceCandidate[],
    i: number,
    token: number,
    stem: string,
    file: string
  ) => {
    if (token !== generation || !el) {
      return;
    }
    if (i >= chain.length) {
      // 全链失败：这条念白作废（字幕照常显示），且不给 resume() 留"复活"的口子
      wasPlaying = false;
      warnMissingOnce(stem, file, chain);
      return;
    }

    const audio = el;
    const cand = chain[i];
    detach();
    try {
      // 换 src 会自动触发媒体加载算法；不要再手动 load()（会多一次无用加载）
      audio.src = basePath + cand.url;
    } catch (e) {
      /* 畸形路径 —— 当作本候选失败 */
      attempt(chain, i + 1, token, stem, file);
      return;
    }
    wasPlaying = true;

    /** 本次候选"已定性"（成功不算定性：成功之后仍可能中途报错 ⇒ 仍允许降级） */
    let advanced = false;
    const advance = () => {
      if (advanced) {
        return;
      }
      advanced = true;
      if (token !== generation) {
        return;
      }
      /**
       * ★ 降级到一半时总闸暂停了 ⇒ **不许继续 `play()`**（否则暂停中的壁纸突然出声），
       *   把这条念白改成"待播"，等 `resume()` 从头重跑。
       */
      if (suspended) {
        wasPlaying = false;
        deferredFile = file;
        return;
      }
      attempt(chain, i + 1, token, stem, file);
    };

    if (typeof audio.addEventListener === 'function') {
      activeOnError = advance;
      audio.addEventListener('error', activeOnError);
    }

    let p: any;
    try {
      p = audio.play();
    } catch (e) {
      advance();
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(
        () => {
          if (token !== generation) {
            return;
          }
          // 成功 ⇒ 记住这条词干的可用扩展名（保留 error 监听：中途解码失败仍要降级）
          lastGood[stem] = cand.ext;
          resolved = cand.url;
        },
        (err: any) => {
          if (token !== generation) {
            return;
          }
          const name = err && err.name;
          if (name === 'NotAllowedError') {
            // 被自动播放策略拒 ⇒ 实际没在播，别让 resume() 白白尝试一次
            wasPlaying = false;
            detach();
            if (!warnedAutoplay) {
              warnedAutoplay = true;
              console.warn(
                '[voice] 语音播放被浏览器拒绝（自动播放限制，需先有用户交互）: %s。' +
                  '字幕不受影响。后续点击触发的语音可正常播放。',
                name
              );
            }
            return;
          }
          if (name === 'AbortError') {
            // 我们自己 stop()/换源打断的，不是文件的错
            return;
          }
          advance();
        }
      );
    }
  };

  const stop = () => {
    cancelPending();
    // 主动停止 = 这条作废：连"暂停期间待播"的也一起作废
    deferredFile = null;
    if (!el) {
      return;
    }
    try {
      el.pause();
      el.currentTime = 0;
    } catch (e) {
      // 尚未加载任何源时设 currentTime 可能抛 —— 忽略即可
    }
    // ★ 主动停止 = 这条作废 ⇒ 清掉续播意图，否则 pause() 后 stop() 再 resume()
    //   会把一条已被换掉/收起的旧语音重新放出来。
    wasPlaying = false;
  };

  const play = (file: string) => {
    if (!file) {
      return;
    }
    const audio = ensure();
    // 先停旧的：快速连点时避免两条叠着响（同时作废上一条的降级链）
    stop();
    /**
     * ★ 总闸暂停期间**不开播**，整条请求延后到 `resume()`。
     *   注意必须在 `stop()` 之后判断：`stop()` 会清掉上一条的 `deferredFile`。
     */
    if (suspended) {
      deferredFile = file;
      wasPlaying = false;
      return;
    }

    const { stem } = splitVoiceName(file);
    resolved = '';
    let chain = buildVoiceCandidates(file, extOrder);
    if (chain.length === 0) {
      // `voice` 不带扩展名且 `extOrder: []`（显式关掉兜底）⇒ 无从下手
      wasPlaying = false;
      warnedMissing[stem] = true;
      console.warn(
        '[voice] 语音 "%s" 没有扩展名，而 subtitle.audio.extOrder 为空 ⇒ 无法定位文件。',
        file
      );
      return;
    }

    // ③ 能力探测：跳过硬不支持的格式
    const usable = chain.filter((c) => canPlay(audio, c.ext));
    if (usable.length === 0) {
      // fail-safe：探测说全都不支持时不信它，按原顺序实测（CEF 对 m4a 的回答不可靠）
      if (!warnedProbe && chain.length > 1) {
        warnedProbe = true;
        console.warn(
          '[voice] canPlayType 判定候选格式 [%s] 均不支持 ⇒ 忽略探测、按原顺序实测。' +
            '若确实无声，请检查 CEF 的解码能力或转码。',
          chain.map((c) => c.ext).join(' / ')
        );
      }
    } else {
      chain = usable;
    }

    // ④ 命中记忆：同词干上次成功的扩展名提到最前
    const memo = lastGood[stem];
    if (memo && chain[0].ext !== memo) {
      const hit = chain.filter((c) => c.ext === memo);
      if (hit.length) {
        chain = hit.concat(chain.filter((c) => c.ext !== memo));
      }
    }

    // ★ token 必须在 stop() 之后取：stop() 自己也 +1 代际
    attempt(chain, 0, generation, stem, file);
  };

  const pause = () => {
    suspended = true;
    if (!el || el.paused) {
      return;
    }
    wasPlaying = true;
    try {
      // ★ 只 pause()，**不动 currentTime** —— 这是"从暂停处续播"的关键。
      el.pause();
    } catch (e) {
      /* 未加载源时 pause 一般安全，保险起见吞掉 */
    }
  };

  const resume = () => {
    suspended = false;
    // 暂停期间被延后的念白：从头重跑完整链路（可能上一条的失败还没落定）
    if (deferredFile) {
      const pending = deferredFile;
      deferredFile = null;
      play(pending);
      return;
    }
    if (!wasPlaying || !el || !el.paused) {
      return;
    }
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* 恢复被拒（WE 内通常无交互）静默 —— 字幕不受影响 */
      });
    }
  };

  return {
    play,
    stop,
    pause,
    resume,
    isPlaying: () => !!el && !el.paused,
    currentTime: () => (el ? el.currentTime : 0),
    setVolume: (v: number) => {
      volume = Math.max(0, Math.min(1, v));
      if (el) {
        el.volume = volume;
      }
    },
    getVolume: () => volume,
    resolvedUrl: () => resolved,
    dispose: () => {
      cancelPending();
      stop();
      if (el) {
        el.removeAttribute('src');
        el = null;
      }
      wasPlaying = false;
    },
  };
};
