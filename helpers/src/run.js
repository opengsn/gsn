const { spawn } = require('child_process')
const { ensureRelayer } = require('./download')
const { relayHub } = require('./data')
const { deployRelayHub } = require('./deploy')
const { registerRelay } = require('./register')
const sleep = require('../../src/common/utils').sleep
const tmp = require('tmp')
const { chunk } = require('lodash')

async function runRelayer (
  {
    detach,
    workdir,
    devMode,
    ethereumNodeURL,
    gasPricePercent,
    port,
    relayUrl,
    relayHubAddress,
    quiet,
    fee
  }) {
  // Download relayer if needed
  const binPath = await ensureRelayer()

  // Create tmp dir
  const workingDir = workdir || tmp.dirSync({ unsafeCleanup: true }).name

  // Build args
  const args = []
  if (ethereumNodeURL) args.push('-EthereumNodeUrl', ethereumNodeURL)
  if (relayHubAddress) args.push('-RelayHubAddress', relayHubAddress)
  args.push('-Port', getPort({ relayUrl, port }))
  args.push('-Url', getUrl({ relayUrl, port }))
  args.push('-GasPricePercent', gasPricePercent || 0)
  args.push('-Workdir', workingDir)

  // Note: 70 is the default value
  // Refs: https://github.com/tabookey/tabookey-gasless/blob/v0.4.1/server/src/relay/RelayHttpServer.go#L175
  args.push('-Fee', fee === undefined ? 70 : fee)
  if (devMode !== false) args.push('-DevMode')

  // Run it!
  console.error(
    `Starting relayer\n${binPath}\n${chunk(args, 2)
      .map(arr => ' ' + arr.join(' '))
      .join('\n')}`
  )
  return spawn(binPath, args, {
    stdio: quiet || detach ? 'ignore' : 'inherit',
    detached: !!detach
  })
}

async function runAndRegister (web3, opts = {}) {
  const { from } = opts
  let { relayHubAddress } = opts

  // Deploy relay hub if needed
  if (!relayHubAddress || relayHubAddress === relayHub.address) {
    relayHubAddress = await deployRelayHub(web3, { from })
  }

  // Start running relayer and register it
  const subprocess = await runRelayer({ ...opts, relayHubAddress })
  await sleep(2000)
  try {
    await registerRelay(web3, {
      relayHubAddress,
      from,
      relayUrl: getUrl(opts)
    })
  } catch (err) {
    subprocess.kill()
    throw err
  }

  return subprocess
}

function getUrl ({ relayUrl, port }) {
  if (relayUrl) return relayUrl
  if (port) return `http://localhost:${port}`
  return 'http://localhost:8090'
}

function getPort ({ relayUrl, port }) {
  if (port) return port
  if (relayUrl) {
    const url = new URL(relayUrl)
    if (url.port.length > 0) return url.port
    else if (url.protocol === 'https') return 443
    else return 80
  }
  return 8090
}

module.exports = {
  runRelayer,
  runAndRegister
}
