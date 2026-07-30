// Raptor21 client build.
//
// Two entries, deliberately separate:
//   raptor — our own JS + the compiled stylesheet.
//   htmx   — the vendored copy, emitted on its own so the runtime can decide whether to load it.
//            Bundling it into `raptor` would run a second htmx alongside a consumer that already
//            has one, which double-fires every event; a separate file lets us skip it entirely.
//
// Output lands in wwwroot/dist and is embedded into the NuGet package (see the .csproj). Filenames
// are content-hashed, so the server has to resolve them through assets-manifest.json rather than
// hardcoding a name.

import {defineConfig} from '@rspack/cli'
import core from '@rspack/core'
import path from 'path'
import {fileURLToPath} from 'url'
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin'
import WebpackAssetsManifest from 'webpack-assets-manifest'

const {rspack} = core
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'wwwroot', 'dist')

export default defineConfig({
    mode: 'production',
    devtool: false,
    context: __dirname,

    entry: {
        raptor: './src/index.ts',
        htmx: './src/vendor/htmx.ts',
    },

    output: {
        path: OUT,
        // The default route prefix, and only a fallback: src/core/public-path.ts overrides this at runtime
        // from the entry script's own URL, so a consumer who changes RaptorOptions.RoutePrefix still gets
        // its lazy chunks from the right place. Without that override this value is a silent trap — the
        // entry loads from the new prefix and every chunk 404s from the old one.
        publicPath: '/_raptor21/',
        filename: '[name].[contenthash:8].js',
        chunkFilename: 'chunk.[name].[contenthash:8].js',
        clean: true,
    },

    resolve: {
        extensions: ['.ts', '.js'],
    },

    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                loader: 'builtin:swc-loader',
                options: {
                    jsc: {
                        parser: {syntax: 'typescript'},
                        target: 'es2020',
                    },
                },
            },
            {
                test: /\.scss$/,
                use: [
                    rspack.CssExtractRspackPlugin.loader,
                    {loader: 'css-loader', options: {importLoaders: 1}},
                    {loader: 'sass-loader', options: {api: 'modern'}},
                ],
                type: 'javascript/auto',
            },
        ],
    },

    optimization: {
        minimize: true,
        minimizer: [new rspack.SwcJsMinimizerRspackPlugin(), new CssMinimizerPlugin()],
        // Components are code-split behind dynamic import(); keep the shared core in one chunk so a
        // page that mounts two components does not download the base twice.
        splitChunks: {
            chunks: 'async',
            cacheGroups: {
                core: {name: 'core', minChunks: 2, reuseExistingChunk: true, priority: 10},
            },
        },
    },

    plugins: [
        // rspack ships its own extractor; the webpack plugin of the same purpose is not compatible.
        new rspack.CssExtractRspackPlugin({filename: '[name].[contenthash:8].css'}),
        // The server reads this to turn "raptor.js" into the hashed filename actually on disk.
        new WebpackAssetsManifest({
            output: 'assets-manifest.json',
            publicPath: false,
            entrypoints: false,
            integrity: false,
        }),
    ],

    performance: {hints: false},
    stats: {preset: 'errors-warnings', timings: true},
})
