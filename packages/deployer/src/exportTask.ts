import { task } from 'hardhat/config'
import axios from 'axios'
import fs from 'fs'

const defaultChainListUrl = 'https://chainid.network/chains.json'
const tmpExportFile = '/tmp/export-all.json'
const defaultExportFile = 'deployments/gsn-networks.json'

task('export', 'Export all GSN-deployed networks')
  .addOptionalParam('chainList', 'Url to fetch chainlist', defaultChainListUrl)
  .setAction(async (args, env, runSuper) => {
    if (args.export != null) {
      throw new Error('only supports --export-all')
    }
    const exportFile = args.exportAll ?? defaultExportFile
    const chainListUrl: string = args.chainList ?? defaultChainListUrl
    await runSuper({ exportAll: tmpExportFile })
    console.debug('Fetching global chain list from', chainListUrl)
    const chainsResult = await axios.get(args.chainList).catch(e => {
      throw new Error(e.response.statusText)
    })
    if (chainsResult.data == null || !Array.isArray(chainsResult.data)) {
      throw new Error(`failed to get chainlist from ${chainListUrl}`)
    }
    // chainResult is an array. convert into a map:
    const globalChainList = chainsResult.data.reduce((set: any, chainInfo: any) => ({
      ...set,
      [chainInfo.chainId]: chainInfo
    }), {})
    const exportNetworks = require(tmpExportFile)
    // export is an hash of arrays { 3: [ { chainId: 3, ... } ] }
    const networks = Object.keys(exportNetworks).reduce((set, chainId) => {
      const globalChainInfo = globalChainList[chainId]
      if (globalChainInfo == null) {
        throw new Error(`Chain ${chainId} not found in ${chainListUrl}`)
      }
      const chainArray = exportNetworks[chainId].map((chain: any) => {
        const ret = {
          title: globalChainInfo.name,
          symbol: globalChainInfo.nativeCurrency?.symbol,
          explorer: globalChainInfo.explorers?.[0].url,
          ...chain
        }
        for (const contract of Object.values(ret.contracts)) {
          delete (contract as any).abi
        }
        return ret
      })
      return {
        ...set,
        [chainId]: chainArray
      }
    }, {})
    fs.writeFileSync(exportFile, JSON.stringify(networks, null, 2))
    console.log('exported all networks to', exportFile)
  })
