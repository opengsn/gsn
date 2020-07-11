#!/bin/bash -xe
#build docker image of relay
npx webpack
docker build -t opengsn/jsrelay .
