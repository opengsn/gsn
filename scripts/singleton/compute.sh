#! /bin/bash

# Exit script as soon as a command fails.
set -o errexit

output_dir="singleton"

echo "Will store artifacts in directory '$output_dir'"

rm -rf "$output_dir" # Delete possible remains from previous run
mkdir -p "$output_dir"

echo "Flattening source files into a single file"
npx truffle-flattener contracts/RelayHub.sol > $output_dir/RelayHub.flattened.sol

echo "Compiling with solcjs version $(npx solcjs --version)"
npx solcjs --optimize --optimize-runs 200 --abi --bin --output-dir $output_dir "$output_dir/RelayHub.flattened.sol"

node scripts/singleton/get-deploy-data.js > "$output_dir/deploy.json"
echo "Stored deployment data in $output_dir/deploy.json"
