package librelay

import (
	"context"
	"crypto/ecdsa"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/accounts/abi/bind/backends"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"math/big"
	"testing"
)

// account 0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1
// privatekey 4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d
/* Right now we only deploy the contract and run ganache-cli, while we can run helloServer to listen to requests.
 */

const runGanache = false
const runTruffleMigrate = true
const ethereumNodeURL = "http://localhost:8545"

var relayHubAddress = common.HexToAddress("0x254dffcd3277c0b1660f6d42efbb754edababc2b") //0xe78a0f7e598cc8b0bb87894b0f60dd2a88d6a8ab

type FakeClient struct {
	*backends.SimulatedBackend
}

func (client *FakeClient) BlockByNumber(ctx context.Context, number *big.Int) (*types.Block, error) {
	return &types.Block{}, nil
}

func (client *FakeClient) HeaderByNumber(ctx context.Context, number *big.Int) (*types.Header, error) {
	return &types.Header{}, nil
}

func (client *FakeClient) TransactionByHash(ctx context.Context, txHash common.Hash) (tx *types.Transaction, isPending bool, err error) {
	return &types.Transaction{}, false, nil
}

func NewRelaySimBackend(t *testing.T) (relay IRelay, sim *FakeClient) {
	alloc := make(core.GenesisAlloc)
	key, _ := crypto.HexToECDSA("4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d")
	auth := bind.NewKeyedTransactor(key)
	alloc[auth.From] = core.GenesisAccount{Balance: big.NewInt(133700000)}
	sim = &FakeClient{}
	sim.SimulatedBackend = backends.NewSimulatedBackend(alloc, 10000000)


	fee := &big.Int{}
	stakeAmount := &big.Int{}
	gasLimit := uint64(0)
	gasPricePercent := &big.Int{}
	url := ""
	port := 0
	relayHubAddress := common.Address{}
	privateKey := &ecdsa.PrivateKey{}
	unstakeDelay := &big.Int{}
	ethereumNodeUrl := ""

	relay, err := NewRelayServer(
		common.Address{}, fee, url, port,
		relayHubAddress, stakeAmount, gasLimit,
		gasPricePercent, privateKey, unstakeDelay,
		ethereumNodeUrl, sim)
	if err != nil {
		t.Error("Relay was not created", err)
	}
	return
}

func ErrFail(err error, t *testing.T){
	if err != nil {
		t.Error(err)
	}
}

func TestRefreshGasPrice(t *testing.T) {
	relay, _ := NewRelaySimBackend(t)
	gasPriceBefore := relay.GasPrice()
	ErrFail(relay.RefreshGasPrice(), t)
	gasPriceAfter := relay.GasPrice()
	if gasPriceBefore.Cmp(big.NewInt(0)) != 0 {
		t.Error()
	}
	if gasPriceAfter.Cmp(big.NewInt(1)) != 0 {
		t.Error()
	}
}


