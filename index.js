import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, formatEther, BigNumber } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// --- CONFIGURASI ---
const globalConfig = {
  rpc: 'https://arbitrum-sepolia.gateway.tenderly.co',
  chainId: 421614,
  tokens: {
    virtual: '0xFF27D611ab162d7827bbbA59F140C1E7aE56e95C',
    ath:     '0x1428444Eacdc0Fd115dd4318FcE65B61Cd1ef399',
    ausd:    '0x78De28aABBD5198657B26A8dc9777f441551B477',
    usde:    '0xf4BE938070f59764C85fAcE374F92A4670ff3877',
    lvlusd:  '0x8802b7bcF8EedCc9E1bA6C20E139bEe89dd98E83',
    vusd:    '0xc14A8E2Fc341A97a57524000bF0F7F1bA4de4802',
    vana:    '0xBEbF4E25652e7F23CCdCCcaaCB32004501c4BfF8'
  },
  routers: {
    virtual: '0x3dCACa90A714498624067948C092Dd0373f08265',
    ath:     '0x2cFDeE1d5f04dD235AEA47E1aD2fB66E3A61C13e'
  },
  stakeContracts: {
    ausd:   '0x054de909723ECda2d119E31583D40a52a332f85c',
    usde:   '0x07f8ec2B79B7A1998Fd0B21a4668B0Cf1cA72C02',
    lvlusd: '0x5De3fBd40D4c3892914c3b67b5B529D776A1483A',
    vusd:   '0x5bb9Fa02a3DCCDB4E9099b48e8Ba5841D2e59d51',
    vana:   '0x46a6585a0Ad1750d37B4e6810EB59cBDf591Dc30'
  },
  methodIds: {
    virtualSwap: '0xa6d67510',
    athSwap:     '0x1bf6318b',
    stake:       '0xa694fc3a'
  },
  gasLimit:  1_000_000,
  gasPrice:  parseUnits('0.1', 'gwei')
};

const erc20Abi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function symbol() view returns (string)'
];

// Ambil PRIVATE_KEY dari env (bisa banyak akun)
function getPrivateKeys() {
  const keys = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY_${i}`]) {
    keys.push(process.env[`PRIVATE_KEY_${i}`]);
    i++;
  }
  if (!keys.length && process.env.PRIVATE_KEY) {
    keys.push(process.env.PRIVATE_KEY);
  }
  return keys;
}

// Bot class
class WalletBot {
  constructor(privateKey, config) {
    this.config   = config;
    this.provider = new JsonRpcProvider(config.rpc);
    this.wallet   = new Wallet(privateKey, this.provider);
    this.address  = this.wallet.address;
  }

  // Show ETH & token balances
  async checkWalletStatus() {
    const ethBal = formatEther(await this.provider.getBalance(this.address));
    console.log(`ETH: ${ethBal}`);
    for (const [name, addr] of Object.entries(this.config.tokens)) {
      const token = new Contract(addr, erc20Abi, this.wallet);
      const bal   = await token.balanceOf(this.address);
      const dec   = await token.decimals();
      console.log(`${name.toUpperCase()}: ${formatUnits(bal, dec)}`);
    }
  }

  // Claim faucets with HTTP status log
  async claimFaucets() {
    console.log(`\n=== [${this.address.slice(0,6)}...] Claim Faucets ===`);
    const endpoints = {
      ath:     'https://app.x-network.io/maitrix-faucet/faucet',
      usde:    'https://app.x-network.io/maitrix-usde/faucet',
      lvlusd:  'https://app.x-network.io/maitrix-lvl/faucet',
      virtual: 'https://app.x-network.io/maitrix-virtual/faucet',
      vana:    'https://app.x-network.io/maitrix-vana/faucet'
    };
    for (const [tok, url] of Object.entries(endpoints)) {
      try {
        const res = await axios.post(url, { address: this.address });
        console.log(`Claim ${tok.toUpperCase()}: HTTP ${res.status}`);
      } catch (e) {
        console.error(`Claim ${tok.toUpperCase()} failed: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Swap tokens (promise chaining untuk approve & tx)
  async swapTokens() {
    for (const [name, router] of Object.entries(this.config.routers)) {
      console.log(`\n=== [${this.address.slice(0,6)}...] Swap ${name.toUpperCase()} ===`);
      const token = new Contract(this.config.tokens[name], erc20Abi, this.wallet);
      const raw   = await token.balanceOf(this.address);
      const bal   = BigNumber.from(raw);
      const dec   = await token.decimals();

      if (bal.isZero()) {
        console.log(`No ${name.toUpperCase()}`);
        continue;
      }

      // approve → swap
      token
        .approve(router, bal, { gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
        .then(tx => tx.wait())
        .then(() => {
          const mid  = this.config.methodIds[`${name}Swap`].slice(2);
          const amt  = bal.toHexString().slice(2).padStart(64, '0');
          const data = '0x' + mid + amt;
          return this.wallet.sendTransaction({ to: router, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice });
        })
        .then(tx => tx.wait())
        .then(() => {
          console.log(`Swapped ${formatUnits(bal, dec)} ${name.toUpperCase()}`);
        })
        .catch(err => {
          console.error(`Error swapping ${name.toUpperCase()}: ${err.message}`);
        });
    }
  }

  // Stake tokens (promise chaining)
  async stakeTokens() {
    for (const [name, stakeAddr] of Object.entries(this.config.stakeContracts)) {
      console.log(`\n=== [${this.address.slice(0,6)}...] Stake ${name.toUpperCase()} ===`);
      const token = new Contract(this.config.tokens[name], erc20Abi, this.wallet);
      const raw   = await token.balanceOf(this.address);
      const bal   = BigNumber.from(raw);
      const dec   = await token.decimals();

      if (bal.isZero()) {
        console.log(`No ${name.toUpperCase()} to stake`);
        continue;
      }

      token
        .approve(stakeAddr, bal, { gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice })
        .then(tx => tx.wait())
        .then(() => {
          const mid  = this.config.methodIds.stake.slice(2);
          const amt  = bal.toHexString().slice(2).padStart(64, '0');
          const data = '0x' + mid + amt;
          return this.wallet.sendTransaction({ to: stakeAddr, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice });
        })
        .then(tx => tx.wait())
        .then(() => {
          console.log(`Staked ${formatUnits(bal, dec)} ${name.toUpperCase()}`);
        })
        .catch(err => {
          console.error(`Error staking ${name.toUpperCase()}: ${err.message}`);
        });
    }
  }

  // Full flow
  async run() {
    await this.checkWalletStatus();
    await this.claimFaucets();
    await this.swapTokens();
    await this.stakeTokens();
    await this.checkWalletStatus();
  }
}

// ENTRY POINT
(async () => {
  const keys = getPrivateKeys();
  if (!keys.length) {
    console.error('No private keys found');
    return;
  }

  // Initial run with await
  for (const k of keys) {
    const bot = new WalletBot(k, globalConfig);
    await bot.run();
  }

  // Loop setiap 24 jam tanpa blocking
  setInterval(() => {
    for (const k of keys) {
      const bot = new WalletBot(k, globalConfig);
      bot.run().catch(console.error);
    }
  }, 24 * 60 * 60 * 1000);
})();
