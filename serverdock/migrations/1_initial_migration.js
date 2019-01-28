var Migrations = artifacts.require("./Migrations.sol");

const privKey = "0xcd3376bb711cb332ee3fb2ca04c6a8b9f70c316fcdf7a1f44ef4c7999483295e";
const address = "0x8f337bf484b2fc75e4b0436645dcc226ee2ac531";
const password = "";
module.exports = async function(deployer) {
  await web3.eth.personal.importRawKey(privKey, password);
  await web3.eth.personal.unlockAccount(address, password, 0);
  let acc = await web3.eth.getAccounts();
  let acc0 = acc[0];
  let res = await web3.eth.sendTransaction({
    from: acc0,
    to: address,
    value: web3.utils.toWei("1", "ether")});
  console.log(res);
  deployer.deploy(Migrations);
};