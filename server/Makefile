
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHFILE=./src/github.com/ethereum/go-ethereum/Makefile

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go 

$(server_exe): $(ETHFILE) $(GEN_FILE) $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) src/RelayHttpServer.go 

go-get: $(ETHFILE)

$(ETHFILE):
	@echo "Downloading the ethereum library.  Might take a few minutes."
	go get -v -d ./...

gen-file: $(GEN_FILE)

$(GEN_FILE): ../contracts/RelayHub.sol ../contracts/RelayHubApi.sol
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --sol $< --pkg librelay  --out $@

