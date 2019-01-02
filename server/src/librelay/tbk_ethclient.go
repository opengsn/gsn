package librelay

import (
	"context"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"log"
)

/* We hook ethclient since EstimateGas returns inaccurate estimation, due to state differences
 * of executing a tx locally through eth_call vs on the blockchain ( msg.sender.balance for example)
*/
type TbkClient struct {
	*ethclient.Client
}

func (tbkClient *TbkClient) EstimateGas(ctx context.Context, msg ethereum.CallMsg) (uint64, error) {
	gas,err := tbkClient.Client.EstimateGas(ctx,msg)
	if (err == nil) {
		log.Println("EstimateGas is", gas)
		gas += 20000*params.Wei
		log.Println("New EstimateGas is", gas)
	}
	return gas,err

}
