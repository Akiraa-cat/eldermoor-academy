// simple-game.js
const { roleInfo } = require("./roles-simple");
const linkHelper = require("./linkHelper");

class SimpleGame {
  constructor(sock, groupId = null) {
    this.sock = sock;
    this.groupId = groupId;
    this.reset();
  }

  resolveId(id){
    const gId = linkHelper.getGroupMemberId(id);
    return gId || id;
  }
  
  async dm(to, msg) {
    const dmId = linkHelper.getDmId(to) || to; // selalu convert
    try {
      await this.sock.sendMessage(dmId, { text: msg });
    } catch (err) {
      console.error(`❌ DM gagal ke ${to} (mapped: ${dmId})`, err);
    }
  }

  reset() {
    this.inLobby = false;
    this.inGame = false;
    this.phase = null;

    this.players = {}; // {id: {id, usn, role, alive, lovers, ...}}
    this.hostId = null;
    this.day = 0;

    this.actions = {};
    this.votes = {};
    this.pendingHunter = null;
    this.hunterTimeout = null;
    this.forceVoteRequests = new Set(); // Track force vote requests
    this.lastVoteTime = {};

    this.timers = {};
    this.gameHistory = []; // Track game events
    this.nightKillTarget = null; // Track who was killed by wolves for witch heal
  }

  setGroup(groupId) {
    this.groupId = groupId;
  }

  async broadcast(msg) {
    if (this.groupId) {
      await this.sock.sendMessage(this.groupId, { text: msg });
    }
  }

  // ---------------- ADD MISSING handleChoice METHOD ----------------
async handleChoice(senderId, numbers) {
  console.log(`🎯 handleChoice called: senderId=${senderId}, numbers=${JSON.stringify(numbers)}`);
  
  // IMPORTANT: Use resolveId to get the group member ID consistently
  const gId = this.resolveId(senderId);
  const player = this.players[gId];
  
  console.log(`🎯 Resolved senderId=${senderId} to gId=${gId}, player exists=${!!player}`);
  
  if (!player || !player.alive) {
    console.log(`❌ Player ${gId} not found or not alive`);
    await this.dm(senderId, "❌ Anda tidak dapat melakukan aksi saat ini.");
    return;
  }
  
  if (player.actionTaken) {
    await this.dm(senderId, "⚠️ Anda sudah melakukan aksi untuk fase ini.");
    return;
  }

  const role = player.role;
  const aliveList = this.alivePlayers().filter(x => x.id !== gId);

  console.log(`🎯 Player role=${role}, phase=${this.phase}, aliveList length=${aliveList.length}`);

  if (this.phase === "night") {
    await this.processNightAction(player, role, numbers, aliveList);
  } else if (this.phase === "vote") {
    await this.processVote(player, numbers, aliveList);
  } else if (this.pendingHunter === gId) {
    await this.processHunterRevenge(player, numbers, aliveList);
  } else {
    console.log(`❌ No valid phase for choice: phase=${this.phase}, pendingHunter=${this.pendingHunter}`);
    await this.dm(senderId, "❌ Tidak dapat melakukan aksi saat ini.");
  }
}

// === DEBUGGING HELPER ===
// Add this method to SimpleGame class for debugging:
debugPlayerIds() {
  console.log("=== PLAYER ID DEBUG ===");
  for (const [id, player] of Object.entries(this.players)) {
    console.log(`Stored ID: ${id}, Player: ${player.usn}, Role: ${player.role}`);
  }
  console.log("=====================");
}
  // ---------------- ADD MISSING forceVoteRequest METHOD ----------------
  forceVoteRequest(playerId) {
    if (this.phase !== "discussion") {
      return { success: false, message: "Force vote hanya bisa saat diskusi." };
    }

    // Add player to force vote requests
    this.forceVoteRequests.add(playerId);
    
    const aliveCount = this.alivePlayers().length;
    const needed = Math.ceil(aliveCount * 0.6); // 60% threshold
    const current = this.forceVoteRequests.size;
    
    return {
      success: true,
      have: current,
      need: needed
    };
  }

  // ---------------- ADD MISSING triggerForceVoteIfThreshold METHOD ----------------
  async triggerForceVoteIfThreshold() {
    const aliveCount = this.alivePlayers().length;
    const needed = Math.ceil(aliveCount * 0.6);
    const current = this.forceVoteRequests.size;
    
    if (current >= needed) {
      await this.broadcast("🚀 Force vote berhasil! Voting dimulai sekarang!");
      
      // Clear discussion timer and start voting
      if (this.timers.voteStart) {
        clearTimeout(this.timers.voteStart);
      }
      
      this.forceVoteRequests.clear();
      await this.startVoting();
      return true;
    }
    
    return false;
  }

  // ---------------- Lobby ----------------
  async startLobby(hostUsn, dayDur, nightDur, hostId) {
    this.inLobby = true;
    this.hostId = hostId;
    this.dayDur = dayDur || 120; // Default 2 minutes
    this.nightDur = nightDur || 90; // Default 1.5 minutes

    console.log(`🎮 Starting lobby: host=${hostUsn}, hostId=${hostId}`);

    await this.broadcast(
      `🎮 *Selamat datang di Eldermoor yang terkutuk!* 🎮\n\n` +
      `👨‍🌾 *SIMPLE EDITION!* 🌕\n\n` +
      `👑 *Dalang Permainan:* ${hostUsn}\n` +
      `🌅 *Durasi Siang:* ${this.dayDur} detik\n` +
      `🌙 *Durasi Malam:* ${this.nightDur} detik\n\n` +
      `*Legenda berkata bahwa serigala-serigala terkutuk berkeliaran di malam hari...*\n` +
      `*Akankah warga desa selamat dari teror yang menghantui?*\n\n` +
      `Ketik */join* untuk bergabung dalam perjuangan hidup dan mati ini.`
    );

     // Reminder 60s
  this.timers.lobby60 = setTimeout(() => {
    if (this.inLobby) this.broadcast("⌛ Lobby akan ditutup dalam 60 detik!");
  }, 60000);

  // Reminder 30s
  this.timers.lobby30 = setTimeout(() => {
    if (this.inLobby) this.broadcast("⌛ Lobby akan ditutup dalam 30 detik!");
  }, 90000);

  // Reminder 10s
  this.timers.lobby10 = setTimeout(() => {
    if (this.inLobby) this.broadcast("⌛ Lobby akan ditutup dalam 10 detik!");
  }, 110000);

  // Auto close lobby at 120s
  this.timers.lobbyEnd = setTimeout(async () => {
    if (!this.inLobby) return;
    this.inLobby = false;

    if (this.playerCount() >= 5) {
      await this.broadcast("🚀 Lobby ditutup! Permainan dimulai...");
      await this.beginGame();
    } else {
      await this.broadcast("❌ *Eldermoor membutuhkan setidaknya 5 warga yang berani untuk memulai ritual ini!*");
      this.endGame();
    }
  }, 120000);
  }

  addPlayer(id, usn) {
    const gId = this.resolveId(id);
    console.log(`👤 Adding player: id=${id}, gId=${gId}, usn=${usn}`);
    
    if (this.players[gId]) {
      console.log(`❌ Player ${gId} already exists`);
      return false;
    }
    if (!this.inLobby) {
      console.log(`❌ Lobby not open`);
      return false;
    }

    this.players[gId] = { 
      id: gId, 
      usn,
      alive: true, 
      role: null, 
      lovers: [],
      canRevenge: false,
      hasHeal: false,
      hasPoison: false,
      waitingPoison: false,
      actionTaken: false
    };
    
    console.log(`✅ Player added successfully. Total players: ${this.playerCount()}`);
    return true;
  }

  playerCount() {
    return Object.values(this.players).length;
  }

  listPlayers(inDm = false) {
    const players = Object.values(this.players);
    if (inDm) {
      return players.map((p, i) => `${i + 1}. ${p.usn}`).join("\n");
    }
    return players
      .map((p, i) => `${i + 1}. ${p.usn}${p.alive ? " 💚" : " ☠️"}`)
      .join("\n");
  }

