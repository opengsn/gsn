#!/usr/bin/env node

var solc
fs=require('fs')

contractsFolder ="contracts"
outAbiFolder = "src/js/relayclient"

contractsToExtract =[ "RelayHubApi", "RelayRecipientApi" ]

contractsToExtract.forEach( c=>{

	contractFile = contractsFolder + "/"+ c + ".sol"
	outAbiFile = outAbiFolder + "/" + c +".js"

	try {
		if ( fs.statSync(contractFile).mtime <= fs.statSync(outAbiFile).mtime ) {
			console.log( "not modified: ", outAbiFile )
			return
		}
	} catch(e){
		//target file is missing.
	}
	if ( !solc )
		solc=require('solc')

	hubApi = fs.readFileSync( contractFile, {encoding:'utf8'} )

	result = solc.compile(hubApi,0)
	if ( result.errors || ! result.contracts) {
		console.log( "ERROR: ", result )
		process.exit(1)
	}

	abi = result.contracts[ ":"+c ].interface

	if ( !abi )  {
		console.log( "ERROR: failed to extract abi:", result)
		process.exit(1);
	} else {

		// console.log( "src=",hubApi )
		fs.writeFileSync( outAbiFile, "module.exports="+abi )
		console.log( "written \""+outAbiFile+"\"" )
	}
})

