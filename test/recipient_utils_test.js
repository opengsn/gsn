/*global artifacts describe before it assert */
const TestRecipientUtils=artifacts.require( 'TestRecipientUtils.sol' )


describe( 'RecipientUtils', async() => {
	var b
	before(async ()=> {
		b = await TestRecipientUtils.new()
	})

    it( "test sig", async() =>{
        let data = b.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()
        let sig = data.slice(0,10)
        let s = await b.sig("testFunc(uint256,string,uint256,bytes)")
        assert.equal( sig, s )
    })

    it( "test getMethodSig", async() =>{
        let data = b.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()
        let s = await b.sig("testFunc(uint256,string,uint256,bytes)")
        assert.equal( s, await b.getMethodSig(data) )
    })

    it( "test params", async() =>{
        let data = b.contract.methods.testFunc(1,"hello", 2, "0xdeadface").encodeABI()

        assert.equal( 1, await b.getParam(data,0) )
        assert.equal( "hello", await b.getStringParam(data,1) )
        assert.equal( 2, await b.getParam(data,2) )
        assert.equal( "0xdeadface", await b.getBytesParam(data,3) )
    })


})
