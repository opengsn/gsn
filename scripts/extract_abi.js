#!/usr/bin/env node

// extract ABI from truffle-compiled files
// to a file format accepted by TruffleContract constructors

const fs = require('fs')
const path = require('path')
// const parseArgs = require('minimist')

// TODO: pass all these things as parameters
// const argv = parseArgs(process.argv, {
//   string: filterType(, 'string'),
//   // boolean: filterType(ConfigParamsTypes, 'boolean'),
//   default: envDefaults
// })
let outAbiFolder
let contractsFolderToExtract
let files
let jsonFilesLocation
if (process.argv.length >= 2 && process.argv[2] === 'paymasters') {
  outAbiFolder = 'packages/paymasters/src/interfaces/'
  contractsFolderToExtract = 'packages/paymasters/contracts/interfaces'
  files = fs.readdirSync(contractsFolderToExtract)
  files.push('PermitERC20UniswapV3Paymaster.sol')
  files.concat()
  jsonFilesLocation = 'packages/paymasters/build/contracts/'
} else {
  outAbiFolder = 'packages/common/src/interfaces/'
  contractsFolderToExtract = 'packages/contracts/src/interfaces'
  files = fs.readdirSync(contractsFolderToExtract)
  files.push('IForwarder.sol')
  jsonFilesLocation = 'packages/cli/src/compiled/'
}

files.forEach(file => {
  const c = file.replace(/.sol/, '')

  const outNodeFile = outAbiFolder + '/' + c + '.json'
  const jsonFile = `${jsonFilesLocation}/${c.replace(/interfaces./, '')}.json`
  const abiStr = JSON.parse(fs.readFileSync(jsonFile, { encoding: 'utf8' }))
  fs.mkdirSync(path.dirname(outNodeFile), { recursive: true })
  fs.writeFileSync(outNodeFile, JSON.stringify(abiStr.abi))
  console.log('written "' + outNodeFile + '"')
})
