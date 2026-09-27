const path = require('path');

// entry: {
//     "mylib": path.resolve(__dirname, 'src/index.ts')
// },

module.exports = {
  // Set explicitly: without it webpack warns and silently falls back to
  // 'production', which hides stack traces in this dev-oriented script.
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  // Four entries: the app, the physics worker the app constructs by URL (see
  // src/physics/PhysicsRunner.ts and docs/physics.md), the render worker (see
  // src/render/RenderRunner.ts and docs/model-camera-and-rendering.md) and the
  // real-canvas frame harness (bench/render-frame.html, see
  // docs/performance.md).
  // A Worker must be a separate bundle, because it cannot share the main
  // bundle's module scope; the harness is separate so it never lands in
  // dist/main.js or the app.
  entry: {
    main: './src/index.ts',
    'simulation.worker': './src/physics/simulation.worker.ts',
    'render.worker': './src/render/render.worker.ts',
    'render-frame': './bench/render-frame.ts',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        loader: 'esbuild-loader',
        options: {
          // esbuild only transpiles; it never type-checks. `npm run start`
          // therefore runs `npm run typecheck` first, which is where type
          // errors are reported.
          // esbuild-loader always sets its own target (defaulting to es2015)
          // rather than reading tsconfig.json, so the tsconfig target is
          // mirrored here.
          target: 'es2019',
        },
      },
    ],
  },
  devtool: 'source-map',
  resolve: { extensions: ['.ts'] },
};
