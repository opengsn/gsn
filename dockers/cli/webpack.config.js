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
    gsn: '../../packages/cli/dist/commands/gsn.js',
    'gsn-deploy': '../../packages/cli/dist/commands/gsn-deploy.js',
    'gsn-relayer-register': '../../packages/cli/dist/commands/gsn-relayer-register.js',
    'gsn-paymaster-balacne': '../../packages/cli/dist/commands/gsn-paymaster-balance.js',
    'gsn-paymaster-fund': '../../packages/cli/dist/commands/gsn-paymaster-fund.js',
    'gsn-registry': '../../packages/cli/dist/commands/gsn-registry.js',
    'gsn-status': '../../packages/cli/dist/commands/gsn-status.js'
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
  },
  stats: 'errors-only'
}
