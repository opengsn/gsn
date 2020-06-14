#!/usr/bin/env node

// extract ABI from truffle-compiled files

const fs = require('fs')
const path = require('path')

// TODO: pass all these things as parameters
const outAbiFolder = 'src/common'
const contractsFolderToExtract = './contracts/interfaces'

/*
const contractsFolder = 'contracts'

function compileFile (contractFile, c) {
  console.log('compiling ' + contractFile)
  const contractSource = fs.readFileSync(contractFile, { encoding: 'utf8' })

  const input = {
    language: 'Solidity',
    sources: {
      contractFile: {
        content: contractSource
      }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['*']
        }
      },
      optimizer: {
        enabled: true,
        runs: 1 // optimized for deployment. higher value optimize for runtime.
      }
    }
  }
  let result
  let abi
  let binary
  const parts = c.split('/')
  const lastSegment = parts.pop() || parts.pop()
  try {
    const compile = solc.compile(JSON.stringify(input), function (path) {
      const subPath = parts.length === 0 ? '' : '/' + parts.join('/')
      let realPath = contractsFolder + subPath + '/' + path
      // Try neighboring directories first
      if (path.split('/').length > 1) {
        realPath = contractsFolder + '/' + path
      }
      if (!fs.existsSync(realPath)) {
        realPath = 'node_modules/' + path
      }
      console.log(fs.existsSync(realPath) ? 'resolved:' : 'failed to resolve', realPath)

      return {
        contents: fs.readFileSync(realPath).toString()
      }
    })
    result = JSON.parse(compile)
    abi = JSON.stringify(result.contracts.contractFile[lastSegment].abi)
    binary = result.contracts.contractFile[lastSegment].evm.bytecode.object
  } catch (e) {
    console.log(e)
  }
  if (!abi) {
    console.log('ERROR: failed to extract abi:', result)
    process.exit(1)
  }

  return { abi, binary }
}
*/

const files = fs.readdirSync(contractsFolderToExtract)
files.push('IForwarder.sol')
files.forEach(file => {
  const c = 'interfaces/' + file.replace(/.sol/, '')

  const outNodeFile = outAbiFolder + '/' + c + '.json'
  // const outAbiFile = outAbiFolder + '/' + c + '.json'
  // const outBinFile = outAbiFolder + '/' + c + '.bin'
  // TODO: Cannot depend on timestamps when working with interdependent contracts
  /*
    try {
        if (fs.existsSync(outAbiFile) &&
            fs.statSync(contractFile).mtime <= fs.statSync(outAbiFile).mtime) {
            console.log("not modified: ", contractFile);
            return;
        }
    } catch (e) {
        console.log(e);
    }
    */
  const jsonFile = `./build/contracts/${c.replace(/interfaces./, '')}.json`
  const abiStr = JSON.parse(fs.readFileSync(jsonFile, { encoding: 'ascii' }))
  fs.mkdirSync(path.dirname(outNodeFile), { recursive: true })
  fs.writeFileSync(outNodeFile, JSON.stringify(abiStr.abi))
  console.log('written "' + outNodeFile + '"')
})
