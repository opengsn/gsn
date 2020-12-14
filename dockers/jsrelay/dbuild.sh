#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`perl -ne "print \\$1 if /gsnRuntimeVersion.*=.*'(.*?)'/" ../../src/common/Version.ts`
echo version=$VERSION

IMAGE=opengsn/jsrelay

#build docker image of relay
#rebuild if there is a newer src file:
find ./dbuild.sh ../../src/ -type f -newer dist/relayserver.js 2>&1 | grep . && {
	rm -rf ../../dist dist
	npx tsc
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

