import { EtherscanCachedService } from '@opengsn/relay/dist/penalizer/EtherscanCachedService'
import { TransactionDataCache } from '@opengsn/relay/dist/penalizer/TransactionDataCache'
import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'

contract('EtherscanCachedService', function () {
  const testApiKey = '22E2FW3YJDPA76RETFSGYB3I41I1JHGSR9'
  const transactionHash = '0x968c29171533bcf2c396e6acb74e7b097a266d00b725447e6fd726801991c363'
  const account = '0xa975D1DE6d7dA3140E9e293509337373402558bE'
  const nonce = 11
  let service: EtherscanCachedService

  before(async function () {
    const logger = createClientLogger({ logLevel: 'error' })
    const transactionDataCache = new TransactionDataCache(logger, '/tmp/test')
    await transactionDataCache.clearAll()
    service = new EtherscanCachedService('https://api-goerli.etherscan.io/api', testApiKey, logger, transactionDataCache)
  })

  describe('getTransactionByNonce', function () {
    it('should query the Etherscan API for the transaction if account is not cached, and cache the account', async function () {
      const transaction = await service.getTransactionByNonce(account, nonce)
      const queriedTransactionHash = transaction?.hash
      assert.equal(queriedTransactionHash, transactionHash)
    })

    it('should use cached response if possible')
  })
})
