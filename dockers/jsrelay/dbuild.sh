#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`perl -ne "print \\$1 if /gsnRuntimeVersion.*=.*'(.*?)'/" ../../packages//common/src/Version.ts`
echo version=$VERSION

IMAGE=opengsn/jsrelay

#build docker image of relay
#rebuild if there is a newer src file:
find ./dbuild.sh ../../packages/*/src/ -type f -newer ../../packages/relay/tsconfig.tsbuildinfo 2>&1 | grep . && {
	yarn preprocess
}
#todo: can check if its newer than dist/relayserver.js
npx webpack

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

