#!/bin/bash -ex

rm -rf ./build

mkdir -p build/dock-node_modules
cp node_modules/openzeppelin-solidity build/dock-node_modules -a
cp node_modules/@0x build/dock-node_modules -a
./dock/run.sh sh -c 'make build-server'

serverbuild=./build/serverdock

mkdir $serverbuild

cp ./build/dock-builD/server/bin/RelayHttpServer $serverbuild
cp ./serverdock/start-relay.sh $serverbuild
cp ./serverdock/start-relay-with-ganache.sh $serverbuild
cp ./scripts/fundrelay.js $serverbuild
cp ./src/js/relayclient/IRelayHub.js $serverbuild
cp ./serverdock/truffle.js $serverbuild
cp -a ./contracts $serverbuild
cp -a ./serverdock/migrations $serverbuild

echo -n `git describe --dirty` > $serverbuild/version

docker build -t gsn-dev-server -f ./serverdock/Dockerfile $serverbuild
