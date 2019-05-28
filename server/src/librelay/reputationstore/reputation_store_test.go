package reputationstore

import (
	"bytes"
	"github.com/ethereum/go-ethereum/common"
	"librelay/test"
	"math/big"
	"os"
	"testing"
)

var recipient = common.HexToAddress("0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1")

func testStore(t *testing.T, store *ReputationDbStore) {
	t.Run("GetScore should return zero for unknown recipients", func(t *testing.T) {
		score, err := store.GetScore(&recipient)
		if score.Cmp(big.NewInt(0)) != 0 || err != nil  {
			t.Errorf("score should be zero but was %v (error %v)", score, err)
		}
	})

	t.Run("Clear deletes all recipients", func(t *testing.T) {
		test.ErrFail(store.UpdateReputation(&recipient, true, big.NewInt(123456)), t)
		iter := store.NewIterator(nil, nil)
		if !iter.First() {
			t.Fail()
		}
		iter.Release()
		test.ErrFail(store.Clear(), t)
		iter = store.NewIterator(nil, nil)
		if iter.First() {
			t.Fail()
		}
		iter.Release()
	})

	t.Run("UpdateReputation should store recipient reputation", func(t *testing.T) {
		rep := big.NewInt(123456)
		test.ErrFail(store.UpdateReputation(&recipient, true, rep), t)
		reputationScore, err := store.GetScore(&recipient)
		test.ErrFail(err, t)
		if reputationScore.Cmp(rep) != 0 {
			t.Fail()
		}

	})

	t.Run("UpdateReputation should handle positive & negative values correctly", func(t *testing.T) {
		store.Clear()
		rep := big.NewInt(123456)
		test.ErrFail(store.UpdateReputation(&recipient, true, rep), t)
		test.ErrFail(store.UpdateReputation(&recipient, true, rep), t)
		reputationScore, err := store.GetScore(&recipient)
		test.ErrFail(err, t)
		if reputationScore.Cmp(big.NewInt(0).Add(rep, rep)) != 0 {
			t.Fail()
		}
		negRep := big.NewInt(-123456)
		test.ErrFail(store.UpdateReputation(&recipient, false, rep), t)
		test.ErrFail(store.UpdateReputation(&recipient, false, rep), t)
		test.ErrFail(store.UpdateReputation(&recipient, false, rep), t)
		reputationScore, err = store.GetScore(&recipient)
		test.ErrFail(err, t)
		if reputationScore.Cmp(negRep) != 0 {
			t.Fail()
		}

	})
}

func TestReputationDbStore(t *testing.T) {
	os.RemoveAll("test.db")
	store, err := NewReputationDbStore("reputation_test.db", nil)
	defer cleanupDb(store)
	test.ErrFail(err, t)
	testStore(t, store)
}

func TestEncodeDecode(t *testing.T) {
	rep := &ReputationDBEntry{&recipient, 123, 789, big.NewInt(110), big.NewInt(220)}
	encoded, err := rep.Encode()
	test.ErrFailWithDesc(err, t, "Error encoding ReputationDBEntry")
	decoded, err := Decode(encoded)
	test.ErrFailWithDesc(err, t, "Error encoding ReputationDBEntry")
	if !bytes.Equal(rep.Recipient[:], decoded.Recipient[:]) {
		t.Errorf("Incorrect Recipient %s, expected %s", decoded.Recipient.Hex(), rep.Recipient.Hex())
	}
	if rep.Gain.Cmp(decoded.Gain) != 0 {
		t.Errorf("Incorrect Gain %s, expected %s", decoded.Gain.String(), rep.Gain.String())
	}
	if rep.Loss.Cmp(decoded.Loss) != 0 {
		t.Errorf("Incorrect Loss %s, expected %s", decoded.Loss.String(), rep.Loss.String())
	}
	if rep.SuccessfulRequests != decoded.SuccessfulRequests {
		t.Errorf("Incorrect SuccessfulRequests %d, expected %d", decoded.SuccessfulRequests, rep.SuccessfulRequests)
	}
	if rep.FailedRequests != decoded.FailedRequests {
		t.Errorf("Incorrect FailedRequests %d, expected %d", decoded.FailedRequests, rep.FailedRequests)
	}

}

func cleanupDb(store *ReputationDbStore) {
	store.Close()
	os.RemoveAll("reputation_test.db")
}
