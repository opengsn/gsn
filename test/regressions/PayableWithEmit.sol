pragma solidity ^0.5.16;
import "../../contracts/BaseRelayRecipient.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";

//make sure that "payable" function that uses getSender() still works
// (its not required to use getSender(), since the default function
// will never be called through GSN, but still, if someone uses it,
// it should work)
contract PayableWithEmit is BaseRelayRecipient {

  event Received(address sender, uint value, uint gasleft);

  function () external payable {

    emit Received(getSender(), msg.value, gasleft());
  }


  //helper: send value to another contract
  function doSend(address payable target) public payable {

    uint before = gasleft();
    bool success = target.send(msg.value);
    uint gasAfter = gasleft();
    emit GasUsed(before-gasAfter, success);
  }
  event GasUsed(uint gasUsed, bool success);
}
