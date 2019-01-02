package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
	"io/ioutil"
	"librelay"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const DebugAPI = true

var KeystoreDir = filepath.Join(os.Getenv("PWD"), "build/server/keystore")

var ready = &SyncBool{val: false, mutex: &sync.Mutex{}}

var relay librelay.IRelay
var server *http.Server
var stopKeepAlive chan bool
var stopRefreshBlockchainView chan bool
//var stopScanningBlockChain chan bool

type RelayParams librelay.RelayServer

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("RelayHttpServer starting")

	configRelay(parseCommandLine())

	server = &http.Server{Addr: ":8090", Handler: nil}

	http.HandleFunc("/relay", assureRelayReady(relayHandler))
	http.HandleFunc("/getaddr", getEthAddrHandler)
	//Unused for now. TODO: handle eth_BlockByNumber/eth_BlockByHash manually, since the go client can't parse malformed answer from ganache-cli
	//http.HandleFunc("/audit", assureRelayReady(auditRelaysHandler))

	if DebugAPI { // we let the client dictate which RelayHub we use on the blockchain
		http.HandleFunc("/setRelayHub", setHubHandler)
	}

	stopKeepAlive = schedule(keepAlive, 1*time.Minute, 0)
	stopRefreshBlockchainView = schedule(refreshBlockchainView, 1*time.Minute, 0)
	//stopScanningBlockChain = schedule(scanBlockChainToPenalize, 1*time.Hour)

	port := "8090"
	log.Printf("RelayHttpServer started.Listening on port: %s\n", port)
	err := server.ListenAndServe()
	if err != nil {
		log.Fatalln(err)
	}

}

// http.HandlerFunc wrapper to assure we have enough balance to operate, and server already has stake and registered
func assureRelayReady(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !ready.GetVal() {
			err := fmt.Errorf("Relay not staked and registered yet")
			log.Println(err)
			w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
			return
		}

		// wait for funding
		balance, err := relay.Balance()
		if err != nil {
			log.Println(err)
			w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
			return
		}
		if balance.Uint64() == 0 {
			err = fmt.Errorf("Waiting for funding...")
			log.Println(err)
			w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
			return
		}
		gasPrice := relay.GasPrice()
		if gasPrice.Uint64() == 0 {
			err = fmt.Errorf("Waiting for gasPrice...")
			log.Println(err)
			w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
			return
		}
		log.Println("Relay received gasPrice::", gasPrice.Uint64())
		fn(w, r)
	}

}

func auditRelaysHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	log.Println("auditRelaysHandler Start")
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		log.Println("Could not read request body", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	var request = &librelay.AuditRelaysRequest{}
	var signedTx = &types.Transaction{}
	err = json.Unmarshal(body, &request)
	if err != nil {
		log.Println("Invalid json", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	log.Println("request.SignedTxHex", request.SignedTx)
	err = rlp.DecodeBytes(common.Hex2Bytes(request.SignedTx[2:]), signedTx)
	if err != nil {
		log.Println("Failed to rlp.decode", err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}

	err = relay.AuditRelaysTransactions(signedTx)
	if err != nil {
		log.Println("AuditRelaysTransactions() failed")
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	log.Println("auditRelaysHandler end")
	resp, err := json.Marshal("OK")
	if err != nil {
		log.Println(err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	w.Write(resp)
}

func getEthAddrHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	log.Println("Sending relayServer eth address")
	getEthAddrResponse := &librelay.GetEthAddrResponse{
		RelayServerAddress: relay.Address(),
		MinGasPrice:        relay.GasPrice(),
		Ready:              ready.GetVal(),
	}
	resp, err := json.Marshal(getEthAddrResponse)
	if err != nil {
		log.Println(err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	log.Printf("address %s sent\n", relay.Address().Hex())

	w.Write(resp)
}

func setHubHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	log.Println("setHubHandler Start")
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		log.Println("Could not read request body", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	var request = &librelay.SetHubRequest{}
	err = json.Unmarshal(body, request)
	if err != nil {
		log.Println("Invalid json", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	log.Println("RelayHubAddress", request.RelayHubAddress.String())
	log.Println("Checking if already staked to this hub")

	// as a workaround when setting a relayhub address in debug mode
	stopKeepAlive <- true
	stopRefreshBlockchainView <- true
	relayServer := relay.(*librelay.RelayServer)
	relayServer.RelayHubAddress = request.RelayHubAddress
	//go refreshBlockchainView()
	stopKeepAlive = schedule(keepAlive, 1*time.Minute, 0)
	stopRefreshBlockchainView = schedule(refreshBlockchainView, 1*time.Minute, 0)

	w.WriteHeader(http.StatusOK)
	resp, err := json.Marshal("OK")
	if err != nil {
		log.Println(err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	w.Write(resp)
}

func relayHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	log.Println("Relay Handler Start")
	body, err := ioutil.ReadAll(r.Body)

	if err != nil {
		log.Println("Could not read request body", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	var request = &librelay.RelayTransactionRequest{}
	err = json.Unmarshal(body, request)
	if err != nil {
		log.Println("Invalid json", body, err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	log.Println("RelayHubAddress", request.RelayHubAddress.String())
	signedTx, err := relay.CreateRelayTransaction(*request)
	if err != nil {
		log.Println("Failed to relay")
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))

		return
	}
	resp, err := signedTx.MarshalJSON()
	if err != nil {
		log.Println(err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	w.Write(resp)
}

func parseCommandLine() (relayParams RelayParams) {
	ownerAddress := flag.String("OwnerAddress", common.HexToAddress("0").Hex(), "Relay's owner address")
	fee := flag.Int64("Fee", 11, "Relay's per transaction fee")
	url := flag.String("Url", "http://localhost:8090", "Relay's owner address")
	relayHubAddress := flag.String("RelayHubAddress", "0x254dffcd3277c0b1660f6d42efbb754edababc2b", "RelayHub address")
	stakeAmount := flag.Int64("StakeAmount", 1002, "Relay's stake (in wei)")
	gasLimit := flag.Uint64("GasLimit", 100000, "Relay's gas limit per transaction")
	gasPriceFactor := flag.Int64("GasPriceFactor", 50, "Relay's gas price multiplier per transaction. GasPrice = GasPriceFactor*eth_gasPrice() ")
	unstakeDelay := flag.Int64("UnstakeDelay", 1200, "Relay's time delay before being able to unsatke from relayhub (in days)")
	ethereumNodeUrl := flag.String("EthereumNodeUrl", "http://localhost:8545", "The relay's ethereum node")
	workdir := flag.String("Workdir", filepath.Join(os.Getenv("PWD"), "build/server"), "The relay server's workdir")

	flag.Parse()

	relayParams.OwnerAddress = common.HexToAddress(*ownerAddress)
	relayParams.Fee = big.NewInt(*fee)
	relayParams.Url = *url
	relayParams.RelayHubAddress = common.HexToAddress(*relayHubAddress)
	relayParams.StakeAmount = big.NewInt(*stakeAmount)
	relayParams.GasLimit = *gasLimit
	relayParams.GasPriceFactor = big.NewInt(*gasPriceFactor)
	relayParams.UnstakeDelay = big.NewInt(*unstakeDelay)
	relayParams.EthereumNodeURL = *ethereumNodeUrl

	KeystoreDir = filepath.Join(*workdir, "keystore")

	log.Println("Using RelayHub address: " + relayParams.RelayHubAddress.String())
	log.Println("Using workdir: " + *workdir)

	return relayParams

}

func configRelay(relayParams RelayParams) {
	log.Println("Constructing relay server in url ", relayParams.Url)
	privateKey := loadPrivateKey(KeystoreDir)
	log.Println("Public key: ", crypto.PubkeyToAddress(privateKey.PublicKey).Hex())
	relay = &librelay.RelayServer{OwnerAddress: relayParams.OwnerAddress, Fee: relayParams.Fee, Url: relayParams.Url, Port: relayParams.Port,
		RelayHubAddress: relayParams.RelayHubAddress, StakeAmount: relayParams.StakeAmount,
		GasLimit: relayParams.GasLimit, GasPriceFactor: relayParams.GasPriceFactor, PrivateKey: privateKey, UnstakeDelay: relayParams.UnstakeDelay, EthereumNodeURL: relayParams.EthereumNodeURL}
}

// Wait for server to be staked & funded by owner, then try and register on RelayHub
func refreshBlockchainView() {
	waitForOwnerActions()
	log.Println("Waiting for registration...")
	when, err := relay.WhenRegistered(relay.HubAddress())
	for ; err != nil || when == 0; when, err = relay.WhenRegistered(relay.HubAddress()) {
		if err != nil {
			log.Println(err)
		}
		ready.SetVal(false)
		time.Sleep(15 * time.Second)
	}

	log.Println("Trying to get gasPrice from node...")
	for err := relay.RefreshGasPrice(); err != nil; err = relay.RefreshGasPrice() {
		if err != nil {
			log.Println(err)
		}
		ready.SetVal(false)
		log.Println("Trying to get gasPrice from node again...")
		time.Sleep(10 * time.Second)

	}
	gasPrice := relay.GasPrice()
	log.Println("GasPrice:", gasPrice.Uint64())

	ready.SetVal(true)
}

func waitForOwnerActions() {
	staked, err := relay.IsStaked(relay.HubAddress())
	for ; err != nil || !staked; staked, err = relay.IsStaked(relay.HubAddress()) {
		if err != nil {
			log.Println(err)
		}
		ready.SetVal(false)
		log.Println("Waiting for stake...")
		time.Sleep(5 * time.Second)
	}

	// wait for funding
	balance, err := relay.Balance()
	if err != nil {
		log.Println(err)
		return
	}
	for ; err != nil || balance.Uint64() <= params.Ether; balance, err = relay.Balance() {
		ready.SetVal(false)
		log.Println("Server's balance too low. Waiting for funding...")
		time.Sleep(10 * time.Second)
	}
	log.Println("Relay funded. Balance:", balance)
}

func keepAlive() {

	waitForOwnerActions()
	when, err := relay.WhenRegistered(relay.HubAddress())
	if err != nil {
		log.Println(err)
	} else if time.Now().Unix()-when < 24*int64(time.Hour/time.Second) { // time.Duration is in nanosec - converting to sec like unix
		log.Println("Relay registered lately. No need to reregister")
		return
	}
	log.Println("Registering relay...")
	for err := relay.RegisterRelay(common.HexToAddress("0")); err != nil; err = relay.RegisterRelay(common.HexToAddress("0")) {
		if err != nil {
			log.Println(err)
		}
		log.Println("Trying to register again...")
		time.Sleep(10 * time.Second)
	}
	log.Println("Done registering")
}

func scanBlockChainToPenalize() {
	log.Println("scanBlockChainToPenalize start...")
	err := relay.ScanBlockChainToPenalize()
	if err != nil {
		log.Fatal(err)
	}
	log.Println("Done scanBlockChainToPenalize")
}
