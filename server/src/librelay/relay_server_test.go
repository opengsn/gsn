package librelay

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"flag"
	"fmt"
	"gen/librelay"
	"gen/samplerec"
	"librelay/test"
	"librelay/txstore"
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
	*RelayServer
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
	unstakeDelay := big.NewInt(3600 * 24 * 7)
	registrationBlockRate := uint64(5)
	clk = fakeclock.NewFakeClock(time.Now())
	txStore := txstore.NewMemoryTxStore(clk)
	var err error
	relay.RelayServer, err = NewRelayServer(
		common.Address{}, fee, url, port,
		relayHubAddress, stakeAmount, gasLimit, defaultGasPrice,
		gasPricePercent, relayKey1, unstakeDelay, registrationBlockRate,
		ethereumNodeURL, client, txStore, clk)
	if err != nil {
		log.Fatalln("Relay was not created", err)
	}
	return
}

func TestMain(m *testing.M) {
	InitTestClient(ethereumNodeURL)
	parsed, err := abi.JSON(strings.NewReader(librelay.RelayHubABI))
	if err != nil {
		log.Fatalln(err)
	}

	// linking RlpReader to RelayHub
	RelayHubBin := librelay.RelayHubBin

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
	fmt.Printf("RelayHub:  %s\nRecipient: %s\n", rhaddr.String(), sampleRecipient.String())
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
	test.ErrFail(relay.RefreshGasPrice(), t)
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
	test.ErrFail(err, t)
	// TODO: Watch out for FLICKERING: attempt to AdjustTime ahead of machine clock will have no effect at all
	err = client.AdjustTime(50)
	client.Commit()
	tx, err := relay.sendRegisterTransaction()
	test.ErrFail(err, t)
	if err != nil {
		fmt.Println("ERROR", err)
	}
	client.Commit()
	test.ErrFail(relay.awaitTransactionMined(tx), t)
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

func newRelayTransactionRequest(t *testing.T, recipientNonce int64, signature string) (request RelayTransactionRequest) {
	test.ErrFail(relay.RefreshGasPrice(), t)
	addressGasless := crypto.PubkeyToAddress(gaslessKey2.PublicKey)
	txb := "0x2ac0df260000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b68656c6c6f20776f726c64000000000000000000000000000000000000000000"
	txFee := int64(10)
	gasPrice := int64(2000)
	gasLimit := int64(1000000)
	relayMaxNonce := int64(1000000)
	if signature[:2] == "0x" {
		signature = signature[2:]
	}

	// Uncomment the following line to print the commands to generate the signature that needs to be injected
	// printSignature(txb, txFee, gasPrice, gasLimit, relayMaxNonce, recipientNonce)

	return RelayTransactionRequest{
		EncodedFunction: txb,
		ApprovalData:		 common.Hex2Bytes(""),
		Signature:       common.Hex2Bytes(signature),
		From:            addressGasless,
		To:              sampleRecipient,
		GasPrice:        *big.NewInt(gasPrice),
		GasLimit:        *big.NewInt(gasLimit),
		RecipientNonce:  *big.NewInt(recipientNonce),
		RelayMaxNonce:   *big.NewInt(relayMaxNonce),
		RelayFee:        *big.NewInt(txFee),
		RelayHubAddress: rhaddr,
	}
}

func assertTransactionRelayed(t *testing.T, txHash common.Hash) (receipt *types.Receipt) {
	receipt, err := client.TransactionReceipt(context.Background(), txHash)
	test.ErrFailWithDesc(err, t, fmt.Sprint("Fetching transaction receipt for hash ", txHash.Hex()))
	logsLen := len(receipt.Logs)
	expectedLogs := 4
	if logsLen != expectedLogs {
		t.Errorf("Incorrect logs len: expected %d, actual: %d", expectedLogs, logsLen)
	}
	transactionRelayedEvent := new(librelay.RelayHubTransactionRelayed)
	sampleRecipientEmitted := new(samplerec.SampleRecipientSampleRecipientEmitted)
	preRelayedEmitted := new(samplerec.SampleRecipientSampleRecipientPreCall)
	postRelayedEmitted := new(samplerec.SampleRecipientSampleRecipientPostCall)
	test.ErrFailWithDesc(boundRecipient.UnpackLog(preRelayedEmitted, "SampleRecipientPreCall", *receipt.Logs[0]), t, "Unpacking SampleRecipientPreCall")
	test.ErrFailWithDesc(boundRecipient.UnpackLog(sampleRecipientEmitted, "SampleRecipientEmitted", *receipt.Logs[1]), t, "Unpacking sample recipient emitted")
	test.ErrFailWithDesc(boundRecipient.UnpackLog(postRelayedEmitted, "SampleRecipientPostCall", *receipt.Logs[2]), t, "Unpacking SampleRecipientPostCall")
	test.ErrFailWithDesc(boundHub.UnpackLog(transactionRelayedEvent, "TransactionRelayed", *receipt.Logs[3]), t, "Unpacking transaction relayed")

	expectedMessage := "hello world"
	if sampleRecipientEmitted.Message != expectedMessage {
		t.Errorf("Message was not what expected! expected: %s actual: %s", expectedMessage, sampleRecipientEmitted.Message)
	}
	return receipt
}

func assertRelayNonce(t *testing.T, expected uint64) {
	nonce, err := client.NonceAt(context.Background(), relay.Address(), nil)
	if nonce != expected || err != nil {
		t.Errorf("Relay nonce is %v but expected %v (error %v)", nonce, expected, err)
	}
}

func assertNoTransactionResent(t *testing.T, relay *RelayServer) {
	noTx, err := relay.UpdateUnconfirmedTransactions()
	test.ErrFailWithDesc(err, t, "Updating unconfirmed transactions")
	if noTx != nil {
		t.Errorf("Expected no tx to be resent upon updating unconfirmed txs, but %v with nonce %v was resent", noTx.Hash().Hex(), noTx.Nonce())
	}
}

func TestCreateRelayTransaction(t *testing.T) {
	request := newRelayTransactionRequest(t, 0, "0x8d48d0f3416480011e4556d3dfbb4ef534632a2936b4169fc134fa17403693df354e888558439101e4fdec242acad39b2bd6d6a927842b9f311eba822a5b3d501b")
	signedTx, err := relay.CreateRelayTransaction(request)
	test.ErrFailWithDesc(err, t, "Creating relay transaction")
	client.Commit()
	assertTransactionRelayed(t, signedTx.Hash())
}

func TestResendRelayTransaction(t *testing.T) {
	test.ErrFail(relay.TxStore.Clear(), t)
	request := newRelayTransactionRequest(t, 1, "0x5f94ad28a24e38262824f47c6d329796886d7b282c6482e62a646b18aa9eb5ba6ec14cd6cd24463e2799c225c44b58bd84b66e314902d0c409b58c3e3e77d06b1c")

	// Send a transaction via the relay, but then revert to a previous snapshot
	snapshotID, err := client.Snapshot()
	test.ErrFailWithDesc(err, t, "Creating snapshot")
	signedTx, err := relay.CreateRelayTransaction(request)
	test.ErrFailWithDesc(err, t, "Creating relay transaction")
	err = client.Revert(snapshotID)
	test.ErrFailWithDesc(err, t, "Restoring snapshot")

	// Ensure tx is removed by the revert
	_, err = client.TransactionReceipt(context.Background(), signedTx.Hash())
	if err != ethereum.NotFound {
		t.Errorf("Transaction %v should not have been found (error %v)", signedTx.Hash().Hex(), err)
	}

	// Should not do anything, as not enough time has passed
	clk.IncrementBySeconds(1 * 60)
	assertNoTransactionResent(t, relay.RelayServer)
	sameTx, err := relay.TxStore.GetFirstTransaction()
	if sameTx.Hash() != signedTx.Hash() {
		t.Errorf("Transaction should not have been resent if less than 5 minutes passed: original tx %v but loaded from store was %v", signedTx.Hash().Hex(), sameTx.Hash().Hex())
	}
	_, err = client.TransactionReceipt(context.Background(), sameTx.Hash())
	if err != ethereum.NotFound {
		t.Errorf("Transaction %v should not have been found (error %v)", sameTx.Hash().Hex(), err)
	}

	// Advance time
	clk.IncrementBySeconds(6 * 60)
	newTx, err := relay.UpdateUnconfirmedTransactions()
	test.ErrFailWithDesc(err, t, "Updating unconfirmed transactions")

	// Check transaction was now sent with increased gas price
	client.MineBlocks(2)
	assertTransactionRelayed(t, newTx.Hash())
	if newTx.GasPrice().Int64() != 2400 {
		t.Errorf("Gas price of resent transaction is incorrect: expected %v but was %v", 2400, newTx.GasPrice().Int64())
	}

	// Check the tx is removed from the store after enough blocks
	client.MineBlocks(12)
	assertNoTransactionResent(t, relay.RelayServer)
	missingTx, err := relay.TxStore.GetFirstTransaction()
	if missingTx != nil || err != nil {
		t.Errorf("Transaction %v was not removed from store after 12 confirmations (error %v)", missingTx.Hash().Hex(), err)
	}
}

func TestMultipleRelayTransactions(t *testing.T) {
	test.ErrFail(relay.TxStore.Clear(), t)
	request1 := newRelayTransactionRequest(t, 2, "0xa1a5580b9974a0a2a54e33e5c82f2cb913656e6b65a5381e20ef3b94e6f0d4280d62b78be4504ad32fce1575fc6f4eb8cfd6fcd4a9e8d919cf9867222ab108bf1b")
	request2 := newRelayTransactionRequest(t, 3, "0xd6b2df0a5fe28710646e5dff18e8166264b829b199c7e07c7913aeb98fbf15416461406e6bf38c7e897456567122bbdb04b1493622801dac7379a9b74f2589851b")
	request3 := newRelayTransactionRequest(t, 4, "0x0495a8eec6689e04d4712c188f66dc3bb18497c8f5e3e86460f429eb97ea626761d92c43ecfb93bdda77b482b1904e7667e4df1dd3ebe03e9a27abbed42b287d1b")

	// Send 3 transactions, separated by 1 min each, and revert the last 2
	signedTx1, err := relay.CreateRelayTransaction(request1)
	test.ErrFailWithDesc(err, t, "Creating relay transaction 1")
	clk.IncrementBySeconds(60)
	snapshotID, err := client.Snapshot()
	test.ErrFailWithDesc(err, t, "Creating snapshot")
	_, err = relay.CreateRelayTransaction(request2)
	test.ErrFailWithDesc(err, t, "Creating relay transaction 2")
	clk.IncrementBySeconds(60)
	signedTx3, err := relay.CreateRelayTransaction(request3)
	test.ErrFailWithDesc(err, t, "Creating relay transaction 3")
	err = client.Revert(snapshotID)
	test.ErrFailWithDesc(err, t, "Restoring snapshot")
	nonce, err := client.NonceAt(context.Background(), relay.Address(), nil)

	// Check tx1 went fine
	assertTransactionRelayed(t, signedTx1.Hash())

	// After 5 minutes, tx2 is not resent because tx1 is still unconfirmed
	clk.IncrementBySeconds(60 * 5)
	assertNoTransactionResent(t, relay.RelayServer)
	assertRelayNonce(t, nonce)

	// Mine a bunch of blocks, so tx1 is confirmed and tx2 is resent
	client.MineBlocks(12)
	newTx2, err := relay.UpdateUnconfirmedTransactions()
	test.ErrFailWithDesc(err, t, "Updating unconfirmed transactions")
	assertRelayNonce(t, nonce+1)
	assertTransactionRelayed(t, newTx2.Hash())

	// Reinject tx3 into the chain as if it were mined once tx2 goes through
	test.ErrFailWithDesc(client.SendTransaction(context.Background(), signedTx3), t, "Resending tx3")
	assertTransactionRelayed(t, signedTx3.Hash())

	// Check that tx3 does not get resent, even after time passes or blocks get mined, and that store is empty
	assertNoTransactionResent(t, relay.RelayServer)
	clk.IncrementBySeconds(300)
	client.MineBlocks(12)
	assertNoTransactionResent(t, relay.RelayServer)
	noTx, err := relay.TxStore.GetFirstTransaction()
	if noTx != nil || err != nil {
		t.Errorf("Expected tx store to be empty but found %v (error %v)", noTx, err)
	}
}
