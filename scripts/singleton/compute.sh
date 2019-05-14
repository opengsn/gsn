#! /bin/bash

# Exit script as soon as a command fails.
set -o errexit

solidity_version="0.5.8"
if solc --version | grep -q "$solidity_version" ; then
  echo "Will compile using solc v$solidity_version"
else
  echo "solc version v$solidity_version is required"
  exit 1
fi

output_dir="singleton"

echo "Storing artifacts in directory '$output_dir'"

rm -rf "$output_dir" # Delete possible remains from previous run
mkdir -p "$output_dir"
npx truffle-flattener contracts/RelayHub.sol > $output_dir/RelayHub.flattened.sol

solc --optimize --optimize-runs 200 --metadata-literal --combined-json abi,bin,metadata "$output_dir/RelayHub.flattened.sol" > "$output_dir/RelayHub.flattened.json"

node scripts/singleton/get-deploy-data.js > "$output_dir/deploy.json"
echo "Stored deployment data in $output_dir/deploy.json"
