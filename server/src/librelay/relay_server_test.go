package librelay

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"gen/librelay"
	"gen/samplerec"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/accounts/abi/bind/backends"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	"log"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"
)

type FakeClient struct {
	*backends.SimulatedBackend
}

type TestServer struct {
	*relayServer
}

func (client *FakeClient) BlockByNumber(ctx context.Context, number *big.Int) (*types.Block, error) {
	log.Fatalf("could not deploy contract")
	return &types.Block{}, nil
}

func (client *FakeClient) HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error) {
	//log.Fatalf("could not deploy contract")
	return &types.Header{Time: big.NewInt(time.Now().Unix()), Number: big.NewInt(0)}, nil
}

func (client *FakeClient) TransactionByHash(ctx context.Context, txHash common.Hash) (tx *types.Transaction, isPending bool, err error) {
	log.Fatalf("could not deploy contract")
	return &types.Transaction{}, false, nil
}

func (client *FakeClient) NetworkID(ctx context.Context) (*big.Int, error) {
	return big.NewInt(0xdead), nil
}

func (relay *TestServer) Stake(ownerKey *ecdsa.PrivateKey) (err error) {
	tx, err := relay.sendStakeTransaction(ownerKey)
	if err != nil {
		return err
	}
	return relay.awaitTransactionMined(tx)
}

func (relay *TestServer) sendStakeTransaction(ownerKey *ecdsa.PrivateKey) (tx *types.Transaction, err error) {
	auth := bind.NewKeyedTransactor(ownerKey)
	auth.Value = relay.StakeAmount
	tx, err = relay.rhub.Stake(auth, relay.Address(), relay.UnstakeDelay)
	if err != nil {
		log.Println("rhub.stake() failed", relay.StakeAmount, relay.UnstakeDelay)
		return
	}
	log.Println("Stake() tx sent:", tx.Hash().Hex())
	return
}

func (relay *TestServer) Unstake(ownerKey *ecdsa.PrivateKey) (err error) {
	tx, err := relay.sendUnstakeTransaction(ownerKey)
	if err != nil {
		return err
	}
	return relay.awaitTransactionMined(tx)

}

func (relay *TestServer) sendUnstakeTransaction(ownerKey *ecdsa.PrivateKey) (tx *types.Transaction, err error) {
	auth := bind.NewKeyedTransactor(ownerKey)
	auth.Value = relay.StakeAmount
	tx, err = relay.rhub.Unstake(auth, relay.Address())
	if err != nil {
		log.Println("rhub.Unstake() failed", relay.StakeAmount, relay.UnstakeDelay)
		return
	}
	log.Println("Unstake() tx sent:", tx.Hash().Hex())
	return
}



var auth *bind.TransactOpts
var sim *FakeClient
var relay TestServer
var relayKey1 *ecdsa.PrivateKey
var gaslessKey2 *ecdsa.PrivateKey
var ownerKey3 *ecdsa.PrivateKey
var rhub *librelay.RelayHub

var sampleRecipient common.Address
var rhaddr common.Address

var boundHub *bind.BoundContract
var boundRecipient *bind.BoundContract

func NewSimBackend() {
	alloc := make(core.GenesisAlloc)
	relayKey1, _ = crypto.HexToECDSA("4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d")
	gaslessKey2, _ = crypto.HexToECDSA("6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1")
	ownerKey3, _ = crypto.HexToECDSA("6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c")
	auth = bind.NewKeyedTransactor(relayKey1)
	alloc[crypto.PubkeyToAddress(relayKey1.PublicKey)] = core.GenesisAccount{Balance: big.NewInt(2337000000000000000)}
	alloc[crypto.PubkeyToAddress(ownerKey3.PublicKey)] = core.GenesisAccount{Balance: big.NewInt(2337000000000000000)}
	sim = &FakeClient{}
	sim.SimulatedBackend = backends.NewSimulatedBackend(alloc, uint64(10000000))
}

