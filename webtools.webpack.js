const path = require('path');
BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

module.exports = {
  plugins: [
//      new BundleAnalyzerPlugin()
  ],

  entry: './src/js/webtools/webtools.js',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'build/dist'),
    filename: 'tabookey-webtools.pack.js'
  }
};
