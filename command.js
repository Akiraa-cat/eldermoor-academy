// command.js - UPDATED VERSION WITH REVELATION MODE MANAGEMENT
const Game = require("./game");
const SimpleGame = require("./simple-game");
const { listRoles: listChaos } = require("./roles");
const { listRoles: listSimple } = require("./roles-simple");
const linkHelper = require("./linkHelper");
const AntiSpamHandler = require("./anti-spam");

// Global game instances storage - key: groupId, value: CommandHandler
const gameInstances = new Map();

// Global anti-spam handler
const antiSpam = new AntiSpamHandler();

function normalizeJid(jid) {
  if (!jid) return null;
  if (jid.endsWith("@lid")) {
    return jid.replace(/@lid$/, "@s.whatsapp.net");
  }
  if (jid.includes("@g.us")) return jid;
  if (jid.includes("@s.whatsapp.net")) return jid;
  return jid;
}

class CommandHandler {
  constructor(sock, groupId = null) {
    this.sock = sock;
    this.groupId = groupId;
    this.game = null;
    this.mode = null;
    this.hideRoles = false;
    
    // Register this instance if it's for a group
    if (groupId) {
      gameInstances.set(groupId, this);
    }
  }

  static getGameInstance(playerId) {
    const groupId = linkHelper.getGroupMemberId(playerId);
    if (!groupId) return null;
    
    for (const [gId, handler] of gameInstances.entries()) {
      if (handler.game && handler.game.players[groupId]) {
        return handler.game;
      }
    }
    
    return null;
  }

  async getDisplayName(id) {
    try {
      const contact = await this.sock.onWhatsApp(id);
      if (contact && contact[0] && contact[0].notify) {
        return contact[0].notify;
      }
      const number = id.split('@')[0];
      return `User${number.slice(-4)}`;
    } catch (err) {
      console.error("Error getting display name:", err);
      const number = id.split('@')[0];
      return `User${number.slice(-4)}`;
    }
  }

