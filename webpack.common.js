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
  devtool: 'inline-source-map',
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
     * 编译期开关：`npm run build -- --env probe=off` 产出**不带探针**的 bundle。
     *
     * 为什么用 DefinePlugin 而不是 URL 参数：WE 桌面环境走 `file://`，
     * query/hash 的行为不确定；而"换头像做 A/B"要求两份产物在
     * index.html 上完全可切换——编译期常量最可靠，也零运行时开销。
     * 默认（不传 env）探针是**开**的，避免"忘了带参数导致以为探针坏了"。
     */
    new webpack.DefinePlugin({
      __PROBE__: JSON.stringify(String(env?.probe ?? 'on') !== 'off'),
    }),
  ],
  devServer: {
    historyApiFallback: true,
  },
});
