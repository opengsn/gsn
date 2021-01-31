#!/bin/bash -xe
cd `cd \`dirname $0\`;pwd`

test -z "$VERSION" && VERSION=`perl -ne "print \\$1 if /gsnRuntimeVersion.*=.*'(.*?)'/" ../../src/common/Version.ts`
echo version=$VERSION

IMAGE=opengsn/cli

#build docker image of cli tools
#rebuild if there is a newer src file:
find *.* ../../src/ -type f -newer dist/gsn.js 2>&1 | grep . && {
	rm -rf ../../dist dist
	npx tsc
	perl -pi -e 's/^#.*//; s/.*(start|run).*//' ../../dist/src/cli/commands/gsn.js
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

