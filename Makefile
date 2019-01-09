all: build-server build-abis

build-server:
	make -C server

test-server:
	make -C server test

build-abis:
	./scripts/extract_abi.js
