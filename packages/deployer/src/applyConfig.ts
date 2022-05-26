import { applyDeploymentConfig } from './deployUtils'
import hre from 'hardhat'

(async () => {
  await applyDeploymentConfig(hre)
})()
  .catch(e => console.log(e))
  .finally(process.exit)
