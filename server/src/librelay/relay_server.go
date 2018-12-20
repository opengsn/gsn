package librelay

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"gen/librelay"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"log"
	"math/big"
	"sync"
	"time"
)

const BlockTime = 20*time.Second

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

	Stake() (err error)

	Unstake() (err error)

	RegisterRelay(stale_relay common.Address) (err error)

	UnregisterRelay() (err error)

	IsStaked(hub common.Address) (staked bool, err error)

	IsRegistered(hub common.Address) (registered bool, err error)

	Withdraw()

	CreateRelayTransaction(request RelayTransactionRequest) (signedTx *types.Transaction, err error)

	Address() (relayAddress common.Address)

	HubAddress() (common.Address)

	AuditRelaysTransactions(signedTx *types.Transaction) (err error)

	ScanBlockChainToPenalize() (err error)
}

type RelayServer struct {
	OwnerAddress    common.Address
	Fee             *big.Int
	Url             string
	Port            int
	RelayHubAddress common.Address
	StakeAmount     *big.Int
	GasLimit        uint64
	GasPrice        *big.Int
	PrivateKey      *ecdsa.PrivateKey
	UnstakeDelay    *big.Int
	EthereumNodeURL string
}

func (relay *RelayServer) Balance() (balance *big.Int, err error) {
	log.Println("Checking relay server's ether balance at",relay.Address().Hex())
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	balance, err = client.BalanceAt(context.Background(),relay.Address(),nil)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("relay server balance:", balance)
	return
}

func (relay *RelayServer) Stake() (err error) {
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}

	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce(client)
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	auth.Value = relay.StakeAmount
	fmt.Println("Stake() starting. RelayHub address ",relay.RelayHubAddress.Hex())
	tx, err := rhub.Stake(auth,relay.Address(), relay.UnstakeDelay)
	if err != nil {
		log.Println("rhub.stake() failed", relay.StakeAmount, relay.UnstakeDelay)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = tx
	lastNonce++

	filterOpts := &bind.FilterOpts{
		Start: 0,
		End:   nil,
	}
	iter, err := rhub.FilterStaked(filterOpts)
	if err != nil {
		log.Println(err)
		return
	}
	start := time.Now()
	for (iter.Event == nil ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0)) && time.Since(start) < BlockTime {
		if !iter.Next() {
			iter, err = rhub.FilterStaked(filterOpts)
			if err != nil {
				log.Println(err)
				return
			}
		}
		time.Sleep(500*time.Millisecond)
	}
	if iter.Event == nil ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0) {
		return fmt.Errorf("Stake() probably failed: could not receive Staked() event for our relay")
	}

	fmt.Println("stake() tx finished")

	fmt.Println("tx sent:", types.HomesteadSigner{}.Hash(tx).Hex())
	return nil

}

func (relay *RelayServer) Unstake() (err error) {
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}
	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce(client)
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	tx, err := rhub.Unstake(auth, relay.Address())
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = tx
	lastNonce++

	filterOpts := &bind.FilterOpts{
		Start: 0,
		End:   nil,
	}
	iter, err := rhub.FilterUnstaked(filterOpts)
	if err != nil {
		log.Println(err)
		return
	}

	start := time.Now()
	for (iter.Event == nil ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0)) && time.Since(start) < BlockTime {
		if !iter.Next() {
			iter, err = rhub.FilterUnstaked(filterOpts)
			if err != nil {
				log.Println(err)
				return
			}
		}
		time.Sleep(500*time.Millisecond)
	}
	if iter.Event == nil ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0) {
		return fmt.Errorf("Unstake() probably failed: could not receive Unstaked() event for our relay")
	}

	fmt.Println("unstake() finished")

	fmt.Println("tx sent:", types.HomesteadSigner{}.Hash(tx).Hex())
	return nil

}