  async handleCommand(from, text, isGroup, sender) {
    try {
      console.log(`\n=== COMMAND DEBUG ===`);
      console.log(`From: ${from}, Text: ${text}, IsGroup: ${isGroup}, Sender: ${sender}`);
      console.log(`GroupId: ${this.groupId}, Game: ${!!this.game}`);
      
      // 🚫 ANTI-SPAM CHECK
      const spamCheck = antiSpam.isSpamming(sender, text);
      if (spamCheck.isSpam || spamCheck.action === 'warning') {
        console.log(`🚨 Spam detected from ${sender}: ${spamCheck.action}`);
        
        if (spamCheck.response) {
          const target = isGroup ? from : sender;
          await this.sock.sendMessage(target, { 
            text: spamCheck.response 
          });
        }
        
        // Block command execution if it's spam (but allow warnings to continue)
        if (spamCheck.isSpam) {
          return;
        }
      }
      
      const args = text.trim().split(/\s+/);
      const cmd = args[0].toLowerCase().replace("/", "");
      
      console.log(`Parsed command: "${cmd}"`);

      if (isGroup) {
        if (!this.groupId) this.groupId = from;
        
        switch (cmd) {
          case "menu": return this.cmdMenu(from);
          case "start": return this.cmdStartSimple(from, sender, args);
          case "startchaos": return this.cmdStartChaos(from, sender, args);
          case "join": return this.cmdJoin(sender);
          case "forcestart": return this.cmdForcestart(sender);
          case "players": return this.cmdPlayers(false, sender, from);
          case "reset": return this.cmdReset(sender);
          case "roledef": return this.cmdRoleDef(sender, from);
          case "rolechaos": return this.cmdRoleChaos(sender, from);
          case "forcevote": return this.cmdForceVote(sender);
          case "myid": return this.cmdMyId(sender, from);
          case "link": return this.cmdLinkInit(from, sender);
          case "say": return this.cmdSay(from, sender, args);
          case "antispam": return this.cmdAntiSpamStats(from, sender);
          case "resetspam": return this.cmdResetSpam(from, sender, args);
          case "add": 
            return this.cmdAddTime(sender);

          // NEW REVELATION MODE COMMANDS
          case "revelation":
          case "rev":
            return this.cmdSetRevelationMode(sender, args);
          
          case "status":
          case "gameinfo":
            return this.cmdGameStatus(from);
          
          case "role":
          case "rolelist":
            return this.sock.sendMessage(from, {
              text: `❌ Mungkin maksud Anda /roledef (simple) atau /rolechaos (chaos)`,
            });
          
          // ADMIN COMMANDS FOR GAME MANAGEMENT
          case "forcereveal":
            return this.cmdForceReveal(sender, args);
          
          case "composition":
          case "comp":
            return this.cmdShowComposition(sender);
          
          default:
            return this.sock.sendMessage(from, {
              text: `❌ Perintah "${cmd}" tidak dikenal. Ketik /menu untuk daftar perintah.`,
            });
        }
      } else {
        // DM commands
        switch (cmd) {
          case "menu": return this.cmdMenu(sender);
          case "players": return this.cmdPlayers(true, sender, from);
          case "roledef": return this.cmdRoleDef(sender, null);
          case "rolechaos": return this.cmdRoleChaos(sender, null);
          case "myid": return this.cmdMyId(sender, null);
          case "link": {
            if (!args[1]) {
              return this.sock.sendMessage(sender, {
                text: "❌ Format salah. Gunakan: /link <kode>\n\n💡 Dapatkan kode dengan mengetik /link di grup.",
              });
            }
            const success = linkHelper.confirmLink(sender, args[1]);
            await this.sock.sendMessage(sender, {
              text: success
                ? "✅ Akun berhasil dihubungkan!\n\n💡 Gunakan /usn <nama> untuk set nama game, lalu siap bermain di grup."
                : "❌ Kode link salah atau kadaluarsa. Minta kode baru dengan /link di grup.",
            });
            return;
          }
          case "usn": {
            if (!args[1]) {
              return this.sock.sendMessage(sender, {
                text: "❌ Format salah. Gunakan: /usn <nama>\n\nContoh: /usn Budi",
              });
            }
            if (!linkHelper.isLinked(sender)) {
              return this.sock.sendMessage(sender, {
                text: "❌ Kamu harus /link dulu sebelum bisa set username.",
              });
            }
            const username = args.slice(1).join(" ").trim();
            if (username.length < 3 || username.length > 15) {
              return this.sock.sendMessage(sender, {
                text: "❌ Username harus 3-15 karakter.",
              });
            }
            if (!/^[a-zA-Z0-9_\s]+$/.test(username)) {
              return this.sock.sendMessage(sender, {
                text: "❌ Username hanya boleh huruf, angka, underscore, dan spasi.",
              });
            }
            if (linkHelper.isUsernameTaken(username, sender)) {
              return this.sock.sendMessage(sender, {
                text: `❌ Username *${username}* sudah dipakai. Pilih nama lain.`,
              });
            }
            const user = linkHelper.setCustomUsername(sender, username);
            return this.sock.sendMessage(sender, {
              text: `✅ Username game kamu diset menjadi *${user.username}*\n\n🎮 Sekarang siap bermain di grup!`,
            });
          }
          case "w": {
            if (!this.game || !linkHelper.isLinked(sender)) {
              return this.sock.sendMessage(sender, { text: "❌ Tidak ada game aktif atau kamu belum /link." });
            }
            const gId = linkHelper.getGroupMemberId(sender);
            const msg = args.slice(1).join(" ");
            if (!msg) return this.sock.sendMessage(sender, { text: "❌ Format: /w <pesan>" });

            const me = this.game.players[gId];
            if (!me) return;

            // whisper ke tim
            if (["Werewolf","Alpha Werewolf","Wolf Summoner","Wolf Trickster","Wolf Seer","Lil Wolvy","Lycan"].includes(me.role)) {
              for (const p of Object.values(this.game.players)) {
                if (["Werewolf","Alpha Werewolf","Wolf Summoner","Wolf Trickster","Wolf Seer","Lil Wolvy","Lycan"].includes(p.role) && p.alive && p.id !== gId) {
                  await this.game.dm(p.id, `💭 Whisper dari ${me.usn}: ${msg}`);
                }
              }
              return this.sock.sendMessage(sender, { text: "✅ Whisper terkirim ke kawanan serigala." });
            }
            if (["Bandit","Accomplice"].includes(me.role)) {
              for (const p of Object.values(this.game.players)) {
                if (["Bandit","Accomplice"].includes(p.role) && p.alive && p.id !== gId) {
                  await this.game.dm(p.id, `💭 Whisper dari ${me.usn}: ${msg}`);
                }
              }
              return this.sock.sendMessage(sender, { text: "✅ Whisper terkirim ke partnermu." });
            }
            return this.sock.sendMessage(sender, { text: "❌ Role kamu tidak bisa whisper." });
          }
          case "r": {
            if (!this.game || !linkHelper.isLinked(sender)) {
              return this.sock.sendMessage(sender, { text: "❌ Tidak ada game aktif atau kamu belum /link." });
            }
            const gId = linkHelper.getGroupMemberId(sender);
            const me = this.game.players[gId];
            if (!me || !me.lastWhisperFrom) return this.sock.sendMessage(sender, { text: "❌ Tidak ada whisper untuk dibalas." });

            const msg = args.slice(1).join(" ");
            if (!msg) return this.sock.sendMessage(sender, { text: "❌ Format: /r <pesan>" });

            await this.game.dm(me.lastWhisperFrom, `💭 Balasan dari ${me.usn}: ${msg}`);
            return this.sock.sendMessage(sender, { text: "✅ Balasan terkirim." });
          }
          default:
            // Handle numeric commands and skip commands in DMs
            console.log(`🔍 Processing DM command: "${cmd}" from ${sender}`);
            
            // Get the game instance for this player
            const gameInstance = CommandHandler.getGameInstance(sender);
            console.log(`🎮 Found game instance: ${!!gameInstance}`);
            
              if (/^\d+$/.test(cmd)) {
                console.log(`🎯 Numeric command detected: ${cmd}`);
                const nums = [parseInt(cmd)];
                
                const gameInstance = CommandHandler.getGameInstance(sender);
                console.log(`🎮 Found game instance: ${!!gameInstance}`);
                
              if (gameInstance && nums.length > 0 && !isNaN(nums[0])) {
                console.log(`🎯 Calling handleChoice - Game phase: ${gameInstance.phase}`);
                // IMPORTANT: Pass the sender (DM ID) to handleChoice, let the game resolve it
                return gameInstance.handleChoice(sender, nums);
              } else {
                console.log(`❌ Game not available or invalid nums`);
                return this.sock.sendMessage(sender, { 
                  text: "❌ Tidak ada game aktif atau nomor tidak valid." 
                });
              }
            }
            
            // Handle skip commands  
            if (cmd === "skip" || cmd === "skipvote") {
              const gameInstance = CommandHandler.getGameInstance(sender);
              if (!gameInstance) {
                return this.sock.sendMessage(sender, { text: "❌ Tidak ada game aktif." });
              }
              
              // Get the group member ID for this player
              const groupId = linkHelper.getGroupMemberId(sender);
              if (!groupId) {
                return this.sock.sendMessage(sender, { text: "❌ Kamu belum /link dengan grup!" });
              }
              
              if (gameInstance.phase === "vote") {
                gameInstance.votes[groupId] = null;  // Use groupId for consistency
                await this.sock.sendMessage(sender, { text: "⭐ Kamu memilih abstain (skip vote)." });
                await gameInstance.broadcast("✅ Seorang warga telah memberikan suaranya.");
                return;
              }
              
              if (gameInstance.phase === "night") {
                const player = gameInstance.players[groupId];
                if (player) {
                  player.actionTaken = true;
                }
                gameInstance.actions[groupId] = { action: "skip" };  // Use groupId for consistency
                await this.sock.sendMessage(sender, { text: "⭐ Kamu memilih untuk tidak melakukan aksi malam ini." });
                return;
              }
              
              await this.sock.sendMessage(sender, { 
                text: "❌ Skip hanya bisa digunakan saat voting atau malam hari." 
              });
              return;
            }
            
            return this.sock.sendMessage(sender, {
              text: `❌ Perintah "${cmd}" tidak dikenal di DM. Ketik /menu untuk daftar perintah.`,
            });
        }
      }
    } catch (err) {
      console.error("⚠️ Error saat handleCommand:", err);
      const target = isGroup ? from : sender;
      await this.sock.sendMessage(target, { text: "❌ Terjadi error saat memproses command. Coba lagi." });
    }
  }

