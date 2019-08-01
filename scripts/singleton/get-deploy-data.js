const { lstatSync, readdirSync } = require('fs')
const { join } = require('path')

const ethTx = require('ethereumjs-tx');
const ethUtils = require('ethereumjs-util');

const fs = require('fs');

function toHexString(buffer) {
  return '0x' + buffer.toString('hex')
}

const bin = fs.readFileSync('singleton/singleton_RelayHub_flattened_sol_RelayHub.bin', 'ascii');

const tx = new ethTx({
  nonce: 0,
  data: '0x' + bin,
  value: 0,
  gasPrice: 100000000000, /// 100 gigawei
  gasLimit: 4200000,
  v: 27,
  r: '0x1613161316131613161316131613161316131613161316131613161316131613',
  s: '0x1613161316131613161316131613161316131613161316131613161316131613'
});

const deployer = tx.getSenderAddress();

console.log(JSON.stringify({
  deployer: toHexString(deployer),
  contract: {
    address: toHexString(ethUtils.generateAddress(deployer, ethUtils.toBuffer(0))),
    deployTx: toHexString(tx.serialize()),
  }
}));