  // ---------------- Role Assignment ----------------
// Add this Fisher-Yates shuffle method to your class
fisherYatesShuffle(array) {
  const shuffled = [...array]; // Create a copy to avoid mutating the original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Add this validation method to your class
validateRoleBalance(roles) {
  const werewolfCount = roles.filter(r => r === "Werewolf" || r === "Alpha Werewolf").length;
  const villagerCount = roles.filter(r => r === "Villager").length;
  const specialCount = roles.filter(r => !["Werewolf", "Alpha Werewolf", "Villager"].includes(r)).length;
  
  console.log(`🎯 Role validation: ${werewolfCount} werewolves, ${specialCount} special roles, ${villagerCount} villagers`);
  
  // Basic balance check - werewolves should not exceed 1/3 of total players
  if (werewolfCount > Math.ceil(roles.length / 3)) {
    console.warn("⚠️ Warning: Too many werewolves for balanced gameplay!");
  }
}

assignRoles() {
  const ids = Object.keys(this.players);
  const n = ids.length;
  
  if (n < 5) throw new Error("*Eldermoor membutuhkan setidaknya 5 warga yang berani untuk memulai ritual ini!*");

  // Balanced role distribution based on player count
  const roleDistribution = this.getBalancedRoleDistribution(n);
  
  let pool = [];
  
  // Add werewolves (minimum 1, maximum based on balance)
  for (let i = 0; i < roleDistribution.werewolves; i++) {
    if (i === 0) {
      pool.push("Werewolf");
    } else if (n >= 8) {
      // Only add Alpha Werewolf for 8+ players
      pool.push("Alpha Werewolf");
    } else {
      pool.push("Werewolf");
    }
  }
  
  // Add mandatory roles
  pool.push("Seer");
  pool.push("Guardian Angel");
  
  let remainingSlots = n - pool.length;
  
  // Add other special roles based on player count
  if (roleDistribution.detective && remainingSlots > 0) {
    pool.push("Detective");
    remainingSlots--;
  }
  
  if (roleDistribution.witch && remainingSlots > 0) {
    pool.push("Witch");
    remainingSlots--;
  }
  
  if (roleDistribution.hunter && remainingSlots > 0) {
    pool.push("Hunter");
    remainingSlots--;
  }
  
  if (roleDistribution.traitor && remainingSlots > 0) {
    pool.push("Traitor");
    remainingSlots--;
  }
  
  // Fill remaining slots with villagers
  while (remainingSlots > 0) {
    pool.push("Villager");
    remainingSlots--;
  }

  // Shuffle the entire pool
  pool = this.fisherYatesShuffle(pool);

  // Assign roles to players
  ids.forEach((id, i) => {
    const player = this.players[id];
    player.role = pool[i];
    
    // Set role-specific properties
    if (pool[i] === "Hunter") {
      player.canRevenge = true;
    }
    if (pool[i] === "Witch") {
      player.hasHeal = true;
      player.hasPoison = true;
    }
  });

  // Log the assignment for debugging
  const werewolfCount = pool.filter(r => r === "Werewolf" || r === "Alpha Werewolf").length;
  const specialRoles = pool.filter(r => r !== "Villager").length;
  
  console.log(`🎭 Balanced role assignment for ${n} players:`);
  console.log(`   Werewolves: ${werewolfCount}, Special Roles: ${specialRoles}, Villagers: ${n - specialRoles}`);
  console.log("🎭 Roles assigned:", Object.entries(this.players).map(([id, p]) => `${p.usn}: ${p.role}`));
  
  // Validate assignment
  this.validateRoleBalance(pool);
}

// Get balanced role distribution based on player count
getBalancedRoleDistribution(playerCount) {
  const distributions = {
    5: { werewolves: 1, detective: false, witch: false, hunter: false, traitor: false },
    6: { werewolves: 1, detective: true, witch: false, hunter: false, traitor: false },
    7: { werewolves: 1, detective: true, witch: true, hunter: false, traitor: false },
    8: { werewolves: 2, detective: true, witch: true, hunter: false, traitor: false },
    9: { werewolves: 2, detective: true, witch: true, hunter: true, traitor: false },
    10: { werwolves: 2, detective: true, witch: true, hunter: true, traitor: true }, // Fixed typo: werewolves
    11: { werewolves: 2, detective: true, witch: true, hunter: true, traitor: true },
    12: { werewolves: 3, detective: true, witch: true, hunter: true, traitor: true } // Fixed typo: werewolves
  };
  
  // For player counts not explicitly defined, use the closest lower count
  let targetCount = playerCount;
  while (targetCount > 5 && !distributions[targetCount]) {
    targetCount--;
  }
  
  // For very large games (13+), scale werewolves but keep others balanced
  if (playerCount > 12) {
    const baseDistribution = distributions[12];
    const werewolfCount = Math.min(Math.floor(playerCount / 4), 4); // Max 4 werewolves
    return { ...baseDistribution, werewolves: werewolfCount };
  }
  
  return distributions[targetCount] || distributions[5];
}

  // Send werewolf team information during role assignment
  async sendWerewolfTeamInfo() {
    const werewolves = Object.values(this.players).filter(p => 
      p.role === "Werewolf" || p.role === "Alpha Werewolf"
    );
    
    if (werewolves.length <= 1) return; // No team info needed for solo werewolf
    
    const teamList = werewolves.map(w => `• ${w.usn} (${w.role})`).join('\n');
    
    for (const wolf of werewolves) {
      await this.dm(wolf.id, 
        `🐺 *IKATAN KAWANAN* 🐺\n\n` +
        `*Darah serigala mengalir dalam diri kalian...*\n` +
        `*Kalian dapat merasakan keberadaan saudara sedarah...*\n\n` +
        `**ANGGOTA KAWANAN:**\n${teamList}\n\n` +
        `*Bekerjalahlah bersama untuk menguasai Eldermoor!*\n` +
        `*Koordinasikan serangan kalian dengan bijak...*`
      );
    }
  }

  // Updated validation for better balance checking
  validateRoleBalance(pool) {
    const counts = {};
    pool.forEach(role => counts[role] = (counts[role] || 0) + 1);
    
    const evilCount = (counts.Werewolf || 0) + (counts["Alpha Werewolf"] || 0) + (counts.Traitor || 0);
    const villageCount = pool.length - evilCount;
    
    // Check if evil ratio is reasonable (15-35% for balanced gameplay)
    const evilRatio = evilCount / pool.length;
    if (evilRatio < 0.15 || evilRatio > 0.35) {
      console.warn(`⚠️ Role balance warning: Evil ratio is ${(evilRatio * 100).toFixed(1)}% (recommended: 15-35%)`);
    }
    
    // Ensure mandatory roles are present
    if (!counts.Seer) {
      console.error(`❌ Missing mandatory role: Seer`);
    }
    if (!counts["Guardian Angel"]) {
      console.error(`❌ Missing mandatory role: Guardian Angel`);
    }
    if (evilCount === 0) {
      console.error(`❌ No evil roles assigned!`);
    }
    
    console.log(`✅ Role validation: ${evilCount} evil vs ${villageCount} village (${(evilRatio * 100).toFixed(1)}% evil)`);
    console.log(`📊 Role breakdown:`, counts);
  }

  // ---------------- Game Flow ----------------
// Updated beginGame method to include werewolf team communication
  async beginGame() {
    if (this.playerCount() < 5) {
      await this.broadcast("❌ *Eldermoor membutuhkan setidaknya 5 warga yang berani untuk memulai ritual ini.*");
      return;
    }

    this.inLobby = false;
    this.inGame = true;
    this.day = 1;

    try {
      this.assignRoles();
    } catch (error) {
      await this.broadcast(`❌ ${error.message}`);
      return;
    }

    await this.broadcast(
      `🌑 *MALAM PERTAMA DI ELDERMOOR* 🌑\n\n` +
      `*Kabut tebal menyelimuti desa yang terkutuk ini...*\n` +
      `*Angin berbisik tentang kutukan kuno yang telah bangkit...*\n` +
      `*Para serigala lapar mulai berkeliaran dalam kegelapan...*\n\n` +
      `*Takdir kalian kini telah ditentukan. Lihatlah pesan pribadi untuk mengetahui jati diri sejati kalian...*`
    );

    // Send role information
    for (const p of Object.values(this.players)) {
      const roleDescription = roleInfo(p.role);
      await this.dm(p.id, 
        `🎭 *TAKDIR ANDA TELAH DITENTUKAN* 🎭\n\n` +
        `*Peran Anda:* **${p.role}**\n\n` +
        `${roleDescription}\n\n` +
        `*Semoga keberuntungan menyertai Anda dalam malam-malam yang akan datang...*`
      );
    }

    // Send werewolf team information (NEW ADDITION)
    await this.sendWerewolfTeamInfo();

    // Start first night
    setTimeout(() => this.startNight(), 3000);
  }

  alivePlayers() {
    return Object.values(this.players).filter(p => p.alive);
  }

  aliveWolves() {
    return this.alivePlayers().filter(p => 
      p.role === "Werewolf" || p.role === "Alpha Werewolf"
    );
  }

  aliveVillagers() {
    return this.alivePlayers().filter(p => 
      !["Werewolf", "Alpha Werewolf", "Traitor"].includes(p.role)
    );
  }

  // Enhanced werewolf coordination during night actions
  async processWerewolfKillVoting(player, target) {
    const werewolves = this.aliveWolves();
    
    if (werewolves.length > 1) {
      // Multi-werewolf coordination
      this.actions[player.id] = { action: "wolf_kill", target: target.id };
      
      // Notify this werewolf
      if (player.role === "Alpha Werewolf") {
        await this.dm(player.id, 
          `🐺 *PERINTAH ALFA DIBERIKAN* 🐺\n\n` +
          `*Sebagai alfa, Anda menunjuk ${target.usn} sebagai target kawanan.*\n` +
          `*Perintah telah dikirim ke seluruh anggota kawanan...*`
        );
      } else {
        await this.dm(player.id, 
          `🐺 *SUARA KAWANAN TERCATAT* 🐺\n\n` +
          `*Anda memilih ${target.usn} sebagai target malam ini.*\n` +
          `*Kawanan akan bermusyawarah untuk menentukan mangsa...*`
        );
      }
      
      // Notify other werewolves about the vote
      for (const wolf of werewolves) {
        if (wolf.id !== player.id) {
          const voterName = player.usn;
          await this.dm(wolf.id, 
            `🐺 *SUARA KAWANAN* 🐺\n\n` +
            `*${voterName} telah memilih ${target.usn} sebagai target.*\n` +
            `*${this.getWerewolfVoteStatus()}*`
          );
        }
      }
    } else {
      // Solo werewolf
      this.actions[player.id] = { action: "wolf_kill", target: target.id };
      await this.dm(player.id, 
        `🐺 *MANGSA DIPILIH* 🐺\n\n` +
        `*${target.usn}... aroma darahnya menggiurkan...*\n` +
        `*Malam ini dia akan merasakan taring kegelapan...*`
      );
    }
  }

  // Get current werewolf voting status
  getWerewolfVoteStatus() {
    const werewolves = this.aliveWolves();
    const wolfVotes = {};
    let totalVotes = 0;
    
    // Count werewolf votes
    for (const [id, action] of Object.entries(this.actions)) {
      if (action.action === "wolf_kill") {
        const voter = this.players[id];
        if (voter && (voter.role === "Werewolf" || voter.role === "Alpha Werewolf")) {
          wolfVotes[action.target] = (wolfVotes[action.target] || 0) + 1;
          totalVotes++;
        }
      }
    }
    
    if (totalVotes === 0) {
      return `Menunggu suara kawanan... (0/${werewolves.length})`;
    }
    
    const targetCounts = Object.entries(wolfVotes)
      .map(([targetId, count]) => {
        const target = this.players[targetId];
        return `${target ? target.usn : 'Unknown'}: ${count} suara`;
      })
      .join(', ');
      
    return `Status voting: ${targetCounts} (${totalVotes}/${werewolves.length})`;
  }

  // Enhanced night resolution with werewolf coordination
  async resolveNight() {
    if (this.phase !== "night") return;
    
    clearTimeout(this.timers.nightEnd);

    const deaths = [];
    const protects = new Set();
    let wolfKillTarget = null;

    // Collect protections (same as before)
    for (const [gid, act] of Object.entries(this.actions)) {
      if (act.action === "protect") {
        const guardian = this.players[gid];
        const target = this.players[act.target];
        
        if (guardian && guardian.alive && target) {
          if (target.role === "Werewolf" || target.role === "Alpha Werewolf") {
            guardian.alive = false;
            deaths.push({ id: guardian.id, cause: "wolf_guard_fail", victim: guardian });
            await this.dm(guardian.id, 
              `🛡️ *KEGAGALAN MEMATIKAN* 🛡️\n\n` +
              `*Kamu mencoba melindungi ${target.usn}...*\n` +
              `*Namun ternyata dia adalah serigala!* 🐺\n` +
              `*Seketika kawanan mencabikmu tanpa ampun...*`
            );
            await this.broadcast(
              `🛡️ *Guardian Angel gugur tragis!* 🛡️\n\n` +
              `*Ia mencoba melindungi seseorang... namun salah sangka.*\n` +
              `*Sayap sucinya tercabik oleh serigala buas...*`
            );
          } else {
            protects.add(act.target);
          }
        }
      }
    }

    // Enhanced werewolf kill processing with voting system
    const wolfVotes = {};
    const werewolves = this.aliveWolves();
    
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "wolf_kill") {
        const voter = this.players[id];
        if (voter && (voter.role === "Werewolf" || voter.role === "Alpha Werewolf")) {
          // Alpha werewolf vote counts double for tiebreaking
          const voteWeight = voter.role === "Alpha Werewolf" ? 1.1 : 1;
          wolfVotes[act.target] = (wolfVotes[act.target] || 0) + voteWeight;
        }
      }
    }
    
