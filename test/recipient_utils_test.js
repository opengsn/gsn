/*global artifacts describe before it assert */
const TestRecipientUtils=artifacts.require( 'TestRecipientUtils.sol' )


describe('GsnUtils', async() => {
	var testForUtils;
	before(async ()=> {
		testForUtils = await TestRecipientUtils.new()
	})

    it( "test getMethodSig", async() =>{
        let data = testForUtils.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()
        let s =  data.slice(0,10)
        assert.equal( s, await testForUtils.getMethodSig(data) )
    })

    it( "test params", async() =>{
        let data = testForUtils.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()

        assert.equal( 1, await testForUtils.getParam(data,0) )
        assert.equal( "hello", await testForUtils.getStringParam(data,1) )
        assert.equal( 2, await testForUtils.getParam(data,2) )
        assert.equal( "0xdeadface", await testForUtils.getBytesParam(data,3) )
    })


})
