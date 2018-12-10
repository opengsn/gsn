package librelay

import (
	"encoding/json"
	"fmt"
	"gen/librelay"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"log"
	"math/big"
	"os/exec"
	"testing"
)

// account 0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1
// privatekey 4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d
/* Right now we only deploy the contract and run ganache-cli, while we can run helloServer to listen to requests.
 */

const runGanache = false
const runTruffleMigrate = true

var relayHubAddress = common.HexToAddress("0x254dffcd3277c0b1660f6d42efbb754edababc2b") //0xe78a0f7e598cc8b0bb87894b0f60dd2a88d6a8ab

func TestRelayServer(t *testing.T) {

	fmt.Println("relay server test")

	if runGanache {
		err := exec.Command("ganache-cli", "-d").Start()
		if err != nil {
			log.Fatalln("Error running ganache-cli", err)
		}
		fmt.Println("Running ganache-cli")
	}

	/*
	* abigen seems to suffer the same issue of web3j - the generated bin of the contract contains unresolved libs and the api generated doesn't provide an option to link
	* between contracts.
	 */
	if runTruffleMigrate {
		err := exec.Command("truffle", "migrate").Run()
		if err != nil {
			log.Fatalln("Error running truffle migrate", err)
		}
		fmt.Println("Running truffle migrate")

	} else {
		// deploying RelayHub
		key, _ := crypto.HexToECDSA("4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d")
		//crypto.GenerateKey()
		auth := bind.NewKeyedTransactor(key)
		alloc := make(core.GenesisAlloc)
		alloc[auth.From] = core.GenesisAccount{Balance: big.NewInt(133700000)}
		//sim := backends.NewSimulatedBackend(alloc, 10000000)
		client, err := ethclient.Dial(ethereumNodeURL)
		if err != nil {
			fmt.Println("Could not connect to ethereum node", err)
			log.Fatal(err)
		}
		rlpaddr, _, _, err := librelay.DeployRLPReader(auth, client)
		if err != nil {
			log.Fatalf("could not deploy contract: %v", err)
		}
		// interact with contract
		fmt.Printf("RLPReader library deployed to %s\n", rlpaddr.String())
		// deploy contract
		rhaddr, _, rhub, err := librelay.DeployRelayHub(auth, client)
		if err != nil {
			log.Fatalf("could not deploy contract: %v", err)
		}
		// interact with contract
		fmt.Printf("RelayHub contract deployed to %s\n", rhaddr.String())
		rhub.PenalizeRepeatedNonce(auth, nil, nil, nil, nil)
	}

}

// TODO: hardcode known requests to test CreateRelayTransaction()
func TestRelayServer_CreateRelayTransaction(t *testing.T) {

	ownerAddress := common.HexToAddress("0x610bb1573d1046fcb8a70bbbd395754cd57c2b60")
	fee := big.NewInt(11)
	port := 8090
	url := "http://localhost:" + string(port)
	stakeAmount := big.NewInt(1000)
	gasLimit := uint64(100000)
	gasPrice := big.NewInt(100)
	privateKey, err := crypto.HexToECDSA("77c5495fbb039eed474fc940f29955ed0531693cc9212911efd35dff0373153f")
	if err != nil {
		log.Fatal(err)
	}
	unstakeDelay := big.NewInt(10)
	fmt.Println("Constructing relay server")
	var relay IRelay = &RelayServer{ownerAddress, fee, url, port,
		relayHubAddress, stakeAmount,
		gasLimit, gasPrice, privateKey, unstakeDelay}
	fmt.Println("Staking...")
	err = relay.Stake()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("1Done staking")

	fmt.Println("1Registering relay...")
	err = relay.RegisterRelay(common.HexToAddress("0"))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Done registering")

	body := []byte("{\"encodedFunction\": \"1\", \"signature\": [0,0,0,1,2,3], \"from\": \"0xa1b1c3d4e5a1b1c3d4e5a1b1c3d4e5a1b1c3d4e5\", " +
		"\"to\": \"0xb1b1c3d4e5a1b1c3d4e5a1b1c3d4e5a1b1c3d4e5\", \"gasPrice\":  1, \"gasLimit\": 1, \"recipientNonce\": 1, \"relayFee\":12}")
	var request = &RelayTransactionRequest{}
	err = json.Unmarshal(body, request)
	if err != nil {
		log.Println(err)
		return
	}
	fmt.Println("encodedFunction: " + request.EncodedFunction)
	fmt.Println("From: " + request.From.String())
	fmt.Println("To: " + request.To.String())
	fmt.Println("GasPrice: " + request.GasPrice.String())
	fmt.Println("GasLimit: " + request.GasLimit.String())
	fmt.Println("RecipientNonce: " + request.RecipientNonce.String())
	fmt.Println("RelayFee: " + request.RelayFee.String())
	fmt.Println("Signature: ", request.Signature)

	// TODO: create valid request
	//signedTx := relay.CreateRelayTransaction(*request)

}
