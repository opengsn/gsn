package librelay

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"flag"
	"fmt"
	"gen/librelay"
	"gen/samplerec"
	"log"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"

	"code.cloudfoundry.org/clock/fakeclock"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rpc"
)

type TestClient struct {
	*ethclient.Client

	RPC *rpc.Client
}

func NewTestClient(url string) (*TestClient, error) {
	rpcClient, err := rpc.DialContext(context.Background(), url)
	if err != nil {
		return nil, err
	}

	return &TestClient{
		ethclient.NewClient(rpcClient),
		rpcClient,
	}, nil
}

func (client *TestClient) AdjustTime(seconds uint64) error {
	return client.RPC.Call(nil, "evm_increaseTime", seconds)
}

func (client *TestClient) Commit() error {
	return client.RPC.Call(nil, "evm_mine")
}

func (client *TestClient) MineBlocks(n uint64) error {
	for ; n > 0; n-- {
		err := client.RPC.Call(nil, "evm_mine")
		if err != nil {
			return err
		}
	}
	return nil
}

func (client *TestClient) Snapshot() (uint64, error) {
	var result hexutil.Uint64
	err := client.RPC.Call(&result, "evm_snapshot")
	return uint64(result), err
}

func (client *TestClient) Revert(id uint64) error {
	return client.RPC.Call(nil, "evm_revert", id)
}

