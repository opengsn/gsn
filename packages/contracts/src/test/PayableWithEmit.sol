// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "@opengsn/contracts/src/ERC2771Recipient.sol";

//make sure that "payable" function that uses _msgSender() still works
// (its not required to use _msgSender(), since the default function
// will never be called through GSN, but still, if someone uses it,
// it should work)
contract PayableWithEmit is ERC2771Recipient {

  event Received(address sender, uint256 value, uint256 gasleft);

  receive () external payable {

    emit Received(_msgSender(), msg.value, gasleft());
  }


  //helper: send value to another contract
  function doSend(address payable target) public payable {

    uint256 before = gasleft();
    // solhint-disable-next-line check-send-result
    bool success = target.send(msg.value);
    uint256 gasAfter = gasleft();
    emit GasUsed(before-gasAfter, success);
  }
  event GasUsed(uint256 gasUsed, bool success);
}
