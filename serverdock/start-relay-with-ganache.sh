#!/bin/bash -e

ganache-cli -h 0.0.0.0 > geth.log 2>&1 &
./start-relay.sh internal