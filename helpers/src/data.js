module.exports = {
  relayHub: {
    abi: [
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "_gtxdatanonzero",
            "type": "uint256"
          },
          {
            "internalType": "contract StakeManager",
            "name": "_stakeManager",
            "type": "address"
          },
          {
            "internalType": "contract Penalizer",
            "name": "_penalizer",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayWorker",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "paymaster",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "bytes4",
            "name": "selector",
            "type": "bytes4"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "reason",
            "type": "string"
          }
        ],
        "name": "CanRelayFailed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "paymaster",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "Deposited",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayWorker",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "Penalized",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "baseRelayFee",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "pctRelayFee",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "url",
            "type": "string"
          }
        ],
        "name": "RelayServerRegistered",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address[]",
            "name": "newRelayWorkers",
            "type": "address[]"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "workersCount",
            "type": "uint256"
          }
        ],
        "name": "RelayWorkersAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayWorker",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "paymaster",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "bytes4",
            "name": "selector",
            "type": "bytes4"
          },
          {
            "indexed": false,
            "internalType": "enum IRelayHub.RelayCallStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "charge",
            "type": "uint256"
          }
        ],
        "name": "TransactionRelayed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "account",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "dest",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "Withdrawn",
        "type": "event"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "COMMIT_ID",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "GTRANSACTION",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "MAX_WORKER_COUNT",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "eip712sig",
        "outputs": [
          {
            "internalType": "contract EIP712Sig",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "gtxdatanonzero",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "penalizer",
        "outputs": [
          {
            "internalType": "contract Penalizer",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "stakeManager",
        "outputs": [
          {
            "internalType": "contract StakeManager",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "version",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getHubOverhead",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getVersion",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getStakeManager",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "uint256",
            "name": "baseRelayFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "pctRelayFee",
            "type": "uint256"
          },
          {
            "internalType": "string",
            "name": "url",
            "type": "string"
          }
        ],
        "name": "registerRelayServer",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address[]",
            "name": "newRelayWorkers",
            "type": "address[]"
          }
        ],
        "name": "addRelayWorkers",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "target",
            "type": "address"
          }
        ],
        "name": "depositFor",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "address",
            "name": "target",
            "type": "address"
          }
        ],
        "name": "balanceOf",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "address payable",
            "name": "dest",
            "type": "address"
          }
        ],
        "name": "withdraw",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "target",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "encodedFunction",
                "type": "bytes"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "gasLimit",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "gasPrice",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "pctRelayFee",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "baseRelayFee",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct GSNTypes.GasData",
                "name": "gasData",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "senderAddress",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "senderNonce",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address",
                    "name": "relayWorker",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "paymaster",
                    "type": "address"
                  }
                ],
                "internalType": "struct GSNTypes.RelayData",
                "name": "relayData",
                "type": "tuple"
              }
            ],
            "internalType": "struct GSNTypes.RelayRequest",
            "name": "relayRequest",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "maxPossibleGas",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "acceptRelayedCallGasLimit",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "approvalData",
            "type": "bytes"
          }
        ],
        "name": "canRelay",
        "outputs": [
          {
            "internalType": "bool",
            "name": "success",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "returnValue",
            "type": "string"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "target",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "encodedFunction",
                "type": "bytes"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "gasLimit",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "gasPrice",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "pctRelayFee",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "baseRelayFee",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct GSNTypes.GasData",
                "name": "gasData",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "senderAddress",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "senderNonce",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address",
                    "name": "relayWorker",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "paymaster",
                    "type": "address"
                  }
                ],
                "internalType": "struct GSNTypes.RelayData",
                "name": "relayData",
                "type": "tuple"
              }
            ],
            "internalType": "struct GSNTypes.RelayRequest",
            "name": "relayRequest",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "approvalData",
            "type": "bytes"
          }
        ],
        "name": "relayCall",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "target",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "encodedFunction",
                "type": "bytes"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "gasLimit",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "gasPrice",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "pctRelayFee",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "baseRelayFee",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct GSNTypes.GasData",
                "name": "gasData",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "senderAddress",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "senderNonce",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address",
                    "name": "relayWorker",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "paymaster",
                    "type": "address"
                  }
                ],
                "internalType": "struct GSNTypes.RelayData",
                "name": "relayData",
                "type": "tuple"
              }
            ],
            "internalType": "struct GSNTypes.RelayRequest",
            "name": "relayRequest",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "acceptRelayedCallGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "preRelayedCallGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "postRelayedCallGasLimit",
                "type": "uint256"
              }
            ],
            "internalType": "struct GSNTypes.GasLimits",
            "name": "gasLimits",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "totalInitialGas",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "calldataGas",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "recipientContext",
            "type": "bytes"
          }
        ],
        "name": "recipientCallsAtomic",
        "outputs": [
          {
            "internalType": "enum IRelayHub.RelayCallStatus",
            "name": "",
            "type": "uint8"
          }
        ],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "uint256",
            "name": "gasUsed",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "gasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "gasPrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "pctRelayFee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseRelayFee",
                "type": "uint256"
              }
            ],
            "internalType": "struct GSNTypes.GasData",
            "name": "gasData",
            "type": "tuple"
          }
        ],
        "name": "calculateCharge",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayWorker",
            "type": "address"
          },
          {
            "internalType": "address payable",
            "name": "beneficiary",
            "type": "address"
          }
        ],
        "name": "penalize",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    // address: RelayHub.ad,
    bytecode: "0x60c060405260056080819052640312e302e360dc1b60a0908152620000289160049190620000d6565b503480156200003657600080fd5b506040516200428e3803806200428e8339810160408190526200005991620001a9565b3060405162000068906200015b565b6200007491906200020e565b604051809103906000f08015801562000091573d6000803e3d6000fd5b50600580546001600160a01b03199081166001600160a01b03938416179091556006805482169483169490941790935560078054909316911617905560005562000269565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200011957805160ff191683800117855562000149565b8280016001018555821562000149579182015b82811115620001495782518255916020019190600101906200012c565b506200015792915062000169565b5090565b610dc380620034cb83390190565b6200018691905b8082111562000157576000815560010162000170565b90565b8051620001968162000244565b92915050565b805162000196816200025e565b600080600060608486031215620001bf57600080fd5b6000620001cd86866200019c565b9350506020620001e08682870162000189565b9250506040620001f38682870162000189565b9150509250925092565b62000208816200021e565b82525050565b60208101620001968284620001fd565b6000620001968262000238565b600062000196826200021e565b6001600160a01b031690565b6200024f816200022b565b81146200025b57600080fd5b50565b6200024f8162000186565b61325280620002796000396000f3fe6080604052600436106101295760003560e01c8063663c8186116100ab578063c0f6a4471161006f578063c0f6a447146102e8578063c2da078614610316578063c4775a6814610336578063ca64f9e71461034b578063e1decef31461036d578063ebcd31ac1461038257610129565b8063663c81861461026b57806370a08231146102805780637542ff95146102a057806383b71871146102b5578063aa67c919146102d557610129565b806332838662116100f257806332838662146101f5578063334529851461020a57806354fd4d501461022c5780635c177b1214610241578063633ed2c31461025657610129565b8062f714ce1461012e578063068865251461015057806309b8983c146101865780630d8e6e2c146101a657806311d77486146101c8575b600080fd5b34801561013a57600080fd5b5061014e610149366004612497565b6103a2565b005b34801561015c57600080fd5b5061017061016b366004612308565b610478565b60405161017d9190612df5565b60405180910390f35b34801561019257600080fd5b5061014e6101a136600461226d565b61084a565b3480156101b257600080fd5b506101bb610f0e565b60405161017d9190612e03565b3480156101d457600080fd5b506101e86101e33660046124b6565b610fa4565b60405161017d9190612feb565b34801561020157600080fd5b506101bb610fcf565b34801561021657600080fd5b5061021f610feb565b60405161017d9190612dd9565b34801561023857600080fd5b506101bb610ffa565b34801561024d57600080fd5b506101e8611088565b34801561026257600080fd5b506101e861108e565b34801561027757600080fd5b506101e8611093565b34801561028c57600080fd5b506101e861029b36600461207f565b611099565b3480156102ac57600080fd5b5061021f6110b8565b3480156102c157600080fd5b5061014e6102d03660046124e6565b6110c7565b61014e6102e336600461207f565b6111f4565b3480156102f457600080fd5b506103086103033660046123de565b61129c565b60405161017d929190612d53565b34801561032257600080fd5b5061014e6103313660046120fd565b61155c565b34801561034257600080fd5b5061021f611761565b34801561035757600080fd5b50610360611770565b60405161017d9190612c5b565b34801561037957600080fd5b506101e861177f565b34801561038e57600080fd5b5061014e61039d3660046120c3565b611785565b336000818152600360205260409020548311156103da5760405162461bcd60e51b81526004016103d190612ec4565b60405180910390fd5b6001600160a01b0380821660009081526003602052604080822080548790039055519184169185156108fc0291869190818181858888f19350505050158015610427573d6000803e3d6000fd5b50816001600160a01b0316816001600160a01b03167fd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb8560405161046b9190612feb565b60405180910390a3505050565b6000610482611d00565b3330146104a15760405162461bcd60e51b81526004016103d190612e34565b600360006104b76101408d016101208e0161207f565b6001600160a01b0316815260208101919091526040908101600020548252516380274db760e01b906104ef9086908690602401612d73565b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b03199093169290921790915260608083019190915260009061053f6101408d016101208e0161207f565b6001600160a01b03168960200135846060015160405161055f9190612c4f565b60006040518083038160008787f1925050503d806000811461059d576040519150601f19603f3d011682016040523d82523d6000602084013e6105a2565b606091505b509092509050816105b7576105b76002611982565b808060200190516105cb91908101906121a3565b6020808501919091526105e392508c0190508b61207f565b6001600160a01b031663ce1b815f6040518163ffffffff1660e01b815260040160206040518083038186803b15801561061b57600080fd5b505afa15801561062f573d6000803e3d6000fd5b505050506040513d601f19601f8201168201806040525061065391908101906120a5565b6001600160a01b031663b21051f88b8b8b6040518463ffffffff1660e01b815260040161068293929190612ef4565b600060405180830381600087803b15801561069c57600080fd5b505af11580156106b0573d6000803e3d6000fd5b505050506040513d6000823e601f3d908101601f191682016040526106d8919081019061215c565b501515604082018190526020820151637dfde87960e11b9186918691908961938a5a8d0301018f60400160405160240161071796959493929190612d85565b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b031990931692909217909152606082015260006107626101408c016101208d0161207f565b6001600160a01b0316886040013583606001516040516107829190612c4f565b60006040518083038160008787f1925050503d80600081146107c0576040519150601f19603f3d011682016040523d82523d6000602084013e6107c5565b606091505b50509050806107d8576107d86003611982565b8160000151600360008d60c00160600160206107f7919081019061207f565b6001600160a01b03166001600160a01b03168152602001908152602001600020541015610828576108286004611982565b816040015161083857600161083b565b60005b9b9a5050505050505050505050565b60005a905060006108d687602081018035601e193684900301811261086e57600080fd5b909101602081019150356001600160401b0381111561088c57600080fd5b3681900382131561089c57600080fd5b8080601f016020809104026020016040519081016040528093929190818152602001838380828437600092018290525092506119b0915050565b336000908152600160205260409020549091506001600160a01b031661090e5760405162461bcd60e51b81526004016103d190612ee4565b6006543360009081526001602052604090819020549051636eb43c3160e11b81526001600160a01b039283169263dd6878629261095e92911690670de0b6b3a7640000906103e890600401612d17565b60206040518083038186803b15801561097657600080fd5b505afa15801561098a573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506109ae919081019061213e565b6109ca5760405162461bcd60e51b81526004016103d190612e84565b3a606088013511156109ee5760405162461bcd60e51b81526004016103d190612e64565b60606109f8611d26565b6000610a2785610a10368d90038d0160408e01612213565b610a226101408e016101208f0161207f565b6119e9565b6040805160808101909152909350909150600090610b9e9080610a4d60208f018f61207f565b6001600160a01b031681526020018d8060200180356001602003833603038112610a7657600080fd5b909101602081019150356001600160401b03811115610a9457600080fd5b36819003821315610aa457600080fd5b8080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505081526020018d604001803603610b009190810190612213565b81526020018d60c001803603610b19919081019061224f565b90528451604080516020601f8f018190048102820181019092528d81528692918f908f9081908401838280828437600081840152601f19601f820116905080830192505050505050508c8c8080601f01602080910402602001604051908101604052809392919081815260200183838082843760009201919091525061129c92505050565b9450905080610c7b57610bb760e08c0160c08d0161207f565b6001600160a01b0316336001600160a01b031660016000336001600160a01b03166001600160a01b0316815260200190815260200160002060009054906101000a90046001600160a01b03166001600160a01b03167f18d1605753700a9b48e43123a6aef09c0abd2126f7d36fdb0c5ee174ac8679238e6000016020610c40919081019061207f565b8f60c0016060016020610c56919081019061207f565b8a8a604051610c689493929190612cdd565b60405180910390a4505050505050610f07565b50600090506060630688652560e01b8b8b8b868a610c97611b07565b8a604051602401610cae9796959493929190612f23565b60408051601f198184030181529181526020820180516001600160e01b03166001600160e01b03199094169390931790925290519091506060903090610cf5908490612c4f565b6000604051808303816000865af19150503d8060008114610d32576040519150601f19603f3d011682016040523d82523d6000602084013e610d37565b606091505b5091505080806020019051610d4f91908101906121c1565b925050506000610d7a61938a5a8803610d66611b07565b01016101e3368e90038e0160408f01612213565b905080600360008d60c0016060016020610d97919081019061207f565b6001600160a01b03166001600160a01b03168152602001908152602001600020541015610dd65760405162461bcd60e51b81526004016103d190612e14565b80600360008d60c0016060016020610df1919081019061207f565b6001600160a01b03908116825260208083019390935260409182016000908120805495909503909455338452600183528184205416835260039091529020805482019055610e4560e08c0160c08d0161207f565b6001600160a01b0316336001600160a01b031660016000336001600160a01b03166001600160a01b0316815260200190815260200160002060009054906101000a90046001600160a01b03166001600160a01b03167fc9aa709786a3d5fe2cc947abc1ba8cbb0f6decb57aa74b84eb7f558125fee4548e6000016020610ece919081019061207f565b8f60c0016060016020610ee4919081019061207f565b8a8888604051610ef8959493929190612c91565b60405180910390a45050505050505b5050505050565b60048054604080516020601f6002600019610100600188161502019095169490940493840181900481028201810190925282815260609390929091830182828015610f9a5780601f10610f6f57610100808354040283529160200191610f9a565b820191906000526020600020905b815481529060010190602001808311610f7d57829003601f168201915b5050505050905090565b600060648260400151606401836020015185020281610fbf57fe5b0482606001510190505b92915050565b6040518060600160405280602f81526020016131e1602f913981565b6005546001600160a01b031681565b6004805460408051602060026001851615610100026000190190941693909304601f810184900484028201840190925281815292918301828280156110805780601f1061105557610100808354040283529160200191611080565b820191906000526020600020905b81548152906001019060200180831161106357829003601f168201915b505050505081565b60005481565b600a81565b61520881565b6001600160a01b0381166000908152600360205260409020545b919050565b6006546001600160a01b031681565b600654604051636eb43c3160e11b815233916001600160a01b03169063dd68786290611105908490670de0b6b3a7640000906103e890600401612d17565b60206040518083038186803b15801561111d57600080fd5b505afa158015611131573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611155919081019061213e565b6111715760405162461bcd60e51b81526004016103d190612e84565b6001600160a01b0381166000908152600260205260409020546111a65760405162461bcd60e51b81526004016103d190612e94565b806001600160a01b03167f77f2d8afec4b9d82ffa0dea525320620292bd1067f575964994d5c4501479aed868686866040516111e59493929190612ff9565b60405180910390a25050505050565b34671bc16d674ec8000081111561121d5760405162461bcd60e51b81526004016103d190612e74565b6001600160a01b0382166000908152600360205260409020546112409082611b13565b6001600160a01b038316600081815260036020526040908190209290925590513391907f8752a472e571a816aea92eec8dae9baf628e840f4929fbcc2d155e6233ff68a790611290908590612feb565b60405180910390a35050565b845160408051600481526024810182526020810180516001600160e01b031663ce1b815f60e01b179052905160009260609283926001600160a01b03909216916112e69190612c4f565b600060405180830381855afa9150503d8060008114611321576040519150601f19603f3d011682016040523d82523d6000602084013e611326565b606091505b50909350905082158061133b57508051602014155b1561137f57505060408051808201909152601a81527f67657454727573746564466f72776172646572206661696c6564000000000000602082015260009150611552565b60008180602001905161139591908101906120a5565b6040519091506001600160a01b03821690638e1653c960e01b906113bf908c908a90602401612f92565b60408051601f198184030181529181526020820180516001600160e01b03166001600160e01b03199094169390931790925290516113fd9190612c4f565b600060405180830381855afa9150503d8060008114611438576040519150601f19603f3d011682016040523d82523d6000602084013e61143d565b606091505b5090945091508361145e57600061145383611b3f565b935093505050611552565b60405160609063b1ed031f60e01b9061147f908c9089908d90602401612fb7565b604051602081830303815290604052906001600160e01b0319166020820180516001600160e01b03838183161783525050505090508960600151606001516001600160a01b031688826040516114d59190612c4f565b6000604051808303818686fa925050503d8060008114611511576040519150601f19603f3d011682016040523d82523d6000602084013e611516565b606091505b5090955092508461153857600061152c84611b3f565b94509450505050611552565b8280602001905161154c91908101906121df565b93505050505b9550959350505050565b3360008181526002602052604090208054830190819055600a10156115935760405162461bcd60e51b81526004016103d190612eb4565b600654604051636eb43c3160e11b81526001600160a01b039091169063dd687862906115d1908490670de0b6b3a7640000906103e890600401612d17565b60206040518083038186803b1580156115e957600080fd5b505afa1580156115fd573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611621919081019061213e565b61163d5760405162461bcd60e51b81526004016103d190612e84565b60005b8281101561170757600060018186868581811061165957fe5b905060200201602061166e919081019061207f565b6001600160a01b03908116825260208201929092526040016000205416146116a85760405162461bcd60e51b81526004016103d190612e24565b81600160008686858181106116b957fe5b90506020020160206116ce919081019061207f565b6001600160a01b039081168252602082019290925260400160002080546001600160a01b03191692909116919091179055600101611640565b506001600160a01b038116600081815260026020526040908190205490517febf4a9bffb39f7c5dbf3f65540183b9381ae226ac3d0a45b4cad484713bd4a28916117549187918791612d32565b60405180910390a2505050565b6007546001600160a01b031681565b6006546001600160a01b031690565b61938a90565b6007546001600160a01b031633146117af5760405162461bcd60e51b81526004016103d190612ea4565b6001600160a01b0380831660009081526001602052604090205416806117e75760405162461bcd60e51b81526004016103d190612ee4565b600654604051636eb43c3160e11b81526001600160a01b039091169063dd68786290611825908490670de0b6b3a7640000906103e890600401612d17565b60206040518083038186803b15801561183d57600080fd5b505afa158015611851573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611875919081019061213e565b6118915760405162461bcd60e51b81526004016103d190612e84565b6006546040516305a4d3f160e21b81526000916001600160a01b0316906316934fc4906118c2908590600401612c5b565b60806040518083038186803b1580156118da57600080fd5b505afa1580156118ee573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611912919081019061254d565b505060065460405163026822bd60e21b81529293506001600160a01b0316916309a08af4915061194a90859087908690600401612c69565b600060405180830381600087803b15801561196457600080fd5b505af1158015611978573d6000803e3d6000fd5b5050505050505050565b6060816040516020016119959190612df5565b60405160208183030381529060405290508051602082018181fd5b600081600401835110156119d6576119d66119d16003855185600401611b72565b611bcc565b5001602001516001600160e01b03191690565b60006119f3611d26565b826001600160a01b0316635ea54eee6040518163ffffffff1660e01b815260040160606040518083038186803b158015611a2c57600080fd5b505afa158015611a40573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250611a649190810190612231565b90506000846000015182604001518360200151846000015161938a01010101905080620186a001861015611aaa5760405162461bcd60e51b81526004016103d190612e54565b80611ab3611b07565b0192506000611ac28487610fa4565b6001600160a01b038616600090815260036020526040902054909150811115611afd5760405162461bcd60e51b81526004016103d190612ed4565b5050935093915050565b60005436026152080190565b600082820183811015611b385760405162461bcd60e51b81526004016103d190612e44565b9392505050565b6060602482511015611b525750806110b3565b611b5f8260048451611bd4565b806020019051610fc991908101906121df565b6060632800659560e01b848484604051602401611b9193929190612de7565b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b03199093169290921790915290509392505050565b805160208201fd5b606081831115611bed57611bed6119d160008585611b72565b8351821115611c0657611c066119d16001848751611b72565b8282036040519080825280601f01601f191660200182016040528015611c33576020820181803883390190505b509050611b38611c4282611c54565b84611c4c87611c54565b018351611c5a565b60200190565b6020811015611c84576001816020036101000a038019835116818551168082178652505050611cfb565b82821415611c9157611cfb565b82821115611ccb5760208103905080820181840181515b82851015611cc3578451865260209586019590940193611ca8565b905250611cfb565b60208103905080820181840183515b81861215611cf65782518252601f199283019290910190611cda565b855250505b505050565b604080516080810182526000808252602082018190529181019190915260608082015290565b60405180606001604052806000815260200160008152602001600081525090565b8035610fc9816131ad565b8051610fc9816131ad565b60008083601f840112611d6f57600080fd5b5081356001600160401b03811115611d8657600080fd5b602083019150836020820283011115611d9e57600080fd5b9250929050565b8051610fc9816131c1565b8051610fc9816131ca565b60008083601f840112611dcd57600080fd5b5081356001600160401b03811115611de457600080fd5b602083019150836001820283011115611d9e57600080fd5b600082601f830112611e0d57600080fd5b8135611e20611e1b8261304d565b613027565b91508082526020830160208301858383011115611e3c57600080fd5b611e47838284613154565b50505092915050565b600082601f830112611e6157600080fd5b8151611e6f611e1b8261304d565b91508082526020830160208301858383011115611e8b57600080fd5b611e47838284613160565b8051610fc9816131d3565b600060808284031215611eb357600080fd5b611ebd6080613027565b90506000611ecb8484612074565b8252506020611edc84848301612074565b6020830152506040611ef084828501612074565b6040830152506060611f0484828501612074565b60608301525092915050565b600060608284031215611f2257600080fd5b50919050565b600060608284031215611f3a57600080fd5b611f446060613027565b90506000611f528484611db0565b8252506020611f6384848301611db0565b6020830152506040611f7784828501611db0565b60408301525092915050565b600060808284031215611f9557600080fd5b611f9f6080613027565b90506000611fad8484611d47565b8252506020611fbe84848301612074565b6020830152506040611fd284828501611d47565b6040830152506060611f0484828501611d47565b60006101408284031215611f2257600080fd5b6000610140828403121561200c57600080fd5b6120166080613027565b905060006120248484611d47565b82525060208201356001600160401b0381111561204057600080fd5b61204c84828501611dfc565b602083015250604061206084828501611ea1565b60408301525060c0611f0484828501611f83565b8035610fc9816131ca565b60006020828403121561209157600080fd5b600061209d8484611d47565b949350505050565b6000602082840312156120b757600080fd5b600061209d8484611d52565b600080604083850312156120d657600080fd5b60006120e28585611d47565b92505060206120f385828601611d47565b9150509250929050565b6000806020838503121561211057600080fd5b82356001600160401b0381111561212657600080fd5b61213285828601611d5d565b92509250509250929050565b60006020828403121561215057600080fd5b600061209d8484611da5565b6000806040838503121561216f57600080fd5b600061217b8585611da5565b92505060208301516001600160401b0381111561219757600080fd5b6120f385828601611e50565b6000602082840312156121b557600080fd5b600061209d8484611db0565b6000602082840312156121d357600080fd5b600061209d8484611e96565b6000602082840312156121f157600080fd5b81516001600160401b0381111561220757600080fd5b61209d84828501611e50565b60006080828403121561222557600080fd5b600061209d8484611ea1565b60006060828403121561224357600080fd5b600061209d8484611f28565b60006080828403121561226157600080fd5b600061209d8484611f83565b60008060008060006060868803121561228557600080fd5b85356001600160401b0381111561229b57600080fd5b6122a788828901611fe6565b95505060208601356001600160401b038111156122c357600080fd5b6122cf88828901611dbb565b945094505060408601356001600160401b038111156122ed57600080fd5b6122f988828901611dbb565b92509250509295509295909350565b600080600080600080600080610100898b03121561232557600080fd5b88356001600160401b0381111561233b57600080fd5b6123478b828c01611fe6565b98505060208901356001600160401b0381111561236357600080fd5b61236f8b828c01611dbb565b975097505060406123828b828c01611f10565b95505060a06123938b828c01612074565b94505060c06123a48b828c01612074565b93505060e08901356001600160401b038111156123c057600080fd5b6123cc8b828c01611dbb565b92509250509295985092959890939650565b600080600080600060a086880312156123f657600080fd5b85356001600160401b0381111561240c57600080fd5b61241888828901611ff9565b955050602061242988828901612074565b945050604061243a88828901612074565b93505060608601356001600160401b0381111561245657600080fd5b61246288828901611dfc565b92505060808601356001600160401b0381111561247e57600080fd5b61248a88828901611dfc565b9150509295509295909350565b600080604083850312156124aa57600080fd5b60006120e28585612074565b60008060a083850312156124c957600080fd5b60006124d58585612074565b92505060206120f385828601611ea1565b600080600080606085870312156124fc57600080fd5b60006125088787612074565b945050602061251987828801612074565b93505060408501356001600160401b0381111561253557600080fd5b61254187828801611dbb565b95989497509550505050565b6000806000806080858703121561256357600080fd5b600061256f8787611db0565b945050602061258087828801611db0565b935050604061259187828801611db0565b92505060606125a287828801611d52565b91505092959194509250565b60006125ba83836125c2565b505060200190565b6125cb816130f6565b82525050565b60006125dd838561307b565b93506125e882613074565b8060005b8581101561261e576125fe8284613084565b61260888826125ae565b975061261383611c54565b9250506001016125ec565b509495945050505050565b6125cb81613101565b6125cb81613074565b6125cb81613106565b6000612650838561307b565b935061265d838584613154565b6126668361318c565b9093019392505050565b600061267b82613077565b612685818561307b565b9350612695818560208601613160565b6126668161318c565b60006126a982613077565b6126b381856110b3565b93506126c3818560208601613160565b9290920192915050565b6125cb81613133565b6125cb8161313e565b6125cb81613149565b60006126f560138361307b565b7253686f756c64206e6f7420676574206865726560681b815260200192915050565b600061272460198361307b565b7f7468697320776f726b6572206861732061206d616e6167657200000000000000815260200192915050565b600061275d60278361307b565b7f4f6e6c792052656c61794875622073686f756c642063616c6c207468697320668152663ab731ba34b7b760c91b602082015260400192915050565b60006127a6601b8361307b565b7f536166654d6174683a206164646974696f6e206f766572666c6f770000000000815260200192915050565b60006127df60388361307b565b7f4e6f7420656e6f75676820676173206c65667420666f7220726563697069656e81527f7443616c6c7341746f6d696320746f20636f6d706c6574650000000000000000602082015260400192915050565b600061283e60118361307b565b70496e76616c69642067617320707269636560781b815260200192915050565b600061286b600f8361307b565b6e6465706f73697420746f6f2062696760881b815260200192915050565b600061289660188361307b565b7f72656c6179206d616e61676572206e6f74207374616b65640000000000000000815260200192915050565b60006128cf60108361307b565b6f6e6f2072656c617920776f726b65727360801b815260200192915050565b60006128fb600d8361307b565b6c2737ba103832b730b634bd32b960991b815260200192915050565b600061292460108361307b565b6f746f6f206d616e7920776f726b65727360801b815260200192915050565b600061295060128361307b565b71696e73756666696369656e742066756e647360701b815260200192915050565b600061297e60198361307b565b7f5061796d61737465722062616c616e636520746f6f206c6f7700000000000000815260200192915050565b60006129b760148361307b565b732ab735b737bbb7103932b630bc903bb7b935b2b960611b815260200192915050565b608082016129e882806130e7565b6129f28482612632565b50612a0060208301836130e7565b612a0d6020850182612632565b50612a1b60408301836130e7565b612a286040850182612632565b50612a3660608301836130e7565b612a436060850182612632565b50505050565b80516080830190612a5a8482612632565b506020820151612a6d6020850182612632565b506040820151612a806040850182612632565b506060820151612a436060850182612632565b80516060830190612aa48482612632565b506020820151612ab76020850182612632565b506040820151612a436040850182612632565b60808201612ad88280613084565b612ae284826125c2565b50612af060208301836130e7565b612afd6020850182612632565b50612b0b6040830183613084565b612b1860408501826125c2565b50612b266060830183613084565b612a4360608501826125c2565b80516080830190612b4484826125c2565b506020820151612b576020850182612632565b506040820151612b6a60408501826125c2565b506060820151612a4360608501826125c2565b60006101408301612b8e8380613084565b612b9885826125c2565b50612ba66020840184613093565b8583036020870152612bb9838284612644565b92505050612bca60408401846130e3565b612bd760408601826129da565b50612be560c08401846130e3565b612bf260c0860182612aca565b509392505050565b8051600090610140840190612c0f85826125c2565b5060208301518482036020860152612c278282612670565b9150506040830151612c3c6040860182612a49565b506060830151612bf260c0860182612b33565b6000611b38828461269e565b60208101610fc982846125c2565b60608101612c7782866125c2565b612c8460208301856125c2565b61209d6040830184612632565b60a08101612c9f82886125c2565b612cac60208301876125c2565b612cb9604083018661263b565b612cc660608301856126df565b612cd36080830184612632565b9695505050505050565b60808101612ceb82876125c2565b612cf860208301866125c2565b612d05604083018561263b565b8181036060830152612cd38184612670565b60608101612d2582866125c2565b612c846020830185612632565b60408082528101612d448185876125d1565b905061209d6020830184612632565b60408101612d618285612629565b818103602083015261209d8184612670565b6020808252810161209d818486612644565b6101008082528101612d9881888a612644565b9050612da76020830187612629565b612db46040830186612632565b612dc16060830185612632565b612dce60808301846129da565b979650505050505050565b60208101610fc982846126cd565b60608101612d2582866126d6565b60208101610fc982846126df565b60208082528101611b388184612670565b60208082528101610fc9816126e8565b60208082528101610fc981612717565b60208082528101610fc981612750565b60208082528101610fc981612799565b60208082528101610fc9816127d2565b60208082528101610fc981612831565b60208082528101610fc98161285e565b60208082528101610fc981612889565b60208082528101610fc9816128c2565b60208082528101610fc9816128ee565b60208082528101610fc981612917565b60208082528101610fc981612943565b60208082528101610fc981612971565b60208082528101610fc9816129aa565b60408082528101612f058186612b7d565b90508181036020830152612f1a818486612644565b95945050505050565b6101008082528101612f35818a612b7d565b90508181036020830152612f4a81888a612644565b9050612f596040830187612a93565b612f6660a0830186612632565b612f7360c0830185612632565b81810360e0830152612f858184612670565b9998505050505050505050565b60408082528101612fa38185612bfa565b9050818103602083015261209d8184612670565b60608082528101612fc88186612bfa565b90508181036020830152612fdc8185612670565b905061209d6040830184612632565b60208101610fc98284612632565b606081016130078287612632565b6130146020830186612632565b8181036040830152612cd3818486612644565b6040518181016001600160401b038111828210171561304557600080fd5b604052919050565b60006001600160401b0382111561306357600080fd5b506020601f91909101601f19160190565b90565b5190565b90815260200190565b6000611b386020840184611d47565b6000808335601e19368590030181126130ab57600080fd5b8381016020810193503591506001600160401b038211156130cb57600080fd5b368290038413156130db57600080fd5b509250929050565b5090565b6000611b386020840184612074565b6000610fc982613127565b151590565b6001600160e01b03191690565b806110b381613196565b806110b3816131a3565b6001600160a01b031690565b6000610fc9826130f6565b6000610fc982613113565b6000610fc98261311d565b82818337506000910152565b60005b8381101561317b578181015183820152602001613163565b83811115612a435750506000910152565b601f01601f191690565b600881106131a057fe5b50565b600581106131a057fe5b6131b6816130f6565b81146131a057600080fd5b6131b681613101565b6131b681613074565b600581106131a057600080fdfe2449643a20346239666130363564663230326530626537323265633339313339343231363734316266386137322024a365627a7a723158204ebedef58be8c497437fcf042ec89fb6d60b4a4fd1d84dfdbecb93fb6af9c8e76c6578706572696d656e74616cf564736f6c6343000510004060806040523480156200001157600080fd5b5060405162000dc338038062000dc3833981016040819052620000349162000134565b6040805160a0810182526017606082019081527f47534e2052656c61796564205472616e73616374696f6e000000000000000000608083015281528151808301835260018152603160f81b6020828101919091528201526001600160a01b03831691810191909152620000b0906001600160e01b03620000ba16565b6000555062000273565b6000604051620000ca90620001e5565b60405180910390208260000151805190602001208360200151805190602001208460400151604051602001620001049493929190620001f2565b604051602081830303815290604052805190602001209050919050565b80516200012e8162000259565b92915050565b6000602082840312156200014757600080fd5b600062000155848462000121565b949350505050565b62000168816200023d565b82525050565b62000168816200024a565b60006200018860428362000238565b7f454950373132446f6d61696e28737472696e67206e616d652c737472696e672081527f76657273696f6e2c6164647265737320766572696679696e67436f6e74726163602082015261742960f01b604082015260420192915050565b60006200012e8262000179565b608081016200020282876200016e565b6200021160208301866200016e565b6200022060408301856200016e565b6200022f60608301846200015d565b95945050505050565b919050565b60006200012e826200024d565b90565b6001600160a01b031690565b62000264816200023d565b81146200027057600080fd5b50565b610b4080620002836000396000f3fe608060405234801561001057600080fd5b50600436106100625760003560e01c80633644e515146100675780633fb37abf146100855780638e1653c91461008d578063abf0d3f4146100ad578063c49f91d3146100b5578063cc0c62b2146100bd575b600080fd5b61006f6100c5565b60405161007c919061092f565b60405180910390f35b61006f6100cb565b6100a061009b366004610504565b6100e2565b60405161007c9190610921565b61006f610150565b61006f61015c565b61006f610168565b60005481565b6040516100d790610916565b604051809103902081565b6000806000546100f185610174565b6040516020016101029291906108cf565b60408051601f1981840301815291905280516020909101206060850151519091506001600160a01b031661013c828563ffffffff6101f416565b6001600160a01b0316149150505b92915050565b6040516100d7906108c4565b6040516100d790610900565b6040516100d79061090b565b6000604051610182906108c4565b6040518091039020826000015183602001516040516101a191906108b1565b60405180910390206101b685604001516102d0565b6101c3866060015161030e565b6040516020016101d795949392919061093d565b604051602081830303815290604052805190602001209050919050565b600081516041146102075750600061014a565b60208201516040830151606084015160001a7f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a082111561024d576000935050505061014a565b8060ff16601b1415801561026557508060ff16601c14155b15610276576000935050505061014a565b6001868285856040516000815260200160405260405161029994939291906109e6565b6020604051602081039080840390855afa1580156102bb573d6000803e3d6000fd5b5050604051601f190151979650505050505050565b60006040516102de90610916565b604051809103902082600001518360200151846040015185606001516040516020016101d79594939291906109cb565b600060405161031c9061090b565b604051809103902082600001518360200151846040015185606001516040516020016101d7959493929190610989565b803561014a81610add565b600082601f83011261036857600080fd5b813561037b61037682610a4b565b610a24565b9150808252602083016020830185838301111561039757600080fd5b6103a2838284610aa1565b50505092915050565b6000608082840312156103bd57600080fd5b6103c76080610a24565b905060006103d584846104f9565b82525060206103e6848483016104f9565b60208301525060406103fa848285016104f9565b604083015250606061040e848285016104f9565b60608301525092915050565b60006080828403121561042c57600080fd5b6104366080610a24565b90506000610444848461034c565b8252506020610455848483016104f9565b60208301525060406104698482850161034c565b604083015250606061040e8482850161034c565b6000610140828403121561049057600080fd5b61049a6080610a24565b905060006104a8848461034c565b825250602082013567ffffffffffffffff8111156104c557600080fd5b6104d184828501610357565b60208301525060406104e5848285016103ab565b60408301525060c061040e8482850161041a565b803561014a81610af4565b6000806040838503121561051757600080fd5b823567ffffffffffffffff81111561052e57600080fd5b61053a8582860161047d565b925050602083013567ffffffffffffffff81111561055757600080fd5b61056385828601610357565b9150509250929050565b61057681610a7c565b82525050565b61057681610a87565b61057681610a8c565b61057661059a82610a8c565b610a8c565b60006105aa82610a73565b6105b48185610a77565b93506105c4818560208601610aad565b9290920192915050565b60006105dc61010383610a77565b7f52656c6179526571756573742861646472657373207461726765742c6279746581527f7320656e636f64656446756e6374696f6e2c476173446174612067617344617460208201527f612c52656c6179446174612072656c617944617461294761734461746128756960408201527f6e74323536206761734c696d69742c75696e743235362067617350726963652c60608201527f75696e743235362070637452656c61794665652c75696e74323536206261736560808201527f52656c61794665652952656c61794461746128616464726573732073656e646560a08201527f72416464726573732c75696e743235362073656e6465724e6f6e63652c61646460c08201527f726573732072656c6179576f726b65722c61646472657373207061796d61737460e08201526265722960e81b6101008201526101030192915050565b600061072d600283610a77565b61190160f01b815260020192915050565b600061074b604283610a77565b7f454950373132446f6d61696e28737472696e67206e616d652c737472696e672081527f76657273696f6e2c6164647265737320766572696679696e67436f6e74726163602082015261742960f01b604082015260420192915050565b60006107b5605a83610a77565b7f52656c61794461746128616464726573732073656e646572416464726573732c81527f75696e743235362073656e6465724e6f6e63652c616464726573732072656c6160208201527f79576f726b65722c61646472657373207061796d6173746572290000000000006040820152605a0192915050565b600061083a605383610a77565b7f476173446174612875696e74323536206761734c696d69742c75696e7432353681527f2067617350726963652c75696e743235362070637452656c61794665652c75696020820152726e74323536206261736552656c61794665652960681b604082015260530192915050565b61057681610a9b565b60006108bd828461059f565b9392505050565b600061014a826105ce565b60006108da82610720565b91506108e6828561058e565b6020820191506108f6828461058e565b5060200192915050565b600061014a8261073e565b600061014a826107a8565b600061014a8261082d565b6020810161014a828461057c565b6020810161014a8284610585565b60a0810161094b8288610585565b610958602083018761056d565b6109656040830186610585565b6109726060830185610585565b61097f6080830184610585565b9695505050505050565b60a081016109978288610585565b6109a4602083018761056d565b6109b16040830186610585565b6109be606083018561056d565b61097f608083018461056d565b60a081016109d98288610585565b6109586020830187610585565b608081016109f48287610585565b610a0160208301866108a8565b610a0e6040830185610585565b610a1b6060830184610585565b95945050505050565b60405181810167ffffffffffffffff81118282101715610a4357600080fd5b604052919050565b600067ffffffffffffffff821115610a6257600080fd5b506020601f91909101601f19160190565b5190565b919050565b600061014a82610a8f565b151590565b90565b6001600160a01b031690565b60ff1690565b82818337506000910152565b60005b83811015610ac8578181015183820152602001610ab0565b83811115610ad7576000848401525b50505050565b610ae681610a7c565b8114610af157600080fd5b50565b610ae681610a8c56fea365627a7a723158201d677c23ec7b0e52675b1b060287807d12a7d7297770a10d294bbbc414eb84ba6c6578706572696d656e74616cf564736f6c63430005100040",
    deploy: {
      fundsEther: '0.42'
      // tx:
      //   '0xf93c798085174876e800834016408080b93c2660c0604052600560808190527f312e302e3000000000000000000000000000000000000000000000000000000060a090815262000040916003919062000055565b503480156200004e57600080fd5b50620000fa565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200009857805160ff1916838001178555620000c8565b82800160010185558215620000c8579182015b82811115620000c8578251825591602001919060010190620000ab565b50620000d6929150620000da565b5090565b620000f791905b80821115620000d65760008155600101620000e1565b90565b613b1c806200010a6000396000f3fe6080604052600436106101085760003560e01c806370a0823111610095578063a8cd957211610064578063a8cd957214610ada578063aa67c91914610d1a578063adc9772e14610d40578063c3e712f214610d6c578063f2888dbb14610d9f57610108565b806370a08231146109a557806385f4498b146109d85780638d85146014610a1f578063a863f8f914610aa457610108565b80632d0335ab116100dc5780632d0335ab1461058957806339002432146105ce578063405cec671461070457806354fd4d50146108f15780636a7d84a41461097b57610108565b8062f714ce1461010d5780631166073a146101485780632b601747146102005780632ca70eba14610474575b600080fd5b34801561011957600080fd5b506101466004803603604081101561013057600080fd5b50803590602001356001600160a01b0316610dd2565b005b34801561015457600080fd5b506101466004803603604081101561016b57600080fd5b81359190810190604081016020820135600160201b81111561018c57600080fd5b82018360208201111561019e57600080fd5b803590602001918460018302840111600160201b831117156101bf57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550610ec9945050505050565b34801561020c57600080fd5b506103f5600480360361014081101561022457600080fd5b6001600160a01b0382358116926020810135821692604082013590921691810190608081016060820135600160201b81111561025f57600080fd5b82018360208201111561027157600080fd5b803590602001918460018302840111600160201b8311171561029257600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929584359560208601359560408101359550606081013594509192509060a081019060800135600160201b8111156102fc57600080fd5b82018360208201111561030e57600080fd5b803590602001918460018302840111600160201b8311171561032f57600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b81111561038157600080fd5b82018360208201111561039357600080fd5b803590602001918460018302840111600160201b831117156103b457600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550611178945050505050565b6040518083815260200180602001828103825283818151815260200191508051906020019080838360005b83811015610438578181015183820152602001610420565b50505050905090810190601f1680156104655780820380516001836020036101000a031916815260200191505b50935050505060405180910390f35b34801561048057600080fd5b50610565600480360360e081101561049757600080fd5b6001600160a01b038235169190810190604081016020820135600160201b8111156104c157600080fd5b8201836020820111156104d357600080fd5b803590602001918460018302840111600160201b831117156104f457600080fd5b9193909282359260208101359260408201359260608301359260a081019060800135600160201b81111561052757600080fd5b82018360208201111561053957600080fd5b803590602001918460018302840111600160201b8311171561055a57600080fd5b509092509050611684565b6040518082600481111561057557fe5b60ff16815260200191505060405180910390f35b34801561059557600080fd5b506105bc600480360360208110156105ac57600080fd5b50356001600160a01b0316611a97565b60408051918252519081900360200190f35b3480156105da57600080fd5b50610146600480360360408110156105f157600080fd5b810190602081018135600160201b81111561060b57600080fd5b82018360208201111561061d57600080fd5b803590602001918460018302840111600160201b8311171561063e57600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b81111561069057600080fd5b8201836020820111156106a257600080fd5b803590602001918460018302840111600160201b831117156106c357600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550611ab6945050505050565b34801561071057600080fd5b50610146600480360361012081101561072857600080fd5b6001600160a01b038235811692602081013590911691810190606081016040820135600160201b81111561075b57600080fd5b82018360208201111561076d57600080fd5b803590602001918460018302840111600160201b8311171561078e57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929584359560208601359560408101359550606081013594509192509060a081019060800135600160201b8111156107f857600080fd5b82018360208201111561080a57600080fd5b803590602001918460018302840111600160201b8311171561082b57600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b81111561087d57600080fd5b82018360208201111561088f57600080fd5b803590602001918460018302840111600160201b831117156108b057600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550611c08945050505050565b3480156108fd57600080fd5b506109066122c2565b6040805160208082528351818301528351919283929083019185019080838360005b83811015610940578181015183820152602001610928565b50505050905090810190601f16801561096d5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b34801561098757600080fd5b506105bc6004803603602081101561099e57600080fd5b5035612350565b3480156109b157600080fd5b506105bc600480360360208110156109c857600080fd5b50356001600160a01b0316612358565b3480156109e457600080fd5b50610a0b600480360360208110156109fb57600080fd5b50356001600160a01b0316612373565b604080519115158252519081900360200190f35b348015610a2b57600080fd5b50610a5260048036036020811015610a4257600080fd5b50356001600160a01b03166123be565b60405180868152602001858152602001848152602001836001600160a01b03166001600160a01b03168152602001826003811115610a8c57fe5b60ff1681526020019550505050505060405180910390f35b348015610ab057600080fd5b506105bc60048036036060811015610ac757600080fd5b5080359060208101359060400135612402565b348015610ae657600080fd5b5061014660048036036080811015610afd57600080fd5b810190602081018135600160201b811115610b1757600080fd5b820183602082011115610b2957600080fd5b803590602001918460018302840111600160201b83111715610b4a57600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b811115610b9c57600080fd5b820183602082011115610bae57600080fd5b803590602001918460018302840111600160201b83111715610bcf57600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b811115610c2157600080fd5b820183602082011115610c3357600080fd5b803590602001918460018302840111600160201b83111715610c5457600080fd5b91908080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152509295949360208101935035915050600160201b811115610ca657600080fd5b820183602082011115610cb857600080fd5b803590602001918460018302840111600160201b83111715610cd957600080fd5b91908080601f01602080910402602001604051908101604052809392919081815260200183838082843760009201919091525092955061241f945050505050565b61014660048036036020811015610d3057600080fd5b50356001600160a01b0316612711565b61014660048036036040811015610d5657600080fd5b506001600160a01b0381351690602001356127d9565b348015610d7857600080fd5b5061014660048036036020811015610d8f57600080fd5b50356001600160a01b0316612bcc565b348015610dab57600080fd5b5061014660048036036020811015610dc257600080fd5b50356001600160a01b0316612d51565b33600081815260026020526040902054831115610e2b576040805162461bcd60e51b8152602060048201526012602482015271696e73756666696369656e742066756e647360701b604482015290519081900360640190fd5b6001600160a01b0380821660009081526002602052604080822080548790039055519184169185156108fc0291869190818181858888f19350505050158015610e78573d6000803e3d6000fd5b50816001600160a01b0316816001600160a01b03167fd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb856040518082815260200191505060405180910390a3505050565b33328114610f085760405162461bcd60e51b8152600401808060200182810382526023815260200180613ac56023913960400191505060405180910390fd5b60016001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff1690811115610f3c57fe5b1480610f79575060026001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff1690811115610f7757fe5b145b610fc2576040805162461bcd60e51b815260206004820152601560248201527477726f6e6720737461746520666f72207374616b6560581b604482015290519081900360640190fd5b67016345785d8a0000816001600160a01b0316311015611029576040805162461bcd60e51b815260206004820152601a60248201527f62616c616e6365206c6f776572207468616e206d696e696d756d000000000000604482015290519081900360640190fd5b60026001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff169081111561105d57fe5b1461108f576001600160a01b0381166000908152600160205260409020600301805460ff60a01b1916600160a11b1790555b6001600160a01b03808216600081815260016020818152604080842060038101548154919094015482518b81528085018390529283018190526080606084018181528b51918501919091528a5195909816977f85b3ae3aae9d3fcb31142fbd8c3b4722d57825b8edd6e1366e69204afa5a0dfa968c96939592948c94909360a085019290860191908190849084905b8381101561113657818101518382015260200161111e565b50505050905090810190601f1680156111635780820380516001836020036101000a031916815260200191505b509550505050505060405180910390a3505050565b60006060808b8b8b8b8b8b8b3060405160200180806339363c1d60e11b815250600401896001600160a01b03166001600160a01b031660601b8152601401886001600160a01b03166001600160a01b031660601b815260140187805190602001908083835b602083106111fc5780518252601f1990920191602091820191016111dd565b6001836020036101000a038019825116818451168082178552505050505050905001868152602001858152602001848152602001838152602001826001600160a01b03166001600160a01b031660601b81526014019850505050505050505060405160208183030381529060405290506000818e6040516020018083805190602001908083835b602083106112a25780518252601f199092019160209182019101611283565b6001836020036101000a038019825116818451168082178552505050505050905001826001600160a01b03166001600160a01b031660601b8152601401925050506040516020818303038152906040528051906020012090508c6001600160a01b031661131e8761131284612eab565b9063ffffffff612efc16565b6001600160a01b03161461134957600160405180602001604052806000815250935093505050611675565b50506001600160a01b038b166000908152602081905260409020548514611383575050604080516020810190915260008152600290611675565b600061139087898b612402565b905060608b6001600160a01b03166383947ea0905060e01b8e8e8d8d8d8d8d8c8a604051602401808a6001600160a01b03166001600160a01b03168152602001896001600160a01b03166001600160a01b03168152602001806020018881526020018781526020018681526020018581526020018060200184815260200183810383528a818151815260200191508051906020019080838360005b8381101561144357818101518382015260200161142b565b50505050905090810190601f1680156114705780820380516001836020036101000a031916815260200191505b50838103825285518152855160209182019187019080838360005b838110156114a357818101518382015260200161148b565b50505050905090810190601f1680156114d05780820380516001836020036101000a031916815260200191505b509b505050505050505050505050604051602081830303815290604052906001600160e01b0319166020820180516001600160e01b0383818316178352505050509050600060608d6001600160a01b031661c350846040518082805190602001908083835b602083106115545780518252601f199092019160209182019101611535565b6001836020036101000a0380198251168184511680821785525050505050509050019150506000604051808303818686fa925050503d80600081146115b5576040519150601f19603f3d011682016040523d82523d6000602084013e6115ba565b606091505b5091509150816115e45760035b604051806020016040528060008152509550955050505050611675565b8080602001905160408110156115f957600080fd5b815160208301805191939283019291600160201b81111561161957600080fd5b8201602081018481111561162c57600080fd5b8151600160201b81118282018710171561164557600080fd5b50949a509850508815925082915061165f90505750600a86115b1561166e575061167592505050565b60046115c7565b9a509a98505050505050505050565b600061168e613998565b5a81523330146116cf5760405162461bcd60e51b8152600401808060200182810382526027815260200180613a196027913960400191505060405180910390fd5b6001600160a01b038b166000908152600260209081526040918290205483820152905160248101918252604481018590526060916380274db760e01b91879187918190606401848480828437600081840152601f19601f8201169050808301925050509350505050604051602081830303815290604052906001600160e01b0319166020820180516001600160e01b0383818316178352505050509050600060608d6001600160a01b0316620186a0846040518082805190602001908083835b602083106117ae5780518252601f19909201916020918201910161178f565b6001836020036101000a03801982511681845116808217855250505050505090500191505060006040518083038160008787f1925050503d8060008114611811576040519150601f19603f3d011682016040523d82523d6000602084013e611816565b606091505b50915091508161182a5761182a6002612fea565b80806020019051602081101561183f57600080fd5b5051604080860191909152516001600160a01b038f1693508992508d91508c908083838082843760405192019450600093509091505080830381838787f1925050503d80600081146118ad576040519150601f19603f3d011682016040523d82523d6000602084013e6118b2565b606091505b5050151560608083019190915260006118db6118d45a85518a01036001613026565b8a8c613046565b90508c6001600160a01b031663e06e0e22905060e01b868685606001518487604001516040516024018080602001851515151581526020018481526020018381526020018281038252878782818152602001925080828437600081840152601f19601f8201169050808301925050509650505050505050604051602081830303815290604052906001600160e01b0319166020820180516001600160e01b03838183161783525050505091505060008c6001600160a01b0316620186a0836040518082805190602001908083835b602083106119c85780518252601f1990920191602091820191016119a9565b6001836020036101000a03801982511681845116808217855250505050505090500191505060006040518083038160008787f1925050503d8060008114611a2b576040519150601f19603f3d011682016040523d82523d6000602084013e611a30565b606091505b5050905080611a4357611a436003612fea565b50506020808201516001600160a01b038d16600090815260029092526040909120541015611a7557611a756004612fea565b8060600151611a85576001611a88565b60005b9b9a5050505050505050505050565b6001600160a01b0381166000908152602081905260409020545b919050565b611abe6139bf565b611ac783613054565b60608101519091506001600160a01b0316301415611b75576000611aee8260a0015161308e565b90506001600160e01b0319811663405cec6760e01b14801590611b2257506001600160e01b031981166308b3039d60e11b14155b611b73576040805162461bcd60e51b815260206004820152601760248201527f4c6567616c2072656c6179207472616e73616374696f6e000000000000000000604482015290519081900360640190fd5b505b6000611bf783856040516020018082805190602001908083835b60208310611bae5780518252601f199092019160209182019101611b8f565b6001836020036101000a03801982511681845116808217855250505050505090500191505060405160208183030381529060405280519060200120612efc90919063ffffffff16565b9050611c028161309b565b50505050565b60005a90506002336000908152600160205260409020600390810154600160a01b900460ff1690811115611c3857fe5b14611c7a576040805162461bcd60e51b815260206004820152600d60248201526c556e6b6e6f776e2072656c617960981b604482015290519081900360640190fd5b3a861115611cc3576040805162461bcd60e51b8152602060048201526011602482015270496e76616c69642067617320707269636560781b604482015290519081900360640190fd5b611cd7611ccf86612350565b61bc4c61331d565b811015611d22576040805162461bcd60e51b81526020600482015260146024820152734e6f7420656e6f756768206761736c656674282960601b604482015290519081900360640190fd5b6001600160a01b038916600090815260026020526040902054611d4686888a612402565b1115611d99576040805162461bcd60e51b815260206004820152601960248201527f526563697069656e742062616c616e636520746f6f206c6f7700000000000000604482015290519081900360640190fd5b6000611da689600061337a565b905060606000611dbe338e8e8e8e8e8e8e8e8e611178565b925090508015611e42578b6001600160a01b03168d6001600160a01b0316336001600160a01b03167fafb5afd6d1c2e8ffbfb480e674a169f493ece0b22658d4f4484e7334f0241e22868560405180836001600160e01b0319166001600160e01b03191681526020018281526020019250505060405180910390a4505050506122b7565b506001600160a01b038c16600090815260208190526040812080546001019055805a8503905060608c8f6040516020018083805190602001908083835b60208310611e9e5780518252601f199092019160209182019101611e7f565b6001836020036101000a038019825116818451168082178552505050505050905001826001600160a01b03166001600160a01b031660601b81526014019250505060405160208183030381529060405290506060632ca70eba60e01b8f838f8f8f888b60405160240180886001600160a01b03166001600160a01b031681526020018060200187815260200186815260200185815260200184815260200180602001838103835289818151815260200191508051906020019080838360005b83811015611f75578181015183820152602001611f5d565b50505050905090810190601f168015611fa25780820380516001836020036101000a031916815260200191505b50838103825284518152845160209182019186019080838360005b83811015611fd5578181015183820152602001611fbd565b50505050905090810190601f1680156120025780820380516001836020036101000a031916815260200191505b509950505050505050505050604051602081830303815290604052906001600160e01b0319166020820180516001600160e01b03838183161783525050505090506060306001600160a01b0316826040518082805190602001908083835b6020831061207f5780518252601f199092019160209182019101612060565b6001836020036101000a0380198251168184511680821785525050505050509050019150506000604051808303816000865af19150503d80600081146120e1576040519150601f19603f3d011682016040523d82523d6000602084013e6120e6565b606091505b509150508080602001905160208110156120ff57600080fd5b5051945060009350612123925061211c9150505a87036000613026565b8b8d613046565b6001600160a01b038e16600090815260026020526040902054909150811115612189576040805162461bcd60e51b815260206004820152601360248201527253686f756c64206e6f7420676574206865726560681b604482015290519081900360640190fd5b80600260008f6001600160a01b03166001600160a01b0316815260200190815260200160002060008282540392505081905550806002600060016000336001600160a01b03166001600160a01b0316815260200190815260200160002060030160009054906101000a90046001600160a01b03166001600160a01b03166001600160a01b03168152602001908152602001600020600082825401925050819055508c6001600160a01b03168e6001600160a01b0316336001600160a01b03167fab74390d395916d9e0006298d47938a5def5d367054dcca78fa6ec84381f3f2287868660405180846001600160e01b0319166001600160e01b031916815260200183600481111561229657fe5b60ff168152602001828152602001935050505060405180910390a450505050505b505050505050505050565b6003805460408051602060026001851615610100026000190190941693909304601f810184900484028201840190925281815292918301828280156123485780601f1061231d57610100808354040283529160200191612348565b820191906000526020600020905b81548152906001019060200180831161232b57829003601f168201915b505050505081565b6206137c0190565b6001600160a01b031660009081526002602052604090205490565b6001600160a01b038116600090815260016020526040812060020154158015906123b857506001600160a01b0382166000908152600160205260409020600201544210155b92915050565b6001600160a01b039081166000908152600160208190526040909120805491810154600282015460039092015492949093919291821691600160a01b900460ff1690565b600061241761241085612350565b8484613046565b949350505050565b6000612457848660405160200180828051906020019080838360208310611bae5780518252601f199092019160209182019101611b8f565b90506000612491838560405160200180828051906020019080838360208310611bae5780518252601f199092019160209182019101611b8f565b9050806001600160a01b0316826001600160a01b0316146124ec576040805162461bcd60e51b815260206004820152601060248201526f2234b33332b932b73a1039b4b3b732b960811b604482015290519081900360640190fd5b6124f46139bf565b6124fd87613054565b90506125076139bf565b61251086613054565b805183519192501461255b576040805162461bcd60e51b815260206004820152600f60248201526e446966666572656e74206e6f6e636560881b604482015290519081900360640190fd5b60608260a001518360400151846060015185608001516040516020018085805190602001908083835b602083106125a35780518252601f199092019160209182019101612584565b6001836020036101000a038019825116818451168082178552505050505050905001848152602001836001600160a01b03166001600160a01b031660601b8152601401828152602001945050505050604051602081830303815290604052905060608260a001518360400151846060015185608001516040516020018085805190602001908083835b6020831061264b5780518252601f19909201916020918201910161262c565b6001836020036101000a038019825116818451168082178552505050505050905001848152602001836001600160a01b03166001600160a01b031660601b815260140182815260200194505050505060405160208183030381529060405290508080519060200120828051906020012014156126fc576040805162461bcd60e51b815260206004820152600b60248201526a1d1e081a5cc8195c5d585b60aa1b604482015290519081900360640190fd5b6127058661309b565b50505050505050505050565b34671bc16d674ec80000811115612761576040805162461bcd60e51b815260206004820152600f60248201526e6465706f73697420746f6f2062696760881b604482015290519081900360640190fd5b6001600160a01b03821660009081526002602052604090205461278490826133d2565b6001600160a01b038316600081815260026020908152604091829020939093558051848152905133937f8752a472e571a816aea92eec8dae9baf628e840f4929fbcc2d155e6233ff68a7928290030190a35050565b60006001600160a01b0383166000908152600160205260409020600390810154600160a01b900460ff169081111561280d57fe5b14156128ae57336001600160a01b0383161415612871576040805162461bcd60e51b815260206004820152601d60248201527f72656c61792063616e6e6f74207374616b6520666f7220697473656c66000000604482015290519081900360640190fd5b6001600160a01b038216600090815260016020526040902060030180546001600160a01b031916331760ff60a01b1916600160a01b1790556129cb565b60016001600160a01b0383166000908152600160205260409020600390810154600160a01b900460ff16908111156128e257fe5b148061291f575060026001600160a01b0383166000908152600160205260409020600390810154600160a01b900460ff169081111561291d57fe5b145b15612986576001600160a01b03828116600090815260016020526040902060030154163314612981576040805162461bcd60e51b81526020600482015260096024820152683737ba1037bbb732b960b91b604482015290519081900360640190fd5b6129cb565b6040805162461bcd60e51b815260206004820152601560248201527477726f6e6720737461746520666f72207374616b6560581b604482015290519081900360640190fd5b6001600160a01b03821660009081526001602052604090208054349081019182905590670de0b6b3a76400001115612a4a576040805162461bcd60e51b815260206004820152601860248201527f7374616b65206c6f776572207468616e206d696e696d756d0000000000000000604482015290519081900360640190fd5b62093a80821015612aa2576040805162461bcd60e51b815260206004820152601860248201527f64656c6179206c6f776572207468616e206d696e696d756d0000000000000000604482015290519081900360640190fd5b626ebe00821115612afa576040805162461bcd60e51b815260206004820152601960248201527f64656c617920686967686572207468616e206d6178696d756d00000000000000604482015290519081900360640190fd5b6001600160a01b03831660009081526001602081905260409091200154821015612b6b576040805162461bcd60e51b815260206004820181905260248201527f756e7374616b6544656c61792063616e6e6f7420626520646563726561736564604482015290519081900360640190fd5b6001600160a01b0383166000818152600160208181526040928390209182018690559054825190815290810185905281517f1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90929181900390910190a2505050565b6001600160a01b03818116600090815260016020526040902060030154163314612c29576040805162461bcd60e51b81526020600482015260096024820152683737ba1037bbb732b960b91b604482015290519081900360640190fd5b60016001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff1690811115612c5d57fe5b1480612c9a575060026001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff1690811115612c9857fe5b145b612cdd576040805162461bcd60e51b815260206004820152600f60248201526e185b1c9958591e481c995b5bdd9959608a1b604482015290519081900360640190fd5b6001600160a01b038116600081815260016020818152604092839020918201544201600283018190556003909201805460ff60a01b1916600360a01b179055825191825291517f5490afc1d818789c8b3d5d63bce3d2a3327d0bba4efb5a7751f783dc977d7d11929181900390910190a250565b612d5a81612373565b612d9f576040805162461bcd60e51b815260206004820152601160248201527018d85b955b9cdd185ad94819985a5b1959607a1b604482015290519081900360640190fd5b6001600160a01b03818116600090815260016020526040902060030154163314612dfc576040805162461bcd60e51b81526020600482015260096024820152683737ba1037bbb732b960b91b604482015290519081900360640190fd5b6001600160a01b038116600090815260016020819052604080832080548482559281018490556002810184905560030180546001600160a81b0319169055513392839183156108fc0291849190818181858888f19350505050158015612e66573d6000803e3d6000fd5b506040805182815290516001600160a01b038516917f0f5bb82176feb1b5e747e28471aa92156a04d9f3ab9f45f28e2d704232b93f75919081900360200190a2505050565b604080517f19457468657265756d205369676e6564204d6573736167653a0a333200000000602080830191909152603c8083019490945282518083039094018452605c909101909152815191012090565b60008151604114612f0f575060006123b8565b60208201516040830151606084015160001a7f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0821115612f5557600093505050506123b8565b8060ff16601b14158015612f6d57508060ff16601c14155b15612f7e57600093505050506123b8565b6040805160008152602080820180845289905260ff8416828401526060820186905260808201859052915160019260a0808401939192601f1981019281900390910190855afa158015612fd5573d6000803e3d6000fd5b5050604051601f190151979650505050505050565b6060816040516020018082600481111561300057fe5b60ff16815260200191505060405160208183030381529060405290508051602082018181fd5b600081613034576000613039565b62019a285b90920161bc4c0192915050565b606490810191909202020490565b61305c6139bf565b61306582613433565b60a087015260808601526001600160a01b03166060850152604084015260208301528152919050565b60006123b88260006134ed565b60016001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff16908111156130cf57fe5b148061310c575060026001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff169081111561310a57fe5b145b80613148575060036001600160a01b0382166000908152600160205260409020600390810154600160a01b900460ff169081111561314657fe5b145b61318a576040805162461bcd60e51b815260206004820152600e60248201526d556e7374616b65642072656c617960901b604482015290519081900360640190fd5b6001600160a01b038116600090815260016020526040812054906131af8260026134f9565b905060006131bd838361331d565b905060026001600160a01b0385166000908152600160205260409020600390810154600160a01b900460ff16908111156131f357fe5b1415613239576040805142815290516001600160a01b038616917f5490afc1d818789c8b3d5d63bce3d2a3327d0bba4efb5a7751f783dc977d7d11919081900360200190a25b6001600160a01b038416600090815260016020819052604080832083815591820183905560028201839055600390910180546001600160a81b03191690555183156108fc0290849083818181858288f1935050505015801561329f573d6000803e3d6000fd5b506040513390819083156108fc029084906000818181858888f193505050501580156132cf573d6000803e3d6000fd5b50604080516001600160a01b038381168252602082018590528251908816927fb0595266ccec357806b2691f348b128209f1060a0bda4f5c95f7090730351ff8928290030190a25050505050565b600082821115613374576040805162461bcd60e51b815260206004820152601e60248201527f536166654d6174683a207375627472616374696f6e206f766572666c6f770000604482015290519081900360640190fd5b50900390565b600081600401835110156133bf5760405162461bcd60e51b8152600401808060200182810382526025815260200180613aa06025913960400191505060405180910390fd5b5001602001516001600160e01b03191690565b60008282018381101561342c576040805162461bcd60e51b815260206004820152601b60248201527f536166654d6174683a206164646974696f6e206f766572666c6f770000000000604482015290519081900360640190fd5b9392505050565b600080600080600060608061344f61344a89613563565b6135a8565b905061346e8160008151811061346157fe5b60200260200101516136ad565b61347e8260018151811061346157fe5b61348e8360028151811061346157fe5b6134ab8460038151811061349e57fe5b60200260200101516136db565b6134bb8560048151811061346157fe5b6134d8866005815181106134cb57fe5b602002602001015161372a565b949d939c50919a509850965090945092505050565b600061342c8383613797565b600080821161354f576040805162461bcd60e51b815260206004820152601a60248201527f536166654d6174683a206469766973696f6e206279207a65726f000000000000604482015290519081900360640190fd5b600082848161355a57fe5b04949350505050565b61356b6139fe565b815161358b57506040805180820190915260008082526020820152611ab1565b506040805180820190915281518152602082810190820152919050565b60606135b3826137e5565b6135f4576040805162461bcd60e51b815260206004820152600d60248201526c1a5cd31a5cdd0819985a5b1959609a1b604482015290519081900360640190fd5b60006135ff83613811565b90508060405190808252806020026020018201604052801561363b57816020015b6136286139fe565b8152602001906001900390816136205790505b509150600061364d846020015161385e565b60208501510190506000805b838110156136a45761366a836138c7565b915060405180604001604052808381526020018481525085828151811061368d57fe5b602090810291909101015291810191600101613659565b50505050919050565b6000806136bd836020015161385e565b83516020948501518201519190039093036101000a90920492915050565b60006015826000015111156137215760405162461bcd60e51b815260040180806020018281038252603a815260200180613a40603a913960400191505060405180910390fd5b6123b8826136ad565b6060600061373b836020015161385e565b83516040805191839003808352601f19601f8201168301602001909152919250606090828015613772576020820181803883390190505b509050600081602001905061378e848760200151018285613957565b50949350505050565b600081602001835110156137dc5760405162461bcd60e51b8152600401808060200182810382526026815260200180613a7a6026913960400191505060405180910390fd5b50016020015190565b6020810151805160009190821a9060c082101561380757600092505050611ab1565b5060019392505050565b600080600090506000613827846020015161385e565b602085015185519181019250015b8082101561385557613846826138c7565b60019093019290910190613835565b50909392505050565b8051600090811a6080811015613878576000915050611ab1565b60b8811080613893575060c08110801590613893575060f881105b156138a2576001915050611ab1565b60c08110156138b65760b519019050611ab1565b60f519019050611ab1565b50919050565b8051600090811a60808110156138e1576001915050611ab1565b60b88110156138f557607e19019050611ab1565b60c08110156139225760b78103600184019350806020036101000a845104600182018101935050506138c1565b60f88110156139365760be19019050611ab1565b60019290920151602083900360f7016101000a900490910160f51901919050565b5b60208110613977578251825260209283019290910190601f1901613958565b915181516020939093036101000a6000190180199091169216919091179052565b60408051608081018252600080825260208201819052918101829052606081019190915290565b6040518060c0016040528060008152602001600081526020016000815260200160006001600160a01b0316815260200160008152602001606081525090565b60405180604001604052806000815260200160008152509056fe4f6e6c792052656c61794875622073686f756c642063616c6c20746869732066756e6374696f6e496e76616c696420524c504974656d2e204164647265737365732061726520656e636f64656420696e203230206279746573206f72206c657373475245415445525f4f525f455155414c5f544f5f33325f4c454e4754485f5245515549524544475245415445525f4f525f455155414c5f544f5f345f4c454e4754485f5245515549524544436f6e7472616374732063616e6e6f742072656769737465722061732072656c617973a265627a7a72305820ac2aa0393ce6b8813055ebaead9b1b776f47b7e48a65bcca3c6bd72394ef5d6464736f6c634300050a00321ba01613161316131613161316131613161316131613161316131613161316131613a01613161316131613161316131613161316131613161316131613161316131613'
    }
  },
  stakeManager: {
    abi: [
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayHub",
            "type": "address"
          }
        ],
        "name": "HubAuthorized",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayHub",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "removalBlock",
            "type": "uint256"
          }
        ],
        "name": "HubUnauthorized",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "stake",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "unstakeDelay",
            "type": "uint256"
          }
        ],
        "name": "StakeAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "beneficiary",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "StakePenalized",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "withdrawBlock",
            "type": "uint256"
          }
        ],
        "name": "StakeUnlocked",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "StakeWithdrawn",
        "type": "event"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "authorizedHubs",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "removalBlock",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "stakes",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "stake",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "unstakeDelay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "withdrawBlock",
            "type": "uint256"
          },
          {
            "internalType": "address payable",
            "name": "owner",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          }
        ],
        "name": "getStakeInfo",
        "outputs": [
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "stake",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "unstakeDelay",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawBlock",
                "type": "uint256"
              },
              {
                "internalType": "address payable",
                "name": "owner",
                "type": "address"
              }
            ],
            "internalType": "struct IStakeManager.StakeInfo",
            "name": "stakeInfo",
            "type": "tuple"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "unstakeDelay",
            "type": "uint256"
          }
        ],
        "name": "stakeForAddress",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          }
        ],
        "name": "unlockStake",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          }
        ],
        "name": "withdrawStake",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "relayHub",
            "type": "address"
          }
        ],
        "name": "authorizeHub",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "relayHub",
            "type": "address"
          }
        ],
        "name": "unauthorizeHub",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "minAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minUnstakeDelay",
            "type": "uint256"
          }
        ],
        "name": "isRelayManagerStaked",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "relayManager",
            "type": "address"
          },
          {
            "internalType": "address payable",
            "name": "beneficiary",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "penalizeRelayManager",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    bytecode: "0x608060405234801561001057600080fd5b5061103a806100206000396000f3fe6080604052600436106100915760003560e01c80635d2fb768116100595780635d2fb768146101515780637aeb642a14610164578063c23a5cea14610191578063c3453153146101b1578063dd687862146101de57610091565b806309a08af41461009657806316934fc4146100b857806319c18932146100f15780634a1ce59914610111578063500aaa3814610131575b600080fd5b3480156100a257600080fd5b506100b66100b1366004610ad0565b61020b565b005b3480156100c457600080fd5b506100d86100d3366004610a70565b6103bf565b6040516100e89493929190610f71565b60405180910390f35b3480156100fd57600080fd5b506100b661010c366004610a96565b6103ef565b34801561011d57600080fd5b506100b661012c366004610a70565b610486565b34801561013d57600080fd5b506100b661014c366004610a96565b61053c565b6100b661015f366004610b1d565b61062a565b34801561017057600080fd5b5061018461017f366004610a96565b61079e565b6040516100e89190610f48565b34801561019d57600080fd5b506100b66101ac366004610a70565b6107bb565b3480156101bd57600080fd5b506101d16101cc366004610a70565b6108f9565b6040516100e89190610f3a565b3480156101ea57600080fd5b506101fe6101f9366004610b4d565b610952565b6040516100e89190610e6c565b6001600160a01b0383166000908152600160209081526040808320338452909152902054806102555760405162461bcd60e51b815260040161024c90610eea565b60405180910390fd5b4381116102745760405162461bcd60e51b815260040161024c90610eaa565b6001600160a01b0384166000908152602081905260409020548211156102ac5760405162461bcd60e51b815260040161024c90610f0a565b6001600160a01b0384166000908152602081905260409020546102cf90836109c7565b6001600160a01b0385166000908152602081905260408120919091556102f68360026109f4565b9050600061030484836109c7565b60405190915060009083156108fc0290849083818181858288f19350505050158015610334573d6000803e3d6000fd5b506040516001600160a01b0386169082156108fc029083906000818181858888f1935050505015801561036b573d6000803e3d6000fd5b50846001600160a01b0316866001600160a01b03167f2f2ba0bf4c9bedc2210a4da5b5811c2a4fd28e62c51bb90c3ea6fdce00808eb0836040516103af9190610f48565b60405180910390a3505050505050565b6000602081905290815260409020805460018201546002830154600390930154919290916001600160a01b031684565b6001600160a01b0380831660009081526020819052604090206003810154909116331461042e5760405162461bcd60e51b815260040161024c90610f2a565b6001600160a01b038084166000818152600160209081526040808320948716808452949091528082206000199055517fe292c4f6e9f34c975f4958cd5650a8111352feae914a67b064079571054210219190a3505050565b6001600160a01b038082166000908152602081905260409020600381015490911633146104c55760405162461bcd60e51b815260040161024c90610f2a565b6002810154156104e75760405162461bcd60e51b815260040161024c90610e7a565b600181015443016002820181905560405133916001600160a01b038516917f9ffc6168de1eb7f1d16200f614753cd7edce5a2186aab1c612199dd7316cd7c49161053091610f48565b60405180910390a35050565b6001600160a01b0380831660009081526020819052604090206003810154909116331461057b5760405162461bcd60e51b815260040161024c90610f2a565b6001600160a01b0380841660009081526001602090815260408083209386168352929052208054600019146105c25760405162461bcd60e51b815260040161024c90610eea565b6001600160a01b038085166000818152602081905260409081902060010154430180855590519092861691907f8d941c9b73ba7e59671a59eed85054004624684182b0e4bdb56c35937bac65a69061061b908590610f48565b60405180910390a35050505050565b6001600160a01b0382811660009081526020819052604090206003015416158061067057506001600160a01b038281166000908152602081905260409020600301541633145b61068c5760405162461bcd60e51b815260040161024c90610f2a565b6001600160a01b0382166000908152602081905260409020600101548110156106c75760405162461bcd60e51b815260040161024c90610eca565b336001600160a01b03831614156106f05760405162461bcd60e51b815260040161024c90610f1a565b336000908152602081905260409020600301546001600160a01b0316156107295760405162461bcd60e51b815260040161024c90610eda565b6001600160a01b03808316600081815260208190526040908190206003810180546001600160a01b031916331790819055815434018083556001909201869055915191909316927fef7c8dfef14cbefdf829b8f066b068b677992411137321d64b3ed4538c2b36379161053091908690610f56565b600160209081526000928352604080842090915290825290205481565b6001600160a01b038082166000908152602081905260409020600381015490911633146107fa5760405162461bcd60e51b815260040161024c90610f2a565b600081600201541161081e5760405162461bcd60e51b815260040161024c90610efa565b43816002015411156108425760405162461bcd60e51b815260040161024c90610e8a565b80546001600160a01b038316600090815260208190526040808220828155600181018390556002810183905560030180546001600160a01b031916905551339183156108fc02918491818181858888f193505050501580156108a8573d6000803e3d6000fd5b50336001600160a01b0316836001600160a01b03167fb7c918e0e249f999e965cafeb6c664271b3f4317d296461500e71da39f0cbda3836040516108ec9190610f48565b60405180910390a3505050565b610901610a29565b506001600160a01b0390811660009081526020818152604091829020825160808101845281548152600182015492810192909252600281015492820192909252600390910154909116606082015290565b6001600160a01b038316600090815260208181526040808320805460018083015460028401549186528487203388529095529285205491939087118015939187111592911591600019149084906109a65750825b80156109af5750815b80156109b85750805b955050505050505b9392505050565b6000828211156109e95760405162461bcd60e51b815260040161024c90610e9a565b508082035b92915050565b6000808211610a155760405162461bcd60e51b815260040161024c90610eba565b6000828481610a2057fe5b04949350505050565b604051806080016040528060008152602001600081526020016000815260200160006001600160a01b031681525090565b80356109ee81610fd7565b80356109ee81610fee565b600060208284031215610a8257600080fd5b6000610a8e8484610a5a565b949350505050565b60008060408385031215610aa957600080fd5b6000610ab58585610a5a565b9250506020610ac685828601610a5a565b9150509250929050565b600080600060608486031215610ae557600080fd5b6000610af18686610a5a565b9350506020610b0286828701610a5a565b9250506040610b1386828701610a65565b9150509250925092565b60008060408385031215610b3057600080fd5b6000610b3c8585610a5a565b9250506020610ac685828601610a65565b600080600060608486031215610b6257600080fd5b6000610b6e8686610a5a565b9350506020610b0286828701610a65565b610b8881610fb8565b82525050565b610b8881610fc3565b6000610ba4600f83610faf565b6e616c72656164792070656e64696e6760881b815260200192915050565b6000610bcf601583610faf565b745769746864726177616c206973206e6f742064756560581b815260200192915050565b6000610c00601e83610faf565b7f536166654d6174683a207375627472616374696f6e206f766572666c6f770000815260200192915050565b6000610c39601983610faf565b7f68756220617574686f72697a6174696f6e206578706972656400000000000000815260200192915050565b6000610c72601a83610faf565b7f536166654d6174683a206469766973696f6e206279207a65726f000000000000815260200192915050565b6000610cab602083610faf565b7f756e7374616b6544656c61792063616e6e6f7420626520646563726561736564815260200192915050565b6000610ce4601f83610faf565b7f73656e64657220697320612072656c61794d616e6167657220697473656c6600815260200192915050565b6000610d1d601283610faf565b711a1d58881b9bdd08185d5d1a1bdc9a5e995960721b815260200192915050565b6000610d4b601b83610faf565b7f5769746864726177616c206973206e6f74207363686564756c65640000000000815260200192915050565b6000610d84601583610faf565b7470656e616c74792065786365656473207374616b6560581b815260200192915050565b6000610db5602483610faf565b7f72656c61794d616e616765722063616e6e6f74207374616b6520666f7220697481526339b2b63360e11b602082015260400192915050565b6000610dfb600983610faf565b683737ba1037bbb732b960b91b815260200192915050565b80516080830190610e248482610e63565b506020820151610e376020850182610e63565b506040820151610e4a6040850182610e63565b506060820151610e5d6060850182610b7f565b50505050565b610b8881610fd4565b602081016109ee8284610b8e565b602080825281016109ee81610b97565b602080825281016109ee81610bc2565b602080825281016109ee81610bf3565b602080825281016109ee81610c2c565b602080825281016109ee81610c65565b602080825281016109ee81610c9e565b602080825281016109ee81610cd7565b602080825281016109ee81610d10565b602080825281016109ee81610d3e565b602080825281016109ee81610d77565b602080825281016109ee81610da8565b602080825281016109ee81610dee565b608081016109ee8284610e13565b602081016109ee8284610e63565b60408101610f648285610e63565b6109c06020830184610e63565b60808101610f7f8287610e63565b610f8c6020830186610e63565b610f996040830185610e63565b610fa66060830184610b7f565b95945050505050565b90815260200190565b60006109ee82610fc8565b151590565b6001600160a01b031690565b90565b610fe081610fb8565b8114610feb57600080fd5b50565b610fe081610fd456fea365627a7a72315820ad6aee119ff1f6feb05bc2aa095adb898068a778727bb62b9e68f0cc9e919a756c6578706572696d656e74616cf564736f6c63430005100040",
  },
  penalizer: {
    abi: [
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "bytes",
            "name": "unsignedTx1",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "signature1",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "unsignedTx2",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "signature2",
            "type": "bytes"
          },
          {
            "internalType": "contract IRelayHub",
            "name": "hub",
            "type": "address"
          }
        ],
        "name": "penalizeRepeatedNonce",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "bytes",
            "name": "unsignedTx",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "internalType": "contract IRelayHub",
            "name": "hub",
            "type": "address"
          }
        ],
        "name": "penalizeIllegalTransaction",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    bytecode: "0x608060405234801561001057600080fd5b50610feb806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806339ee150a1461003b578063f913fe3e14610050575b600080fd5b61004e610049366004610af2565b610063565b005b61004e61005e366004610a1e565b610155565b61006b610966565b610074846102df565b9050816001600160a01b031681606001516001600160a01b031614156100e15760006100a38260a0015161031a565b90506001600160e01b0319811663026e260f60e21b14156100df5760405162461bcd60e51b81526004016100d690610e2d565b60405180910390fd5b505b600061011c84866040516020016100f89190610d54565b6040516020818303038152906040528051906020012061032d90919063ffffffff16565b90506001600160a01b0381166101445760405162461bcd60e51b81526004016100d690610e8d565b61014e8184610409565b5050505050565b600061016c85876040516020016100f89190610d54565b9050600061018584866040516020016100f89190610d54565b9050806001600160a01b0316826001600160a01b0316146101b85760405162461bcd60e51b81526004016100d690610e5d565b6001600160a01b0382166101de5760405162461bcd60e51b81526004016100d690610e8d565b6101e6610966565b6101ef886102df565b90506101f9610966565b610202876102df565b80518351919250146102265760405162461bcd60e51b81526004016100d690610e4d565b60608260a0015183604001518460600151856080015160405160200161024f9493929190610d60565b604051602081830303815290604052905060608260a001518360400151846060015185608001516040516020016102899493929190610d60565b60405160208183030381529060405290508080519060200120828051906020012014156102c85760405162461bcd60e51b81526004016100d690610e6d565b6102d28688610409565b5050505050505050505050565b6102e7610966565b6102f08261046d565b60a087015260808601526001600160a01b031660608501526040840152602083015281525b919050565b6000610327826000610527565b92915050565b6000815160411461034057506000610327565b60208201516040830151606084015160001a7f7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a08211156103865760009350505050610327565b8060ff16601b1415801561039e57508060ff16601c14155b156103af5760009350505050610327565b600186828585604051600081526020016040526040516103d29493929190610dbf565b6020604051602081039080840390855afa1580156103f4573d6000803e3d6000fd5b5050604051601f190151979650505050505050565b604051633af34c6b60e21b81526001600160a01b0382169063ebcd31ac906104379085903390600401610da4565b600060405180830381600087803b15801561045157600080fd5b505af1158015610465573d6000803e3d6000fd5b505050505050565b600080600080600060608061048961048489610560565b6105a5565b90506104a88160008151811061049b57fe5b6020026020010151610685565b6104b88260018151811061049b57fe5b6104c88360028151811061049b57fe5b6104e5846003815181106104d857fe5b60200260200101516106b3565b6104f58560048151811061049b57fe5b6105128660058151811061050557fe5b60200260200101516106e3565b949d939c50919a509850965090945092505050565b6000816004018351101561054d5761054d6105486003855185600401610750565b6107ab565b5001602001516001600160e01b03191690565b6105686109a5565b815161058857506040805180820190915260008082526020820152610315565b506040805180820190915281518152602082810190820152919050565b60606105b0826107b3565b6105cc5760405162461bcd60e51b81526004016100d690610e7d565b60006105d7836107df565b90508060405190808252806020026020018201604052801561061357816020015b6106006109a5565b8152602001906001900390816105f85790505b5091506000610625846020015161082c565b60208501510190506000805b8381101561067c5761064283610895565b915060405180604001604052808381526020018481525085828151811061066557fe5b602090810291909101015291810191600101610631565b50505050919050565b600080610695836020015161082c565b83516020948501518201519190039093036101000a90920492915050565b60006015826000015111156106da5760405162461bcd60e51b81526004016100d690610e3d565b61032782610685565b606060006106f4836020015161082c565b83516040805191839003808352601f19601f820116830160200190915291925060609082801561072b576020820181803883390190505b5090506000816020019050610747848760200151018285610925565b50949350505050565b6060632800659560e01b84848460405160240161076f93929190610dfd565b60408051601f198184030181529190526020810180516001600160e01b03166001600160e01b03199093169290921790915290505b9392505050565b805160208201fd5b6020810151805160009190821a9060c08210156107d557600092505050610315565b5060019392505050565b6000806000905060006107f5846020015161082c565b602085015185519181019250015b808210156108235761081482610895565b60019093019290910190610803565b50909392505050565b8051600090811a6080811015610846576000915050610315565b60b8811080610861575060c08110801590610861575060f881105b15610870576001915050610315565b60c08110156108845760b519019050610315565b60f519019050610315565b50919050565b8051600090811a60808110156108af576001915050610315565b60b88110156108c357607e19019050610315565b60c08110156108f05760b78103600184019350806020036101000a8451046001820181019350505061088f565b60f88110156109045760be19019050610315565b60019290920151602083900360f7016101000a900490910160f51901919050565b5b60208110610945578251825260209283019290910190601f1901610926565b915181516020939093036101000a6000190180199091169216919091179052565b6040518060c0016040528060008152602001600081526020016000815260200160006001600160a01b0316815260200160008152602001606081525090565b604051806040016040528060008152602001600081525090565b600082601f8301126109d057600080fd5b81356109e36109de82610ec4565b610e9d565b915080825260208301602083018583830111156109ff57600080fd5b610a0a838284610f39565b50505092915050565b803561032781610f94565b600080600080600060a08688031215610a3657600080fd5b853567ffffffffffffffff811115610a4d57600080fd5b610a59888289016109bf565b955050602086013567ffffffffffffffff811115610a7657600080fd5b610a82888289016109bf565b945050604086013567ffffffffffffffff811115610a9f57600080fd5b610aab888289016109bf565b935050606086013567ffffffffffffffff811115610ac857600080fd5b610ad4888289016109bf565b9250506080610ae588828901610a13565b9150509295509295909350565b600080600060608486031215610b0757600080fd5b833567ffffffffffffffff811115610b1e57600080fd5b610b2a868287016109bf565b935050602084013567ffffffffffffffff811115610b4757600080fd5b610b53868287016109bf565b9250506040610b6486828701610a13565b9150509250925092565b610b7781610ef9565b82525050565b610b77610b8982610ef9565b610f75565b610b7781610f04565b6000610ba282610eec565b610bac8185610315565b9350610bbc818560208601610f45565b9290920192915050565b610b7781610f2e565b6000610bdc601783610ef0565b7f4c6567616c2072656c6179207472616e73616374696f6e000000000000000000815260200192915050565b6000610c15603a83610ef0565b7f496e76616c696420524c504974656d2e2041646472657373657320617265206581527f6e636f64656420696e203230206279746573206f72206c657373000000000000602082015260400192915050565b6000610c74600f83610ef0565b6e446966666572656e74206e6f6e636560881b815260200192915050565b6000610c9f601083610ef0565b6f2234b33332b932b73a1039b4b3b732b960811b815260200192915050565b6000610ccb600b83610ef0565b6a1d1e081a5cc8195c5d585b60aa1b815260200192915050565b6000610cf2600d83610ef0565b6c1a5cd31a5cdd0819985a5b1959609a1b815260200192915050565b6000610d1b601083610ef0565b6f1958dc9958dbdd995c8819985a5b195960821b815260200192915050565b610b77610d4682610f04565b610f04565b610b7781610f28565b60006107a48284610b97565b6000610d6c8287610b97565b9150610d788286610d3a565b602082019150610d888285610b7d565b601482019150610d988284610d3a565b50602001949350505050565b60408101610db28285610b6e565b6107a46020830184610b6e565b60808101610dcd8287610b8e565b610dda6020830186610d4b565b610de76040830185610b8e565b610df46060830184610b8e565b95945050505050565b60608101610e0b8286610bc6565b610e186020830185610b8e565b610e256040830184610b8e565b949350505050565b6020808252810161032781610bcf565b6020808252810161032781610c08565b6020808252810161032781610c67565b6020808252810161032781610c92565b6020808252810161032781610cbe565b6020808252810161032781610ce5565b6020808252810161032781610d0e565b60405181810167ffffffffffffffff81118282101715610ebc57600080fd5b604052919050565b600067ffffffffffffffff821115610edb57600080fd5b506020601f91909101601f19160190565b5190565b90815260200190565b600061032782610f1c565b90565b600061032782610ef9565b8061031581610f87565b6001600160a01b031690565b60ff1690565b600061032782610f12565b82818337506000910152565b60005b83811015610f60578181015183820152602001610f48565b83811115610f6f576000848401525b50505050565b60006103278260006103278260601b90565b60088110610f9157fe5b50565b610f9d81610f07565b8114610f9157600080fdfea365627a7a72315820fd42bc5cee1b71dada7d07307f0e39a6f0297a39496370d282f9c04d3f399ec86c6578706572696d656e74616cf564736f6c63430005100040",
  },
  paymaster: {
    abi: [
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "previousOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bool",
            "name": "success",
            "type": "bool"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "actualCharge",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "preRetVal",
            "type": "bytes32"
          }
        ],
        "name": "SampleRecipientPostCall",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "SampleRecipientPreCall",
        "type": "event"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getGasLimits",
        "outputs": [
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "acceptRelayedCallGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "preRelayedCallGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "postRelayedCallGasLimit",
                "type": "uint256"
              }
            ],
            "internalType": "struct GSNTypes.GasLimits",
            "name": "limits",
            "type": "tuple"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getHubAddr",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getRelayHubDeposit",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "isOwner",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "contract IRelayHub",
            "name": "hub",
            "type": "address"
          }
        ],
        "name": "setRelayHub",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "address payable",
            "name": "target",
            "type": "address"
          }
        ],
        "name": "withdrawRelayHubDepositTo",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "target",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "encodedFunction",
                "type": "bytes"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "gasLimit",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "gasPrice",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "pctRelayFee",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "baseRelayFee",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct GSNTypes.GasData",
                "name": "gasData",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "senderAddress",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "senderNonce",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address",
                    "name": "relayWorker",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "paymaster",
                    "type": "address"
                  }
                ],
                "internalType": "struct GSNTypes.RelayData",
                "name": "relayData",
                "type": "tuple"
              }
            ],
            "internalType": "struct GSNTypes.RelayRequest",
            "name": "relayRequest",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "approvalData",
            "type": "bytes"
          },
          {
            "internalType": "uint256",
            "name": "maxPossibleCharge",
            "type": "uint256"
          }
        ],
        "name": "acceptRelayedCall",
        "outputs": [
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "bytes",
            "name": "context",
            "type": "bytes"
          }
        ],
        "name": "preRelayedCall",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "bytes",
            "name": "context",
            "type": "bytes"
          },
          {
            "internalType": "bool",
            "name": "success",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "preRetVal",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "gasUseWithoutPost",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "gasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "gasPrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "pctRelayFee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseRelayFee",
                "type": "uint256"
              }
            ],
            "internalType": "struct GSNTypes.GasData",
            "name": "gasData",
            "type": "tuple"
          }
        ],
        "name": "postRelayedCall",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "contract IRelayHub",
            "name": "_relayHub",
            "type": "address"
          }
        ],
        "name": "setHub",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "deposit",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "internalType": "address payable",
            "name": "destination",
            "type": "address"
          }
        ],
        "name": "withdraw",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    bytecode: "0x60806040819052600080546001600160a01b03191633178082556001600160a01b0316917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0908290a3610e04806100576000396000f3fe6080604052600436106100e85760003560e01c80637bb052641161008a578063b1ed031f11610059578063b1ed031f1461024a578063d0e30db014610277578063f2fde38b1461027f578063fbfbd0f21461029f576100e8565b80637bb05264146101d357806380274db7146101f35780638da5cb5b146102135780638f32d59b14610228576100e8565b806351cff8d9116100c657806351cff8d91461015a5780635ea54eee1461017a578063715018a61461019c57806374e861d6146101b1576100e8565b80632afe31c1146100ed5780632d14c4b71461011857806331962cdc1461013a575b600080fd5b3480156100f957600080fd5b506101026102bf565b60405161010f9190610c96565b60405180910390f35b34801561012457600080fd5b50610138610133366004610a7f565b610345565b005b34801561014657600080fd5b506101386101553660046109c2565b6103d8565b34801561016657600080fd5b506101386101753660046108d2565b6103fa565b34801561018657600080fd5b5061018f6104d4565b60405161010f9190610cfc565b3480156101a857600080fd5b50610138610504565b3480156101bd57600080fd5b506101c6610572565b60405161010f9190610c52565b3480156101df57600080fd5b506101386101ee3660046109c2565b610581565b3480156101ff57600080fd5b5061010261020e3660046108f0565b6105a5565b34801561021f57600080fd5b506101c6610614565b34801561023457600080fd5b5061023d610623565b60405161010f9190610c60565b34801561025657600080fd5b5061026a6102653660046109e0565b610634565b60405161010f9190610ca4565b61013861064c565b34801561028b57600080fd5b5061013861029a3660046108d2565b6106da565b3480156102ab57600080fd5b506101386102ba366004610932565b61070a565b6001546040516370a0823160e01b81526000916001600160a01b0316906370a08231906102f0903090600401610c52565b60206040518083038186803b15801561030857600080fd5b505afa15801561031c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506103409190810190610a61565b905090565b61034d610623565b6103725760405162461bcd60e51b815260040161036990610cec565b60405180910390fd5b600154604051627b8a6760e11b81526001600160a01b039091169062f714ce906103a29085908590600401610d0a565b600060405180830381600087803b1580156103bc57600080fd5b505af11580156103d0573d6000803e3d6000fd5b505050505050565b600180546001600160a01b0319166001600160a01b0392909216919091179055565b6001546001600160a01b03166104225760405162461bcd60e51b815260040161036990610ccc565b6001546040516370a0823160e01b81526000916001600160a01b0316906370a0823190610453903090600401610c52565b60206040518083038186803b15801561046b57600080fd5b505afa15801561047f573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052506104a39190810190610a61565b600154604051627b8a6760e11b81529192506001600160a01b03169062f714ce906103a29084908690600401610d0a565b6104dc610806565b604051806060016040528061c3508152602001620186a081526020016201adb0815250905090565b61050c610623565b6105285760405162461bcd60e51b815260040161036990610cec565b600080546040516001600160a01b03909116907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0908390a3600080546001600160a01b0319169055565b6001546001600160a01b031690565b610589610623565b6103d85760405162461bcd60e51b815260040161036990610cec565b60006105af610572565b6001600160a01b0316336001600160a01b0316146105df5760405162461bcd60e51b815260040161036990610cdc565b6040517fa8c41f12bf21d07540a32ccb08bbc931778b2943d4747381c9466041b89d7d7a90600090a1506201e2405b92915050565b6000546001600160a01b031690565b6000546001600160a01b0316331490565b6040805160208101909152600081525b949350505050565b6001546001600160a01b03166106745760405162461bcd60e51b815260040161036990610ccc565b60015460405163aa67c91960e01b81526001600160a01b039091169063aa67c9199034906106a6903090600401610c52565b6000604051808303818588803b1580156106bf57600080fd5b505af11580156106d3573d6000803e3d6000fd5b5050505050565b6106e2610623565b6106fe5760405162461bcd60e51b815260040161036990610cec565b61070781610785565b50565b610712610572565b6001600160a01b0316336001600160a01b0316146107425760405162461bcd60e51b815260040161036990610cdc565b7fa7bfa667d3f07cf49566974fc7f95aa504a60efff5ca1e7ad5470c2b507fad1e84838560405161077593929190610c6e565b60405180910390a1505050505050565b6001600160a01b0381166107ab5760405162461bcd60e51b815260040161036990610cbc565b600080546040516001600160a01b03808516939216917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e091a3600080546001600160a01b0319166001600160a01b0392909216919091179055565b60405180606001604052806000815260200160008152602001600081525090565b803561060e81610d92565b803561060e81610da6565b803561060e81610daf565b60008083601f84011261085a57600080fd5b50813567ffffffffffffffff81111561087257600080fd5b60208301915083600182028301111561088a57600080fd5b9250929050565b803561060e81610db8565b6000608082840312156108ae57600080fd5b50919050565b600061014082840312156108ae57600080fd5b805161060e81610daf565b6000602082840312156108e457600080fd5b60006106448484610827565b6000806020838503121561090357600080fd5b823567ffffffffffffffff81111561091a57600080fd5b61092685828601610848565b92509250509250929050565b600080600080600080610100878903121561094c57600080fd5b863567ffffffffffffffff81111561096357600080fd5b61096f89828a01610848565b9650965050602061098289828a01610832565b945050604061099389828a0161083d565b93505060606109a489828a0161083d565b92505060806109b589828a0161089c565b9150509295509295509295565b6000602082840312156109d457600080fd5b60006106448484610891565b600080600080606085870312156109f657600080fd5b843567ffffffffffffffff811115610a0d57600080fd5b610a19878288016108b4565b945050602085013567ffffffffffffffff811115610a3657600080fd5b610a4287828801610848565b93509350506040610a558782880161083d565b91505092959194509250565b600060208284031215610a7357600080fd5b600061064484846108c7565b60008060408385031215610a9257600080fd5b6000610a9e858561083d565b9250506020610aaf85828601610827565b9150509250929050565b610ac281610d32565b82525050565b610ac281610d3d565b610ac281610d42565b6000610ae582610d25565b610aef8185610d29565b9350610aff818560208601610d5c565b610b0881610d88565b9093019392505050565b6000610b1f602683610d29565b7f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206181526564647265737360d01b602082015260400192915050565b6000610b67601983610d29565b7f72656c6179206875622061646472657373206e6f742073657400000000000000815260200192915050565b6000610ba0602783610d29565b7f46756e6374696f6e2063616e206f6e6c792062652063616c6c6564206279205281526632b630bca43ab160c91b602082015260400192915050565b6000610be9602083610d29565b7f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e6572815260200192915050565b80516060830190610c268482610ad1565b506020820151610c396020850182610ad1565b506040820151610c4c6040850182610ad1565b50505050565b6020810161060e8284610ab9565b6020810161060e8284610ac8565b60608101610c7c8286610ac8565b610c896020830185610ad1565b6106446040830184610ad1565b6020810161060e8284610ad1565b60208082528101610cb58184610ada565b9392505050565b6020808252810161060e81610b12565b6020808252810161060e81610b5a565b6020808252810161060e81610b93565b6020808252810161060e81610bdc565b6060810161060e8284610c15565b60408101610d188285610ad1565b610cb56020830184610ab9565b5190565b90815260200190565b600061060e82610d50565b151590565b90565b600061060e82610d32565b6001600160a01b031690565b60005b83811015610d77578181015183820152602001610d5f565b83811115610c4c5750506000910152565b601f01601f191690565b610d9b81610d32565b811461070757600080fd5b610d9b81610d3d565b610d9b81610d42565b610d9b81610d4556fea365627a7a72315820976d45e4a1b7e69308f19689d69fb1d401a754aa6f97ff0a6072c9efd8fd51156c6578706572696d656e74616cf564736f6c63430005100040",
  }
}
