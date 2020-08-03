#!/bin/bash -xe
IMAGE=opengsn/relayserver
#build docker image of relay
rm -rf ../../dist dist
npx tsc
npx webpack
docker build -t opengsn/jsrelay .
VERSION=`jq < ../../package.json -r .version`
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE; docker push $IMAGE:$VERSION"

