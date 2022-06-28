#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`node -e "console.log(require('../../packages/common/dist/Version.js').gsnRuntimeVersion)"`
echo version=$VERSION

IMAGE=opengsn/jsrelay

#build docker image of relay
#rebuild if there is a newer src file:
find ./dbuild.sh ../../packages/*/src/ -type f -newer dist/relayserver.js 2>&1 | grep . && {
#	yarn preprocess
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