func (relay *RelayServer) RegisterRelay(stale_relay common.Address) (err error) {

	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}

	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}
	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce(client)
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	fmt.Println("RegisterRelay() starting. RelayHub address ",relay.RelayHubAddress.Hex())
	tx, err := rhub.RegisterRelay(auth, relay.OwnerAddress, relay.Fee, relay.Url, common.HexToAddress("0"))
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = tx
	lastNonce++
	//ctx := context.Background()
	//receipt,err := client.TransactionReceipt(ctx,tx.Hash())
	//client.TransactionReceipt(ctx,types.HomesteadSigner{}.Hash(tx))


	filterOpts := &bind.FilterOpts{
		Start: 0,
		End:   nil,
	}
	iter, err := rhub.FilterRelayAdded(filterOpts)
	if err != nil {
		log.Println(err)
		return
	}
	fmt.Println("tx created:", types.HomesteadSigner{}.Hash(tx).Hex())

	start := time.Now()
	for (iter.Event == nil ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0) ||
		(iter.Event.TransactionFee.Cmp(relay.Fee) != 0) ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) < 0) ||
		//(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		//(iter.Event.UnstakeDelay.Cmp(relay.UnstakeDelay) != 0) ||
		(iter.Event.Url != relay.Url)) && time.Since(start) < BlockTime {
		if !iter.Next() {
			iter, err = rhub.FilterRelayAdded(filterOpts)
			if err != nil {
				log.Println(err)
				return
			}
		}
		time.Sleep(500*time.Millisecond)
	}
	if iter.Event == nil ||
		(bytes.Compare(iter.Event.Relay.Bytes(), relay.Address().Bytes()) != 0) ||
		(iter.Event.TransactionFee.Cmp(relay.Fee) != 0) ||
		(iter.Event.Stake.Cmp(relay.StakeAmount) < 0) ||
		//(iter.Event.Stake.Cmp(relay.StakeAmount) != 0) ||
		//(iter.Event.UnstakeDelay.Cmp(relay.UnstakeDelay) != 0) ||
		(iter.Event.Url != relay.Url) {
			return fmt.Errorf("RegisterRelay() probably failed: could not receive RelayAdded() event for our relay")
	}

	fmt.Println("RegisterRelay() finished")
	fmt.Println("tx sent:", types.HomesteadSigner{}.Hash(tx).Hex())
	return nil
}

func (relay *RelayServer) UnregisterRelay() error {
	return relay.Unstake()
}

func (relay *RelayServer) IsStaked(hub common.Address) (staked bool, err error) {
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	relayAddress := relay.Address()
	log.Println("relay.RelayHubAddress", relay.RelayHubAddress.Hex())
	log.Println("hub to check stake", hub.Hex())
	rhub, err := librelay.NewRelayHub(hub, client)
	if err != nil {
		log.Println(err)
		return
	}
	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: true,
	}

	stakeEntry, err := rhub.Stakes(callOpt, relayAddress)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("Stake:", stakeEntry.Stake.String())
	staked = (stakeEntry.Stake.Cmp(big.NewInt(0)) != 0)

	if staked && (relay.OwnerAddress.Hex() == common.HexToAddress("0").Hex()) {
		log.Println("Got staked for the first time, setting owner")
		relayEntry, err := rhub.Relays(callOpt, relayAddress)
		if err != nil {
			log.Println(err)
			return false,err
		}
		relay.OwnerAddress = relayEntry.Owner
		log.Println("Owner is", relay.OwnerAddress.Hex())
	}

	return
}

func (relay *RelayServer) IsRegistered(hub common.Address) (registered bool, err error) {
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	relayAddress := relay.Address()
	log.Println("relay.RelayHubAddress", relay.RelayHubAddress.Hex())
	log.Println("hub to check", hub.Hex())
	rhub, err := librelay.NewRelayHub(hub, client)
	if err != nil {
		log.Println(err)
		return
	}
	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: true,
	}
	relayEntry, err := rhub.Relays(callOpt, relayAddress)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("Owner:", relayEntry.Owner.String())
	registered = (relayEntry.Timestamp.Uint64() != 0)

	return registered, nil
}

// TODO
func (relay *RelayServer) Withdraw() {

}

