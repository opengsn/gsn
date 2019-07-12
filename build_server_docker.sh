#!/bin/bash -ex

rm -rf ./build

./dock/run.sh yarn
./dock/run.sh sh -c 'make build-server'

serverbuild=./build/serverdock

rm -rf $serverbuild
mkdir $serverbuild

cp ./build/dock-builD/server/bin/RelayHttpServer $serverbuild
cp ./serverdock/package.json $serverbuild
cp ./serverdock/start-relay.sh $serverbuild
cp ./serverdock/start-relay-with-ganache.sh $serverbuild
tar cf - ./scripts/fundrelay.js ./src/js/relayclient/IRelayHub.js ./contracts | tar xvf - -C $serverbuild  
cp ./serverdock/truffle.js $serverbuild
cp -a ./contracts $serverbuild
cp -a ./serverdock/migrations $serverbuild

echo -n `git describe --dirty` > $serverbuild/version

docker build -t gsn-dev-server -f ./serverdock/Dockerfile $serverbuild
