#!/bin/bash -e
TESTPORT=8543
TESTADDRS=0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1,0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0,0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b

trap onexit EXIT

onexit() {
  if [ -f "ganache.pid" ]; then 
    echo "Stopping ganache"
    kill `cat ganache.pid` && rm ganache.pid 
  fi
}

cd .. && \
  ./scripts/run-ganache ${TESTPORT} > ganache.pid

go test -v -count=1 librelay
go test -v -count=1 librelay/txstore
