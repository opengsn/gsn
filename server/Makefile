
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
GEN_FILE_REC=$(buildpath)/src/gen/samplerec/sample_rec_sol.go
RELAYHUB_BIN=$(buildpath)/../contracts/RelayHub.json
RELAYHUB_ABI=$(buildpath)/../contracts/IRelayHub.json
TRUFFLE_OUT_REC=$(buildpath)/../contracts/SampleRecipient.json

$(server_exe): $(GEN_FILE) $(GEN_FILE_REC) go-get $(ETHFILE) $() $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) relay
	strip $(server_exe)

go-get: $(GEN_FILE) $(ETHFILE)
	go get -v code.cloudfoundry.org/clock github.com/syndtr/goleveldb/leveldb

$(ETHFILE): Makefile
	@echo "Downloading the ethereum library. Might take a few minutes."
	@if [ ! -d ${ETHDIR} ]; then \
	  git clone ${ETHREPO} --depth=1 --branch=${ETHVERSION} ${ETHDIR} ;\
	  go get -v -d ./...;\
	fi
	touch $(ETHFILE)

gen-file: $(GEN_FILE) Makefile

$(RELAYHUB_BIN): ../contracts/IRelayHub.sol ../contracts/RelayHub.sol ../contracts/SampleRecipient.sol
	cd ../ && npx truffle compile
	mkdir -p $(buildpath)/contracts
	./scripts/get_abi_bin.js

$(RELAYHUB_ABI): $(RELAYHUB_BIN)

$(TRUFFLE_OUT_REC): $(RELAYHUB_BIN)

$(GEN_FILE): ../contracts/IRelayHub.sol $(RELAYHUB_BIN) $(RELAYHUB_ABI)
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(RELAYHUB_ABI:json=abi)) --bin $(subst contracts,server/contracts,$(RELAYHUB_BIN:json=bin)) --pkg librelay --type IRelayHub --out $@

$(GEN_FILE_REC): ../contracts/SampleRecipient.sol $(TRUFFLE_OUT_REC)
	mkdir -p $(buildpath)/src/gen/samplerec
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=abi)) --bin $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=bin)) --pkg samplerec --type SampleRecipient --out $@

test: server
	@scripts/test.sh

go-get-xgo:
	go get github.com/karalabe/xgo

release-binaries: $(server_exe) go-get-xgo
	mkdir -p ./build/xgo
	go run github.com/karalabe/xgo -out='build/xgo/gsn-relay' --targets='$(platforms)' -v ./src/relay
	mv -f ./build/xgo/* $(buildpath)/bin/
	rm -rf ./build/xgo