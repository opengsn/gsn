
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

ETHFILE=./src/github.com/ethereum/go-ethereum/Makefile

GEN_FILE=$(buildpath)/src/gen/librelay/relay_hub_sol.go 
GEN_FILE_REC=$(buildpath)/src/gen/samplerec/sample_rec_sol.go 

$(server_exe): $(GEN_FILE) $(GEN_FILE_REC) $(ETHFILE) $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/bin
	go build -race -o $(server_exe) src/RelayHttpServer.go src/utils.go

go-get: $(GEN_FILE) $(ETHFILE) 

$(ETHFILE): Makefile
	@echo "Downloading the ethereum library.  Might take a few minutes."
	go get -v -d ./...
	touch $(ETHFILE)

gen-file: $(GEN_FILE) Makefile

$(GEN_FILE): ../contracts/RelayHub.sol ../contracts/RelayHubApi.sol 
	mkdir -p $(buildpath)/src/gen/librelay
	abigen --sol $< --pkg librelay  --out $@

$(GEN_FILE_REC): ../contracts/SampleRecipient.sol
	mkdir -p $(buildpath)/src/gen/samplerec
	abigen --sol $< --pkg samplerec  --out $@

test: server
	go test -v -count=1 librelay