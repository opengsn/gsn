package txstore

import (
	"github.com/ethereum/go-ethereum/core/types"
)

type TimestampedTransaction struct {
	*types.Transaction
	Timestamp int64
}

type ITxStore interface {
	ListTransactions() (txs []*TimestampedTransaction, err error)
	GetFirstTransaction() (tx *TimestampedTransaction, err error)
	SaveTransaction(tx *types.Transaction) (err error)
	UpdateTransactionByNonce(tx *types.Transaction) (err error)
	RemoveTransactionsLessThanNonce(nonce uint64) (err error)
	Clear() (err error)
	Close() (err error)
}
