#!/bin/bash -xe

if [ ! -d  metacoin/node_modules/tabookey-gasless ]; then
	npm pack
	mkdir -p metacoin
	cd metacoin
	test -r contracts/MetaCoin.sol || git clone https://github.com/tabookey-dev/webpack-box.git .
	npm install `pwd`/../tabookey-gasless*.tgz
	npm install
	cd ..
fi

cd metacoin
truffle migrate
test "$1" == "web" && npm run dev
