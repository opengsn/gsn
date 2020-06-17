import childProcess from 'child_process'
import path from 'path'
import fs from 'fs'

describe('RelayServer-webpack', () => {
  let oneFileRelayer: string
  before('create webpack', function () {
    this.timeout(15000)
    const jsrelayDir = path.join(__dirname, '..', 'jsrelay')
    console.log('jsrelayDir=', jsrelayDir)
    // const webpackEntry = require( jsrelayDir+'/webpack.config').entry
    // assert.ok( fs.existsSync(jsrelayDir+'/'+webpackEntry), 'missing entry file: '+webpackEntry)
    fs.rmdirSync(path.join(jsrelayDir, 'dist'), { recursive: true })
    childProcess.execSync('sh -c "npx webpack"', { cwd: jsrelayDir, stdio: 'inherit' })
    oneFileRelayer = path.join(jsrelayDir, 'dist', 'relayserver.js')
  })

  it('should launch (and instantly crash with some parameter missing) to verify it was packed correctly', function () {
    try {
      childProcess.execSync('node ' + oneFileRelayer, { encoding: 'ascii', stdio: 'pipe' })
      assert.fail('should throw')
    } catch (e) {
      assert.match(e.message.toString(), /Command failed.*[\r\n]+missing --/)
    }
  })

  it('should test it can actually work')
})
