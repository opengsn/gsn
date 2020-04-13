The 'patch-package' tool:
https://www.npmjs.com/package/patch-package

Reasoning: 
There are a lot of node packages we rely on. Unfortunately, sometimes we may need to change the code inside this packages.

This tool allows you to create a 'patch' file by directly modifying the JS source code inside the ./node_modules/ folder.
This patches will be checked in and applied by the 'postinstall' step of 'package.json'.

Applied patches:
1. source-map-support+0.5.16.patch
Allows you to provide 'errorFormatterForce' option to the 'source-map-support' initializer method.
We are not currently using it, but this may be needed eventually as there is a way for different libraries to override the 'Error.prepareStackTrace' function, destroying the source mapping support for stack traces.

2. @openzeppelin+test-helpers+0.5.5.patch
Array assertions. See:
https://github.com/OpenZeppelin/openzeppelin-test-helpers/commit/ab4b86771431ce17592d5fb9f0a22ce913127517

3. @truffle+contract-schema+3.0.23.patch
There is an error in type definitions for Truffle ('undefined' not listed as a valid value for any field).
Ignoring the entire file.
