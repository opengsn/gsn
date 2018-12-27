all: build-server build-abis

build-server:
	make -C server

build-abis:
	./scripts/extract_abi.js
