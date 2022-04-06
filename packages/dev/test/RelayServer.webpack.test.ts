/* eslint-disable no-global-assign */

import childProcess from 'child_process'
import path from 'path'
import fs from 'fs'

const describeOrig = describe
if (process.env.TEST_WEBPACK == null) {
  // @ts-ignore
  describe = describe.skip
}

describe('RelayServer-webpack', () => {
  let oneFileRelayer: string
  before('create webpack', function () {
    this.timeout(15000)
    const jsrelayDir = path.join(__dirname, '../../../dockers', 'jsrelay')
    // @ts-ignore
    fs.rmSync(path.join(jsrelayDir, 'dist'), {
      recursive: true,
      force: true
    })
    childProcess.execSync('npx webpack', { cwd: jsrelayDir, stdio: 'inherit' })
    oneFileRelayer = path.join(jsrelayDir, 'dist', 'relayserver.js')
  })

  it('should launch (and instantly crash with some parameter missing) to verify it was packed correctly', function () {
    try {
      childProcess.execSync('node ' + oneFileRelayer, { encoding: 'ascii', stdio: 'pipe' })
      assert.fail('should throw')
    } catch (e: any) {
      assert.match(e.message.toString(), /missing ethereumNodeUrl/)
    }
  })
})

// @ts-ignore
describe = describeOrig
