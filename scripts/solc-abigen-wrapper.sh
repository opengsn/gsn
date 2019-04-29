#!/bin/bash -ex
rootdir=$(cd $(dirname $(dirname $0));pwd)
allowedpath=${rootdir}/node_modules/
# we are not using 'npx solc' (aka solcjs) because it sucks and doesn't work (API difference)
solc openzeppelin-solidity=${allowedpath}/openzeppelin-solidity \@0x=${allowedpath}/\@0x $*
