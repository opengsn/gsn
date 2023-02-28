#!/bin/bash -ex
find ./types/truffle-contracts -type f -name '*.d.ts' | xargs sed -i'' -e 's/web3-eth-contract/..\/Web3Types/g'
