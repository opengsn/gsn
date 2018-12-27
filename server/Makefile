
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHFILE=./src/github.com/ethereum/go-ethereum/Makefile

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go 

$(server_exe): $(GEN_FILE) $(ETHFILE) $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -o $(server_exe) src/RelayHttpServer.go 

go-get: $(GEN_FILE) $(ETHFILE) 

$(ETHFILE): Makefile
	@echo "Downloading the ethereum library.  Might take a few minutes."
	go get -v -d ./...
	touch $(ETHFILE)

gen-file: $(GEN_FILE) Makefile

$(GEN_FILE): ../contracts/RelayHub.sol ../contracts/RelayHubApi.sol
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --sol $< --pkg librelay  --out $@

