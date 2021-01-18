#!/usr/bin/env node

// extract ABI from truffle-compiled files
const fs = require('fs')
const path = require('path')

// TODO: pass all these things as parameters
const outAbiFolder = '../common/src'
const contractsFolderToExtract = '../contracts/src/interfaces'

const files = fs.readdirSync(contractsFolderToExtract)
files.push('IForwarder.sol')
files.forEach(file => {
  const c = 'interfaces/' + file.replace(/.sol/, '')

  const outNodeFile = outAbiFolder + '/' + c + '.json'
  const jsonFile = `./build/contracts/${c.replace(/interfaces./, '')}.json`
  const abiStr = JSON.parse(fs.readFileSync(jsonFile, { encoding: 'ascii' }))
  fs.mkdirSync(path.dirname(outNodeFile), { recursive: true })
  fs.writeFileSync(outNodeFile, JSON.stringify(abiStr.abi))
  console.log('written "' + outNodeFile + '"')
})
