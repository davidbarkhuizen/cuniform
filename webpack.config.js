const path = require('path');

// entry: {
//     "mylib": path.resolve(__dirname, 'src/index.ts')
// },

module.exports = {
  // Set explicitly: without it webpack warns and silently falls back to
  // 'production', which hides stack traces in this dev-oriented script.
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  // Three entries: the app, the physics worker the app constructs by URL (see
  // src/PhysicsRunner.ts), and the real-canvas frame harness
  // (bench/render-frame.html, workplan Item 3). The worker must be a separate
  // bundle, because a Worker cannot share the main bundle's module scope; the
  // harness is separate so it never lands in dist/main.js or the app.
  entry: {
    main: './src/index.ts',
    'simulation.worker': './src/simulation.worker.ts',
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
                loader: 'ts-loader'
            }
        ]
    },
    devtool:'source-map',
    resolve: { extensions: ['.ts'] }
};