package reputationstore

import (
	"bytes"
	"encoding/gob"
	"github.com/ethereum/go-ethereum/common"
	"github.com/syndtr/goleveldb/leveldb"
	"log"
	"math/big"
	"sync"
)

type ReputationDBEntry struct {
	Recipient                          *common.Address
	FailedRequests, SuccessfulRequests uint64
	Gain, Loss                         *big.Int // Both positive number, representing total gains vs total losses of relaying txs for said recipient
}

type ReputationDbStore struct {
	*leveldb.DB
	policyFn PolicyFunction
	mutex    *sync.Mutex
}

// impl

func (rep *ReputationDBEntry) Encode() ([]byte, error) {
	buf := &bytes.Buffer{}
	err := gob.NewEncoder(buf).Encode(rep)
	if err != nil {
		return nil, err
	}
	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	return out, nil
}

func Decode(bs []byte) (*ReputationDBEntry, error) {
	rep := &ReputationDBEntry{}
	buf := bytes.NewBuffer(bs)
	err := gob.NewDecoder(buf).Decode(rep)
	if err != nil {
		return nil, err
	}
	return rep, nil
}

func NewReputationDbStore(file string, policyFn PolicyFunction) (store *ReputationDbStore, err error) {

	if policyFn == nil {
		policyFn = DefaultPolicy
	}

	db, err := leveldb.OpenFile(file, nil)
	if err != nil {
		return nil, err
	}

	return &ReputationDbStore{db, policyFn, &sync.Mutex{}}, nil
}

func (store *ReputationDbStore) UpdateReputation(recipient *common.Address, success bool, charge *big.Int) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	log.Printf("UpdateReputation recipient %s in database.", recipient.Hex())

	rep, err := store.getRepEntry(recipient)
	if err == leveldb.ErrNotFound {
		log.Printf("Could not find recipient %s in database. Creating new entry.\n", recipient.Hex())
		rep = &ReputationDBEntry{Recipient: recipient, FailedRequests: 0, SuccessfulRequests: 0, Gain: big.NewInt(0), Loss: big.NewInt(0)}
	} else if err != nil {
		log.Println(err)
		return err
	}
	if success {
		rep.SuccessfulRequests++
		rep.Gain.Add(rep.Gain, charge)
	} else {
		rep.FailedRequests++
		rep.Loss.Add(rep.Loss, charge)
	}
	err = store.putRepEntry(recipient, rep)
	if err != nil {
		log.Println(err)
		return err
	}
	score, err := store.policyFn(rep)
	if err != nil {
		log.Println(err)
		return err
	}
	log.Printf("UpdateReputation recipient %s in database. rep: %d", recipient.Hex(), score)
	return nil

}

func (store *ReputationDbStore) GetScore(recipient *common.Address) (score *big.Int, err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	rep, err := store.getRepEntry(recipient)
	if err == leveldb.ErrNotFound {
		log.Printf("Could not find recipient %s in database.\n", recipient.Hex())
		rep = &ReputationDBEntry{Recipient: recipient, FailedRequests: 0, SuccessfulRequests: 0, Gain: big.NewInt(0), Loss: big.NewInt(0)}
	} else if err != nil {
		return big.NewInt(0), err
	}
	return store.policyFn(rep)

}

func (store *ReputationDbStore) SetPolicy(policyFn PolicyFunction) {
	store.policyFn = policyFn
}

// Clear removes all reputation stored
func (store *ReputationDbStore) Clear() (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	batch := new(leveldb.Batch)
	iter := store.NewIterator(nil, nil)

	for iter.Next() {
		key := iter.Key()
		batch.Delete(key)
	}

	iter.Release()
	return store.Write(batch, nil)
}

func (store *ReputationDbStore) getRepEntry(recipient *common.Address) (*ReputationDBEntry, error) {

	value, err := store.Get(recipient.Bytes(), nil)
	if err != nil {
		return nil, err
	}
	return Decode(value)
}

func (store *ReputationDbStore) putRepEntry(recipient *common.Address, repEntry *ReputationDBEntry) error {

	repBytes, err := repEntry.Encode()
	if err != nil {
		return err
	}
	repEntry.Loss.Bytes()
	return store.Put(recipient.Bytes(), repBytes, nil)
}

func DefaultPolicy(entry *ReputationDBEntry) (score *big.Int, err error) {
	return big.NewInt(0).Sub(entry.Gain, entry.Loss), nil

}
