#!/bin/bash -xe
#build docker image of relay
#note: package.json contains only packages used by ../src/relayserver

mkdir -p dist
yarn install
cp -r ../src dist/
docker build -t opengsn/jsrelay .
