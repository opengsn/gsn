#!/bin/bash -xe
cd `cd \`dirname $0\`;pwd`

IMAGE=opengsn/cli

#build docker image of cli tools
rm -rf ../../dist && npx tsc 
perl -pi -e 's/^#.*//; s/.*(start|run).*//' ../../dist/src/cli/commands/gsn.js

rm -rf dist && npx webpack

docker build -t $IMAGE .
test -z "$VERSION" && VERSION=`jq < ../../package.json -r .version`
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

