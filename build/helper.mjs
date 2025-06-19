import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
import { globSync } from 'glob';

const { HtmlRspackPlugin } = rspack;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

const targets = ['chrome >= 49', 'edge >= 88'];
const resolve = dir => {
  return join(__dirname, '..', dir);
};

const polyfill = {
  mode: 'usage',
  coreJs: '3.39.0',
  targets,
};

const getDemosEntries = () => {
  const indexs = globSync('demos/*/index.js');
  const htmlPlugins = [];
  const entries = indexs.reduce((ret, file) => {
    const [, entry] = file.split('/');
    ret[`demos/${entry}`] = resolve(file);
    htmlPlugins.push(
      new HtmlRspackPlugin({
        template: resolve(`demos/${entry}/index.html`),
        filename: `demos/${entry}/index.html`,
        inject: 'body',
        chunks: [`demos/${entry}`],
      }),
    );
    return ret;
  }, {});

  return { entries, htmlPlugins };
};

const getCSSModuleRules = () => {
  const sourceMap = isProd;
  const cssLoader = {
    loader: 'builtin:lightningcss-loader',
    options: {
      targets,
      sourceMap,
    },
  };

  const cssModuleLoader = {
    loader: 'builtin:lightningcss-loader',
    options: {
      targets,
      sourceMap,
      cssModules: {
        pattern: '[hash]-[local]',
      },
    },
  };

  const lessLoader = {
    loader: 'less-loader',
    options: {
      sourceMap,
    },
  };

  const cssNodeModuleRule = {
    test: /\.css$/,
    use: [cssLoader],
    include: [resolve('./node_modules')],
    type: 'css',
  };

  const cssRule = {
    test: /\.global\.css$/,
    use: [cssLoader],
    include: [resolve('./demos'), resolve('./src')],
    type: 'css',
  };

  const cssModuleRule = {
    test: /^(?!.*\.global).*\.css$/,
    use: [cssModuleLoader],
    include: [resolve('./demos'), resolve('./src')],
    type: 'css/module',
  };

  const lessRule = {
    test: /\.global\.less$/,
    use: [cssLoader, lessLoader],
    include: [resolve('./demos'), resolve('./src')],
    type: 'css',
  };

  const lessModuleRule = {
    test: /^(?!.*\.global).*\.less$/,
    use: [cssModuleLoader, lessLoader],
    include: [resolve('./demos'), resolve('./src')],
    type: 'css/module',
  };

  return [cssNodeModuleRule, cssRule, cssModuleRule, lessRule, lessModuleRule];
};

export { isProd, resolve, polyfill, targets, getDemosEntries, getCSSModuleRules };
