#!/bin/bash 
cd `dirname $0`

source ../utils/funcs.sh

#if NOINIT is set, then skip init.sh/done.sh (they must be called manually)
if [ -z "$NOINIT" ]; then
  source ./init.sh
  trap exitTest exit
fi


function exitTest {
    exitWithTestSummary
    ./done.sh
}

resp1=`curl -s http://$MYIP:8080/gsn1/getaddr`
resp2=`curl -s http://$MYIP:8080/gsn2/getaddr`


resphub=` echo $resp1 | jq -r .RelayHubAddress`
gsn1mgr=`echo $resp1 | jq -r .RelayManagerAddress`
gsn2mgr=`echo $resp2 | jq -r .RelayManagerAddress`
gsn1worker=`echo $resp1 | jq -r .RelayServerAddress`
gsn2worker=`echo $resp2 | jq -r .RelayServerAddress`

assertEq "$gsn1addr" "$gsn2addr" "two relayers should have same manager"

#NOTE this is incomplete test to check the relays are different...
#(its OK for current relayers, which have exactly one worker. but once each relay will have many,
# it is not enough..)
assertNotEq "$gsn1worker" "$gsn2worker" "two relayers should have different workers"

#verify relayer is configured with correct hub (fetched from registry)
assertEq "$resphub" "$HUB" "relayer returned hub."

#register relayer. note that we need to register only one instance on the host, since they share
# a manager
node ../../../dist/src/cli/commands/gsn-relayer-register.js --relayUrl http://$MYIP:8080/gsn1/ 

waitForUrl http://$MYIP:8080/gsn1/getaddr '"Ready":true' "gsn1 registered successfully"
waitForUrl http://$MYIP:8080/gsn2/getaddr '"Ready":true' "2nd relay registered too"

