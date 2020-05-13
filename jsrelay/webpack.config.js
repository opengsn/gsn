const path = require('path')
// BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const { IgnorePlugin } = require( 'webpack' )

module.exports = {
  plugins: [
    //      new BundleAnalyzerPlugin()
	new IgnorePlugin(/electron/),
	new IgnorePlugin(/^scrypt$/),
  ],
  target: 'node',
  entry: '../dist/src/relayserver/runServer.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'relayserver.js'
  }
}
