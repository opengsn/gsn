const RelayData = require('./RelayData')
const CallData = require('./CallData')

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  // { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const CallDataType = [
  { name: 'target', type: 'address' },
  { name: 'gasLimit', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' },
  { name: 'encodedFunction', type: 'bytes' }
]

const RelayDataType = [
  { name: 'senderAccount', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'relayAddress', type: 'address' },
  { name: 'pctRelayFee', type: 'uint256' },
  { name: 'gasSponsor', type: 'address' }
]

const RelayRequest = [
  { name: 'callData', type: 'CallData' },
  { name: 'relayData', type: 'RelayData' }
]

module.exports = function getDataToSign (
  {
    chainId,
    senderAccount,
    senderNonce,
    target,
    encodedFunction,
    pctRelayFee,
    gasPrice,
    gasLimit,
    gasSponsor,
    relayHub,
    relayAddress
  }
) {
  // TODO: enable ChainID opcode in the EIP712Sig
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
    pctRelayFee,
    gasSponsor
  })
  const message = {
    callData,
    relayData
  }
  return {
    types: {
      EIP712Domain,
      RelayRequest,
      CallData: CallDataType,
      RelayData: RelayDataType
    },
    domain,
    primaryType: 'RelayRequest',
    message
  }
}
