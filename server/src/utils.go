package main

import (
	"crypto/ecdsa"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type SyncBool struct {
	val   bool
	mutex *sync.Mutex
}

func (b *SyncBool) GetVal() (val bool){
	b.mutex.Lock()
	defer b.mutex.Unlock()
	val = b.val
	return
}

func (b *SyncBool) SetVal(val bool) {
	b.mutex.Lock()
	defer b.mutex.Unlock()
	b.val = val
}


// Loads (creates if doesn't exist) private key from keystore file
func loadPrivateKey(keystoreDir string) *ecdsa.PrivateKey {
	// Init a keystore
	ks := keystore.NewKeyStore(
		keystoreDir,
		keystore.LightScryptN,
		keystore.LightScryptP)

	// find (or create) account
	var account accounts.Account
	var err error
	log.Println("ks accounts len", len(ks.Accounts()))
	if _, err = os.Stat(filepath.Join(keystoreDir, "")); os.IsNotExist(err) {
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


func schedule(job func(), delay time.Duration, when time.Duration) chan bool {

	stop := make(chan bool)

	go func() {
		time.Sleep(when)
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