  async cmdMenu(to) {
    const menu = `
🐺 *SELAMAT DATANG DI WEREWOLF BOT* 🌙

📋 *DAFTAR PERINTAH*  
🔗 /link — Hubungkan akun (grup → DM).  
👤 /usn <nama> — Set username game (DM).  
🎮 /start — Buat lobby *Simple Edition*.  
👹 /startchaos — Buat lobby *Chaos Edition*.  
🙋 /join — Ikut lobby.  
🚀 /forcestart — Host paksa mulai.  
⏰ /add — Host tambah waktu lobby 30 detik.  
👥 /players — Lihat daftar pemain.  
📖 /roledef — Lihat role *Simple Edition*.  
📖 /rolechaos — Lihat role *Chaos Edition*.  
🛑 /reset — Reset game (host).  
🆔 /myid — Lihat akun (via DM).  
📢 /say <pesan> — Broadcast ke semua member grup.  

🎭 *REVELATION MODES (Host Only)*  
🔧 /revelation <mode> — Atur mode pengungkapan:  
   • FULL - Tampilkan role lengkap  
   • HIDDEN - Sembunyikan semua identitas  
   • AURA_ONLY - Hanya tampilkan aura  
   • PROGRESSIVE - Ungkap bertahap per hari  
📊 /status — Lihat info game dan pengaturan  
📋 /composition — Lihat komposisi game saat ini  

⚔️ *AKSI*  
🌙 /skip — Lewat aksi malam (DM).  
☀️ /skipvote — Lewat voting siang.  
📣 /forcevote — Minta percepatan voting (60% setuju).  

🛠️ *ADMIN & ANTI-SPAM*  
📊 /antispam — Lihat statistik anti-spam.  
🧹 /resetspam [admin] — Reset data spam (admin only).  
🎯 /forcereveal <player> — Ungkap role pemain (host).  

ℹ️ Semua aksi role dilakukan *via DM*.  
Gunakan nomor target sesuai daftar.  
Contoh: */1* untuk memilih target pertama.

🔗 *CARA LINK AKUN*:
1. Ketik /link di grup
2. Bot kirim kode via DM
3. Ketik /link <kode> di DM
4. Ketik /usn <nama> untuk set nama game
5. Akun terhubung, siap main!

🚫 *ANTI-SPAM AKTIF*
Bot akan otomatis timeout spammer selama 1 menit!
Max 20 pesan/menit • Max 10 pesan sama berturut-turut
`;
    await this.sock.sendMessage(to, { text: menu });
  }