    if (Object.keys(wolfVotes).length > 0) {
      // Find target with most votes (alpha werewolf breaks ties)
      wolfKillTarget = Object.keys(wolfVotes).reduce((a, b) => 
        wolfVotes[a] >= wolfVotes[b] ? a : b
      );
      
      this.nightKillTarget = wolfKillTarget;
      
      if (!protects.has(wolfKillTarget)) {
        const victim = this.players[wolfKillTarget];
        if (victim) {
          victim.alive = false;
          deaths.push({ id: wolfKillTarget, cause: "werewolf", victim });
          
          // Notify werewolves of successful kill
          const targetName = victim.usn;
          for (const wolf of werewolves) {
            await this.dm(wolf.id, 
              `🐺 *KAWANAN BERHASIL* 🐺\n\n` +
              `*${targetName} telah menjadi mangsa kawanan...*\n` +
              `*Darah segar mengalir di tanah Eldermoor...*`
            );
          }
        }
      } else {
        // Notify werewolves of failed kill due to protection
        for (const wolf of werewolves) {
          await this.dm(wolf.id, 
            `🐺 *SERANGAN TERGAGALKAN* 🐺\n\n` +
            `*Target dilindungi oleh kekuatan suci...*\n` +
            `*Kawanan mundur dalam kegelapan...*`
          );
        }
      }
    }

