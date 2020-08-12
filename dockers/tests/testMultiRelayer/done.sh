#!/bin/bash -x
cd `dirname $0`

./r down -t 0
docker rm -f ganache-docker

