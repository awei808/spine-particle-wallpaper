const webpack = require('webpack');
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const resolve = (pathStr) => {
  return path.join(__dirname, pathStr);
};

const DIST_FOLDER = 'dist';
const PUBLIC_FOLDER = 'public';

module.exports = (env) => ({
  mode: 'development',
  entry: './src/index.ts',
  /**
   * `devtool` 不在这里定 —— 由两个子配置各自声明：
   *   - `webpack.dev.js`        → `'inline-source-map'`（dev-server，内联最快）
   *   - `webpack.production.js` → `'source-map'`（外置 .map，见那里的注释）
   *
   * ★ 以前这里写死 `'inline-source-map'`，被 production 完整继承 ⇒
   *   `dist/bundle.js` 6.61 MB 里 5.64 MB 是 base64 内联 map（实测占 85%）。
   *   放在公共配置里等于"谁忘了覆盖谁中招"，所以挪走。
   */
  output: {
    path: path.resolve(__dirname, DIST_FOLDER),
    filename: 'bundle.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          // Creates `style` nodes from JS strings
          'style-loader',
          // Translates CSS into CommonJS
          'css-loader',
          // Compiles Sass to CSS
          'sass-loader',
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: {
      '@src': resolve('src'),
      '@public': resolve('public'),
      '@resources': resolve('resources'),
    },
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: PUBLIC_FOLDER,
          to: '', // default output path
        },
        {
          from: 'LICENSE.txt',
          to: '',
        },
        {
          from: 'LICENSE.spine.txt',
          to: '',
        },
      ],
    }),
    /**
     * 编译期开关：`__PROBE__` 只是探针的**缺省值**（见 `src/probe.ts:60-68`）。
     *
     * 为什么用 DefinePlugin 而不是 URL 参数：WE 桌面环境走 `file://`，
     * query/hash 的行为不确定；而"换头像做 A/B"要求两份产物在
     * index.html 上完全可切换——编译期常量最可靠，也零运行时开销。
     *
     * `--env probe=on` 才置 true；不传 ⇒ **false**（发布态缺省不挂探针）。
     *
     * ★★ 注意这个缺省**不决定最终行为**：`config.probe.enabled`（含设置面板
     *    「调试」页写下的覆盖层）由 `applyProbeConfig()` 注入，**双向都能覆盖**
     *    ⇒ 发布包里用户照样能打开诊断。这里改成 false 只是"忘了传参时别默认开着"。
     * ★ 也别指望它能减小包体：`probe.ts` 早就不按 `__PROBE__` 做死代码消除
     *   （09-25 去掉了那道单向闸门），探针代码始终在产物里。
     */
    new webpack.DefinePlugin({
      __PROBE__: JSON.stringify(String(env?.probe ?? 'off') === 'on'),
    }),
  ],
  devServer: {
    historyApiFallback: true,
  },
});
