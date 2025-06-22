const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const axios = require('axios');
const express = require('express');

class SolanaSnipeBot {
    constructor() {
        // Environment variables from Railway
        this.PRIVATE_KEY = JSON.parse(process.env.PRIVATE_KEY || '[]');
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
        this.RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        
        // Bot settings
        this.SNIPE_AMOUNT = parseFloat(process.env.SNIPE_AMOUNT) || 0.05;
        this.QUICK_SELL_AT = parseFloat(process.env.QUICK_SELL_AT) || 2.0;
        this.STOP_LOSS_AT = parseFloat(process.env.STOP_LOSS_AT) || 0.5;
        this.MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS) || 3;

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
        
        this.setupRailwayOptimizations();
        this.setupHealthServer();
        this.setupTelegramCommands();
    }

    setupRailwayOptimizations() {
        setInterval(() => {
            console.log('🔄 Railway heartbeat:', new Date().toLocaleTimeString());
        }, 300000);

        process.on('SIGTERM', () => {
            console.log('🔄 Railway restart detected...');
            this.sendTelegramMessage('🔄 BOT RESTARTING - Railway is restarting the service...');
            this.gracefulShutdown();
        });

        process.on('SIGINT', () => {
            console.log('🛑 Manual stop detected...');
            this.gracefulShutdown();
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught exception:', error);
            this.sendTelegramMessage('💥 BOT CRASHED - Railway will auto-restart...');
            setTimeout(() => process.exit(1), 1000);
        });
    }

    setupHealthServer() {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.get('/', (req, res) => {
            const stats = {
                status: 'running',
                uptime: process.uptime(),
                activePositions: this.positions.size,
                totalTrades: this.trades.length,
                wallet: this.wallet.publicKey.toBase58(),
                lastHeartbeat: new Date().toISOString()
            };
            res.json(stats);
        });

        app.listen(PORT, () => {
            console.log(`🌐 Railway health server running on port ${PORT}`);
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
                // Silently ignore telegram polling errors
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
                    await this.sendPerformanceStats();
                    break;
                case '/positions':
                    await this.sendActivePositions();
                    break;
                case '/balance':
                    await this.sendBalanceInfo();
                    break;
                case '/help':
                    await this.sendHelpMessage();
                    break;
                case '/stop':
                    await this.sendTelegramMessage('🛑 STOPPING BOT - Shutting down gracefully...');
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
        
        const statusMsg = `📊 BOT STATUS UPDATE

🟢 Status: Running
⏰ Uptime: ${uptimeHours} hours
💰 Wallet: ${this.wallet.publicKey.toBase58()}
📊 Active Positions: ${this.positions.size}/${this.MAX_POSITIONS}
🎯 Total Trades: ${this.trades.length}
🌐 Platform: Railway

${this.positions.size > 0 ? '📈 Currently monitoring positions...' : '🔍 Scanning for opportunities...'}`;

        await this.sendTelegramMessage(statusMsg);
    }

    async sendPerformanceStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        const statsMsg = `📈 PERFORMANCE STATS

💰 Total P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL
🎯 Total Trades: ${this.trades.length}
📊 Win Rate: ${winRate.toFixed(1)}%
🚀 Best Trade: ${bestTrade.toFixed(2)}x
📊 Active Positions: ${this.positions.size}/${this.MAX_POSITIONS}

${totalProfit > 0 ? '🎉 Profitable session!' : '📈 Keep hunting for gems!'}`;

        await this.sendTelegramMessage(statsMsg);
    }

    async sendActivePositions() {
        if (this.positions.size === 0) {
            await this.sendTelegramMessage('📊 ACTIVE POSITIONS\n\n💤 No active positions\n\n🔍 Scanning for new opportunities...');
            return;
        }

        let positionsMsg = '📊 ACTIVE POSITIONS\n\n';
        
        for (const [tokenAddress, position] of this.positions) {
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;
            positionsMsg += `🪙 ${position.symbol}\n`;
            positionsMsg += `⏰ Hold Time: ${holdTimeMin.toFixed(1)} min\n`;
            positionsMsg += `💰 Entry: ${this.SNIPE_AMOUNT} SOL\n\n`;
        }

        positionsMsg += `📈 Monitoring ${this.positions.size} position${this.positions.size > 1 ? 's' : ''}...`;
        
        await this.sendTelegramMessage(positionsMsg);
    }

    async sendBalanceInfo() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            const balanceSOL = balance / 1e9;
            
            const balanceMsg = `💰 WALLET BALANCE

💰 SOL Balance: ${balanceSOL.toFixed(4)} SOL
🎯 Snipe Amount: ${this.SNIPE_AMOUNT} SOL per trade
📊 Trades Possible: ${Math.floor(balanceSOL / this.SNIPE_AMOUNT)}
💳 Wallet: ${this.wallet.publicKey.toBase58()}

${balanceSOL < this.SNIPE_AMOUNT ? '⚠️ Low balance! Add more SOL to continue trading.' : '✅ Sufficient balance for trading'}`;

            await this.sendTelegramMessage(balanceMsg);
        } catch (error) {
            await this.sendTelegramMessage(`❌ Error fetching balance: ${error.message}`);
        }
    }

    async sendHelpMessage() {
        const helpMsg = `🤖 SOLANA SNIPER BOT COMMANDS

📊 Monitoring:
/status - Bot status and uptime
/stats - Performance statistics  
/positions - Active positions
/balance - Wallet balance

🎮 Control:
/stop - Stop the bot
/help - Show this help message

🎯 Bot Settings:
• Snipe Amount: ${this.SNIPE_AMOUNT} SOL
• Quick Sell: ${this.QUICK_SELL_AT}x
• Stop Loss: ${(this.STOP_LOSS_AT * 100)}%
• Max Positions: ${this.MAX_POSITIONS}

💡 The bot automatically sends notifications for all trades.`;

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
            
            const startMessage = `🚀 RAILWAY SNIPER BOT DEPLOYED!

💰 Wallet: ${this.wallet.publicKey.toBase58()}
💰 SOL Balance: ${(balance / 1e9).toFixed(4)} SOL
🎯 Snipe Amount: ${this.SNIPE_AMOUNT} SOL per trade
🚀 Quick Sell: ${this.QUICK_SELL_AT}x profit
🛑 Stop Loss: ${(this.STOP_LOSS_AT * 100)}% down
📊 Max Positions: ${this.MAX_POSITIONS}
🌐 Platform: Railway

🔥 BOT IS LIVE - HUNTING FOR GEMS! 🔥`;

            console.log('🎯 RAILWAY SOLANA SNIPER BOT READY!');
            console.log(`💰 Wallet: ${this.wallet.publicKey.toBase58()}`);
            console.log(`💰 SOL Balance: ${(balance / 1e9).toFixed(4)} SOL`);
            
            await this.sendTelegramMessage(startMessage);
            
            if (balance < this.SNIPE_AMOUNT * 1e9) {
                const errorMsg = `❌ INSUFFICIENT SOL BALANCE!

Current: ${(balance / 1e9).toFixed(4)} SOL
Required: ${this.SNIPE_AMOUNT} SOL minimum

Send SOL to: ${this.wallet.publicKey.toBase58()}`;
                
                console.log('❌ Insufficient SOL balance!');
                await this.sendTelegramMessage(errorMsg);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('❌ Setup failed:', error.message);
            await this.sendTelegramMessage(`❌ BOT SETUP FAILED: ${error.message}`);
            return false;
        }
    }

    async scanForNewTokens() {
        try {
            const response = await axios.get('https://api.dexscreener.com/latest/dex/pairs/solana', {
                timeout: 8000
            });

            const newTokens = response.data.pairs ? response.data.pairs.filter(pair => {
                const ageInMinutes = (Date.now() - new Date(pair.pairCreatedAt).getTime()) / 60000;
                return ageInMinutes < 10 &&
                       pair.liquidity && pair.liquidity.usd >= 15000 &&
                       pair.liquidity.usd <= 150000 &&
                       pair.volumeUsd24h > 10000 &&
                       !this.positions.has(pair.baseToken.address) &&
                       pair.baseToken.symbol &&
                       pair.baseToken.name;
            }) : [];

            return newTokens.slice(0, 5);
        } catch (error) {
            console.error('Scan error:', error.message);
            return [];
        }
    }

    async analyzeToken(token) {
        let score = 0;
        
        const ageInMinutes = (Date.now() - new Date(token.pairCreatedAt).getTime()) / 60000;
        if (ageInMinutes < 2) score += 30;
        else if (ageInMinutes < 5) score += 20;
        else if (ageInMinutes < 10) score += 10;

        const liquidity = token.liquidity ? token.liquidity.usd || 0 : 0;
        if (liquidity >= 20000 && liquidity <= 100000) score += 25;
        else if (liquidity >= 15000) score += 15;

        const volume = token.volumeUsd24h || 0;
        if (volume > 50000) score += 20;
        else if (volume > 20000) score += 15;
        else if (volume > 10000) score += 10;

        const priceChange = token.priceChange24h || 0;
        if (priceChange > 100) score += 15;
        else if (priceChange > 50) score += 10;
        else if (priceChange > 20) score += 5;

        if (token.baseToken.name && token.baseToken.symbol) {
            score += 10;
        }

        return {
            score: score,
            shouldBuy: score >= 60 && this.positions.size < this.MAX_POSITIONS,
            token: token,
            ageInMinutes: ageInMinutes.toFixed(1),
            liquidity: liquidity,
            volume: volume
        };
    }

    async buyToken(tokenAddress, tokenSymbol, analysis) {
        try {
            console.log(`⚡ BUYING ${tokenSymbol}...`);

            const snipeAlert = `🎯 SNIPING TARGET FOUND!

🪙 Token: ${tokenSymbol}
📊 Score: ${analysis.score}/100
💰 Liquidity: $${analysis.liquidity.toLocaleString()}
📈 Volume: $${analysis.volume.toLocaleString()}
⏰ Age: ${analysis.ageInMinutes} minutes
⚡ Amount: ${this.SNIPE_AMOUNT} SOL

🔄 Executing trade...`;

            await this.sendTelegramMessage(snipeAlert);

            const routes = await this.jupiter.computeRoutes({
                inputMint: new PublicKey('So11111111111111111111111111111111111111112'),
                outputMint: new PublicKey(tokenAddress),
                amount: this.SNIPE_AMOUNT * 1e9,
                slippageBps: 1000,
            });

            if (!routes.routesInfos[0]) {
                const failMsg = `❌ SNIPE FAILED!

🪙 Token: ${tokenSymbol}
❌ Reason: No trading route found`;
                
                console.log(`❌ No route found for ${tokenSymbol}`);
                await this.sendTelegramMessage(failMsg);
                return false;
            }

            const { execute } = await this.jupiter.exchange({
                routeInfo: routes.routesInfos[0]
            });

            const result = await execute();

            if (result.txid) {
                const successMsg = `✅ SNIPE SUCCESSFUL!

🪙 Token: ${tokenSymbol}
⚡ Amount: ${this.SNIPE_AMOUNT} SOL
🔗 TX: ${result.txid}
🎯 Target: ${this.QUICK_SELL_AT}x profit

📊 Now monitoring position...`;

                console.log(`✅ BOUGHT ${tokenSymbol}! TX: ${result.txid.slice(0, 20)}...`);
                await this.sendTelegramMessage(successMsg);
                
                this.positions.set(tokenAddress, {
                    symbol: tokenSymbol,
                    entryPrice: routes.routesInfos[0].outAmount / routes.routesInfos[0].inAmount,
                    amount: routes.routesInfos[0].outAmount,
                    buyTime: Date.now(),
                    txid: result.txid,
                    analysis: analysis
                });

                this.monitorPosition(tokenAddress);
                return true;
            }
        } catch (error) {
            const errorMsg = `❌ SNIPE ERROR!

🪙 Token: ${tokenSymbol}
❌ Error: ${error.message}`;

            console.error(`❌ Buy failed for ${tokenSymbol}:`, error.message);
            await this.sendTelegramMessage(errorMsg);
            return false;
        }
    }

    async sellToken(tokenAddress, reason) {
        try {
            const position = this.positions.get(tokenAddress);
            if (!position) return false;

            console.log(`💰 SELLING ${position.symbol}... (${reason})`);

            const routes = await this.jupiter.computeRoutes({
                inputMint: new PublicKey(tokenAddress),
                outputMint: new PublicKey('So11111111111111111111111111111111111111112'),
                amount: position.amount,
                slippageBps: 1500,
            });

            if (!routes.routesInfos[0]) {
                console.log(`❌ No sell route for ${position.symbol}`);
                return false;
            }

            const { execute } = await this.jupiter.exchange({
                routeInfo: routes.routesInfos[0]
            });

            const result = await execute();

            if (result.txid) {
                const exitPrice = routes.routesInfos[0].outAmount / routes.routesInfos[0].inAmount;
                const multiplier = exitPrice / position.entryPrice;
                const profitSOL = (routes.routesInfos[0].outAmount / 1e9) - this.SNIPE_AMOUNT;
                const holdTimeMin = (Date.now() - position.buyTime) / 60000;

                const profitEmoji = profitSOL > 0 ? '🚀' : '📉';
                const sellMsg = `${profitEmoji} POSITION CLOSED!

🪙 Token: ${position.symbol}
📊 Result: ${multiplier.toFixed(2)}x
💰 P&L: ${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL
⏰ Hold Time: ${holdTimeMin.toFixed(1)} minutes
📝 Reason: ${reason}
🔗 TX: ${result.txid}

${profitSOL > 0 ? '🎉 PROFIT SECURED!' : '🛡️ LOSS MINIMIZED'}`;

                console.log(`🎯 SOLD ${position.symbol}! ${multiplier.toFixed(2)}x | ${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL | ${holdTimeMin.toFixed(1)}min`);
                await this.sendTelegramMessage(sellMsg);

                this.trades.push({
                    symbol: position.symbol,
                    multiplier: multiplier,
                    profitSOL: profitSOL,
                    reason: reason,
                    holdTime: holdTimeMin,
                    timestamp: Date.now()
                });

                this.positions.delete(tokenAddress);
                return true;
            }
        } catch (error) {
            console.error(`❌ Sell failed:`, error.message);
            return false;
        }
    }

    async getCurrentPrice(tokenAddress) {
        try {
            const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
                timeout: 5000
            });
            return parseFloat(response.data.pairs[0] ? response.data.pairs[0].priceUsd : 0) || 0;
        } catch (error) {
            return 0;
        }
    }

    async monitorPosition(tokenAddress) {
        const position = this.positions.get(tokenAddress);
        if (!position) return;

        const checkPosition = async () => {
            try {
                if (!this.positions.has(tokenAddress)) return;

                const currentPrice = await this.getCurrentPrice(tokenAddress);
                if (!currentPrice) {
                    setTimeout(checkPosition, 15000);
                    return;
                }

                const multiplier = currentPrice / (position.entryPrice * this.SNIPE_AMOUNT);

                if (multiplier >= this.QUICK_SELL_AT) {
                    await this.sellToken(tokenAddress, `${this.QUICK_SELL_AT}x PROFIT TARGET`);
                    return;
                }

                if (multiplier <= this.STOP_LOSS_AT) {
                    await this.sellToken(tokenAddress, 'STOP LOSS TRIGGERED');
                    return;
                }

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
            console.log('🔍 Scanning for new tokens...');
            
            const newTokens = await this.scanForNewTokens();
            
            for (const token of newTokens) {
                if (this.positions.size >= this.MAX_POSITIONS) break;
                
                const analysis = await this.analyzeToken(token);
                
                if (analysis.shouldBuy) {
                    console.log(`🎯 SNIPE TARGET: ${token.baseToken.symbol} | Score: ${analysis.score}/100`);
                    await this.buyToken(token.baseToken.address, token.baseToken.symbol, analysis);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            this.showStats();

        } catch (error) {
            console.error('Trading loop error:', error.message);
        }

        setTimeout(() => this.tradingLoop(), 30000);
    }

    showStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        console.log('');
        console.log('📊 === RAILWAY BOT PERFORMANCE ===');
        console.log(`💰 Total Profit: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL`);
        console.log(`🎯 Trades: ${this.trades.length} | Win Rate: ${winRate.toFixed(1)}%`);
        console.log(`🚀 Best Trade: ${bestTrade.toFixed(2)}x`);
        console.log(`📊 Active Positions: ${this.positions.size}/${this.MAX_POSITIONS}`);
        console.log(`🌐 Railway Uptime: ${(process.uptime() / 3600).toFixed(1)} hours`);
        console.log('=================================');
        console.log('');
    }

    gracefulShutdown() {
        console.log('🛑 Graceful shutdown initiated...');
        this.isRunning = false;
        this.showStats();
        setTimeout(() => process.exit(0), 2000);
    }

    async start() {
        console.log('🚀 Starting Railway Solana Sniper Bot...');
        
        if (await this.initialize()) {
            this.isRunning = true;
            console.log('🔥 RAILWAY BOT IS LIVE - HUNTING FOR GEMS! 🔥');
            this.tradingLoop();
        }
    }

    stop() {
        this.gracefulShutdown();
    }
}

// Start the bot
const bot = new SolanaSnipeBot();
bot.start();

module.exports = SolanaSnipeBot;