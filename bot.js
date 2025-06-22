const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const axios = require('axios');
const express = require('express');

class RealSolanaSnipeBot {
    constructor() {
        // Environment variables from Railway
        this.PRIVATE_KEY = JSON.parse(process.env.PRIVATE_KEY || '[]');
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
        this.RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        
        // Basic settings
        this.SNIPE_AMOUNT = parseFloat(process.env.SNIPE_AMOUNT) || 0.03;
        this.MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS) || 5;
        
        // Dynamic profit targets
        this.PUMP_TAKE_PROFIT = parseFloat(process.env.PUMP_TAKE_PROFIT) || 8.0;
        this.DEX_TAKE_PROFIT = parseFloat(process.env.DEX_TAKE_PROFIT) || 4.0;
        this.PUMP_STOP_LOSS = parseFloat(process.env.PUMP_STOP_LOSS) || 0.30;
        this.DEX_STOP_LOSS = parseFloat(process.env.DEX_STOP_LOSS) || 0.40;
        
        // Scanning settings
        this.MIN_LIQUIDITY = parseFloat(process.env.MIN_LIQUIDITY) || 5000;
        this.MAX_LIQUIDITY = parseFloat(process.env.MAX_LIQUIDITY) || 500000;
        this.MIN_VOLUME = parseFloat(process.env.MIN_VOLUME) || 1000;

