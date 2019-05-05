package librelay

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"gen/librelay"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"
)

const TxReceiptTimeout = 60 * time.Second

var lastNonce uint64 = 0
var nonceMutex = &sync.Mutex{}
var unconfirmedTxs = make(map[uint64]*types.Transaction)

type RelayTransactionRequest struct {
	EncodedFunction string
	Signature       []byte
	From            common.Address
	To              common.Address
	GasPrice        big.Int
	GasLimit        big.Int
	RecipientNonce  big.Int
	RelayMaxNonce   big.Int
	RelayFee        big.Int
	RelayHubAddress common.Address
}

type SetHubRequest struct {
	RelayHubAddress common.Address
}

type AuditRelaysRequest struct {
	SignedTx string
}

type GetEthAddrResponse struct {
	RelayServerAddress common.Address
	MinGasPrice        big.Int
	Ready              bool
	Version            string
}

type RelayTransactionResponse struct {
	SignedTx   *types.Transaction
	RawTxBytes []byte
}

func (response *RelayTransactionResponse) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		SignedTx   *types.Transaction
		RawTxBytes []byte
	}{
		SignedTx:   response.SignedTx,
		RawTxBytes: types.Transactions{response.SignedTx}.GetRlp(0),
	})
}

type IRelay interface {
	Balance() (balance *big.Int, err error)

	GasPrice() (big.Int)

	RefreshGasPrice() (err error)

	RegisterRelay() (err error)

	IsStaked() (staked bool, err error)

	RegistrationDate() (when int64, err error)

	IsRemoved() (removed bool, err error)

	SendBalanceToOwner() (err error)

	CreateRelayTransaction(request RelayTransactionRequest) (signedTx *types.Transaction, err error)

	Address() (relayAddress common.Address)

	HubAddress() (common.Address)

	GetUrl() (string)

	GetPort() (string)

	sendRegisterTransaction() (tx *types.Transaction, err error)

	awaitTransactionMined(tx *types.Transaction) (err error)
}

type IClient interface {
	bind.ContractBackend
	ethereum.TransactionReader

	NetworkID(ctx context.Context) (*big.Int, error)

	//From: ChainReader
	BlockByNumber(ctx context.Context, number *big.Int) (*types.Block, error)
	HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error)

	// From:  ChainStateReader, minus CodeAt
	BalanceAt(ctx context.Context, account common.Address, blockNumber *big.Int) (*big.Int, error)
	StorageAt(ctx context.Context, account common.Address, key common.Hash, blockNumber *big.Int) ([]byte, error)
	NonceAt(ctx context.Context, account common.Address, blockNumber *big.Int) (uint64, error)
}

type relayServer struct {
	OwnerAddress          common.Address
	Fee                   *big.Int
	Url                   string
	Port                  string
	RelayHubAddress       common.Address
	StakeAmount           *big.Int
	GasLimit              uint64
	DefaultGasPrice       int64
	GasPricePercent       *big.Int
	PrivateKey            *ecdsa.PrivateKey
	UnstakeDelay          *big.Int
	RegistrationBlockRate uint64
	EthereumNodeURL       string
	gasPrice              *big.Int // set dynamically as suggestedGasPrice*(GasPricePercent+100)/100
	Client                IClient
	rhub                  *librelay.RelayHub
}

type RelayParams relayServer

func NewEthClient(EthereumNodeURL string, defaultGasPrice int64) (IClient, error) {
	client := &TbkClient{DefaultGasPrice: defaultGasPrice}
	var err error
	client.Client, err = ethclient.Dial(EthereumNodeURL)
	return client, err
}

func NewRelayServer(
	OwnerAddress common.Address,
	Fee *big.Int,
	Url string,
	Port string,
	RelayHubAddress common.Address,
	StakeAmount *big.Int,
	GasLimit uint64,
	DefaultGasPrice int64,
	GasPricePercent *big.Int,
	PrivateKey *ecdsa.PrivateKey,
	UnstakeDelay *big.Int,
	RegistrationBlockRate uint64,
	EthereumNodeURL string,
	Client IClient) (*relayServer, error) {

	rhub, err := librelay.NewRelayHub(RelayHubAddress, Client)

	if err != nil {
		return nil, err
	}

	relay := &relayServer{
		OwnerAddress:          OwnerAddress,
		Fee:                   Fee,
		Url:                   Url,
		Port:                  Port,
		RelayHubAddress:       RelayHubAddress,
		StakeAmount:           StakeAmount,
		GasLimit:              GasLimit,
		DefaultGasPrice:       DefaultGasPrice,
		GasPricePercent:       GasPricePercent,
		PrivateKey:            PrivateKey,
		UnstakeDelay:          UnstakeDelay,
		RegistrationBlockRate: RegistrationBlockRate,
		EthereumNodeURL:       EthereumNodeURL,
		Client:                Client,
		rhub:                  rhub,
	}
	return relay, err
}