func (relay *RelayServer) CreateRelayTransaction(request RelayTransactionRequest) (signedTx *types.Transaction, err error) {

	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}

	// Check that the relayhub is the correct one
	if bytes.Compare(relay.RelayHubAddress.Bytes(),request.RelayHubAddress.Bytes()) != 0 {
		err = fmt.Errorf("Wrong hub address.\nRelay server's hub address: %s, request's hub address: %s\n",relay.RelayHubAddress.Hex(),request.RelayHubAddress.Hex())
		return
	}

	// Check that the fee is acceptable, i.e. we want to relay this tx
	if !relay.validateFee(request.RelayFee) {
		err = fmt.Errorf("Unacceptable fee")
		return
	}

	fmt.Println("Checking if canRelay()...")
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
		err = fmt.Errorf("can_relay() view function returned error code=%d", res)
		return
	}
	fmt.Println("canRelay() succeeded")
	// can_relay returned true, so we can relay the tx

	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}

	relayAddress := relay.Address()

	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: true,
	}
	gasReserve, err := rhub.GasReserve(callOpt)
	if err != nil {
		log.Println(err)
		return
	}
	gasLimit := big.NewInt(0)
	auth.GasLimit = gasLimit.Add(&request.GasLimit, gasReserve).Add(gasLimit, gasReserve).Uint64()
	auth.GasPrice = &request.GasPrice

	to_balance, err := rhub.Balances(callOpt, request.To)
	if err != nil {
		log.Println(err)
		return
	}
	fmt.Println("To.balance: ", to_balance)

	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce(client)
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	signedTx, err = rhub.Relay(auth, request.From, request.To, common.Hex2Bytes(request.EncodedFunction[2:]), &request.RelayFee,
		&request.GasPrice, &request.GasLimit, &request.RecipientNonce, request.Signature)
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return
	}
	//unconfirmedTxs[lastNonce] = signedTx
	lastNonce++

	fmt.Println("tx sent:", types.HomesteadSigner{}.Hash(signedTx).Hex())
	return
}

func (relay *RelayServer) Address() (relayAddress common.Address) {
	publicKey := relay.PrivateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		log.Fatalln(
			"error casting public key to ECDSA")
		return
	}
	relayAddress = crypto.PubkeyToAddress(*publicKeyECDSA)
	return
}

func (relay *RelayServer) HubAddress() (common.Address) {
	return relay.RelayHubAddress
}

var maybePenalizable = make(map[common.Address]types.TxByNonce)
var lastBlockScanned = big.NewInt(0)

func (relay *RelayServer) AuditRelaysTransactions(signedTx *types.Transaction) (err error) {

	log.Println("AuditRelaysTransactions start")
	ctx := context.Background()
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	// TODO verify on geth: eip155 and homestead give the same Sender() but different Hash(), it seems like homestead's Hash is the correct one from ganache...
	// probably due to ganache starting from earlier block than when eip155 introduced
	signer := types.HomesteadSigner{} //types.NewEIP155Signer(signedTx.ChainId())

	// check if @signedTx is already on the blockchain. If it is, return
	tx, _, err := client.TransactionByHash(ctx, signer.Hash(signedTx))
	if err == nil { // signedTx already on the blockchain
		log.Println("tx already on the blockchain")
		log.Println("tx ", tx)
		return
	} else if err != ethereum.NotFound { //found unsigned transaction... should never get here
		log.Println(err)
		return
	} // TODO: sanity check that tx == signedTx. their hash is equal according to signer.Hash()...
	// tx not found on the blockchain, maybe punishable...

	// check if @signedTx is from a known relay on relayhub. If it isn't, return.
	otherRelay, err := signer.Sender(signedTx)
	if err != nil {
		log.Println(err)
		return
	}
	isRelay, err := relay.validateRelay(client, otherRelay)
	if err != nil {
		log.Println(err)
		return
	}
	if !isRelay { // not a relay
		log.Println("Not a known relay on this relay hub", relay.RelayHubAddress.Hex())
		return
	}
	log.Println("After validate")

	// keep the tx in memory for future scan
	maybePenalizable[otherRelay] = append(maybePenalizable[otherRelay], signedTx)

	// check if @signedTx.nonce <= otherRelay.nonce.
	otherNonce, err := client.NonceAt(ctx, otherRelay, nil)
	if err != nil {
		log.Println(err)
		return
	}
	log.Println("Before scanning, current account nonce, tx nonce", otherNonce,signedTx.Nonce())
	//If it is, scan the blockchain for the other tx of the same nonce and penalize!
	if signedTx.Nonce() <= otherNonce {
		err = relay.scanBlockChainToPenalizeInternal(client, lastBlockScanned, nil)
		if err != nil {
			log.Println("scanBlockChainToPenalizeInternal failed")
			return
		} 
	}
	log.Println("AuditRelaysTransactions end")
	return nil
}

// TODO
func (relay *RelayServer) ScanBlockChainToPenalize() (err error) {
	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		log.Println("Could not connect to ethereum node", err)
		return
	}
	return relay.scanBlockChainToPenalizeInternal(client, lastBlockScanned, nil)
}

