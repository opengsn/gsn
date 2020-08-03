#!/bin/bash -e
IMAGE=opengsn/prefixrouter
docker build -t $IMAGE `dirname $0`
VERSION=`jq < ../../package.json -r .version`

docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE; docker push $IMAGE:$VERSION"

