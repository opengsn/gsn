import { GSNStatistics } from './GSNStatistics'

export interface StatisticsPresenter {
  getStatisticsStringPresentation: (statistics: GSNStatistics) => string
}
