import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, formatEther, BigNumber } from 'ethers';
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
    virtual: '0x3dCACa90A714498624067948624067948C092Dd0373f08265',
    ath: '0x2cFDeE1d5f04dD235AEA47E1aD2fB66E3A61C13e'
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
  gasPrice: parseUnits('0.1', 'gwei')
};

const erc20Abi = [
  'function balanceOf(address owner) view returns (uint256 balance)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function symbol() view returns (string)'
];

function getPrivateKeys() {
  const keys = [];
  let i = 1;
  while (true) {
    const key = process.env[`PRIVATE_KEY_${i}`];
    if (!key) break;
    keys.push(key);
    i++;
  }
  if (!keys.length && process.env.PRIVATE_KEY) {
    keys.push(process.env.PRIVATE_KEY);
  }
  return keys;
}

class WalletBot {
  constructor(privateKey, config) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpc);
    this.wallet = new Wallet(privateKey, this.provider);
    this.address = this.wallet.address;
  }

  async getTokenBalance(tokenAddress) {
    const token = new Contract(tokenAddress, erc20Abi, this.wallet);
    // fetch raw and force BigNumber
    const raw = await token.balanceOf(this.address);
    const balance = BigNumber.from(raw);
    const decimals = await token.decimals();
    const formatted = formatUnits(balance, decimals);
    let symbol;
    try { symbol = await token.symbol(); } catch { symbol = 'TOKEN'; }
    return { balance, decimals, formatted, symbol };
  }

  async getEthBalance() {
    const bal = await this.provider.getBalance(this.address);
    return { balance: bal, formatted: formatEther(bal) };
  }

  async swapToken(tokenName) {
    console.log(`\n=== [${this.address.slice(0,6)}...] Swap ${tokenName.toUpperCase()} ===`);
    const tokenAddr = this.config.tokens[tokenName];
    const router = this.config.routers[tokenName];
    const methodIdRaw = this.config.methodIds[`${tokenName}Swap`];
    if (!router || !methodIdRaw) return;

    const { balance, decimals, formatted, symbol } = await this.getTokenBalance(tokenAddr);
    if (balance.toString() === '0') { console.log(`No ${symbol}`); return; }

    // approve full balance
    await (new Contract(tokenAddr, erc20Abi, this.wallet))
      .approve(router, balance, { gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
      .then(tx => tx.wait());

    // build data: strip 0x, pad amount, add 0x prefix
    const mid = methodIdRaw.replace(/^0x/, '');
    const amtHex = parseUnits(formatted, decimals).toHexString().replace(/^0x/, '').padStart(64, '0');
    const data = '0x' + mid + amtHex;

    await this.wallet.sendTransaction({ to: router, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
      .then(tx => tx.wait());
  }

  async stakeToken(tokenName) {
    console.log(`\n=== [${this.address.slice(0,6)}...] Stake ${tokenName.toUpperCase()} ===`);
    const tokenAddr = this.config.tokens[tokenName];
    const stakeAddr = this.config.stakeContracts[tokenName];
    if (!stakeAddr) return;

    const { balance, formatted } = await this.getTokenBalance(tokenAddr);
    if (balance.toString() === '0') { console.log(`No tokens to stake`); return; }

    await (new Contract(tokenAddr, erc20Abi, this.wallet))
      .approve(stakeAddr, balance, { gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
      .then(tx => tx.wait());

    const mid = this.config.methodIds.stake.replace(/^0x/, '');
    const amtHex = parseUnits(formatted, formatted.decimals).toHexString().replace(/^0x/, '').padStart(64, '0');
    const data = '0x' + mid + amtHex;

    await this.wallet.sendTransaction({ to: stakeAddr, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
      .then(tx => tx.wait());
  }

  async claimFaucets() {
    console.log(`\n=== [${this.address.slice(0,6)}...] Claim Faucets ===`);
    const endpoints = {
      ath: 'https://app.x-network.io/maitrix-faucet/faucet',
      usde: 'https://app.x-network.io/maitrix-usde/faucet',
      lvlusd: 'https://app.x-network.io/maitrix-lvl/faucet',
      virtual: 'https://app.x-network.io/maitrix-virtual/faucet',
      vana: 'https://app.x-network.io/maitrix-vana/faucet'
    };
    for (const [tok, url] of Object.entries(endpoints)) {
      try {
        await axios.post(url, { address: this.address });
        console.log(`Claimed ${tok.toUpperCase()}`);
      } catch(e) { console.error(`Failed ${tok}`); }
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  async checkWalletStatus() {
    const { formatted: eth } = await this.getEthBalance();
    console.log(`ETH: ${eth}`);
    for (const name of Object.keys(this.config.tokens)) {
      const { formatted, symbol } = await this.getTokenBalance(this.config.tokens[name]);
      console.log(`${symbol}: ${formatted}`);
    }
  }

  async runBot() {
    await this.checkWalletStatus();
    await this.claimFaucets();
    for (const t of Object.keys(this.config.routers)) await this.swapToken(t);
    for (const t of Object.keys(this.config.stakeContracts)) await this.stakeToken(t);
    await this.checkWalletStatus();
  }
}

(async function main() {
  const privateKeys = getPrivateKeys();
  if (!privateKeys.length) { console.error('No private keys'); return; }
  for (const pk of privateKeys) {
    const bot = new WalletBot(pk, globalConfig);
    await bot.runBot();
  }
  const INTERVAL = 24*60*60*1000;
  setInterval(async () => {
    for (const pk of privateKeys) {
      const bot = new WalletBot(pk, globalConfig);
      await bot.runBot();
    }
  }, INTERVAL);
})();
