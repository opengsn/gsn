#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

IMAGE=opengsn/prefixrouter

docker build -t $IMAGE .
test -z "$VERSION" && VERSION=`perl -ne 'print $1 if /gsnRuntimeVersion.*=\D*([\d.]+)/' ../../src/common/Version.ts`
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

