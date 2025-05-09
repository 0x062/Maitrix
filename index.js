import * as ethers from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Konfigurasi untuk multiple accounts
const globalConfig = {
  rpc: 'https://arbitrum-sepolia.gateway.tenderly.co',
  chainId: 421614,
  tokens: {
    virtual: '0xFF27D611ab162d7827bbbA59F140C1E7aE56e95C',
    ath: '0x1428444Eacdc0Fd115dd4318FcE65B61Cd1ef399',
    ausd: '0x78De28aABBD5198657B26A8dc9777f441551B477',
    usde: '0xf4BE938070f59764C85fAcE374F92A4670ff3877',
    lvlusd: '0x8802b7bcF8EedCc9E1bA6C20E139bEe89dd98E83',
    vusd: '0xc14A8E2Fc341A97a57524000bF0F7F1bA4de4802',
    vana: '0xBEbF4E25652e7F23CCdCCcaaCB32004501c4BfF8'
  },
  routers: {
    virtual: '0x3dCACa90A714498624067948C092Dd0373f08265',
    ath: '0x2cFDeE1d5f04dD235AEA47E1aD2fB66e3A61C13e'
  },
  stakeContracts: {
    ausd: '0x054de909723ECda2d119E31583D40a52a332f85c',
    usde: '0x07f8ec2B79B7A1998Fd0B21a4668B0Cf1cA72C02',
    lvlusd: '0x5De3fBd40D4c3892914c3b67b5B529D776A1483A',
    vusd: '0x5bb9Fa02a3DCCDB4E9099b48e8Ba5841D2e59d51',
    vnusd: '0x46a6585a0Ad1750d37B4e6810EB59cBDf591Dc30'
  },
  methodIds: {
    virtualSwap: '0xa6d67510',
    athSwap: '0x1bf6318b',
    stake: '0xa694fc3a'
  },
  gasLimit: 1000000,
  gasPrice: ethers.parseUnits('0.1', 'gwei')
};

// ABI untuk token ERC20
const erc20Abi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function symbol() view returns (string)'
];

// Daftar private key dari file .env
function getPrivateKeys() {
  const privateKeys = [];
  let index = 1;
  
  while (true) {
    const key = process.env[`PRIVATE_KEY_${index}`];
    if (!key) break;
    privateKeys.push(key);
    index++;
  }
  
  // Jika tidak ada private key dengan format di atas, gunakan format lama
  if (privateKeys.length === 0 && process.env.PRIVATE_KEY) {
    privateKeys.push(process.env.PRIVATE_KEY);
  }
  
  return privateKeys;
}

// Kelas WalletBot
class WalletBot {
  constructor(privateKey, config) {
    this.config = config;
    this.provider = new ethers.providers.JsonRpcProvider(config.rpc);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.address = this.wallet.address;
  }

  // Function untuk mendapatkan token balance
  async getTokenBalance(tokenAddress) {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, this.wallet);
    const decimals = await tokenContract.decimals();
    const balance = await tokenContract.balanceOf(this.wallet.address);
    let symbol = '';
    
    try {
      symbol = await tokenContract.symbol();
    } catch (error) {
      symbol = 'TOKEN';
    }
    
    return {
      balance,
      decimals,
      formatted: ethers.formatUnits(balance, decimals),
      symbol
    };
  }
  
  // Function untuk mendapatkan ETH balance
  async getEthBalance() {
    const balanceWei = await this.provider.getBalance(this.wallet.address);
    return {
      balance: balanceWei,
      formatted: ethers.formatEther(balanceWei)
    };
  }
  
  // ... (methods swapToken, stakeToken, checkWalletStatus, claimFaucets, runBot tetap sama, hanya internal utils.formatUnits dan formatEther)
}

// Main function
targetMain();

async function targetMain() {
  console.log('Starting multi-account swap and stake bot...');
  const privateKeys = getPrivateKeys();
  if (privateKeys.length === 0) {
    console.error('No private keys found in .env file!');
    return;
  }
  console.log(`Found ${privateKeys.length} accounts to process`);

  for (let i = 0; i < privateKeys.length; i++) {
    console.log(`Processing account ${i+1} of ${privateKeys.length}`);
    const bot = new WalletBot(privateKeys[i], globalConfig);
    await bot.runBot();
  }

  console.log('All accounts processed successfully!');

  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  console.log(`Next execution at: ${new Date(Date.now() + INTERVAL_MS).toLocaleString()}`);
  setInterval(async () => await targetMain(), INTERVAL_MS);
}
