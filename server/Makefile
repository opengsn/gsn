
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHDIR=./src/github.com/ethereum/go-ethereum
ETHFILE=${ETHDIR}/Makefile
ETHREPO="https://github.com/ethereum/go-ethereum.git"

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go 
GEN_FILE_REC=$(buildpath)/src/gen/samplerec/sample_rec_sol.go 

$(server_exe): $(GEN_FILE) $(GEN_FILE_REC) $(ETHFILE) $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) src/RelayHttpServer.go src/utils.go
	strip $(server_exe)

go-get: $(GEN_FILE) $(ETHFILE) 

$(ETHFILE): Makefile
	@echo "Downloading the ethereum library.  Might take a few minutes."
	@if [ ! -d ${ETHDIR} ]; then \
	  git clone ${ETHREPO} --depth=1 --branch=v1.8.21 ${ETHDIR} ;\
	  go get -v -d ./...;\
	fi 
	touch $(ETHFILE)

gen-file: $(GEN_FILE) Makefile

$(GEN_FILE): ../contracts/RelayHub.sol ../contracts/RelayHubApi.sol 
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --solc ../scripts/solc-abigen-wrapper.sh --sol $< --pkg librelay  --out $@

$(GEN_FILE_REC): ../contracts/SampleRecipient.sol
	mkdir -p $(buildpath)/src/gen/samplerec
	abigen --solc ../scripts/solc-abigen-wrapper.sh --sol $< --pkg samplerec  --out $@

test: server
	go test -v -count=1 librelay
