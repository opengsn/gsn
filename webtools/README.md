## Bootstrapping a running environment.

While the "**restart-relay.sh**" helper scripts bootstraps working relay on a ganache instance, its obvious that we need a more complex mechanism for real networks.

Below is a sequence of operations need to be done:
### Initial setup
1. start a node (yes, it can be ganache, but also can be a "real" geth node.
2. Make sure your MetaMask wallet has funds on that network. for ganache, you can use:
   `./scripts/ganache-fund.js 10 {addr}` to put 10 ether into your wallet.
3. deploy the RelayHub and your contract. `truffle migrate` will deploy them (the hub and **SampleRecipient** contract )

### Funding a contract
Since the contract pays for the request (instead of clients), 
its imperative that the contract has some funds to pay with.
1. launch the web tool with `npm run webtools`
2. select "Manager Contract"
3. put in your contract address.
4. the tool will check the funds deposited for the contract on the RelayHub.
5. You can specify amount of ether to deposit for your contract

### Starting a relay
1. launch the relay with the RelayHub address: `./build/server/bin/HttpRelayServer -RelayHubAddress {addr}`
  the server will wait for initial funding (and stake) by an owner, before it can start working.
2. start the webtool with `npm run webtool`
3. Select "Relay Owner Manager" tool.
4. put in the relay hub address.
5. click "check" to ping the relay. it will make sure it runs, and also display its funding status.
  the relay status is "waiting for owner" - you put a stake on the relay in order to become its owner.
6. put a stake, stake-time and ether values, and click Apply
  note that "Apply" will try to raise the relay levels to the given ones, but will skip staking if a stake is already present.
  likewise, it will skip funding of the current ether balance is at least half of the specified Ether level.
7. once staked, pinging it again will show it as "ready"