  // NEW REVELATION MODE COMMAND
  async cmdSetRevelationMode(sender, args) {
    if (!this.game) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Tidak ada game aktif." });
    }

    if (sender !== this.game.hostId) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Hanya host yang bisa mengubah revelation mode." });
    }

    if (!args[1]) {
      return this.sock.sendMessage(this.groupId, { 
        text: "❌ Format: /revelation <mode>\n\n🎭 **Mode tersedia:**\n• FULL - Role lengkap saat mati\n• HIDDEN - Sembunyikan identitas\n• AURA_ONLY - Hanya aura (Good/Evil/Unknown)\n• PROGRESSIVE - Ungkap bertahap per hari"
      });
    }

    const mode = args[1].toUpperCase();
    const success = this.game.setRevelationMode(mode);

    if (success) {
      let modeDescription = "";
      switch (mode) {
        case 'FULL':
          modeDescription = "Role lengkap akan ditampilkan saat pemain mati";
          break;
        case 'HIDDEN':
          modeDescription = "Semua identitas tersembunyi sampai akhir game";
          break;
        case 'AURA_ONLY':
          modeDescription = "Hanya aura (Good/Evil/Unknown) yang ditampilkan";
          break;
        case 'PROGRESSIVE':
          modeDescription = "Informasi terungkap bertahap: Hari 1-2 (hidden) → Hari 3 (aura) → Hari 4+ (role)";
          break;
      }

      await this.game.broadcast(`🎭 **REVELATION MODE DIUBAH!**\n\n📋 **Mode:** ${mode}\n📝 **Efek:** ${modeDescription}`);
    } else {
      await this.sock.sendMessage(this.groupId, {
        text: "❌ Mode tidak valid. Pilihan: FULL, HIDDEN, AURA_ONLY, PROGRESSIVE"
      });
    }
  }

   async cmdAddTime(sender) {
    if (!this.game || !this.game.inLobby) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Hanya bisa menambah waktu saat lobby terbuka." });
    }

    // Only host can add time
    if (sender !== this.game.hostId) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Hanya host yang bisa menambah waktu lobby." });
    }

    // Check if lobby timer exists
    if (!this.game.timers.lobbyClose) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Lobby timer sudah tidak aktif." });
    }

    // Calculate remaining time
    const currentTime = Date.now();
    const lobbyStartTime = this.game.lobbyStartTime || (currentTime - 120000); // Default to 2 minutes ago if not set
    const elapsedTime = currentTime - lobbyStartTime;
    const remainingTime = 120000 - elapsedTime; // 2 minutes default lobby time

    // Check if remaining time is more than 1 minute (60000ms)
    if (remainingTime > 60000) {
      return this.sock.sendMessage(this.groupId, { 
        text: `❌ Masih ada ${Math.ceil(remainingTime / 1000)} detik tersisa. /add hanya bisa digunakan jika waktu tersisa di bawah 1 menit.` 
      });
    }

    // Check maximum lobby time (5 minutes = 300000ms)
    const totalElapsedTime = currentTime - lobbyStartTime;
    if (totalElapsedTime >= 240000) { // 4 minutes - leave room for one more /add
      return this.sock.sendMessage(this.groupId, { 
        text: "❌ Waktu lobby sudah mencapai maksimal 5 menit. Tidak bisa menambah lagi." 
      });
    }

    // Add 30 seconds to the existing timer
    clearTimeout(this.game.timers.lobbyClose);
    
    this.game.timers.lobbyClose = setTimeout(async () => {
      if (!this.game.inLobby) return;
      this.game.inLobby = false;
      
      if (this.game.playerCount() >= this.game.MIN_PLAYERS) {
        await this.game.broadcast("🚀 Lobby ditutup! Permainan dimulai...");
        await this.game.beginGame();
      } else {
        await this.game.broadcast(`❌ Butuh minimal ${this.game.MIN_PLAYERS} pemain untuk memulai!`);
        this.game.endGame();
      }
    }, 30000); // Add 30 seconds

    await this.game.broadcast(
      `⏰ **HOST MENAMBAH WAKTU LOBBY**\n\n` +
      `⏱️ Waktu ditambah: 30 detik\n` +
      `📝 Gunakan /add lagi jika diperlukan (max 5 menit total)\n` +
      `💡 /add hanya bisa digunakan jika waktu tersisa < 1 menit`
    );
  }

  // NEW GAME STATUS COMMAND
  async cmdGameStatus(groupId) {
    if (!this.game) {
      return this.sock.sendMessage(groupId, { text: "❌ Tidak ada game aktif." });
    }

    const stats = this.game.getGameStats();
    if (!stats) {
      return this.sock.sendMessage(groupId, { text: "❌ Tidak bisa mengambil status game." });
    }

    let statusText = `📊 **STATUS PERMAINAN**\n\n`;
    statusText += `🎮 **Mode:** ${this.mode ? this.mode.toUpperCase() : 'Unknown'}\n`;
    statusText += `📅 **Hari:** ${stats.day}\n`;
    statusText += `⏰ **Fase:** ${stats.phase || 'Lobby'}\n`;
    statusText += `👥 **Pemain:** ${stats.alivePlayers}/${stats.totalPlayers} hidup\n`;
    statusText += `🐺 **Serigala:** ${stats.aliveWolves} hidup\n`;
    statusText += `🎭 **Revelation:** ${this.game.revelationMode}\n`;
    
    if (this.game.revelationMode === 'PROGRESSIVE') {
      let progressDesc = "";
      if (stats.day <= 2) progressDesc = "Identitas tersembunyi";
      else if (stats.day === 3) progressDesc = "Menampilkan aura";
      else progressDesc = "Menampilkan role lengkap";
      statusText += `📈 **Progress:** ${progressDesc}\n`;
    }

    await this.sock.sendMessage(groupId, { text: statusText });
  }

  // NEW COMPOSITION COMMAND
  async cmdShowComposition(sender) {
    if (!this.game || (!this.game.inGame)) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Tidak ada game aktif." });
    }

    // Only allow linked players to see composition
    if (!linkHelper.isLinked(sender)) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Kamu harus /link dulu." });
    }

    await this.game.showGameComposition();
  }

  // NEW FORCE REVEAL COMMAND (HOST ONLY)
  async cmdSay(groupId, sender, args) {
    if (!args[1]) {
      return this.sock.sendMessage(groupId, {
        text: "❌ Format salah. Gunakan: /say <pesan>\n\nContoh: /say Halo semua!",
      });
    }

    try {
      // Get all group participants
      const groupMetadata = await this.sock.groupMetadata(groupId);
      const participants = groupMetadata.participants;
      
      // Extract the message from args
      const message = args.slice(1).join(" ");
      
      // Get sender's custom username from link system
      const user = linkHelper.getUser(sender);
      const senderName = user ? (user.customUsername || user.username) : await this.getDisplayName(sender);
      
      // Create mentions array (all participants)
      const mentions = participants.map(p => p.id);
      
      // Create the broadcast message with mentions
      const broadcastText = `📢 *BROADCAST dari ${senderName}*\n\n${message}`;
      
      await this.sock.sendMessage(groupId, {
        text: broadcastText,
        mentions: mentions
      });
      
    } catch (err) {
      console.error("Error in cmdSay:", err);
      await this.sock.sendMessage(groupId, {
        text: "❌ Gagal mengirim broadcast. Coba lagi nanti."
      });
    }
  }

  async cmdAntiSpamStats(groupId, sender) {
    // Only allow linked users to check stats
    if (!linkHelper.isLinked(sender)) {
      return this.sock.sendMessage(groupId, { 
        text: "❌ Kamu harus /link dulu sebelum bisa menggunakan command ini." 
      });
    }

    const globalStats = antiSpam.getGlobalStats();
    const userStats = antiSpam.getUserStats(sender);
    
    let statsText = "📊 *ANTI-SPAM STATISTICS*\n\n";
    statsText += `👥 Active users being tracked: ${globalStats.activeUsers}\n`;
    statsText += `🚫 Currently blocked: ${globalStats.blockedUsers}\n\n`;
    
    if (userStats.stats) {
      statsText += `📈 *Your Stats:*\n`;
      statsText += `Messages: ${userStats.stats.count}\n`;
      statsText += `Warnings: ${userStats.stats.warnings}\n`;
      statsText += `Same msg count: ${userStats.stats.sameMessageCount}\n`;
    }
    
    if (userStats.blocked) {
      statsText += `🔒 You are blocked for ${userStats.remainingTime} seconds\n`;
    }
    
    if (globalStats.totalBlocked.length > 0) {
      statsText += `\n🚫 *Blocked Users:*\n`;
      globalStats.totalBlocked.forEach((blocked, index) => {
        const shortId = blocked.userId.split('@')[0].slice(-4);
        statsText += `${index + 1}. User${shortId} (${blocked.remaining}s)\n`;
      });
    }

    statsText += `\n⚙️ *Settings:*\n`;
    statsText += `Max messages/minute: ${antiSpam.MAX_MESSAGES_PER_MINUTE}\n`;
    statsText += `Max same message: ${antiSpam.MAX_SAME_MESSAGE}\n`;
    statsText += `Timeout duration: ${antiSpam.TIMEOUT_DURATION/1000}s`;

    await this.sock.sendMessage(groupId, { text: statsText });
  }

