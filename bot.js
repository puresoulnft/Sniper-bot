const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const { createJupiterApiClient } = require('@jup-ag/api');
const axios = require('axios');
const express = require('express');

class DexScreenerSniperBot {
    constructor() {
        // Environment variables
        this.PRIVATE_KEY = JSON.parse(process.env.PRIVATE_KEY || '[]');
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
        this.RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        
        // Trading settings
        this.SNIPE_AMOUNT = parseFloat(process.env.SNIPE_AMOUNT) || 0.03;
        this.MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS) || 5;
        this.PROFIT_TARGET = parseFloat(process.env.PROFIT_TARGET) || 3.0; // 3x target
        this.STOP_LOSS = parseFloat(process.env.STOP_LOSS) || 0.50; // 50% stop loss

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
        
        this.setupHealthServer();
        this.setupTelegramCommands();
    }

    setupHealthServer() {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.get('/', (req, res) => {
            res.json({
                status: 'running',
                version: 'DexScreener Sniper v1.0',
                uptime: process.uptime(),
                activePositions: this.positions.size,
                totalTrades: this.trades.length,
                wallet: this.wallet.publicKey.toBase58()
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
        
        const statusMsg = `📊 DEXSCREENER SNIPER STATUS

🟢 Status: Active & Hunting
⏰ Uptime: ${uptime} hours
💰 Wallet: ${this.wallet.publicKey.toBase58()}
📊 Positions: ${this.positions.size}/${this.MAX_POSITIONS}
🎯 Total Trades: ${this.trades.length}

🔥 SETTINGS:
💰 Per Trade: ${this.SNIPE_AMOUNT} SOL
🎯 Target: ${this.PROFIT_TARGET}x
🛡️ Stop Loss: ${(this.STOP_LOSS * 100).toFixed(0)}%

${this.positions.size > 0 ? '📈 Monitoring...' : '🔍 Scanning DexScreener...'}`;

        await this.sendTelegramMessage(statusMsg);
    }

    async sendPerformanceStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        const statsMsg = `📈 SNIPER PERFORMANCE

💰 Total P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL
🎯 Trades: ${this.trades.length}
📊 Win Rate: ${winRate.toFixed(1)}%
🚀 Best: ${bestTrade.toFixed(2)}x

${totalProfit > 0 ? '🎉 Profitable!' : '📈 Keep hunting!'}`;

        await this.sendTelegramMessage(statsMsg);
    }

    async sendActivePositions() {
        if (this.positions.size === 0) {
            await this.sendTelegramMessage('📊 ACTIVE POSITIONS\n\n💤 No active positions\n\n🔍 Scanning DexScreener...');
            return;
        }

        let positionsMsg = '📊 ACTIVE POSITIONS\n\n';
        
        for (const [tokenAddress, position] of this.positions) {
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;
            
            positionsMsg += `💎 ${position.symbol}\n`;
            positionsMsg += `⏰ ${holdTimeMin.toFixed(1)} min\n`;
            positionsMsg += `🎯 ${this.PROFIT_TARGET}x target\n\n`;
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
📊 Possible Trades: ${Math.floor(balanceSOL / this.SNIPE_AMOUNT)}

🔥 SETTINGS:
🎯 Profit Target: ${this.PROFIT_TARGET}x
🛡️ Stop Loss: ${(this.STOP_LOSS * 100).toFixed(0)}%

${balanceSOL < this.SNIPE_AMOUNT ? '⚠️ Low balance!' : '✅ Ready to snipe!'}`;

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
            
            historyMsg += `${emoji} ${trade.symbol}\n`;
            historyMsg += `📊 ${trade.multiplier.toFixed(2)}x | ${trade.profitSOL > 0 ? '+' : ''}${trade.profitSOL.toFixed(4)} SOL\n`;
            historyMsg += `⏰ ${trade.holdTime.toFixed(1)} min\n\n`;
        }

        if (this.trades.length > 5) {
            historyMsg += `📝 Last 5 of ${this.trades.length} trades`;
        }

        await this.sendTelegramMessage(historyMsg);
    }

    async sendHelpMessage() {
        const helpMsg = `🤖 DEXSCREENER SNIPER COMMANDS

📊 Monitoring:
/status - Bot status
/stats - Performance stats
/positions - Active positions
/balance - Wallet balance
/trades - Trade history

🎮 Control:
/help - Show commands

🔥 SETTINGS:
🎯 Target: ${this.PROFIT_TARGET}x
🛡️ Stop Loss: ${(this.STOP_LOSS * 100).toFixed(0)}%
💰 Per Trade: ${this.SNIPE_AMOUNT} SOL

💡 Hunting DexScreener for quick profits!`;

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
            
            const startMessage = `🔥 DEXSCREENER SNIPER DEPLOYED!

💰 Wallet: ${this.wallet.publicKey.toBase58()}
💰 Balance: ${(balance / 1e9).toFixed(4)} SOL
🎯 Per Trade: ${this.SNIPE_AMOUNT} SOL

🔥 SETTINGS:
🎯 Profit Target: ${this.PROFIT_TARGET}x
🛡️ Stop Loss: ${(this.STOP_LOSS * 100).toFixed(0)}%
📊 Max Positions: ${this.MAX_POSITIONS}

🔥 SNIPER IS LIVE! 🔥`;

            console.log('🎯 DEXSCREENER SNIPER READY!');
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

    async scanDexScreener() {
        try {
            const tokens = [];
            
            // First, get boosted tokens (these are often good targets)
            try {
                const boostResponse = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', {
                    timeout: 8000
                });
    
                if (boostResponse.data && Array.isArray(boostResponse.data)) {
                    const solanaBoosts = boostResponse.data.filter(boost => 
                        boost.chainId === 'solana' &&
                        boost.tokenAddress &&
                        !this.scannedTokens.has(boost.tokenAddress) &&
                        !this.positions.has(boost.tokenAddress)
                    );
    
                    for (const boost of solanaBoosts.slice(0, 5)) {
                        // Get price data for boosted token
                        try {
                            const priceResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${boost.tokenAddress}`, {
                                timeout: 5000
                            });
                            
                            if (priceResponse.data?.pairs?.[0]) {
                                const pair = priceResponse.data.pairs[0];
                                tokens.push({
                                    address: boost.tokenAddress,
                                    symbol: pair.baseToken?.symbol || 'BOOST',
                                    name: pair.baseToken?.name || 'Boosted Token',
                                    price: parseFloat(pair.priceUsd) || 0.001,
                                    volume24h: pair.volume?.h24 || boost.amount * 10,
                                    marketCap: pair.marketCap || boost.totalAmount * 100,
                                    priceChange24h: pair.priceChange?.h24 || 15,
                                    liquidity: pair.liquidity?.usd || 20000,
                                    boostAmount: boost.amount
                                });
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }
            } catch (e) {
                console.log('Boost API error:', e.message);
            }
    
            // Then get token profiles for more variety
            try {
                const profileResponse = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1', {
                    timeout: 8000
                });
    
                if (profileResponse.data && Array.isArray(profileResponse.data)) {
                    const solanaProfiles = profileResponse.data.filter(profile => 
                        profile.chainId === 'solana' &&
                        profile.tokenAddress &&
                        !this.scannedTokens.has(profile.tokenAddress) &&
                        !this.positions.has(profile.tokenAddress) &&
                        !tokens.find(t => t.address === profile.tokenAddress) // Don't duplicate
                    );
    
                    for (const profile of solanaProfiles.slice(0, 5)) {
                        try {
                            const priceResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`, {
                                timeout: 5000
                            });
                            
                            if (priceResponse.data?.pairs?.[0]) {
                                const pair = priceResponse.data.pairs[0];
                                tokens.push({
                                    address: profile.tokenAddress,
                                    symbol: pair.baseToken?.symbol || 'NEW',
                                    name: pair.baseToken?.name || profile.description || 'New Token',
                                    price: parseFloat(pair.priceUsd) || 0.001,
                                    volume24h: pair.volume?.h24 || 1000,
                                    marketCap: pair.marketCap || 100000,
                                    priceChange24h: pair.priceChange?.h24 || 10,
                                liquidity: pair.liquidity?.usd || 10000
                            });
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        } catch (e) {
            console.log('Profile API error:', e.message);
        }

        return tokens;

    } catch (error) {
        console.error('DexScreener scan error:', error.message);
        return [];
    }
}

    analyzeToken(token) {
        let score = 0;
        
        // Volume check
        if (token.volume24h > 10000) score += 30;
        else if (token.volume24h > 5000) score += 20;
        else if (token.volume24h > 1000) score += 10;
        
        // Price change check (moderate pumps are good)
        if (token.priceChange24h > 20 && token.priceChange24h < 100) score += 30;
        else if (token.priceChange24h > 10) score += 20;
        else if (token.priceChange24h > 0) score += 10;
        
        // Liquidity check
        if (token.liquidity > 50000) score += 20;
        else if (token.liquidity > 20000) score += 15;
        else if (token.liquidity > 10000) score += 10;
        
        // Market cap check (not too high, not too low)
        if (token.marketCap > 100000 && token.marketCap < 1000000) score += 20;
        else if (token.marketCap > 50000) score += 10;

        return {
            score: score,
            shouldBuy: score >= 60 && this.positions.size < this.MAX_POSITIONS,
            token: token
        };
    }

    async buyToken(tokenAddress, tokenSymbol, analysis) {
        try {
            console.log(`⚡ SNIPING ${tokenSymbol}...`);
            
            const snipeAlert = `🎯 SNIPE TARGET!

💎 ${tokenSymbol}
📊 Score: ${analysis.score}/100
💰 Volume: $${(analysis.token.volume24h / 1000).toFixed(1)}k
📈 24h: ${analysis.token.priceChange24h > 0 ? '+' : ''}${analysis.token.priceChange24h.toFixed(1)}%
⚡ ${this.SNIPE_AMOUNT} SOL

🔄 Sniping...`;

            await this.sendTelegramMessage(snipeAlert);

            // Get Jupiter quote
            const quoteResponse = await this.jupiter.quoteGet({
                inputMint: 'So11111111111111111111111111111111111111112', // SOL
                outputMint: tokenAddress,
                amount: this.SNIPE_AMOUNT * 1e9,
                slippageBps: 1500, // 15% slippage
            });

            if (!quoteResponse) {
                console.log(`❌ No quote for ${tokenSymbol}`);
                await this.sendTelegramMessage(`❌ SNIPE FAILED: No quote for ${tokenSymbol}`);
                return false;
            }

            const swapResponse = await this.jupiter.swapPost({
                swapRequest: {
                    quoteResponse,
                    userPublicKey: this.wallet.publicKey.toBase58(),
                    wrapAndUnwrapSol: true,
                }
            });

            if (!swapResponse?.swapTransaction) {
                console.log(`❌ No swap transaction for ${tokenSymbol}`);
                await this.sendTelegramMessage(`❌ SNIPE FAILED: No swap for ${tokenSymbol}`);
                return false;
            }

            // Execute the transaction
            try {
                const transaction = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
                transaction.sign([this.wallet]);
                
                const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed'
                });
                
                console.log(`📝 Buy transaction sent: ${signature}`);
                
                const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
                
                if (confirmation.value.err) {
                    console.log(`❌ Buy transaction failed: ${confirmation.value.err}`);
                    await this.sendTelegramMessage(`❌ BUY FAILED: ${tokenSymbol}`);
                    return false;
                }
                
                console.log(`✅ Buy transaction confirmed: ${signature}`);
                
            } catch (txError) {
                console.error(`❌ Transaction failed:`, txError.message);
                await this.sendTelegramMessage(`❌ TRANSACTION FAILED: ${tokenSymbol}`);
                return false;
            }

            const entryPrice = analysis.token.price;
            const amount = quoteResponse.outAmount;

            const successMsg = `✅ SNIPE SUCCESS!

💎 ${tokenSymbol}
💰 ${this.SNIPE_AMOUNT} SOL
🎯 ${this.PROFIT_TARGET}x target
📊 Monitoring...`;

            console.log(`✅ SNIPED ${tokenSymbol}!`);
            await this.sendTelegramMessage(successMsg);
            
            this.positions.set(tokenAddress, {
                symbol: tokenSymbol,
                entryPrice: entryPrice,
                amount: amount,
                buyTime: Date.now()
            });

            this.scannedTokens.add(tokenAddress);
            this.monitorPosition(tokenAddress);
            return true;

        } catch (error) {
            console.error(`❌ Snipe failed:`, error.message);
            await this.sendTelegramMessage(`❌ SNIPE FAILED: ${tokenSymbol}`);
            return false;
        }
    }

    async sellToken(tokenAddress, reason) {
        try {
            const position = this.positions.get(tokenAddress);
            if (!position) return false;

            console.log(`💰 SELLING ${position.symbol}... (${reason})`);

            const quoteResponse = await this.jupiter.quoteGet({
                inputMint: tokenAddress,
                outputMint: 'So11111111111111111111111111111111111111112', // SOL
                amount: position.amount,
                slippageBps: 2000, // 20% slippage for selling
            });

            if (!quoteResponse) {
                console.log(`❌ No sell quote for ${position.symbol}`);
                return false;
            }

            const swapResponse = await this.jupiter.swapPost({
                swapRequest: {
                    quoteResponse,
                    userPublicKey: this.wallet.publicKey.toBase58(),
                    wrapAndUnwrapSol: true,
                }
            });

            if (!swapResponse?.swapTransaction) {
                console.log(`❌ No sell swap for ${position.symbol}`);
                return false;
            }

            // Execute sell transaction
            try {
                const transaction = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
                transaction.sign([this.wallet]);
                
                const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed'
                });
                
                console.log(`📝 Sell transaction sent: ${signature}`);
                
                const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
                
                if (confirmation.value.err) {
                    console.log(`❌ Sell transaction failed: ${confirmation.value.err}`);
                    return false;
                }
                
                console.log(`✅ Sell transaction confirmed: ${signature}`);
                
            } catch (txError) {
                console.error(`❌ Sell transaction failed:`, txError.message);
                return false;
            }

            const currentPrice = await this.getCurrentPrice(tokenAddress);
            const multiplier = currentPrice / position.entryPrice;
            const profitSOL = (quoteResponse.outAmount / 1e9) - this.SNIPE_AMOUNT;
            const holdTimeMin = (Date.now() - position.buyTime) / 60000;

            const emoji = profitSOL > 0 ? '🚀' : '📉';
            
            const sellMsg = `${emoji} POSITION CLOSED!

💎 ${position.symbol}
📊 ${multiplier.toFixed(2)}x
💰 ${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL
⏰ ${holdTimeMin.toFixed(1)} min
📝 ${reason}

${profitSOL > 0 ? '🎉 PROFIT!' : '🛡️ LOSS CUT'}`;

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
            return parseFloat(response.data.pairs?.[0]?.priceUsd) || 0;
        } catch (error) {
            console.error('Price fetch error:', error.message);
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

                const currentMultiplier = currentPrice / position.entryPrice;

                if (currentMultiplier >= this.PROFIT_TARGET) {
                    await this.sellToken(tokenAddress, `${this.PROFIT_TARGET}x TARGET`);
                    return;
                }

                if (currentMultiplier <= this.STOP_LOSS) {
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
            console.log('🔍 Scanning DexScreener...');
            
            const tokens = await this.scanDexScreener();
            console.log(`📊 Found ${tokens.length} tokens to analyze`);
            
            for (const token of tokens) {
                if (this.positions.size >= this.MAX_POSITIONS) break;
                
                const analysis = this.analyzeToken(token);
                
                if (analysis.shouldBuy) {
                    console.log(`🎯 TARGET: ${token.symbol} | Score: ${analysis.score}/100`);
                    await this.buyToken(token.address, token.symbol, analysis);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            this.showStats();

        } catch (error) {
            console.error('Trading loop error:', error.message);
        }

        setTimeout(() => this.tradingLoop(), 30000); // Scan every 30 seconds
    }

    showStats() {
        const totalProfit = this.trades.reduce((sum, t) => sum + t.profitSOL, 0);
        const winCount = this.trades.filter(t => t.profitSOL > 0).length;
        const winRate = this.trades.length > 0 ? (winCount / this.trades.length * 100) : 0;
        const bestTrade = this.trades.length > 0 ? Math.max(...this.trades.map(t => t.multiplier)) : 0;

        console.log('');
        console.log('📊 === SNIPER PERFORMANCE ===');
        console.log(`💰 P&L: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(4)} SOL`);
        console.log(`🎯 Trades: ${this.trades.length} | Win: ${winRate.toFixed(1)}%`);
        console.log(`🚀 Best: ${bestTrade.toFixed(2)}x`);
        console.log(`📊 Active: ${this.positions.size}/${this.MAX_POSITIONS}`);
        console.log(`🔄 Uptime: ${(process.uptime() / 3600).toFixed(1)}h`);
        console.log('============================');
        console.log('');
    }

    async start() {
        console.log('🚀 Starting DexScreener Sniper Bot...');
        
        if (await this.initialize()) {
            this.isRunning = true;
            console.log('🔥 SNIPER IS LIVE - HUNTING DEXSCREENER! 🔥');
            this.tradingLoop();
        }
    }
}

// Start the Sniper
const bot = new DexScreenerSniperBot();
bot.start();

module.exports = DexScreenerSniperBot;