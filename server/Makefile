
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHDIR=./src/github.com/ethereum/go-ethereum
ETHFILE=${ETHDIR}/Makefile
ETHREPO="https://github.com/ethereum/go-ethereum.git"
ETHVERSION=v1.8.21

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go
GEN_FILE_REC=$(buildpath)/src/gen/samplerec/sample_rec_sol.go
TRUFFLE_OUT=$(buildpath)/../contracts/IRelayHub.json
TRUFFLE_OUT_REC=$(buildpath)/../contracts/SampleRecipient.json

$(server_exe): $(GEN_FILE) $(GEN_FILE_REC) go-get $(ETHFILE) $() $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) src/RelayHttpServer.go src/utils.go
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

$(TRUFFLE_OUT): ../contracts/IRelayHub.sol ../contracts/SampleRecipient.sol
	cd ../
	npx truffle compile
	mkdir -p $(buildpath)/contracts
	./scripts/get_abi_bin.js

$(TRUFFLE_OUT_REC): $(TRUFFLE_OUT)

$(GEN_FILE): ../contracts/IRelayHub.sol $(TRUFFLE_OUT)
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(TRUFFLE_OUT:json=abi)) --bin $(subst contracts,server/contracts,$(TRUFFLE_OUT:json=bin)) --pkg librelay --type IRelayHub --out $@

$(GEN_FILE_REC): ../contracts/SampleRecipient.sol $(TRUFFLE_OUT_REC)
	mkdir -p $(buildpath)/src/gen/samplerec
	abigen --solc ../node_modules/.bin/solcjs --abi $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=abi)) --bin $(subst contracts,server/contracts,$(TRUFFLE_OUT_REC:json=bin)) --pkg samplerec --type SampleRecipient --out $@

test: server
	@scripts/test.sh

