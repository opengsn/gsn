const path = require('path')
const { IgnorePlugin } = require('webpack')

module.exports = {
  plugins: [
    //      new BundleAnalyzerPlugin()
    new IgnorePlugin(/electron/),
    new IgnorePlugin(/^scrypt$/)
  ],
  target: 'node',
  entry: {
    gsn: '../../dist/src/cli/commands/gsn.js',
    'gsn-deploy': '../../dist/src/cli/commands/gsn-deploy.js',
    'gsn-relayer-register': '../../dist/src/cli/commands/gsn-relayer-register.js',
    'gsn-paymaster-balacne': '../../dist/src/cli/commands/gsn-paymaster-balance.js',
    'gsn-paymaster-fund': '../../dist/src/cli/commands/gsn-paymaster-fund.js',
    'gsn-registry': '../../dist/src/cli/commands/gsn-registry.js',
    'gsn-status': '../../dist/src/cli/commands/gsn-status.js'
  },
  // should save 18Mb on each entry - but entries fail to run...
  // optimization: {
  //    splitChunks: {
  //      chunks: 'all',
  //    },
  // },
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
    filename: '[name].js'
  }
}