func (relay *relayServer) Balance() (balance *big.Int, err error) {
	balance, err = relay.Client.BalanceAt(context.Background(), relay.Address(), nil)
	return
}

func (relay *relayServer) GasPrice() (big.Int) {
	if relay.gasPrice == nil {
		return *big.NewInt(0)
	}
	return *relay.gasPrice
}

func (relay *relayServer) RefreshGasPrice() (err error) {
	gasPrice, err := relay.Client.SuggestGasPrice(context.Background())
	if err != nil {
		log.Println("SuggestGasPrice() failed ", err)
		return
	}
	relay.gasPrice = gasPrice.Mul(big.NewInt(0).Add(relay.GasPricePercent, big.NewInt(100)), gasPrice).Div(gasPrice, big.NewInt(100))
	return
}

func (relay *relayServer) RegisterRelay() (err error) {
	tx, err := relay.sendRegisterTransaction()
	if err != nil {
		return err
	}
	return relay.awaitTransactionMined(tx)
}

func (relay *relayServer) sendRegisterTransaction() (tx *types.Transaction, err error) {
	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce()
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	log.Println("RegisterRelay() starting. RelayHub address ", relay.RelayHubAddress.Hex(), "Relay Url", relay.Url)
	tx, err = relay.rhub.RegisterRelay(auth, relay.Fee, relay.Url)
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = tx
	lastNonce++
	log.Println("RegisterRelay() tx sent:", tx.Hash().Hex())
	return
}

func (relay *relayServer) awaitTransactionMined(tx *types.Transaction) (err error) {

	start := time.Now()
	var receipt *types.Receipt
	for ; (receipt == nil || err != nil) && time.Since(start) < TxReceiptTimeout; receipt, err = relay.Client.TransactionReceipt(context.Background(), tx.Hash()) {
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		log.Println("Could not get tx receipt", err)
		return
	}
	if receipt.Status != 1 {
		log.Println("tx failed: tx receipt status", receipt.Status)
		return
	}

	return nil
}

func (relay *relayServer) RemoveRelay(ownerKey *ecdsa.PrivateKey) (err error) {
	tx, err := relay.sendRemoveTransaction(ownerKey)
	if err != nil {
		return err
	}
	return relay.awaitTransactionMined(tx)
}

func (relay *relayServer) sendRemoveTransaction(ownerKey *ecdsa.PrivateKey) (tx *types.Transaction, err error) {
	auth := bind.NewKeyedTransactor(ownerKey)
	log.Println("RemoveRelay() starting. RelayHub address ", relay.RelayHubAddress.Hex(), "Relay Url", relay.Url)
	tx, err = relay.rhub.RemoveRelayByOwner(auth, relay.Address())
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("RemoveRelay() tx sent:", tx.Hash().Hex())
	return
}

func (relay *relayServer) IsStaked() (staked bool, err error) {
	relayAddress := relay.Address()
	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: false,
	}

	stakeEntry, err := relay.rhub.Relays(callOpt, relayAddress)
	if err != nil {
		log.Println(err)
		return
	}
	staked = (stakeEntry.Stake.Cmp(big.NewInt(0)) != 0)

	if staked && (relay.OwnerAddress.Hex() == common.HexToAddress("0").Hex()) {
		log.Println("Got staked for the first time, setting owner")
		relay.OwnerAddress = stakeEntry.Owner
		log.Println("Owner is", relay.OwnerAddress.Hex())
		log.Println("Stake:", stakeEntry.Stake.String())
	}
	return
}

func (relay *relayServer) RegistrationDate() (when int64, err error) {

	lastBlockHeader, err := relay.Client.HeaderByNumber(context.Background(), nil)
	if err != nil {
		log.Println(err)
		return
	}
	startBlock := uint64(0)
	if lastBlockHeader.Number.Uint64() > relay.RegistrationBlockRate {
		startBlock = lastBlockHeader.Number.Uint64() - relay.RegistrationBlockRate
	}
	filterOpts := &bind.FilterOpts{
		Start: startBlock,
		End:   nil,
	}
	iter, err := relay.rhub.FilterRelayAdded(filterOpts, []common.Address{relay.Address()}, nil)
	if err != nil {
		log.Println(err)
		return
	}

	if (iter.Event == nil && !iter.Next()) ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0) ||
		(iter.Event.TransactionFee.Cmp(relay.Fee) != 0) ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) < 0) ||
	//(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
	//(iter.Event.UnstakeDelay.Cmp(relay.UnstakeDelay) != 0) ||
		(iter.Event.Url != relay.Url) {
		return 0, fmt.Errorf("Could not receive RelayAdded() events for our relay")
	}
	lastRegisteredHeader, err := relay.Client.HeaderByNumber(context.Background(), big.NewInt(int64(iter.Event.Raw.BlockNumber)))
	if err != nil {
		log.Println(err)
		return
	}
	when = lastRegisteredHeader.Time.Int64()
	return
}

