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
  if (fs.existsSync(output)) {
    fs.chmodSync(output, 0o777)
  }
  // make generated file read-only
  fs.writeFileSync(output, processedCode)
  fs.chmodSync(output, 0o444)
  // keep original file timestamp
  const srcStats = fs.statSync(input)
  fs.utimesSync(output, srcStats.atime, srcStats.mtime)
}

let filesCount = 0

const recursiveSolidityPreprocess = async function (dirPath) {
  const files = fs.readdirSync(dirPath)

  for (const file of files) {
    if (fs.statSync(dirPath + '/' + file).isDirectory()) {
      await recursiveSolidityPreprocess(dirPath + '/' + file)
    } else {
      const orig = path.join(dirPath, '/', file)
      const dest = orig.replace(contractsFolder, outAbiFolder)
      filesCount++
      await preprocess(orig, dest)
    }
  }
}
console.time('solpp finished')
console.log('solpp started')
err = console.error
console.error = (...params) => {
   if ( params[0].match(/INVALID_ALT_NUMBER/) ) return
   err(...params)
}

recursiveSolidityPreprocess(contractsFolder).then(function () {
  console.log(`processed ${filesCount} files`)
  console.timeEnd('solpp finished')
})
