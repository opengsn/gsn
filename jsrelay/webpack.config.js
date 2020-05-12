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
  entry: '../src/relayserver/runServer.js',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'relayserver.js'
  }
}
