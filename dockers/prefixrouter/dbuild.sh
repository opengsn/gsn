#!/bin/bash -e
IMAGE=opengsn/prefixrouter
docker build -t $IMAGE `dirname $0`
test -z "$VERSION" && VERSION=`jq < ../../package.json -r .version`

docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

