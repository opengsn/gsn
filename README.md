# Gas Stations Network

## What is it?

It's a mechanism for dApps to work with gas-less clients.
Users are no longer required to buy Ether in order to use the dApp.

The dApp owner decides which clients or what calls are allowed, and pays for the calls. It may use its own mechanism to manage its users.

Examples

- Allow first-time install of an app, before the user buys any ether.
- Allow users to pay for transactions with their credit cards and manage their credit.
- For enterprise: trust employees to access the enterprise dApp. 

Its very simple to adapt an existing contract and apps to use the Relays

## How it works?

See our Medium Posts: 
 * [United We Stand in a Trustless Way](https://medium.com/tabookey/united-we-stand-in-a-trustless-way-fd28ecf4126f)
 * [1–800-Ethereum: Gas Stations Network for Toll Free Transactions](https://medium.com/tabookey/1-800-ethereum-gas-stations-network-for-toll-free-transactions-4bbfc03a0a56)

Or see the full technical description, in our [EIP draft](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1613.md)

The client has an account (address and private key) just like any other ethereum account - except that it never has to have any money in it.

It makes an off-chain request to a Relay Service, outside of the ethereum network.

The relay transfers the request to the target contract (through a public RelayHub contract)

The relay gets **compensated** by the target contract for its effort.

The system is completely decentralized and trust-less: the client doesn't trust on the Relay Service, and the Relay service  
doesn't trust neither the client nor the target contract, yet none can compromise the system.
A network of relays guarantees the system has high availability.

## Do I need Metamask/Mist/Hardware wallet ?

A strong wallet is required if you want to use it to save valuable assets. 
The fact the user doesn't hold eth doesn't mean its key is not valuable.
If you create a sample app, where the user won't lose much if the key is lost, then its ok to keep the key in a browser "cookie".

## Is it safe?

The GSN had passed through an extensive review, including a full security audit by OpenZeppelin, so we believe it is secured.

In our "mutual-distrust" model, neither the client or contract has to trust the relay to work correctly, nor the relay trusts the contract or client.
All transaction are signed, both by the client (though its account doesn't have to carry any ether) and by the relay.

- The contract knows that only trusted requests will ever be relayed to it, and that it's only liable to pay for those.
- The relay can be sure it will be compensated by the contract for its service.
- The client can be sure the relay did its job to relay the request, and didn't try to fool either the client or contract.
- A Relay, even though its an off-chain component, is not trusted in any way, and can't DoS the system or steal funds. Any such attempt is cryptographically proven, and penalizes the relay before banning it from the network.

Neither the relays in the network, nor the RelayHub contract are controlled by Openeth in any way.
We will operate relays in the network, to make sure there's availability of relays, but so can anyone else. 
The relays network is a free market, where relays compete based on transaction fees and quality of service, on equal grounds.

## Usage:

Prerequisites:

-	node, yarn
- 	truffle
-	docker

Install node pakcages:

	yarn



Compile and run tests: (For Docker users)

	./dock/run.sh yarn

	./dock/run.sh yarn test

The above is a docker wrapper, containing build prerequisites (`go`, `abigen`, `solc`). If you have them installed, you can run instead:

	yarn test

### Components:

- **RelayHub** - master contract on the blockchain, to manage all relays, and help clients find them.
- **RelayServer** - a relay service daemon, running as a geth module or standalone HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **RelayClient** - a javascript library for a client to access the blockchain through a relay.
	Provides APIs to find a good relay, and to send transactions through it.
	The library hooks the local web3, so that any loaded contract API will go through the relay.

note that `yarn test` above runs the entire suite: it compiles the server, then launches *ganache-cli* node, deploys the needed component and starts the relay server. then it launches truffle test to run the client tests against the relay server and the contracts on the blockchain.

### Client modifications.


	const Gsn = require( '@openeth/gsn')
    const provider = new Gsn.RelayProvider(web3.currentProvider, {} )
    web3.setProvider(provider) 

	//from now on, any transaction through this web3 will go through a relay
	
	MyContract = new web3.eth.Contract(...)

	const myContract = await MyContract.at('...')
	myContract.someMethod()


#### RelayClient options:

A relay client can receive various options:

- `force_gasLimit` - use specific gas limit for all transactions. if not set, the user must supply gas limit for each transaction.
- `force_gasprice` - if not set, then the client will use `web3.eth.gasPrice` with the factor (below)
- `gaspriceFactorPercent` - how much above default `gasPrice` to use. default is 20% which means we use gasPrice*1.2
- `minStake` - ignore relays with lower stake
- `minDelay` - ignore relays with lower stake delay
- `verbose` - show logs of client requests/responses

### Contract modifications

In order to support relayed transactions, the contract must implement the `RelayRecipient` contract. This way it can check (before the call) the caller, and decide whether to accept the call.

Here's a basic contract, which accepts requests from known users.

```javascript
contract MyContract is RelayRecipient {
    constructor() {
        // this is the only hub I trust to receive calls from
        setRelayHub(RelayHub(0xd216153c06e857cd7f72665e0af1d7d82172f494));
    }

    mapping (address => bool) public my_users;

    // this method is called by the RelayHub, before relaying the transaction.
    // the method should return zero if and only if the contract accepts this transaction, and is willing to pay
    // the relay for its service.
    // it can check the user, the relay or the actual function call data.
    // note that when the RelayHub calls this method, its after it did validation of the relay and caller signatures.
    function acceptRelayedCall(address relay, address from, bytes calldata encodedFunction, 
            uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, 
            bytes calldata approvalData, uint256 maxPossibleCharge) 
    external view returns (uint256, bytes memory) {

        // we simply trust all our known users.
        if ( !my_users[from] ) return (10, "unknown user");
        return (0,"");
    }

    //simple contracts can leave the pre/post calls empty. This is where you can add
    // accounting logic for your users.
    function preRelayedCall(bytes calldata context) relayHubOnly external returns (bytes32) {
        return 0;
    }

    function postRelayedCall(bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal) relayHubOnly external {
    }

    // This is a sample contract method. 
    // note that when receiving a request from a relay, the msg.sender is always a RelayHub.
    // You must change your contract to use _msgSender() to get the real sender.
    // (its OK if someone calls this method directly: if no relay is involved, _msgSender() returns msg.sender)
    function my_method() {
        require ( my_users[ _msgSender() ] );
        ...
    }
}
	
```

In the [samples/contracts](samples/contracts) folder there are several sample RelayRecipient implementations for general use-cases.
