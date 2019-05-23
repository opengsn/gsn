#!/bin/bash -e

ganache-cli -l 8000000 -h 0.0.0.0 > geth.log 2>&1 &
./start-relay.sh internal
