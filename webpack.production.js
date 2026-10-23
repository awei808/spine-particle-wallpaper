const { mergeWithRules } = require('webpack-merge');
const common = require('./webpack.common.js');

/**
 * 生产构建（`npm run build`）。
 *
 * ## `devtool: 'source-map'` —— 为什么是**外置**而不是 `false` / `inline`
 *
 * 实测（2026-10-23，改前）：`dist/bundle.js` 总计 6.61 MB，其中
 *   - 纯 JS 代码 0.97 MB（已压缩成 1 行）
 *   - 内联 sourcemap **5.64 MB（占 85%）**
 * 内联 map 是 base64 塞进同一个文件 ⇒ 每次加载都要解析 5.6 MB 无用字符。
 *
 * 三档取舍：
 *   - `false`               → 0.97 MB，但代码被 Terser 压成一行 + 局部名混淆，
 *                             在 CEF DevTools 里现场排错等于读天书（不采用）
 *   - `'inline-source-map'` → 6.61 MB（改前状态）
 *   - `'source-map'`        → `bundle.js` 0.97 MB + 独立 `bundle.js.map`，
 *                             DevTools **按需加载** map（不开 DevTools 就不读）
 *                             ⇒ 包体降 85%，调试能力一点都不减 ← 采用
 *
 * ★ 用户拍板（2026-10-23）：**保留 .map 给用户调试**，部署时也不排除它。
 *   本项目 GPL-3.0，源码本就公开，泄露不是问题；用体积换现场可调试性。
 *
 * ★ `webpack.common.js` 里**不再声明 devtool**（以前写死 `inline-source-map`
 *   被这里完整继承，正是 6.61 MB 的来源）；`webpack.dev.js` 自己声明了
 *   `inline-source-map`，不受影响。
 */
module.exports = (env) =>
  mergeWithRules({
    module: {
      rules: {
        test: 'match',
        exclude: 'replace',
      },
    },
  })(common(env), {
    mode: 'production',
    devtool: 'source-map',
  });
