import { defineConfig } from '@rspack/cli';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { isProd, polyfill, resolve } from './helper.mjs';

const base = defineConfig({
  target: 'web',
  output: {
    publicPath: '/federation_provider/',
    // publicPath: 'auto',
  },
  resolve: {
    alias: {
      '@': resolve('./src'),
    },
    extensions: ['.js', '.jsx', '.json', '.glsl'],
  },
  module: {
    parser: {
      'css/module': {
        namedExports: false,
      },
    },
    rules: [
      {
        test: /\.js[x]?$/,
        include: [resolve('./src'), resolve('./demos')],
        use: [
          {
            loader: 'builtin:swc-loader',
            options: {
              sourceMap: !isProd,
              jsc: {
                parser: {
                  syntax: 'ecmascript',
                  jsx: true,
                },
                transform: {
                  react: {
                    pragma: 'React.createElement',
                    pragmaFrag: 'React.Fragment',
                    runtime: 'automatic',
                    development: !isProd,
                    refresh: !isProd,
                  },
                },
              },
              env: polyfill,
              rspackExperiments: {
                import: [
                  {
                    libraryName: 'antd',
                    style: '{{member}}/style/index.css',
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'federation_provider',
      filename: 'remoteEntry.js',
      exposes: {
        './button': resolve('./src/button/index.jsx'),
        './mf': resolve('./src/mf.js'),
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
      },
      dts: false,
      // getPublicPath: `return "//" + window.location.host + "/federation_provider"`,
    }),
  ],
});

export default base;
