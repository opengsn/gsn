#!/bin/bash -xe
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`node -e "console.log(require('../../packages/common/dist/Version.js').gsnRuntimeVersion)"`
echo version=$VERSION

IMAGE=opengsn/cli

#build docker image of cli tools
#rebuild if there is a newer src file:
find *.* ../../packages/*/src -type f -newer dist/gsn.js 2>&1 | grep . && {
	yarn preprocess
	perl -pi -e 's/^#.*//; s/.*(start|run).*//' ../../packages/cli/dist/commands/gsn.js
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

