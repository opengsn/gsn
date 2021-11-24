import fs from 'fs'
import path from 'path'

function mapFilesRecursive (srcPath, dstPath, mapStr) {
  fs.mkdirSync(dstPath, { recursive: true })
  const srcDirStats = fs.statSync(srcPath)
  fs.utimesSync(dstPath, srcDirStats.atime, srcDirStats.mtime)

  fs.readdirSync(srcPath).forEach(entry => {
    const srcEntry = path.resolve(srcPath, entry)
    const dstEntry = path.resolve(dstPath, entry)
    const srcStats = fs.statSync(srcEntry)
    if (srcStats.isDirectory()) {
      mapFilesRecursive(srcEntry, dstEntry, mapStr)
    } else {
      const src = mapStr(fs.readFileSync(srcEntry, 'ascii'))
      fs.writeFileSync(dstEntry, src)
    }
    // keep original file timestamp
    fs.utimesSync(dstEntry, srcStats.atime, srcStats.mtime)
  })
}

// copy contracts to tmp folder.
// on production build, remove "console.log" references
// on test (env.TEST_CONSOLE), leave files as-is
export function copyContractsRemoveConsole (srcFolder, dstFolder) {
  const contractsDir = path.resolve(__dirname, srcFolder)
  const tmpContractsDir = path.resolve(__dirname, dstFolder)
  fs.rmSync(tmpContractsDir, { recursive: true,force: true })
  const isTest = process.env.TEST_CONSOLE
  const mapStr = isTest
    ? s => s /* test: don't change content */
    : s => s.replace(/.*console\.\w.*\n/g, '') /* nontest: remove lines containing console.log or console.sol */

  console.warn('contracts copied to tmp folder', tmpContractsDir, isTest ? 'testing - unmodified' : 'production - console references removed')
  mapFilesRecursive(contractsDir, tmpContractsDir, mapStr)
  return tmpContractsDir
}
