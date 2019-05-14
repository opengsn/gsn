const { lstatSync, readdirSync } = require('fs')
const { join } = require('path')

const ethTx = require('ethereumjs-tx');
const ethUtils = require('ethereumjs-util');

function toHexString(buffer) {
  return '0x' + buffer.toString('hex')
}

const bin = require(`../../singleton/RelayHub.flattened.json`)
  .contracts['singleton/RelayHub.flattened.sol:RelayHub']
  .bin;

const tx = new ethTx({
  nonce: 0,
  data: '0x' + bin,
  value: 0,
  gasPrice: 100000000000, /// 100 gigawei
  gasLimit: 8000000,
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
