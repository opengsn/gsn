#!/bin/bash -e

function onexit() {
	echo onexit
	pkill -f RelayHttpServer
}

trap onexit EXIT

pkill -f RelayHttpServer && echo kill old relayserver
if [ "$1" == "internal" ]; then
	ethereumNodeUrl=http://localhost:8545
	network=devUseHardcodedAddressLocal
else
	ethereumNodeUrl=http://host.docker.internal:8545
	network=devUseHardcodedAddress
fi

hubaddr=`perl -ne 'print $1 if /contract.*address.*?(\w+)/' < ./singleton/deploy.json`
truffle exec --network $network ./scripts/singleton/deploy.js

echo $ethereumNodeUrl
#fund relay:
relayurl=http://localhost:8090
( sleep 5 ; /scripts/fundrelay.js $hubaddr $relayurl 0 $ethereumNodeUrl) &

/RelayHttpServer -RelayHubAddress $hubaddr -Workdir $root/build/server -GasPricePercent -99 -EthereumNodeUrl $ethereumNodeUrl
