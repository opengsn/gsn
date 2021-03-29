#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`perl -ne "print \\$1 if /gsnRuntimeVersion.*=.*'(.*?)'/" ../../packages//common/src/Version.ts`
echo version=$VERSION

IMAGE=opengsn/relaydc

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