func (relay *relayServer) IsRemoved() (removed bool, err error) {
	filterOpts := &bind.FilterOpts{
		Start: 0,
		End:   nil,
	}
	iter, err := relay.rhub.FilterRelayRemoved(filterOpts, []common.Address{relay.Address()})
	if err != nil {
		log.Println(err)
		return
	}
	if iter.Event == nil && !iter.Next() {
		return
	}
	return true, nil
}

func (relay *relayServer) SendBalanceToOwner() (err error) {
	balance, err := relay.Client.BalanceAt(context.Background(), relay.Address(), nil)
	if err != nil {
		log.Println(err)
		return
	}
	if balance.Uint64() == 0 {
		log.Println("balance is 0")
		return
	}
	log.Println("Sending", balance, "wei to owner address", relay.OwnerAddress.Hex())

	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce()
	if err != nil {
		log.Println(err)
		return
	}

	var data []byte
	gasLimit := uint64(21000) // in units
	gasPrice, err := relay.Client.SuggestGasPrice(context.Background())
	if err != nil {
		log.Println(err)
		return
	}
	cost := gasPrice.Uint64() * gasLimit
	value := big.NewInt(int64(balance.Uint64() - cost))
	tx := types.NewTransaction(nonce, relay.OwnerAddress, value, gasLimit, gasPrice, data)

	chainID, err := relay.Client.NetworkID(context.Background())
	if err != nil {
		log.Println(err)
		return
	}

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), relay.PrivateKey)
	if err != nil {
		log.Println(err)
		return
	}

	err = relay.Client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		log.Println(err)
		return
	}

	log.Printf("tx sent: %s", signedTx.Hash().Hex())

	return relay.awaitTransactionMined(signedTx)
}

func (relay *relayServer) CreateRelayTransaction(request RelayTransactionRequest) (signedTx *types.Transaction, err error) {
	// Check that the relayhub is the correct one
	if bytes.Compare(relay.RelayHubAddress.Bytes(), request.RelayHubAddress.Bytes()) != 0 {
		err = fmt.Errorf("Wrong hub address.\nRelay server's hub address: %s, request's hub address: %s\n", relay.RelayHubAddress.Hex(), request.RelayHubAddress.Hex())
		log.Println(err)
		return
	}

	// Check that the fee is acceptable
	if !relay.validateFee(request.RelayFee) {
		err = fmt.Errorf("Unacceptable fee")
		log.Println(err)
		return
	}

	// Check that the gasPrice is initialized & acceptable
	if relay.gasPrice == nil || relay.gasPrice.Cmp(&request.GasPrice) > 0 {
		err = fmt.Errorf("Unacceptable gasPrice")
		log.Println(err)
		return
	}

	if request.RelayMaxNonce.Cmp(big.NewInt(int64(lastNonce))) < 0 {
		err = fmt.Errorf("Unacceptable RelayMaxNonce")
		log.Println(err, request.RelayMaxNonce)
		return
	}

	// check can_relay view function to see if we'll get paid for relaying this tx
	res, err := relay.canRelay(request.EncodedFunction,
		request.Signature,
		request.From,
		request.To,
		request.GasPrice,
		request.GasLimit,
		request.RecipientNonce,
		request.RelayFee)
	if err != nil {
		log.Println("can_relay failed in server", err)
		return
	}
	if res != 0 {
		errStr := fmt.Sprintln("EncodedFunction:", request.EncodedFunction, "From:", request.From.Hex(), "To:", request.To.Hex(),
			"GasPrice:", request.GasPrice.String(), "GasLimit:", request.GasLimit.String(), "Nonce:", request.RecipientNonce.String(), "Fee:",
			request.RelayFee.String(), "sig:", hexutil.Encode(request.Signature))
		err = fmt.Errorf("can_relay() view function returned error code=%d\nparams:%s", res, errStr)
		log.Println(err, errStr)
		return
	}

	// can_relay returned true, so we can relay the tx

	auth := bind.NewKeyedTransactor(relay.PrivateKey)

	relayAddress := relay.Address()

	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: false,
	}
	gasReserve, err := relay.rhub.GasReserve(callOpt)
	if err != nil {
		log.Println(err)
		return
	}
	gasLimit := big.NewInt(0)
	auth.GasLimit = gasLimit.Add(&request.GasLimit, gasReserve).Add(gasLimit, gasReserve).Uint64()
	auth.GasPrice = &request.GasPrice

	toBalance, err := relay.rhub.Balances(callOpt, request.To)
	if err != nil {
		log.Println(err)
		return
	}

	hubAbi, err := abi.JSON(strings.NewReader(librelay.RelayHubABI))
	if err != nil {
		return
	}
	input, err := hubAbi.Pack("relay", request.From, request.To, common.Hex2Bytes(request.EncodedFunction[2:]), &request.RelayFee,
		&request.GasPrice, &request.GasLimit, &request.RecipientNonce, request.Signature)
	if err != nil {
		log.Println(err)
		return
	}
	gasEstimate, err := relay.Client.EstimateGas(context.Background(), ethereum.CallMsg{
		To:   &request.To,
		From: request.From,
		Data: input,
	})
	maxCharge := request.GasPrice.Uint64() * gasEstimate * (100 + relay.GasPricePercent.Uint64()) / 100
	if toBalance.Uint64() < maxCharge {
		err = fmt.Errorf("Recipient balance too low: %d, gasEstimate*fee: %d", toBalance, maxCharge)
		log.Println(err)
		return
	}

	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce()
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	signedTx, err = relay.rhub.Relay(auth, request.From, request.To, common.Hex2Bytes(request.EncodedFunction[2:]), &request.RelayFee,
		&request.GasPrice, &request.GasLimit, &request.RecipientNonce, request.Signature)
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = signedTx
	lastNonce++

	log.Println("tx sent:", signedTx.Hash().Hex())
	return
}

