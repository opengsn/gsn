const packageJson = require('../../package.json')

const mode = process.env.MODE

const useInProcessGanache = true
// currently exposing the in-process ganache doesn't work well (relay fail to work with it..)
const exposeGanachePort = false
// const exposeGanachePort=8545

const ProviderEngine = require('web3-provider-engine')
const RpcProvider = require('web3-provider-engine/subproviders/rpc.js')

const ganacheHttpServer = require('ganache-core/lib/httpServer')

const projectRoot = ''
const solcVersion = packageJson.devDependencies.solc
const defaultFromAddress = '0x5409ed021d9299bf6814279a6a1411a7e866a631'
const isVerbose = true

// ignore imported packages, tests (can also ignore interfaces: sol-coverage report 0% coverage on interfaces..)
const ignoreFilesGlobs = ['**/node_modules/**/*', '**/Migrations.sol', '**/Test*',
  '**/IRelay*', '**/RLPReader.sol'
]

function createCovProvider () {
  const { TruffleArtifactAdapter } = require('@0x/sol-trace')
  const { GanacheSubprovider } = require('@0x/subproviders')
  const { ProfilerSubprovider } = require('@0x/sol-profiler')
  const { CoverageSubprovider } = require('@0x/sol-coverage')
  const { RevertTraceSubprovider } = require('@0x/sol-trace')

  const artifactAdapter = new TruffleArtifactAdapter(projectRoot, solcVersion)
  const provider = new ProviderEngine()

  async function writeCoverageOnExit () {
    if (mode === 'profile') {
      console.log('==== writing profile data')
      await global.profilerSubprovider.writeProfilerOutputAsync()
    } else if (mode === 'coverage') {
      console.log('==== writing coverage data')
      await global.coverageSubprovider.writeCoverageAsync()
    }
  }

  if (mode === 'profile') {
    global.profilerSubprovider = new ProfilerSubprovider(
      artifactAdapter,
      defaultFromAddress,
      {
        ignoreFilesGlobs,
        isVerbose
      }
    )
    global.profilerSubprovider.stop()
    provider.addProvider(global.profilerSubprovider)
    provider.addProvider(new RpcProvider({ rpcUrl: 'http://localhost:8545' }))
  } else {
    if (mode === 'coverage') {
      global.coverageSubprovider = new CoverageSubprovider(
        artifactAdapter,
        defaultFromAddress,
        {
          ignoreFilesGlobs,
          isVerbose
        }
      )
      provider.addProvider(global.coverageSubprovider)
      // hooking the "exit" method (we can't use process.on("exit"), since its for synch operations)
      // (and we can't use process.on("beforeExit") since it doesn't work when calling "exit()")
      const saveExit = process.exit
      process.exit = async function (code) {
        await writeCoverageOnExit()
        saveExit(code)
      }
    } else if (mode === 'trace') {
      const revertTraceSubprovider = new RevertTraceSubprovider(
        artifactAdapter,
        defaultFromAddress,
        isVerbose
      )
      provider.addProvider(revertTraceSubprovider)
    }
    if (useInProcessGanache) {
      const ganahceSubprovider = new GanacheSubprovider({
        // Generate the same set of addresses as ganache-cli --deterministic
        gasLimit: 10000000,
        allowUnlimitedContractSize: true,
        mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect'
      })

      provider.addProvider(ganahceSubprovider)

      if (exposeGanachePort) {
        const s = ganacheHttpServer(provider, { log: () => {} })

        s.listen({
          port: exposeGanachePort,
          host: 'localhost'
        })
        console.log('Started in-process Ganache, on port ' + exposeGanachePort)
      }
    } else {
      // use external provider
      provider.addProvider(new RpcProvider({ rpcUrl: 'http://localhost:8544' }))
    }
  }
  provider.start(err => {
    if (err !== undefined) {
      console.log('err:', err)
      process.exit(1)
    }
  })

  /**
   * HACK: Truffle providers should have `send` function, while `ProviderEngine` creates providers with `sendAsync`,
   * but it can be easily fixed by assigning `sendAsync` to `send`.
   */
  provider.send = provider.sendAsync.bind(provider)
  return provider
}

if (!mode) {
  module.exports = {}
} else {
  module.exports = createCovProvider()
}