func NewRelay(relayHubAddress common.Address) {
	fee := big.NewInt(10)
	stakeAmount := big.NewInt(1100000000000000000)
	gasLimit := uint64(1000000)
	defaultGasPrice := int64(params.GWei)
	gasPricePercent := big.NewInt(10)
	url := ""
	port := "8090"
	unstakeDelay := big.NewInt(0)
	registrationBlockRate := uint64(5)
	ethereumNodeUrl := ""
	var err error
	relay.relayServer, err = NewRelayServer(
		common.Address{}, fee, url, port,
		relayHubAddress, stakeAmount, gasLimit, defaultGasPrice,
		gasPricePercent, relayKey1, unstakeDelay, registrationBlockRate,
		ethereumNodeUrl, sim)
	if err != nil {
		log.Fatalln("Relay was not created", err)
	}
	return
}

func ErrFail(err error, t *testing.T) {
	if err != nil {
		t.Error(err)
		t.FailNow()
	}
}

func TestMain(m *testing.M) {
	NewSimBackend()
	rlpaddr, _, _, err := librelay.DeployRLPReader(auth, sim)
	if err != nil {
		log.Fatalf("could not deploy contract: %v", err)
	}
	/* No need to deploy it anymore
	tbkUtils, _, _, err := librelay.DeployRecipientUtils(auth, sim)
	if err != nil {
		log.Fatalf("could not deploy contract: %v", err)
	}
	*/
	parsed, err := abi.JSON(strings.NewReader(librelay.RelayHubABI))
	if err != nil {
		log.Fatalln(err)
	}


	// linking RlpReader to RelayHub
	RelayHubBin := resolveLibrary("../contracts/RLPReader.sol:RLPReader", rlpaddr, librelay.RelayHubBin)

	if _, err = hex.DecodeString(RelayHubBin[2:]); err != nil {
		log.Println("RelayHubBin", RelayHubBin)
		log.Fatalln("Invalid hex: RelayHubBin", err)
	}
	rhaddr, _, boundHub, err = bind.DeployContract(auth, parsed, common.FromHex(RelayHubBin), sim)
	if err != nil {
		log.Fatalf("could not deploy contract: %v", err)
	}
	parsed, err = abi.JSON(strings.NewReader(samplerec.SampleRecipientABI))
	if err != nil {
		log.Fatalln(err)
	}
	sampleRecipient, _, boundRecipient, err = bind.DeployContract(auth, parsed, common.FromHex(samplerec.SampleRecipientBin), sim, rhaddr)
	rhub, err = librelay.NewRelayHub(rhaddr, sim)
	if err != nil {
		log.Fatalln(err)
	}
	fmt.Printf("RelayHub: %s\nRLPreader: %s\nRecipient:%s\n", rhaddr.String(), rlpaddr.String(), sampleRecipient.String())
	NewRelay(rhaddr)

	if err != nil {
		log.Fatalf("could not 'AdjustTime': %v", err)
	}
	tx, err := relay.sendStakeTransaction(ownerKey3)
	if err != nil {
		log.Fatalf("could not 'sendStakeTransaction': %v", err)
	}
	sim.Commit()
	err = relay.awaitTransactionMined(tx)
	if err != nil {
		log.Fatalln(err)
	}

	auth := bind.NewKeyedTransactor(ownerKey3)
	auth.Value = big.NewInt(1000000000000)

	tx, err = rhub.DepositFor(auth, sampleRecipient)
	sim.Commit()
	if err != nil {
		log.Fatalln(err)
	}
	_, _ = sim.TransactionReceipt(context.Background(), tx.Hash())

	callOpt := &bind.CallOpts{}
	to_balance, err := rhub.Balances(callOpt, sampleRecipient)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("To.balance: ", to_balance)

	exitStatus := m.Run()
	defer os.Exit(exitStatus)

}

func resolveLibrary(path string, address common.Address, relayHubBinUnresolved string) string {
	libraryPlaceHolder := "__$" + hexutil.Encode(crypto.Keccak256([]byte(path)))[2:36] + "$__"
	RelayHubBin := strings.Replace(relayHubBinUnresolved, libraryPlaceHolder, address.Hex()[2:], -1)
	return RelayHubBin
}

