#!/usr/bin/env node

// TODO !!! This is an ad-hoc modified version of extract-abi. This script is to be replaced ASAP.

const solc = require('solc')
const fs = require('fs')
const path = require('path')

// TODO: pass all these things as parameters
const contractsFolder = 'contracts'
const outAbiFolder = 'src/common'

const contractsFolderToExtract = './contracts/interfaces'

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

fs.readdirSync(contractsFolderToExtract).forEach(file => {
  const c = 'interfaces/' + file.replace(/.sol/, '')

  const contractFile = contractsFolder + '/' + c + '.sol'
  const outNodeFile = outAbiFolder + '/' + c + '.js'
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
  const { abi } = compileFile(contractFile, c)

  createDirectories(outNodeFile, function () {
    // fs.writeFileSync(outAbiFile, abi)
    fs.writeFileSync(outNodeFile, 'module.exports=' + abi)
    // fs.writeFileSync(outBinFile, binary)
    // console.log('written "' + outAbiFile + '"')
    console.log('written "' + outNodeFile + '"')
    // console.log('written "' + outBinFile + '"')
  })
})

function createDirectories (pathname, callback) {
  const __dirname = path.resolve()
  // eslint-disable-next-line no-useless-escape
  pathname = pathname.replace(/^\.*\/|\/?[^\/]+\.[a-z]+|\/$/g, '') // Remove leading directory markers, and remove ending /file-name.extension
  fs.mkdir(path.resolve(__dirname, pathname), { recursive: true }, e => {
    if (e) {
      console.error(e)
    }
    callback(e)
  })
}
