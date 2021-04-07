#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`perl -ne "print \\$1 if /gsnRuntimeVersion.*=.*'(.*?)'/" ../../packages//common/src/Version.ts`
echo version=$VERSION

IMAGE=opengsn/jsrelay

#build docker image of relay
#rebuild if there is a newer src file:
find ./dbuild.sh ../../packages/*/src/ -type f -newer dist/relayserver.js 2>&1 | grep . && {
	yarn prepare
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

