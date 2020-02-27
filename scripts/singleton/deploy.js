const deployData = require('../../singleton/deploy.json')

// Deploys a RelayHub instance, reading required data from singleton/deploy.json, the output of scripts/singleton/compute.sh
// Call this file with truffle exec on the target network.
async function deploy () {
  const funder = (await web3.eth.getAccounts())[0]
  await web3.eth.sendTransaction({ from: funder, to: deployData.deployer, value: deployData.gas })

  await web3.eth.sendSignedTransaction(deployData.contract.deployTx)
  console.log(`Deployed at ${deployData.contract.address}`)
}

// truffle exec passes a callback to be called once execution is finalized
module.exports = async function (callback) {
  await deploy(callback)

  callback()
}
