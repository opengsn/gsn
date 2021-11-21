import { expect } from 'chai'
import { RelayRegistrarInstance } from '@opengsn/contracts'
import { AddressZero, HashZero } from 'ethers/constants'
import '../utils/chaiHelper'
import { cleanValue } from './chaiHelper'
import { evmMineMany } from '../TestUtils'

const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('#RelayRegistrar', function ([fromAddress, relay, relay2]) {
  let reg: RelayRegistrarInstance
  let relay1block: number
  let firstBlockNumber: number
  let secondBlockNumber: number

  before(async function () {
    reg = await RelayRegistrar.new(AddressZero, true)
    await reg.registerRelayServer(1, 2, 'http://relay', { from: relay })
    relay1block = await web3.eth.getBlockNumber()
    await reg.registerRelayServer(210, 220, 'http://relay20', { from: relay2 })
    firstBlockNumber = await web3.eth.getBlockNumber()
    await evmMineMany(2)
    await reg.registerRelayServer(21, 22, 'http://relay2', { from: relay2 })
    secondBlockNumber = await web3.eth.getBlockNumber()
  })

  it('should save first and last block number', async () => {
    const info = await reg.getRelayInfo(relay2)
    expect(info.lastBlockNumber).to.eql(secondBlockNumber)
    expect(info.stakeBlockNumber).to.eql(firstBlockNumber)
  })

  it('#splitString, packString', async () => {
    expect(await reg.splitString('1')).to.eql(['0x31'.padEnd(66, '0'), HashZero, HashZero])
    expect(await reg.splitString('1'.repeat(32))).to.eql(['0x' + '31'.repeat(32), HashZero, HashZero])
    expect(await reg.splitString('1'.repeat(33))).to.eql(['0x' + '31'.repeat(32), '0x31'.padEnd(66, '0'), HashZero])

    expect(await reg.packString(await reg.splitString('1'.repeat(33)))).to.eql('1'.repeat(33))

    const str = 'this is a long string to split. it should fit into several items. this should fit into 3 words'
    expect(await reg.packString(await reg.splitString(str))).to.eql(str)

    expect(await reg.packString(await reg.splitString('short string'))).to.eql('short string')
    expect(await reg.packString(await reg.splitString('1'))).to.eql('1')
  })

  it('should get info', async () => {
    const info = await reg.getRelayInfo(relay)
    expect(info.baseRelayFee).to.eql(1)
    expect(info.lastBlockNumber).to.eql(relay1block)
  })

  it('should read list', async () => {
    const ret = await reg.readRelayInfos(0, 5) as any
    let { info, filled } = ret

    info = cleanValue(info)
    // remove block number, to make the test deterministic..
    info.forEach((item: any) => {
      delete item.lastBlockNumber
      delete item.stakeBlockNumber
    })
    expect(info).to.eql([
      {
        relayManager: relay,
        baseRelayFee: '1',
        pctRelayFee: '2',
        url: 'http://relay'
      },
      {
        relayManager: relay2,
        baseRelayFee: '21',
        pctRelayFee: '22',
        url: 'http://relay2'
      }

    ])
    expect(filled).to.eql(2)
  })
})
