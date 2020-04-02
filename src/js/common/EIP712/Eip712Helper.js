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
  { name: 'senderAddress', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'relayWorker', type: 'address' },
  { name: 'paymaster', type: 'address' }
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
    verifier,
    relayRequest
  }
) {
  if (!verifier) throw new Error('missing "verifier"')
  // TODO: enable ChainID opcode in the EIP712Sig
  return {
    types: {
      EIP712Domain,
      RelayRequest,
      GasData: GasDataType,
      RelayData: RelayDataType
    },
    domain: {
      name: 'GSN Relayed Transaction',
      version: '1',
      chainId: chainId,
      verifyingContract: verifier
    },
    primaryType: 'RelayRequest',
    message: relayRequest
  }
}