    // Rest of night resolution (witch heal/poison) remains the same...
    // Process witch heal (can save wolf kill victim)
    let healUsed = false;
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "witch_heal" && wolfKillTarget) {
        const deathIndex = deaths.findIndex(d => d.id === wolfKillTarget);
        if (deathIndex !== -1) {
          const saved = deaths.splice(deathIndex, 1)[0];
          this.players[saved.id].alive = true;
          healUsed = true;
          break;
        }
      }
    }

    // Process witch poison
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "witch_poison") {
        const victim = this.players[act.target];
        if (victim && victim.alive) {
          victim.alive = false;
          deaths.push({ id: act.target, cause: "witch_poison", victim });
        }
      }
    }

    // Generate morning narrative
    await this.generateMorningNarrative(deaths, healUsed, protects.has(wolfKillTarget));

    // Check win condition
    if (await this.checkWinCondition()) return;

    this.day++;
    await this.startDiscussion();
  }

  // ---------------- Win Condition Check ----------------
  async checkWinCondition() {
    const alive = this.alivePlayers();
    const wolves = alive.filter(p => ["Werewolf", "Alpha Werewolf"].includes(p.role));
    const villagers = alive.filter(p => !["Werewolf", "Alpha Werewolf", "Traitor"].includes(p.role));
    const traitors = alive.filter(p => p.role === "Traitor");

    if (wolves.length === 0) {
      // Village wins
      await this.broadcast(
        `🌅 **KEMENANGAN DESA ELDERMOOR!** 🌅\n\n` +
        `*Fajar menyingsing dengan cahaya emas...*\n` +
        `*Kutukan telah dipatahkan! Serigala-serigala terkutuk telah dikalahkan!*\n` +
        `*Para warga yang tersisa berdiri tegak, meski dengan luka dan kenangan kelam...*\n\n` +
        `👑 **PARA PAHLAWAN:**\n${villagers.map(p => `• ${p.usn} (${p.role})`).join('\n')}\n\n` +
        `*Eldermoor kini aman... setidaknya untuk saat ini.*`
      );
      this.endGame();
      return true;
    }

    if (wolves.length >= villagers.length) {
      // Wolves win
      await this.broadcast(
        `🐺 **KEMENANGAN KEGELAPAN!** 🐺\n\n` +
        `*Auman serigala bergema di seluruh Eldermoor...*\n` +
        `*Kegelapan telah menguasai desa! Para serigala terkutuk meraih kemenangan!*\n` +
        `*Darah mengalir di jalanan, dan teror akan berlanjut selamanya...*\n\n` +
        `👹 **PENGUASA KEGELAPAN:**\n${wolves.concat(traitors).map(p => `• ${p.usn} (${p.role})`).join('\n')}\n\n` +
        `*Eldermoor kini menjadi sarang kutukan...*`
      );
      this.endGame();
      return true;
    }

    return false;
  }

  endGame() {
    this.inGame = false;
    this.phase = null;
    Object.values(this.timers).forEach(timer => clearTimeout(timer));
    if (this.hunterTimeout) clearTimeout(this.hunterTimeout);
    this.timers = {};
  }

  // ---------------- Night Phase ----------------
  async startNight() {
    if (!this.inGame) return;
    
    this.phase = "night";
    this.actions = {};
    this.nightKillTarget = null;

    // Reset action flags and force vote requests
    this.forceVoteRequests.clear();
    Object.values(this.players).forEach(p => {
      p.actionTaken = false;
      p.waitingPoison = false;
    });

    const nightNarrative = [
      `🌙 *MALAM ${this.day} - KEGELAPAN MENYELIMUTI* 🌙`,
      `*Angin malam berbisik dengan suara-suara dari alam lain...*`,
      `*Para warga menutup mata, namun tidak semua dari mereka akan tidur nyenyak...*`,
      `*Sesuatu yang jahat sedang bergerak dalam bayangan...*`
    ];

    await this.broadcast(nightNarrative.join('\n\n'));

    // Send night action prompts
    for (const p of this.alivePlayers()) {
      await this.promptNightAction(p);
    }

    // Set night timer
    this.timers.nightEnd = setTimeout(() => {
      this.resolveNight();
    }, this.nightDur * 1000);

    // Send countdown warning
    setTimeout(() => {
      if (this.phase === "night") {
        this.broadcast("⏰ *30 detik tersisa untuk aksi malam!*");
      }
    }, (this.nightDur - 30) * 1000);
  }

  async promptNightAction(p) {
    const alive = this.alivePlayers().filter(x => x.id !== p.id);
    const numbered = alive.map((x, i) => `${i + 1}. ${x.usn}`).join("\n");

    const nightPrompts = {
      "Seer": {
        text: `🔮 *PENGLIHATAN MISTIS* 🔮\n\n*Mata batin Anda terbuka di kegelapan malam...*\n*Kristal ramalan berpendar, siap mengungkap rahasia tersembunyi...*\n\n**Siapa yang akan Anda terawang malam ini?**\n\n${numbered}\n\n*Pilih dengan* \`/<nomor>\` *atau* \`/skip\` *untuk melewati.*`,
        hasAction: true
      },
      
      "Guardian Angel": {
        text: `👼 *PENJAGA CAHAYA* 👼\n\n*Sayap putih Anda berkilau di bawah bulan...*\n*Kekuatan perlindungan ilahi mengalir dalam diri Anda...*\n\n**Jiwa mana yang akan Anda lindungi malam ini?**\n\n${numbered}\n\n*Pilih dengan* \`/<nomor>\` *atau* \`/skip\` *untuk melewati.*`,
        hasAction: true
      },

      "Werewolf": {
        text: `🐺 *NALURI PEMBUNUH BANGKIT* 🐺\n\n*Darah serigala mengalir deras di nadi Anda...*\n*Taring tajam bersiap merobek daging...*\n*Kelaparan akan darah tak tertahankan...*\n\n**Siapa yang akan menjadi mangsa Anda malam ini?**\n\n${numbered}\n\n*Pilih dengan* \`/<nomor>\``,
        hasAction: true
      },

      "Alpha Werewolf": {
        text: `🐺 *PEMIMPIN KAWANAN KEGELAPAN* 🐺\n\n*Aura kekuasaan dan keganasan memancar dari diri Anda...*\n*Sebagai alfa, pilihan Anda akan menentukan nasib seseorang...*\n*Kawanan menunggu perintah dari sang pemimpin...*\n\n**Siapa yang akan menjadi korban kawanan malam ini?**\n\n${numbered}\n\n*Pilih dengan* \`/<nomor>\``,
        hasAction: true
      },

      "Witch": {
        text: `🧙‍♀️ *PENYIHIR RAMUAN KUNO* 🧙‍♀️\n\n*Kuali hitam mendidih dengan ramuan misterius...*\n*Di tangan Anda tersimpan kekuatan hidup dan mati...*\n\n**Pilih ramuan yang akan Anda gunakan:**\n1. 💚 Heal - Menyelamatkan jiwa (${p.hasHeal ? 'Tersedia' : 'Sudah digunakan'})\n2. ☠️ Poison - Meracuni musuh (${p.hasPoison ? 'Tersedia' : 'Sudah digunakan'})\n3. ⭐ Skip - Tidak melakukan apa-apa\n\n*Balas dengan* \`/1\`, \`/2\`, *atau* \`/3\``,
        hasAction: true
      },

      "Detective": {
        text: `🕵️ *MATA ELANG DI KEGELAPAN* 🕵️\n\n*Insting detektif Anda berbisik dalam keheningan...*\n*Kaca pembesar berkilau, siap mengungkap kebenaran tersembunyi...*\n\n**Siapa yang akan Anda selidiki malam ini?**\n\n${numbered}\n\n*Pilih dengan* \`/<nomor>\` *atau* \`/skip\` *untuk melewati.*`,
        hasAction: true
      },

      "Hunter": {
        text: `🏹 *PEMBURU DI BALIK BAYANGAN* 🏹\n\n*Busur Anda siap di genggaman, anak panah mengkilap tajam...*\n*Mata elang memindai kegelapan, siap bereaksi saat bahaya datang...*\n*Malam ini Anda berpatroli, melindungi desa dengan cara Anda sendiri...*\n\n*Tidurlah dengan satu mata terbuka, pemburu...*`,
        hasAction: false
      },

      "Traitor": {
        text: `🎭 *PENGKHIANAT DI BALIK TOPENG* 🎭\n\n*Topeng warga biasa menutupi jiwa gelap Anda...*\n*Senyum palsu menyembunyikan niat jahat di dalam hati...*\n*Di kegelapan ini, Anda menunggu kesempatan untuk menusuk dari belakang...*\n\n*Bersabarlah... saatnya akan tiba...*`,
        hasAction: false
      },

      "Villager": {
        text: `👨‍🌾 *WARGA BIASA DI TENGAH TEROR* 👨‍🌾\n\n*Anda hanyalah warga biasa dengan hati yang tulus...*\n*Namun di dalam kepolosan, terkadang tersimpan kekuatan terbesar...*\n*Pintu rumah terkunci rapat, jendela tertutup erat...*\n\n*Berdoalah agar fajar datang dengan selamat...*`,
        hasAction: false
      }
    };

    const prompt = nightPrompts[p.role] || nightPrompts["Villager"];
    await this.dm(p.id, prompt.text);
  }