func (relay *RelayServer) scanBlockChainToPenalizeInternal(client *ethclient.Client, startBlock, endBlock *big.Int) (err error) {
	log.Println("scanBlockChainToPenalizeInternal start")
	signer := types.HomesteadSigner{} //types.NewEIP155Signer(signedTx.ChainId())
	ctx := context.Background()
	// iterate over maybePenalizable
	for address, txsToScan := range maybePenalizable {
		log.Println("scanBlockChainToPenalizeInternal  loop start")
		log.Println("address ", address.Hex())
		// get All transactions of each address in maybePenalizable and cross check nonce of them
		allTransactions, err := getTransactionsByAddress(client, address, startBlock, nil)
		if err != nil {
			log.Println(err)
			return err
		}
		log.Println("allTransactions len", len(allTransactions))
		for _, tx1 := range txsToScan {
			// check if @signedTx is already on the blockchain. If it is, continue to next
			/*tx*/ _, _, err = client.TransactionByHash(ctx, signer.Hash(tx1))
			if err == nil { // tx1 already on the blockchain
				continue
			}
			for _, tx2 := range allTransactions {
				if tx1.Nonce() == tx2.Nonce() && bytes.Compare(signer.Hash(tx1).Bytes(), signer.Hash(tx2).Bytes()) != 0 {
					err = relay.penalizeOtherRelay(client, tx1, tx2)
					if err != nil {
						log.Println(err)
						return err
					}

				}
			}
		}
		delete(maybePenalizable, address)
	}
	return nil
}

func getTransactionsByAddress(client *ethclient.Client, address common.Address, startBlock, endBlock *big.Int) (transactions types.Transactions, err error) {
	log.Println("getTransactionsByAddress start")
	ctx := context.Background()
	if endBlock == nil {
		header, err := client.HeaderByNumber(ctx, nil)
		if err != nil {
			log.Println(err)
			return nil, err
		}
		endBlock = header.Number
	}
	nonce, err := client.NonceAt(ctx, address, nil)
	if err != nil {
		log.Println(err)
		return
	}
	transactions = make(types.Transactions, 0, nonce)
	one := big.NewInt(1)
	log.Println("startBlock ", startBlock.Uint64(), "endBlock ",endBlock.Uint64())
	for bi := startBlock; bi.Cmp(endBlock) < 0; bi.Add(bi, one) {

		// TODO: this is a bug in ganache that returns a malformed serialized json to BlockByNumber/BlockByHash

		//header, err := client.HeaderByNumber(ctx, bi)
		//if err != nil {
		//	log.Println("client.HeaderByNumber failed, bi",bi.Uint64())
		//	log.Println(err)
		//	continue
		//}
		//block, err := client.BlockByHash(context.Background(), header.Hash())
		block, err := client.BlockByNumber(context.Background(), bi)
		if err != nil {
			log.Println("bi",bi.Uint64())
			log.Println(err)
			continue
		}
		//signer := types.HomesteadSigner{} //types.NewEIP155Signer(signedTx.ChainId())
		log.Println("block.Transactions() len", len(block.Transactions()))
		log.Println("bi.Cmp(endBlock) < 0", bi.Cmp(endBlock) < 0)
		for _, tx := range block.Transactions() {
			txMsg, err := tx.AsMessage(types.NewEIP155Signer(tx.ChainId()))
			if err != nil {
				log.Println(err)
				return nil, err
			}
			if txMsg.From().Hex() == address.Hex() {
				transactions = append(transactions, tx)
			}
		}

	}
	// advancing the last scanned block to save some effort
	lastBlockScanned = endBlock
	log.Println("getTransactionsByAddress start")
	return
}