func TestRefreshGasPrice(t *testing.T) {
	gasPriceBefore := relay.GasPrice()
	ErrFail(relay.RefreshGasPrice(), t)
	gasPriceAfter := relay.GasPrice()
	if gasPriceBefore.Cmp(big.NewInt(0)) != 0 {
		t.Error()
	}
	if gasPriceAfter.Cmp(big.NewInt(1)) != 0 {
		t.Error()
	}
}

func TestRegisterRelay(t *testing.T) {
	staked, err := relay.IsStaked()
	if !staked {
		t.Error("Relay is not staked")
	}
	ErrFail(err, t)
	// TODO: Watch out for FLICKERING: attempt to AdjustTime ahead of machine clock will have no effect at all
	duration := time.Since(time.Unix(50, 0))
	err = sim.AdjustTime(duration)
	sim.Commit()
	tx, err := relay.sendRegisterTransaction()
	ErrFail(err, t)
	if err != nil {
		fmt.Println("ERROR", err)
	}
	sim.Commit()
	ErrFail(relay.awaitTransactionMined(tx), t)
	when, err := relay.RegistrationDate()
	if err != nil {
		fmt.Println("ERROR", err)
	}
	if time.Now().Unix()-when > int64((1 * time.Minute).Seconds()) {
		t.Error("Wrong registration time/date", time.Now().Unix(), when)
	}
}

// TODO: watch out! Pre-calculated signature. Test will fail if contract addresses change, etc.
// In order to recalculate the signature:
// run `truffle console`
// run `const utils = require('../src/js/relayclient/utils')`
// run `a = utils.getTransactionHash()` with the parameters given to RelayTransactionRequest
// run `utils.getTransactionSignature(web3, "0xffcf8fdee72ac11b5c542428b35eef5769c409f0", a)`
func TestCreateRelayTransaction(t *testing.T) {
	ErrFail(relay.RefreshGasPrice(), t)
	txb := "0x2ac0df260000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b68656c6c6f20776f726c64000000000000000000000000000000000000000000"
	// if you need to deploy another contract some day, this will be the signature
	// sig := "1b168afc361ea8ff90d33c849c1b38eca9a49eb13b6c7a1483a3a063380ea037c460f80f04b14b20eb102f150b45148eb8ba4636eb2c14e47e69be54560daefea8"
	sig := "1cc9283cc494c533a92cc67fca991153a59cd91aa23b3e85e44a1cb0186e6ee6802768e88323da886ef50d6c419fe415fedac97b7e45e3cb0476b32d6b0096410f"
	addressGasless := crypto.PubkeyToAddress(gaslessKey2.PublicKey)
	request := RelayTransactionRequest{
		EncodedFunction: txb,
		Signature:       common.Hex2Bytes(sig),
		From:            addressGasless,
		To:              sampleRecipient,
		GasPrice:        *big.NewInt(10),
		GasLimit:        *big.NewInt(1000000),
		RecipientNonce:  *big.NewInt(0),
		RelayMaxNonce:   *big.NewInt(1000000),
		RelayFee:        *big.NewInt(10),
		RelayHubAddress: rhaddr,
	}
	signedTx, err := relay.CreateRelayTransaction(request)
	ErrFail(err, t)
	sim.Commit()
	receipt, _ := sim.TransactionReceipt(context.Background(), signedTx.Hash())
	println(signedTx.Hash().String(), receipt)
	logsLen := len(receipt.Logs)
	expectedLogs := 3
	if logsLen != expectedLogs {
		t.Errorf("Incorrect logs len: expected %d, actual: %d", expectedLogs, logsLen)
	}
	transactionRelayedEvent := new(librelay.RelayHubTransactionRelayed)
	sampleRecipientEmitted := new(samplerec.SampleRecipientSampleRecipientEmitted)
	ErrFail(boundHub.UnpackLog(transactionRelayedEvent, "TransactionRelayed", *receipt.Logs[2]), t)

	ErrFail(boundRecipient.UnpackLog(sampleRecipientEmitted, "SampleRecipientEmitted", *receipt.Logs[0]), t)
	expectedMessage := "hello world"
	if sampleRecipientEmitted.Message != expectedMessage {
		t.Errorf("Message was not what expected! expected: %s actual: %s", expectedMessage, sampleRecipientEmitted.Message)
	}
}
