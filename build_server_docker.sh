#!/bin/bash -ex

rm -rf ./build

./dock/run.sh sh -c 'make build-server'

serverbuild=./build/serverdock

mkdir $serverbuild

cp ./build/dock-builD/server/bin/RelayHttpServer $serverbuild
cp ./start-relay.sh $serverbuild
cp ./scripts/fundrelay.js $serverbuild
cp ./src/js/relayclient/RelayHubApi.js $serverbuild
cp ./serverdock/truffle.js $serverbuild
cp -a ./contracts $serverbuild
cp -a ./serverdock/migrations $serverbuild

echo -n `git describe --dirty` > $serverbuild/version

docker build -t gsn-dev-server -f ./serverdock/Dockerfile $serverbuild