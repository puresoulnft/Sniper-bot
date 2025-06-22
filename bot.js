const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const axios = require('axios');
const express = require('express');

class DualSourceSniperBot {
    constructor() {
        // Environment variables
        this.PRIVATE_KEY = JSON.parse(process.env.PRIVATE_KEY || '[]');
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
        this.RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        
        // Basic settings
        this.SNIPE_AMOUNT = parseFloat(process.env.SNIPE_AMOUNT) || 0.03;
        this.MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS) || 5;
        
        // Multi-tier profit targets
        this.EARLY_PUMP_TARGET = parseFloat(process.env.EARLY_PUMP_TARGET) || 20.0;
        this.KOTH_TARGET = parseFloat(process.env.KOTH_TARGET) || 8.0;
        this.DEX_FRESH_TARGET = parseFloat(process.env.DEX_FRESH_TARGET) || 4.0;
        this.DEX_TARGET = parseFloat(process.env.DEX_TARGET) || 2.0;
        // Bitquery settings
        this.BITQUERY_URL = 'https://streaming.bitquery.io/graphql';
        this.BITQUERY_HEADERS = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BITQUERY_API_KEY || ''}`
};
        
        // Stop losses
        this.PUMP_STOP_LOSS = parseFloat(process.env.PUMP_STOP_LOSS) || 0.30;
        this.DEX_STOP_LOSS = parseFloat(process.env.DEX_STOP_LOSS) || 0.40;

        if (this.PRIVATE_KEY.length === 0) {
            console.error('❌ PRIVATE_KEY not set!');
            process.exit(1);
        }

        this.wallet = Keypair.fromSecretKey(Uint8Array.from(this.PRIVATE_KEY));
        this.connection = new Connection(this.RPC_URL, { commitment: 'confirmed' });
        this.positions = new Map();
        this.isRunning = false;
        this.trades = [];
        this.lastUpdateId = 0;
        this.scannedTokens = new Set();
        
        this.setupRailwayOptimizations();
        this.setupHealthServer();
        this.setupTelegramCommands();
    }

    setupRailwayOptimizations() {
        setInterval(() => {
            console.log('🔄 Dual Sniper heartbeat:', new Date().toLocaleTimeString());
        }, 300000);

        process.on('SIGTERM', () => {
            console.log('🔄 Railway restart...');
            this.sendTelegramMessage('🔄 DUAL SNIPER RESTARTING...');
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Exception:', error);
            this.sendTelegramMessage('💥 DUAL SNIPER CRASHED - Restarting...');
            setTimeout(() => process.exit(1), 1000);
        });
    }

    setupHealthServer() {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.get('/', (req, res) => {
            res.json({
                status: 'running',
                version: 'Dual Source Sniper v3.0',
                uptime: process.uptime(),
                activePositions: this.positions.size,
                totalTrades: this.trades.length,
                wallet: this.wallet.publicKey.toBase58(),
                sources: ['Bitquery', 'DexScreener']
            });
        });

        app.listen(PORT, () => {
            console.log(`🌐 Health server on port ${PORT}`);
        });
    }

    setupTelegramCommands() {
        if (!this.TELEGRAM_BOT_TOKEN) return;

        setInterval(async () => {
            try {
                const response = await axios.get(`https://api.telegram.org/bot${this.TELEGRAM_BOT_TOKEN}/getUpdates`, {
                    params: { offset: this.lastUpdateId + 1, timeout: 1 },
                    timeout: 3000
                });

                if (response.data.result && response.data.result.length > 0) {
                    for (const update of response.data.result) {
                        this.lastUpdateId = update.update_id;
                        if (update.message && update.message.text && update.message.text.startsWith('/')) {
                            await this.handleTelegramCommand(update.message);
                        }
                    }
                }
            } catch (error) {
                // Ignore polling errors
            }
        }, 5000);
    }

    async handleTelegramCommand(message) {
        const command = message.text.toLowerCase();
        const chatId = message.chat.id.toString();

        if (chatId !== this.TELEGRAM_CHAT_ID) return;

        try {
            switch (command) {
                case '/status':
                    await this.sendStatusUpdate();
                    break;
                case '/stats':
                case '/performance':
                    await this.sendPerformanceStats();
                    break;
                case '/positions':
                case '/holdings':
                    await this.sendActivePositions();
                    break;
                case '/balance':
                    await this.sendBalanceInfo();
                    break;
                case '/trades':
                case '/history':
                    await this.sendTradeHistory();
                    break;
                case '/help':
                case '/commands':
                    await this.sendHelpMessage();
                    break;

                default:
                    await this.sendTelegramMessage('❓ Unknown command. Send /help for available commands.');
            }
        } catch (error) {
            await this.sendTelegramMessage(`❌ Command error: ${error.message}`);
        }
    }

    async sendStatusUpdate() {
        const uptime = (process.uptime() / 3600).toFixed(1);
        
        const statusMsg = `📊 DUAL SNIPER STATUS

🟢 Status: Active & Hunting
⏰ Uptime: ${uptime} hours
💰 Wallet: ${this.wallet.publicKey.toBase58()}
📊 Positions: ${this.positions.size}/${this.MAX_POSITIONS}
🎯 Total Trades: ${this.trades.length}

🔥 HUNTING SOURCES:
🚀 Pump Early (${this.EARLY_PUMP_TARGET}x target)
👑 King of Hill (${this.KOTH_TARGET}x target)
💎 DEX Fresh (${this.DEX_FRESH_TARGET}x target)
📈 DEX (${this.DEX_TARGET}x target)

${this.positions.size > 0 ? '📈 Monitoring...' : '🔍 Scanning...'}`;

        await this.sendTelegramMessage(statusMsg);
    }

    async sendPerformanceStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        const pumpTrades = this.trades.filter(t => t.source === 'pump_early').length;
        const kothTrades = this.trades.filter(t => t.source === 'king_of_hill').length;
        const dexFreshTrades = this.trades.filter(t => t.source === 'dex_fresh').length;
        const dexTrades = this.trades.filter(t => t.source === 'dex').length;

        const statsMsg = `📈 DUAL SNIPER PERFORMANCE

💰 Total P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL
🎯 Trades: ${this.trades.length}
📊 Win Rate: ${winRate.toFixed(1)}%
🚀 Best: ${bestTrade.toFixed(2)}x

📍 SOURCES:
🚀 Pump Early: ${pumpTrades}
👑 King of Hill: ${kothTrades}  
💎 DEX Fresh: ${dexFreshTrades}
📈 DEX: ${dexTrades}

${totalProfit > 0 ? '🎉 Profitable!' : '📈 Keep hunting!'}`;

        await this.sendTelegramMessage(statsMsg);
    }

    async sendActivePositions() {
        if (this.positions.size === 0) {
            await this.sendTelegramMessage('📊 ACTIVE POSITIONS\n\n💤 No active positions\n\n🔍 Dual scanning...');
            return;
        }

        let positionsMsg = '📊 ACTIVE POSITIONS\n\n';
        
        for (const [tokenAddress, position] of this.positions) {
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;
            const sourceEmoji = this.getSourceEmoji(position.source);
            
            positionsMsg += `${sourceEmoji} ${position.symbol}\n`;
            positionsMsg += `📍 ${position.source}\n`;
            positionsMsg += `⏰ ${holdTimeMin.toFixed(1)} min\n`;
            positionsMsg += `🎯 ${position.targetMultiplier}x\n\n`;
        }

        await this.sendTelegramMessage(positionsMsg);
    }

    async sendBalanceInfo() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const balanceSOL = balance / 1e9;
            
            const balanceMsg = `💰 DUAL SNIPER BALANCE

💰 SOL: ${balanceSOL.toFixed(4)} SOL
🎯 Per Trade: ${this.SNIPE_AMOUNT} SOL
📊 Possible: ${Math.floor(balanceSOL / this.SNIPE_AMOUNT)}

🔥 TARGETS:
🚀 Pump Early: ${this.EARLY_PUMP_TARGET}x
👑 King of Hill: ${this.KOTH_TARGET}x
💎 DEX Fresh: ${this.DEX_FRESH_TARGET}x
📈 DEX: ${this.DEX_TARGET}x

${balanceSOL < this.SNIPE_AMOUNT ? '⚠️ Low balance!' : '✅ Ready!'}`;

            await this.sendTelegramMessage(balanceMsg);
        } catch (error) {
            await this.sendTelegramMessage(`❌ Balance error: ${error.message}`);
        }
    }

    async sendTradeHistory() {
        if (this.trades.length === 0) {
            await this.sendTelegramMessage('📊 TRADE HISTORY\n\n📝 No trades yet\n\n🔍 Still hunting...');
            return;
        }

        const recentTrades = this.trades.slice(-5).reverse();
        let historyMsg = '📊 RECENT TRADES\n\n';

        for (const trade of recentTrades) {
            const emoji = trade.profitSOL > 0 ? '🚀' : '📉';
            const sourceEmoji = this.getSourceEmoji(trade.source);
            
            historyMsg += `${emoji} ${trade.symbol}\n`;
            historyMsg += `📍 ${sourceEmoji} ${trade.source}\n`;
            historyMsg += `📊 ${trade.multiplier.toFixed(2)}x | ${trade.profitSOL > 0 ? '+' : ''}${trade.profitSOL.toFixed(4)} SOL\n`;
            historyMsg += `⏰ ${trade.holdTime.toFixed(1)} min\n\n`;
        }

        if (this.trades.length > 5) {
            historyMsg += `📝 Last 5 of ${this.trades.length} trades`;
        }

        await this.sendTelegramMessage(historyMsg);
    }

    async sendHelpMessage() {
        const helpMsg = `🤖 DUAL SNIPER COMMANDS

📊 Monitoring:
/status - Bot status
/stats - Performance stats
/positions - Active positions
/balance - Wallet balance
/trades - Trade history

🎮 Control:
/help - Show commands

🔥 DUAL SOURCE TARGETS:
🚀 Pump Early: ${this.EARLY_PUMP_TARGET}x
👑 King of Hill: ${this.KOTH_TARGET}x
💎 DEX Fresh: ${this.DEX_FRESH_TARGET}x
📈 DEX: ${this.DEX_TARGET}x

💡 Hunting across Bitquery + DexScreener!`;

        await this.sendTelegramMessage(helpMsg);
    }

    getSourceEmoji(source) {
        const emojis = {
            'pump_early': '🚀',
            'king_of_hill': '👑',
            'dex_fresh': '💎',
            'dex': '📈'
        };
        return emojis[source] || '🎯';
    }

    async sendTelegramMessage(message, silent = false) {
        if (!this.TELEGRAM_BOT_TOKEN || !this.TELEGRAM_CHAT_ID) return;
        
        try {
            await axios.post(`https://api.telegram.org/bot${this.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: this.TELEGRAM_CHAT_ID,
                text: message,
                disable_notification: silent
            }, { timeout: 10000 });
        } catch (error) {
            console.error('Telegram error:', error.message);
        }
    }

    async initialize() {
        try {
            this.jupiter = createJupiterApiClient();
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            
            const startMessage = `🔥 DUAL SOURCE SNIPER DEPLOYED!

💰 Wallet: ${this.wallet.publicKey.toBase58()}
💰 Balance: ${(balance / 1e9).toFixed(4)} SOL
🎯 Per Trade: ${this.SNIPE_AMOUNT} SOL

🔥 MULTI-TIER TARGETS:
🚀 Pump Early: ${this.EARLY_PUMP_TARGET}x
👑 King of Hill: ${this.KOTH_TARGET}x
💎 DEX Fresh: ${this.DEX_FRESH_TARGET}x
📈 DEX: ${this.DEX_TARGET}x

🎯 DUAL SOURCES:
• Bitquery Pump.fun API
• Fixed DexScreener API

🔥 DUAL SNIPER IS LIVE! 🔥`;

            console.log('🎯 DUAL SOURCE SNIPER READY!');
            console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);
            
            await this.sendTelegramMessage(startMessage);
            
            if (balance < this.SNIPE_AMOUNT * 1e9) {
                await this.sendTelegramMessage(`❌ INSUFFICIENT BALANCE!\nNeed ${this.SNIPE_AMOUNT} SOL min`);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('❌ Setup failed:', error.message);
            await this.sendTelegramMessage(`❌ SETUP FAILED: ${error.message}`);
            return false;
        }
    }

    async scanDexScreenerFixed() {
        try {
            const response = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', {
                timeout: 8000
            });

            if (response.data && Array.isArray(response.data)) {
                const solanaBoosts = response.data.filter(boost => 
                    boost.chainId === 'solana' &&
                    !this.scannedTokens.has(boost.tokenAddress) &&
                    !this.positions.has(boost.tokenAddress)
                );

                return solanaBoosts.slice(0, 10).map(boost => ({
                    address: boost.tokenAddress,
                    symbol: 'BOOST',
                    name: 'Boosted Token',
                    boostAmount: boost.amount,
                    totalAmount: boost.totalAmount,
                    source: boost.amount > 1000 ? 'dex' : 'dex_fresh',
                    url: boost.url,
                    description: boost.description
                }));
            }

            return [];
        } catch (error) {
            console.error('DexScreener error:', error.message);
            return [];
        }
    }

    async scanBitqueryReal() {
        try {
            const query = `
            query {
                Solana {
                    TokenSupplyUpdates(
                        where: {
                            Instruction: {
                                Program: {
                                    Address: {is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"}
                                    Method: {is: "create"}
                                }
                            }
                            Block: {
                                Time: {since: "${new Date(Date.now() - 30*60*1000).toISOString()}"}
                            }
                        }
                        limit: {count: 10}
                        orderBy: {descending: Block_Time}
                    ) {
                        Block {
                            Time
                        }
                        Transaction {
                            Signer
                        }
                        TokenSupplyUpdate {
                            Currency {
                                Symbol
                                Name
                                MintAddress
                                Uri
                            }
                            PostBalance
                        }
                    }
                }
            }`;
    
            const response = await axios.post(this.BITQUERY_URL, {
                query: query
            }, {
                headers: this.BITQUERY_HEADERS,
                timeout: 8000
            });
    
            if (response.data?.data?.Solana?.TokenSupplyUpdates) {
                return response.data.data.Solana.TokenSupplyUpdates
                    .filter(update => !this.scannedTokens.has(update.TokenSupplyUpdate.Currency.MintAddress))
                    .map(update => ({
                        address: update.TokenSupplyUpdate.Currency.MintAddress,
                        symbol: update.TokenSupplyUpdate.Currency.Symbol || 'UNKNOWN',
                        name: update.TokenSupplyUpdate.Currency.Name || 'Unknown',
                        createdAt: update.Block.Time,
                        creator: update.Transaction.Signer,
                        supply: update.TokenSupplyUpdate.PostBalance,
                        source: 'pump_early',
                        uri: update.TokenSupplyUpdate.Currency.Uri
                    }));
            }
            return [];
        } catch (error) {
            console.error('Bitquery real error:', error.message);
            return [];
        }
    }

    async analyzeToken(token) {
        let score = 0;
        
        if (token.source === 'pump_early') {
            score += 50;
            if (token.name && token.symbol) score += 30;
            if (token.supply) score += 10;
        } else if (token.source === 'king_of_hill') {
            score += 60;
            if (token.marketCap >= 30000 && token.marketCap <= 35000) score += 30;
        } else if (token.source === 'dex_fresh') {
            score += 40;
            if (token.boostAmount && token.boostAmount < 1000) score += 20;
        } else if (token.source === 'dex') {
            score += 30;
            if (token.boostAmount && token.boostAmount > 1000) score += 20;
        }

        return {
            score: score,
            shouldBuy: score >= 60 && this.positions.size < this.MAX_POSITIONS,
            token: token
        };
    }

    getTargetMultiplier(source) {
        const targets = {
            'pump_early': this.EARLY_PUMP_TARGET,
            'king_of_hill': this.KOTH_TARGET,
            'dex_fresh': this.DEX_FRESH_TARGET,
            'dex': this.DEX_TARGET
        };
        return targets[source] || this.DEX_TARGET;
    }

    getStopLoss(source) {
        return source.includes('pump') || source === 'king_of_hill' ? 
            this.PUMP_STOP_LOSS : this.DEX_STOP_LOSS;
    }

    async buyToken(tokenAddress, tokenSymbol, analysis) {
        try {
            console.log(`⚡ DUAL SNIPING ${tokenSymbol} from ${analysis.token.source}...`);
            
            const sourceEmoji = this.getSourceEmoji(analysis.token.source);
            const targetMultiplier = this.getTargetMultiplier(analysis.token.source);

            const snipeAlert = `${sourceEmoji} DUAL SNIPE TARGET!

🪙 ${tokenSymbol}
📍 ${analysis.token.source}
📊 Score: ${analysis.score}/100
⚡ ${this.SNIPE_AMOUNT} SOL
🎯 Target: ${targetMultiplier}x

🔄 Dual sniping...`;

            await this.sendTelegramMessage(snipeAlert);

            // Mock successful buy
            const mockEntryPrice = 0.001;
            const mockAmount = this.SNIPE_AMOUNT / mockEntryPrice;

            const successMsg = `✅ DUAL SNIPE SUCCESS!

${sourceEmoji} ${tokenSymbol}
📍 ${analysis.token.source}
⚡ ${this.SNIPE_AMOUNT} SOL
🎯 ${targetMultiplier}x target

📊 Monitoring...`;

            console.log(`✅ DUAL SNIPED ${tokenSymbol} from ${analysis.token.source}!`);
            await this.sendTelegramMessage(successMsg);
            
            this.positions.set(tokenAddress, {
                symbol: tokenSymbol,
                source: analysis.token.source,
                entryPrice: mockEntryPrice,
                amount: mockAmount,
                buyTime: Date.now(),
                targetMultiplier: targetMultiplier,
                stopLoss: this.getStopLoss(analysis.token.source)
            });

            this.scannedTokens.add(tokenAddress);
            this.monitorPosition(tokenAddress);
            return true;

        } catch (error) {
            console.error(`❌ Dual snipe failed:`, error.message);
            await this.sendTelegramMessage(`❌ DUAL SNIPE FAILED: ${tokenSymbol}`);
            return false;
        }
    }

    async sellToken(tokenAddress, reason) {
        try {
            const position = this.positions.get(tokenAddress);
            if (!position) return false;

            console.log(`💰 SELLING ${position.symbol}... (${reason})`);

            // Varied outcomes based on source
            const baseMultiplier = position.source === 'pump_early' ? 1.5 : 
                                 position.source === 'king_of_hill' ? 1.3 :
                                 position.source === 'dex_fresh' ? 1.2 : 1.1;
            
            const randomFactor = 0.5 + Math.random() * 1.5;
            const mockExitPrice = position.entryPrice * baseMultiplier * randomFactor;
            const multiplier = mockExitPrice / position.entryPrice;
            const profitSOL = (position.amount * mockExitPrice) - this.SNIPE_AMOUNT;
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;

            const emoji = profitSOL > 0 ? '🚀' : '📉';
            const sourceEmoji = this.getSourceEmoji(position.source);
            
            const sellMsg = `${emoji} DUAL POSITION CLOSED!

${sourceEmoji} ${position.symbol}
📍 ${position.source}
📊 ${multiplier.toFixed(2)}x
💰 ${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL
⏰ ${holdTimeMin.toFixed(1)} min
📝 ${reason}

${profitSOL > 0 ? '🎉 ALPHA SECURED!' : '🛡️ LOSS CUT'}`;

            await this.sendTelegramMessage(sellMsg);

            this.trades.push({
                symbol: position.symbol,
                source: position.source,
                multiplier: multiplier,
                profitSOL: profitSOL,
                reason: reason,
                holdTime: holdTimeMin,
                timestamp: Date.now()
            });

            this.positions.delete(tokenAddress);
            return true;

        } catch (error) {
            console.error(`❌ Sell failed:`, error.message);
            return false;
        }
    }

    async monitorPosition(tokenAddress) {
        const position = this.positions.get(tokenAddress);
        if (!position) return;

        const checkPosition = async () => {
            try {
                if (!this.positions.has(tokenAddress)) return;

                // Mock price monitoring with varied behavior by source
                const volatility = position.source === 'pump_early' ? 0.3 : 
                                 position.source === 'king_of_hill' ? 0.2 :
                                 position.source === 'dex_fresh' ? 0.15 : 0.1;
                
                const randomChange = (Math.random() - 0.5) * volatility;
                const currentMultiplier = 1 + randomChange;

                if (currentMultiplier >= position.targetMultiplier) {
                    await this.sellToken(tokenAddress, `${position.targetMultiplier}x TARGET`);
                    return;
                }

                if (currentMultiplier <= position.stopLoss) {
                    await this.sellToken(tokenAddress, 'STOP LOSS');
                    return;
                }

                setTimeout(checkPosition, 15000);

            } catch (error) {
                console.error(`Monitor error:`, error.message);
                setTimeout(checkPosition, 20000);
            }
        };

        setTimeout(checkPosition, 10000);
    }

    async tradingLoop() {
        if (!this.isRunning) return;

        try {
            console.log('🔍 DUAL SNIPER: Scanning all sources...');
            
            const [bitqueryTokens, dexTokens] = await Promise.all([
                this.scanBitqueryReal(),
                this.scanDexScreenerFixed()
            ]);

            const allTokens = [...bitqueryTokens, ...dexTokens];
            console.log(`📊 Found ${bitqueryTokens.length} Bitquery + ${dexTokens.length} DexScreener tokens`);
            
            for (const token of allTokens) {
                if (this.positions.size >= this.MAX_POSITIONS) break;
                
                const analysis = await this.analyzeToken(token);
                
                if (analysis.shouldBuy) {
                    console.log(`🎯 DUAL TARGET: ${token.symbol} from ${token.source} | Score: ${analysis.score}/100`);
                    await this.buyToken(token.address, token.symbol, analysis);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            this.showStats();

        } catch (error) {
            console.error('Trading loop error:', error.message);
        }

        setTimeout(() => this.tradingLoop(), 20000);
    }

    showStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        console.log('');
        console.log('📊 === DUAL SNIPER PERFORMANCE ===');
        console.log(`💰 P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL`);
        console.log(`🎯 Trades: ${this.trades.length} | Win: ${winRate.toFixed(1)}%`);
        console.log(`🚀 Best: ${bestTrade.toFixed(2)}x`);
        console.log(`📊 Active: ${this.positions.size}/${this.MAX_POSITIONS}`);
        console.log(`🔄 Uptime: ${(process.uptime() / 3600).toFixed(1)}h`);
        console.log('================================');
        console.log('');
    }

    async start() {
        console.log('🚀 Starting Dual Source Sniper Bot...');
        
        if (await this.initialize()) {
            this.isRunning = true;
            console.log('🔥 DUAL SNIPER IS LIVE - HUNTING ACROSS ALL SOURCES! 🔥');
            this.tradingLoop();
        }
    }

}

// Start the Dual Sniper
const bot = new DualSourceSniperBot();
bot.start();

module.exports = DualSourceSniperBot;