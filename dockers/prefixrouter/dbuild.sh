#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`node -e "console.log(require('../../packages/common/dist/Version.js').gsnRuntimeVersion)"`
echo version=$VERSION

IMAGE=opengsn/prefixrouter

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

