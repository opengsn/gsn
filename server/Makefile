
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

$(GEN_FILE): ../contracts/RelayHub.sol ../contracts/IRelayHub.sol
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --solc ../scripts/solc-abigen-wrapper.sh --sol $< --pkg librelay  --out $@

$(GEN_FILE_REC): ../contracts/SampleRecipient.sol
	mkdir -p $(buildpath)/src/gen/samplerec
	abigen --solc ../scripts/solc-abigen-wrapper.sh --sol $< --pkg samplerec  --out $@

test: server
	@scripts/test.sh
