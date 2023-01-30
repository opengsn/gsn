import deploymentFunc from '../deploy/deploy'

import hre from 'hardhat'
import { expect } from 'chai'
import fs from 'fs'
import { DeploymentConfiguration, Environment, EnvironmentsKeys } from '@opengsn/common'
import { Contract } from 'ethers'
import { applyDeploymentConfig } from '../src/deployUtils'

const tmpConfigFile = `${__dirname}/tmp-deploy-test-config-${process.pid}.js`

let saveLog: any
let saveError: any
let logBuf: string

const defaultDeploymentConfiguration: DeploymentConfiguration = {
  registrationMaxAge: 15552000,
  paymasterDeposit: '0.1',
  isArbitrum: false,
  deployTestPaymaster: true,
  deploySingleRecipientPaymaster: false,
  minimumStakePerToken: { test: '0.5' }
}

async function getHub (): Promise<Contract> {
  const hub = await hre.deployments.get('RelayHub')
  return new Contract(hub.address, hub.abi, hre.ethers.provider)
}

type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>
} : T

function writeTmpDeployConfig (env: DeepPartial<Environment> = {}, deploymentConfiguration = defaultDeploymentConfiguration): void {
  fs.writeFileSync(tmpConfigFile, `module.exports = ${JSON.stringify({
    1337: {
      ...env,
      environmentsKey: EnvironmentsKeys.ethereumMainnet,
      deploymentConfiguration
    }
  }, null, 2)}`)
}

function hookLogs (doLog: boolean = false): void {
  if (saveLog == null) {
    saveLog = console.log
    saveError = console.error
  }
  logBuf = ''
  console.log = function (...args: any) {
    logBuf = logBuf + [...args].join(' ') + '\n'
    if (doLog) {
      saveLog(...args)
    }
  }
  global.console.error = global.console.log
}

function restoreLogs (): void {
  global.console.log = saveLog
  global.console.error = saveError

  saveLog = saveError = undefined
}

describe('deployer', function () {
  this.timeout(10000)

  // helper, to allow using "console.log" within THIS file, bypassing the log hook..
  const console = { log: global.console.log, error: global.console.error }

  const provider = hre.ethers.provider
  let saveExit: any
  before(() => {
    fs.rmSync(tmpConfigFile, { force: true })
    hookLogs(true)
    saveExit = process.exit
    process.exit = (code) => {
      throw Error(`process.exit(${code})`)
    }
  })

  after(() => {
    delete process.env.HARDHAT_NETWORK
    delete process.env.DEPLOY_CONFIG

    restoreLogs()
    process.exit = saveExit
    fs.rmSync(tmpConfigFile, { force: true })
  })

  describe('#yarn deploy', () => {
    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete require.cache[require.resolve(tmpConfigFile)]
    })
    before(() => {
      process.env.HARDHAT_NETWORK = 'npmtest'
      process.env.DEPLOY_CONFIG = tmpConfigFile
      fs.rmSync(tmpConfigFile, { force: true })
    })
    after(() => {
      fs.rmSync(tmpConfigFile, { force: true })
    })

    it('should dump sample config if none is found', async function () {
      fs.writeFileSync(tmpConfigFile, '{}')
      logBuf = ''
      const ret = await deploymentFunc(hre).catch(e => e.message)
      console.log('==ret=', ret)
      expect(ret).to.match(/process.exit.1/)

      expect(logBuf).to.match(/Please add the following/)
    })

    it('should run deploy', async function () {
      writeTmpDeployConfig()
      await deploymentFunc(hre)

      const relayHub = await getHub()
      expect(await relayHub.versionHub()).to.match(/3/)
    })

    it('should NOT deploy with no change', async function () {
      const b = await provider.getBlockNumber()
      await deploymentFunc(hre)
      expect(await provider.getBlockNumber()).to.equal(b)
    })

    it('re-deploy on constructor params change', async function () {
      const preConfig = JSON.parse(JSON.stringify(await hre.deployments.all()))
      // this config force a new stakeManager, which in turn, force a new RelayHub...
      writeTmpDeployConfig({
        maxUnstakeDelay: 12345
      })
      await deploymentFunc(hre)
      const postConfig = await hre.deployments.all()
      expect(preConfig.Penalizer.address).to.equal(postConfig.Penalizer.address, 'stake manager change should not redeploy Penalizer')
      expect(preConfig.StakeManager.address).to.not.equal(postConfig.StakeManager.address, 'should re-deploy StakeManager')
      expect(preConfig.RelayHub.address).to.not.equal(postConfig.RelayHub.address, 'should re-deploy RelayHub on SM change')
    })

    describe('#yarn applyConfig', () => {
      it('should apply new hub config on change', async function () {
        const hub = await getHub()
        writeTmpDeployConfig({
          relayHubConfiguration: {
            gasReserve: 100
          }
        })
        await applyDeploymentConfig(hre)
        const postConfig = await hub.getConfiguration()
        expect(postConfig.gasReserve.toString()).to.equal('100')
      })

      it('should do nothing if no config change', async function () {
        const b = await provider.getBlockNumber()
        await applyDeploymentConfig(hre)
        expect(await provider.getBlockNumber()).to.equal(b)
      })
    })
  })
})
