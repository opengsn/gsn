import { expect } from 'chai'
import { RelayRegistrarInstance } from '@opengsn/contracts'
import { AddressZero, HashZero } from 'ethers/constants'
import '../utils/chaiHelper'
import { cleanValue } from './chaiHelper'

const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('#RelayRegistrar', function ([fromAddress, relay, relay2]) {
  let reg: RelayRegistrarInstance

  let relay1block: number
  before(async () => {
    reg = await RelayRegistrar.new(AddressZero, true)
    await reg.registerRelayServer(AddressZero, 1, 2, 'http://relay', { from: relay })
    relay1block = await web3.eth.getBlockNumber()
    await reg.registerRelayServer(AddressZero, 210, 220, 'http://relay20', { from: relay2 })
    await reg.registerRelayServer(AddressZero, 21, 22, 'http://relay2', { from: relay2 })
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
    expect(info.blockNumber).to.eql(relay1block)
  })
  it('should read list', async () => {
    const ret = await reg.readRelayInfos(0, 5) as any
    let { info, filled } = ret

    info = cleanValue(info)
    // remove block number, to make the test deterministic..
    info.forEach((item: any) => delete item.blockNumber)
    expect(info).to.eql([
      {
        relayManager: relay2,
        baseRelayFee: '21',
        pctRelayFee: '22',
        url: 'http://relay2'
      },
      {
        relayManager: relay,
        baseRelayFee: '1',
        pctRelayFee: '2',
        url: 'http://relay'
      }
    ])
    expect(filled).to.eql(2)
  })
})
