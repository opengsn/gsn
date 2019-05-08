package txstore

import (
	"fmt"
	"math/big"
	"math/rand"
	"testing"
	"time"

	"librelay/test"

	"code.cloudfoundry.org/clock/fakeclock"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func newTx(nonce uint64) (tx *types.Transaction) {
	address, err := common.NewMixedcaseAddressFromString("ffcf8fdee72ac11b5c542428b35eef5769c409f0")
	if err != nil {
		fmt.Println("BOO", err)
	}
	gas := uint64(rand.Int63n(1e9))
	return types.NewTransaction(nonce, address.Address(), big.NewInt(10), gas, big.NewInt(2000), nil)
}

func testStore(t *testing.T, store ITxStore, clk *fakeclock.FakeClock) {
	t.Run("GetFirstTransaction returns nil", func(t *testing.T) {
		tx, err := store.GetFirstTransaction()
		if tx != nil || err != nil {
			t.Fail()
		}
	})

	t.Run("Clear deletes all txs", func(t *testing.T) {
		test.ErrFail(store.SaveTransaction(newTx(2)), t)
		test.ErrFail(store.Clear(), t)
		tx, err := store.GetFirstTransaction()
		if tx != nil || err != nil {
			t.Fail()
		}
	})

	t.Run("SaveTransaction stores current time", func(t *testing.T) {
		test.ErrFail(store.SaveTransaction(newTx(2)), t)
		tx, _ := store.GetFirstTransaction()
		if tx.Nonce() != 2 {
			t.Fail()
		}
		if tx.Timestamp < clk.Now().Unix()-1 || tx.Timestamp > clk.Now().Unix() {
			t.Errorf("Wrong timestamp on saved tx: was %v but current time is %v", tx.Timestamp, clk.Now().Unix())
		}
	})

	t.Run("SaveTransaction stores txs in order by nonce", func(t *testing.T) {
		store.Clear()
		test.ErrFail(store.SaveTransaction(newTx(4)), t)
		test.ErrFail(store.SaveTransaction(newTx(3)), t)
		test.ErrFail(store.SaveTransaction(newTx(5)), t)
		tx, _ := store.GetFirstTransaction()
		if tx.Nonce() != 3 {
			t.Fail()
		}
	})

	t.Run("UpdateTransactionByNonce updates the tx", func(t *testing.T) {
		store.Clear()
		updatedTx := newTx(4)
		test.ErrFail(store.SaveTransaction(newTx(4)), t)
		test.ErrFail(store.SaveTransaction(newTx(3)), t)
		test.ErrFail(store.SaveTransaction(newTx(5)), t)
		test.ErrFail(store.UpdateTransactionByNonce(updatedTx), t)

		txs, err := store.ListTransactions()
		test.ErrFail(err, t)

		if txs[1].Hash() != updatedTx.Hash() {
			t.Fail()
		}
	})

	t.Run("UpdateTransactionByNonce fails if tx is not present", func(t *testing.T) {
		store.Clear()
		test.ErrFail(store.SaveTransaction(newTx(3)), t)
		err := store.UpdateTransactionByNonce(newTx(4))
		if err == nil {
			t.Fail()
		}
	})

	t.Run("RemoveTransactionsLessThanNonce removes transactions strictly less than parameter", func(t *testing.T) {
		store.Clear()
		test.ErrFail(store.SaveTransaction(newTx(4)), t)
		test.ErrFail(store.SaveTransaction(newTx(3)), t)
		test.ErrFail(store.SaveTransaction(newTx(7)), t)
		test.ErrFail(store.SaveTransaction(newTx(5)), t)
		test.ErrFail(store.RemoveTransactionsLessThanNonce(5), t)

		txs, err := store.ListTransactions()
		test.ErrFail(err, t)

		if len(txs) != 2 || txs[0].Nonce() != 5 || txs[1].Nonce() != 7 {
			t.Errorf("Transactions left after removal: %v", txs)
		}
	})
}

func TestMemoryStore(t *testing.T) {
	clk := fakeclock.NewFakeClock(time.Now())
	store := NewMemoryTxStore(clk)
	testStore(t, store, clk)
}
