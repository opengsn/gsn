const mode = process.env.MODE;

useInProcessGanache=true
//currently exposing the in-process ganache doesn't work well (relay fail to work with it..)
//exposeGanachePort=8545

const ProviderEngine = require("web3-provider-engine");
const RpcProvider = require("web3-provider-engine/subproviders/rpc.js");
const { TruffleArtifactAdapter } = require("@0x/sol-trace");

const ganacheHttpServer = require( 'ganache-core/lib/httpServer' )
const { GanacheSubprovider } = require("@0x/subproviders")

const { ProfilerSubprovider } = require("@0x/sol-profiler");
const { CoverageSubprovider } = require("@0x/sol-coverage");
const { RevertTraceSubprovider } = require("@0x/sol-trace");


const projectRoot = "";
const solcVersion = "0.5.5";
const defaultFromAddress = "0x5409ed021d9299bf6814279a6a1411a7e866a631";
const isVerbose = true;
const artifactAdapter = new TruffleArtifactAdapter(projectRoot, solcVersion);
const provider = new ProviderEngine();

//add to tests: global.addPostCoverage(this), so they save coverage data.
global.saveCoverageAtEnd = function(test) {
	after = test.after
	if ( typeof after !== 'function' ) {
		console.log( "ERROR: given test", test, "doesn't have \"after()\" method" )
		return
	}
	after("write coverage/profiler output", async () => {
	        await global.postCoverage()
	});
}

global.postCoverage = async function() {

    if (mode === "profile") {
	console.log( "==== writing profile data" );
      await global.profilerSubprovider.writeProfilerOutputAsync();
    } else if (mode === "coverage") {
	console.log( "==== writing coverage data" );
      await global.coverageSubprovider.writeCoverageAsync();
    }
}

if (mode === "profile") {
  global.profilerSubprovider = new ProfilerSubprovider(
    artifactAdapter,
    defaultFromAddress,
    isVerbose
  );
  global.profilerSubprovider.stop();
  provider.addProvider(global.profilerSubprovider);
  provider.addProvider(new RpcProvider({ rpcUrl: "http://localhost:8545" }));
} else {
  if (mode === "coverage") {
    global.coverageSubprovider = new CoverageSubprovider(
      artifactAdapter,
      defaultFromAddress,
      isVerbose
    );
    provider.addProvider(global.coverageSubprovider);
  } else if (mode === "trace") {
    const revertTraceSubprovider = new RevertTraceSubprovider(
      artifactAdapter,
      defaultFromAddress,
      isVerbose
    );
    provider.addProvider(revertTraceSubprovider);
  }
  if ( global.useInProcessGanache ) {
	const ganahceSubprovider = new GanacheSubprovider();

	provider.addProvider(ganahceSubprovider);
	
	if ( global.exposeGanachePort ) {
	  s = ganacheHttpServer( provider, {log : ()=>{}} )

	  s.listen( {port:exposeGanachePort, host:'localhost'} ) 
	  console.log( "Started in-process Ganache, on port "+exposeGanachePort )
	}
	
  } else {
	//use external provider
	provider.addProvider(new RpcProvider({ rpcUrl: "http://localhost:8544" }));
  }
}
provider.start(err => {
  if (err !== undefined) {
    console.log(err);
    process.exit(1);
  }
});

/**
 * HACK: Truffle providers should have `send` function, while `ProviderEngine` creates providers with `sendAsync`,
 * but it can be easily fixed by assigning `sendAsync` to `send`.
 */
provider.send = provider.sendAsync.bind(provider);

module.exports = provider
