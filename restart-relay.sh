#!/bin/bash -e

if [ "$1" == "help" ]; then

echo Usage:
echo "  $0 test - run all tests, and exit"
echo "  $0      - (no args) start HttpRelayServer, and wait"
echo "  $0 web  - start HttpRelayServer and sample MetaCoin web app (downloaded into \"webpack-box\" subfolder"
exit 1

else 
	echo "use '$0 help' for usage."
fi

function onexit() {
	echo onexit
	pkill -f ganache
	pkill -f RelayHttpServer
}

trap onexit EXIT

dir=`dirname $0`
root=`cd $dir;pwd`

cd $root
#todo: should compile the server elsewhere.
gobin=$root/build/server/bin/
export GOPATH=$root/server/:$root/build/server
echo "Using GOPATH=" $GOPATH
# cd $gobin
./scripts/extract_abi.js
make -C server 
#todo: run if changed..
blocktime=${T=0}

pkill -f ganache-cli && echo killed old ganache.
pkill -f RelayHttpServer && echo kill old relayserver

GANACHE="$root/node_modules/.bin/ganache-cli -l 8000000 -b $blocktime -a 11 -h 0.0.0.0 "

if [ -n "$DEBUG" ]; then
	$GANACHE -d --verbose &
else
	#just display ganache version
	sh -c "$GANACHE -d |grep ganache-core" &
fi

sleep 2

if ! pgrep  -f ganache > /dev/null ; then
	echo FATAL: failed to start ganache.
	exit 1
fi

hubaddr=`truffle migrate | tee /dev/stderr | grep "RelayHub:" | grep "0x.*" -o`

if [ -z "$hubaddr" ]; then
echo "FATAL: failed to detect RelayHub address"
exit 1
fi

#fund relay:
relayurl=http://localhost:8090
( sleep 1 ; ./scripts/fundrelay.js $hubaddr $relayurl 0 ) &

if [ -n "$1" ]; then

$gobin/RelayHttpServer -RelayHubAddress $hubaddr -Workdir $root/build/server &

cd $root
sleep 1

case "$*" in
	test) 	cmd="truffle test" ;; 
	test/*) cmd="truffle test $*" ;;
	web)	cmd="./init_metacoin.sh web" ;;
	*)	echo "Unknown command. do '$0 help'"; exit 1 ;;
esac

echo "Running: $cmd"
if eval $cmd
then
	echo command completed successfully
else
	exitcode=$?
	echo command failed
fi

exit $exitcode

else

$gobin/RelayHttpServer -RelayHubAddress $hubaddr -Workdir $root/build/server
	
fi

