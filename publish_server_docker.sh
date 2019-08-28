#!/bin/bash -xe

repository=tabookey/gsn-dev-server
version=`docker run -t gsn-dev-server cat version`

regex='^[^ -]+$'
if [[ ! $version =~ $regex ]];
then
	echo "FATAL: ${version} contains illegal characters"
	exit 1
fi

docker tag gsn-dev-server $repository:$version
docker push $repository:$version
