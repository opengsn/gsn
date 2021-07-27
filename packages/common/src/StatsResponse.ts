export interface ReadinessInfo {
  runningSince: number
  currentStateTimestamp: number

  totalReadyTime: number
  totalNotReadyTime: number
  totalReadinessChanges: number
}

export interface StatsResponse extends ReadinessInfo {
  totalUptime: number
}
