const RelayData = require('./RelayData')
const CallData = require('./CallData')

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]
const RelayRequest = [
  { name: 'target', type: 'address' },
  { name: 'gasLimit', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' },
  { name: 'encodedFunction', type: 'bytes' },
  { name: 'senderAccount', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'relayAddress', type: 'address' },
  { name: 'pctRelayFee', type: 'uint256' }
]

module.exports = async function getDataToSign (
  {
    web3,
    senderAccount,
    senderNonce,
    target,
    encodedFunction,
    pctRelayFee,
    gasPrice,
    gasLimit,
    relayHub,
    relayAddress
  }
) {
  // const chainId = await web3.eth.net.getId()
  // TODO: enable ChainID opcode in the EIP712Sig
  const chainId = 7
  const domain = {
    name: 'GSN Relayed Transaction',
    version: '1',
    chainId: chainId,
    verifyingContract: relayHub
  }

  const callData = new CallData({
    target,
    gasLimit,
    gasPrice,
    encodedFunction
  })
  const relayData = new RelayData({
    senderAccount,
    senderNonce,
    relayAddress,
    pctRelayFee
  })
  const message = {
    ...callData,
    ...relayData
  }
  return {
    types: {
      EIP712Domain,
      RelayRequest
    },
    domain,
    primaryType: 'RelayRequest',
    message
  }
}
