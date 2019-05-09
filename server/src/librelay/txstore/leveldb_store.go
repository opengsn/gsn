package txstore

import (
	"encoding/binary"
	"fmt"
	"sync"

	"code.cloudfoundry.org/clock"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rlp"

	"github.com/syndtr/goleveldb/leveldb"
)

type LevelDbTxStore struct {
	*leveldb.DB
	clock clock.Clock
	mutex *sync.Mutex
}

func (tx *TimestampedTransaction) Encode() ([]byte, error) {
	bytes := make([]byte, 8)
	binary.BigEndian.PutUint64(bytes, uint64(tx.Timestamp))
	txBytes, err := rlp.EncodeToBytes(tx.Transaction)
	if err != nil {
		return nil, err
	}
	bytes = append(bytes, txBytes...)
	return bytes, nil
}

func DecodeTimestampedTransaction(bytes []byte) (*TimestampedTransaction, error) {
	var tx types.Transaction
	err := rlp.DecodeBytes(bytes[8:], &tx)
	if err != nil {
		return nil, err
	}

	timestamp := int64(binary.BigEndian.Uint64(bytes[:8]))
	timedtx := TimestampedTransaction{&tx, timestamp}
	return &timedtx, nil
}

func NewLevelDbTxStore(file string, clk clock.Clock) (store *LevelDbTxStore, err error) {
	if clk == nil {
		clk = clock.NewClock()
	}

	db, err := leveldb.OpenFile(file, nil)
	if err != nil {
		return nil, err
	}

	return &LevelDbTxStore{db, clk, &sync.Mutex{}}, nil
}

// ListTransactions returns all transactions on the store, useful for testing
func (store *LevelDbTxStore) ListTransactions() (txs []*TimestampedTransaction, err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	txs = make([]*TimestampedTransaction, 0, 20)
	iter := store.NewIterator(nil, nil)
	defer iter.Release()
	for iter.Next() {
		value := iter.Value()
		tx, err := DecodeTimestampedTransaction(value)
		if err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}

	return
}

// GetFirstTransaction returns transaction with lowest nonce
func (store *LevelDbTxStore) GetFirstTransaction() (tx *TimestampedTransaction, err error) {
	iter := store.NewIterator(nil, nil)
	defer iter.Release()

	if iter.Next() {
		value := iter.Value()
		tx, err := DecodeTimestampedTransaction(value)
		if err != nil {
			return nil, err
		}
		return tx, nil
	}
	return nil, nil
}

// SaveTransaction dates and stores transaction sorted by ascending nonce
func (store *LevelDbTxStore) SaveTransaction(tx *types.Transaction) (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	timedtx := &TimestampedTransaction{tx, store.clock.Now().Unix()}
	txbytes, err := timedtx.Encode()
	if err != nil {
		return err
	}

	key := make([]byte, 8)
	binary.BigEndian.PutUint64(key, tx.Nonce())
	err = store.Put(key, txbytes, nil)
	if err != nil {
		return err
	}

	return
}

// UpdateTransactionByNonce updates a transaction given its nonce, returns error if tx with same nonce does not exist
func (store *LevelDbTxStore) UpdateTransactionByNonce(tx *types.Transaction) (err error) {
	key := make([]byte, 8)
	binary.BigEndian.PutUint64(key, tx.Nonce())

	_, err = store.Get(key, nil)
	if err == leveldb.ErrNotFound {
		return fmt.Errorf("Could not find transaction with nonce %d", tx.Nonce())
	} else if err != nil {
		return err
	}

	return store.SaveTransaction(tx)
}

// RemoveTransactionsLessThanNonce removes all transactions with nonce values up to the specified value inclusive
func (store *LevelDbTxStore) RemoveTransactionsLessThanNonce(nonce uint64) (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	batch := new(leveldb.Batch)
	iter := store.NewIterator(nil, nil)

	for iter.Next() {
		key := iter.Key()
		value := iter.Value()
		tx, err := DecodeTimestampedTransaction(value)
		if err != nil {
			iter.Release()
			return err
		}

		if tx.Nonce() < nonce {
			batch.Delete(key)
		} else {
			break
		}
	}

	iter.Release()
	return store.Write(batch, nil)
}

// Clear removes all transactions stored
func (store *LevelDbTxStore) Clear() (err error) {
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
