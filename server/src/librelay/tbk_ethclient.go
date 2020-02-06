package librelay

import (
	"context"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"log"
	"math/big"
)

/* We hook ethclient since EstimateGas returns inaccurate estimation, due to state differences
 * of executing a tx locally through eth_call vs on the blockchain ( msg.sender.balance for example)
*/
type OpenethClient struct {
	*ethclient.Client

	DefaultGasPrice int64
}

func (openethClient *OpenethClient) EstimateGas(ctx context.Context, msg ethereum.CallMsg) (uint64, error) {
	gas,err := openethClient.Client.EstimateGas(ctx,msg)
	if (err == nil) {
		gas += 20000*params.Wei
	}
	return gas,err

}

// SuggestGasPrice retrieves the currently suggested gas price to allow a timely
// execution of a transaction.
func (openethClient *OpenethClient) SuggestGasPrice(ctx context.Context) (*big.Int, error) {
	gasPrice,err := openethClient.Client.SuggestGasPrice(ctx)
	if err == nil && gasPrice.Uint64() == 0 {
		gasPrice = big.NewInt(openethClient.DefaultGasPrice)//big.NewInt(params.GWei)
		log.Println("New gasPrice is", gasPrice.Uint64())
	}
	return gasPrice,err
}