// Updated processNightAction method with enhanced werewolf coordination
  async processNightAction(player, role, numbers, aliveList) {
    const gId = player.id;
    
    console.log(`🌙 Processing night action: ${role}, numbers: ${JSON.stringify(numbers)}`);
    
    switch (role) {
      case "Seer":
        if (numbers.length === 0) {
          await this.dm(gId, "❌ *Pilih nomor target yang valid.*");
          return;
        }
        const seerTarget = aliveList[numbers[0] - 1];
        if (!seerTarget) {
          await this.dm(gId, "❌ *Nomor yang Anda pilih tidak valid.*");
          return;
        }
        player.actionTaken = true;
        await this.dm(gId, 
          `🔮 *VISI TERBUKA* 🔮\n\n` +
          `*Kristal ramalan berpendar terang...*\n` +
          `*Bayangan masa lalu dan masa depan menari di udara...*\n` +
          `*Tentang ${seerTarget.usn}... Anda melihat: **${seerTarget.role}***\n\n` +
          `*Visi pun memudar, meninggalkan pengetahuan yang berharga...*`
        );
        break;

      case "Detective":
        if (numbers.length === 0) {
          await this.dm(gId, "❌ *Pilih nomor target yang valid.*");
          return;
        }
        const detectiveTarget = aliveList[numbers[0] - 1];
        if (!detectiveTarget) {
          await this.dm(gId, "❌ *Nomor yang Anda pilih tidak valid.*");
          return;
        }
        player.actionTaken = true;
        const evilRoles = ["Werewolf", "Alpha Werewolf", "Traitor"];
        const isEvil = evilRoles.includes(detectiveTarget.role);
        await this.dm(gId, 
          `🕵️ *INVESTIGASI SELESAI* 🕵️\n\n` +
          `*Setelah mengamati ${detectiveTarget.usn} dengan seksama...*\n` +
          `*Insting detektif Anda berkata: ${detectiveTarget.usn} tampak ${isEvil ? '**bersekutu dengan kegelapan**' : '**tidak berbahaya**'}*\n\n` +
          `*Catatan tersimpan rapi dalam buku investigasi...*`
        );
        break;

      case "Guardian Angel":
        if (numbers.length === 0) {
          await this.dm(gId, "❌ *Pilih nomor target yang valid.*");
          return;
        }
        const protectTarget = aliveList[numbers[0] - 1];
        if (!protectTarget) {
          await this.dm(gId, "❌ *Nomor yang Anda pilih tidak valid.*");
          return;
        }
        this.actions[gId] = { action: "protect", target: protectTarget.id };
        player.actionTaken = true;
        await this.dm(gId, 
          `👼 *PERLINDUNGAN DIBERIKAN* 👼\n\n` +
          `*Sayap putih memeluk ${protectTarget.usn} dalam cahaya suci...*\n` +
          `*Perisai ilahi akan melindunginya dari bahaya malam ini...*`
        );
        break;

      case "Werewolf":
      case "Alpha Werewolf":
        if (numbers.length === 0) {
          await this.dm(gId, "❌ *Pilih nomor target yang valid.*");
          return;
        }
        const wolfTarget = aliveList[numbers[0] - 1];
        if (!wolfTarget) {
          await this.dm(gId, "❌ *Nomor yang Anda pilih tidak valid.*");
          return;
        }
        
        player.actionTaken = true;
        
        // Use enhanced werewolf coordination system
        await this.processWerewolfKillVoting(player, wolfTarget);
        break;

      case "Witch":
        if (!player.waitingPoison) {
          const choice = numbers[0];
          if (choice === 1) {
            if (!player.hasHeal) {
              await this.dm(gId, "❌ *Ramuan penyembuh telah habis digunakan.*");
              return;
            }
            this.actions[gId] = { action: "witch_heal" };
            player.hasHeal = false;
            player.actionTaken = true;
            await this.dm(gId, 
              `💚 *RAMUAN KEHIDUPAN DISIAPKAN* 💚\n\n` +
              `*Kuali mendidih dengan ramuan hijau berkilau...*\n` +
              `*Jika ada nyawa yang terancam malam ini, Anda akan menyelamatkannya...*`
            );
          } else if (choice === 2) {
            if (!player.hasPoison) {
              await this.dm(gId, "❌ *Ramuan racun telah habis digunakan.*");
              return;
            }
            player.waitingPoison = true;
            await this.dm(gId, 
              `☠️ *RACUN MEMATIKAN SIAP* ☠️\n\n` +
              `*Kuali hitam mengeluarkan asap beracun...*\n` +
              `*Pilih siapa yang akan merasakan racun kegelapan:*\n\n${aliveList.map((x,i)=>`${i+1}. ${x.usn}`).join("\n")}\n\n*Balas dengan* \`/<nomor>\``
            );
          } else if (choice === 3) {
            this.actions[gId] = { action: "skip" };
            player.actionTaken = true;
            await this.dm(gId, "⭐ *Penyihir memilih untuk tidak mencampuri takdir malam ini...*");
          }
        } else {
          // Poison target selection
          if (numbers.length === 0) {
            await this.dm(gId, "❌ *Pilih nomor target yang valid.*");
            return;
          }
          const poisonTarget = aliveList[numbers[0] - 1];
          if (!poisonTarget) {
            await this.dm(gId, "❌ *Nomor yang Anda pilih tidak valid.*");
            return;
          }
          this.actions[gId] = { action: "witch_poison", target: poisonTarget.id };
          player.hasPoison = false;
          player.waitingPoison = false;
          player.actionTaken = true;
          await this.dm(gId, 
            `☠️ *RACUN DILEPASKAN* ☠️\n\n` +
            `*${poisonTarget.usn} telah ditandai oleh racun kegelapan...*\n` +
            `*Maut akan menjemputnya sebelum fajar tiba...*`
          );
        }
      }
  }

  async processVote(player, numbers, aliveList) {
    if (numbers.length === 0) {
      await this.dm(player.id, "❌ *Pilih nomor target yang valid.*");
      return;
    }
    const target = aliveList[numbers[0] - 1];
    if (!target) {
      await this.dm(player.id, "❌ *Pilihan voting tidak valid.*");
      return;
    }

    if (!this.lastVoteTime) this.lastVoteTime = {};
  
    if (this.lastVoteTime[player.id]) {
      const timeSinceLastVote = Date.now() - this.lastVoteTime[player.id];
      if (timeSinceLastVote < 5000) { // 5 second cooldown
        const remainingTime = Math.ceil((5000 - timeSinceLastVote) / 1000);
        await this.dm(player.id, `⏰ Tunggu ${remainingTime} detik sebelum mengubah suara lagi.`);
        return;
      }
    }
    
    // Check if player is changing their vote
    const previousVote = this.votes[player.id];
    const isVoteChange = previousVote !== undefined && previousVote !== target.id;
    const isFirstVote = previousVote === undefined;
    
    // IMPORTANT: Use player.id (resolved group member ID) as the key
    // and target.id (also resolved group member ID) as the value
    this.votes[player.id] = target.id;
    
    if (isVoteChange) {
      await this.dm(player.id, 
        `🔄 *SUARA DIUBAH* 🔄\n\n` +
        `*Anda mengubah pilihan ke ${target.usn}*\n` +
        `*Perubahan suara telah tercatat...*`
      );
      // Don't broadcast vote changes to prevent spam
    } else if (isFirstVote) {
      await this.dm(player.id, 
        `⚖️ *SUARA TERCATAT* ⚖️\n\n` +
        `*Anda memilih untuk menggantung ${target.usn}*\n` +
        `*Suara Anda telah didengar oleh para tetua desa...*`
      );
      // Only broadcast on first vote to prevent spam
      await this.broadcast("✅ *Seorang warga telah memberikan suaranya dalam pemungutan suara.*");
    } else {
      // Same vote as before - just confirm
      await this.dm(player.id, 
        `✅ *SUARA TETAP* ✅\n\n` +
        `*Anda tetap memilih ${target.usn}*`
      );
      // No broadcast for repeated same votes
    }
  }

  async processHunterRevenge(player, numbers, aliveList) {
    if (numbers.length === 0) {
      await this.dm(player.id, "❌ *Pilih nomor target yang valid.*");
      return;
    }
    const target = aliveList[numbers[0] - 1];
    if (!target) {
      await this.dm(player.id, "❌ *Target tidak valid untuk balas dendam.*");
      return;
    }

    clearTimeout(this.hunterTimeout);
    this.pendingHunter = null;
    target.alive = false;
    
    await this.broadcast(
      `🏹 *PANAH TERAKHIR SANG PEMBURU* 🏹\n\n` +
      `*Dengan nafas terakhir, ${player.usn} melepaskan panah balas dendam!*\n` +
      `*Panah itu melesat tepat menghujam jantung ${target.usn}!*\n` +
      `*${target.usn} tumbang, membawa rahasia ${target.role} bersamanya...*\n\n` +
      `*Dua nyawa melayang dalam satu momen tragis...*`
    );

    // Check win condition after hunter revenge
    setTimeout(() => this.checkWinCondition(), 2000);
  }

  // ---------------- Night Resolution ----------------
  async resolveNight() {
    if (this.phase !== "night") return;
    
    clearTimeout(this.timers.nightEnd);

    const deaths = [];
    const protects = new Set();
    let wolfKillTarget = null;

    // Collect protections
    for (const [gid, act] of Object.entries(this.actions)) {
      if (act.action === "protect") {
        const guardian = this.players[gid];
        const target = this.players[act.target];
        
        if (guardian && guardian.alive && target) {
          if (target.role === "Werewolf" || target.role === "Alpha Werewolf") {
            // Guardian salah lindungi → mati dicabik serigala
            guardian.alive = false;
            deaths.push({ id: guardian.id, cause: "wolf_guard_fail", victim: guardian });
            await this.dm(guardian.id, 
              `🛡️ *KEGAGALAN MEMATIKAN* 🛡️\n\n` +
              `*Kamu mencoba melindungi ${target.usn}...*` +
              `*Namun ternyata dia adalah serigala!* 🐺\n` +
              `*Seketika kawanan mencabikmu tanpa ampun...*`
            );
            await this.broadcast(
              `🛡️ *Guardian Angel gugur tragis!* 🛡️\n\n` +
              `*Ia mencoba melindungi seseorang... namun salah sangka.*\n` +
              `*Sayap sucinya tercabik oleh serigala buas...*`
            );
          } else {
            // Perlindungan normal
            protects.add(act.target);
          }
        }
      }
    }

    // Process wolf kills (voting system for multiple wolves)
    const wolfVotes = {};
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "wolf_kill") {
        wolfVotes[act.target] = (wolfVotes[act.target] || 0) + 1;
      }
    }
    
    if (Object.keys(wolfVotes).length > 0) {
      wolfKillTarget = Object.keys(wolfVotes).reduce((a,b) => 
        wolfVotes[a] >= wolfVotes[b] ? a : b
      );
      this.nightKillTarget = wolfKillTarget;
      
      if (!protects.has(wolfKillTarget)) {
        const victim = this.players[wolfKillTarget];
        if (victim) {
          victim.alive = false;
          deaths.push({ id: wolfKillTarget, cause: "werewolf", victim });
        }
      }
    }

    // Process witch heal (can save wolf kill victim)
    let healUsed = false;
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "witch_heal" && wolfKillTarget) {
        const deathIndex = deaths.findIndex(d => d.id === wolfKillTarget);
        if (deathIndex !== -1) {
          const saved = deaths.splice(deathIndex, 1)[0];
          this.players[saved.id].alive = true;
          healUsed = true;
          break;
        }
      }
    }

    // Process witch poison
    for (const [id, act] of Object.entries(this.actions)) {
      if (act.action === "witch_poison") {
        const victim = this.players[act.target];
        if (victim && victim.alive) {
          victim.alive = false;
          deaths.push({ id: act.target, cause: "witch_poison", victim });
        }
      }
    }

    // Generate morning narrative
    await this.generateMorningNarrative(deaths, healUsed, protects.has(wolfKillTarget));

    // Check win condition
    if (await this.checkWinCondition()) return;

    this.day++;
    await this.startDiscussion();
  }

  async generateMorningNarrative(deaths, healUsed, wasProtected) {
    const narratives = [
      `🌅 *FAJAR MENYINGSING DI ELDERMOOR* 🌅`,
      `*Kabut malam perlahan surut, mengungkap rahasia kegelapan...*`,
      `*Para warga keluar dari rumah dengan hati berdebar...*`
    ];

    if (deaths.length === 0 && !healUsed && !wasProtected) {
      narratives.push(
        `*Keajaiban terjadi! Tidak ada darah yang tertumpah malam ini.*`,
        `*Burung-burung berkicau dengan riang, seolah merayakan keselamatan.*`,
        `*Namun... apakah ini hanya ketenangan sebelum badai?*`
      );
    } else if (deaths.length === 0 && (healUsed || wasProtected)) {
      narratives.push(
        `*Malam yang mencekam berakhir tanpa korban jiwa.*`,
        healUsed ? `*Ramuan penyembuh telah menyelamatkan nyawa seseorang...*` : 
                  `*Perlindungan ilahi telah menjaga seseorang dari maut...*`,
        `*Kekuatan kebaikan masih bersinar di tengah kegelapan.*`
      );
    } else {
      narratives.push(`*Namun kengerian menanti...*`);
      
      for (const death of deaths) {
        narratives.push(this.generateDeathNarrative(death));
      }
    }

    await this.broadcast(narratives.join('\n\n'));
  }

  generateDeathNarrative(death) {
    const { victim, cause } = death;
    
    switch (cause) {
      case "werewolf":
        return [
          `🐺 *${victim.usn}* *ditemukan tak bernyawa di tepi hutan...*`,
          `*Tubuhnya terkoyak oleh cakar dan taring yang kejam.*`,
          `*Darah membekas di tanah, menceritakan perjuangan terakhir yang sia-sia.*`,
          `*Para serigala telah memakan mangsa mereka...*`
        ].join('\n');
        
      case "wolf_guard_fail":
        return [
          `🛡️ *${victim.usn}* *ditemukan tergeletak dengan sayap tercabik...*`,
          `*Ia mencoba melindungi yang salah – ternyata seekor serigala!*`,
          `*Kebaikannya menjadi malapetaka...*`,
          `*Eldermoor kehilangan pelindung sucinya malam ini...*`
        ].join('\n');

      case "witch_poison":
        return [
          `☠️ *${victim.usn}* *ditemukan biru pucat di tempat tidurnya...*`,
          `*Racun kegelapan telah meresap ke dalam darahnya.*`,
          `*Wajahnya membeku dalam ekspresi ngeri, mata terbelalak ketakutan.*`,
          `*Penyihir gelap telah mengklaim jiwa lain...*`
        ].join('\n');
        
      case "lynched":
        return [
          `⚖️ *${victim.usn}* *digantung di alun-alun desa...*`,
          `*Keadilan rakyat telah dijalankan, benar atau salah.*`,
          `*Mata terakhirnya menatap para warga dengan tatapan yang sulit diartikan.*`,
          `*Apakah mereka telah membunuh monster... atau orang tidak bersalah?*`
        ].join('\n');
        
      case "hunter_revenge":
        return [
          `🏹 *${victim.usn}* *tertembak panah balas dendam!*`,
          `*Panah sang pemburu melesat tepat menghujam jantung.*`,
          `*Darah segar mengalir, membuktikan akurasi terakhir yang mematikan.*`,
          `*Bahkan dalam kematian, pemburu tidak pernah meleset...*`
        ].join('\n');
        
      default:
        return [
          `💀 *${victim.usn}* *ditemukan mati dalam keadaan misterius...*`,
          `*Tidak ada yang tahu penyebab kematiannya.*`,
          `*Eldermoor menyimpan rahasia yang lebih gelap dari yang dibayangkan...*`
        ].join('\n');
    }
  }

  // ---------------- Day Phase ----------------
  async startDiscussion() {
    if (!this.inGame) return;
    
    this.phase = "discussion";
    
    const aliveCount = this.alivePlayers().length;
    const dayNarrative = [
      `☀️ *HARI ${this.day} - WAKTU DISKUSI* ☀️`,
      `*Matahari bersinar terang, namun hati para warga gelap gulita...*`,
      `*${aliveCount} warga yang tersisa berkumpul di alun-alun.*`,
      `*Siapa yang dapat dipercaya? Siapa yang menyembunyikan rahasia?*`,
      `*Waktu diskusi dimulai... gunakan dengan bijak.*`
    ];

    await this.broadcast(dayNarrative.join('\n\n'));
    
    // Show alive players
    setTimeout(async () => {
      await this.broadcast(
        `👥 *WARGA YANG MASIH HIDUP:*\n${this.listPlayers()}\n\n` +
        `*Perhatikan baik-baik... monster bisa jadi bersembunyi di antara kalian...*`
      );
    }, 2000);

    this.timers.voteStart = setTimeout(() => {
      this.startVoting();
    }, this.dayDur * 1000);

    // Warning before voting
    setTimeout(() => {
      if (this.phase === "discussion") {
        this.broadcast("⏰ *30 detik lagi voting akan dimulai!*");
      }
    }, (this.dayDur - 30) * 1000);
  }

