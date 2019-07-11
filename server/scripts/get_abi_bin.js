#!/usr/bin/env node

var fs = require("fs");

var contractsToExtract =[ "RelayHub", "SampleRecipient" ];

// var rhub = require("../../build/contracts/RelayHub.json");
// var sampleRec = require("../../build/contracts/SampleRecipient.json");

contractsToExtract.forEach( name => {
    let contract = require("../../build/contracts/"+name+".json");

    fs.writeFileSync("../build/server/contracts/"+name+".abi", JSON.stringify(contract.abi));
    fs.writeFileSync("../build/server/contracts/"+name+".bin", contract.bytecode);
});

// fs.writeFileSync("../build/contracts/RelayHub.abi", JSON.stringify(rhub.abi));
// fs.writeFileSync("../build/contracts/RelayHub.bin", JSON.stringify(rhub.bytecode));
// fs.writeFileSync("../build/contracts/SampleRecipient.abi", JSON.stringify(sampleRec.abi));
// fs.writeFileSync("../build/contracts/SampleRecipient.bin", JSON.stringify(sampleRec.bytecode));