require('ts-node/register/transpile-only')

function wrapfunc(obj,func) {
  const origfunc = obj[func]
  obj[func] = function (...args) {
    origfunc(...args.map(str => typeof (str) === 'string' ? str.replace(/\/solpp\//g, '/src/') : str))
  }
}

// make sure compiler errors are on the source file, not solpp-output
wrapfunc(console, 'log')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory: '../cli/src/compiled',
  contracts_directory: './solpp',
  compilers: {
    solc: {
      version: '0.8.7',
      settings: {
        evmVersion: 'london',
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