async startVoting() {
  if (!this.inGame) return;
  
  this.phase = "vote";
  this.votes = {};
  
  const alive = this.alivePlayers();
  // Filter out self from voting list for each player
  const numbered = alive.map((x, i) => `${i + 1}. ${x.usn}`).join("\n");
  
  const votingNarrative = [
    `⚖️ *PEMUNGUTAN SUARA DIMULAI* ⚖️`,
    `*Ketegangan mencapai puncaknya...*`,
    `*Setiap suara menentukan hidup dan mati seseorang.*`,
    `*Para tetua desa menunggu keputusan kalian...*`,
    ``,
    `**KANDIDAT UNTUK DIGANTUNG:**`,
    numbered,
    ``,
    `*Kirim pilihan via DM dengan* \`/<nomor>\``,
    `*Atau kirim* \`/abstain\` *untuk tidak memilih*`,
    `*Waktu voting: 60 detik*`
  ];

  await this.broadcast(votingNarrative.join('\n'));

  // Send voting prompt to each alive player
  for (const player of alive) {
    // Create candidate list excluding the voter themselves
    const candidates = alive.filter(p => p.id !== player.id);
    const playerNumbered = candidates.map((x, i) => `${i + 1}. ${x.usn}`).join("\n");
    
    await this.dm(player.id, 
      `⚖️ *SAATNYA MEMILIH* ⚖️\n\n` +
      `**KANDIDAT YANG DAPAT ANDA PILIH:**\n` +
      `${playerNumbered}\n\n` +
      `*Siapa yang akan Anda gantung hari ini?*\n` +
      `*Pilih dengan* \`/<nomor>\`\n` +
      `*Atau kirim* \`/abstain\` *untuk tidak memilih*`
    );
  }

  this.timers.voteEnd = setTimeout(() => {
    this.resolveVote();
  }, 60000);

  // Voting warning
  setTimeout(() => {
    if (this.phase === "vote") {
      this.broadcast("⏰ *20 detik tersisa untuk voting!*");
    }
  }, 40000);
}

