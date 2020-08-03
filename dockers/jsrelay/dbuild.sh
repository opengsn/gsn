#!/bin/bash -xe
IMAGE=opengsn/jsrelay
#build docker image of relay
rm -rf ../../dist dist
npx tsc
npx webpack
docker build -t $IMAGE `dirname $0`
test -z "$VERSION" && VERSION=`jq < ../../package.json -r .version`
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