async cmdResetSpam(groupId, sender, args) {
    try {
      // Get group metadata to check if sender is admin
      const groupMetadata = await this.sock.groupMetadata(groupId);
      const participants = groupMetadata.participants;
      
      // Find sender in participants
      const senderParticipant = participants.find(p => p.id === sender);
      
      // Check if sender is admin or super admin
      if (!senderParticipant || (senderParticipant.admin !== 'admin' && senderParticipant.admin !== 'superadmin')) {
        return this.sock.sendMessage(groupId, { 
          text: "⛔ Hanya admin grup yang bisa reset anti-spam." 
        });
      }

      if (args[1] === "all") {
        // Reset all users
        antiSpam.userMessages.clear();
        antiSpam.blockedUsers.clear();
        await this.sock.sendMessage(groupId, { 
          text: "🧹 Semua data anti-spam telah direset!\n\n🎉 Fresh start untuk semua!" 
        });
      } else {
        // Reset self
        const success = antiSpam.resetUser(sender);
        await this.sock.sendMessage(groupId, { 
          text: success ? "🧹 Data spam kamu telah direset!" : "⛔ Gagal reset data spam." 
        });
      }
    } catch (err) {
      console.error("Error checking group admin status:", err);
      await this.sock.sendMessage(groupId, { 
        text: "⛔ Gagal mengecek status admin. Pastikan bot memiliki akses grup." 
      });
    }
  }

  async cmdLinkInit(groupId, sender) {
    if (linkHelper.isLinked(sender)) {
      const user = linkHelper.getUser(sender);
      return this.sock.sendMessage(groupId, {
        text: `✅ Akun *${user.username}* sudah terhubung. Gunakan /myid untuk info detail.`,
      });
    }

    const displayName = await this.getDisplayName(sender);
    const success = await linkHelper.initiateLinking(this.sock, groupId, sender, displayName);
    
    if (success) {
      await this.sock.sendMessage(groupId, {
        text: `📱 Kode link sudah dikirim ke DM *${displayName}*!\n\n💡 Cek DM, ketik /link <kode>, lalu /usn <nama> untuk set nama game.`,
      });
    } else {
      await this.sock.sendMessage(groupId, {
        text: `❌ Gagal mengirim kode link ke *${displayName}*. Pastikan bot bisa mengirim DM.`,
      });
    }
  }

  async cmdStartSimple(groupId, sender, args) {
    if (this.game && (this.game.inLobby || this.game.inGame)) {
      return this.sock.sendMessage(groupId, { text: "❌ Sudah ada lobby/game berjalan. Gunakan /reset dulu." });
    }
    if (!linkHelper.isLinked(sender)) {
      return this.sock.sendMessage(groupId, { text: "❌ Kamu harus /link dulu sebelum bisa membuat lobby." });
    }

    const user = linkHelper.getUser(sender);
    const gId = linkHelper.getGroupMemberId(sender);
    const dayDur = args[1] ? parseInt(args[1]) : 120;
    const nightDur = args[2] ? parseInt(args[2]) : 90;

    console.log(`🎮 Creating SimpleGame: host=${user.username}, hostId=${gId}, sender=${sender}`);

    this.game = new SimpleGame(this.sock, groupId);
    this.mode = "simple";
    
    // CRITICAL: Store the sender (group member ID) as hostId
    await this.game.startLobby(user.customUsername || user.username, dayDur, nightDur, sender);
  }

  async cmdStartChaos(groupId, sender, args) {
    if (this.game && (this.game.inLobby || this.game.inGame)) {
      return this.sock.sendMessage(groupId, { text: "❌ Sudah ada lobby/game berjalan. Gunakan /reset dulu." });
    }
    if (!linkHelper.isLinked(sender)) {
      return this.sock.sendMessage(groupId, { text: "❌ Kamu harus /link dulu sebelum bisa membuat lobby." });
    }

    const user = linkHelper.getUser(sender);
    const gId = linkHelper.getGroupMemberId(sender);
    const dayDur = args[1] ? parseInt(args[1]) : 120;
    const nightDur = args[2] ? parseInt(args[2]) : 90;

    this.game = new Game(this.sock, groupId);
    this.mode = "chaos";
    await this.game.startLobby(user.customUsername || user.username, dayDur, nightDur, sender);
  }

  async cmdJoin(sender) {
    if (!this.game || !this.game.inLobby) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Tidak ada lobby terbuka." });
    }
    if (!linkHelper.isLinked(sender)) {
      return this.sock.sendMessage(this.groupId, {
        text: "❌ Kamu harus /link dulu sebelum bisa join lobby.",
      });
    }

    const user = linkHelper.getUser(sender);
    console.log(`👤 Player joining: ${user.username}, sender=${sender}`);

    // Use sender directly as the game ID
    const ok = this.game.addPlayer(sender, user.customUsername || user.username);
    if (!ok) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Kamu sudah join atau game sudah dimulai." });
    }

    await this.game.broadcast(`🙋 ${user.customUsername || user.username} bergabung ke lobby!`);
  }

  async cmdForcestart(senderId) {
    console.log(`🚀 Force start requested by: ${senderId}`);
    
    if (!this.game) {
      console.log(`❌ No game exists`);
      return this.sock.sendMessage(this.groupId, { text: "❌ Tidak ada lobby aktif." });
    }

    console.log(`🚀 Game hostId: ${this.game.hostId}, senderId: ${senderId}`);
    
    // Direct comparison - sender should match hostId
    if (senderId !== this.game.hostId) {
      console.log(`❌ Not host: ${senderId} !== ${this.game.hostId}`);
      return this.sock.sendMessage(this.groupId, { text: "❌ Hanya host yang bisa paksa mulai." });
    }
    
    if (!this.game.inLobby) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Lobby sudah ditutup." });
    }
    
    if (this.game.playerCount() < 5) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Pemain kurang dari 5. Tidak bisa mulai." });
    }

    console.log(`✅ Force start conditions met`);
    await this.game.broadcast("🚀 Host memutuskan untuk memulai permainan sekarang!");
    
    // Clear lobby timers
    Object.values(this.game.timers).forEach(timer => clearTimeout(timer));
    this.game.timers = {};
    
    this.game.inLobby = false;
    await this.game.beginGame();
  }

  async cmdPlayers(inDm = false, sender = null, from = null) {
    if (!this.game || (!this.game.inLobby && !this.game.inGame)) {
      const target = inDm ? sender : (this.groupId || from);
      return this.sock.sendMessage(target, { text: "❌ Belum ada game atau lobby berjalan." });
    }
    const txt = this.game.listPlayers(inDm);
    if (inDm) {
      await this.sock.sendMessage(sender, { text: `📋 Daftar pemain:\n${txt}` });
    } else {
      await this.game.broadcast(`📋 Daftar pemain (${this.game.playerCount()}):\n${txt}`);
    }
  }

  async cmdReset(sender) {
    console.log(`🔄 Reset requested by: ${sender}`);
    
    if (!this.game) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Tidak ada game aktif untuk direset." });
    }

    console.log(`🔄 Game hostId: ${this.game.hostId}, senderId: ${sender}`);

    // Direct comparison
    if (sender !== this.game.hostId) {
      return this.sock.sendMessage(this.groupId, { text: "❌ Hanya host yang bisa reset." });
    }
    
    this.game.reset();
    await this.game.broadcast("🔄 Game direset.");
    this.game = null;
    this.mode = null;
  }

  async cmdRoleDef(sender, from) {
    const roles = listSimple().join("\n\n");
    await this.sock.sendMessage(sender, { text: `📜 *Role Simple Edition*\n\n${roles}` });
    if (from) {
      await this.sock.sendMessage(from, { text: "📩 Role Simple Edition sudah terkirim via DM." });
    }
  }

  async cmdRoleChaos(sender, from) {
    const roles = listChaos().join("\n\n");
    await this.sock.sendMessage(sender, { text: `📜 *Role Chaos Edition*\n\n${roles}` });
    if (from) {
      await this.sock.sendMessage(from, { text: "📩 Role Chaos Edition sudah terkirim via DM." });
    }
  }

  async cmdMyId(sender, from) {
    const info = linkHelper.getMyId(sender);
    await this.sock.sendMessage(sender, { text: info });
    if (from) {
      await this.sock.sendMessage(from, { text: "📩 Informasi akun sudah terkirim via DM." });
    }
  }

  async cmdForceVote(sender) {
    if (!this.game || this.game.phase !== "discussion") {
      return this.sock.sendMessage(this.groupId, { text: "❌ Forcevote hanya bisa saat diskusi." });
    }

    // Use sender directly since we're storing group member IDs as player IDs
    const req = this.game.forceVoteRequest(sender);

    if (!req.success) {
      return this.sock.sendMessage(this.groupId, { text: `❌ ${req.message}` });
    }

    const playerName = this.game.players[sender] ? this.game.players[sender].usn : "Seseorang";
    await this.game.broadcast(`📣 ${playerName} meminta voting cepat. (${req.have}/${req.need})`);
    
    if (await this.game.triggerForceVoteIfThreshold()) return;
  }

  // Static cleanup method
  static cleanup(groupId) {
    gameInstances.delete(groupId);
  }
}

// Export both class and instances map for external access
module.exports = CommandHandler;