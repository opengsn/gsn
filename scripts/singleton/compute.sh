#! /bin/bash

# Computes all artifacts and values required to deploy a RelayHub at the same address on all Ethereum networks (mainnet,
# testnets, local blockchains, etc.).
# Any changes to the source files, including comments and whitespace, will result in a new deployment addresss, so this
# script should only be run once a version has been frozen.

# To learn more about this deployment method, check out how the ERC1820 registry is deployed (https://eips.ethereum.org/EIPS/eip-1820#deployment-method)
# and this blogpost by Nick Johnson (https://medium.com/@weka/how-to-send-ether-to-11-440-people-187e332566b7).

# Artifacts will be stored in a 'singleton' directory:
#  - the flattened source file (used to e.g. verify the bytecode on Etherscan)
#  - binaries and ABI files
#  - a deploy.json file, including the resulting singleton address, the deployment transaction, and the address that
#    needs to be funded for the deployment
# These files should be committed to the repository.

# See scripts/singleton/deploy.js for sample code to run a deployment using these files.

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