// Helper function to process vote command - FIXED VERSION
processVoteCommand(voterId, command) {
  if (this.phase !== "vote") return false;
  
  const voter = this.players[voterId];
  if (!voter || !voter.alive) return false;
  
  // Handle abstain
  if (command.toLowerCase() === '/abstain') {
    this.votes[voterId] = 'abstain';
    return true;
  }
  
  // Handle numbered vote
  const match = command.match(/^\/(\d+)$/);
  if (!match) return false;
  
  const choice = parseInt(match[1]) - 1;
  const alive = this.alivePlayers();
  
  // Get candidates excluding the voter (IMPORTANT: This should be all alive players except voter)
  const candidates = alive.filter(p => p.id !== voterId);
  
  if (choice < 0 || choice >= candidates.length) return false;
  
  const target = candidates[choice];
  
  // CRITICAL FIX: Ensure we're using the correct voter ID and target ID
  console.log(`Vote processed: ${voter.usn} (${voterId}) votes for ${target.usn} (${target.id})`);
  this.votes[voterId] = target.id;
  
  return true;
}

// FIXED processVote method
async processVote(player, numbers, aliveList) {
  if (numbers.length === 0) {
    await this.dm(player.id, "❌ *Pilih nomor target yang valid.*");
    return;
  }
  
  const targetIndex = numbers[0] - 1;
  if (targetIndex < 0 || targetIndex >= aliveList.length) {
    await this.dm(player.id, "❌ *Pilihan voting tidak valid.*");
    return;
  }
  
  const target = aliveList[targetIndex];
  if (!target) {
    await this.dm(player.id, "❌ *Target tidak ditemukan.*");
    return;
  }
  
  // CRITICAL: Prevent self-voting
  if (target.id === player.id) {
    await this.dm(player.id, "❌ *Anda tidak bisa memilih diri sendiri!*");
    return;
  }
  
  // Initialize lastVoteTime if not exists
  if (!this.lastVoteTime) this.lastVoteTime = {};
  
  // Vote cooldown check
  if (this.lastVoteTime[player.id]) {
    const timeSinceLastVote = Date.now() - this.lastVoteTime[player.id];
    if (timeSinceLastVote < 5000) { // 5 second cooldown
      const remainingTime = Math.ceil((5000 - timeSinceLastVote) / 1000);
      await this.dm(player.id, `⏰ Tunggu ${remainingTime} detik sebelum mengubah suara lagi.`);
      return;
    }
  }
  
  // Check if player is changing their vote
  const previousVote = this.votes[player.id];
  const isVoteChange = previousVote !== undefined && previousVote !== target.id && previousVote !== 'abstain';
  const isFirstVote = previousVote === undefined;
  
  // CRITICAL FIX: Ensure proper ID mapping
  console.log(`Vote Debug: Player ${player.usn} (${player.id}) voting for ${target.usn} (${target.id})`);
  console.log(`Previous vote:`, previousVote);
  
  // Store the vote with proper IDs
  this.votes[player.id] = target.id;
  this.lastVoteTime[player.id] = Date.now();
  
  // Send appropriate confirmation message
  if (isVoteChange) {
    await this.dm(player.id,
      `🔄 SUARA DIUBAH 🔄\n\n` +
      `*Anda mengubah pilihan ke ${target.usn}*\n` +
      `*Perubahan suara telah tercatat...*`
    );
  } else if (isFirstVote) {
    await this.dm(player.id,
      `⚖️ SUARA TERCATAT ⚖️\n\n` +
      `*Anda memilih untuk menggantung ${target.usn}*\n` +
      `*Suara Anda telah didengar oleh para tetua desa...*`
    );
    // Only broadcast on first vote
    await this.broadcast("✅ *Seorang warga telah memberikan suaranya dalam pemungutan suara.*");
  } else {
    // Same vote as before
    await this.dm(player.id,
      `✅ SUARA TETAP ✅\n\n` +
      `*Anda tetap memilih ${target.usn}*`
    );
  }
}

