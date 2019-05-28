package reputationstore

import (
	"github.com/ethereum/go-ethereum/common"
	"math/big"
)

type PolicyFunction func(entry *ReputationDBEntry) (score *big.Int, err error)

type IReputationStore interface {
	GetScore(recipient *common.Address) (score *big.Int, err error)
	UpdateReputation(recipient *common.Address, success bool, charge *big.Int) (err error)
	SetPolicy(policyFn PolicyFunction)
	Clear() (err error)
	Close() (err error)
}
