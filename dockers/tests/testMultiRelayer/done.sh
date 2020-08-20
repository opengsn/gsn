#!/bin/bash -x
cd `dirname $0`

./testrdc down -t 0

docker rm -f ganache-docker

