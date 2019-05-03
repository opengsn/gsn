package librelay

import (
	"container/list"
	"fmt"
	"sync"

	"code.cloudfoundry.org/clock"

	"github.com/ethereum/go-ethereum/core/types"
)

type TimestampedTransaction struct {
	*types.Transaction
	Timestamp int64
}

type ITxStore interface {
	GetFirstTransaction() (tx *TimestampedTransaction, err error)
	SaveTransaction(tx *types.Transaction) (err error)
	UpdateTransactionByNonce(tx *types.Transaction) (err error)
	RemoveTransactionsUptoNonce(nonce uint64) (err error)
}

type MemoryTxStore struct {
	transactions *list.List
	mutex        *sync.Mutex
	clock        clock.Clock
}

func NewMemoryTxStore(clk clock.Clock) *MemoryTxStore {
	if clk == nil {
		clk = clock.NewClock()
	}

	return &MemoryTxStore{
		transactions: list.New(),
		mutex:        &sync.Mutex{},
		clock:        clk,
	}
}

// GetFirstTransaction returns transaction with lowest nonce
func (store *MemoryTxStore) GetFirstTransaction() (tx *TimestampedTransaction, err error) {
	front := store.transactions.Front()
	if front == nil {
		return nil, nil
	}
	return front.Value.(*TimestampedTransaction), nil
}

// SaveTransaction dates and stores transaction sorted by ascending nonce
func (store *MemoryTxStore) SaveTransaction(tx *types.Transaction) (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	timedtx := &TimestampedTransaction{tx, store.clock.Now().Unix()}
	for e := store.transactions.Front(); e != nil; e = e.Next() {
		if e.Value.(*TimestampedTransaction).Nonce() > tx.Nonce() {
			store.transactions.InsertBefore(timedtx, e)
			return
		}
	}

	store.transactions.PushBack(timedtx)
	return
}

// UpdateTransactionByNonce updates a transaction given its nonce, returns error if tx with same nonce does not exist
func (store *MemoryTxStore) UpdateTransactionByNonce(tx *types.Transaction) (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	timedtx := &TimestampedTransaction{tx, store.clock.Now().Unix()}
	for e := store.transactions.Front(); e != nil; e = e.Next() {
		if e.Value.(*TimestampedTransaction).Nonce() == tx.Nonce() {
			e.Value = timedtx
			return nil
		}
	}

	return fmt.Errorf("Could not find transaction with nonce %d", tx.Nonce())
}

// RemoveTransactionsUptoNonce removes all transactions with nonce values up to the specified value inclusive
func (store *MemoryTxStore) RemoveTransactionsUptoNonce(nonce uint64) (err error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	for e := store.transactions.Front(); e != nil && e.Value.(*TimestampedTransaction).Nonce() <= nonce; e = store.transactions.Front() {
		store.transactions.Remove(e)
	}

	return
}
