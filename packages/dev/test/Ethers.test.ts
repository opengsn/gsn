// import { GSNConfig } from '@opengsn/common'
// import { GsnTestEnvironment, TestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
// import { RelayProvider } from '@opengsn/provider'
// import { Contract, providers, ContractFactory } from 'ethers'
// import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
// import { wrapContract } from '@opengsn/provider/dist/WrapContract'
//
// const Web3HttpProvider = require('web3-providers-http')
// // eslint-disable-next-line
// let NOLOG = true
//
// function logProvider (provider: any): any {
//   return {
//     send: (sendParams: any, callback: any) => {
//       const { method, params } = sendParams
//       if (NOLOG || method.match(/eth_getBlockByNumber|eth_call|eth_chainId|net_version/) != null) {
//         return provider.send(sendParams, callback)
//       }
//       console.log('>>> ', method, params)
//       provider.send(sendParams, (err: any, ret: any) => {
//         console.log('<<< ', method, err, ret)
//         callback(err, ret)
//       })
//     }
//   }
// }
//
// // TODO: with complete ethers migration this test is not very informative
// describe('Ethers client', () => {
//   let ethersProvider: providers.Web3Provider
//   let gsnRecipient: Contract
//   let sender: string
//   let env: TestEnvironment
//
//   before(async function () {
//     this.timeout(30000)
//     const rawProvider = web3.currentProvider as any
//     console.log('host=', rawProvider.host, rawProvider.url)
//     env = await GsnTestEnvironment.startGsn(rawProvider.host)
//     const web3provider = new Web3HttpProvider(rawProvider.host)
//
//     const { paymasterAddress, forwarderAddress } = env.contractsDeployment
//     const gsnConfig = {
//       paymasterAddress
//     }
//     const rawEthersProvider = new providers.Web3Provider((web3provider))
//     const gsnProvider = await RelayProvider.newProvider({
//       provider: rawEthersProvider,
//       config: gsnConfig
//     }).init()
//     ethersProvider = new providers.Web3Provider(logProvider(gsnProvider))
//     sender = gsnProvider.newAccount().address
//
//     console.log('test deployed at', recipient.address)
//   })
//   after(async () => {
//     await GsnTestEnvironment.stopGsn()
//   })
//
//   it('should automatically wrap ethers.js provider', async function () {
//     const ethersProvider = new providers.JsonRpcProvider((web3.currentProvider as any).host)
//     const { paymasterAddress, forwarderAddress } = env.contractsDeployment
//     const gsnConfig: Partial<GSNConfig> = {
//       paymasterAddress: paymasterAddress!,
//       loggerConfiguration: { logLevel: 'error' }
//     }
//     const gsnProvider = RelayProvider.newProvider({ provider: ethersProvider, config: gsnConfig })
//     await gsnProvider.init()
//     const gsnEthersProvider = new providers.Web3Provider(logProvider(gsnProvider))
//     const signer = ethersProvider.getSigner()
//     const recipient = await new ContractFactory(TestRecipient.abi, TestRecipient.bytecode, signer).deploy(forwarderAddress)
//     const gsnSigner = gsnEthersProvider.getSigner()
//     gsnRecipient = recipient.connect(gsnSigner)
//     const signerAddress = await gsnSigner.getAddress()
//     const balanceBefore = await web3.eth.getBalance(signerAddress)
//     const ret = await gsnRecipient.emitMessage('hello', { gasPrice: 1e9 })
//     const rcpt = await ret.wait()
//     const balanceAfter = await web3.eth.getBalance(signerAddress)
//     assert.equal(balanceBefore.toString(), balanceAfter.toString())
//     expectEvent.inLogs(rcpt.events, 'SampleRecipientEmitted', { realSender: signerAddress })
//   })
// })