// ENHANCED resolveVote with better tie handling
async resolveVote() {
  if (!this.inGame) return;
  
  clearTimeout(this.timers.voteEnd);
  
  const tally = {};
  const alive = this.alivePlayers();
  const voterCount = alive.length;
  let totalVotes = 0;
  let abstainCount = 0;

  console.log("=== VOTE RESOLUTION DEBUG ===");
  console.log("Votes object:", this.votes);
  console.log("Alive players:", alive.map(p => `${p.id}: ${p.usn}`));

  // Count votes - ENHANCED VERSION
  for (const [voterId, targetId] of Object.entries(this.votes)) {
    const voter = this.players[voterId];
    
    // Skip if voter is dead or doesn't exist
    if (!voter || !voter.alive) {
      console.log(`Skipping vote from dead/non-existent voter: ${voterId}`);
      continue;
    }
    
    if (targetId === 'abstain') {
      abstainCount++;
      console.log(`${voter.usn} abstained`);
    } else if (targetId && targetId !== null && targetId !== voterId) {
      // Verify target exists and is alive
      const target = this.players[targetId];
      if (target && target.alive) {
        tally[targetId] = (tally[targetId] || 0) + 1;
        totalVotes++;
        console.log(`${voter.usn} voted for ${target.usn}`);
      } else {
        console.error(`ERROR: Invalid vote target ${targetId} from ${voter.usn}`);
        // Treat invalid votes as abstains
        abstainCount++;
      }
    } else {
      // Self-vote or invalid vote - treat as abstain
      console.log(`Invalid vote from ${voter.usn}: ${targetId}`);
      abstainCount++;
    }
  }

  // Add players who didn't vote as abstains
  const votedPlayerIds = Object.keys(this.votes);
  const nonVoters = alive.filter(p => !votedPlayerIds.includes(p.id));
  abstainCount += nonVoters.length;
  
  for (const nonVoter of nonVoters) {
    console.log(`${nonVoter.usn} did not vote (counted as abstain)`);
  }

  console.log("Vote tally:", tally);
  console.log("Total actual votes:", totalVotes);
  console.log("Abstain count:", abstainCount);
  console.log("Expected total voters:", voterCount);
  console.log("=== END VOTE DEBUG ===");

  // Find the player(s) with the most votes
  let maxVotes = 0;
  let topVotees = [];
  
  for (const [playerId, votes] of Object.entries(tally)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      topVotees = [playerId];
    } else if (votes === maxVotes && votes > 0) {
      topVotees.push(playerId);
    }
  }

  // Generate voting results
  const voteResults = [];
  
  // Show vote breakdown only if there were votes
  if (Object.keys(tally).length > 0 && totalVotes > 0) {
    const breakdown = Object.entries(tally)
      .sort(([,a], [,b]) => b - a) // Sort by vote count descending
      .map(([id, count]) => {
        const player = this.players[id];
        return player ? `• ${player.usn}: ${count} suara` : `• Unknown: ${count} suara`;
      })
      .join('\n');
    
    voteResults.push(
      `⚖️ *HASIL PEMUNGUTAN SUARA* ⚖️`,
      `*Total yang memilih: ${totalVotes}*`,
      `*Abstain/tidak memilih: ${abstainCount}*`,
      `*Total pemilih: ${voterCount}*`,
      ``,
      breakdown,
      ``
    );
  }

  let chosen = null;
  
  // ENHANCED outcome determination
  if (totalVotes === 0 || maxVotes === 0) {
    // No valid votes cast
    voteResults.push(
      `📢 *TIDAK ADA SUARA YANG MASUK* 📢`,
      `*Keheningan menyelimuti alun-alun...*`,
      `*Para warga tidak dapat mencapai kesepakatan.*`,
      `*Tidak ada yang digantung hari ini.*`
    );
  } else if (topVotees.length > 1) {
    // ENHANCED TIE HANDLING - Multiple players with same highest vote count
    const tiedNames = topVotees.map(id => this.players[id]?.usn).filter(Boolean);
    voteResults.push(
      `🤝 *HASIL SERI* 🤝`,
      `*Suara terbagi rata antara: ${tiedNames.join(', ')}*`,
      `*Masing-masing mendapat ${maxVotes} suara*`,
      `*Para warga tidak dapat mencapai kesepakatan.*`,
      `*Perdebatan sengit terjadi, namun tidak ada yang digantung hari ini.*`,
      `*Keadilan menuntut suara yang lebih pasti...*`
    );
  } else if (topVotees.length === 1) {
    // Single winner - execute
    chosen = topVotees[0];
    const victim = this.players[chosen];
    
    if (!victim) {
      console.error(`CRITICAL ERROR: Chosen victim ${chosen} not found!`);
      voteResults.push(
        `⚠️ *TERJADI ERROR DALAM PEMUNGUTAN SUARA* ⚠️`,
        `*Sistem voting mengalami masalah teknis.*`,
        `*Tidak ada yang digantung hari ini karena error.*`
      );
    } else {
      // FINAL CHECK: Ensure victim is still alive
      if (!victim.alive) {
        console.error(`ERROR: Trying to execute already dead player ${victim.usn}`);
        voteResults.push(
          `⚠️ *ERROR: TARGET SUDAH MATI* ⚠️`,
          `*${victim.usn} sudah tidak hidup.*`,
          `*Tidak ada yang digantung hari ini.*`
        );
      } else {
        victim.alive = false;
        
        voteResults.push(
          `🎭 *${victim.usn} terpilih untuk digantung!*`,
          `*Dengan ${maxVotes} suara dari ${totalVotes} total suara, keputusan telah dibuat.*`,
          `*Tali gantungan dipasang di alun-alun...*`,
          `*Dalam detik-detik terakhir, ${victim.usn} berteriak:*`,
          `**"Saya adalah ${victim.role}!"**`,
          ``,
          victim.role === "Werewolf" || victim.role === "Alpha Werewolf" ? 
            `*Mata serigala menatap dengan dendam sebelum nyawa melayang...*` :
            victim.role === "Traitor" ?
              `*Senyum jahat terukir di wajahnya sebelum napas terakhir...*` :
              `*Mata polos menatap dengan sedih, mungkin mereka salah memilih...*`
        );

        // Hunter revenge mechanism
        if (victim.role === "Hunter" && victim.canRevenge) {
          this.pendingHunter = victim.id;
          const aliveForRevenge = this.alivePlayers().filter(p => p.id !== victim.id);
          const revengeList = aliveForRevenge.map((x, i) => `${i + 1}. ${x.usn}`).join("\n");
          
          voteResults.push(
            ``,
            `🏹 *PANAH BALAS DENDAM* 🏹`,
            `*Dengan nafas terakhir, ${victim.usn} mengangkat busurnya!*`
          );
          
          await this.dm(victim.id, 
            `🏹 *KESEMPATAN TERAKHIR SANG PEMBURU* 🏹\n\n` +
            `*Sebelum mati, Anda dapat membawa satu orang bersamamu!*\n\n` +
            `${revengeList}\n\n` +
            `*Pilih dengan* \`/<nomor>\` *dalam 30 detik!*`
          );

          this.hunterTimeout = setTimeout(() => {
            if (this.pendingHunter) {
              this.pendingHunter = null;
              this.broadcast(
                `🏹 *PANAH TIDAK DILEPASKAN* 🏹\n\n` +
                `*${victim.usn} menghembuskan napas terakhir tanpa balas dendam...*`
              );
              this.checkWinCondition();
            }
          }, 30000);
        }
      }
    }
  }

  // Clear votes for next round
  this.votes = {};
  
  await this.broadcast(voteResults.join('\n'));

  // Check win condition if no hunter revenge pending
  if (!this.pendingHunter) {
    if (await this.checkWinCondition()) return;
    
    setTimeout(() => {
      this.startNight();
    }, 5000);
  }
}

// Additional helper method to debug vote state
debugVoteState() {
  console.log("=== VOTE STATE DEBUG ===");
  console.log("Current votes:", this.votes);
  console.log("Alive players:", this.alivePlayers().map(p => `${p.id}: ${p.usn}`));
  console.log("Vote phase:", this.phase === "vote");
  console.log("========================");
}

// Helper function to process hunter revenge
processHunterRevenge(hunterId, command) {
  if (!this.pendingHunter || this.pendingHunter !== hunterId) return false;
  
  const match = command.match(/^\/(\d+)$/);
  if (!match) return false;
  
  const choice = parseInt(match[1]) - 1;
  const aliveForRevenge = this.alivePlayers().filter(p => p.id !== hunterId);
  
  if (choice < 0 || choice >= aliveForRevenge.length) return false;
  
  const target = aliveForRevenge[choice];
  target.alive = false;
  
  clearTimeout(this.hunterTimeout);
  this.pendingHunter = null;
  
  const hunter = this.players[hunterId];
  
  this.broadcast(
    `🏹 *PANAH BALAS DENDAM DILEPASKAN* 🏹\n\n` +
    `*${hunter.usn} menembakkan panah terakhirnya ke arah ${target.usn}!*\n` +
    `*${target.usn} (${target.role}) tumbang bersamaan!*\n\n` +
    `*Dua nyawa melayang dalam tragedi ini...*`
  );
  
  // Check win condition after hunter revenge
  setTimeout(() => {
    this.checkWinCondition();
  }, 3000);
  
  return true;
}

  // Emergency end game (for host)
  async forceEndGame(hostId) {
    if (hostId !== this.hostId) return false;
    
    await this.broadcast(
      `🛑 *PERMAINAN DIHENTIKAN PAKSA* 🛑\n\n` +
      `*Host telah menghentikan permainan.*\n` +
      `*Eldermoor kembali ke kegelapan abadi...*`
    );
    
    this.endGame();
    return true;
  }

  // Get game statistics
  getGameStats() {
    if (!this.inGame) return null;
    
    return {
      day: this.day,
      phase: this.phase,
      totalPlayers: Object.keys(this.players).length,
      alivePlayers: this.alivePlayers().length,
      aliveWolves: this.aliveWolves().length,
      aliveVillagers: this.aliveVillagers().length
    };
  }
}

module.exports = SimpleGame;