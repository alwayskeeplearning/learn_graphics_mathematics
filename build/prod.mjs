import { rspack } from '@rspack/core';
import { defineConfig } from '@rspack/cli';
// import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';
// import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { merge } from 'webpack-merge';
import nodeExternals from 'webpack-node-externals';
import base from './base.mjs';
import { resolve } from './helper.mjs';

const { SwcJsMinimizerRspackPlugin } = rspack;

const prod = defineConfig({
  mode: 'production',
  devtool: false,
  entry: {
    index: resolve('./src/index.js'),
  },
  output: {
    clean: true,
    path: resolve('dist'),
    // publicPath: '/',
    filename: '[name].js',
    library: {
      name: 'lib',
      type: 'umd',
    },
  },
  externals: [
    nodeExternals({
      allowlist: [/^core-js/],
    }),
  ],
  optimization: {
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    minimize: true,
    minimizer: [new SwcJsMinimizerRspackPlugin()],
  },
  plugins: [
    // new BundleAnalyzerPlugin({
    //   analyzerPort: 8899,
    // }),
    // new RsdoctorRspackPlugin({}),
  ],
});

export default merge(base, prod);
