#!/bin/bash
#initialize environment
cd `dirname $0`
source ../utils/funcs.sh

#shutdown previous running test
docker ps|grep -q -v CONTAINER && ./done.sh

#remove leftovers from other tests..
rm -rf gsndata build

rm -rf build/relaydc2
mkdir -p build/relaydc2

VERSION=test ../../jsrelay/dbuild.sh || fatal "failed to build"

#build custom server, with 2 instances
#note we tag it with our just-built jsrelay
../../relaydc/add-instance ../../relaydc/docker-compose.yml | \
	perl -pe 's!opengsn/jsrelay:.*!opengsn/jsrelay:test!' \
	> build/relaydc2/docker-compose.yml

#build base image (just with custom version tag)
VERSION=test ../../relaydc/dbuild.sh

#create custom Dockerfile for new image:
cat <<EOF > ./build/relaydc2/Dockerfile
FROM opengsn/relaydc:test
copy docker-compose.yml .
EOF

#build custom image, with 2 GSN relays:
docker build -t opengsn/relaydc:test2 ./build/relaydc2

#start ganache
docker run --name ganache-docker -d -p 8545:8545 trufflesuite/ganache-cli:latest
waitForUrl http://localhost:8545 Bad "start ganache"

node ../../../packages/cli/dist/commands/gsn-deploy.js --yes -m ''
export HUB=`jq -r .address < ./build/gsn/RelayHub.json`
export REG=`jq -r .address < ./build/gsn/VersionRegistry.json`
node ../../../packages/cli/dist/commands/gsn-registry.js --registry $REG --id hub --ver test --add $HUB

echo "registry=$REG hub=$HUB myip=$MYIP"
test -n "$MYIP" || fatal "unable to find MYIP"
test -n "$REG" || fatal "unable to find VersionRegistry"

#we don't want relayer-register to depend on local configuration, only on actual server
rm -rf build/gsn

#update hub address in configuration
perl -pe 's/\$(\w+)/$ENV{$1}/ge' gsn-relay-config.json.template > config/gsn-relay-config.json

#force rdc to use the test-created custom docker image, and not "latest"
./testrdc up -d

#wait for servers to be up and ready. takes ~10-20 seconds for a server to be ready 
STOPWAIT=missing TIMEOUT=30 waitForUrl http://$MYIP:8080/gsn1/getaddr RelayHubAddress.*0x || fatal "no relayer gsn1"
STOPWAIT=missing waitForUrl http://$MYIP:8080/gsn2/getaddr RelayHubAddress.*0x || fatal "no relayer gsn2"

#note that the "https-portal" fails certificate validation, so we use the port:8080 "bypass" of the prefixrouter

