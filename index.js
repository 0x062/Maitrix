// index.js
import fs from 'fs';
import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Destructuring core classes dari ethers
const { JsonRpcProvider, Wallet, Contract } = ethers;
// Fungsi util di ethers.utils
const { parseUnits, formatUnits } = ethers.utils;

const erc20Abi = JSON.parse(fs.readFileSync('./erc20Abi.json', 'utf-8'));
const config   = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const wallets  = process.env.PRIVATE_KEYS
  ? process.env.PRIVATE_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : [];

class WalletBot {
  constructor(privateKey) {
    this.provider = new JsonRpcProvider(config.rpc);
    this.wallet   = new Wallet(privateKey, this.provider);
    this.address  = this.wallet.address;
    this.config   = config;
  }

  async getEthBalance() {
    const bal = await this.provider.getBalance(this.address);
    return formatUnits(bal, 18);
  }

  async getTokenBalance(symbol) {
    const token = new Contract(this.config.tokens[symbol], erc20Abi, this.wallet);
    try {
      const raw = await token.balanceOf(this.address);
      if (!raw || raw.isZero()) {
        console.log(`No ${symbol.toUpperCase()} balance.`);
        return ethers.BigNumber.from("0");
      }
      return ethers.BigNumber.from(raw.toString());
    } catch (e) {
      console.error(`Failed to get ${symbol}:`, e.message);
      return ethers.BigNumber.from("0");
    }
  }

  async claimFaucets() {
    console.log(`\n=== [${this.address.slice(0,6)}...] Claim Faucets ===`);
    for (const [name, url] of Object.entries(this.config.faucets)) {
      try {
        const res = await axios.post(url, { address: this.address });
        console.log(`Claim ${name.toUpperCase()}: HTTP ${res.status}`);
      } catch (e) {
        console.log(`Claim ${name.toUpperCase()}: Failed (${e.message})`);
      }
    }
  }

  swapTokens() {
    for (const [name, router] of Object.entries(this.config.routers)) {
      console.log(`\n=== [${this.address.slice(0,6)}...] Swap ${name.toUpperCase()} ===`);
      const token = new Contract(this.config.tokens[name], erc20Abi, this.wallet);
      token.balanceOf(this.address)
        .then(raw => ethers.BigNumber.from(raw))
        .then(bal => {
          if (bal.isZero()) throw new Error('ZERO_BALANCE');
          return Promise.all([bal, token.decimals()]);
        })
        .then(([bal, dec]) => token.approve(router, bal, {
            gasLimit: this.config.gasLimit,
            gasPrice: this.config.gasPrice
          })
          .then(tx => tx.wait())
          .then(() => {
            const mid  = this.config.methodIds[`${name}Swap`].slice(2);
            const amt  = bal.toHexString().slice(2).padStart(64, '0');
            const data = '0x' + mid + amt;
            return this.wallet.sendTransaction({ to: router, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice });
          })
          .then(tx => tx.wait())
          .then(() => console.log(`Swapped ${formatUnits(bal, dec)} ${name.toUpperCase()}`))
        )
        .catch(err => {
          if (err.message === 'ZERO_BALANCE') {
            console.log(`No ${name.toUpperCase()}`);
          } else {
            console.error(`Swap ${name.toUpperCase()} error:`, err.message);
          }
        });
    }
  }

  stakeTokens() {
    for (const [name, stakeAddr] of Object.entries(this.config.stakeContracts)) {
      console.log(`\n=== [${this.address.slice(0,6)}...] Stake ${name.toUpperCase()} ===`);
      const token = new Contract(this.config.tokens[name], erc20Abi, this.wallet);
      token.balanceOf(this.address)
        .then(raw => ethers.BigNumber.from(raw))
        .then(bal => {
          if (bal.isZero()) throw new Error('ZERO_BALANCE');
          return Promise.all([bal, token.decimals()]);
        })
        .then(([bal, dec]) => token.approve(stakeAddr, bal, {
            gasLimit: this.config.gasLimit,
            gasPrice: this.config.gasPrice
          })
          .then(tx => tx.wait())
          .then(() => {
            const mid  = this.config.methodIds.stake.slice(2);
            const amt  = bal.toHexString().slice(2).padStart(64, '0');
            const data = '0x' + mid + amt;
            return this.wallet.sendTransaction({ to: stakeAddr, data, gasLimit: this.config.gasLimit, gasPrice: this.config.gasPrice });
          })
          .then(tx => tx.wait())
          .then(() => console.log(`Staked ${formatUnits(bal, dec)} ${name.toUpperCase()}`))
        )
        .catch(err => {
          if (err.message === 'ZERO_BALANCE') {
            console.log(`No ${name.toUpperCase()} to stake`);
          } else {
            console.error(`Stake ${name.toUpperCase()} error:`, err.message);
          }
        });
    }
  }

  async run() {
    // 1) Tampilkan ETH + setiap token balance
    const ethBal = await this.getEthBalance();
    console.log(`\nETH: ${ethBal}`);
    for (const symbol of Object.keys(this.config.tokens)) {
      const bal = await this.getTokenBalance(symbol);
      const dec = await new Contract(this.config.tokens[symbol], erc20Abi, this.wallet).decimals();
      console.log(`${symbol.toUpperCase()}: ${formatUnits(bal, dec)}`);
    }

    // 2) Claim faucets
    await this.claimFaucets();

    // 3) Swap & stake
    this.swapTokens();
    this.stakeTokens();
  }
}

// IIFE untuk menjalankan bot
(async () => {
  if (!wallets.length) {
    console.error('No wallets in wallets.json');
    return;
  }

  for (const pk of wallets) {
    const bot = new WalletBot(pk);
    await bot.run();
  }
})();
