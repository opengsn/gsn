#!/bin/sh

# dependencies for this script:  node, yarn, docker

function usage()
{
    echo "Run open gsn relayer in aws cloud environment"
    echo ""
    echo "\t-h --help"
    echo "\t-f\t--fromAddress"
    echo "\t-m\t--mnemonic"
    echo "\t-n\t--networkUrl"
    echo "\t-R\t--relayUrl"
    echo ""
}

while [ "$1" != "" ]; do
    PARAM=`echo $1 | awk -F= '{print $1}'`
    VALUE=`echo $1 | awk -F= '{print $2}'`
    case $PARAM in
        -h | --help)
            usage
            exit
            ;;
        -f | --fromAddress)
            FROM_ADDRESS=$VALUE
            ;;
        -m | --mnemonic)
            MNEMONIC_LOCATION=$VALUE
            ;;
        -n | --networkUrl)
            NETWORK_URL=$VALUE
            ;;
        -r | --relayUrl)
            RELAY_URL=$VALUE
            ;;
        -g | --gasPrice)
            GAS_PRICE=$VALUE
            ;;
        *)
            echo "ERROR: unknown parameter \"$PARAM\""
            usage
            exit 1
            ;;
    esac
    shift
done

cd ../../

yarn install

cd ./dockers/relaydc
sudo ./rdc local up -d

node ~/gsn/packages/cli/dist/commands/gsn-relayer-register
  --network $NETWORK_URL
  --from $FROM_ADDRESS
  --mnemonic $MNEMONIC_LOCATION
  --gasPrice $GAS_PRICE
  --relayUrl $RELAY_URL
