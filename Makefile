all: build-server abis

abis:
	./scripts/extract_abi.js

build-server:
	make -C server
