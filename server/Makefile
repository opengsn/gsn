
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
platforms=linux/amd64 windows/amd64 darwin/amd64 linux/386 windows/386
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHDIR=./src/github.com/ethereum/go-ethereum
ETHFILE=${ETHDIR}/Makefile
ETHREPO="https://github.com/ethereum/go-ethereum.git"
ETHVERSION=v1.8.21

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go
GEN_FILE_REC=$(buildpath)/src/gen/testcontracts/test_rec_sol.go
GEN_FILE_SPONSOR=$(buildpath)/src/gen/testcontracts/test_sponsor_sol.go
RELAYHUB_BIN=$(buildpath)/../contracts/RelayHub.json
RELAYHUB_ABI=$(buildpath)/../contracts/IRelayHub.json
TRUFFLE_OUT_REC=$(buildpath)/../contracts/TestRecipient.json
TRUFFLE_OUT_SPONSOR=$(buildpath)/../contracts/TestSponsorEverythingAccepted.json

$(server_exe): $(GEN_FILE) $(GEN_FILE_REC) $(GEN_FILE_SPONSOR) $(ETHFILE) $() $(shell find . -maxdepth 3 -name '*.go') Makefile
	@echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) relay
	strip $(server_exe)

go-get: $(GEN_FILE) $(ETHFILE)

$(ETHFILE): Makefile
	@if [ ! -d ${ETHDIR} ]; then \
	  echo "Downloading the ethereum library. Might take a few minutes.";\
	  git clone ${ETHREPO} --depth=1 --branch=${ETHVERSION} ${ETHDIR} ;\
	fi
	go get -v code.cloudfoundry.org/clock github.com/syndtr/goleveldb/leveldb;
	touch $(ETHFILE)

gen-file: $(GEN_FILE) Makefile

$(RELAYHUB_BIN): ../contracts/interfaces/IRelayHub.sol ../contracts/RelayHub.sol ../contracts/test/TestRecipient.sol
	cd ../ && npx truffle compile
	mkdir -p $(buildpath)/contracts
	./scripts/get_abi_bin.js

$(RELAYHUB_ABI): $(RELAYHUB_BIN)

$(TRUFFLE_OUT_REC): $(RELAYHUB_BIN)

$(GEN_FILE): ../contracts/interfaces/IRelayHub.sol $(RELAYHUB_BIN) $(RELAYHUB_ABI)
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(RELAYHUB_ABI:json=abi)) --bin $(subst contracts,server/contracts,$(RELAYHUB_BIN:json=bin)) --pkg librelay --type IRelayHub --out $@

$(GEN_FILE_REC): ../contracts/test/TestRecipient.sol $(TRUFFLE_OUT_REC)
	mkdir -p $(buildpath)/src/gen/testcontracts
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=abi)) --bin $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=bin)) --pkg testcontracts --type SampleRecipient --out $@

$(GEN_FILE_SPONSOR): ../contracts/test/TestSponsorEverythingAccepted.sol $(TRUFFLE_OUT_SPONSOR)
	mkdir -p $(buildpath)/src/gen/testcontracts
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(TRUFFLE_OUT_SPONSOR:json=abi)) --bin $(subst contracts,server/contracts,$(TRUFFLE_OUT_SPONSOR:json=bin)) --pkg testcontracts --type TestSponsor --out $@

test: server
	@scripts/test.sh

go-get-xgo:
	go get github.com/karalabe/xgo

release-binaries: $(server_exe) go-get-xgo
	mkdir -p ./build/xgo
	go run github.com/karalabe/xgo -out='build/xgo/gsn-relay' --targets='$(platforms)' -v ./src/relay
	mv -f ./build/xgo/* $(buildpath)/bin/
	rm -rf ./build/xgo

clean:
	rm -rf pkg
	rm -rf server/src/code.cloudfoundry.org
	rm -rf server/src/github.com
	rm -rf ../build/server
