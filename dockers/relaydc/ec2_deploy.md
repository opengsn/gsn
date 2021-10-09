# Steps to deploy opengsn relay to aws

### 1. Relayer domain

You will need public domain name for running relayer on AWS, best way to do this is to acquire some domain name for this purpose at any domain seller (or acquire it directly at AWS). If you acquire domain somewhere else but in `Route53` you can use this AWS tutorial to transfer DNS from your domain name provider to `Route53` at AWS: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/migrate-dns-domain-in-use.html

### 2. Launch EC2 instance (t2.medium, ubuntu 20.04 preferred)

After you acquire domain name you can launch ec2 instance by going to EC2 service in AWS dashboard and chosing `Launch Instance`. You can reference to this link for documentation on how to get started with EC2:
https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/launching-instance.html

Important thing to mention here is that you need to keep track of your private key you create and the security group for instance has to be publicly accessible for relay port (80, 443)

### 3. Allocate Elastic IP address and associate it to the EC2 instance launched

Elastic IP addresses are not changing while dynamically allocated public IPs in EC2 change at instance restart. From EC2 dashboard go to `Elastic IPs` in side menu and create Elastic IP address. After you create it take a not of it and associate it to the existing EC2 instance which you created previously.
Reference to this link in documentation for any issues: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html

### 4. Create A record in hosted zone
For your subdomain to point at Elastic IP associated with the EC2 instance you will need to create A record with value similar to something like `gsn-relayer.<cutomdomainname>.<tld>`. IP address this record should point to will be Elastic IP address from previous step. This domain name should serve as a public domain for your relayer.

### 5. Install git, docker and node

Connect to EC2 instance via ssh and install git, docker and node for ubuntu.

### 6. Clone OpenGSN

Clone open-gsn to your home folder:

    cd
    git clone https://github.com/pantherprotocol/gsn

### 7. Edit .env file

Edit env file in dockers folder:

    cd ~/gsn/dockers/relaydc && vim .env

Update domain name here to contain your sudomain of choice (possibly `gsn-relayer.<cutomdomainname>.<tld>`)

### 8. Edit relay-config.json file in gsn/dockers/relaydc/config/relay-config.json ()

You will need to provide relayer with ownerAddress, versionRegistry and networkUrl. For Mumbai network this would be:

    networkUrl: https://rpc-mumbai.matic.today
    versionRegistry: 0x7380D97dedf9B8EEe5bbE41422645aA19Cd4C8B3
    ownerAddress: <this would be your ethereum address>

### 9. Run .rdc script for local

Run the script for docker containers:

    sudo ./rdc local up -d

### 10. Wait for docker containers to run

Check docker logs to get the status of all containers:

    sudo docker container ls
    sudo docker conainer logs <container_name>

### 11. Create mnemonic file with funded account

Create file containing mnemonic for your ethereum wallet (the owner address):

    vim pass12

## Register Relay

    node ~/gsn/packages/cli/dist/commands/gsn-relayer-register --network <>networkUrl 
    --from <yourEthereumAddress> 
    --mnemonic ~/pass12 
    --gasPrice 70 
    --relayUrl https://<RELAY.URL>/gsn1

- Check if everything is alright by running metacoin tests
