/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../utils/GsnUtils.sol";
import "../ERC2771Recipient.sol";
import "./TestPaymasterConfigurableMisbehavior.sol";

contract TestRecipientWithoutFallback is ERC2771Recipient {

    constructor(address forwarder) {
        _setTrustedForwarder(forwarder);
    }
}
