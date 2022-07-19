const path = require('path')
const { IgnorePlugin } = require('webpack')

module.exports = {
  plugins: [
    //      new BundleAnalyzerPlugin()
    new IgnorePlugin({ resourceRegExp: /electron/ }),
    new IgnorePlugin({ resourceRegExp: /^scrypt$/ })
  ],
  target: 'node',
  entry: '../../packages/relay/dist/runServer.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'relayserver.js'
  },
  stats: 'errors-only'
}
