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

truffle migrate --network $network
hubaddr=0x9C57C0F1965D225951FE1B2618C92Eefd687654F

echo $ethereumNodeUrl
#fund relay:
relayurl=http://localhost:8090
( sleep 5 ; /scripts/fundrelay.js $hubaddr $relayurl 0 $ethereumNodeUrl) &

/RelayHttpServer -RelayHubAddress $hubaddr -Workdir $root/build/server -GasPricePercent -99 -EthereumNodeUrl $ethereumNodeUrl