type TestServer struct {
	*relayServer
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
var relay TestServer
var client *TestClient
var relayKey1 *ecdsa.PrivateKey
var gaslessKey2 *ecdsa.PrivateKey
var ownerKey3 *ecdsa.PrivateKey
var rhub *librelay.RelayHub
var clk *fakeclock.FakeClock

var sampleRecipient common.Address
var rhaddr common.Address

var boundHub *bind.BoundContract
var boundRecipient *bind.BoundContract

var ethereumNodeURL = "http://localhost:8543"

func InitTestClient(url string) {
	relayKey1, _ = crypto.HexToECDSA("4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d")
	gaslessKey2, _ = crypto.HexToECDSA("6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1")
	ownerKey3, _ = crypto.HexToECDSA("6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c")

	fmt.Println("Test addresses:")
	fmt.Println("1. Relay  ", crypto.PubkeyToAddress(relayKey1.PublicKey).Hex())
	fmt.Println("2. Gasless", crypto.PubkeyToAddress(gaslessKey2.PublicKey).Hex())
	fmt.Println("3. Owner  ", crypto.PubkeyToAddress(ownerKey3.PublicKey).Hex())

	auth = bind.NewKeyedTransactor(relayKey1)
	var err error
	client, err = NewTestClient(url)
	if err != nil {
		log.Fatalf("Could not connect to local ganache: %v", err)
	}
	client.Commit()
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
	clk = fakeclock.NewFakeClock(time.Now())
	txStore := NewMemoryTxStore(clk)
	var err error
	relay.relayServer, err = NewRelayServer(
		common.Address{}, fee, url, port,
		relayHubAddress, stakeAmount, gasLimit, defaultGasPrice,
		gasPricePercent, relayKey1, unstakeDelay, registrationBlockRate,
		ethereumNodeURL, client, txStore, clk)
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

func ErrFailWithDesc(err error, t *testing.T, desc string) {
	if err != nil {
		t.Error(desc, err)
		t.FailNow()
	}
}

func TestMain(m *testing.M) {
	InitTestClient(ethereumNodeURL)
	rlpaddr, _, _, err := librelay.DeployRLPReader(auth, client)
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
	rhaddr, _, boundHub, err = bind.DeployContract(auth, parsed, common.FromHex(RelayHubBin), client)
	if err != nil {
		log.Fatalf("could not deploy contract: %v", err)
	}
	parsed, err = abi.JSON(strings.NewReader(samplerec.SampleRecipientABI))
	if err != nil {
		log.Fatalln(err)
	}
	auth.GasLimit = 3000000
	sampleRecipient, _, boundRecipient, err = bind.DeployContract(auth, parsed, common.FromHex(samplerec.SampleRecipientBin), client, rhaddr)
	if err != nil {
		log.Fatalln("Error deploying SampleRecipient contract:", err)
	}
	rhub, err = librelay.NewRelayHub(rhaddr, client)
	if err != nil {
		log.Fatalln(err)
	}
	fmt.Printf("RelayHub:  %s\nRLPreader: %s\nRecipient: %s\n", rhaddr.String(), rlpaddr.String(), sampleRecipient.String())
	NewRelay(rhaddr)

	tx, err := relay.sendStakeTransaction(ownerKey3)
	if err != nil {
		log.Fatalf("Could not 'sendStakeTransaction': %v", err)
	}
	client.Commit()
	err = relay.awaitTransactionMined(tx)
	if err != nil {
		log.Fatalln(err)
	}

	auth := bind.NewKeyedTransactor(ownerKey3)
	auth.Value = big.NewInt(1)
	auth.Value.Lsh(auth.Value, 40)

	tx, err = rhub.DepositFor(auth, sampleRecipient)
	client.Commit()
	if err != nil {
		log.Fatalln(err)
	}
	_, _ = client.TransactionReceipt(context.Background(), tx.Hash())

	callOpt := &bind.CallOpts{}
	toBalance, err := rhub.Balances(callOpt, sampleRecipient)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("To.balance: ", toBalance)

	fmt.Println("-----------------------------------------------------")
	flag.Parse()
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
	// Gas price is ganache default plus 10% specified in relay constructor
	if gasPriceAfter.Cmp(big.NewInt(1100)) != 0 {
		t.Error("Gas price after is", gasPriceAfter.Uint64())
	}
}

func TestRegisterRelay(t *testing.T) {
	staked, err := relay.IsStaked()
	if !staked {
		t.Error("Relay is not staked")
	}
	ErrFail(err, t)
	// TODO: Watch out for FLICKERING: attempt to AdjustTime ahead of machine clock will have no effect at all
	err = client.AdjustTime(50)
	client.Commit()
	tx, err := relay.sendRegisterTransaction()
	ErrFail(err, t)
	if err != nil {
		fmt.Println("ERROR", err)
	}
	client.Commit()
	ErrFail(relay.awaitTransactionMined(tx), t)
	when, err := relay.RegistrationDate()
	if err != nil {
		fmt.Println("ERROR", err)
	}
	if time.Now().Unix()-when > int64((1 * time.Minute).Seconds()) {
		t.Error("Wrong registration time/date", time.Now().Unix(), when)
	}
}

func printSignature(txb string, txFee int64, gasPrice int64, gasLimit int64, relayMaxNonce int64, recipientNonce int64) {
	fmt.Println("ganache-cli -d")
	fmt.Println("npx truffle console --network development")
	fmt.Println("const utils = require('../src/js/relayclient/utils')")
	fmt.Printf(
		"let hash = utils.getTransactionHash('%v', '%v', '%v', '%v', '%v', '%v', '%v', '%v', '%v')\n",
		crypto.PubkeyToAddress(gaslessKey2.PublicKey).Hex(), sampleRecipient.Hex(), txb, txFee, gasPrice, gasLimit, recipientNonce, rhaddr.Hex(), relay.Address().Hex(),
	)
	fmt.Printf("utils.getTransactionSignature(web3, '0xffcf8fdee72ac11b5c542428b35eef5769c409f0', hash)\n")
}

func TestCreateRelayTransaction(t *testing.T) {
	ErrFail(relay.RefreshGasPrice(), t)
	addressGasless := crypto.PubkeyToAddress(gaslessKey2.PublicKey)
	txb := "0x2ac0df260000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b68656c6c6f20776f726c64000000000000000000000000000000000000000000"
	txFee := int64(10)
	gasPrice := int64(2000)
	gasLimit := int64(1000000)
	relayMaxNonce := int64(1000000)
	recipientNonce := int64(0)
	printSignature(txb, txFee, gasPrice, gasLimit, relayMaxNonce, recipientNonce)
	sig := "0x1cc33268c3d5d937380f73e17b5f6e165b8a9be3f94805d2cb9a8120834684f5d538a4a0dd49d7b632b4d99fb0adc3344f914a4e865240da6f9bca86458d60406c"
	if sig[:2] == "0x" {
		sig = sig[2:]
	}

	request := RelayTransactionRequest{
		EncodedFunction: txb,
		Signature:       common.Hex2Bytes(sig),
		From:            addressGasless,
		To:              sampleRecipient,
		GasPrice:        *big.NewInt(gasPrice),
		GasLimit:        *big.NewInt(gasLimit),
		RecipientNonce:  *big.NewInt(recipientNonce),
		RelayMaxNonce:   *big.NewInt(relayMaxNonce),
		RelayFee:        *big.NewInt(txFee),
		RelayHubAddress: rhaddr,
	}
	signedTx, err := relay.CreateRelayTransaction(request)
	ErrFailWithDesc(err, t, "Creating relay transaction")
	client.Commit()
	receipt, _ := client.TransactionReceipt(context.Background(), signedTx.Hash())
	logsLen := len(receipt.Logs)
	expectedLogs := 3
	if logsLen != expectedLogs {
		t.Errorf("Incorrect logs len: expected %d, actual: %d", expectedLogs, logsLen)
	}
	transactionRelayedEvent := new(librelay.RelayHubTransactionRelayed)
	sampleRecipientEmitted := new(samplerec.SampleRecipientSampleRecipientEmitted)
	ErrFailWithDesc(boundHub.UnpackLog(transactionRelayedEvent, "TransactionRelayed", *receipt.Logs[2]), t, "Unpacking transaction relayed")

	ErrFailWithDesc(boundRecipient.UnpackLog(sampleRecipientEmitted, "SampleRecipientEmitted", *receipt.Logs[0]), t, "Unpacking sample recipient emitted")
	expectedMessage := "hello world"
	if sampleRecipientEmitted.Message != expectedMessage {
		t.Errorf("Message was not what expected! expected: %s actual: %s", expectedMessage, sampleRecipientEmitted.Message)
	}
}

func TestResendRelayTransaction(t *testing.T) {
	ErrFail(relay.RefreshGasPrice(), t)
	ErrFail(relay.TxStore.Clear(), t)

	txb := "0x2ac0df260000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b68656c6c6f20776f726c64000000000000000000000000000000000000000000"
	txFee := int64(10)
	gasPrice := int64(2000)
	gasLimit := int64(1000000)
	relayMaxNonce := int64(1000000)
	recipientNonce := int64(1)
	printSignature(txb, txFee, gasPrice, gasLimit, relayMaxNonce, recipientNonce)
	sig := "0x1b8bd923286fbcbd1a630f632f10fc98153d708a443781ca5eb0bc9f2db48b61f45ae2e9c21a8eaa73af41abfd62bf42a89ecfc7944c5864d411c7e4748bb43950"
	if sig[:2] == "0x" {
		sig = sig[2:]
	}

	request := RelayTransactionRequest{
		EncodedFunction: txb,
		Signature:       common.Hex2Bytes(sig),
		From:            crypto.PubkeyToAddress(gaslessKey2.PublicKey),
		To:              sampleRecipient,
		GasPrice:        *big.NewInt(gasPrice),
		GasLimit:        *big.NewInt(gasLimit),
		RecipientNonce:  *big.NewInt(recipientNonce),
		RelayMaxNonce:   *big.NewInt(relayMaxNonce),
		RelayFee:        *big.NewInt(txFee),
		RelayHubAddress: rhaddr,
	}

	// Send a transaction via the relay, but then revert to a previous snapshot
	snapshotID, err := client.Snapshot()
	ErrFailWithDesc(err, t, "Creating snapshot")

	signedTx, err := relay.CreateRelayTransaction(request)
	ErrFailWithDesc(err, t, "Creating relay transaction")

	err = client.Revert(snapshotID)
	ErrFailWithDesc(err, t, "Restoring snapshot")

	receipt, err := client.TransactionReceipt(context.Background(), signedTx.Hash())
	if err != ethereum.NotFound {
		t.Error("Transaction should not have been found", err)
	}

	// Should not do anything, as not enough time has passed
	clk.IncrementBySeconds(1 * 60)
	err = relay.UpdateUnconfirmedTransactions()
	ErrFailWithDesc(err, t, "Updating unconfirmed transactions")

	// Advance time
	clk.IncrementBySeconds(6 * 60)
	ErrFailWithDesc(relay.UpdateUnconfirmedTransactions(), t, "Updating unconfirmed transactions")

	loadedTx, err := relay.TxStore.GetFirstTransaction()
	ErrFailWithDesc(err, t, "Fetching first transaction from store")
	client.MineBlocks(2)
	time.Sleep(time.Second)
	receipt, err = client.TransactionReceipt(context.Background(), loadedTx.Hash())
	ErrFailWithDesc(err, t, fmt.Sprint("Retrieving tx receipt ", loadedTx.Hash().Hex()))

	logsLen := len(receipt.Logs)
	expectedLogs := 3
	if logsLen != expectedLogs {
		t.Errorf("Incorrect logs len: expected %d, actual: %d", expectedLogs, logsLen)
	}
	transactionRelayedEvent := new(librelay.RelayHubTransactionRelayed)
	sampleRecipientEmitted := new(samplerec.SampleRecipientSampleRecipientEmitted)
	ErrFailWithDesc(boundHub.UnpackLog(transactionRelayedEvent, "TransactionRelayed", *receipt.Logs[2]), t, "Unpacking transaction relayed")

	ErrFailWithDesc(boundRecipient.UnpackLog(sampleRecipientEmitted, "SampleRecipientEmitted", *receipt.Logs[0]), t, "Unpacking sample recipient emitted")
	expectedMessage := "hello world"
	if sampleRecipientEmitted.Message != expectedMessage {
		t.Errorf("Message was not what expected! expected: %s actual: %s", expectedMessage, sampleRecipientEmitted.Message)
	}
}
