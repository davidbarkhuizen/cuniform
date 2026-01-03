const path = require('path');

// entry: {
//     "mylib": path.resolve(__dirname, 'src/index.ts')
// },

module.exports = {
  entry: './src/index.ts',
  output: {
    filename: 'main.js',
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