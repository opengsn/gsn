import Transaction from 'ethereumjs-tx'
import ethUtils from 'ethereumjs-util'
import fs from 'fs'

function toHexString (buffer) {
  return '0x' + buffer.toString('hex')
}

const bin = fs.readFileSync('singleton/singleton_RelayHub_flattened_sol_RelayHub.bin', 'ascii')

const tx = new Transaction({
  nonce: 0,
  data: '0x' + bin,
  value: 0,
  gasPrice: 100000000000, /// 100 gigawei
  gasLimit: 4200000,
  v: 27,
  r: '0x1613161316131613161316131613161316131613161316131613161316131613',
  s: '0x1613161316131613161316131613161316131613161316131613161316131613'
})

const deployer = tx.getSenderAddress()

console.log(JSON.stringify({
  deployer: toHexString(deployer),
  contract: {
    address: toHexString(ethUtils.generateAddress(deployer, ethUtils.toBuffer(0))),
    deployTx: toHexString(tx.serialize())
  }
}))
