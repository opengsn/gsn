const RelayData = require('./RelayData')
const GasData = require('./GasData')

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  // { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const GasDataType = [
  { name: 'gasLimit', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' },
  { name: 'pctRelayFee', type: 'uint256' },
  { name: 'baseRelayFee', type: 'uint256' }
]

const RelayDataType = [
  { name: 'senderAccount', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'relayAddress', type: 'address' },
  { name: 'gasSponsor', type: 'address' }
]

const RelayRequest = [
  { name: 'target', type: 'address' },
  { name: 'encodedFunction', type: 'bytes' },
  { name: 'gasData', type: 'GasData' },
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
    baseRelayFee,
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

  const gasData = new GasData({
    gasLimit,
    gasPrice,
    pctRelayFee,
    baseRelayFee
  })
  const relayData = new RelayData({
    senderAccount,
    senderNonce,
    relayAddress,
    gasSponsor
  })
  const message = {
    target,
    encodedFunction,
    gasData,
    relayData
  }
  return {
    types: {
      EIP712Domain,
      RelayRequest,
      GasData: GasDataType,
      RelayData: RelayDataType
    },
    domain,
    primaryType: 'RelayRequest',
    message
  }
}
