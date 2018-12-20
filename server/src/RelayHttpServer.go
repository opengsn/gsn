package main

import (
	"./librelay"
	"crypto/ecdsa"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
	"io/ioutil"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const DebugAPI = true

var KEYSTORE_DIR = filepath.Join(os.Getenv("PWD"), "build/server/keystore")

var stakedAndRegistered = false
var relay librelay.IRelay
var server *http.Server
//var stopKeepAlive chan bool
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
	go waitForStakeAndRegister()
	//stopScanningBlockChain = schedule(scanBlockChainToPenalize, 1*time.Hour)
	//stopKeepAlive = schedule(keepAlive, 1*time.Millisecond)

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
		if !stakedAndRegistered {
			err := fmt.Errorf("Relay not staked and registered yet" )
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
		log.Println("Relay funded. Balance:", balance)
		fn(w, r)
	}

}

func auditRelaysHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	fmt.Println("auditRelaysHandler Start")
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
	fmt.Println("auditRelaysHandler end")
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

	fmt.Println("Sending relayServer eth address")
	getEthAddrResponse := &librelay.GetEthAddrResponse{
		RelayServerAddress: relay.Address(),
	}
	resp, err := json.Marshal(getEthAddrResponse)
	if err != nil {
		log.Println(err)
		w.Write([]byte("{\"error\":\"" + err.Error() + "\"}"))
		return
	}
	fmt.Printf("address %s sent\n", relay.Address().Hex())

	w.Write(resp)
}

func setHubHandler(w http.ResponseWriter, r *http.Request) {

	w.Header()[ "Access-Control-Allow-Origin"] = []string{"*"}
	w.Header()[ "Access-Control-Allow-Headers"] = []string{"*"}

	fmt.Println("setHubHandler Start")
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
	//stopKeepAlive <- true
	relayServer := relay.(*librelay.RelayServer)
	relayServer.RelayHubAddress = request.RelayHubAddress
	go waitForStakeAndRegister()
	//stopKeepAlive = schedule(keepAlive, 3*time.Second)

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

	fmt.Println("Relay Handler Start")
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
	gasPrice := flag.Int64("GasPrice", 100, "Relay's gas price per transaction")
	privateKey := flag.String("PrivateKey", "77c5495fbb039eed474fc940f29955ed0531693cc9212911efd35dff0373153f", "Relay's ethereum private key")
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
	relayParams.GasPrice = big.NewInt(*gasPrice)
	var err error
	relayParams.PrivateKey, err = crypto.HexToECDSA(*privateKey)
	if err != nil {
		log.Fatal("Invalid private key", err)
	}
	relayParams.UnstakeDelay = big.NewInt(*unstakeDelay)
	relayParams.EthereumNodeURL = *ethereumNodeUrl

	KEYSTORE_DIR = filepath.Join(*workdir, "keystore")

	fmt.Println("Using RelayHub address: " + relayParams.RelayHubAddress.String())
	fmt.Println("Using workdir: " + *workdir)

	return relayParams

}

func configRelay(relayParams RelayParams) {
	fmt.Println("Constructing relay server in url ", relayParams.Url)
	privateKey := loadPrivateKey()
	fmt.Println("Private key: ", hexutil.Encode(crypto.FromECDSA(privateKey)))
	fmt.Println("Public key: ", crypto.PubkeyToAddress(privateKey.PublicKey).Hex())
	relay = &librelay.RelayServer{relayParams.OwnerAddress, relayParams.Fee, relayParams.Url, relayParams.Port,
		relayParams.RelayHubAddress, relayParams.StakeAmount,
		relayParams.GasLimit, relayParams.GasPrice, privateKey, relayParams.UnstakeDelay, relayParams.EthereumNodeURL}
}

// Loads (creates if doesn't exist) private key from keystore file
func loadPrivateKey() *ecdsa.PrivateKey {
	// Init a keystore
	ks := keystore.NewKeyStore(
		KEYSTORE_DIR,
		keystore.LightScryptN,
		keystore.LightScryptP)

	// find (or create) account
	var account accounts.Account
	var err error
	log.Println("ks accounts len", len(ks.Accounts()))
	if _, err = os.Stat(filepath.Join(KEYSTORE_DIR, "")); os.IsNotExist(err) {
		account, err = ks.NewAccount("")
		if err != nil {
			log.Fatal(err)
		}
		// Unlock the signing account
		if err := ks.Unlock(account, ""); err != nil {
			log.Fatalln(err)
		}
	} else {
		account = ks.Accounts()[0]
	}

	// Open the account key file

	keyJson, err := ioutil.ReadFile(account.URL.Path)
	if err != nil {
		log.Fatalln("key json read error:")
		panic(err)
	}

	keyWrapper, err := keystore.DecryptKey(keyJson, "")
	if err != nil {
		log.Fatalln("key decrypt error:")
	}
	log.Println("key extracted. addr:", keyWrapper.Address.String())

	return keyWrapper.PrivateKey
}

func waitForStakeAndRegister() {
	staked,err := relay.IsStaked(relay.HubAddress())
	for ; err != nil || !staked; staked,err = relay.IsStaked(relay.HubAddress()) {
		if err != nil {
			log.Println(err)
		}
		stakedAndRegistered = false
		log.Println("Waiting for stake...")
		time.Sleep(1*time.Second)
	}

	fmt.Println("Registering relay...")
	for err := relay.RegisterRelay(common.HexToAddress("0")); err != nil;err = relay.RegisterRelay(common.HexToAddress("0")) {
		if err != nil {
			log.Println(err)
		}
		fmt.Println("Trying to register again...")
		time.Sleep(5*time.Second)
	}
	fmt.Println("Done registering")
	stakedAndRegistered = true
}

func keepAlive() {
	fmt.Println("keepAlive relay...")
	err := relay.RegisterRelay(common.HexToAddress("0"))
	if err != nil {
		log.Println(err)
	}
	fmt.Println("Done keepAlive")
}

func scanBlockChainToPenalize() {
	fmt.Println("scanBlockChainToPenalize start...")
	err := relay.ScanBlockChainToPenalize()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Done scanBlockChainToPenalize")
}

func schedule(job func(), delay time.Duration) chan bool {
	stop := make(chan bool)

	go func() {
		for {
			job()
			select {
			case <-time.After(delay):
			case <-stop:
				return
			}
		}
	}()

	return stop
}
