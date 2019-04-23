#!/bin/bash -ex
rootdir=$(cd $(dirname $(dirname $0));pwd)
allowedpath=${rootdir}/node_modules/
solc openzeppelin-solidity=${allowedpath}/openzeppelin-solidity \@0x=${allowedpath}/\@0x $*