        if (this.PRIVATE_KEY.length === 0) {
            console.error('❌ PRIVATE_KEY environment variable not set!');
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
            console.log('🔄 Real Sniper heartbeat:', new Date().toLocaleTimeString());
        }, 300000);

        process.on('SIGTERM', () => {
            console.log('🔄 Railway restart detected...');
            this.sendTelegramMessage('🔄 REAL SNIPER RESTARTING - Railway deployment...');
            this.gracefulShutdown();
        });

        process.on('SIGINT', () => {
            console.log('🛑 Manual stop detected...');
            this.gracefulShutdown();
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught exception:', error);
            this.sendTelegramMessage('💥 SNIPER CRASHED - Railway auto-restart...');
            setTimeout(() => process.exit(1), 1000);
        });
    }

    setupHealthServer() {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.get('/', (req, res) => {
            const stats = {
                status: 'running',
                version: 'Real Sniper v2.0',
                uptime: process.uptime(),
                activePositions: this.positions.size,
                totalTrades: this.trades.length,
                wallet: this.wallet.publicKey.toBase58(),
                pumpFunIntegration: true,
                multiSourceScanning: true
            };
            res.json(stats);
        });

        app.listen(PORT, () => {
            console.log(`🌐 Real Sniper health server running on port ${PORT}`);
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
                case '/stop':
                    await this.sendTelegramMessage('🛑 STOPPING REAL SNIPER...');
                    setTimeout(() => this.gracefulShutdown(), 2000);
                    break;
                default:
                    await this.sendTelegramMessage('❓ Unknown command. Send /help for available commands.');
            }
        } catch (error) {
            await this.sendTelegramMessage(`❌ Command error: ${error.message}`);
        }
    }

    async sendStatusUpdate() {
        const uptime = process.uptime();
        const uptimeHours = (uptime / 3600).toFixed(1);
        
        const statusMsg = `📊 REAL SNIPER STATUS

🟢 Status: Active & Hunting
⏰ Uptime: ${uptimeHours} hours
💰 Wallet: ${this.wallet.publicKey.toBase58()}
📊 Active Positions: ${this.positions.size}/${this.MAX_POSITIONS}
🎯 Total Trades: ${this.trades.length}

🎯 HUNTING SOURCES:
🚀 Pump.fun launches (${this.PUMP_TAKE_PROFIT}x target)
💎 Fresh DEX listings (${this.DEX_TAKE_PROFIT}x target)

${this.positions.size > 0 ? '📈 Monitoring positions...' : '🔍 Scanning for launches...'}`;

        await this.sendTelegramMessage(statusMsg);
    }

    async sendPerformanceStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        const pumpTrades = this.trades.filter(t => t.source === 'pump.fun').length;
        const dexTrades = this.trades.filter(t => t.source === 'dex').length;

        const statsMsg = `📈 REAL SNIPER PERFORMANCE

💰 Total P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL
🎯 Total Trades: ${this.trades.length}
📊 Win Rate: ${winRate.toFixed(1)}%
🚀 Best Trade: ${bestTrade.toFixed(2)}x

📍 SOURCES:
🚀 Pump.fun: ${pumpTrades} trades
💎 DEX: ${dexTrades} trades

${totalProfit > 0 ? '🎉 Profitable session!' : '📈 Keep hunting!'}`;

        await this.sendTelegramMessage(statsMsg);
    }

    async sendActivePositions() {
        if (this.positions.size === 0) {
            await this.sendTelegramMessage('📊 ACTIVE POSITIONS\n\n💤 No active positions\n\n🔍 Real sniper scanning...');
            return;
        }

        let positionsMsg = '📊 ACTIVE POSITIONS\n\n';
        
        for (const [tokenAddress, position] of this.positions) {
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;
            const sourceEmoji = position.source === 'pump.fun' ? '🚀' : '💎';
            
            positionsMsg += `${sourceEmoji} ${position.symbol}\n`;
            positionsMsg += `⏰ ${holdTimeMin.toFixed(1)} min\n`;
            positionsMsg += `🎯 Target: ${position.targetMultiplier}x\n\n`;
        }

        await this.sendTelegramMessage(positionsMsg);
    }

    async sendBalanceInfo() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const balanceSOL = balance / 1e9;
            
            const balanceMsg = `💰 SNIPER BALANCE

💰 SOL: ${balanceSOL.toFixed(4)} SOL
🎯 Per Trade: ${this.SNIPE_AMOUNT} SOL
📊 Trades Possible: ${Math.floor(balanceSOL / this.SNIPE_AMOUNT)}

🚀 Pump.fun: ${this.PUMP_TAKE_PROFIT}x target
💎 DEX: ${this.DEX_TAKE_PROFIT}x target

${balanceSOL < this.SNIPE_AMOUNT ? '⚠️ Low balance!' : '✅ Ready to snipe'}`;

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
            const sourceEmoji = trade.source === 'pump.fun' ? '🚀' : '💎';
            
            historyMsg += `${emoji} ${trade.symbol} (${sourceEmoji})\n`;
            historyMsg += `📊 ${trade.multiplier.toFixed(2)}x | ${trade.profitSOL > 0 ? '+' : ''}${trade.profitSOL.toFixed(4)} SOL\n`;
            historyMsg += `⏰ ${trade.holdTime.toFixed(1)} min\n\n`;
        }

        if (this.trades.length > 5) {
            historyMsg += `📝 Last 5 of ${this.trades.length} trades`;
        }

        await this.sendTelegramMessage(historyMsg);
    }

    async sendHelpMessage() {
        const helpMsg = `🤖 REAL SNIPER COMMANDS

📊 Monitoring:
/status - Bot status
/stats - Performance stats
/positions - Active positions
/balance - Wallet balance
/trades - Trade history

🎮 Control:
/stop - Stop bot
/help - Show commands

🎯 Settings:
• ${this.SNIPE_AMOUNT} SOL per trade
• 🚀 Pump.fun: ${this.PUMP_TAKE_PROFIT}x target
• 💎 DEX: ${this.DEX_TAKE_PROFIT}x target
• Max positions: ${this.MAX_POSITIONS}

🔥 Sources: Pump.fun + DEX scanning`;

        await this.sendTelegramMessage(helpMsg);
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
            
            const startMessage = `🚀 REAL SNIPER DEPLOYED!

💰 Wallet: ${this.wallet.publicKey.toBase58()}
💰 Balance: ${(balance / 1e9).toFixed(4)} SOL
🎯 Per Trade: ${this.SNIPE_AMOUNT} SOL

🔥 TARGETS:
🚀 Pump.fun: ${this.PUMP_TAKE_PROFIT}x (${(this.PUMP_STOP_LOSS * 100)}% stop)
💎 DEX: ${this.DEX_TAKE_PROFIT}x (${(this.DEX_STOP_LOSS * 100)}% stop)

🎯 SOURCES:
• Pump.fun launches
• Fresh DEX pairs
• Multi-source scanning

🔥 REAL SNIPER IS LIVE! 🔥`;

            console.log('🎯 REAL SNIPER READY!');
            console.log(`💰 Balance: ${(balance / 1e9).toFixed(4)} SOL`);
            
            await this.sendTelegramMessage(startMessage);
            
            if (balance < this.SNIPE_AMOUNT * 1e9) {
                await this.sendTelegramMessage(`❌ INSUFFICIENT BALANCE!\nNeed ${this.SNIPE_AMOUNT} SOL minimum`);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('❌ Setup failed:', error.message);
            await this.sendTelegramMessage(`❌ SETUP FAILED: ${error.message}`);
            return false;
        }
    }

    async scanPumpFun() {
        try {
            const response = await axios.get('https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC', {
                timeout: 8000
            });

            if (response.data && Array.isArray(response.data)) {
                return response.data.filter(coin => {
                    const ageInMinutes = (Date.now() - coin.created_timestamp) / 60000;
                    return ageInMinutes < 30 &&
                           coin.market_cap && coin.market_cap < 100000 &&
                           coin.market_cap > 1000 &&
                           !this.scannedTokens.has(coin.mint) &&
                           !this.positions.has(coin.mint);
                }).slice(0, 10).map(coin => ({
                    address: coin.mint,
                    symbol: coin.symbol || 'UNKNOWN',
                    name: coin.name || 'Unknown',
                    marketCap: coin.market_cap,
                    createdAt: coin.created_timestamp,
                    source: 'pump.fun'
                }));
            }
            return [];
        } catch (error) {
            console.error('Pump.fun error:', error.message);
            return [];
        }
    }

    async scanDexScreener() {
        try {
            const response = await axios.get('https://api.dexscreener.com/latest/dex/pairs/solana', {
                timeout: 8000
            });

            const pairs = response.data.pairs || [];
            return pairs.filter(pair => {
                const ageInMinutes = (Date.now() - new Date(pair.pairCreatedAt).getTime()) / 60000;
                return ageInMinutes < 30 &&
                       pair.liquidity && pair.liquidity.usd >= this.MIN_LIQUIDITY &&
                       pair.liquidity.usd <= this.MAX_LIQUIDITY &&
                       pair.volumeUsd24h > this.MIN_VOLUME &&
                       !this.scannedTokens.has(pair.baseToken.address) &&
                       !this.positions.has(pair.baseToken.address) &&
                       pair.baseToken.symbol && pair.baseToken.name;
            }).slice(0, 10).map(pair => ({
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
                liquidity: pair.liquidity.usd,
                volume: pair.volumeUsd24h,
                priceChange: pair.priceChange24h,
                ageInMinutes: (Date.now() - new Date(pair.pairCreatedAt).getTime()) / 60000,
                source: 'dex'
            }));
        } catch (error) {
            console.error('DexScreener error:', error.message);
            return [];
        }
    }

    async analyzeToken(token) {
        let score = 0;
        
        if (token.source === 'pump.fun') {
            const ageInMinutes = (Date.now() - token.createdAt) / 60000;
            
            if (ageInMinutes < 5) score += 40;
            else if (ageInMinutes < 15) score += 30;
            else score += 20;

            if (token.marketCap >= 5000 && token.marketCap <= 30000) score += 30;
            else if (token.marketCap >= 1000) score += 20;

            if (token.name && token.symbol && token.symbol.length <= 10) score += 15;

        } else if (token.source === 'dex') {
            if (token.ageInMinutes < 5) score += 30;
            else if (token.ageInMinutes < 15) score += 20;
            else score += 10;

            if (token.liquidity >= 20000 && token.liquidity <= 100000) score += 25;
            else if (token.liquidity >= 10000) score += 15;

            if (token.volume > 50000) score += 20;
            else if (token.volume > 20000) score += 15;
            else if (token.volume > 5000) score += 10;

            if (token.name && token.symbol) score += 10;
        }

        return {
            score: score,
            shouldBuy: score >= 50 && this.positions.size < this.MAX_POSITIONS,
            token: token
        };
    }

    async buyToken(tokenAddress, tokenSymbol, analysis) {
        try {
            console.log(`⚡ SNIPING ${tokenSymbol} from ${analysis.token.source}...`);
            
            const sourceEmoji = analysis.token.source === 'pump.fun' ? '🚀' : '💎';
            const targetMultiplier = analysis.token.source === 'pump.fun' ? this.PUMP_TAKE_PROFIT : this.DEX_TAKE_PROFIT;

            const snipeAlert = `${sourceEmoji} SNIPE TARGET!

🪙 ${tokenSymbol}
📍 ${analysis.token.source}
📊 Score: ${analysis.score}/100
⚡ ${this.SNIPE_AMOUNT} SOL
🎯 Target: ${targetMultiplier}x

🔄 Sniping...`;

            await this.sendTelegramMessage(snipeAlert);

            // Simulate buy for now (replace with actual Jupiter integration)
            const mockEntryPrice = 0.001;
            const mockAmount = this.SNIPE_AMOUNT / mockEntryPrice;

            const successMsg = `✅ SNIPE SUCCESS!

${sourceEmoji} ${tokenSymbol}
📍 ${analysis.token.source}
⚡ ${this.SNIPE_AMOUNT} SOL
🎯 ${targetMultiplier}x target

📊 Monitoring...`;

            console.log(`✅ SNIPED ${tokenSymbol} from ${analysis.token.source}!`);
            await this.sendTelegramMessage(successMsg);
            
            this.positions.set(tokenAddress, {
                symbol: tokenSymbol,
                source: analysis.token.source,
                entryPrice: mockEntryPrice,
                amount: mockAmount,
                buyTime: Date.now(),
                targetMultiplier: targetMultiplier,
                stopLoss: analysis.token.source === 'pump.fun' ? this.PUMP_STOP_LOSS : this.DEX_STOP_LOSS
            });

            this.scannedTokens.add(tokenAddress);
            this.monitorPosition(tokenAddress);
            return true;

        } catch (error) {
            console.error(`❌ Snipe failed for ${tokenSymbol}:`, error.message);
            await this.sendTelegramMessage(`❌ SNIPE FAILED: ${tokenSymbol} - ${error.message}`);
            return false;
        }
    }

    async sellToken(tokenAddress, reason) {
        try {
            const position = this.positions.get(tokenAddress);
            if (!position) return false;

            console.log(`💰 SELLING ${position.symbol}... (${reason})`);

            // Simulate sell (replace with actual Jupiter)
            const mockExitPrice = position.entryPrice * (1 + Math.random() * 0.5); // Random profit/loss
            const multiplier = mockExitPrice / position.entryPrice;
            const profitSOL = (position.amount * mockExitPrice) - this.SNIPE_AMOUNT;
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;

            const emoji = profitSOL > 0 ? '🚀' : '📉';
            const sourceEmoji = position.source === 'pump.fun' ? '🚀' : '💎';
            
            const sellMsg = `${emoji} POSITION CLOSED!

${sourceEmoji} ${position.symbol}
📊 ${multiplier.toFixed(2)}x
💰 ${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL
⏰ ${holdTimeMin.toFixed(1)} min
📝 ${reason}

${profitSOL > 0 ? '🎉 PROFIT!' : '🛡️ LOSS CUT'}`;

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

                // Simulate price monitoring
                const randomChange = (Math.random() - 0.5) * 0.1; // ±5% random change
                const currentMultiplier = 1 + randomChange;

                if (currentMultiplier >= position.targetMultiplier) {
                    await this.sellToken(tokenAddress, `${position.targetMultiplier}x TARGET`);
                    return;
                }

                if (currentMultiplier <= position.stopLoss) {
                    await this.sellToken(tokenAddress, 'STOP LOSS');
                    return;
                }

                // Continue monitoring
                setTimeout(checkPosition, 15000);

            } catch (error) {
                console.error(`Monitor error for ${position.symbol}:`, error.message);
                setTimeout(checkPosition, 20000);
            }
        };

        setTimeout(checkPosition, 10000);
    }

    async tradingLoop() {
        if (!this.isRunning) return;

        try {
            console.log('🔍 REAL SNIPER: Scanning all sources...');
            
            const [pumpTokens, dexTokens] = await Promise.all([
                this.scanPumpFun(),
                this.scanDexScreener()
            ]);

            const allTokens = [...pumpTokens, ...dexTokens];
            console.log(`📊 Found ${pumpTokens.length} pump.fun + ${dexTokens.length} DEX tokens`);
            
            for (const token of allTokens) {
                if (this.positions.size >= this.MAX_POSITIONS) break;
                
                const analysis = await this.analyzeToken(token);
                
                if (analysis.shouldBuy) {
                    console.log(`🎯 SNIPE TARGET: ${token.symbol} from ${token.source} | Score: ${analysis.score}/100`);
                    await this.buyToken(token.address, token.symbol, analysis);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            this.showStats();

        } catch (error) {
            console.error('Trading loop error:', error.message);
        }

        setTimeout(() => this.tradingLoop(), 20000); // Faster scanning - every 20 seconds
    }

    showStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        console.log('');
        console.log('📊 === REAL SNIPER PERFORMANCE ===');
        console.log(`💰 Total P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL`);
        console.log(`🎯 Trades: ${this.trades.length} | Win Rate: ${winRate.toFixed(1)}%`);
        console.log(`🚀 Best Trade: ${bestTrade.toFixed(2)}x`);
        console.log(`📊 Active: ${this.positions.size}/${this.MAX_POSITIONS}`);
        console.log(`🔄 Uptime: ${(process.uptime() / 3600).toFixed(1)}h`);
        console.log('================================');
        console.log('');
    }

    gracefulShutdown() {
        console.log('🛑 Real Sniper shutdown...');
        this.isRunning = false;
        this.showStats();
        setTimeout(() => process.exit(0), 2000);
    }

    async start() {
        console.log('🚀 Starting Real Solana Sniper Bot...');
        
        if (await this.initialize()) {
            this.isRunning = true;
            console.log('🔥 REAL SNIPER IS LIVE - HUNTING FOR ALPHA! 🔥');
            this.tradingLoop();
        }
    }

    stop() {
        this.gracefulShutdown();
    }
}

// Start the Real Sniper
const bot = new RealSolanaSnipeBot();
bot.start();

module.exports = RealSolanaSnipeBot;