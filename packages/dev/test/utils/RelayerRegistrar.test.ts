import { expect } from "chai";
import { RelayRegistrarInstance } from "@opengsn/contracts";
import { AddressZero, HashZero } from "ethers/constants";

function addr(n: number) {
  return '0x'.padEnd(42, n.toString())
}

const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('#RelayerRegistrar', function ([fromAddress]) {
    let reg: RelayRegistrarInstance
    let relay = addr(1)
    let relay2 = addr(2)

    before(async () => {
        reg = await RelayRegistrar.new(fromAddress)
        await reg.registerRelayer(AddressZero, {
            blockNumber: 1,
            pctRelayFee: 2,
            baseRelayFee: 3,
            url: 'http://relay',
            relayer: relay
        })
        await reg.registerRelayer(AddressZero, {
            blockNumber: 21,
            pctRelayFee: 22,
            baseRelayFee: 23,
            url: 'http://relay2',
            relayer: relay2
        })
    });
    it('#splitString, packString', async () => {
        expect(await reg.splitString('1')).to.eql(['0x31'.padEnd(66, '0'), HashZero, HashZero])
        expect(await reg.splitString('1'.repeat(32))).to.eql(['0x' + '31'.repeat(32), HashZero, HashZero])
        expect(await reg.splitString('1'.repeat(33))).to.eql(['0x' + '31'.repeat(32), '0x31'.padEnd(66, '0'), HashZero])

        expect(await reg.packString(await reg.splitString('1'.repeat(33)))).to.eql('1'.repeat(33))

        const str = 'this is a long string to split. it should fit into several items. this should fit into 3 words'
        expect(await reg.packString(await reg.splitString(str))).to.eql(str)

        expect(await reg.packString(await reg.splitString('asdasd'))).to.eql('asdasd')
        expect(await reg.packString(await reg.splitString('1'))).to.eql('1')
    });

    it('should get info', async () => {
        const info = await reg.getRelayInfo(relay)
        expect(info.blockNumber).to.eql(1)
    });
    it('should read list', async () => {

        const ret = await reg.readValues(5)

        expect(ret).to.eql([
                {
                    blockNumber: '21',
                    relayer: '0x2222222222222222222222222222222222222222',
                    baseRelayFee: '23',
                    pctRelayFee: '22',
                    url: 'http://relay2'
                },
                {
                    blockNumber: '1',
                    relayer: '0x1111111111111111111111111111111111111111',
                    baseRelayFee: '3',
                    pctRelayFee: '2',
                    url: 'http://relay'
                }
            ]
        )
    });
});