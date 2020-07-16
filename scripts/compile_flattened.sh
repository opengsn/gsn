#!/bin/bash -ex

PRAGMA="// SPDX-License-Identifier:MIT\npragma solidity ^0.6.10;\npragma experimental ABIEncoderV2;"
CONTRACTS=("RelayHub" "StakeManager" "Penalizer" "Forwarder" "TestPaymasterEverythingAccepted")

# ok, I have no idea how to do it right; if it's working it ain't stupid though
PATHS=("./" "./" "./" "./forwarder/" "./test/")

INFOLDER=./contracts
TMPFOLDER=./build/flattened/
OUTFOLDER=./src/cli/compiled

mkdir -p $TMPFOLDER

END=${#CONTRACTS[@]}-1
for ((i=0;i<=END;i++)); do
  c=${CONTRACTS[$i]}
  c_flat=$TMPFOLDER"${c}"_flat.sol
  echo -e $PRAGMA > $c_flat
  truffle-flattener $INFOLDER/${PATHS[$i]}$c.sol | grep -v pragma | grep -v SPDX >> $c_flat
  solcjs --overwrite --evm-version istanbul -o $OUTFOLDER --bin --abi $c_flat
done
