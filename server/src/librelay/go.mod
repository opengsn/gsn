module openeth.dev/librelay

go 1.13

require (
	code.cloudfoundry.org/clock v1.0.0
	github.com/ethereum/go-ethereum v1.9.10
	github.com/syndtr/goleveldb v1.0.1-0.20190923125748-758128399b1d
	openeth.dev/gen/librelay v0.0.0
	openeth.dev/gen/testcontracts v0.0.0
)

replace openeth.dev/gen/librelay => ../../../build/server/src/gen/librelay

replace openeth.dev/gen/testcontracts => ../../../build/server/src/gen/testcontracts
