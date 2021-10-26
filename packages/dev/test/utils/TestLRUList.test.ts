import { expect } from "chai";
import { RelayRegistrarInstance, TestLRUListInstance } from "@opengsn/contracts";
import { expectRevert } from "@openzeppelin/test-helpers";
import { AddressZero, HashZero } from "ethers/constants";
import './chaiHelper'


function addr(n: number) {
    return '0x'.padEnd(42, n.toString())
}

const TestLRUList = artifacts.require('TestLRUList')

describe('TestLRUList', function () {

    let list: TestLRUListInstance
    before(async () => {
        list = await TestLRUList.new()
    })
    it('count of empty list', async () => {
        expect(await list.countItems()).to.eql(0)
    });
    it('read items of empty list', async () => {
        expect(await list.readValues(100)).to.eql([])
    })
    it('next of list should be itself', async () => {
        expect(await list.next(list.address)).to.eql(list.address)
    })
    it('prevItem of empty list should be itself', async () => {
        expect(await list.getPrev(list.address)).to.eql(list.address)
    });
    it('prevItem of unknown should revert', async () => {
        await expectRevert(list.getPrev(addr(1)), 'item not in list')
    });

    it('should fail on not-in-list item', async () => {
        await expectRevert(list.setValue(addr(99), addr(88), 99),
            'given wrong prevItem')
    });
    describe('after add item', () => {
        before(async () => {
            await list.setValue(addr(1), AddressZero, 11)
        })
        it('should count one item', async () => {
            expect(await list.countItems()).to.eql(1)
        });
        it('read one item', async () => {
            expect(await list.readValues(100)).to.eql([11])
        })
        it('prevItem should be head', async () => {
            expect(await list.getPrev(addr(1))).to.eql(list.address)
        });
        it('should fail to add same item as new', async () => {
            await expectRevert(list.setValue(addr(1), AddressZero, 11),
                'must specify prevItem')
        });
        it('add same item should keep list unchanged', async () => {
            expect(await list.readValues(100)).to.eql([11])
        })
        describe('after add second item', () => {
            before(async () => {
                await list.setValue(addr(2), AddressZero, 22)
            })
            it('should count 2 items', async () => {
                expect(await list.countItems()).to.eql(2)
            });
            it('read list of 2', async () => {
                expect(await list.readValues(100)).to.eql([22, 11])
            })

            it('should move item to be first after adding again', async () => {
                await list.setValue(addr(1), await list.getPrev(addr(1)), 111)
                expect(await list.readValues(100)).to.eql([111, 22])
            });
            describe('after adding 3 more items', function () {
                before(async () => {
                    await list.setValue(addr(3), AddressZero, 33)
                    await list.setValue(addr(4), AddressZero, 44)
                    await list.setValue(addr(5), AddressZero, 55)
                });
                it('should return a list of 4', async () => {
                    expect(await list.readValues(100)).to.eql([55, 44, 33, 111, 22])
                });
                it('#readAllItems', async () => {
                    expect(await list.readAllItems()).to.eql([addr(5), addr(4), addr(3), addr(1), addr(2)])
                });
                it('#countFrom', async () => {
                    const retValues = (obj: any) => {
                        const {ret, nextFrom} = obj
                        return {ret: ret.toString(), nextFrom}
                    }
                    await expectRevert(list.countFrom(addr(1234), 123),
                        'not in list')
                    //full list count
                    expect(retValues(await list.countFrom(list.address, 20))).to.eql({
                        ret: '5',
                        nextFrom: AddressZero
                    })

                    //max=2. return the first item for next count.
                    expect(retValues(await list.countFrom(list.address, 2))).to.eql({ret: '2', nextFrom: addr(4)})
                    //and then next 2 items
                    expect(retValues(await list.countFrom(addr(4), 2))).to.eql({ret: '2', nextFrom: addr(1)})

                    expect(retValues(await list.countFrom(addr(4), 20))).to.eql({ret: '3', nextFrom: AddressZero})
                    //starting from last item (1=the prev of last item)
                    expect(retValues(await list.countFrom(addr(1), 1))).to.eql({ret: '1', nextFrom: addr(2)})
                    //starting after the last item:
                    expect(retValues(await list.countFrom(addr(2), 10))).to.eql({ret: '0', nextFrom: AddressZero})
                });
                it('#readAllItems', async () => {
                    expect(await list.readAllItems()).to.eql([addr(5), addr(4), addr(3), addr(1), addr(2)])
                });
                it('#readItemsFrom', async () => {
                    const retValues = (obj: any) => {
                        const {ret, nextFrom} = obj
                        return {ret, nextFrom}
                    }
                    await expectRevert(list.readItemsFrom(addr(1234), 10),
                        'not in list')
                    expect(retValues(await list.readItemsFrom(list.address, 2))).to.eql({
                        ret: [addr(5), addr(4)],
                        nextFrom: addr(4)
                    })
                    expect(retValues(await list.readItemsFrom(addr(4), 2))).to.eql({
                        ret: [addr(3), addr(1)],
                        nextFrom: addr(1)
                    })
                    expect(retValues(await list.readItemsFrom(addr(1), 2))).to.eql({
                        ret: [addr(2)],
                        nextFrom: AddressZero
                    })
                });
            });
        })
    })
});
