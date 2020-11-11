#!/bin/bash -e
IMAGE=opengsn/prefixrouter
docker build -t $IMAGE `dirname $0`
test -z "$VERSION" && VERSION=`perl -ne 'print $1 if /gsnRuntimeVersion.*=\D*([\d.]+)/' ../../src/common/Version.ts`

docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

