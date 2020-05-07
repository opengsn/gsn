import childProcess from 'child_process'
import path from 'path'
import fs from 'fs'

describe('RelayServer-webpack', () => {
  let oneFileRelayer: string
  before('create webpack', function () {
    this.timeout(5000)
    const jsrelayDir = path.join(__dirname, '..', 'jsrelay')
    fs.rmdirSync(path.join(jsrelayDir, 'dist'), { recursive: true })
    childProcess.execSync('npx webpack', { cwd: jsrelayDir })
    oneFileRelayer = path.join(jsrelayDir, 'dist', 'relayserver.js')
  })

  it('should launch (and instantly crash with "missing Workdir") to verify it was packed correctly', function () {
    try {
      childProcess.execSync('node ' + oneFileRelayer, { encoding: 'ascii', stdio: 'pipe' })
      assert.fail('should throw')
    } catch (e) {
      assert.match(e.toString(), /missing --Workdir/)
    }
  })

  it('should test it can actually work')
})
