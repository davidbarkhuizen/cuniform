const path = require('path');

// entry: {
//     "mylib": path.resolve(__dirname, 'src/index.ts')
// },

module.exports = {
  // Set explicitly: without it webpack warns and silently falls back to
  // 'production', which hides stack traces in this dev-oriented script.
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  // Two entries: the app, and the physics worker the app constructs by URL
  // (see src/PhysicsRunner.ts). The worker must be a separate bundle, because a
  // Worker cannot share the main bundle's module scope.
  entry: {
    main: './src/index.ts',
    'simulation.worker': './src/simulation.worker.ts',
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