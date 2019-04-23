/*global artifacts describe before it assert */
const TestRecipientUtils=artifacts.require( 'TestRecipientUtils.sol' )
const RecipientUtils=artifacts.require( 'RecipientUtils.sol' )


describe( 'RecipientUtils', async() => {
	var testForUtils, recipientUtils;
	before(async ()=> {
		recipientUtils = await RecipientUtils.new()
		testForUtils = await TestRecipientUtils.new()
	})

    it( "test sig", async() =>{
        let data = testForUtils.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()
        let sig = data.slice(0,10)
        let s = await recipientUtils.sig("testFunc(uint256,string,uint256,bytes)")
        assert.equal( sig, s )
    })

    it( "test getMethodSig", async() =>{
        let data = testForUtils.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()
        let s = await recipientUtils.sig("testFunc(uint256,string,uint256,bytes)")
        assert.equal( s, await recipientUtils.getMethodSig(data) )
    })

    it( "test params", async() =>{
        let data = testForUtils.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()

        assert.equal( 1, await recipientUtils.getParam(data,0) )
        assert.equal( "hello", await recipientUtils.getStringParam(data,1) )
        assert.equal( 2, await recipientUtils.getParam(data,2) )
        assert.equal( "0xdeadface", await recipientUtils.getBytesParam(data,3) )
    })


})
