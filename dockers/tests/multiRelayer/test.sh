#!/bin/bash -xe

yarn ganache -h 0.0.0.0 &
sleep 2
#this works on mac...
test -z "$MYIP" && export MYIP=`ifconfig|grep -v 127.0.0.1| awk '/inet / {print $2}'`

VERSION=test ../../relaydc/dbuild.sh
node ../../../dist/src/cli/commands/gsn-deploy.js --yes
export HUB=`jq -r .address < ./build/gsn/RelayHub.json`
echo "hub=$HUB myip=$MYIP"
perl -pe 's/\$(\w+)/$ENV{$1}/ge' gsn-relay-config.json.template > config/gsn-relay-config.json

( sleep 10 ; node ../../../dist/src/cli/commands/gsn-relayer-register.js --relayUrl http://$MYIP:8080/gsn1/ ) &

./r up

