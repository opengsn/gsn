#!/bin/bash -e

function onexit() {
	echo onexit
	pkill -f RelayHttpServer
}

trap onexit EXIT

pkill -f RelayHttpServer && echo kill old relayserver

truffle migrate --network devUseHardcodedAddress
hubaddr=0x9C57C0F1965D225951FE1B2618C92Eefd687654F
ethereumNodeUrl=http://host.docker.internal:8545
#fund relay:
relayurl=http://localhost:8090
( sleep 5 ; /scripts/fundrelay.js $hubaddr $relayurl 0 $ethereumNodeUrl) &

/RelayHttpServer -RelayHubAddress $hubaddr -Workdir $root/build/server -GasPricePercent -99 -EthereumNodeUrl $ethereumNodeUrl