func (relay *RelayServer) penalizeOtherRelay(client *ethclient.Client, signedTx1, signedTx2 *types.Transaction) (err error) {
	auth := bind.NewKeyedTransactor(relay.PrivateKey)
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}

	ts := types.Transactions{signedTx1}
	rawTxBytes1 := ts.GetRlp(0)
	vsig1, rsig1, ssig1 := signedTx1.RawSignatureValues()
	sig1 := make([]byte, 65)
	copy(sig1[32-len(rsig1.Bytes()):32], rsig1.Bytes())
	copy(sig1[64-len(ssig1.Bytes()):64], ssig1.Bytes())
	sig1[64] = byte(vsig1.Uint64() - 27)
	//log.Println("signedTx sig",hexutil.Encode(sig1))

	ts = types.Transactions{signedTx2}
	rawTxBytes2 := ts.GetRlp(0)
	vsig2, rsig2, ssig2 := signedTx1.RawSignatureValues()
	sig2 := make([]byte, 65)
	copy(sig2[32-len(rsig2.Bytes()):32], rsig2.Bytes())
	copy(sig2[64-len(ssig2.Bytes()):64], ssig2.Bytes())
	sig2[64] = byte(vsig2.Uint64() - 27)
	//log.Println("signedTx sig",hexutil.Encode(sig2))

	nonceMutex.Lock()
	defer nonceMutex.Unlock()
	nonce, err := relay.pollNonce(client)
	if err != nil {
		log.Println(err)
		return
	}
	auth.Nonce = big.NewInt(int64(nonce))
	tx, err := rhub.PenalizeRepeatedNonce(auth, rawTxBytes1, sig1, rawTxBytes2, sig2)
	if err != nil {
		log.Println(err)
		//relay.replayUnconfirmedTxs(client)
		return err
	}
	//unconfirmedTxs[lastNonce] = tx
	lastNonce++

	fmt.Println("tx sent:", types.HomesteadSigner{}.Hash(tx).Hex())
	return nil

}

func (relay *RelayServer) validateRelay(client *ethclient.Client, otherRelay common.Address) (bool, error) {
	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return false, err
	}

	callOpt := &bind.CallOpts{
		From:    relay.Address(),
		Pending: true,
	}
	res, err := rhub.Stakes(callOpt, otherRelay)
	if err != nil {
		log.Println(err)
		return false, err
	}
	if res.Stake.Cmp(big.NewInt(0)) > 0 {
		return true, nil
	}
	return false, nil
}

func (relay *RelayServer) canRelay(encodedFunction string,
	signature []byte,
	from common.Address,
	to common.Address,
	gasPrice big.Int,
	gasLimit big.Int,
	recipientNonce big.Int,
	relayFee big.Int) (res uint32, err error) {

	client, err := ethclient.Dial(relay.EthereumNodeURL)
	if err != nil {
		fmt.Println("Could not connect to ethereum node", err)
		return
	}

	relayAddress := relay.Address()

	rhub, err := librelay.NewRelayHub(relay.RelayHubAddress, client)
	if err != nil {
		log.Println(err)
		return
	}
	callOpt := &bind.CallOpts{
		From:    relayAddress,
		Pending: true,
	}

	log.Println( "before CanRelay" )
	res, err = rhub.CanRelay(callOpt, relayAddress, from, to, common.Hex2Bytes(encodedFunction[2:]), &relayFee, &gasPrice, &gasLimit, &recipientNonce, signature)
	log.Printf( "after CanRelay: res=%d\n", res )
	if err != nil {
		log.Println(err)
		return
	}
	return
}

func (relay *RelayServer) validateFee(relayFee big.Int) bool {
	return relayFee.Cmp(relay.Fee) >= 0

}

func (relay *RelayServer) pollNonce(client *ethclient.Client) (nonce uint64, err error) {
	ctx := context.Background()
	fromAddress := relay.Address()
	nonce, err = client.PendingNonceAt(ctx, fromAddress)
	if err != nil {
		log.Println(err)
		return
	}

	log.Println("Nonce is", nonce)

	if lastNonce <= nonce {
		lastNonce = nonce
	} else {
		nonce = lastNonce
	}
	log.Println("lastNonce is", lastNonce)
	return
}

func (relay *RelayServer) replayUnconfirmedTxs(client *ethclient.Client){
	log.Println("replayUnconfirmedTxs start")
	log.Println("unconfirmedTxs size", len(unconfirmedTxs))
	ctx := context.Background()
	nonce, err := client.PendingNonceAt(ctx, relay.Address())
	if err != nil {
		log.Println(err)
		return
	}
	for i := uint64(0); i < nonce; i++{
		delete(unconfirmedTxs,i)
	}
	log.Println("unconfirmedTxs size after deletion", len(unconfirmedTxs))
	for i,tx := range unconfirmedTxs {
		log.Println("replaying tx nonce ", i)
		err = client.SendTransaction(ctx,tx)
		if err != nil {
			log.Println("tx ", i, ":",err)
		}
	}
	log.Println("replayUnconfirmedTxs end")
}
