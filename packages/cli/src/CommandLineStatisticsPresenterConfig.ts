export interface CommandLineStatisticsPresenterConfig {
  urlTruncateToLength: number
  txHashTruncateToLength: number
  valuesTruncateToLength: number
  nativeTokenTickerSymbol: string
  averageBlocksPerDay: number
  daysToPlotTransactions: number
  blockExplorerUrl?: string
}

export const defaultCommandLineStatisticsPresenterConfig: CommandLineStatisticsPresenterConfig = {
  urlTruncateToLength: 8,
  txHashTruncateToLength: 8,
  valuesTruncateToLength: 4,
  averageBlocksPerDay: 6000,
  daysToPlotTransactions: 7,
  nativeTokenTickerSymbol: 'ETH'
}