func (relay *relayServer) Address() (relayAddress common.Address) {
	publicKey := relay.PrivateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		log.Println(
			"error casting public key to ECDSA")
		return
	}
	relayAddress = crypto.PubkeyToAddress(*publicKeyECDSA)
	return
}

func (relay *relayServer) HubAddress() (common.Address) {
	return relay.RelayHubAddress
}

func (relay *relayServer) GetUrl() (string) {
	return relay.Url
}

func (relay *relayServer) GetPort() (string) {
	return relay.Port
}

func (relay *relayServer) canRelay(encodedFunction string,
	signature []byte,
	from common.Address,
	to common.Address,
	gasPrice big.Int,
	gasLimit big.Int,
	recipientNonce big.Int,
	relayFee big.Int) (res uint32, err error) {

	relayAddress := relay.Address()

	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: false,
	}

	res, err = relay.rhub.CanRelay(callOpt, relayAddress, from, to, common.Hex2Bytes(encodedFunction[2:]), &relayFee, &gasPrice, &gasLimit, &recipientNonce, signature)
	if err != nil {
		log.Println(err)
		return
	}

	return
}

func (relay *relayServer) validateFee(relayFee big.Int) bool {
	return relayFee.Cmp(relay.Fee) >= 0

}

func (relay *relayServer) pollNonce() (nonce uint64, err error) {
	ctx := context.Background()
	fromAddress := relay.Address()
	nonce, err = relay.Client.PendingNonceAt(ctx, fromAddress)
	if err != nil {
		log.Println(err)
		return
	}

	//log.Println("Nonce is", nonce)

	if lastNonce <= nonce {
		lastNonce = nonce
	} else {
		nonce = lastNonce
	}
	//log.Println("lastNonce is", lastNonce)
	return
}

func (relay *relayServer) replayUnconfirmedTxs(client *ethclient.Client) {
	log.Println("replayUnconfirmedTxs start")
	log.Println("unconfirmedTxs size", len(unconfirmedTxs))
	ctx := context.Background()
	nonce, err := relay.Client.PendingNonceAt(ctx, relay.Address())
	if err != nil {
		log.Println(err)
		return
	}
	for i := uint64(0); i < nonce; i++ {
		delete(unconfirmedTxs, i)
	}
	log.Println("unconfirmedTxs size after deletion", len(unconfirmedTxs))
	for i, tx := range unconfirmedTxs {
		log.Println("replaying tx nonce ", i)
		err = relay.Client.SendTransaction(ctx, tx)
		if err != nil {
			log.Println("tx ", i, ":", err)
		}
	}
	log.Println("replayUnconfirmedTxs end")
}
