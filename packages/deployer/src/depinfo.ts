import { printRelayInfo } from './deployUtils'
import hre from 'hardhat'

(async () => {
  const deployments = await hre.deployments.all()
  console.log('Deployed Contracts:')
  const addresses = Object.keys(deployments).reduce((set, key) => ({ ...set, [key]: deployments[key].address }), {})
  console.log(addresses)

  await printRelayInfo(hre)
})()
  .catch(e => console.log(e))
  .finally(process.exit)
