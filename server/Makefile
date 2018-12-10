
pwd=$(shell pwd)
buildpath=$(pwd)/../build/server
server_exe=$(buildpath)/bin/RelayHttpServer
export GOPATH=$(pwd):$(buildpath)

server: $(server_exe)

$(server_exe): $(shell find . -maxdepth 3 -name '*.go') Makefile
	echo "Using GOPATH=$(GOPATH)"
	mkdir -p $(buildpath)/src/gen/librelay
	mkdir -p $(buildpath)/bin
	abigen --sol ../contracts/RelayHub.sol --pkg librelay -out $(buildpath)/src/gen/librelay/relay_hub_sol.go 
	echo "Downloading the ethereum library.  Might take a few minutes."
	go get -v -d ./...
	go build -o $(server_exe) src/RelayHttpServer.go 


	
	
librelay/relay_sol_gen.go: ../../contracts/RelayHub.sol ../../contracts/RelayHubApi.sol
	abigen --sol $< --pkg librelay  --out $@

