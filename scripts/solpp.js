#!/usr/bin/env node

// apply Solidity preprocessor to the input files

const fs = require('fs')
const path = require('path')
const solpp = require('solpp')

const outAbiFolder = 'packages/contracts/solpp'
const contractsFolder = 'packages/contracts/src'
const configuration = {
  defs: {
    ENABLE_CONSOLE_LOG: process.env.ENABLE_CONSOLE_LOG
  },
  noFlatten: true
}
console.log('SOLPP: using configuration', JSON.stringify(configuration))

async function preprocess (input, output) {
  const processedCode = await solpp.processFile(input, configuration)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, processedCode)
}

const getAllFiles = async function (dirPath) {
  const files = fs.readdirSync(dirPath)

  for (const file of files) {
    if (fs.statSync(dirPath + '/' + file).isDirectory()) {
      await getAllFiles(dirPath + '/' + file)
    } else {
      const orig = path.join(dirPath, '/', file)
      const dest = orig.replace(contractsFolder, outAbiFolder)
      console.log('preprocessor', dest)
      await preprocess(orig, dest)
    }
  }
}

getAllFiles(contractsFolder).then(function () {
  console.log('solpp finished')
})
