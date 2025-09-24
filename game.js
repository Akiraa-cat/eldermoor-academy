// game2.js - Improved Werewolf Game Engine
// Fixed issues and added comprehensive features

const fs = require("fs");
const path = require("path");
const linkHelper = require("./linkHelper");
const rolesJson = require("./roles.json");

class WerewolfGame {
  constructor(sock, groupId = null) {
    this.sock = sock;
    this.groupId = groupId;
    this.reset();
    
    // Constants
    this.MIN_PLAYERS = 5;
    this.VOTE_CHANGE_COOLDOWN_MS = 5000;
    this.HUNTER_REVENGE_TIMEOUT = 30000;
    this.NIGHT_DURATION = 90;
    this.DAY_DURATION = 120;
    this.revelationMode = 'FULL'; // FULL, AURA_ONLY, HIDDEN, PROGRESSIVE
    this.progressiveModeEnabled = false;
    this.showRolesAtStart = true;
    this.showRolesAtEnd = true;
  }

  isWolfTeam(player) {
    if (!player) return false;
    return player.team === 'Jahat' || 
      ['Werewolf', 'Alpha Werewolf', 'Wolf Summoner', 'Wolf Trickster', 
      'Wolf Seer', 'Lil Wolvy', 'Lycan', 'Guardian Wolf', 'Traitor'].includes(player.role);
  }

  isWolfRole(role) {
    return ['Werewolf', 'Alpha Werewolf', 'Wolf Summoner', 'Wolf Trickster', 
            'Wolf Seer', 'Lil Wolvy', 'Lycan', 'Guardian Wolf'].includes(role);
  }

  // ================= UTILITY METHODS =================
  
  resolveId(id) {
    const gId = linkHelper.getGroupMemberId(id);
    return gId || id;
  }

  dmIdFor(gidOrDm) {
    const dmId = linkHelper.getDmId(gidOrDm);
    return dmId || gidOrDm;
  }

  async dm(to, msg, roleName = null) {
    const dmId = this.dmIdFor(to);
    try {
      if (roleName) {
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.mp4'];
        let imagePath = null;
        
        for (const ext of extensions) {
          const testPath = path.join(__dirname, "data", "images", "role", 
            `${roleName.toLowerCase().replace(/\s+/g,'_')}${ext}`);
          if (fs.existsSync(testPath)) {
            imagePath = testPath;
            break;
          }
        }
        
        if (imagePath) {
          const mediaBuffer = fs.readFileSync(imagePath);
          const isVideo = imagePath.endsWith('.mp4');
          
          if (isVideo) {
            await this.sock.sendMessage(dmId, { 
              video: mediaBuffer, 
              caption: msg,
              gifPlayback: imagePath.endsWith('.gif')
            });
          } else {
            await this.sock.sendMessage(dmId, { 
              image: mediaBuffer, 
              caption: msg 
            });
          }
          return;
        }
      }
      await this.sock.sendMessage(dmId, { text: msg });
    } catch (err) {
      console.error(`DM failed to ${to}:`, err);
    }
  }

  async broadcast(msg) {
    if (!this.groupId) return;
    try {
      await this.sock.sendMessage(this.groupId, { text: msg });
    } catch (err) {
      console.error("Broadcast failed:", err);
    }
  }

  // ================= GAME STATE MANAGEMENT =================

  reset() {
    this.inLobby = false;
    this.inGame = false;
    this.phase = null;
    this.day = 0;
    
    this.players = {};
    this.hostId = null;
    this.actions = {};
    this.votes = {};
    this.voteLastChange = {};
    
    // Special states
    this.protectedPlayers = new Set();
    this.dousedPlayers = new Set();
    this.masons = [];
    this.lovers = [];
    this.pendingHunter = null;
    this.lilWolvyKilled = false;
    this.peacefulNight = false; // TAMBAHKAN INI
    
    // Timers
    this.timers = {};
    this.hunterTimeout = null; // TAMBAHKAN INI
    
    // Game settings
    this.hideRoles = false;
    this.whispers = {};
    this.whisperReplies = {};
    
    this.clearAllTimers();
  }

  clearAllTimers() {
    Object.values(this.timers).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    this.timers = {};
    
    // Clear any remaining specific timers
    if (this.hunterTimeout) {
      clearTimeout(this.hunterTimeout);
      this.hunterTimeout = null;
    }
  }

  setGroup(groupId) {
    this.groupId = groupId;
  }

  setHideRoles(flag) {
    this.hideRoles = !!flag;
  }

  getRoleInfo(roleName) {
    return rolesJson[roleName] || null;
  }

  // ================= PLAYER MANAGEMENT =================

  addPlayer(id, username) {
    const gId = this.resolveId(id);
    if (this.players[gId] || !this.inLobby) return false;

    this.players[gId] = {
      id: gId,
      username,
      role: null,
      team: null,
      aura: null,
      alive: true,
      
      // Role-specific properties
      hasHeal: false,
      hasPoison: false,
      bullets: 0,
      convictions: 0,
      hungerStack: 0,
      canRevenge: false,
      
      // Special states
      isDoused: false,
      isProtected: false,
      mentor: null,
      target: null,
      accomplice: null,
      stolenRole: null,
      
      // Tracking
      actionUsed: false,
      lastAction: null,
      lastKillMethod: null
    };

    return true;
  }

  removePlayer(gId) {
    delete this.players[gId];
  }

  playerCount() {
    return Object.keys(this.players).length;
  }

  alivePlayers() {
    return Object.values(this.players).filter(p => p.alive);
  }

  playersOfTeam(team) {
    return this.alivePlayers().filter(p => p.team === team);
  }

  playersOfRole(role) {
    return this.alivePlayers().filter(p => p.role === role);
  }

  listPlayers(showStatus = false) {
    const players = Object.values(this.players);
    if (!showStatus) {
      return players.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
    }
    return players.map((p, i) => 
      `${i + 1}. ${p.username} ${p.alive ? '💚' : '💀'} (${p.role || '?'})`
    ).join('\n');
  }

  // ================= REVELATION MODES =================

  setRevelationMode(mode) {
    const validModes = ['FULL', 'AURA_ONLY', 'HIDDEN', 'PROGRESSIVE'];
    const upperMode = mode.toUpperCase();
    
    if (!validModes.includes(upperMode)) {
      return false;
    }
    
    this.revelationMode = upperMode;
    
    // Handle progressive mode flag
    this.progressiveModeEnabled = (upperMode === 'PROGRESSIVE');
    
    return true;
  }

  getRevelationInfo(player) {
    if (!player) return '';

    // Special handling for Fool - reveal their true identity upon death/game end
    let displayRole = player.role;
    if (player.role === 'Fool' && this.revelationMode !== 'HIDDEN') {
      // Fool's identity is revealed as "Fool (thought they were Seer)"
      displayRole = '🤡Fool yang bodoh mengira dirinya Seer';
    }
    
    switch (this.revelationMode) {
      case 'HIDDEN':
        return '';
      case 'AURA_ONLY':
        return player.aura ? ` - Aura: **${player.aura}**` : '';
      case 'PROGRESSIVE':
        if (this.day <= 1) return '';
        if (this.day === 2) return player.aura ? ` - Aura: **${player.aura}**` : '';
        return displayRole ? ` - Role: **${displayRole}**` : '';
      case 'FULL':
      default:
        return displayRole ? ` - Role: **${displayRole}**` : '';
    }
  }

  // ================= ROLE ASSIGNMENT SYSTEM =================

  assignRoles() {
    const playerIds = Object.keys(this.players);
    const playerCount = playerIds.length;
    
    if (playerCount < this.MIN_PLAYERS) {
      throw new Error(`Eldermoor membutuhkan setidaknya ${this.MIN_PLAYERS} warga yang berani!`);
    }

    const assignedRoles = this.selectRoles(playerCount);
    
    // Shuffle roles
    for (let i = assignedRoles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [assignedRoles[i], assignedRoles[j]] = [assignedRoles[j], assignedRoles[i]];
    }

    // Assign roles to players
    playerIds.forEach((id, index) => {
      const role = assignedRoles[index];
      const roleInfo = this.getRoleInfo(role);
      
      this.players[id].role = role;
      this.players[id].team = roleInfo ? roleInfo.team : 'Baik';
      this.players[id].aura = this.getAuraFromTeam(roleInfo ? roleInfo.team : 'Baik', role);
      
      this.initializeRoleProperties(id, role);
    });

    this.setupSpecialRelationships();
  }

  selectRoles(playerCount) {
    const roles = [];
    const addedRoles = new Set();
    
    // Define role conflicts - roles that cannot be in same game
    const conflicts = {
      'Seer': ['Fool'],
      'Fool': ['Seer'],
      'Aura Seer': ['Detective'],
      'Detective': ['Aura Seer'],
      'Cannibal': ['Arsonist'],
      'Arsonist': ['Cannibal'],
      'Serial Killer': ['Evil Detective'],
      'Evil Detective': ['Serial Killer']
    };
    
    // Helper function to check if role can be added
    const canAddRole = (role) => {
      if (conflicts[role]) {
        return !conflicts[role].some(conflictRole => addedRoles.has(conflictRole));
      }
      return true;
    };
    
    // Helper to safely add role
    const addRole = (role) => {
      if (canAddRole(role)) {
        roles.push(role);
        addedRoles.add(role);
        return true;
      }
      return false;
    };
    
    // ===== STEP 1: ESSENTIAL ROLES =====
    
    // Always need either Seer or Fool (50-50 chance)
    if (Math.random() < 0.5) {
      addRole('Seer');
    } else {
      addRole('Fool');
    }
    
    // Always need Guardian Angel for protection
    addRole('Guardian Angel');
    
    // ===== STEP 2: CALCULATE TEAM DISTRIBUTION =====
    
    // Calculate team sizes based on player count
    const wolfCount = Math.max(1, Math.floor(playerCount * 0.25));
    const neutralCount = Math.max(1, Math.floor(playerCount * 0.15));
    const villageCount = playerCount - wolfCount - neutralCount - roles.length;
    
    // Adjust wolf count for balance
    let finalWolfCount = wolfCount;
    if (playerCount >= 7 && finalWolfCount < 2) finalWolfCount = 2;
    if (playerCount >= 12 && finalWolfCount < 3) finalWolfCount = 3;
    
    // ===== STEP 3: ADD WOLF ROLES =====
    
    const wolfRoles = [
      'Werewolf', 'Alpha Werewolf', 'Wolf Summoner', 
      'Wolf Trickster', 'Wolf Seer', 'Lil Wolvy', 'Lycan'
    ];
    
    // Ensure at least 1 basic Werewolf for larger games
    if (finalWolfCount >= 2) {
      addRole('Werewolf');
      finalWolfCount--;
    }
    
    // Add remaining wolf roles
    for (let i = 0; i < finalWolfCount; i++) {
      const availableWolfRoles = wolfRoles.filter(role => !addedRoles.has(role));
      if (availableWolfRoles.length > 0) {
        const wolfRole = availableWolfRoles[Math.floor(Math.random() * availableWolfRoles.length)];
        addRole(wolfRole);
      } else {
        addRole('Werewolf'); // Fallback to basic werewolf
      }
    }
    
    // ===== STEP 4: ADD NEUTRAL ROLES =====
    
    const neutralRoles = [
      'Serial Killer', 'Doppelganger', 'Arsonist', 'Cannibal', 
      'Evil Detective', 'Bandit', 'Headhunter', 'Cupid', 'Tanner'
    ];
    
    for (let i = 0; i < neutralCount; i++) {
      const availableNeutrals = neutralRoles.filter(role => canAddRole(role) && !addedRoles.has(role));
      
      if (availableNeutrals.length > 0) {
        const neutralRole = availableNeutrals[Math.floor(Math.random() * availableNeutrals.length)];
        addRole(neutralRole);
      } else {
        // If no neutrals available due to conflicts, add Villager
        addRole('Villager');
      }
    }
    
    // ===== STEP 5: ADD VILLAGE ROLES =====
    
    const villageRoles = [
      'Witch', 'Detective', 'Hunter', 'The Chemist', 'Harlot', 
      'Judge', 'Prayer', 'Gunner', 'Wolfman', 'Aura Seer', 
      'Cursed', 'Traitor', 'Wild Child', 'Angel', 'Loudmouth'
    ];
    
    // Fill remaining slots
    let remainingSlots = playerCount - roles.length;
    
    while (remainingSlots > 0) {
      // 70% chance to add special village role, 30% chance Villager
      if (Math.random() < 0.7) {
        const availableVillage = villageRoles.filter(role => canAddRole(role) && !addedRoles.has(role));
        
        if (availableVillage.length > 0) {
          const villageRole = availableVillage[Math.floor(Math.random() * availableVillage.length)];
          addRole(villageRole);
        } else {
          addRole('Villager');
        }
      } else {
        addRole('Villager');
      }
      remainingSlots--;
    }
    
    return roles;
  }

  getAuraFromTeam(team, role = null) {
    // Special cases with Unknown aura regardless of team
    const unknownAuraRoles = [
      'Alpha Werewolf', 'Wolf Summoner', 'Judge', 'Prayer', 'The Chemist',
      'Lycan', 'Wolfman', 'Cursed', 'Doppelganger', 'Fool', 'Tanner', 'Angel'
    ];
    
    if (role && unknownAuraRoles.includes(role)) {
      return 'Unknown';
    }
    
    switch (team) {
      case 'Jahat': return 'Evil';
      case 'Netral': return 'Unknown';
      case 'Baik':
      default: return 'Good';
    }
  }

  initializeRoleProperties(playerId, role) {
    const player = this.players[playerId];
    
    switch (role) {
      case 'Witch':
        player.hasHeal = true;
        player.hasPoison = true;
        break;
        
      case 'Hunter':
        player.canRevenge = true;
        break;
        
      case 'Gunner':
        player.bullets = 2;
        break;
        
      case 'Judge':
        player.convictions = 2;
        break;
        
      case 'Loudmouth':
        player.target = null; // Will select on night 1
        break;
        
      case 'Prayer':
        player.currentSkill = 'pray'; // Default skill: pray
        player.lastPrayerTarget = null; // Track target malam sebelumnya
        player.skillUsed = false; // Apakah skill (selain pray) sudah dipakai
        break;
        
      case 'Lycan':
      case 'Cursed':
      case 'Wolfman':
        // These roles have passive abilities, no special init needed
        break;
        
      case 'Doppelganger':
        player.originalRole = null;
        player.originalTarget = null;
        break;
        
      case 'Tanner':
        // Passive role - wins if lynched
        break;
        
      case 'Fool':
        // Acts like Seer but gets random results
        break;
        
      case 'Harlot':
        player.visitTarget = null;
        player.isHome = true;
        break;
        
      case 'Cannibal':
        player.hungerStack = 1; // Start with 1 hunger
        break;
        
      case 'Headhunter':
        const others = Object.keys(this.players).filter(id => id !== playerId);
        player.target = others[Math.floor(Math.random() * others.length)];
        break;
        
      case 'Cupid':
        player.needsToSelectLovers = true;
        player.hasSelectedLovers = false;
        break;
        
      case 'Wild Child':
        player.needsToSelectMentor = true;
        player.mentor = null;
        player.hasTransformed = false;
        break;
        
      case 'Traitor':
        player.isActivated = false; // Becomes werewolf when all wolves die
        break;
        
      case 'Bandit':
        player.accomplice = null;
        break;
        
      case 'Accomplice':
        // Will be set by Bandit recruitment
        break;

      case 'Hercules':
        player.attacksReceived = 0;
        player.maxAttacks = 2;
        player.isHercules = true;
        break;
        
      case 'Blacksmith':
        player.peacefulNightUsed = false;
        player.canCreatePeace = true;
        break;
        
      case 'Guardian Wolf':
        player.guardianProtectionUsed = false;
        player.canProtectPack = true;
        break;
        
      case 'Wolf Trickster':
        player.stolenRole = null;
        player.stolenUsername = null;
        break;
        
      case 'Evil Detective':
        // Can investigate including self
        break;
        
      case 'Angel':
        player.canRevive = true; // One-time use
        break;
    }
  }

  setupSpecialRelationships() {
    // Setup Masons - only if enough players and no conflicts
    const totalPlayers = Object.keys(this.players).length;
    const masonCount = Math.floor(totalPlayers / 8); // 1 Mason per 8 players
    
    if (masonCount >= 2) {
      // Convert some Villagers to Masons
      const potentialMasons = Object.values(this.players).filter(p => p.role === 'Villager');
      const actualMasonCount = Math.min(masonCount, potentialMasons.length);
      
      for (let i = 0; i < actualMasonCount; i++) {
        potentialMasons[i].role = 'Mason';
        this.masons.push(potentialMasons[i].id);
      }
      
      // Initialize Mason properties
      this.masons.forEach(masonId => {
        const mason = this.players[masonId];
        if (mason) {
          mason.team = 'Baik';
          mason.aura = 'Good';
        }
      });
    }
    
    // Setup Cupid lovers selection (will be chosen by Cupid on first night)
    const cupid = Object.values(this.players).find(p => p.role === 'Cupid');
    if (cupid) {
      cupid.needsToSelectLovers = true;
    }
    
    // Setup Wild Child mentor selection
    const wildChild = Object.values(this.players).find(p => p.role === 'Wild Child');
    if (wildChild) {
      wildChild.needsToSelectMentor = true;
    }
    
    // Setup Doppelganger target selection
    const doppelganger = Object.values(this.players).find(p => p.role === 'Doppelganger');
    if (doppelganger) {
      doppelganger.needsToSelectTarget = true;
    }
    
    // Setup Loudmouth target selection
    const loudmouth = Object.values(this.players).find(p => p.role === 'Loudmouth');
    if (loudmouth) {
      loudmouth.needsToSelectTarget = true;
    }
  }

  // ===== HELPER METHODS FOR ROLE DISTRIBUTION =====

  getTeamComposition() {
    const teams = { 'Baik': 0, 'Jahat': 0, 'Netral': 0 };
    
    Object.values(this.players).forEach(player => {
      teams[player.team]++;
    });
    
    return teams;
  }

  validateRoleBalance() {
    const composition = this.getTeamComposition();
    const total = composition.Baik + composition.Jahat + composition.Netral;
    
    // Check if balance is reasonable
    const wolfRatio = composition.Jahat / total;
    const neutralRatio = composition.Netral / total;
    
    // Wolves should be 20-35% of total
    if (wolfRatio < 0.2 || wolfRatio > 0.35) {
      console.warn(`Wolf ratio potentially unbalanced: ${(wolfRatio * 100).toFixed(1)}%`);
    }
    
    // Neutrals should be 10-25% of total  
    if (neutralRatio < 0.1 || neutralRatio > 0.25) {
      console.warn(`Neutral ratio potentially unbalanced: ${(neutralRatio * 100).toFixed(1)}%`);
    }
    
    return {
      balanced: wolfRatio >= 0.2 && wolfRatio <= 0.35 && neutralRatio >= 0.1 && neutralRatio <= 0.25,
      composition,
      ratios: { wolf: wolfRatio, neutral: neutralRatio, village: composition.Baik / total }
    };
  }

  // ================= GAME FLOW =================

  async startLobby(hostUsername, dayDuration = 120, nightDuration = 90, hostId) {
    this.inLobby = true;
    this.hostId = hostId;
    this.DAY_DURATION = dayDuration;
    this.NIGHT_DURATION = nightDuration;

    await this.broadcast(
      `🎮 **SELAMAT DATANG DI ELDERMOOR YANG TERKUTUK** 🎮\n\n` +
      `👑 **Host:** ${hostUsername}\n` +
      `🌅 **Durasi Siang:** ${this.DAY_DURATION} detik\n` +
      `🌙 **Durasi Malam:** ${this.NIGHT_DURATION} detik\n` +
      `🔍 **Mode Revelation:** ${this.revelationMode}\n\n` +
      `Ketik */join* untuk bergabung dalam perjuangan hidup dan mati ini.`
    );

    // Auto-close lobby after 2 minutes
    this.timers.lobbyClose = setTimeout(async () => {
      if (!this.inLobby) return;
      this.inLobby = false;
      
      if (this.playerCount() >= this.MIN_PLAYERS) {
        await this.broadcast("🚀 Lobby ditutup! Permainan dimulai...");
        await this.beginGame();
      } else {
        await this.broadcast(`❌ Butuh minimal ${this.MIN_PLAYERS} pemain untuk memulai!`);
        this.endGame();
      }
    }, 120000);
  }

  async beginGame() {
    if (this.playerCount() < this.MIN_PLAYERS) {
      await this.broadcast(`❌ Butuh minimal ${this.MIN_PLAYERS} pemain untuk memulai.`);
      return;
    }

    this.inLobby = false;
    this.inGame = true;
    this.day = 1;

    try {
      this.assignRoles();
    } catch (err) {
      await this.broadcast(`❌ ${err.message}`);
      this.endGame();
      return;
    }

    // Show game composition based on revelation mode
    await this.announceGameStart();

    // Send role info
    for (const player of Object.values(this.players)) {
      await this.sendRoleInfo(player);
    }

    // Send wolf team info
    await this.sendWolfTeamInfo();

    setTimeout(() => this.startNight(), 3000);
  }

  async announceGameStart() {
    let compositionText = '';
    
    switch (this.revelationMode) {
      case 'HIDDEN':
        compositionText = `Total pemain: ${this.playerCount()} orang\nSemua identitas tersembunyi sampai kematian.`;
        break;
        
      case 'AURA_ONLY':
        const auraCounts = {};
        Object.values(this.players).forEach(p => {
          auraCounts[p.aura] = (auraCounts[p.aura] || 0) + 1;
        });
        compositionText = Object.entries(auraCounts)
          .map(([aura, count]) => `• Aura ${aura}: ${count} orang`)
          .join('\n');
        break;
        
      case 'PROGRESSIVE':
        compositionText = `Total pemain: ${this.playerCount()} orang\nInformasi akan terungkap secara bertahap.`;
        break;
        
      case 'FULL':
      default:
        const rolesList = [...new Set(Object.values(this.players).map(p => p.role))]
          .map(role => `• ${role}`)
          .join('\n');
        compositionText = rolesList;
        break;
    }
    
    await this.broadcast(
      `🌑 **MALAM PERTAMA DI ELDERMOOR** 🌑\n\n` +
      `Komposisi permainan:\n${compositionText}\n\n` +
      `Cek peranmu via DM!`
    );
  }

 async sendWolfTeamInfo() {
  // Send wolf team information to all werewolves
  const wolves = Object.values(this.players).filter(p => this.isWolfTeam(p));
  
  if (wolves.length > 1) {
    const wolfTeamList = wolves.map(w => `• ${w.username} (${w.role})`).join('\n');
    
    for (const wolf of wolves) {
      await this.dm(wolf.id, 
        `🐺 **TIM SERIGALA** 🐺\n\n` +
        `Rekan-rekan kawananmu:\n${wolfTeamList}\n\n` +
        `Kalian berbagi chat malam untuk koordinasi pembunuhan!`
      );
    }
  }

  // Send bandit team info
  const bandits = Object.values(this.players).filter(p => 
    p.alive && ['Bandit', 'Accomplice'].includes(p.role)
  );
  
  if (bandits.length > 1) {
    const banditList = bandits.map(b => `• ${b.username} (${b.role})`).join('\n');
    
    for (const bandit of bandits) {
      await this.dm(bandit.id, 
        `🥷 **TIM BANDIT** 🥷\n\n` +
        `Rekan kriminalmu:\n${banditList}\n\n` +
        `Kalian berbagi target malam untuk aksi pembunuhan!`
      );
    }
  }
}

  async sendRoleInfo(player) {
    const roleInfo = this.getRoleInfo(player.role);
    if (!roleInfo) return;

    const message = 
      `🎭 **TAKDIR ANDA TELAH DITENTUKAN** 🎭\n\n` +
      `${roleInfo.emoji} **Peran:** ${player.role}\n\n` +
      `**Tim:** ${roleInfo.team}\n\n` +
      `**Aksi Malam:** ${roleInfo.nightAction}\n\n` +
      `**Latar Belakang:**\n${roleInfo.description}`;

    await this.dm(player.id, message, player.role);
    
    if (player.role !== 'Fool') {
      await this.sendSpecialRoleInfo(player);
    }
  }

  async sendSpecialRoleInfo(player) {
    switch (player.role) {
      case 'Headhunter':
        const target = this.players[player.target];
        if (target) {
          await this.dm(player.id, `🎯 **TARGET RAHASIA:** ${target.username}\nTugasmu: buat dia digantung oleh warga!`);
        }
        break;
      case 'Mason':
        const otherMasons = this.masons.filter(id => id !== player.id).map(id => this.players[id].username);
        if (otherMasons.length > 0) {
          await this.dm(player.id, `🧱 **REKAN MASON:** ${otherMasons.join(', ')}`);
        }
        break;
      case 'Cupid':
        await this.dm(player.id, `💘 **INSTRUKSI CUPID:** Di malam pertama, kamu harus memilih 2 orang untuk dijadikan lovers. Mereka akan menang bersama jika bertahan sampai akhir!`);
        break;
      case 'Wild Child':
        await this.dm(player.id, `👶 **INSTRUKSI WILD CHILD:** Di malam pertama, pilih seorang mentor. Jika mentor mati, kamu akan berubah menjadi Werewolf!`);
        break;
      case 'Traitor':
        await this.dm(player.id, `🐍 **INSTRUKSI TRAITOR:** Kamu terlihat seperti warga biasa sampai semua Werewolf mati. Saat itu terjadi, kamu akan berubah menjadi Werewolf!`);
        break;
    }
  }

  // ================= NIGHT PHASE =================

  async startNight() {
    if (!this.inGame) return;
    
    this.phase = 'night';
    this.actions = {};
    this.protectedPlayers.clear();
    
    // Reset nightly properties
    Object.values(this.players).forEach(p => {
      p.isProtected = false;
      p.actionUsed = false;
    });

    await this.broadcast(
      `🌙 **MALAM ${this.day} - BAYANG-BAYANG BERGERAK** 🌙\n\n` +
      `Kegelapan menyelimuti desa, dan rahasia terungkap dalam bisikan...`
    );

    // Send night prompts
    for (const player of this.alivePlayers()) {
      await this.sendNightPrompt(player);
    }

    // Night timer
    this.timers.nightEnd = setTimeout(() => this.resolveNight(), this.NIGHT_DURATION * 1000);
    
    // 30s warning
    this.timers.nightWarning = setTimeout(() => {
      if (this.phase === 'night') {
        this.broadcast("⏰ **30 detik tersisa untuk aksi malam!**");
      }
    }, (this.NIGHT_DURATION - 30) * 1000);
  }

  async sendNightPrompt(player) {
    const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
    const numbered = aliveOthers.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
    
    const prompts = {
      'Seer': `🔮 **PENGLIHATAN MASA DEPAN** 🔮\n\nPilih satu untuk diterawang:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``,

      'Fool': `🔮 **PENGLIHATAN MASA DEPAN** 🔮\n\nPilih satu untuk diterawang:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``,
      
      'Aura Seer': `👁️ **PEMBACA AURA** 👁️\n\nPilih satu untuk dibaca auranya:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``,
      
      'Guardian Angel': `👼 **PENJAGA SUCI** 👼\n\nPilih satu untuk dilindungi:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``,
      
      'Witch': this.getWitchPrompt(numbered),

      'Loudmouth': this.getLoudmouthPrompt(player, numbered),
      
      'Detective': `🕵️ **INVESTIGASI** 🕵️\n\nPilih DUA untuk diselidiki:\n\n${numbered}\n\nBalas: \`/<nomor1> <nomor2>\``,
      
      'Hunter': `🏹 **PEMBURU** 🏹\n\nBersiaplah untuk membalas jika diserang. Tidak ada aksi malam ini.`,
            
      'Judge': this.getJudgePrompt(player, numbered),

      'Blacksmith': this.getBlacksmithPrompt(player),

      'Hercules': `🦾 **HERCULES** 🦾\n\nKekuatan dan ketangguhanmu melindungi desa. Tidur dengan tenang, hero.`,
      
      'Guardian Wolf': this.getGuardianWolfPrompt(player, numbered),

      'Doppelganger': this.getDoppelgangerPrompt(player, numbered),
      
      'Prayer': this.getPrayerPrompt(player, numbered),
      
      'The Chemist': `🧪 **EKSPERIMEN MEMATIKAN** 🧪\n\nPilih korban untuk duel ramuan:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      
      'Angel': this.getAngelPrompt(),

      'Harlot': `💋 **WANITA MALAM** 💋\n\nPilih rumah yang akan dikunjungi:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      
      // Wolf roles
      'Werewolf': `🐺 **BERBURU MANGSA** 🐺\n\nPilih korban malam ini:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      'Alpha Werewolf': `👹 **PEMIMPIN KAWANAN** 👹\n\nPilih mangsa untuk kawanan (suaramu dihitung 2x):\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      'Wolf Summoner': this.getWolfSummonerPrompt(numbered),
      'Wolf Trickster': this.getWolfTricksterPrompt(player, numbered),
      'Wolf Seer': this.getWolfSeerPrompt(player, numbered),
      'Lil Wolvy': `🐺 **ANAK SERIGALA** 🐺\n\nPilih mangsa seperti serigala dewasa:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      
      // Neutral roles
      'Serial Killer': `🔪 **PEMBUNUH BERANTAI** 🔪\n\nPilih korban malam ini:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      
      'Arsonist': this.getArsonistPrompt(player, numbered),
      
      'Cannibal': this.getCannibalPrompt(player, numbered),
      
      'Evil Detective': this.getEvilDetectivePrompt(player, numbered),
      
      'Bandit': this.getBanditPrompt(player, numbered),
      
      'Accomplice': `💢 **KAKI TANGAN** 💢\n\nPilih target bersama Bandit:\n\n${numbered}\n\nBalas: \`/<nomor>\``,
      
      'Headhunter': `🎯 **PEMBURU KEPALA** 🎯\n\nManipulasi voting agar targetmu digantung! Tidak ada aksi malam.`,
      
      'Cupid': this.getCupidPrompt(player, numbered),
      
      'Wild Child': this.getWildChildPrompt(player, numbered),
      
      'Traitor': `🐍 **PENGKHIANAT** 🐍\n\nBersembunyi sebagai warga sampai semua serigala mati. Tidak ada aksi malam ini.`
    };

    const prompt = prompts[player.role] || 
      `🌃 **${player.role.toUpperCase()}** 🌃\n\nTidur nyenyak, tidak ada aksi khusus malam ini.`;
    
   await this.dm(player.id, prompt, player.role === 'Fool' ? 'Seer' : player.role);
  }

  // Helper methods for complex prompts
  getCupidPrompt(player, numbered) {
    if (player.hasSelectedLovers) {
      return `💘 **CUPID** 💘\n\nKamu sudah memilih lovers. Tidak ada aksi malam ini.`;
    }
    if (this.day > 1) {
      return `💘 **CUPID** 💘\n\nKamu hanya bisa memilih lovers di malam pertama. Tidak ada aksi sekarang.`;
    }
    return `💘 **CUPID - PILIH DUA LOVERS** 💘\n\nPilih 2 orang untuk dijadikan lovers (mereka akan tahu satu sama lain dan menang bersama):\n\n${numbered}\n\nBalas: \`/<nomor1> <nomor2>\``;
  }

  getWildChildPrompt(player, numbered) {
    if (player.mentor) {
      return `👶 **WILD CHILD** 👶\n\nMentormu adalah ${this.players[player.mentor].username}. Tidak ada aksi malam ini.`;
    }
    if (this.day > 1) {
      return `👶 **WILD CHILD** 👶\n\nKamu hanya bisa memilih mentor di malam pertama. Tidak ada aksi sekarang.`;
    }
    return `👶 **WILD CHILD - PILIH MENTOR** 👶\n\nPilih seorang mentor. Jika dia mati, kamu berubah jadi Werewolf:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
  }

  getWitchPrompt(numbered) {
    const player = Object.values(this.players).find(p => p.role === 'Witch');
    if (!player) return '';
    
    return `🧙‍♀️ **PENYIHIR AGUNG** 🧙‍♀️\n\n` +
      `1) Heal - ${player.hasHeal ? 'Tersedia' : 'Sudah digunakan'}\n` +
      `2) Poison - ${this.day > 1 && player.hasPoison ? 'Tersedia' : 'Tidak tersedia'}\n` +
      `3) Skip\n\n` +
      `${numbered}\n\n` +
      `Balas: \`/1\`, \`/2 <nomor>\`, atau \`/3\``;
  }

  getBlacksmithPrompt(player) {
    if (player.peacefulNightUsed) {
      return `⚒️ **BLACKSMITH** ⚒️\n\nKamu sudah menggunakan Malam Damai. Tidak ada aksi khusus malam ini.`;
    }
    
    return `⚒️ **BLACKSMITH - MALAM DAMAI** ⚒️\n\n` +
      `Apakah kamu ingin menciptakan Malam Damai?\n` +
      `(Tidak ada aksi pembunuhan yang bisa dilakukan malam ini)\n\n` +
      `1. Ya, ciptakan Malam Damai (sekali per game)\n` +
      `2. Tidak, simpan untuk nanti\n\n` +
      `Balas: \`/1\` atau \`/2\``;
  }

  getGuardianWolfPrompt(player, numbered) {
    if (player.guardianProtectionUsed) {
      // Join normal wolf hunt
      return `🛡️🐺 **GUARDIAN WOLF** 🛡️🐺\n\nPerlindungan sudah digunakan. Pilih mangsa bersama kawanan:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
    }
    
    return `🛡️🐺 **GUARDIAN WOLF** 🛡️🐺\n\n` +
      `1. Berburu mangsa biasa\n` +
      `2. Simpan perlindungan untuk kawanan (skip hunting)\n\n` +
      `Targets:\n${numbered}\n\n` +
      `Balas: \`/1 <nomor>\` atau \`/2\``;
  }

  getPrayerPrompt(player, numbered) {
    switch (player.currentSkill) {
      case 'pray':
        return `🤲 **PRAYER - DOA PERLINDUNGAN** 🤲\n\nPilih satu untuk didoakan:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
        
      case 'protect':
        return `🤲 **PRAYER - KEKUATAN PERLINDUNGAN** 🤲\n\nPilih satu untuk dilindungi atau skip:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``;
        
      case 'kill':
        return `🤲 **PRAYER - MURKA ILAHI** 🤲\n\nPilih satu untuk dihukum atau skip:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``;
        
      case 'reveal':
        return `🤲 **PRAYER - MATA BATIN** 🤲\n\nPilih satu untuk dilihat rolenya atau skip:\n\n${numbered}\n\nBalas: \`/<nomor>\` atau \`/skip\``;
        
      default:
        return `🤲 **PRAYER** 🤲\n\nTidak ada aksi malam ini.`;
    }
  }

  getLoudmouthPrompt(player, numbered) {
    if (player.target || this.day > 1) {
      return `🤬 **LOUDMOUTH** 🤬\n\nKamu sudah memilih target atau waktu pemilihan terlewat.`;
    }
    return `🤬 **LOUDMOUTH** 🤬\n\nPilih 1 pemain yang rolenya akan kamu ungkap saat kamu mati:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
  }

  getJudgePrompt(player, numbered) {
    if (player.convictions <= 0) {
      return `🧑‍⚖️ **HAKIM AGUNG** 🧑‍⚖️\n\nSudah tidak ada hak vonis tersisa.`;
    }
    return `🧑‍⚖️ **HAKIM AGUNG** 🧑‍⚖️\n\nHak eksekusi tersisa: ${player.convictions}\n\n${numbered}\n\nPilih untuk dieksekusi jika tidak ada yang digantung hari ini.\nBalas: \`/<nomor>\``;
  }

  getDoppelgangerPrompt(player, numbered) {
    if (player.originalRole || this.day > 1) {
      return `🎭 **DOPPELGANGER** 🎭\n\nKamu sudah memilih target atau waktu pemilihan terlewat.`;
    }
    return `🎭 **DOPPELGANGER** 🎭\n\nPilih seseorang untuk ditiru (kamu akan mewarisi rolenya saat dia mati):\n\n${numbered}\n\nBalas: \`/<nomor>\``;
  }

  getAngelPrompt() {
    const deadPlayers = Object.values(this.players).filter(p => !p.alive);
    if (deadPlayers.length === 0) {
      return `😇 **MALAIKAT** 😇\n\nTidak ada jiwa yang bisa dibangkitkan.`;
    }
    const deadList = deadPlayers.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
    return `😇 **MALAIKAT PENOLONG** 😇\n\nPilih satu untuk dibangkitkan (kamu akan mati):\n\n${deadList}\n\nBalas: \`/<nomor>\``;
  }

  getArsonistPrompt(player, numbered) {
    if (this.day === 1) {
      return `🔥 **PEMBAKAR** 🔥\n\nSiram bensin pada satu target:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
    }
    return `🔥 **PEMBAKAR** 🔥\n\n1) Siram bensin\n2) Bakar semua!\n3) Skip\n\nTargets:\n${numbered}\n\nBalas: \`/1 <nomor>\`, \`/2\`, atau \`/3\``;
  }

  getCannibalPrompt(player, numbered) {
    const currentStacks = player.hungerStack;
    const maxTargets = Math.min(currentStacks, numbered.length);
    
    let options = [`1) Skip (simpan stack untuk nanti) - Stack akan jadi ${Math.min(currentStacks + 1, 5)}/5`];
    
    // FIXED: Only show options for stacks available
    for (let i = 1; i <= maxTargets; i++) {
      const targetWord = i === 1 ? 'orang' : 'orang';
      options.push(`${i + 1}) Makan ${i} ${targetWord} (gunakan ${i} stack)`);
    }
    
    return `🖤 **KANIBAL** 🖤\n\n` +
      `Stack lapar saat ini: ${currentStacks}/5\n` +
      `Target tersedia: ${numbered.length} orang\n` +
      `Maksimal bisa makan: ${maxTargets} orang\n\n` +
      `${options.join('\n')}\n\n` +
      `Targets:\n${numbered}\n\n` +
      `Balas: \`/1\` untuk skip, atau \`/<nomor_opsi> <target1> <target2>...\`\n` +
      `Contoh: \`/2 1\` (makan 1 orang), \`/3 1 5\` (makan 2 orang)\n` +
      `**PENTING: 1 stack = 1 orang**`;
  }

  getEvilDetectivePrompt(player, numbered) {
    return `🕵️‍♂️👹 **DETEKTIF JAHAT** 🕵️‍♂️👹\n\n` +
      `Pilih DUA target untuk diselidiki:\n\n` +
      `0. ${player.username} (diri sendiri)\n` +
      `${numbered}\n\n` +
      `Jika beda tim, yang bukan dirimu akan mati!\n` +
      `Jika sama tim, kamu tahu tim mereka!\n\n` +
      `Balas: \`/<nomor1> <nomor2>\``;
  }

  getBanditPrompt(player, numbered) {
    if (player.accomplice) {
      return `🥷 **BANDIT** 🥷\n\nPilih target bersama Accomplice:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
    }
    return `🥷 **BANDIT** 🥷\n\nCari Accomplice (hanya Villager yang bisa direkrut):\n\n${numbered}\n\nBalas: \`/<nomor>\``;
  }

  getWolfSummonerPrompt(numbered) {
    const deadWolves = Object.values(this.players).filter(p => 
      !p.alive && ['Werewolf', 'Alpha Werewolf', 'Wolf Summoner', 'Wolf Trickster', 'Wolf Seer', 'Lil Wolvy'].includes(p.role)
    );
    
    if (deadWolves.length === 0) {
      return `🌕 **PEMANGGIL SERIGALA** 🌕\n\nTidak ada serigala mati untuk dibangkitkan.\n\nPilih mangsa:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
    }
    
    const deadList = deadWolves.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
    return `🌕 **PEMANGGIL SERIGALA** 🌕\n\n1) Bangkitkan serigala\n2) Berburu biasa\n\nSerigala mati:\n${deadList}\n\nTarget:\n${numbered}\n\nBalas: \`/1 <nomor_mati>\` atau \`/2 <nomor_hidup>\``;
  }

  getWolfTricksterPrompt(player, numbered) {
    if (player.stolenRole) {
      return `🎭 **PENIPU SERIGALA** 🎭\n\nSudah mencuri penampilan. Pilih mangsa:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
    }
    return `🎭 **PENIPU SERIGALA** 🎭\n\nCuri penampilan dari:\n\n${numbered}\n\nBalas: \`/<nomor>\``;
  }

  getWolfSeerPrompt(player, numbered) {
    return `👁️ **PERAMAL SERIGALA** 👁️\n\nPilihan:\n1) Lihat role target\n2) Resign jadi Werewolf biasa\n\nTargets:\n${numbered}\n\nBalas: \`/1 <nomor>\` atau \`/2\``;
  }

  // ================= HANDLE PLAYER CHOICES =================

  async handleChoice(senderId, numbers) {
    const gId = this.resolveId(senderId);
    const player = this.players[gId];

    // Handle hunter revenge
    if (this.pendingHunter === gId && (!player || !player.alive)) {
      return this.handleHunterRevenge(gId, numbers);
    }

    if (!player || !player.alive) {
      return this.dm(gId, "❌ Kamu sudah mati dan tidak bisa beraksi.");
    }

    // Handle gunner shooting during day
    if (this.phase === 'discussion' && player.role === 'Gunner' && player.bullets > 0) {
      return this.handleGunnerDayShoot(gId, player, numbers);
    }

    if (this.phase === 'night') {
      return this.handleNightChoice(gId, player, numbers);
    }

    if (this.phase === 'vote') {
      return this.handleVoteChoice(gId, player, numbers);
    }

    return this.dm(gId, "❌ Tidak ada aksi yang bisa dilakukan saat ini.");
  }

  async handleNightChoice(gId, player, numbers) {
    if (player.actionUsed) {
      return this.dm(gId, "❌ Kamu sudah beraksi malam ini.");
    }

    const success = await this.processRoleAction(player, numbers);
    if (success) {
      player.actionUsed = true;
    }
  }

  async processRoleAction(player, numbers) {
    const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
    const getTarget = (index) => {
      if (index === 0 && player.role === 'Evil Detective') return player;
      return aliveOthers[index - 1];
    };

    switch (player.role) {
      case 'Seer':
        return this.handleSeerAction(player, getTarget(numbers[0]));

      case 'Fool':
        return this.handleFoolAction(player, getTarget(numbers[0]));
      
      case 'Aura Seer':
        return this.handleAuraSeerAction(player, getTarget(numbers[0]));
      
      case 'Guardian Angel':
        return this.handleGuardianAction(player, getTarget(numbers[0]));
      
      case 'Harlot':
        return this.handleHarlotAction(player, getTarget(numbers[0]));

      case 'Witch':
        return this.handleWitchAction(player, numbers, aliveOthers);
      
      case 'Detective':
        return this.handleDetectiveAction(player, numbers, aliveOthers);
      
      case 'Judge':
        return this.handleJudgeAction(player, getTarget(numbers[0]));

      case 'Blacksmith':
        return this.handleBlacksmithAction(player, numbers[0]);
      
      case 'Guardian Wolf':
        return this.handleGuardianWolfAction(player, numbers);

      case 'Loudmouth':
        return this.handleLoudmouthAction(player, getTarget(numbers[0]));
      
      case 'Prayer':
        return this.handlePrayerAction(player, getTarget(numbers[0]));
      
      case 'The Chemist':
        return this.handleChemistAction(player, getTarget(numbers[0]));
      
      case 'Doppelganger':
        return this.handleDoppelgangerAction(player, getTarget(numbers[0]));
      
      case 'Angel':
        return this.handleAngelAction(player, numbers);
      
      // Wolf roles
      case 'Werewolf':
      case 'Alpha Werewolf':
      case 'Lil Wolvy':
        return this.handleWolfKillAction(player, getTarget(numbers[0]));
      
      case 'Wolf Summoner':
        return this.handleWolfSummonerAction(player, numbers);
      
      case 'Wolf Trickster':
        return this.handleWolfTricksterAction(player, getTarget(numbers[0]));
      
      case 'Wolf Seer':
        return this.handleWolfSeerAction(player, getTarget(numbers[0]));
      
      // Neutral roles
      case 'Serial Killer':
        return this.handleSerialKillerAction(player, getTarget(numbers[0]));
      
      case 'Cupid':
        return this.handleCupidAction(player, numbers, aliveOthers);

      case 'Wild Child':
          return this.handleWildChildAction(player, numbers, aliveOthers);

      case 'Arsonist':
        return this.handleArsonistAction(player, numbers, aliveOthers);
      
      case 'Cannibal':
        return this.handleCannibalAction(player, numbers, aliveOthers);
      
      case 'Evil Detective':
        return this.handleEvilDetectiveAction(player, numbers);
      
      case 'Bandit':
        return this.handleBanditAction(player, getTarget(numbers[0]));
      
      case 'Accomplice':
        return this.handleAccompliceAction(player, getTarget(numbers[0]));
      
      default:
        await this.dm(player.id, "Aksi dicatat atau tidak ada aksi khusus.");
        return true;
    }
  }

  // ================= ROLE ACTION HANDLERS =================

  async handleSeerAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    let result = target.role;
    
    // TAMBAH INI - Lycan appears as random villager role
    if (target.role === 'Lycan') {
      const villagerRoles = ['Villager', 'Mason', 'Hunter', 'Witch'];
      result = villagerRoles[Math.floor(Math.random() * villagerRoles.length)];
    }
    
    // Wolfman appears as Werewolf
    if (target.role === 'Wolfman') {
      result = 'Werewolf';
    }
    
    const displayResult = this.hideRoles ? target.aura : result;
    await this.dm(player.id, `🔮 Kamu melihat ${target.username}... ${this.hideRoles ? `Aura: **${displayResult}**` : `Role: **${displayResult}**`}`);
    return true;
  }

  async handleAuraSeerAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    let aura = target.aura;
    
    // TAMBAH INI - Lycan appears as Good, Wolfman appears as Evil
    if (target.role === 'Lycan') {
      aura = 'Good';
    }
    if (target.role === 'Wolfman') {
      aura = 'Evil';
    }
    
    await this.dm(player.id, `👁️ Aura ${target.username} adalah **${aura}**.`);
    return true;
  }

  async handleHarlotAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    player.visitTarget = target.id;
    player.isHome = false;
    this.actions[player.id] = { action: 'visit', target: target.id };
    await this.dm(player.id, `💋 Kamu mengunjungi rumah ${target.username} malam ini.`);
    return true;
  }

  async handleDoppelgangerAction(player, target) {
    if (this.day > 1 || player.originalRole) {
      await this.dm(player.id, "❌ Kamu hanya bisa memilih di malam pertama.");
      return false;
    }
    
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    player.originalRole = target.role;
    player.originalTarget = target.id;
    await this.dm(player.id, `🎭 Kamu akan mewarisi role ${target.username} saat dia mati.`);
    return true;
  }

   async handleFoolAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    // Get all roles currently in the game (alive players only)
    const currentRoles = [...new Set(this.alivePlayers().map(p => p.role))];
    
    // Remove Fool from the list so they don't "see" another Fool
    const possibleRoles = currentRoles.filter(role => role !== 'Fool', 'Seer');
    
    // If no other roles available, use common roles
    if (possibleRoles.length === 0) {
      possibleRoles.push('Villager', 'Werewolf', 'Seer');
    }
    
    // Pick a random role from currently playing roles
    const fakeRole = possibleRoles[Math.floor(Math.random() * possibleRoles.length)];
    
    // Send result as if they were a real Seer (they believe it completely)
    await this.dm(player.id, `🔮 Kamu melihat ${target.username}... Role: **${fakeRole}**`);
    
    return true;
  }

  async handleGuardianAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'protect', target: target.id };
    await this.dm(player.id, `🛡️ Kamu akan melindungi ${target.username} malam ini.`);
    return true;
  }

  async handleWitchAction(player, numbers, aliveOthers) {
    const choice = numbers[0];
    
    if (choice === 1) { // Heal
      if (!player.hasHeal) {
        await this.dm(player.id, "❌ Heal sudah digunakan.");
        return false;
      }
      this.actions[player.id] = { action: 'heal' };
      player.hasHeal = false;
      await this.dm(player.id, "✅ Kamu akan menyelamatkan korban serigala malam ini.");
      return true;
    } else if (choice === 2) { // Poison
      if (this.day === 1) {
        await this.dm(player.id, "❌ Poison tidak bisa digunakan malam pertama.");
        return false;
      }
      if (!player.hasPoison) {
        await this.dm(player.id, "❌ Poison sudah digunakan.");
        return false;
      }
      const target = aliveOthers[numbers[1] - 1];
      if (!target) {
        await this.dm(player.id, "❌ Target poison tidak valid.");
        return false;
      }
      this.actions[player.id] = { action: 'poison', target: target.id };
      player.hasPoison = false;
      await this.dm(player.id, `☠️ Kamu meracuni ${target.username}.`);
      return true;
    } else if (choice === 3) { // Skip
      await this.dm(player.id, "⭐ Kamu memilih tidak beraksi.");
      return true;
    }
    
    await this.dm(player.id, "❌ Pilihan tidak valid.");
    return false;
  }

  async handleLoudmouthAction(player, target) {
    if (this.day > 1 || player.target) {
      await this.dm(player.id, "❌ Kamu hanya bisa memilih di malam pertama.");
      return false;
    }
    
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    player.target = target.id;
    await this.dm(player.id, `🤬 Kamu akan mengungkap role ${target.username} saat kamu mati.`);
    return true;
  }

  async handleDetectiveAction(player, numbers, aliveOthers) {
    if (numbers.length < 2) {
      await this.dm(player.id, "❌ Pilih 2 target. Contoh: /1 3");
      return false;
    }
    
    const target1 = aliveOthers[numbers[0] - 1];
    const target2 = aliveOthers[numbers[1] - 1];
    
    if (!target1 || !target2) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    const sameTeam = target1.team === target2.team;
    await this.dm(player.id, 
      `🕵️ Hasil investigasi ${target1.username} dan ${target2.username}:\n` +
      `Mereka ${sameTeam ? "**satu tim**" : "**berbeda tim**"}.`
    );
    
    return true;
  }

  async handleGunnerDayShoot(gId, player, numbers) {
    const alive = this.alivePlayers().filter(p => p.id !== gId);
    const target = alive[numbers[0] - 1];
    
    if (!target) {
      return this.dm(gId, "❌ Target tidak valid.");
    }
    
    player.bullets--;
    target.alive = false;
    target.lastKillMethod = 'dayshoot';
    
    const revelationInfo = this.getRevelationInfo(target);
    
    await this.broadcast(
      `🔫 **TEMBAKAN SIANG HARI!** ${player.username} menembak ${target.username}!${revelationInfo ? '\n' + revelationInfo : ''}\n\n` +
      `Sisa peluru Gunner: ${player.bullets}`
    );
    
    // Check win condition
    setTimeout(() => this.checkWinCondition(), 1000);
    return true;
  }

  async handleJudgeAction(player, target) {
    if (player.convictions <= 0) {
      await this.dm(player.id, "❌ Hak eksekusi sudah habis.");
      return false;
    }
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'judge', target: target.id };
    player.convictions--;
    await this.dm(player.id, `⚖️ Kamu akan mengeksekusi ${target.username} jika tidak ada lynch hari ini.`);
    return true;
  }

  async handlePrayerAction(player, numbers) {
    const choice = numbers[0];
    const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
    
    // Handle skip untuk skill selain pray
    if (choice === 0 && player.currentSkill !== 'pray') { // /skip
      await this.dm(player.id, "⭐ Kamu memilih tidak menggunakan kekuatanmu malam ini.");
      return true;
    }
    
    const target = aliveOthers[choice - 1];
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    switch (player.currentSkill) {
      case 'pray':
        player.lastPrayerTarget = target.id;
        this.actions[player.id] = { action: 'pray', target: target.id };
        await this.dm(player.id, `🤲 Kamu berdoa untuk ${target.username}.`);
        return true;
        
      case 'protect':
        this.actions[player.id] = { action: 'prayer_protect', target: target.id };
        player.skillUsed = true;
        await this.dm(player.id, `🛡️ Kamu melindungi ${target.username} dengan kekuatan suci.`);
        return true;
        
      case 'kill':
        this.actions[player.id] = { action: 'prayer_kill', target: target.id };
        player.skillUsed = true;
        await this.dm(player.id, `⚔️ Kamu menghukum ${target.username} dengan murka ilahi.`);
        return true;
        
      case 'reveal':
        const role = target.role;
        player.skillUsed = true;
        await this.dm(player.id, `👁️ Wahyu mengungkap ${target.username} adalah **${role}**.`);
        return true;
        
      default:
        await this.dm(player.id, "❌ Tidak ada aksi yang bisa dilakukan.");
        return false;
    }
  }

  async handleChemistAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'chemist_duel', target: target.id };
    await this.dm(player.id, `🧪 Kamu memaksa ${target.username} minum ramuanmu!`);
    await this.dm(target.id, `🧪 ${player.username} memaksamu minum ramuan misterius!`);
    return true;
  }

  async handleAngelAction(player, numbers) {
    const deadPlayers = Object.values(this.players).filter(p => !p.alive);
    const target = deadPlayers[numbers[0] - 1];
    
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'revive', target: target.id };
    await this.dm(player.id, `😇 Kamu akan mengorbankan diri untuk membangkitkan ${target.username}.`);
    return true;
  }

  async handleBlacksmithAction(player, choice) {
    if (player.peacefulNightUsed) {
      await this.dm(player.id, "❌ Malam Damai sudah pernah digunakan.");
      return false;
    }
    
    if (choice === 1) {
      // Create peaceful night
      this.peacefulNight = true;
      player.peacefulNightUsed = true;
      player.canCreatePeace = false;
      
      await this.dm(player.id, "⚒️ **MALAM DAMAI DICIPTAKAN!** Tidak ada pembunuhan yang bisa terjadi malam ini.");
      await this.broadcast("✨ **AURA DAMAI** menyelimuti desa... Malam ini terasa berbeda, lebih tenang...");
      
      return true;
    } else if (choice === 2) {
      await this.dm(player.id, "⚒️ Kamu menyimpan kekuatan Malam Damai untuk waktu yang lebih tepat.");
      return true;
    }
    
    await this.dm(player.id, "❌ Pilihan tidak valid.");
    return false;
  }

  async handleGuardianWolfAction(player, numbers) {
    const choice = numbers[0];
    
    if (choice === 2 && !player.guardianProtectionUsed) {
      // Save protection for later
      await this.dm(player.id, "🛡️ Kamu menyimpan perlindungan untuk saat kawanan benar-benar membutuhkan.");
      return true;
    } else if (choice === 1 || player.guardianProtectionUsed) {
      // Normal hunt
      const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
      const targetIndex = player.guardianProtectionUsed ? 0 : 1;
      const target = aliveOthers[numbers[targetIndex] - 1];
      
      return this.handleWolfKillAction(player, target);
    }
    
    await this.dm(player.id, "❌ Pilihan tidak valid.");
    return false;
  }

  async handleWolfKillAction(player, target) {
    if (!target) {
      await this.dm(player.id, "⚠ Target tidak valid.");
      return false;
    }
    
    // PERBAIKAN: Gunakan helper function
    if (this.isWolfTeam(target) && target.id !== player.id) {
      await this.dm(player.id, "⚠ Kamu tidak bisa menyerang sesama serigala!");
      return false;
    }
    
    this.actions[player.id] = { action: 'wolf_kill', target: target.id };
    await this.dm(player.id, `🐺 Kamu memilih ${target.username} sebagai mangsa.`);
    return true;
  }

  async handleWolfSummonerAction(player, numbers) {
    const choice = numbers[0];
    
    if (choice === 1) { // Revive wolf
      const deadWolves = Object.values(this.players).filter(p => 
        !p.alive && ['Werewolf', 'Alpha Werewolf', 'Wolf Summoner', 'Wolf Trickster', 'Wolf Seer', 'Lil Wolvy'].includes(p.role)
      );
      const target = deadWolves[numbers[1] - 1];
      
      if (!target) {
        await this.dm(player.id, "❌ Target tidak valid.");
        return false;
      }
      
      this.actions[player.id] = { action: 'revive_wolf', target: target.id };
      await this.dm(player.id, `🌕 Kamu membangkitkan ${target.username} sebagai Werewolf!`);
      return true;
    } else if (choice === 2) { // Normal kill
      const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
      const target = aliveOthers[numbers[1] - 1];
      
      return this.handleWolfKillAction(player, target);
    }
    
    await this.dm(player.id, "❌ Pilihan tidak valid.");
    return false;
  }

  async handleWolfTricksterAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    if (player.stolenRole) {
      return this.handleWolfKillAction(player, target);
    } else {
      // UBAH INI - hanya steal appearance, bukan kill
      this.actions[player.id] = { action: 'mark_for_steal', target: target.id };
      await this.dm(player.id, `🎭 Kamu akan mencuri penampilan ${target.username} jika dia mati bukan karena serigala.`);
      return true;
    }
  }

  async handleWolfSeerAction(player, numbers) {
    const choice = numbers[0];
    
    if (choice === 2) {
      // Resign to become regular Werewolf
      player.role = 'Werewolf';
      await this.dm(player.id, `👁️➡️🐺 **TRANSFORMASI!** Kamu menyerahkan kemampuan melihat dan menjadi **Werewolf** biasa yang bisa berburu!`);
      return true;
    }
    
    const aliveOthers = this.alivePlayers().filter(p => p.id !== player.id);
    const target = aliveOthers[choice - 1];
    
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    await this.dm(player.id, `👁️ ${target.username} adalah **${target.role}**.`);
    return true;
  }

  async handleSerialKillerAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'serial_kill', target: target.id };
    await this.dm(player.id, `🔪 Kamu akan membunuh ${target.username}.`);
    return true;
  }

  async handleArsonistAction(player, numbers, aliveOthers) {
    const choice = numbers[0];
    
    if (this.day === 1 || choice === 1) { // Douse
      const targetIndex = this.day === 1 ? 0 : 1;
      const target = aliveOthers[numbers[targetIndex] - 1];
      
      if (!target) {
        await this.dm(player.id, "❌ Target tidak valid.");
        return false;
      }
      
      this.dousedPlayers.add(target.id);
      target.isDoused = true;
      await this.dm(player.id, `🔥 Kamu menuang bensin pada ${target.username}.`);
      return true;
    } else if (choice === 2) { // Ignite
      this.actions[player.id] = { action: 'ignite' };
      await this.dm(player.id, "🔥 Kamu akan membakar semua yang diberi bensin!");
      return true;
    } else if (choice === 3) { // Skip
      await this.dm(player.id, "⭐ Kamu memilih tidak beraksi.");
      return true;
    }
    
    await this.dm(player.id, "❌ Pilihan tidak valid.");
    return false;
  }

  async handleCannibalAction(player, numbers, aliveOthers) {
    const choice = numbers[0];
    const currentStacks = player.hungerStack;
    const availableTargets = aliveOthers.length;
    
    // Skip option
    if (choice === 1) {
      player.hungerStack = Math.min(currentStacks + 1, 5); // TAMBAHKAN INI
      await this.dm(player.id, `⭐ Kamu menahan lapar malam ini. Stack besok: ${player.hungerStack}/5`);
      return true;
    }
    
    // PERBAIKAN: Calculate how many people to eat based on choice
    const peopleToEat = choice - 1; // choice 2 = 1 person, choice 3 = 2 people, etc.
    
    if (peopleToEat < 1 || peopleToEat > currentStacks || peopleToEat > availableTargets) {
      await this.dm(player.id, `⚠ Tidak bisa makan ${peopleToEat} orang dengan ${currentStacks} stack dan ${availableTargets} target tersedia.`);
      return false;
    }
    
    const targetNumbers = numbers.slice(1);
    
    // Auto-select all if trying to eat everyone available and have enough stacks
    if (peopleToEat === availableTargets && targetNumbers.length === 0 && currentStacks >= peopleToEat) {
      const allTargets = aliveOthers.map(t => t.id);
      this.actions[player.id] = { action: 'cannibalize', targets: allTargets, stacks: peopleToEat };
      player.hungerStack -= peopleToEat;
      
      await this.dm(player.id, `🖤 **PESTA KANIBAL!** Kamu akan memakan SEMUA ${peopleToEat} orang! Stack tersisa: ${player.hungerStack}/5`);
      return true;
    }
    
    // Manual target selection
    if (targetNumbers.length !== peopleToEat) {
      await this.dm(player.id, `⚠ Pilih tepat ${peopleToEat} target untuk dimakan.`);
      return false;
    }
    
    const targets = targetNumbers.map(num => aliveOthers[num - 1]).filter(t => t);
    
    if (targets.length !== peopleToEat) {
      await this.dm(player.id, "⚠ Beberapa nomor target tidak valid.");
      return false;
    }
    
    // Execute the cannibalization
    this.actions[player.id] = { action: 'cannibalize', targets: targets.map(t => t.id), stacks: peopleToEat };
    player.hungerStack -= peopleToEat;
    
    const targetNames = targets.map(t => t.username).join(', ');
    await this.dm(player.id, `🖤 Kamu akan memakan ${targetNames} (${peopleToEat} stack). Sisa stack: ${player.hungerStack}/5`);
    return true;
  }

  async handleEvilDetectiveAction(player, numbers) {
    if (numbers.length < 2) {
      await this.dm(player.id, "❌ Pilih 2 target.");
      return false;
    }
    
    const allTargets = [player, ...this.alivePlayers().filter(p => p.id !== player.id)];
    const target1 = allTargets[numbers[0]];
    const target2 = allTargets[numbers[1]];
    
    if (!target1 || !target2) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'evil_investigate', targets: [target1.id, target2.id] };
    await this.dm(player.id, `🕵️‍♂️👹 Kamu menyelidiki ${target1.username} dan ${target2.username}.`);
    return true;
  }

  async handleBanditAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    if (player.accomplice) {
      this.actions[player.id] = { action: 'bandit_kill', target: target.id };
      await this.dm(player.id, `🥷 Kamu akan membunuh ${target.username}.`);
    } else {
      this.actions[player.id] = { action: 'recruit', target: target.id };
      await this.dm(player.id, `🥷 Kamu akan merekrut ${target.username}.`);
    }
    return true;
  }

  async handleAccompliceAction(player, target) {
    if (!target) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    this.actions[player.id] = { action: 'accomplice_kill', target: target.id };
    await this.dm(player.id, `💢 Kamu akan membunuh ${target.username}.`);
    return true;
  }

  async handleCupidAction(player, numbers, aliveOthers) {
    if (this.day > 1) {
      await this.dm(player.id, "❌ Cupid hanya bisa memilih lovers di malam pertama.");
      return false;
    }
    
    if (player.hasSelectedLovers) {
      await this.dm(player.id, "❌ Kamu sudah memilih lovers.");
      return false;
    }
    
    if (numbers.length < 2) {
      await this.dm(player.id, "❌ Pilih 2 orang. Contoh: /1 3");
      return false;
    }
    
    const lover1 = aliveOthers[numbers[0] - 1];
    const lover2 = aliveOthers[numbers[1] - 1];
    
    if (!lover1 || !lover2 || lover1.id === lover2.id) {
      await this.dm(player.id, "❌ Target tidak valid atau sama.");
      return false;
    }
    
    // Set up lover relationship
    lover1.lover = lover2.id;
    lover2.lover = lover1.id;
    lover1.isLover = true;
    lover2.isLover = true;
    
    this.lovers = [lover1.id, lover2.id];
    player.hasSelectedLovers = true;
    
    await this.dm(player.id, `💘 Kamu mengikat ${lover1.username} dan ${lover2.username} sebagai lovers!`);
    
    // Notify the lovers
    await this.dm(lover1.id, `💘 **IKATAN CINTA!** Kamu terikat dengan ${lover2.username} sebagai lovers. Kalian menang bersama atau mati bersama!`);
    await this.dm(lover2.id, `💘 **IKATAN CINTA!** Kamu terikat dengan ${lover1.username} sebagai lovers. Kalian menang bersama atau mati bersama!`);
    
    return true;
  }

  async handleWildChildAction(player, numbers, aliveOthers) {
    if (this.day > 1) {
      await this.dm(player.id, "❌ Wild Child hanya bisa memilih mentor di malam pertama.");
      return false;
    }
    
    if (player.mentor) {
      await this.dm(player.id, "❌ Kamu sudah memilih mentor.");
      return false;
    }
    
    const mentor = aliveOthers[numbers[0] - 1];
    if (!mentor) {
      await this.dm(player.id, "❌ Target tidak valid.");
      return false;
    }
    
    player.mentor = mentor.id;
    await this.dm(player.id, `👶 Kamu memilih ${mentor.username} sebagai mentormu!`);
    
    return true;
  }

  async handleHunterRevenge(hunterId, numbers) {
    const aliveList = this.alivePlayers();
    const target = aliveList[numbers[0] - 1];
    
    if (!target) {
      await this.dm(hunterId, "❌ Target tidak valid.");
      return;
    }
    
    this.pendingHunter = null;
    clearTimeout(this.timers.hunterTimeout);
    
    target.alive = false;
    target.lastKillMethod = 'hunter_revenge';
    await this.broadcast(`🏹 *PANAH BALAS DENDAM!* ${this.players[hunterId].username} membawa ${target.username} bersamanya ke alam baka!`);
    
    setTimeout(() => this.checkWinCondition(), 2000);
  }

  // ================= NIGHT RESOLUTION =================

  async resolveNight() {
    if (this.phase !== 'night') return;
    
    clearTimeout(this.timers.nightEnd);
    clearTimeout(this.timers.nightWarning);
    
    const deaths = [];
    const events = [];
    
    // Process actions in order
    await this.processProtections();
    await this.processKills(deaths, events);
    await this.processSpecialActions(deaths, events);
    
    // Generate morning narrative
    await this.generateMorningNarrative(deaths, events);
    
    // Check win conditions
    if (await this.checkWinCondition()) return;
    
    // Start day phase
    this.day++;
    setTimeout(() => this.startDay(), 3000);
  }

  async processProtections() {
    this.protectedPlayers.clear();
    
    Object.entries(this.actions).forEach(([playerId, action]) => {
      if (action.action === 'protect') {
        const protector = this.players[playerId];
        const target = this.players[action.target];
        
        if (protector && protector.alive && target) {
          // Check if protecting a wolf - Guardian Angel dies
          if (target.team === 'Jahat') {
            protector.alive = false;
            this.broadcast(`🛡️ **TRAGEDI!** Guardian Angel mati karena melindungi yang salah!`);
          } else {
            this.protectedPlayers.add(action.target);
          }
        }
      }
    });
  }

  async processBanditKills(addDeath, events) {
    const banditVotes = {};
    const banditVoters = [];
    
    Object.entries(this.actions).forEach(([playerId, action]) => {
      const player = this.players[playerId];
      if ((action.action === 'bandit_kill' || action.action === 'accomplice_kill') && 
          player.alive && ['Bandit', 'Accomplice'].includes(player.role)) {
        const targetId = action.target;
        banditVotes[targetId] = (banditVotes[targetId] || 0) + 1;
        banditVoters.push(playerId);
      }
    });
    
    if (Object.keys(banditVotes).length === 0) return;
    
    let maxVotes = Math.max(...Object.values(banditVotes));
    const winners = Object.entries(banditVotes)
      .filter(([_, votes]) => votes === maxVotes)
      .map(([targetId]) => targetId);
    
    const finalTarget = winners[Math.floor(Math.random() * winners.length)];
    const victim = this.players[finalTarget];
    
    if (victim && victim.alive && !this.protectedPlayers.has(finalTarget)) {
      if (victim.role === 'Harlot' && !victim.isHome) {
        events.push(`💋 Harlot tidak ada di rumah saat bandit datang...`);
        return;
      }
      
      if (!this.hasKillImmunity(victim, [{killer: banditVoters[0], method: 'bandit_kill'}])) {
        addDeath(victim, 'bandit_kill', this.players[banditVoters[0]]);
        
        // Notify bandit team
        for (const banditId of banditVoters) {
          await this.dm(banditId, `🥷 Tim bandit memutuskan membunuh ${victim.username}.`);
        }
      }
    }
  }

async processWolfKills(addDeath, events) {
  const wolfVotes = {};
  const wolfVoters = [];
  
  Object.entries(this.actions).forEach(([playerId, action]) => {
    const player = this.players[playerId];
    if (action.action === 'wolf_kill' && player.alive && this.isWolfTeam(player)) {
      const targetId = action.target;
      const voteWeight = player.role === 'Alpha Werewolf' ? 2 : 1;
      
      wolfVotes[targetId] = (wolfVotes[targetId] || 0) + voteWeight;
      wolfVoters.push(playerId);
    }
  });
  
  if (Object.keys(wolfVotes).length === 0) return;
      
  let maxVotes = Math.max(...Object.values(wolfVotes));
  const winners = Object.entries(wolfVotes)
    .filter(([_, votes]) => votes === maxVotes)
    .map(([targetId]) => targetId);
  
  const finalTarget = winners[Math.floor(Math.random() * winners.length)];
  const victim = this.players[finalTarget];
  
  if (victim && victim.alive && !this.protectedPlayers.has(finalTarget)) {
    const killCount = this.lilWolvyKilled ? 2 : 1;
    const targets = [victim];
    
    if (killCount === 2) {
      const potentialSecond = this.alivePlayers()
        .filter(p => p.id !== finalTarget && !this.protectedPlayers.has(p.id));
      if (potentialSecond.length > 0) {
        const secondVictim = potentialSecond[Math.floor(Math.random() * potentialSecond.length)];
        targets.push(secondVictim);
      }
    }
    
    targets.forEach(target => {
      if (target.role === 'Harlot' && !target.isHome) {
        events.push(`💋 Harlot tidak ada di rumah saat serigala datang...`);
        return;
      }
      if (!this.hasKillImmunity(target, [{killer: wolfVoters[0], method: 'wolf_kill'}])) {
        // PERBAIKAN: Check Cursed transformation
        if (target.role === 'Cursed') {
          target.role = 'Werewolf';
          target.team = 'Jahat';
          target.aura = 'Evil';
          // Don't add to deaths - they transform instead
          events.push(`🌙 Gigitan serigala membangunkan kutukan dalam darah seseorang...`);
          this.dm(target.id, `😾➡️🐺 **KUTUKAN BANGKIT!** Gigitan serigala membangunkan monster dalam dirimu! Kamu sekarang *Werewolf*!`);
        } else {
          addDeath(target, 'wolf_kill', this.players[wolfVoters[0]]);
        }
      }
    });

    // Notify wolf team
    for (const wolfId of wolfVoters) {
      await this.dm(wolfId, `🐺 Kawanan memutuskan memburu ${victim.username}.`);
    }
    
    this.lilWolvyKilled = false;
  }
}

async processKills(deaths, events) {
  // Check for peaceful night first
  if (this.peacefulNight) {
    await this.broadcast("🕊️ **MALAM DAMAI** - Blacksmith telah menciptakan perisai spiritual yang melindungi seluruh desa dari kekerasan!");
    this.peacefulNight = false; // PERBAIKAN: Reset flag
    
    // Only process protections and non-violent actions
    await this.processProtections();
    
    // Reset Harlot status
    Object.values(this.players).forEach(p => {
      if (p.role === 'Harlot') {
        p.visitTarget = null;
        p.isHome = true;
      }
    });
    
    return; // No kills during peaceful night
  }
  
  // Track processed targets to prevent duplicates
  const processedTargets = new Set();
  
  // Helper function to add deaths safely without duplicates
  const addDeath = (victim, method, killer = null, targetId = null) => {
    if (!processedTargets.has(victim.id)) {
      processedTargets.add(victim.id);
      victim.alive = false;
      victim.lastKillMethod = method;
      deaths.push({
        victim,
        method,
        killer,
        targetId: targetId || victim.id
      });
    }
  };
  
  // Reset Harlot home status based on visit
  Object.values(this.players).forEach(p => {
    if (p.role === 'Harlot') {
      p.isHome = !p.visitTarget;
    }
    // Increment cannibal hunger
    if (p.role === 'Cannibal' && p.alive) {
      p.hungerStack = Math.min(5, p.hungerStack + 1);
    }
  });

  // Process all kills
  await this.processWolfKills(addDeath, events);
  await this.processBanditKills(addDeath, events);
  await this.processOtherKills(addDeath, events, processedTargets); // Pass processedTargets
  await this.processHarlotVisits(addDeath, events, processedTargets); // Pass processedTargets
  
  // Process all death effects after all kills are determined
  await this.processDeathEffects(deaths, events);
  
  // Reset Harlot status for next night
  Object.values(this.players).forEach(p => {
    if (p.role === 'Harlot') {
      p.visitTarget = null;
      p.isHome = true;
    }
  });
}

  // 2. NEW: Separate method for processing other individual kills
  async processOtherKills(addDeath, events, processedTargets) {
    const individualKillActions = ['serial_kill', 'cannibalize', 'shoot'];
    
    Object.entries(this.actions).forEach(([playerId, action]) => {
      if (individualKillActions.includes(action.action)) {
        const killer = this.players[playerId];
        if (!killer || !killer.alive) return; // TAMBAHAN: Safety check
        
        if (action.action === 'cannibalize' && action.targets) {
          // Handle multiple cannibal targets
          action.targets.forEach(targetId => {
            const target = this.players[targetId];
            if (target && target.alive && !this.protectedPlayers.has(targetId) && !processedTargets.has(targetId)) {
              if (target.role === 'Harlot' && !target.isHome) {
                const visitedPlayer = this.players[target.visitTarget];
                if (visitedPlayer && visitedPlayer.role === 'Hercules' && visitedPlayer.alive) {
                  events.push(`💪 Kekuatan Hercules melindungi ${target.username} dari kanibal...`);
                  return;
                } else {
                  events.push(`💋 Harlot tidak ada di rumah saat kanibal datang...`);
                  return;
                }
              }
              
              if (!this.hasKillImmunity(target, [{killer: playerId, method: 'cannibalize'}])) {
                addDeath(target, 'cannibalize', killer);
              }
            }
          });
        } else {
          // Handle single target kills
          const targetId = action.target;
          const target = this.players[targetId];
          
          if (target && target.alive && !this.protectedPlayers.has(targetId) && !processedTargets.has(targetId)) {
            if (target.role === 'Harlot' && !target.isHome) {
              const visitedPlayer = this.players[target.visitTarget];
              if (visitedPlayer && visitedPlayer.role === 'Hercules' && visitedPlayer.alive) {
                events.push(`💪 Kekuatan Hercules melindungi ${target.username}...`);
                return;
              } else {
                events.push(`💋 Harlot tidak ada di rumah saat pembunuh datang...`);
                return;
              }
            }
            
            if (!this.hasKillImmunity(target, [{killer: playerId, method: action.action}])) {
              addDeath(target, action.action, killer);
            }
          }
        }
      }
    });
  }

async processDeathEffects(deaths, events) {
  deaths.forEach(death => {
    const victim = death.victim;
    const targetId = death.targetId;
    
    // Lover death chain
    if (victim.isLover && victim.lover) {
      const lover = this.players[victim.lover];
      if (lover && lover.alive) {
        lover.alive = false;
        lover.lastKillMethod = 'heartbreak';
        deaths.push({
          victim: lover,
          method: 'heartbreak',
          targetId: lover.id
        });
        events.push(`💔 ${lover.username} mati karena patah hati kehilangan ${victim.username}...`);
      }
    }
    
    // Wild Child mentor death transformation
    const wildChildren = Object.values(this.players).filter(p => 
      p.alive && p.role === 'Wild Child' && p.mentor === targetId && !p.hasTransformed
    );
    
    wildChildren.forEach(wildChild => {
      wildChild.role = 'Werewolf';
      wildChild.team = 'Jahat';
      wildChild.aura = 'Evil';
      wildChild.hasTransformed = true;
      events.push(`🌙 ${wildChild.username} kehilangan mentor dan berubah menjadi serigala...`);
      this.dm(wildChild.id, `👶➡️🐺 **TRANSFORMASI!** Mentormu mati! Kamu berubah menjadi **Werewolf**!`);
    });
    
    // Doppelganger inheritance
    const doppelgangers = Object.values(this.players).filter(p => 
      p.role === 'Doppelganger' && p.alive && p.originalTarget === targetId
    );

    doppelgangers.forEach(doppel => {
      const inheritedRole = victim.role;
      doppel.role = inheritedRole;
      doppel.team = victim.team;
      doppel.aura = victim.aura;
      
      events.push(`🎭 ${doppel.username} mengambil alih identitas ${victim.username}...`);
      this.dm(doppel.id, `🎭 **TRANSFORMASI!** Kamu mewarisi role **${inheritedRole}**!`);
      this.initializeRoleProperties(doppel.id, inheritedRole);
    });
  });
  
  // Check Traitor activation
  const aliveWolves = this.alivePlayers().filter(p => 
    this.isWolfTeam(p) && this.isWolfRole(p.role) && p.role !== 'Traitor' // PERBAIKAN: Exclude traitors
  );

  if (aliveWolves.length === 0) {
    const traitors = this.alivePlayers().filter(p => p.role === 'Traitor' && !p.isActivated);
    traitors.forEach(traitor => {
      traitor.role = 'Werewolf';
      traitor.team = 'Jahat';
      traitor.aura = 'Evil';
      traitor.isActivated = true;
      events.push(`🌑 ${traitor.username} menunjukkan sifat asli sebagai pengkhianat...`);
      this.dm(traitor.id, `🐍➡️🐺 **PENGKHIANATAN!** Kamu menjadi **Werewolf**!`);
    });
  }
  
  // Prayer skill transformation
  Object.values(this.players).forEach(prayer => {
    if (prayer.role === 'Prayer' && prayer.alive && prayer.lastPrayerTarget) {
      const prayedTarget = this.players[prayer.lastPrayerTarget];
      
      if (prayedTarget && !prayedTarget.alive) {
        const aura = prayedTarget.aura;
        let newSkill = null;
        
        switch (aura) {
          case 'Good': newSkill = 'protect'; break;
          case 'Evil': newSkill = 'kill'; break;
          case 'Unknown': newSkill = 'reveal'; break;
        }
        
        if (newSkill && prayer.currentSkill === 'pray') {
          prayer.currentSkill = newSkill;
          prayer.skillUsed = false;
          
          events.push(`🤲 Doa ${prayer.username} berubah menjadi kekuatan ${newSkill}...`);
          this.dm(prayer.id, `🤲 **DOA TERKABUL!** Skill berubah: **${newSkill}**!`);
        }
        prayer.lastPrayerTarget = null;
      }
    }
  });
  
  // Wolf Trickster appearance steal
  Object.entries(this.actions).forEach(([playerId, action]) => {
    if (action.action === 'mark_for_steal') {
      const trickster = this.players[playerId];
      const markedTarget = this.players[action.target];
      
      const targetDeath = deaths.find(d => d.targetId === action.target && d.method !== 'wolf_kill');
      
      if (targetDeath && trickster && trickster.alive) {
        trickster.stolenRole = markedTarget.role;
        trickster.stolenUsername = markedTarget.username;
        this.dm(playerId, `🎭 **PENCURIAN BERHASIL!** Kamu mencuri penampilan ${markedTarget.username}!`);
      }
    }
  });
}

  // 5. UPDATED hasKillImmunity with Hercules and Guardian Wolf
 hasKillImmunity(target, killers) {
  // Hercules immunity
  if (target.role === 'Hercules') {
    target.attacksReceived = (target.attacksReceived || 0) + 1;
    if (target.attacksReceived < target.maxAttacks) {
      this.broadcast(`💪 **KEKUATAN HERCULES!** ${target.username} bertahan dari serangan! (${target.attacksReceived}/${target.maxAttacks})`);
      return true;
    } else {
      this.broadcast(`💔 **HERCULES TUMBANG!** Serangan kedua mengalahkan ${target.username}!`);
      return false;
    }
  }
  
  // Serial Killer immunity with Guardian Wolf protection check
  if (target.role === 'Serial Killer') {
    const wolfAttack = killers.find(k => k.method === 'wolf_kill');
    if (wolfAttack) {
      // Check for Guardian Wolf protection
      const guardianWolves = Object.values(this.players).filter(p => 
        p.alive && p.role === 'Guardian Wolf' && !p.guardianProtectionUsed
      );
      
      if (guardianWolves.length > 0) {
        const guardian = guardianWolves[0];
        guardian.guardianProtectionUsed = true;
        guardian.canProtectPack = false;
        this.broadcast(`🛡️🐺 **PERLINDUNGAN GUARDIAN WOLF!** ${guardian.username} menyelamatkan kawanan dari Serial Killer!`);
        return true;
      }
      
      // Normal Serial Killer counter-attack
      const wolf = this.players[wolfAttack.killer];
      if (wolf && wolf.alive) {
        wolf.alive = false;
        wolf.lastKillMethod = 'serial_counter';
        this.broadcast(`🔪 Serial Killer membunuh balik ${wolf.username}!`);
      }
      return true;
    }
  }
  
  // Other immunities
  if (['Cannibal', 'Bandit', 'Evil Detective'].includes(target.role)) {
    const wolfAttack = killers.find(k => k.method === 'wolf_kill');
    if (wolfAttack) return true;
  }
  
  return false;
}

 async processHarlotVisits(addDeath, events, processedTargets) {
  const harlots = Object.values(this.players).filter(p => 
    p.role === 'Harlot' && p.alive && p.visitTarget && !p.isHome && !processedTargets.has(p.id)
  );
  
  harlots.forEach(harlot => {
    const visitedPlayer = this.players[harlot.visitTarget];
    
    // Special case: Visiting Hercules gets protection
    if (visitedPlayer && visitedPlayer.role === 'Hercules' && visitedPlayer.alive) {
      events.push(`💪💕 Harlot mendapat perlindungan hangat dari kekuatan Hercules...`);
      this.protectedPlayers.add(harlot.id);
      return;
    }
    
    // Check if visited player is dangerous
    const isKillerTonight = visitedPlayer && (
      this.isWolfTeam(visitedPlayer) || // PERBAIKAN: Gunakan helper
      ['Serial Killer', 'Bandit', 'Accomplice', 'Arsonist', 'Cannibal', 'Evil Detective'].includes(visitedPlayer.role) ||
      Object.entries(this.actions).some(([killerId, action]) => 
        killerId === visitedPlayer.id && 
        ['wolf_kill', 'serial_kill', 'bandit_kill', 'accomplice_kill', 'cannibalize', 'ignite', 'prayer_kill'].includes(action.action)
      )
    );
    
    if (isKillerTonight) {
      addDeath(harlot, 'wrong_visit');
      events.push(`💋 Harlot mengunjungi rumah yang salah dan menjumpai ajal...`);
    }
  });
}

  async processSpecialActions(deaths, events) {
    Object.entries(this.actions).forEach(async ([playerId, action]) => {
      const player = this.players[playerId];
      if (!player || !player.alive) return;
      
      // During peaceful night, skip violent actions
      if (this.peacefulNight) {
        const violentActions = ['poison', 'ignite', 'chemist_duel', 'evil_investigate', 'prayer_kill'];
        if (violentActions.includes(action.action)) {
          return; // Skip violent actions during peaceful night
        }
      }
      
      switch (action.action) {
        case 'heal':
          // Heal still works during peaceful night
          const wolfVictim = deaths.find(d => d.method === 'wolf_kill');
          if (wolfVictim) {
            const healedIndex = deaths.findIndex(d => d === wolfVictim);
            if (healedIndex !== -1) {
              const healed = deaths.splice(healedIndex, 1)[0];
              healed.victim.alive = true;
              events.push(`💚 Sebuah ramuan menyembuhkan luka yang mematikan...`);
            }
          }
          break;
          
        case 'poison':
          if (!this.peacefulNight) {
            const target = this.players[action.target];
            if (target && target.alive) {
              target.alive = false;
              target.lastKillMethod = 'poison';
              deaths.push({
                victim: target,
                killer: player,
                method: 'poison',
                targetId: action.target
              });
            }
          }
          break;
          
        case 'ignite':
          if (!this.peacefulNight) {
            this.dousedPlayers.forEach(targetId => {
              const target = this.players[targetId];
              if (target && target.alive && !this.protectedPlayers.has(targetId)) {
                target.alive = false;
                target.lastKillMethod = 'ignite';
                deaths.push({
                  victim: target,
                  killer: player,
                  method: 'ignite',
                  targetId
                });
              }
            });
            this.dousedPlayers.clear();
          }
          break;
          
        case 'revive':
          // Angel revive still works during peaceful night
          const revived = this.players[action.target];
          if (revived && !revived.alive) {
            revived.alive = true;
            player.alive = false;
            player.lastKillMethod = 'sacrifice';
            deaths.push({
              victim: player,
              method: 'sacrifice',
              targetId: playerId
            });
            events.push(`😇 Cahaya suci membangkitkan yang telah tiada...`);
          }
          break;
          
        case 'chemist_duel':
          if (!this.peacefulNight) {
            const victim = Math.random() < 0.5 ? player : this.players[action.target];
            if (victim && victim.alive) {
              victim.alive = false;
              victim.lastKillMethod = 'chemist_duel';
              deaths.push({
                victim,
                method: 'chemist_duel',
                targetId: victim.id
              });
            }
          }
          break;
          
          case 'evil_investigate':
            if (!this.peacefulNight) {
              const [target1Id, target2Id] = action.targets;
              const t1 = this.players[target1Id];
              const t2 = this.players[target2Id];
              
              if (t1 && t2 && t1.team !== t2.team) {
                // FIXED: Evil Detective dies if they investigate themselves against different team
                const toKill = t1.id === playerId ? t1 : t2; // Evil Detective dies if they're target 1
                if (toKill.alive) {
                  toKill.alive = false;
                  toKill.lastKillMethod = 'evil_investigate';
                  deaths.push({ 
                    victim: toKill, 
                    killer: player,
                    method: 'evil_investigate', 
                    targetId: toKill.id 
                  });
                }
              } else if (t1 && t2) {
                await this.dm(playerId, `🕵️‍♂️💹 Keduanya adalah tim **${t1.team}**.`);
              }
            }
            break;
          
        case 'recruit':
          // Recruitment still works during peaceful night
          const recruit = this.players[action.target];
          if (recruit && recruit.role === 'Villager') {
            recruit.role = 'Accomplice';
            recruit.team = 'Netral';
            recruit.aura = 'Unknown';
            player.accomplice = recruit.id;
            await this.dm(recruit.id, `💢 **DIREKRUT!** Kamu sekarang adalah Accomplice dari ${player.username}!`);
          } else if (recruit && recruit.team === 'Jahat' && !this.peacefulNight) {
            recruit.alive = false;
            recruit.lastKillMethod = 'bandit_kill';
            deaths.push({
              victim: recruit,
              killer: player,
              method: 'bandit_kill',
              targetId: action.target
            });
          }
          break;
          
        case 'prayer_kill':
          if (!this.peacefulNight) {
            const target = this.players[action.target];
            if (target && target.alive && !this.protectedPlayers.has(action.target)) {
              target.alive = false;
              target.lastKillMethod = 'prayer_kill';
              deaths.push({
                victim: target,
                killer: player,
                method: 'prayer_kill',
                targetId: action.target
              });
            }
          }
          break;
      }
    });
  }

  async generateMorningNarrative(deaths, events) {
    let narrative = `🌅 **FAJAR MENYINGSING DI ELDERMOOR** 🌅\n\n`;
    
    if (deaths.length === 0 && events.length === 0) {
      narrative += `*Malam berlalu dengan tenang tanpa tumpahan darah...*`;
    } else {
      narrative += `*Malam meninggalkan jejak kematian...*\n\n`;
      
      // Individual death narratives based on revelation mode
      for (const death of deaths) {
        narrative += this.generateDeathNarrative(death) + '\n\n';
      }
      
      // Special events
      events.forEach(event => {
        narrative += event + '\n\n';
      });
    }
    
    await this.broadcast(narrative.trim());
  }

generateDeathNarrative(death) {
  const { victim, method, killer } = death;
  const role = victim.role;
  const revelationInfo = this.getRevelationInfo(victim);
  
  // Get appropriate narrative based on revelation mode
  let deathMessage = this.getDeathMessageByMode(victim, method);
  
  return deathMessage + revelationInfo;
}

getDeathMessageByMode(victim, method) {
  switch (this.revelationMode) {
    case 'HIDDEN':
      return this.getSimpleDeathMessage(victim, method);
    case 'AURA_ONLY':
      return this.getAuraBasedDeathMessage(victim, method);
    case 'PROGRESSIVE':
      if (this.day <= 2) {
        return this.getSimpleDeathMessage(victim, method);
      } else {
        return this.getMythologicalDeathMessage(victim, method);
      }
    case 'FULL':
    default:
      return this.getMythologicalDeathMessage(victim, method);
  }
}

getSimpleDeathMessage(victim, method) {
  const simpleMessages = {
    'wolf_kill': [
      `💀 ${victim.username} ditemukan terkoyak di pinggir hutan gelap.`,
      `🌙 Jejak cakar raksasa tercetak di tanah berdarah di sekitar jasad ${victim.username}.`,
      `🐺 ${victim.username} menjadi mangsa kegelapan yang mengintai di balik pepohonan.`
    ],
    'poison': [
      `☠️ ${victim.username} ditemukan biru membeku dengan busa hijau di mulut.`,
      `🧪 Tubuh ${victim.username} kejang-kejang terakhir masih tercetak di wajahnya yang mengerikan.`,
      `💀 ${victim.username} meninggal dalam penderitaan yang tak terbayangkan.`
    ],
    'vote': [
      `⚖️ ${victim.username} digantung oleh keputusan rakyat yang murka.`,
      `🎭 Tali gantung mengayun membawa ${victim.username} ke alam baka.`,
      `⚰️ Keadilan rakyat telah berbicara - ${victim.username} menghembuskan napas terakhir.`
    ],
    'shoot': [
      `🔫 ${victim.username} tewas tertembak di tengah kegelapan malam.`,
      `💥 Peluru menembus jantung ${victim.username} dengan akurasi mematikan.`,
      `🎯 ${victim.username} roboh tanpa sempat berteriak.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dalam kobaran api misterius.`,
      `🌋 Api menjilat tubuh ${victim.username} hingga menjadi abu.`,
      `💨 Asap hitam membubung saat ${victim.username} dilahap api.`
    ],
    'cannibalize': [
      `🖤 ${victim.username} dimangsa dengan kejam oleh predator buas.`,
      `🦴 Tulang-belulang ${victim.username} berserakan mengerikan.`,
      `💀 ${victim.username} menjadi santapan malam yang mengenaskan.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} menjadi korban pembunuh berantai yang sadis.`,
      `🗡️ Luka tusukan beruntun menghiasi tubuh ${victim.username}.`,
      `⚔️ ${victim.username} dibantai dengan ritual mengerikan.`
    ],
    'heartbreak': [
      `💔 ${victim.username} tidak sanggup hidup tanpa kekasihnya.`,
      `😢 Air mata terakhir ${victim.username} mengalir saat nyawanya melayang.`,
      `👫 Cinta yang terlalu dalam membawa ${victim.username} menyusul sang kekasih.`
    ]
  };
  
  const messages = simpleMessages[method] || [`💀 ${victim.username} ditemukan tak bernyawa dalam keadaan misterius.`];
  return messages[Math.floor(Math.random() * messages.length)];
}

getAuraBasedDeathMessage(victim, method) {
  const aura = victim.aura;
  const auraMessages = {
    'Good': {
      'wolf_kill': [
        `✨ Cahaya suci ${victim.username} padam ditelan kegelapan hutan.`,
        `🕊️ Jiwa murni ${victim.username} tercabik oleh taring kegelapan.`,
        `⭐ Bintang terang ${victim.username} jatuh ke dalam bayangan gelap.`
      ],
      'vote': [
        `😇 Malaikat ${victim.username} dihakimi oleh manusia fana.`,
        `🌟 Cahaya ${victim.username} padam oleh keputusan yang keliru.`,
        `👼 Jiwa suci ${victim.username} naik ke surga melalui tali gantungan.`
      ]
    },
    'Evil': {
      'wolf_kill': [
        `👹 Kegelapaan ${victim.username} ditelan oleh kegelapan yang lebih besar.`,
        `🔥 Api neraka ${victim.username} padam di genangan darahnya sendiri.`,
        `😈 Iblis ${victim.username} kembali ke jurang maut.`
      ],
      'vote': [
        `⚫ Bayangan gelap ${victim.username} akhirnya diusir dari dunia.`,
        `🌑 Kegelapan ${victim.username} sirna ditelan fajar keadilan.`,
        `👿 Monster ${victim.username} dikalahkan oleh persatuan warga.`
      ]
    },
    'Unknown': {
      'wolf_kill': [
        `❓ Sosok misterius ${victim.username} terkoyak tanpa mengungkap identitasnya.`,
        `🌫️ Misteri ${victim.username} terbawa angin malam bersamaan dengan nyawanya.`,
        `🎭 Topeng ${victim.username} tetap terpasang hingga napas terakhir.`
      ],
      'vote': [
        `🔍 Teka-teki ${victim.username} tak terpecahkan hingga ajal menjemput.`,
        `🌪️ Badai rahasia ${victim.username} reda bersama detik terakhir hidupnya.`,
        `🗿 Sphinx ${victim.username} membawa rahasianya ke liang kubur.`
      ]
    }
  };
  
  const messages = auraMessages[aura]?.[method] || this.getSimpleDeathMessage(victim, method);
  if (Array.isArray(messages)) {
    return messages[Math.floor(Math.random() * messages.length)];
  }
  return messages;
};

getMythologicalDeathMessage(victim, method) {
  // Taruh getMythologicalDeathMessage disini
  const role = victim.role;
  
    // ALL death methods that can occur in the game
  const allDeathMethods = [
    'wolf_kill', 'vote', 'poison', 'shoot', 'ignite', 'cannibalize', 'serial_kill', 
    'chemist_duel', 'heartbreak', 'hunter_revenge', 'evil_investigate', 'bandit_kill', 
    'accomplice_kill', 'sacrifice', 'admin_kill', 'judge_execution', 'justice_backfire'
  ];
  
  // COMPREHENSIVE DEATH NARRATIVES - Every role gets every applicable death method
  const mythologicalMessages = 
      {
        'Seer': {
      'wolf_kill': [
        `🔮 ${victim.username}, Pewaris Oracle Kuno, tewas dengan mata yang masih menatap masa depan. Kristal suci pecah bersamaan dengan tengkoraknya, dan visi terakhir tentang kemenangan kebaikan tenggelam dalam lautan darah.`,
        `👁️ Mata ketiga ${victim.username} yang pernah menembus tabir realitas kini tertutup selamanya. Darah Oracle mengalir ke tanah suci, mengutuk Eldermoor dengan kebutaan spiritual.`
      ],
      'vote': [
        `⚖️ Tragedi terbesar Eldermoor terukir hari ini - ${victim.username} sang Oracle digantung oleh orang-orang yang seharusnya ia selamatkan. Mata batinnya menutup dengan air mata darah.`,
        `🔮 Ironi takdir menghantam ketika ${victim.username}, si pembaca masa depan, tidak dapat melihat kematiannya sendiri di ujung tali gantung.`
      ],
      'poison': [
        `☠️ Racun mengalir dalam darah ${victim.username}, membakar visi sucinya dari dalam. Mata Oracle berubah hitam sebelum cahaya terakhir padam.`,
        `🧪 ${victim.username} kejang dalam agoní racun, visi terakhirnya adalah bayangan kematian yang mengejek kemampuan meramalnya.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} dengan akurasi yang mengejek kemampuan prediksinya. Bola kristal pecah bersamaan dengan nyawanya.`,
        `💥 ${victim.username} roboh dengan mata terbelalak - bahkan Oracle tidak bisa melihat peluru yang datang dalam kegelapan.`
      ],
      'ignite': [
        `🔥 Api membakar ${victim.username} beserta kristal ramalannya. Asap yang mengepul membawa visi-visi masa depan yang tidak akan pernah terwujud.`,
        `🌋 ${victim.username} terbakar sambil berteriak ramalan terakhir yang tenggelam dalam jeritan kesakitan.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai dengan ritual mengerikan. Mata Oracle yang pernah melihat kebenaran kini dipotong dan disimpan sebagai trofi.`,
        `🗡️ Serial killer mengukir runic symbols di tubuh ${victim.username}, mengejek kemampuan meramal dengan menciptakan ramalan kematian.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang salah dalam duel kimia. Visi terakhirnya adalah melihat masa depan dimana ia memilih ramuan yang benar.`,
        `⚗️ Oracle ${victim.username} mati karena tidak bisa melihat kandungan ramuan. Kemampuan supernaturalnya tidak berlaku untuk ilmu kimia.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena cinta, sesuatu yang tidak pernah bisa ia ramalkan. Hati Oracle berhenti berdetak mengikuti kekasih yang telah tiada.`,
        `😢 Air mata terakhir ${victim.username} bercampur dengan darah dari mata batinnya yang pecah karena kesedihan.`
      ],
      'hunter_revenge': [
        `🏹 Panah Hunter menancap tepat di mata ketiga ${victim.username}. Pemburu legendaris berhasil membutakan Oracle untuk selamanya.`,
        `🎯 ${victim.username} terseret ke alam baka oleh Hunter yang enggan mati sendirian, membawa visi masa depan bersamanya.`
      ],
      'evil_investigate': [
        `🕵️‍♂️💹 ${victim.username} terbunuh dalam investigasi gelap. Oracle yang biasa melihat kebenaran justru menjadi korban kebohongan.`,
        `🔍 Mata batin ${victim.username} tidak mampu melihat niat jahat si penyelidik korup hingga terlambat.`
      ],
      'bandit_kill': [
        `🥷 ${victim.username} dibunuh perampok yang tidak percaya pada ramalan. Darah Oracle mengalir sia-sia tanpa ada yang mendengar peringatan terakhirnya.`,
        `💰 Bandit membunuh ${victim.username} untuk merebut kristal suci, tidak tahu bahwa kekuatan ramalan tidak bisa dicuri.`
      ],
      'accomplice_kill': [
        `💢 ${victim.username} dibunuh kaki tangan yang iri pada kemampuan melihat masa depan. Oracle mati dengan mata terbuka menatap pembunuhnya.`,
        `🗡️ Accomplice menghabisi ${victim.username} dalam serangan mendadak, takut ramalannya membongkar rencana jahat mereka.`
      ],
      'sacrifice': [
        `😇 ${victim.username} mengorbankan visi masa depannya untuk menyelamatkan orang lain. Mata Oracle menutup dengan damai setelah melihat masa depan yang cerah.`,
        `✨ Oracle ${victim.username} mati dalam pengorbanan suci, memberikan cahaya terakhirnya untuk membangkitkan yang telah tiada.`
      ],
      'judge_execution': [
        `⚖️ ${victim.username} dieksekusi oleh Judge yang salah menilai. Ironi pahit ketika pembaca takdir dihakimi oleh keadilan buta.`,
        `🏛️ Eksekusi ${victim.username} menjadi kesalahan terbesar dalam sejarah peradilan Eldermoor. Darah Oracle menodai palu keadilan.`
      ],
      'justice_backfire': [
        `⚖️ ${victim.username} mati akibat keadilan yang membalik. Oracle yang selalu melihat kebenaran justru menjadi korban ketidakadilan.`,
        `💥 Justice backfire menghantam ${victim.username} yang tidak bersalah. Mata batin Oracle menutup dengan kepahitan.`
      ]
    },

    'Detective': {
      'wolf_kill': [
        `🕵️ ${victim.username}, mantan agen kerajaan, tewas dengan berkas investigasi berlumuran darah. Serigala telah menghapus jejak terakhir yang mengarah pada identitas mereka.`,
        `🔍 Kaca pembesar ${victim.username} pecah ketika cakar serigala menembus dadanya. Investigasi terakhir berakhir dengan kematian si penyidik.`
      ],
      'vote': [
        `🕵️ ${victim.username} digantung setelah investigasinya dianggap fitnah. Detective yang selalu mencari kebenaran mati dalam ketidakadilan.`,
        `⚖️ Ironi menghantam ketika ${victim.username} yang selalu membongkar kebohongan justru tidak dipercaya hingga ajal menjemput.`
      ],
      'poison': [
        `🧪 Racun membunuh ${victim.username} dari dalam, membakar instingnya yang tajam. Detective mati sambil mencoba menganalisis jenis racun yang membunuhnya.`,
        `☠️ ${victim.username} mati dengan notebook investigasi di tangannya, mencatat gejala keracunan hingga detik terakhir.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} di tengah investigasi. Detective legendaris roboh dengan berkas kasus yang tak akan pernah selesai.`,
        `💥 ${victim.username} tertembak saat menguntit tersangka. Investigator ulung menjadi korban dalam misi terakhirnya.`
      ],
      'ignite': [
        `🔥 Api membakar ${victim.username} beserta semua berkas investigasinya. Kebenaran yang dikumpulkan selama bertahun-tahun lenyap dalam kobaran.`,
        `🌋 ${victim.username} terbakar sambil melindungi bukti-bukti penting. Detective sejati sampai nafas terakhir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh serial killer yang ia buru. Investigator menjadi korban dalam permainan kucing-tikus yang mematikan.`,
        `🗡️ Serial killer mengalahkan ${victim.username} dengan kekejaman yang melampaui metode investigasi apapun.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} tewas dalam eksperimen kimia. Detective yang biasa menganalisis bukti fisik tidak siap menghadapi sains yang mematikan.`,
        `⚗️ Instingt investigasi ${victim.username} gagal membaca kandungan ramuan beracun yang dipilihnya.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan kekasih. Detective yang terbiasa memecahkan kasus tidak bisa menyembuhkan hatinya sendiri.`,
        `😢 Hati ${victim.username} berhenti berdetak. Bahkan investigator terbaik pun tidak kebal terhadap luka cinta.`
      ],
      'hunter_revenge': [
        `🏹 ${victim.username} dibawa mati oleh Hunter. Dua pemburu kebenaran bertemu di alam baka.`,
        `🎯 Panah Hunter menemukan sasarannya. ${victim.username} mati dalam solidaritas antar penegak kebenaran.`
      ],
      'evil_investigate': [
        `🕵️‍♂️💹 ${victim.username} terbunuh oleh sesama detective yang korup. Investigator baik kalah dari investigator jahat.`,
        `🔍 Duel antara dua detective berakhir dengan kematian ${victim.username}. Kegelapan mengalahkan cahaya dalam dunia investigasi.`
      ],
      'bandit_kill': [
        `🥷 ${victim.username} dibunuh perampok yang takut terbongkar. Detective mati setelah mengumpulkan cukup bukti untuk menangkap Bandit.`,
        `💰 Bandit menghabisi ${victim.username} untuk menghilangkan saksi mata. Investigasi terakhir berakhir dengan pembunuhan.`
      ]
    },

    'Guardian Angel': {
      'wolf_kill': [
        `👼 Sayap ${victim.username} terkoyak dan berdarah. Malaikat pelindung gagal melindungi dirinya sendiri dari kegelapan.`,
        `✨ Cahaya suci ${victim.username} padam dalam genangan darah. Perlindungan ilahi hilang dari Eldermoor.`
      ],
      'vote': [
        `😢 Ironi terdalam ketika ${victim.username}, pelindung umat manusia, dihukum mati oleh mereka yang pernah ia selamatkan.`,
        `👼 Air mata langit turun ketika ${victim.username} digantung. Malaikat tidak melawan, menerima takdir dengan senyum sedih.`
      ],
      'poison': [
        `☠️ Racun mengalir dalam darah suci ${victim.username}, mengkontaminasi kemurniannya dengan kegelapan.`,
        `🧪 ${victim.username} mati dalam doa, memohon pengampunan untuk si peracun hingga napas terakhir.`
      ],
      'shoot': [
        `🔫 Peluru menembus hati ${victim.username}, tapi cahaya sucinya masih bersinar sebentar sebelum padam.`,
        `💥 ${victim.username} roboh dengan sayap terlipat, melindungi seseorang hingga detik terakhir.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar seperti pengorbanan suci. Apinya bercahaya putih sebelum berubah menjadi abu.`,
        `🌋 Malaikat ${victim.username} naik ke surga melalui api penyucian yang menyakitkan.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sambil mengampuni pembunuhnya. Darah malaikat menyucikan pisau si psikopat.`,
        `🗡️ Serial killer menangis untuk pertama kalinya saat membunuh ${victim.username}, merasakan penyesalan yang asing.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan dengan hati yang ikhlas. Malaikat menerima takdir kimia sebagai ujian terakhir.`,
        `⚗️ Guardian Angel ${victim.username} mati dengan tenang, percaya bahwa kematiannya memiliki makna ilahi.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena cinta yang terlalu murni. Hati malaikat tidak tahan melihat kekasih pergi.`,
        `😢 Air mata suci ${victim.username} jatuh seperti embun surgawi saat nyawanya melayang mengikuti sang kekasih.`
      ],
      'hunter_revenge': [
        `🏹 ${victim.username} rela dibawa mati oleh Hunter. Malaikat memahami penderitaan pemburu yang kehilangan segalanya.`,
        `🎯 Panah Hunter menembus sayap ${victim.username}. Dua jiwa suci bertemu di gerbang surga.`
      ],
      'sacrifice': [
        `😇 ${victim.username} mengorbankan diri dengan suka cita. Malaikat kembali ke surga setelah menunaikan misi terakhir.`,
        `✨ Pengorbanan ${victim.username} bercahaya seperti bintang jatuh. Malaikat mati untuk menyelamatkan orang lain.`
      ]
    },

    'Hunter': {
      'wolf_kill': [
        `🏹 ${victim.username}, pemburu monster legendaris, tewas dalam pertarungan epik melawan kawanan. Anak panah terakhir menancap di tanah berlumuran darah serigala dan manusia.`,
        `🎯 Busur ${victim.username} patah saat cakar serigala mencabik dadanya. Pemburu terakhir keturunan monster slayer gugur dalam medan tempur.`
      ],
      'vote': [
        `🏹 ${victim.username} digantung oleh warga yang tidak memahami misinya. Pemburu sejati mati dihukum oleh mereka yang ia lindungi.`,
        `🎯 Tali gantung mengakhiri perjalanan ${victim.username}. Hunter legendaris meninggal dengan panah balas dendam yang tak terlepas.`
      ],
      'poison': [
        `☠️ Racun mengalahkan ${victim.username} yang kebal terhadap gigitan monster. Pemburu ulung mati oleh senjata yang tak pernah ia duga.`,
        `🧪 ${victim.username} tewas keracunan sambil mencoba menganalisis jenis racun. Naluri Hunter bekerja hingga detik terakhir.`
      ],
      'shoot': [
        `🔫 ${victim.username} tertembak dalam duel sniper. Dua penembak jitu bertemu, hanya satu yang tersisa.`,
        `💥 Peluru lebih cepat dari panah. ${victim.username} roboh sebelum sempat melepaskan anak panah balas dendamnya.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dengan busur di tangannya. Hunter sejati memegang senjata hingga menjadi abu.`,
        `🌋 Api melahap ${victim.username} yang menolak melepaskan busur pusaka ayahnya. Pemburu mati dengan kehormatan.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh predator yang lebih kejam dari monster manapun. Hunter menjadi mangsa dalam permainan yang salah.`,
        `🗡️ Serial killer mengalahkan ${victim.username} dengan kegilaan murni yang melampaui instingt berburu.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang salah. Pemburu yang terbiasa dengan racun monster tidak paham kimia buatan manusia.`,
        `⚗️ Instingt berburu ${victim.username} gagal membaca bahaya dalam eksperimen kimia yang mematikan.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena patah hati. Pemburu yang tak pernah takut pada monster justru kalah oleh cinta.`,
        `😢 Hati Hunter ${victim.username} berhenti berdetat mengikuti sang kekasih. Panah cinta lebih mematikan dari panah perang.`
      ],
      'evil_investigate': [
        `🕵️‍♂️💹 ${victim.username} terbunuh dalam investigasi korup. Hunter yang biasa memburu monster jadi korban penyelidik jahat.`,
        `🔍 ${victim.username} mati karena terlalu percaya pada investigasi palsu. Pemburu sejati tertipu oleh kebohongan.`
      ]
    },

    'Gunner': {
      'wolf_kill': [
        `🔫 ${victim.username}, veteran perang bersenapan suci, tewas dengan peluru perak berserakan di sekelilingnya. Senapannya masih mengepulkan asap dari pertempuran terakhir.`,
        `💥 Dentuman terakhir ${victim.username} menggema saat serigala mencabik lehernya. Penembak jitu mati dengan senjata di tangan.`
      ],
      'vote': [
        `🔫 ${victim.username} digantung dengan senapan masih terpasang di bahunya. Veteran perang mati dihakimi oleh sipil.`,
        `💥 Tali gantung mengakhiri perjalanan ${victim.username}. Penembak terbaik Eldermoor meninggal tanpa perlawanan.`
      ],
      'poison': [
        `☠️ Racun mengalir dalam darah ${victim.username} yang terbiasa dengan mesiu dan bubuk. Veteran perang mati oleh senjata kimia.`,
        `🧪 ${victim.username} tewas keracunan sambil mencoba meraih senapannya. Reflex tempur bekerja hingga napas terakhir.`
      ],
      'shoot': [
        `🔫 ${victim.username} tewas dalam duel penembak jitu. Peluru lawan lebih cepat satu detik dari miliknya.`,
        `💥 Suara dua tembakan bersamaan. Hanya ${victim.username} yang roboh dalam pertarungan sniper epik.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar bersama amunisi yang meledak. Veteran perang mati dalam kobaran api dan dentuman peluru.`,
        `🌋 Api membakar ${victim.username} yang menolak meninggalkan senapan kesayangannya. Gunner sejati sampai akhir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sebelum sempat menggunakan senapannya. Serial killer bergerak lebih cepat dari reflex veteran.`,
        `🗡️ Pisau mengalahkan peluru dalam jarak dekat. ${victim.username} mati dalam pertarungan jarak nol.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang salah. Veteran yang terbiasa dengan senjata fisik tidak paham perang kimia.`,
        `⚗️ ${victim.username} mati karena meremehkan kekuatan sains. Senapan tidak berguna melawan racun.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan kekasih. Veteran perang yang tahan peluru justru rapuh terhadap cinta.`,
        `😢 Hati Gunner ${victim.username} berhenti berdetak. Luka cinta lebih dalam dari luka peluru.`
      ]
    },

    'Harlot': {
      'wolf_kill': [
        `💋 ${victim.username}, mantan penari istana, tewas di rumah yang salah pada waktu yang salah. Takdir tragisnya terpenuhi dalam genangan darah di ambang pintu.`,
        `🌙 ${victim.username} ditemukan terkoyak di jalan menuju rumah yang ia kunjungi. Kutukan untuk selalu berada di tempat berbahaya akhirnya memakan korban.`
      ],
      'vote': [
        `💋 ${victim.username} digantung dengan tuduhan sebagai mata-mata. Harlot yang selalu mengembara mati dalam cercaan massa.`,
        `🎭 Tali gantung mengakhiri perjalanan ${victim.username} yang selalu berpindah tempat. Kaki yang lelah akhirnya berhenti.`
      ],
      'poison': [
        `☠️ ${victim.username} meminum racun yang dikira anggur manis. Mantan penari istana mati dengan anggun seperti pertunjukan terakhir.`,
        `🧪 Racun mengalir dalam tubuh ${victim.username} yang terbiasa dengan berbagai ramuan cinta. Kali ini ramuannya mematikan.`
      ],
      'shoot': [
        `🔫 ${victim.username} tertembak saat berkunjung ke rumah yang salah. Harlot yang malang selalu berada di waktu dan tempat yang berbahaya.`,
        `💥 Peluru menemukan ${victim.username} di ambang pintu. Kunjungan terakhir berakhir dengan kematian.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar di rumah yang sedang ia kunjungi. Api menjilat tubuhnya yang terbiasa dengan kehangatan cinta.`,
        `🌋 Api membakar ${victim.username} yang terjebak di rumah orang lain. Harlot mati jauh dari rumahnya sendiri.`
      ],
      'wrong_visit': [
        `💋 ${victim.username} mengunjungi rumah yang salah dan menemukan kematian di ambang pintu.`,
        `🚪 ${victim.username} mengetuk pintu yang tak seharusnya diketuk.`,
        `🌙 Langkah kaki ${victim.username} terhenti di ambang neraka.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh tuan rumah yang ternyata psikopat. Kunjungan malam berubah menjadi mimpi buruk.`,
        `🗡️ Serial killer menjadikan ${victim.username} korban di kamar yang seharusnya aman. Tempat berlindung menjadi kubur.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan dalam eksperimen mematikan. Mantan penari mati dalam pertunjukan kimia.`,
        `⚗️ ${victim.username} tewas karena salah memilih ramuan. Harlot yang biasa memilih pria kali ini salah memilih cairan.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena patah hati kehilangan kekasih sejati. Harlot yang selalu berpindah akhirnya menemukan cinta.`,
        `😢 Air mata ${victim.username} mengalir saat jantungnya berhenti. Cinta terakhir adalah cinta yang mematikan.`
      ]
    },

    'Cupid': {
      'wolf_kill': [
        `💘 ${victim.username}, anak dewa cinta, tewas dengan panah emas patah di tangannya. Serigala merobek hati yang pernah mengikat jiwa-jiwa dalam cinta abadi.`,
        `💕 Darah ${victim.username} berwarna merah muda mengalir ke tanah, dan bunga cinta yang pernah ia tanam layu bersamaan.`
      ],
      'vote': [
        `💘 ${victim.username} digantung oleh massa yang tidak memahami kekuatan cinta. Cupid mati sambil menatap lovers yang ia ciptakan.`,
        `💕 Tali gantung memisahkan ${victim.username} dari dunia fana. Dewa cinta kembali ke alam gaib dengan damai.`
      ],
      'poison': [
        `☠️ Racun membakar darah ilahi ${victim.username}. Cupid yang biasa menyebar cinta justru mati oleh kebencian.`,
        `🧪 ${victim.username} mati keracunan sambil memegang panah emas. Senjata cinta tidak berguna melawan racun.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} yang penuh cinta. Cupid roboh dengan senyum, bahagia telah menyatukan banyak jiwa.`,
        `💥 ${victim.username} tertembak sambil membidikkan panah cinta terakhirnya. Misi cinta dan maut bersamaan.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dengan panah emasnya meleleh. Api cinta berubah menjadi api yang membakar.`,
        `🌋 ${victim.username} mati dalam kobaran sambil tersenyum melihat lovers yang ia ciptakan bahagia bersama.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak pernah merasakan cinta. Cupid mati karena gagal menyembuhkan hati yang rusak.`,
        `🗡️ Serial killer membunuh ${victim.username} dengan kekejaman yang berlebihan, membenci simbol cinta yang diwakilinya.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan cinta yang ternyata beracun. Cupid tertipu oleh kimia palsu.`,
        `⚗️ Dewa cinta ${victim.username} mati dalam eksperimen. Cinta tidak bisa mengalahkan sains.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena merasakan patah hati untuk pertama kalinya. Cupid yang selalu membuat cinta justru hancur oleh cinta.`,
        `😢 Air mata ${victim.username} berwarna emas mengalir saat hatinya pecah. Dewa cinta mati oleh kekuatan ciptaannya sendiri.`
      ]
    },

    'Mason': {
      'wolf_kill': [
        `🧱 ${victim.username}, anggota persaudaraan rahasia, tewas dengan simbol Mason berlumuran darah. Serigala telah menembus benteng spiritual yang ia bangun.`,
        `⚒️ Palu Mason ${victim.username} tergeletak patah di sampingnya. Pembangun benteng suci mati dalam reruntuhan perlindungan.`
      ],
      'vote': [
        `🧱 ${victim.username} digantung meskipun sesama Mason membelanya. Persaudaraan tidak cukup kuat melawan amarah massa.`,
        `⚒️ Tali gantung mengakhiri sumpah suci ${victim.username}. Mason sejati mati dengan rahasia persaudaraan.`
      ],
      'poison': [
        `☠️ Racun menembus pertahanan spiritual ${victim.username}. Mason yang terbiasa membangun benteng fisik kalah oleh senjata kimia.`,
        `🧪 ${victim.username} mati keracunan sambil memegang batu suci. Benteng spiritual tidak melindungi dari racun.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} yang terlindungi sumpah persaudaraan. Mason mati jauh dari rekan-rekannya.`,
        `💥 ${victim.username} tertembak sambil membangun barikade terakhir. Tukang batu mati dalam pekerjaan.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar bersama batu-batu suci yang ia susun. Mason mati dalam kehancuran benteng spiritual.`,
        `🌋 Api membakar ${victim.username} yang menolak meninggalkan altar persaudaraan. Loyalitas sampai mati.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai dengan pahat batu yang ia miliki. Serial killer menggunakan alat Mason untuk membunuhnya.`,
        `🗡️ ${victim.username} mati dibunuh dengan ritual yang mengejek sumpah persaudaraan. Kekejaman melawan kesucian.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang salah. Mason yang terbiasa dengan bahan bangunan tidak paham kimia.`,
        `⚗️ ${victim.username} mati dalam eksperimen. Batu dan mortar tidak berguna melawan racun.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan rekan sesama Mason. Persaudaraan yang kuat membuatnya tidak tahan kehilangan.`,
        `😢 Hati ${victim.username} hancur melihat kekasihnya mati. Bahkan sumpah persaudaraan tidak bisa menyembuhkan luka cinta.`
      ]
    },

    'Angel': {
      'wolf_kill': [
        `😇 ${victim.username}, malaikat yang kehilangan sayap, tewas dengan cahaya suci yang meredup. Serigala telah mengalahkan utusan surgawi terakhir.`,
        `✨ Tubuh ${victim.username} hancur berkeping-keping saat serigala menyerangnya. Malaikat mati dalam penderitaan seperti manusia biasa.`
      ],
      'vote': [
        `😇 ${victim.username} digantung oleh manusia yang tidak mengenali keagungannya. Angel mati dihakimi oleh mereka yang pernah ia selamatkan.`,
        `✨ Tali gantung tidak bisa mengikat jiwa ${victim.username}. Angel naik ke surga sambil mengampuni para algojo.`
      ],
      'poison': [
        `☠️ Racun fana mengalir dalam tubuh surgawi ${victim.username}. Angel merasakan penderitaan manusia untuk pertama kalinya.`,
        `🧪 ${victim.username} mati keracunan sambil berdoa untuk jiwa si peracun. Angel mengampuni hingga napas terakhir.`
      ],
      'shoot': [
        `🔫 Peluru menembus tubuh fana ${victim.username}. Angel yang kehilangan sayap juga kehilangan kekebalan surgawi.`,
        `💥 ${victim.username} roboh dengan senyum damai. Angel menerima kematian sebagai akhir dari penderitaan duniawi.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar seperti pengorbanan suci. Angel kembali ke surga melalui api penyucian.`,
        `🌋 Api membakar tubuh fana ${victim.username}, membebaskan jiwa surgawinya. Angel terbang dengan sayap api.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak tahu siapa yang ia bunuh. Angel mati mengampuni si pembunuh.`,
        `🗡️ Serial killer membunuh ${victim.username} dengan kekejaman berlebihan, tidak sadar telah membunuh malaikat.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan dengan ikhlas. Angel menerima takdir kimia sebagai ujian terakhir dari Tuhan.`,
        `⚗️ ${victim.username} mati dalam eksperimen sambil berdoa. Angel mengubah racun menjadi berkat terakhir.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena terlalu mencintai manusia. Angel yang turun ke dunia justru hancur oleh cinta fana.`,
        `😢 Air mata ${victim.username} bercahaya seperti mutiara surgawi saat hatinya berhenti berdetak.`
      ]
    },

    'Witch': {
      'wolf_kill': [
        `🧙‍♀️ ${victim.username}, pewaris penyihir putih, tewas dengan ramuan berserakan di sekelilingnya. Serigala telah menghancurkan laboratorium sihir terakhir.`,
        `🌿 Tumbuhan langka ${victim.username} layu bersamaan dengan kematiannya. Penyihir terakhir membawa rahasia ramuan ke kubur.`
      ],
      'vote': [
        `🧙‍♀️ ${victim.username} digantung dengan tuduhan sihir hitam. Witch yang selalu menyembuhkan mati dituduh sebagai penyebar kutukan.`,
        `🌿 Tali gantung mengakhiri hidup ${victim.username}. Ramuan penyembuh tumpah sia-sia dari tangannya.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan oleh ramuan buatan sendiri yang salah campur. Witch terbunuh oleh keahliannya sendiri.`,
        `🧪 Racun mengalahkan ${victim.username} yang ahli dalam segala ramuan. Bahkan master racun bisa salah langkah.`
      ],
      'shoot': [
        `🔫 Peluru lebih cepat dari mantra ${victim.username}. Witch mati sebelum sempat mengucapkan jampi pelindung.`,
        `💥 ${victim.username} tertembak sambil meracik ramuan. Darah Witch bercampur dengan ramuan terakhirnya.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar bersama lab ramuannya. Api membakar koleksi tumbuhan langka berabad-abad.`,
        `🌋 ${victim.username} mati dalam ledakan ramuan yang terbakar. Witch terakhir lenyap dalam kobaran sihir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sebelum sempat menggunakan ramuan pelindung. Serial killer bergerak terlalu cepat.`,
        `🗡️ ${victim.username} mati dengan ramuan setengah jadi di tangannya. Witch kalah oleh kecepatan pisau.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} salah memilih antara sihir dan sains. Witch yang ahli ramuan kalah oleh kimia modern.`,
        `⚗️ ${victim.username} mati karena meremehkan ilmu kimia. Sihir kuno kalah oleh sains baru.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena ramuan cinta yang gagal menyelamatkan kekasihnya. Witch ahli ramuan kalah oleh takdir.`,
        `😢 Air mata ${victim.username} jatuh ke ramuan terakhirnya, menciptakan elixir kesedihan yang mematikan.`
      ]
    },

    'The Chemist': {
      'wolf_kill': [
        `🧑‍🔬 ${victim.username}, ilmuwan gila yang kehilangan kewarasan, tewas dengan tabung reaksi pecah berserakan. Serigala menghancurkan lab eksperimen terakhirnya.`,
        `⚗️ Ramuan eksperimen ${victim.username} tumpah bercampur darahnya. Mad scientist mati dalam kekacauan yang ia ciptakan sendiri.`
      ],
      'vote': [
        `🧑‍🔬 ${victim.username} digantung setelah eksperimennya dianggap terlalu berbahaya. Ilmuwan gila mati dihakimi sains-nya sendiri.`,
        `⚗️ Tali gantung mengakhiri kegilaan ${victim.username}. The Chemist mati sambil tertawa pada ironi takdir.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan oleh ciptaannya sendiri. Chemist yang ahli racun terbunuh oleh karya masterpiece-nya.`,
        `🧪 Racun yang dibuat ${victim.username} berbalik membunuhnya. Ironi sempurna seorang mad scientist.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} di tengah eksperimen. The Chemist mati dengan ramuan mendidih di belakangnya.`,
        `💥 ${victim.username} tertembak sambil mencampur ramuan mematikan. Darahnya bercampur dengan eksperimen terakhir.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dalam ledakan lab ratusan ramuan. The Chemist mati dalam api eksperimen sendiri.`,
        `🌋 ${victim.username} terbakar sambil tertawa melihat api yang indah. Mad scientist menikmati kehancuran sampai akhir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat lain. Dua kegilaan bertemu, satu yang lebih sadis menang.`,
        `🗡️ Serial killer membunuh ${victim.username} dengan kreativitas yang melampaui eksperimen sains.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} kalah dalam duel yang ia ciptakan sendiri. The Chemist mati oleh permainan ramuannya sendiri.`,
        `⚗️ ${victim.username} tertawa sambil minum ramuan kematian. Mad scientist mati dalam eksperimen terakhir yang sempurna.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan subjek eksperimen yang ia cintai. The Chemist kalah oleh perasaan manusiawi.`,
        `😢 Air mata ${victim.username} jatuh ke ramuan, menciptakan reaksi kimia yang mematikan dirinya sendiri.`
      ]
    },

    'Loudmouth': {
      'wolf_kill': [
        `🤬 ${victim.username}, mantan penyiar radio, tewas dengan suara terakhir yang tidak terdengar. Serigala membungkam corong kebenaran terakhir.`,
        `📢 ${victim.username} mati sambil berteriak mengungkap identitas seseorang, tapi suaranya tenggelam dalam auman serigala.`
      ],
      'vote': [
        `🤬 ${victim.username} digantung setelah terlalu banyak bicara. Loudmouth mati karena mulutnya yang tidak bisa diam.`,
        `📢 Tali gantung membungkam ${victim.username} untuk selamanya. Suara terakhir adalah jeritan kesakitan.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil mencoba berteriak meminta tolong. Racun melumpuhkan pita suaranya.`,
        `🧪 Racun membakar tenggorokan ${victim.username}. Loudmouth mati dalam keheningan yang ironis.`
      ],
      'shoot': [
        `🔫 Peluru menembus tenggorokan ${victim.username}, membungkam suaranya selamanya. Loudmouth mati tanpa bisa berteriak.`,
        `💥 ${victim.username} tertembak sambil membuka mulut untuk berteriak. Suara terakhir adalah desahan napas.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil berteriak mengungkap kebenaran. Suaranya menggema dalam kobaran api.`,
        `🌋 ${victim.username} mati dalam api sambil masih berusaha bicara. Loudmouth sampai detik terakhir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sebelum sempat berteriak. Serial killer membungkam mulut yang terlalu berisik.`,
        `🗡️ ${victim.username} mati dengan mulut terbuka, masih berusaha mengungkap kebenaran terakhir.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan sambil berteriak protesnya. Loudmouth mati sambil komplain.`,
        `⚗️ ${victim.username} mati dalam eksperimen sambil mengkritik metode The Chemist. Cerewet sampai akhir.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan seseorang yang selalu mendengarkan ocehannya. Loudmouth mati dalam kesunyian.`,
        `😢 Untuk pertama kalinya, ${victim.username} tidak bisa berkata apa-apa saat hatinya berhenti berdetak.`
      ]
    },

    'Judge': {
      'wolf_kill': [
        `🧑‍⚖️ ${victim.username}, hakim agung yang kehilangan keluarga, tewas dengan palu keadilan berlumuran darah. Serigala telah mengalahkan hukum terakhir.`,
        `⚖️ Timbangan keadilan ${victim.username} hancur bersama tengkoraknya. Judge mati tanpa bisa menegakkan keadilan terakhir.`
      ],
      'vote': [
        `🧑‍⚖️ ${victim.username} digantung oleh keputusan mayoritas. Ironi ketika hakim dihakimi oleh rakyat.`,
        `⚖️ Tali gantung menjadi keadilan terakhir bagi ${victim.username}. Judge mati oleh hukum massa.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil memegang kitab hukum. Racun tidak mengenal keadilan.`,
        `🧪 Racun mengalir dalam tubuh ${victim.username} yang selalu menegakkan kebenaran. Keadilan kalah oleh kejahatan.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} yang adil. Judge mati sebelum sempat memberikan vonis terakhir.`,
        `💥 ${victim.username} tertembak sambil mengangkat palu keadilan. Hukuman mati datang lebih dulu.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar bersama kitab hukumnya. Judge mati dalam kobaran ketidakadilan.`,
        `🌋 ${victim.username} mati dalam api sambil memegang simbol keadilan. Timbangan meleleh dalam kobaran.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh kriminal yang lolos dari keadilannya. Judge mati oleh kejahatan yang gagal ia hukum.`,
        `🗡️ Serial killer membunuh ${victim.username} dengan sadis, membalas semua hukuman yang pernah dijatuhkan.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan dengan bijak tapi tetap salah. Keadilan tidak berlaku dalam permainan kimia.`,
        `⚗️ ${victim.username} mati dalam eksperimen hukum alam. Sains mengalahkan sistem peradilan.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan kekasih yang juga korban ketidakadilan. Judge hancur oleh kegagalannya sendiri.`,
        `😢 Air mata ${victim.username} membasahi kitab hukum saat jantungnya berhenti. Keadilan mati bersama hakim.`
      ],
      'justice_backfire': [
        `⚖️ ${victim.username} mati karena keputusan hakim yang salah. Justice backfire menghantam hakim yang tidak adil.`,
        `💥 Keadilan membalik dan membunuh ${victim.username}. Judge mati oleh sistem yang ia wakili.`
      ]
    },

    'Prayer': {
      'wolf_kill': [
        `🤲 ${victim.username}, pendeta yang kehilangan iman, tewas dengan kitab doa berlumuran darah. Serigala mengalahkan doa terakhir.`,
        `📿 Tasbih ${victim.username} putus saat serigala mencabik lehernya. Prayer mati tanpa sempat berdoa terakhir.`
      ],
      'vote': [
        `🤲 ${victim.username} digantung meskipun banyak yang ia doakan. Prayer mati tidak dipedulikan doanya.`,
        `📿 Tali gantung mengakhiri doa-doa ${victim.username}. Pendeta mati dalam keheningan spiritual.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil berdoa untuk jiwa si peracun. Prayer mengampuni hingga napas terakhir.`,
        `🧪 Racun membakar tubuh ${victim.username} yang berdoa. Doa tidak bisa menetralisir racun.`
      ],
      'shoot': [
        `🔫 Peluru menembus dada ${victim.username} yang sedang berdoa. Prayer mati dalam posisi sujud.`,
        `💥 ${victim.username} tertembak sambil mengangkat tangan berdoa. Peluru lebih cepat dari doa.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil berdoa hingga akhir. Prayer mati dalam api sambil memuji Tuhan.`,
        `🌋 ${victim.username} mati dalam kobaran sambil mengucap syahadat. Api tidak memadamkan iman.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sambil berdoa untuk jiwa si pembunuh. Prayer mati sambil mengampuni.`,
        `🗡️ Serial killer membunuh ${victim.username} yang terus berdoa. Kegilaan melawan kesucian.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan sambil berdoa. Prayer menyerahkan takdir pada Tuhan.`,
        `⚗️ ${victim.username} mati dalam eksperimen sambil mengucap doa. Iman sampai detik terakhir.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan orang yang selalu ia doakan. Prayer hancur melihat doa tidak terkabul.`,
        `😢 Air mata ${victim.username} membasahi sajadah saat hatinya berhenti berdetak. Doa terakhir adalah isak tangis.`
      ]
    },

    'Werewolf': {
      'wolf_kill': [
        `🐺 Ironi kelam menyelimuti ketika ${victim.username} dibunuh oleh kawanannya sendiri. Politik serigala berakhir dengan kanibalisme supernatural.`,
        `🌙 ${victim.username} tewas dalam pertarungan dominasi kawanan. Darah serigala mengalir membasahi tanah kutukan.`
      ],
      'vote': [
        `🐺 Kutukan kuno akhirnya putus ketika ${victim.username} digantung di bawah bulan purnama. Tubuh serigala perlahan berubah kembali menjadi manusia.`,
        `🌙 Auman terakhir ${victim.username} menggema ketika tali gantung mengakhiri kutukan berabad-abad.`
      ],
      'poison': [
        `☠️ Racun wolfsbane mengalir dalam darah ${victim.username}, melawan kutukan serigala dari dalam dengan agoní yang tak terbayangkan.`,
        `🧪 ${victim.username} kejang antara wujud manusia dan serigala saat racun membakar transformasi supernaturalnya.`
      ],
      'shoot': [
        `🔫 Peluru perak menembus jantung ${victim.username}. Serigala legendaris meraung kesakitan sebelum wujud kemanusiaannya kembali.`,
        `💫 Senjata suci menemukan targetnya. Dari tubuh ${victim.username} keluar asap hitam pertanda kutukan yang terangkat.`
      ],
      'ignite': [
        `🔥 Api membakar habis ${victim.username}. Dari abu tersisa, warga menemukan jejak bulu dan taring yang meleleh.`,
        `🌋 ${victim.username} melolong dalam kobaran api, suara serigala dan manusia bercampur dalam jeritan mengerikan.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} sang Werewolf ditemukan dengan luka tusukan ritual. Ada predator lain yang lebih kejam di Eldermoor.`,
        `🗡️ Serial killer berhasil mengalahkan monster dengan kegilaan murni yang melampaui kebuasan binatang.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang mengubah transformasinya menjadi menyakitkan. Tubuh serigala berubah menjadi abomination sebelum mati.`,
        `⚗️ Kimia dan sihir bertabrakan dalam tubuh ${victim.username}, menciptakan reaksi yang menghancurkan kutukan dan jiwa sekaligus.`
      ],
      'heartbreak': [
        `💔 ${victim.username} kehilangan naluri serigala karena patah hati. Monster itu mati sebagai manusia yang kesepian.`,
        `😢 Air mata ${victim.username} bercampur darah saat jantung serigalanya berhenti berdetak mengikuti sang kekasih.`
      ],
      'hunter_revenge': [
        `🏹 Panah Hunter menancap sempurna di jantung ${victim.username}. Pemburu monster mendapat mangsa terakhirnya.`,
        `🎯 ${victim.username} dibawa mati oleh Hunter sebagai trofi terakhir dalam perang abadi antara pemburu dan mangsa.`
      ]
    },

    'Alpha Werewolf': {
      'wolf_kill': [
        `👹 ${victim.username}, raja serigala dari ritual kelam, tewas dalam pertarungan melawan kawanan pemberontak. Alpha mati dalam revolusi internal.`,
        `🌙 Darah Alpha ${victim.username} mengandung virus supernatural yang menyebar saat ia mati. Bahkan kematiannya berbahaya.`
      ],
      'vote': [
        `👹 ${victim.username} digantung oleh massa yang bersatu melawannya. Raja serigala mati dikalahkan demokrasi.`,
        `🌙 Tali gantung mengakhiri kekuasaan ${victim.username}. Alpha terakhir mati dengan martabat monster.`
      ],
      'poison': [
        `☠️ Racun khusus anti-Alpha mengalir dalam darah ${victim.username}. Raja serigala mati oleh senjata yang dirancang khusus untuknya.`,
        `🧪 ${victim.username} mati keracunan sambil berusaha menularkan kutukan terakhir. Alpha gagal menciptakan pewaris.`
      ],
      'shoot': [
        `🔫 Peluru khusus pemburu monster menembus jantung ${victim.username}. Alpha mati oleh senjata legendaris.`,
        `💥 ${victim.username} tertembak sambil mencoba mengubah si penembak. Transformasi terakhir gagal.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dalam api yang membakar kutukan ribuan tahun. Alpha mati membawa rahasia transformasi.`,
        `🌋 ${victim.username} melolong dalam kobaran, memanggil kawanan yang tidak datang. Raja serigala mati sendirian.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak takut pada Alpha. Kegilaan murni mengalahkan kekuatan supernatural.`,
        `🗡️ Serial killer membunuh ${victim.username} dengan ritual yang mengejek kekuasaan Alpha. Madness vs Monster.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang merusak DNA supernatural. Alpha mati karena sains mengalahkan sihir.`,
        `⚗️ ${victim.username} mati dalam eksperimen. Kimia modern mengalahkan kutukan kuno.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan mate yang ditakdirkan. Alpha yang perkasa hancur oleh cinta.`,
        `😢 Raja serigala ${victim.username} menangis untuk pertama kalinya sebelum mati. Cinta mengalahkan kekuatan Alpha.`
      ]
    },

    'Lycan': {
      'wolf_kill': [
        `🌙 ${victim.username}, hybrid hasil perkawinan terlarang, tewas diserang kawanan yang tidak menerimanya. Lycan mati ditolak kedua sisi.`,
        `🦴 Darah campuran ${victim.username} mengalir, terlalu manusiawi untuk serigala, terlalu buas untuk manusia.`
      ],
      'vote': [
        `🌙 ${victim.username} digantung setelah identitas hibridnya terbongkar. Lycan mati dibenci kedua ras.`,
        `🦴 Tali gantung mengakhiri penderitaan ${victim.username}. Hybrid yang tidak diterima dimana-mana akhirnya beristirahat.`
      ],
      'poison': [
        `☠️ Racun bekerja lambat dalam darah hybrid ${victim.username}. Lycan mati dalam transisi yang menyakitkan.`,
        `🧪 ${victim.username} mati keracunan sambil bertransformasi. Racun dan transformasi bertarung dalam tubuhnya.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} yang sedang berubah wujud. Lycan mati di tengah transformasi.`,
        `💥 ${victim.username} tertembak dalam wujud setengah manusia setengah serigala. Hybrid mati dalam bentuk yang mengerikan.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil melolong seperti manusia dan serigala bersamaan. Suara hybrid yang mengerikan.`,
        `🌋 Api membakar ${victim.username} yang tidak bisa memutuskan wujud mana yang ia pilih untuk mati.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang terpesona dengan anatomi hybrid. Serial killer mendapat spesimen langka.`,
        `🗡️ ${victim.username} mati dibunuh dengan sadis. Serial killer menikmati membedah makhluk setengah manusia.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang bereaksi aneh dengan DNA hybrid. Lycan mati dalam reaksi kimia yang tidak terduga.`,
        `⚗️ ${victim.username} mati karena tubuh hybridnya tidak bisa menerima racun buatan manusia.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena tidak pernah diterima oleh siapapun. Lycan mati dalam kesendirian abadi.`,
        `😢 ${victim.username} mati patah hati karena selalu berada di antara dua dunia. Hybrid yang tidak memiliki tempat.`
      ]
    },

    'Wolfman': {
      'wolf_kill': [
        `🦴 ${victim.username}, manusia yang dibesarkan serigala, tewas diserang kawanan yang tidak mengenalinya lagi. Wolfman mati ditolak keluarga angkatnya.`,
        `🌙 ${victim.username} melolong terakhir dengan suara manusia sebelum serigala mencabik lehernya. Anak angkat mati dibunuh keluarga.`
      ],
      'vote': [
        `🦴 ${victim.username} digantung karena dianggap terlalu liar. Wolfman yang baik hati mati karena penampilan menakutkan.`,
        `🌙 Tali gantung mengakhiri hidup ${victim.username} yang selalu disalahpahami. Wolfman mati tanpa pembelaan.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil mencoba mengendus racun seperti serigala. Naluri liar tidak bisa menyelamatkannya.`,
        `🧪 Racun membunuh ${victim.username} yang tubuhnya setengah kebal seperti serigala. Wolfman mati perlahan.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} yang berlari dengan gaya serigala. Wolfman mati sambil mencari tempat sembunyi.`,
        `💥 ${victim.username} tertembak sambil melolong meminta tolong. Suara setengah manusia setengah serigala.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil berlari seperti serigala terluka. Wolfman mati dengan naluri binatang.`,
        `🌋 ${victim.username} melolong dalam kobaran api. Suara terakhir adalah campuran jeritan manusia dan auman serigala.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai setelah melawan dengan kuku dan gigi. Wolfman mati bertarung seperti binatang buas.`,
        `🗡️ Serial killer membunuh ${victim.username} setelah pertarungan brutal. Kegilaan mengalahkan naluri liar.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan sambil mengendusnya seperti serigala. Naluri binatang tidak bisa membedakan racun.`,
        `⚗️ ${victim.username} mati karena mempercayai insting serigala yang salah. Wolfman tertipu oleh naluri sendiri.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena ditolak baik oleh manusia maupun serigala. Wolfman mati dalam kesepian total.`,
        `😢 ${victim.username} melolong sedih seperti serigala sebelum hatinya berhenti. Suara terakhir adalah tangisan kesendirian.`
      ]
    },

    'Cursed': {
      'wolf_kill': [
        `😾 ${victim.username}, keturunan survivor serangan serigala, tewas dengan kutukan dalam darah yang akhirnya terbangkit. Gigitan serigala membangunkan setan tidur.`,
        `🩸 Darah terkutuk ${victim.username} berubah hitam saat serigala menyerangnya. Kutukan berabad-abad akhirnya aktif di detik kematian.`
      ],
      'vote': [
        `😾 ${victim.username} digantung sebelum kutukan dalam darahnya sempat bangkit. Cursed mati masih dalam wujud manusia.`,
        `🩸 Tali gantung mengakhiri hidup ${victim.username} sebelum transformasi dimulai. Kutukan mati bersama tubuh.`
      ],
      'poison': [
        `☠️ Racun bereaksi aneh dengan darah terkutuk ${victim.username}. Cursed mati dalam agoní supernatural.`,
        `🧪 ${victim.username} mati keracunan sambil kutukan mulai mengalir. Racun dan kutukan bertarung dalam tubuhnya.`
      ],
      'shoot': [
        `🔫 Peluru menembus jantung ${victim.username} sebelum kutukan sempat mengubahnya. Cursed mati masih manusia.`,
        `💥 ${victim.username} tertembak sambil merasakan kutukan mulai bangkit. Transformasi terhenti oleh kematian.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dengan kutukan yang ikut lenyap dalam api. Fire cleanses curse and soul.`,
        `🌋 ${victim.username} mati dalam kobaran yang membakar darah terkutuk. Api membebaskannya dari warisan gelap.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai sebelum sempat berubah menjadi monster. Serial killer membunuh calon Werewolf.`,
        `🗡️ ${victim.username} mati dengan kutukan yang belum sempat bangkit. Kegilaan lebih cepat dari transformasi.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang bereaksi dengan kutukan dalam darahnya. Chemical curse reaction.`,
        `⚗️ ${victim.username} mati karena ramuan kimia memicu kutukan prematur. Sains dan sihir bertabrakan.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati patah hati sebelum kutukan bangkit. Cinta menyelamatkannya dari transformasi.`,
        `😢 ${victim.username} mati dengan darah terkutuk yang tidak sempat mengubahnya. Kesedihan mengalahkan kutukan.`
      ]
    },

    'Traitor': {
      'wolf_kill': [
        `🐍 ${victim.username}, pengkhianat yang menjual jiwa, tewas dibunuh majikannya sendiri. Serigala memakan pengkhianat yang tidak berguna lagi.`,
        `🌑 Darah kotor ${victim.username} mengalir dengan warna gelap. Traitor mati ditinggalkan kedua sisi yang ia khianati.`
      ],
      'vote': [
        `🐍 ${victim.username} digantung setelah pengkhianatannya terbongkar. Traitor mati dibenci semua pihak.`,
        `🌑 Tali gantung adalah akhir yang pantas untuk ${victim.username}. Pengkhianat mati dalam kehinaan.`
      ],
      'poison': [
        `☠️ ${victim.username} diracuni oleh teman lama yang ia khianati. Traitor mati oleh dendam masa lalu.`,
        `🧪 Racun mengalir dalam darah kotor ${victim.username}. Pengkhianat mati sendirian tanpa pertolongan.`
      ],
      'shoot': [
        `🔫 Peluru menembus punggung ${victim.username}. Traitor mati ditikam dari belakang seperti yang sering ia lakukan.`,
        `💥 ${victim.username} tertembak oleh seseorang yang pernah ia khianati. Karma mengejar pengkhianat.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dalam api neraka yang pantas untuknya. Traitor mati dalam siksaan abadi.`,
        `🌋 ${victim.username} berteriak minta tolong tapi tidak ada yang datang. Pengkhianat mati sendirian.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak suka pengkhianat. Serial killer memilih korban yang tepat.`,
        `🗡️ ${victim.username} mati dibunuh dengan kejam. Bahkan psikopat membenci pengkhianat.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang salah karena tidak ada yang membantunya. Traitor mati sendirian.`,
        `⚗️ ${victim.username} mati dalam eksperimen. Pengkhianat tidak mendapat kemurahan hati.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena tidak ada yang mencintainya setelah semua pengkhianatannya. Traitor mati kesepian.`,
        `😢 ${victim.username} menangis sendirian saat hatinya berhenti. Pengkhianat mati tanpa kasih sayang.`
      ]
    },

    'Wild Child': {
      'wolf_kill': [
        `👶 ${victim.username}, anak yatim yang dibesarkan serigala, tewas diserang kawanan yang tidak mengenalinya setelah sekian lama hidup dengan manusia.`,
        `🌲 ${victim.username} mati sambil memanggil mentornya yang sudah tiada. Wild Child mati dalam kerinduan akan figur orangtua.`
      ],
      'vote': [
        `👶 ${victim.username} digantung karena dianggap terlalu liar. Wild Child mati karena tidak bisa beradaptasi dengan masyarakat.`,
        `🌲 Tali gantung mengakhiri perjuangan ${victim.username} untuk menjadi manusia normal. Wild Child gagal berintegrasi.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan karena naluri liarnya salah mengidentifikasi racun. Wild Child tertipu instingtnya.`,
        `🧪 Racun membunuh ${victim.username} yang tubuhnya setengah kebal seperti binatang. Wild Child mati perlahan.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} yang berlari seperti binatang liar. Wild Child mati sambil mencari tempat sembunyi.`,
        `💥 ${victim.username} tertembak sambil mencoba kabur ke hutan. Wild Child mati jauh dari alam bebas.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil melolong seperti serigala kecil. Wild Child mati dengan suara yang memilukan.`,
        `🌋 ${victim.username} mati dalam kobaran sambil mencari mentornya. Api membakar kerinduan terakhir.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai setelah melawan dengan naluri binatang. Wild Child mati bertarung seperti anak serigala.`,
        `🗡️ Serial killer membunuh ${victim.username} yang terlalu polos dan percaya. Kegilaan mengalahkan kepolosan.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan dengan naluri binatang yang salah. Wild Child tertipu oleh insting liar.`,
        `⚗️ ${victim.username} mati karena tidak paham cara kerja racun buatan manusia. Alam liar tidak mengajari kimia.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan mentor yang menjadi figur orangtuanya. Wild Child mati yatim piatu.`,
        `😢 ${victim.username} melolong sedih seperti anak serigala yang kehilangan induknya. Wild Child mati dalam tangisan.`
      ]
    },

    'Lil Wolvy': {
      'wolf_kill': [
        `🐺 ${victim.username}, anak serigala yang imut, tewas dalam pertarungan internal kawanan. Lil Wolvy mati karena terlalu polos untuk politik serigala.`,
        `🌙 ${victim.username} mati sambil mencari perlindungan kawanan dewasa. Si kecil mati ditinggalkan keluarga serigalanya.`
      ],
      'vote': [
        `🐺 ${victim.username} digantung meskipun wajahnya yang imut membuat banyak yang ragu. Lil Wolvy mati masih terlihat polos.`,
        `🌙 Tali gantung terlalu besar untuk leher kecil ${victim.username}. Anak serigala mati dengan mata yang masih lugu.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil tidak mengerti mengapa badannya sakit. Lil Wolvy mati dalam kebingungan.`,
        `🧪 Racun bekerja cepat dalam tubuh kecil ${victim.username}. Anak serigala mati sebelum sempat berubah dewasa.`
      ],
      'shoot': [
        `🔫 Peluru yang terlalu besar menembus tubuh kecil ${victim.username}. Lil Wolvy mati sebelum tumbuh menjadi ancaman.`,
        `💥 ${victim.username} roboh dengan mata yang masih polos menatap pembunuhnya. Anak serigala mati tanpa dendam.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil menangis seperti anak kecil. Lil Wolvy mati dengan suara yang memecah hati.`,
        `🌋 ${victim.username} mati dalam api sambil memanggil kawanan yang tidak datang menyelamatkan.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak tahan dengan keimutan yang menyeramkan. Serial killer membunuh anak monster.`,
        `🗡️ ${victim.username} mati dibunuh dengan sadis. Bahkan anak serigala tidak lolos dari kegilaan.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan karena tidak tahu apa yang ia lakukan. Lil Wolvy mati karena kepolosan.`,
        `⚗️ ${victim.username} mati dalam eksperimen yang tidak ia pahami. Anak serigala terlalu muda untuk mengerti.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kawanan dewasa yang ia cintai mengabaikannya. Lil Wolvy mati patah hati.`,
        `😢 ${victim.username} menangis seperti anak kecil saat hatinya berhenti berdetak. Suara terakhir adalah isakan.`
      ]
    },

    'Wolf Summoner': {
      'wolf_kill': [
        `🌕 ${victim.username}, nekromancer serigala, tewas dibunuh oleh arwah yang ia panggil dan memberontak. Summoner mati dimangsa ciptaannya sendiri.`,
        `🌙 ${victim.username} mati saat ritual pemanggilan berbalik menyerangnya. Wolf Summoner terbunuh oleh sihir nekromansinya.`
      ],
      'vote': [
        `🌕 ${victim.username} digantung setelah ritual gelapnya terbongkar. Wolf Summoner mati dihakimi karena bermain dengan kematian.`,
        `🌙 Tali gantung mengakhiri upacara terakhir ${victim.username}. Nekromancer serigala mati tanpa bisa memanggil bantuan.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan oleh ramuan nekromantik yang salah campur. Wolf Summoner terbunuh oleh magic sendiri.`,
        `🧪 Racun bereaksi dengan darah yang sudah terkontaminasi ritual gelap ${victim.username}. Necromancy backfire.`
      ],
      'shoot': [
        `🔫 Peluru suci menembus jantung ${victim.username} dan membakar sihir gelapnya. Wolf Summoner mati dan ritual terhenti.`,
        `💥 ${victim.username} tertembak sambil mengucapkan mantra pemanggilan. Summoning spell gagal total.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar bersama lingkaran sihir dan tengkorak-tengkorak ritual. Necromancer mati dalam api penyucian.`,
        `🌋 ${victim.username} mati dalam kobaran yang membakar semua artefak gelapnya. Api membersihkan nekromantik.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang kebal terhadap sihir gelap. Serial killer mengalahkan nekromancer.`,
        `🗡️ ${victim.username} mati sebelum sempat memanggil arwah serigala untuk melindunginya. Summoner kalah kecepatan.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang mengganggu koneksi spiritualnya. Wolf Summoner kehilangan kekuatan dan mati.`,
        `⚗️ ${victim.username} mati karena ramuan kimia memutus ikatan dengan arwah serigala. Sains melawan sihir.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena arwah yang ia cintai menolak dipanggil kembali. Summoner mati ditinggalkan roh kekasih.`,
        `😢 ${victim.username} menangis darah saat koneksi dengan dunia arwah terputus selamanya. Necromancer mati kesepian.`
      ]
    },

    'Wolf Trickster': {
      'wolf_kill': [
        `🎭 ${victim.username}, serigala penipu yang bisa mengubah wujud, tewas dalam bentuk aslinya setelah tidak sempat menyamar. Trickster mati terbongkar.`,
        `🌙 ${victim.username} mati saat sedang mencuri identitas korban. Wolf Trickster terbunuh di tengah transformasi.`
      ],
      'vote': [
        `🎭 ${victim.username} digantung dalam wujud palsu yang ia curi. Wolf Trickster mati dengan identitas orang lain.`,
        `🌙 Tali gantung mengakhiri permainan penyamaran ${victim.username}. Trickster mati dengan topeng yang tidak bisa dilepas.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil berusaha mengubah wujud untuk bertahan hidup. Shapeshifting gagal melawan racun.`,
        `🧪 Racun mengganggu kemampuan transformasi ${victim.username}. Wolf Trickster mati dalam wujud yang kacau.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} di tengah transformasi. Wolf Trickster mati dalam wujud setengah jadi.`,
        `💥 ${victim.username} tertembak sambil mencoba menyamar menjadi korban. Trickster gagal menipu maut.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar dengan semua topeng dan penyamarannya. Wolf Trickster mati dengan identitas aslinya.`,
        `🌋 ${victim.username} mati dalam kobaran sambil berubah-ubah wujud mencari yang bisa selamat. Semua transformasi gagal.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh psikopat yang tidak tertipu penyamaran. Serial killer melihat menembus semua topeng.`,
        `🗡️ ${victim.username} mati setelah semua trik gagal melawan kegilaan murni. Deception kalah oleh madness.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} meminum ramuan yang merusak kemampuan shapeshifting. Wolf Trickster kehilangan kekuatan dan mati.`,
        `⚗️ ${victim.username} mati karena kimia mengganggu sihir transformasinya. Science defeats magic.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena kehilangan identitas aslinya dalam semua penyamaran. Trickster lupa siapa diri sejatinya.`,
        `😢 ${victim.username} menangis dengan wajah yang terus berubah. Wolf Trickster mati tanpa mengetahui wujud aslinya.`
      ]
    },

    'Wolf Seer': {
      'wolf_kill': [
        `👁️ ${victim.username}, serigala bermata ketiga, tewas melihat kematiannya sendiri tapi tidak bisa menghindarinya. Wolf Seer mati dalam visi kematian.`,
        `🌙 Mata ketiga ${victim.username} hancur bersama tengkoraknya. Wolf Seer kehilangan penglihatan supernatural dan nyawa.`
      ],
      'vote': [
        `👁️ ${victim.username} digantung meskipun ia telah melihat masa depan ini. Wolf Seer mati tidak bisa mengubah takdir.`,
        `🌙 Tali gantung mengakhiri visi-visi ${victim.username}. Mata batin Wolf Seer menutup selamanya.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil melihat visi kematian sendiri berulang kali. Wolf Seer tersiksa oleh penglihatan.`,
        `🧪 Racun membakar mata ketiga ${victim.username} dari dalam. Wolf Seer mati buta secara supernatural.`
      ],
      'shoot': [
        `🔫 Peluru menembus mata ketiga ${victim.username} yang sedang melihat visi. Wolf Seer mati di tengah ramalan.`,
        `💥 ${victim.username} tertembak sambil berteriak tentang visi yang ia lihat. Ramalan terakhir tenggelam dalam darah.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil melihat visi api yang membakarnya. Wolf Seer mati dalam loop vision.`,
        `🌋 ${victim.username} mati dalam kobaran sambil berteriak ramalan yang tidak ada yang dengar. Visi terakhir adalah api.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai meskipun telah melihat pembunuhnya dalam visi. Wolf Seer tidak bisa lari dari takdir.`,
        `🗡️ ${victim.username} mati setelah visinya menunjukkan serial killer yang akan membunuhnya. Ramalan menjadi kenyataan.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} melihat visi kematian dalam ramuan tapi tetap meminumnya. Wolf Seer mati karena tidak bisa melawan takdir.`,
        `⚗️ ${victim.username} mati karena visinya menunjukkan semua ramuan membawa kematian. Self-fulfilling prophecy.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena melihat visi kekasihnya mati berulang kali. Wolf Seer tidak tahan dengan penglihatan tragis.`,
        `😢 Air mata darah mengalir dari mata ketiga ${victim.username} saat hatinya berhenti. Visi cinta berakhir dengan kematian.`
      ]
    },

    'Arsonist': {
      'wolf_kill': [
        `🔥 ${victim.username}, mantan pendeta yang kehilangan akal, tewas tercabik serigala di reruntuhan gereja yang ia bakar. Arsonist mati di tempat traumanya.`,
        `🌋 ${victim.username} mati dengan korek api di tangan dan bensin tumpah di sekitarnya. Api terakhir tidak sempat dinyalakan.`
      ],
      'vote': [
        `🔥 ${victim.username} digantung setelah jejak pembakaran yang ia tinggalkan terbongkar. Arsonist mati dihakimi korban-korbannya.`,
        `🌋 Tali gantung mengakhiri teror api ${victim.username}. Pyromantic mati tanpa kobaran terakhir.`
      ],
      'poison': [
        `☠️ ${victim.username} mati keracunan sambil membakar semua yang bisa ia jangkau. Arsonist mati dalam api dan racun.`,
        `🧪 Racun membakar ${victim.username} dari dalam seperti api yang selalu ia gunakan. Ironi kematian seorang pembakar.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} sebelum ia sempat membakar target terakhir. Arsonist mati dengan api yang tidak menyala.`,
        `💥 ${victim.username} tertembak sambil memegang obor. Api terakhir padam bersama nyawanya.`
      ],
      'ignite': [
        `🔥 ${victim.username} mati terbakar oleh apinya sendiri dalam ledakan bahan bakar. Arsonist menjadi korban obsesinya.`,
        `🌋 ${victim.username} tertawa sambil terbakar, akhirnya menjadi satu dengan api yang ia cintai. Death by fire.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibantai oleh serial killer sebelum sempat membakar apapun. Kegilaan mengalahkan obsesi api.`,
        `🗡️ ${victim.username} mati dengan korek api yang tidak menyala. Arsonist kalah oleh pembunuh yang lebih sadis.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan yang bereaksi dengan residu bahan bakar di tubuhnya. Chemical fire kills arsonist.`,
        `⚗️ ${victim.username} mati karena ramuan kimia memicu ledakan internal. Arsonist mati meledak dari dalam.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena api cinta yang padam. Arsonist yang obsesi dengan api mati karena hati yang dingin.`,
        `😢 Air mata ${victim.username} memadamkan korek api terakhirnya. Arsonist mati dalam kegelapan tanpa cahaya.`
      ]
    },

    'Serial Killer': {
      'wolf_kill': [
        `🔪 Pertarungan epik antara ${victim.username} dan serigala berakhir saling bunuh. Monster melawan monster dalam duel kematian.`,
        `⚔️ ${victim.username} berhasil membawa satu serigala bersamanya ke neraka. Kegilaan mengalahkan kebuasan dalam detik terakhir.`
      ],
      'vote': [
        `🔪 Kegilaan ${victim.username} berakhir di ujung tali, namun senyum mengerikan masih terukir di wajah mayatnya.`,
        `🩸 Eksekusi ${victim.username} menjadi pertunjukan paling ditunggu, namun mata psikopat itu masih memancarkan teror hingga mati.`
      ],
      'poison': [
        `☠️ ${victim.username} mati sambil tertawa menikmati rasa racun. Bahkan dalam kematian, kegilaannya masih mengerikan.`,
        `🧪 Racun tidak bisa mengalahkan kegilaan ${victim.username}. Ia mati dengan ekspresi orgasmic menikmati penderitaan.`
      ],
      'shoot': [
        `🔫 Peluru menghentikan ${victim.username} dalam detik, tapi senyum gila masih sempat terukir sebelum tumbang.`,
        `💥 ${victim.username} roboh sambil tertawa, senang akhirnya menemukan seseorang yang berani membunuhnya.`
      ],
      'ignite': [
        `🔥 ${victim.username} terbakar sambil menari dalam api, menikmati sensasi kulit yang meleleh dari tulangnya.`,
        `🌋 Api tidak bisa menghancurkan kegilaan ${victim.username}. Jeritan kesakitannya berubah menjadi tawa maniak.`
      ],
      'serial_kill': [
        `🔪 ${victim.username} dibunuh oleh serial killer lain dalam duel psikopat. Kegilaan melawan kegilaan.`,
        `🗡️ Pembunuh berantai lain mengalahkan ${victim.username} dengan kreativitas yang lebih sadis.`
      ],
      'chemist_duel': [
        `🧪 ${victim.username} memilih ramuan sambil tertawa, tidak peduli hidup atau mati. Kegilaan membuatnya fearless.`,
        `⚗️ Eksperimen terakhir ${victim.username} adalah merasakan kematian kimia dalam tubuhnya sendiri.`
      ],
      'heartbreak': [
        `💔 ${victim.username} mati karena cinta - satu-satunya emosi yang tidak bisa ia bunuh dalam dirinya.`,
        `😢 Air mata psikopat mengalir untuk pertama kalinya, dan jantungnya berhenti karena perasaan yang tidak ia mengerti.`
      ]
    },

      'Doppelganger': {
    'wolf_kill': [
      `🎭 ${victim.username}, makhluk shapeshifter kuno, tewas dalam wujud terakhir yang ia tiru sebelum berhasil menyerap esensi jiwa target.`,
      `🌫️ ${victim.username} mati tanpa sempat mewarisi role apapun. Doppelganger terbunuh sebelum transformasi sempurna.`
    ],
    'vote': [
      `🎭 ${victim.username} digantung dalam wujud palsu yang tidak sempurna. Doppelganger mati dengan identitas setengah jadi.`,
      `🌫️ Tali gantung mengakhiri pencarian identitas ${victim.username}. Shapeshifter mati tanpa menemukan diri sejati.`
    ],
    'poison': [
      `☠️ ${victim.username} mati keracunan sambil berusaha mengubah DNA untuk melawan racun. Shapeshifting gagal melawan kimia.`,
      `🧪 Racun mengganggu kemampuan transformasi ${victim.username}. Doppelganger mati dalam wujud yang kacau.`
    ],
    'shoot': [
      `🔫 Peluru menghentikan ${victim.username} di tengah proses penyerapan jiwa. Doppelganger mati incomplete.`,
      `💥 ${victim.username} tertembak sambil mencoba menyamar menjadi penembak. Transformation incomplete.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dengan semua identitas palsu yang pernah ia coba. Doppelganger mati tanpa wujud asli.`,
      `🌋 ${victim.username} mati dalam kobaran sambil berubah-ubah wujud mencari yang bisa selamat dari api.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh psikopat yang terpesona dengan kemampuan shapeshifting. Unique specimen destroyed.`,
      `🗡️ ${victim.username} mati setelah semua transformasi gagal mengelabui serial killer. Madness sees through all deception.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} memilih ramuan yang merusak kemampuan shapeshifting. Doppelganger kehilangan semua identitas sekaligus.`,
      `⚗️ ${victim.username} mati karena kimia mengganggu DNA supernatural. Science destroys shapeshifting ability.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena tidak pernah menemukan identitas sejati untuk dicintai. Doppelganger mati tanpa diri sendiri.`,
      `😢 ${victim.username} menangis dengan wajah yang terus berubah. Shapeshifter mati tidak tahu siapa yang sebenarnya menangis.`
    ]
  },

  'Fool': {
    'wolf_kill': [
      `🤡 ${victim.username} mati sambil yakin bahwa ia telah melihat kebenaran. Si bodoh tidak pernah menyadari kebodohannya.`,
      `🔮 Kristal palsu ${victim.username} pecah bersamaan dengan tengkoraknya. Fool malang mati dalam delusi yang tragis.`
    ],
    'vote': [
      `🎭 ${victim.username} digantung sambil berteriak ramalan palsu hingga napas terakhir. Topeng kebodohan terlepas setelah mati.`,
      `🤡 ${victim.username} mati dengan yakin bahwa eksekusinya adalah bagian dari visi sucinya.`
    ],
    'poison': [
      `☠️ ${victim.username} meminum racun sambil yakin itu adalah ramuan suci. Kebodohan membuatnya mati dengan tenang.`,
      `🧪 Racun mengalir dalam tubuh ${victim.username} yang masih percaya ia sedang dalam visi spiritual.`
    ],
    'shoot': [
      `🔫 ${victim.username} tertembak sambil yakin peluru itu adalah "cahaya suci" yang menyentuhnya.`,
      `💥 Fool ${victim.username} roboh dengan senyum, percaya ia sedang naik ke surga padahal sedang mati.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar sambil percaya ia sedang dimurnikan oleh api suci. Delusi hingga detik terakhir.`,
      `🌋 Api membakar ${victim.username} yang yakin sedang mengalami pencerahan spiritual.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai sambil berterima kasih pada pembunuhnya yang dikira malaikat. Fool mati dalam delusi total.`,
      `🗡️ ${victim.username} mati sambil memuji serial killer yang dikira utusan suci. Kebodohan sampai akhir.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} memilih ramuan sambil yakin mendapat petunjuk gaib. Fool mati karena "visi" palsu.`,
      `⚗️ ${victim.username} mati karena mengikuti bisikan yang tidak ada. Halusinasi membunuh si bodoh.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena "kehilangan koneksi dengan alam gaib" padahal ditinggal kekasih. Fool salah mendiagnosis patah hati.`,
      `😢 ${victim.username} mati sambil yakin sedang "naik ke level spiritual yang lebih tinggi". Delusi cinta sampai mati.`
    ]
  },

  'Tanner': {
    'wolf_kill': [
      `👺 ${victim.username}, penyamak kulit yang tergila-gila kematian, tewas dengan senyum puas melihat serigala. Tanner senang akhirnya mati.`,
      `🦴 ${victim.username} tertawa sambil dicabik serigala. Obsesi kematian Tanner akhirnya terpuaskan.`
    ],
    'vote': [
      `👺 ${victim.username} tertawa puas saat digantung. Tanner menang dengan memanipulasi massa untuk membunuhnya.`,
      `🦴 Tali gantung adalah kemenangan ${victim.username}. Tanner berhasil bunuh diri dengan tangan orang lain.`
    ],
    'poison': [
      `☠️ ${victim.username} meminum racun dengan suka cita. Tanner senang menemukan cara baru untuk mati.`,
      `🧪 Racun mengalir dalam tubuh ${victim.username} yang tersenyum puas. Tanner menikmati agoní kematian.`
    ],
    'shoot': [
      `🔫 ${victim.username} berlari ke arah peluru dengan tangan terbuka. Tanner memeluk kematian yang datang.`,
      `💥 ${victim.username} roboh sambil tersenyum bahagia. Peluru adalah hadiah yang ia tunggu-tunggu.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar sambil tertawa gembira. Tanner menikmati api yang membakar kulitnya.`,
      `🌋 ${victim.username} mati dalam kobaran dengan ekspresi orgasmic. Api adalah kenikmatan terakhir.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai sambil berterima kasih pada serial killer. Tanner senang menemukan artis kematian sejati.`,
      `🗡️ ${victim.username} mati sambil memuji kreativitas pembunuhnya. Tanner mengapresiasi seni membunuh.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} memilih ramuan beracun dengan sengaja. Tanner tidak peduli eksperimen atau kematian.`,
      `⚗️ ${victim.username} mati dalam eksperimen sambil tertawa. Sains atau magic, yang penting mati.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena kecewa tidak digantung lebih dulu. Tanner patah hati karena tidak mendapat kematian yang diinginkan.`,
      `😢 ${victim.username} menangis karena mati kecelakaan, bukan eksekusi. Tanner sedih tidak menang sesuai rencana.`
    ]
  },

  'Evil Detective': {
    'wolf_kill': [
      `🕵️‍♂️💹 ${victim.username}, detektif korup penjual informasi, tewas dimangsa klien serigalanya sendiri. Evil Detective dimakan majikan gelap.`,
      `🔍 ${victim.username} mati dengan berkas kotor berlumuran darah. Investigasi terakhir adalah kematiannya sendiri.`
    ],
    'vote': [
      `🕵️‍♂️💹 ${victim.username} digantung setelah korupsinya terbongkar. Evil Detective mati dihakimi oleh kebenaran.`,
      `🔍 Tali gantung mengakhiri karir kotor ${victim.username}. Detektif jahat mati oleh keadilan.`
    ],
    'poison': [
      `☠️ ${victim.username} diracuni oleh rekan sesama koruptor. Evil Detective mati dalam perang internal kejahatan.`,
      `🧪 Racun mengalir dalam darah kotor ${victim.username}. Detektif jahat mati oleh sesama penjahat.`
    ],
    'shoot': [
      `🔫 ${victim.username} ditembak oleh korban pemerasan yang membalas dendam. Evil Detective mati dibunuh klien.`,
      `💥 Peluru mengakhiri blackmail terakhir ${victim.username}. Detektif korup mati karena terlalu serakah.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar bersama semua berkas kotor yang ia miliki. Bukti kejahatan lenyap dengan si pemilik.`,
      `🌋 ${victim.username} mati dalam kobaran sambil berteriak nama-nama yang ia perangkap. Secret dies with him.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh klien psikopat yang bosan diperas. Evil Detective menjadi korban kegilaan.`,
      `🗡️ Serial killer membunuh ${victim.username} setelah bosan dengan pemerasan. Madness doesn't pay blackmail.`
    ],
    'evil_investigate': [
      `🕵️‍♂️💹 ${victim.username} terbunuh oleh Evil Detective lain yang lebih korup. Detektif jahat saling membunuh.`,
      `🔍 ${victim.username} kalah dalam perang investigasi korup. Evil Detective dimakan detective yang lebih jahat.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} memilih ramuan sambil mencoba menyuap The Chemist. Uang tidak bisa beli keselamatan.`,
      `⚗️ ${victim.username} mati karena tidak bisa menyogok maut dengan duit kotor. Corruption can't buy life.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena uang kotor tidak bisa beli cinta sejati. Evil Detective mati kesepian.`,
      `😢 ${victim.username} menangis menyadari semua yang ia miliki adalah hasil kejahatan. Penyesalan terakhir.`
    ]
  },

  'Cannibal': {
    'wolf_kill': [
      `🖤 ${victim.username}, mantan tukang masak yang gila daging manusia, tewas menjadi santapan serigala. Ironi kanibal dimakan predator lain.`,
      `🦴 ${victim.username} dimangsa sambil mencoba memakan serigala balik. Cannibal kalah dalam pertarungan makan-memakan.`
    ],
    'vote': [
      `🖤 ${victim.username} digantung setelah sisa-sisa korbannya ditemukan. Cannibal mati dihukum kejahatan kulinernya.`,
      `🦴 Tali gantung mengakhiri pesta kanibalisme ${victim.username}. Menu terakhir adalah kematian sendiri.`
    ],
    'poison': [
      `☠️ ${victim.username} mati keracunan oleh daging manusia yang busuk. Cannibal terbunuh oleh makanan kadaluwarsa.`,
      `🧪 Racun bercampur dengan daging manusia dalam perut ${victim.username}. Kanibal mati keracunan makanan.`
    ],
    'shoot': [
      `🔫 ${victim.username} ditembak sambil sedang makan korbannya. Cannibal mati di tengah perjamuan.`,
      `💥 Peluru menghentikan ${victim.username} sebelum sempat menghabiskan mangsa terakhir. Dinner interrupted.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar bersama dapur kanibalnya. Cannibal mati dalam api seperti BBQ raksasa.`,
      `🌋 ${victim.username} mati dibakar sambil daging manusia di sekelilingnya ikut matang. Final cookout.`
    ],
    'cannibalize': [
      `🖤 ${victim.username} dimakan oleh kanibal lain dalam ironi sempurna. Cannibal menjadi menu kanibal.`,
      `🦴 ${victim.username} disantap dengan resep yang ia kembangkan sendiri. Kanibal dimakan dengan cara kanibal.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh serial killer yang tidak suka persaingan. Dua predator bertemu, satu menang.`,
      `🗡️ ${victim.username} mati dibunuh sebelum sempat memakan siapapun. Serial killer mengalahkan kanibal.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan sambil mencoba merasakan "rasa kimia baru". Cannibal eksperimen rasa terakhir.`,
      `⚗️ ${victim.username} mati karena ramuan kimia tidak seenak daging manusia. Bad taste, deadly result.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena kekasihnya menolak dimakan. Cannibal patah hati tidak bisa makan cinta.`,
      `😢 ${victim.username} menangis karena tidak ada yang mau menjadi makanannya. Kanibal mati kelaparan cinta.`
    ]
  },

  'Bandit': {
    'wolf_kill': [
      `🥷 ${victim.username}, pemimpin gerombolan perampok, tewas dicabik serigala saat merampok sendirian. Bandit mati tanpa anak buah.`,
      `💰 ${victim.username} mati dengan kantong jarahan berlumuran darah. Rampasan terakhir adalah nyawanya sendiri.`
    ],
    'vote': [
      `🥷 ${victim.username} digantung setelah kejahatan perampokannya terbongkar. Bandit mati dihakimi korban-korbannya.`,
      `💰 Tali gantung mengakhiri karir kriminal ${victim.username}. Rampok terakhir adalah mencuri napasnya sendiri.`
    ],
    'poison': [
      `☠️ ${victim.username} diracuni oleh korban yang membalas dendam. Bandit mati dibunuh target rampoknya.`,
      `🧪 Racun mengalir dalam darah ${victim.username} yang terbiasa dengan kekerasan. Karma is poison.`
    ],
    'shoot': [
      `🔫 ${victim.username} ditembak dalam pertempuran dengan rival gang. Bandit mati dalam perang geng.`,
      `💥 Peluru mengakhiri dominasi ${victim.username} di dunia kriminal. Bandit tumbang dalam shootout.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dalam hideout yang diserang musuh. Bandit mati dalam sarangnya sendiri.`,
      `🌋 ${victim.username} mati dalam kobaran bersama semua jarahan yang ia kumpulkan. Wealth burns with owner.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh psikopat yang tidak bisa dirampok. Serial killer immune to banditry.`,
      `🗡️ ${victim.username} mati dibunuh setelah mencoba merampok orang yang salah. Wrong target, deadly mistake.`
    ],
    'bandit_kill': [
      `🥷 ${victim.username} dibunuh oleh Bandit lain dalam perang teritorial. Gang war claims leader.`,
      `💰 ${victim.username} mati dalam pertarungan rebut kekuasaan kriminal. Bandit killed by bandit.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan sambil mencoba merampok The Chemist. Crime doesn't pay in chemistry.`,
      `⚗️ ${victim.username} mati karena salah sasaran merampok. Mad scientist bukan target yang tepat.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena Accomplice-nya meninggalkannya. Bandit patah hati ditinggal kaki tangan.`,
      `😢 ${victim.username} menangis kehilangan keluarga kriminalnya. Bandit mati kesepian tanpa gang.`
    ]
  },

  'Accomplice': {
    'wolf_kill': [
      `💢 ${victim.username}, kaki tangan yang dipaksa bergabung, tewas dicabik serigala saat mencoba kabur dari kehidupan kriminal.`,
      `🗡️ ${victim.username} mati sambil menyesali keputusan bergabung dengan Bandit. Accomplice mati dalam penyesalan.`
    ],
    'vote': [
      `💢 ${victim.username} digantung meskipun ia korban paksaan. Accomplice mati dihukum atas kejahatan yang tidak ia inginkan.`,
      `🗡️ Tali gantung mengakhiri penderitaan ${victim.username}. Accomplice mati bebas dari majikan kriminal.`
    ],
    'poison': [
      `☠️ ${victim.username} diracuni oleh Bandit yang curiga pada loyalitasnya. Accomplice dibunuh majikan sendiri.`,
      `🧪 Racun mengalir dalam tubuh ${victim.username} yang lelah dengan kehidupan kriminal. Death as escape.`
    ],
    'shoot': [
      `🔫 ${victim.username} ditembak saat mencoba melarikan diri dari gang. Accomplice mati mencari kebebasan.`,
      `💥 Peluru menghentikan ${victim.username} yang ingin keluar dari dunia kriminal. Freedom costs life.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dalam serangan balas dendam korban perampokan. Accomplice mati karena kejahatan majikan.`,
      `🌋 ${victim.username} mati dalam kobaran sambil menyesali pilihan hidupnya. Fire cleanses reluctant criminal.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh psikopat setelah mencoba merampoknya atas perintah Bandit. Wrong order, deadly result.`,
      `🗡️ ${victim.username} mati dibunuh karena terpaksa menjalankan tugas kriminal. Reluctant criminal, eager victim.`
    ],
    'accomplice_kill': [
      `💢 ${victim.username} dibunuh oleh Accomplice lain dalam persaingan merebut perhatian Bandit. Sibling rivalry gone deadly.`,
      `🗡️ ${victim.username} mati dalam pertarungan sesama kaki tangan. Accomplice vs Accomplice.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan karena dipaksa Bandit untuk mencoba. Forced participation, deadly result.`,
      `⚗️ ${victim.username} mati karena harus mengikuti perintah majikan kriminal. Orders kill accomplice.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena keluarga yang ia lindungi tetap tidak memaafkannya. Accomplice mati tanpa pengampunan.`,
      `😢 ${victim.username} menangis karena pengorbanannya tidak dihargai keluarga. Unappreciated sacrifice.`
    ]
  },

  'Headhunter': {
    'wolf_kill': [
      `🎯 ${victim.username}, pemburu bayaran profesional, tewas diserang serigala saat menguntit target kontraknya. Hunter becomes hunted.`,
      `💰 ${victim.username} mati dengan kontrak pembunuhan yang tidak selesai di tangannya. Mission failed, permanently.`
    ],
    'vote': [
      `🎯 ${victim.username} digantung setelah gagal memenuhi kontrak pembunuhan. Headhunter mati karena kegagalan misi.`,
      `💰 Tali gantung mengakhiri karir assassin ${victim.username}. Professional killer meets unprofessional death.`
    ],
    'poison': [
      `☠️ ${victim.username} diracuni oleh target yang lebih cerdik. Headhunter menjadi korban calon korbannya.`,
      `🧪 Racun mengalahkan ${victim.username} yang ahli dalam segala ramuan cinta. Bahkan master racun bisa salah langkah.`
    ],
    'shoot': [
      `🔫 ${victim.username} ditembak oleh sniper yang lebih baik. Headhunter kalah dalam duel penembak jitu.`,
      `💥 Peluru musuh lebih cepat dari milik ${victim.username}. Professional killer outgunned.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dalam ledakan yang seharusnya untuk target kontraknya. Bomb backfires on bomber.`,
      `🌋 ${victim.username} mati dalam api sambil mengutuk kontrak yang gagal. Mission burns with assassin.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai oleh serial killer yang bukan targetnya. Headhunter killed by non-target psychopath.`,
      `🗡️ ${victim.username} mati karena terfokus pada target kontrak dan tidak waspada bahaya lain. Tunnel vision kills.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan sambil berpikir tentang target kontraknya. Mission incomplete, life complete.`,
      `⚗️ ${victim.username} mati karena terlalu fokus pada uang kontrak. Greed leads to deadly chemistry.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena target kontraknya ternyata orang yang ia cintai. Headhunter can't kill love.`,
      `😢 ${victim.username} menangis menyadari ia harus membunuh kekasihnya untuk kontrak. Love vs money kills both.`
    ]
  },

  'Aura Seer': {
    'wolf_kill': [
      `👁️ ${victim.username}, peramal muda yang kehilangan detail tapi masih bisa merasakan aura, tewas dengan mata batin rusak yang tidak bisa melihat serigala datang.`,
      `🌟 ${victim.username} mati dengan aura-aura di sekelilingnya yang berubah gelap. Aura Seer kehilangan cahaya terakhir.`
    ],
    'vote': [
      `👁️ ${victim.username} digantung meskipun ia telah memperingatkan tentang aura jahat. Aura Seer mati tidak dipercaya.`,
      `🌟 Tali gantung mengakhiri kemampuan ${victim.username} membaca aura. Spiritual vision dies with seer.`
    ],
    'poison': [
      `☠️ ${victim.username} mati keracunan sambil merasakan aura racun yang mengerikan. Aura Seer feels poison's evil aura.`,
      `🧪 Racun membakar kemampuan spiritual ${victim.username} sebelum membunuhnya. Toxic aura overwhelms seer.`
    ],
    'shoot': [
      `🔫 Peluru menembus ${victim.username} yang sedang membaca aura si penembak. Aura Seer dies reading killer's aura.`,
      `💥 ${victim.username} roboh sambil berteriak tentang aura gelap yang ia rasakan. Final aura reading is darkness.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar sambil merasakan aura api yang membakar jiwa. Fire has dark aura for seer.`,
      `🌋 ${victim.username} mati dalam kobaran dengan kemampuan spiritual yang ikut terbakar. Aura vision burns away.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai sambil berteriak tentang aura evil yang mengerikan. Seer overwhelmed by killer's darkness.`,
      `🗡️ ${victim.username} mati setelah melihat aura psikopat yang terlalu gelap untuk ditahan. Evil aura kills seer.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} memilih ramuan berdasarkan aura yang salah baca. Aura Seer misreads chemical aura.`,
      `⚗️ ${victim.username} mati karena tidak bisa membaca aura kimia dengan benar. Science has no spiritual aura.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena aura kekasihnya berubah gelap saat meninggal. Seer feels loved one's aura fade.`,
      `😢 ${victim.username} menangis melihat auranya sendiri memudar bersama cinta. Own aura dies with love.`
    ]
  },

  'Villager': {
    'wolf_kill': [
      `👤 ${victim.username}, warga desa biasa yang terjebak kutukan supernatural, tewas menjadi korban tak berdosa dalam teror malam.`,
      `🏘️ ${victim.username} mati dengan doa di bibir dan harapan di hati. Villager innocent dies in supernatural chaos.`
    ],
    'vote': [
      `👤 ${victim.username} digantung karena kecurigaan yang salah. Villager polos mati dihukum tanpa bukti.`,
      `🏘️ Tali gantung mengakhiri hidup ${victim.username} yang tidak bersalah. Innocent blood stains village hands.`
    ],
    'poison': [
      `☠️ ${victim.username} mati keracunan tanpa tahu mengapa ia dibunuh. Villager dies without understanding evil.`,
      `🧪 Racun mengalir dalam tubuh ${victim.username} yang tidak pernah menyakiti siapapun. Pure blood poisoned.`
    ],
    'shoot': [
      `🔫 Peluru menghentikan ${victim.username} yang sedang bekerja untuk desa. Villager dies serving community.`,
      `💥 ${victim.username} roboh sambil memegang alat kerja sehari-hari. Simple life ends with violence.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar di rumahnya yang sederhana. Villager dies in humble home.`,
      `🌋 ${victim.username} mati dalam kobaran sambil melindungi keluarganya. Selfless sacrifice in flames.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} dibantai tanpa alasan yang jelas. Random innocent becomes psychopath's victim.`,
      `🗡️ ${victim.username} mati dibunuh karena kebetulan bertemu serial killer. Wrong place, wrong time.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan tanpa mengerti permainannya. Innocent caught in mad science.`,
      `⚗️ ${victim.username} mati karena terpaksa terlibat eksperimen gila. Simple villager in complex death.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena kehilangan keluarga dalam chaos supernatural. Villager dies of pure grief.`,
      `😢 ${victim.username} menangis untuk desa yang hancur sebelum hatinya berhenti. Community love kills with sorrow.`
    ],
    'judge_execution': [
      `⚖️ ${victim.username} dieksekusi oleh Judge yang salah menilai. Innocent villager dies by false justice.`,
      `🏛️ ${victim.username} mati karena keputusan hakim yang gegabah. Justice kills the just.`
    ],
    'sacrifice': [
      `😇 ${victim.username} mengorbankan diri untuk menyelamatkan orang lain. Villager dies as true hero.`,
      `✨ ${victim.username} mati dengan mulia demi keselamatan desa. Ultimate sacrifice of simple person.`
    ],
    'admin_kill': [
      `🔧 ${victim.username} dibunuh admin karena mengganggu permainan. Villager dies by meta-gaming rules.`,
      `💻 ${victim.username} mati karena pelanggaran yang tidak dipahaminya. Admin justice strikes innocent.`
    ]
  },
// Death narratives untuk tiga role baru: Hercules, Blacksmith, dan Guardian Wolf

'Hercules': {
  'wolf_kill': [
    `🦾 ${victim.username}, keturunan dewa yang memiliki kekuatan luar biasa, tewas setelah pertarungan epik melawan kawanan serigala. Bahkan daging dan tulang sebaja pun akhirnya menyerah pada kebuasan supernatural.`,
    `💪 ${victim.username} roboh dengan otot-otot baja yang tercabik dan darah emas mengalir. Hercules terakhir mati dalam pertempuran yang akan dikenang sepanjang masa.`
  ],
  'vote': [
    `🦾 ${victim.username} digantung dengan tali yang harus diperkuat berkali-kali. Bahkan dalam kematian, kekuatan Hercules masih menakutkan.`,
    `💪 Massa membutuhkan puluhan orang untuk menggantung ${victim.username}. Hercules mati dengan martabat dewa yang turun ke bumi.`
  ],
  'poison': [
    `☠️ Racun yang dirancang khusus untuk dewa mengalir dalam darah emas ${victim.username}. Bahkan Hercules tidak kebal terhadap racun yang dibuat untuk membunuh keturunan Zeus.`,
    `🧪 ${victim.username} mati keracunan sambil tubuhnya berusaha melawan dengan kekuatan terakhir. Racun dewa akhirnya mengalahkan otot baja.`
  ],
  'shoot': [
    `🔫 Peluru khusus pemburu dewa menembus kulit baja ${victim.username}. Hercules mati oleh senjata yang dirancang untuk membunuh monster legendaris.`,
    `💥 ${victim.username} roboh dengan peluru yang baru bisa menembus setelah tembakan ketiga. Even gods bleed with right weapon.`
  ],
  'ignite': [
    `🔥 ${victim.username} terbakar dalam api yang cukup panas untuk melelehkan baja. Hercules mati seperti dewa kuno dalam api penyucian.`,
    `🌋 ${victim.username} mati dalam kobaran sambil masih berusaha menyelamatkan orang lain. Heroic sampai detik terakhir.`
  ],
  'serial_kill': [
    `🔪 ${victim.username} dibantai oleh serial killer dengan senjata yang dirancang khusus untuk menembus kulit baja. Kegilaan menemukan cara mengalahkan kekuatan dewa.`,
    `🗡️ ${victim.username} mati setelah pertarungan brutal. Serial killer berhasil mengalahkan Hercules dengan kekejaman yang melampaui kekuatan fisik.`
  ],
  'chemist_duel': [
    `🧪 ${victim.username} meminum ramuan yang bereaksi dengan darah emas dalam tubuhnya. Divine blood creates deadly chemical reaction.`,
    `⚗️ ${victim.username} mati karena sains modern mengalahkan kekuatan kuno. Chemistry defeats mythology.`
  ],
  'heartbreak': [
    `💔 ${victim.username} mati karena hati dewa yang terlalu besar untuk ditahan tubuh fana. Hercules hancur oleh cinta yang melampaui kekuatan fisik.`,
    `😢 Air mata emas mengalir dari mata ${victim.username} saat jantung baja berhenti berdetak. Even demigods die of love.`
  ],
  'hunter_revenge': [
    `🏹 ${victim.username} dibawa mati oleh Hunter dalam pertarungan dua warrior legendaris. Hercules dan Hunter bertemu di Valhalla.`,
    `🎯 Panah Hunter menemukan satu-satunya titik lemah ${victim.username}. Monster hunter defeats monster slayer.`
  ],
  'sacrifice': [
    `😇 ${victim.username} mengorbankan kekuatan dewanya untuk menyelamatkan seluruh desa. Hercules mati sebagai hero sejati.`,
    `✨ ${victim.username} mati dengan mulia, menggunakan nyawa terakhir untuk perlindungan ultimate. Divine sacrifice for mortal salvation.`
  ]
},
'Blacksmith': {
  'wolf_kill': [
    `⚒️ ${victim.username}, pandai besi master yang menguasai sihir logam kuno, tewas dengan palu suci berlumuran darah di tangannya. Serigala menghancurkan bengkel terakhir yang bisa menciptakan senjata anti-monster.`,
    `🔥 ${victim.username} mati di depan perapian yang masih menyala, dengan senjata setengah jadi untuk melawan kegelapan. Blacksmith terakhir gugur sebelum menyelesaikan karya agung.`
  ],
  'vote': [
    `⚒️ ${victim.username} digantung dengan tali yang ia buat sendiri dari logam terkuat. Ironi pandai besi mati oleh hasil karyanya.`,
    `🔥 Massa menggantung ${victim.username} di dekat perapiannya yang padam. Api terakhir mati bersama sang pandai besi.`
  ],
  'poison': [
    `☠️ ${victim.username} mati keracunan oleh logam beracun yang dicampur dalam makanannya. Blacksmith yang ahli logam mati oleh keahliannya sendiri.`,
    `🧪 Racun bereaksi dengan debu logam dalam paru-paru ${victim.username}. Pandai besi mati oleh campuran kimia dan metal.`
  ],
  'shoot': [
    `🔫 Peluru menembus ${victim.username} yang sedang menempa perisai pelindung. Blacksmith mati sebelum menyelesaikan armor terakhir.`,
    `💥 ${victim.username} roboh dengan logam panas tumpah membakar tubuhnya. Molten metal becomes funeral pyre.`
  ],
  'ignite': [
    `🔥 ${victim.username} terbakar dalam perapian raksasa bengkelnya sendiri. Blacksmith mati dalam api yang selama ini ia kuasai.`,
    `🌋 ${victim.username} mati dalam ledakan furnace yang overheated. Master of fire dies by fire.`
  ],
  'serial_kill': [
    `🔪 ${victim.username} dibantai dengan pisau yang ia buat sendiri. Serial killer menggunakan karya Blacksmith untuk membunuh penciptanya.`,
    `🗡️ ${victim.username} mati dibunuh di bengkelnya sendiri. Tempat penciptaan menjadi tempat pembunuhan.`
  ],
  'chemist_duel': [
    `🧪 ${victim.username} meminum ramuan yang bereaksi dengan partikel logam dalam darahnya. Metal poisoning from chemical reaction.`,
    `⚗️ ${victim.username} mati karena tubuhnya yang terbiasa dengan asap logam tidak tahan racun kimia murni.`
  ],
  'heartbreak': [
    `💔 ${victim.username} mati karena tidak bisa menempa hati yang patah. Master blacksmith can't forge love back.`,
    `😢 ${victim.username} menangis di atas anvil sambil palu terakhir jatuh dari tangannya. Tears quench final flame.`
  ],
  'arsonist': [
    `🔥 ${victim.username} mati dalam kebakaran yang dinyalakan Arsonist. Ironi master api terbunuh oleh api liar.`,
    `🌋 ${victim.username} terbakar bersama semua hasil tempaannya. Forge burns with forger.`
  ],
  'sacrifice': [
    `😇 ${victim.username} mengorbankan api kehidupannya untuk menciptakan Malam Damai terakhir. Blacksmith dies forging ultimate protection.`,
    `✨ ${victim.username} mati sambil mengaktifkan perisai spiritual raksasa. Final masterpiece costs creator's life.`
  ]
},

'Guardian Wolf': {
  'wolf_kill': [
    `🛡️🐺 ${victim.username}, serigala pelindung dengan ikatan mistis kawanan, tewas dalam pertarungan internal melawan Alpha yang menentang keputusannya melindungi kawanan dari bahaya.`,
    `🌙 ${victim.username} mati sambil berusaha melindungi serigala lain dari pembunuhan. Guardian Wolf gugur dalam tugas sucinya.`
  ],
  'vote': [
    `🛡️🐺 ${victim.username} digantung setelah kekuatan pelindungnya gagal menyelamatkan kawanan dari amarah massa. Guardian terbunuh setelah gagal memenuhi tugas.`,
    `🌙 Tali gantung mengakhiri sumpah pelindung ${victim.username}. Guardian Wolf mati tanpa bisa menggunakan kekuatan terakhirnya.`
  ],
  'poison': [
    `☠️ ${victim.username} mati keracunan sambil berusaha menetralisir racun dengan magic pelindungnya. Guardian power fails against toxin.`,
    `🧪 Racun mengganggu ikatan mistis ${victim.username} dengan kawanan. Guardian Wolf mati terputus dari pack.`
  ],
  'shoot': [
    `🔫 Peluru khusus anti-serigala menembus perisai mistis ${victim.username}. Guardian Wolf mati gagal melindungi diri sendiri.`,
    `💥 ${victim.username} roboh sambil berusaha melindungi kawanan dengan tubuhnya. Physical shield fails where magic couldn't.`
  ],
  'ignite': [
    `🔥 ${victim.username} terbakar sambil mencoba menciptakan barrier pelindung untuk kawanan. Guardian burns while protecting.`,
    `🌋 ${victim.username} mati dalam kobaran yang membakar ikatan mistisnya dengan pack. Fire severs magical connection.`
  ],
  'serial_kill': [
    `🔪 ${victim.username} dibantai oleh serial killer yang immune terhadap magic pelindung. Guardian power useless against pure madness.`,
    `🗡️ ${victim.username} mati setelah kekuatan pelindungnya habis digunakan untuk kawanan. Guardian dies defenseless after protecting others.`
  ],
  'chemist_duel': [
    `🧪 ${victim.username} meminum ramuan yang mengganggu magic pelindungnya. Chemical interference with guardian powers.`,
    `⚗️ ${victim.username} mati karena racun kimia memutus ikatan supernatural dengan kawanan. Science breaks mystical bonds.`
  ],
  'heartbreak': [
    `💔 ${victim.username} mati karena kawanan yang ia lindungi menolaknya. Guardian Wolf dies rejected by protected pack.`,
    `😢 ${victim.username} menangis saat ikatan mistisnya dengan kawanan tercinta terputus selamanya. Mystical heartbreak kills guardian.`
  ],
  'hunter_revenge': [
    `🏹 ${victim.username} dibawa mati oleh Hunter yang memburu kawanan serigalanya. Guardian fails final protection duty.`,
    `🎯 Panah Hunter menembus perisai pelindung ${victim.username}. Monster hunter penetrates guardian magic.`
  ],
  'arsonist': [
    `🔥 ${victim.username} terbakar dalam api yang dinyalakan Arsonist untuk membakar seluruh kawanan. Guardian burns trying to save pack.`,
    `🌋 ${victim.username} mati dalam kobaran sambil berusaha melindungi sarang serigala. Fire consumes guardian and den.`
  ],
  'sacrifice': [
    `😇 ${victim.username} mengorbankan ikatan mistisnya untuk memberikan perlindungan ultimate pada kawanan. Guardian dies severing own power.`,
    `✨ ${victim.username} mati sambil mengaktifkan shield terakhir untuk kawanan. Ultimate protection costs guardian's life.`
  ]
}
}

  // Get role-specific messages for the death method
  const roleMessages = mythologicalMessages[role];
  if (roleMessages && roleMessages[method]) {
    const messages = roleMessages[method];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // Fallback to generic mythological death for missing combinations
  return this.getGenericMythologicalDeath(victim, method);
}

// Generic mythological deaths for any missing role-method combinations
getGenericMythologicalDeath(victim, method) {
  const genericMythological = {
    'wolf_kill': [
      `🐺 ${victim.username} menjadi mangsa kawanan buas dalam kegelapan malam yang mengerikan.`,
      `🌙 Taring kegelapan mencabik ${victim.username} hingga tidak tersisa yang utuh.`
    ],
    'vote': [
      `⚖️ Keadilan rakyat telah berbicara - ${victim.username} menggantung di ujung tali sebagai korban demokrasi.`,
      `🎭 ${victim.username} menjadi tumbal amarah massa yang tidak bisa dibendung.`
    ],
    'poison': [
      `☠️ Racun mematikan menggerogoti ${victim.username} dari dalam, membunuh perlahan dengan siksaan yang tak berujung.`,
      `🧪 ${victim.username} kejang dalam agoní racun yang membakar organ dalamnya.`
    ],
    'shoot': [
      `🔫 Peluru menemukan sasarannya, mengakhiri hidup ${victim.username} dalam sekejap mata.`,
      `💥 ${victim.username} roboh dengan lubang menganga di dadanya, darah menggenang di bawah tubuhnya.`
    ],
    'ignite': [
      `🔥 ${victim.username} terbakar dalam kobaran api yang tak kenal ampun.`,
      `🌋 Api menjilati tubuh ${victim.username} hingga menjadi abu dan debu.`
    ],
    'serial_kill': [
      `🔪 ${victim.username} menjadi korban pembunuh berantai dalam ritual kematian yang sadis.`,
      `🗡️ ${victim.username} dibantai dengan kegilaan yang melampaui batas kemanusiaan.`
    ],
    'chemist_duel': [
      `🧪 ${victim.username} meminum ramuan kematian dalam eksperimen kimia yang mengerikan.`,
      `⚗️ Ilmu pengetahuan menjadi senjata maut yang mengakhiri hidup ${victim.username}.`
    ],
    'heartbreak': [
      `💔 ${victim.username} mati karena patah hati, cinta yang terlalu dalam menjadi racun mematikan.`,
      `😢 Jantung ${victim.username} berhenti berdetak, tidak sanggup hidup tanpa sang kekasih.`
    ],
    'hunter_revenge': [
      `🏹 ${victim.username} dibawa mati oleh Hunter dalam balas dendam terakhir.`,
      `🎯 Panah Hunter menemukan sasaran dalam solidaritas kematian.`
    ],
    'evil_investigate': [
      `🕵️‍♂️💹 ${victim.username} terbunuh dalam investigasi korup yang mematikan.`,
      `🔍 Penyelidikan gelap mengklaim jiwa ${victim.username} sebagai korban.`
    ],
    'bandit_kill': [
      `🥷 ${victim.username} dibunuh perampok dalam aksi kriminal yang brutal.`,
      `💰 Bandit menghabisi ${victim.username} untuk jarahan yang tak seberapa.`
    ],
    'accomplice_kill': [
      `💢 ${victim.username} dibunuh kaki tangan dalam aksi kejahatan terencana.`,
      `🗡️ Accomplice menghabisi ${victim.username} atas perintah majikan kriminal.`
    ],
    'sacrifice': [
      `😇 ${victim.username} mengorbankan nyawanya demi menyelamatkan orang lain.`,
      `✨ Pengorbanan suci ${victim.username} bercahaya dalam kegelapan.`
    ],
    'admin_kill': [
      `🔧 ${victim.username} dibunuh oleh kekuatan administratif yang tak terbantahkan.`,
      `💻 Admin justice menghantam ${victim.username} tanpa ampun.`
    ],
    'judge_execution': [
      `⚖️ ${victim.username} dieksekusi oleh keputusan hakim yang final.`,
      `🏛️ Justice backfire menghantam ${victim.username} dengan kejam.`
    ],
    'justice_backfire': [
      `⚖️ ${victim.username} mati akibat keadilan yang membalik arah.`,
      `💥 Keadilan berbalik dan menghancurkan ${victim.username}.`
    ]
  };

  const messages = genericMythological[method] || [
    `💀 ${victim.username} meninggal dalam keadaan yang tragis dan misterius.`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

  // ================= DAY PHASE =================

  async startDay() {
    if (!this.inGame) return;
    this.phase = 'discussion';
    
    const aliveCount = this.alivePlayers().length;
    await this.broadcast(
      `☀️ **HARI ${this.day} - WAKTU DISKUSI** ☀️\n\n` +
      `${aliveCount} warga masih bertahan hidup.\n` +
      `Diskusi dimulai - bersiaplah untuk voting!`
    );
    
    setTimeout(async () => {
      await this.broadcast(`👥 **WARGA YANG MASIH HIDUP:**\n${this.listPlayers(true)}`);
    }, 2000);
    
    // Start voting after day duration
    this.timers.voteStart = setTimeout(() => this.startVoting(), this.DAY_DURATION * 1000);
    
    // 30s warning
    this.timers.dayWarning = setTimeout(() => {
      if (this.phase === 'discussion') {
        this.broadcast("⏰ **30 detik lagi voting akan dimulai!**");
      }
    }, (this.DAY_DURATION - 30) * 1000);
  }

  async startVoting() {
    if (!this.inGame) return;
    this.phase = 'vote';
    this.votes = {};
    this.voteLastChange = {};
    
    const alive = this.alivePlayers();
    const numbered = alive.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
    
    await this.broadcast(
      `⚖️ **PEMUNGUTAN SUARA DIMULAI** ⚖️\n\n` +
      `${numbered}\n\n` +
      `Kirim pilihan via DM dengan \`/<nomor>\`.\n` +
      `Waktu voting: 60 detik.`
    );
    
    // Send DM to each alive player
    for (const player of alive) {
      await this.dm(player.id, 
        `⚖️ **VOTING LYNCH** ⚖️\n\n${numbered}\n\n` +
        `Siapa yang akan digantung? Balas: \`/<nomor>\``
      );
    }
    
    this.timers.voteEnd = setTimeout(() => this.resolveVote(), 60000);
    this.timers.voteWarning = setTimeout(() => {
      if (this.phase === 'vote') {
        this.broadcast("⏰ **20 detik tersisa untuk voting!**");
      }
    }, 40000);
  }

  async handleVoteChoice(gId, player, numbers) {
    const alive = this.alivePlayers();
    const target = alive[numbers[0] - 1];
    
    if (!target) {
      return this.dm(gId, "❌ Pilihan voting tidak valid.");
    }
    
    if (target.id === gId) {
      return this.dm(gId, "❌ Tidak bisa memilih diri sendiri.");
    }
    
    // Fix: Allow one vote only, no changes
    if (this.votes[gId]) {
      const currentTarget = this.players[this.votes[gId]];
      return this.dm(gId, `❌ Kamu sudah memberikan suara untuk ${currentTarget.username} dan tidak bisa mengubahnya.`);
    }
    
    this.votes[gId] = target.id;
    
    await this.dm(gId, `✅ Suaramu untuk ${target.username} telah dicatat.`);
    await this.broadcast("✅ Seorang warga telah memberikan suara.");
  }

  async resolveVote() {
    if (!this.inGame) return;
    
    clearTimeout(this.timers.voteEnd);
    clearTimeout(this.timers.voteWarning);
    
    const tally = {};
    let totalVotes = 0;
    const voterCount = this.alivePlayers().length;
    
    Object.values(this.votes).forEach(targetId => {
      if (targetId) {
        tally[targetId] = (tally[targetId] || 0) + 1;
        totalVotes++;
      }
    });
    
    if (totalVotes === 0) {
      await this.broadcast("📢 **Tidak ada suara masuk** - Tidak ada yang digantung hari ini.");
      return this.processJudgeDecision(); // Use correct method
    }
    
    let maxVotes = 0;
    let winners = [];
    
    Object.entries(tally).forEach(([targetId, votes]) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        winners = [targetId];
      } else if (votes === maxVotes) {
        winners.push(targetId);
      }
    });
    
    if (winners.length > 1) {
      await this.broadcast(`⚖️ **HASIL SERI** - Tidak ada yang digantung hari ini.`);
      return this.processJudgeDecision(); // Use correct method
    }
    
    // Check Guardian Wolf protection before lynch
    const victimId = winners[0];
    const victim = this.players[victimId];
    
    if (victim && victim.alive) {
      // Guardian Wolf lynch protection
      if (victim.team === 'Jahat' || victim.role === 'Lycan') {
        const guardianWolves = Object.values(this.players).filter(p => 
          p.alive && p.role === 'Guardian Wolf' && !p.guardianProtectionUsed
        );
        
        if (guardianWolves.length > 0) {
          const guardian = guardianWolves[0];
          guardian.guardianProtectionUsed = true;
          guardian.canProtectPack = false;
          
          await this.broadcast(
            `🛡️🐺 **PERLINDUNGAN SUPERNATURAL!** Guardian Wolf menyelamatkan ${victim.username}! Malam segera tiba!`
          );
          
          setTimeout(() => this.startNight(), 3000);
          return;
        }
      }
      
      // Normal lynch
      victim.alive = false;
      victim.lastKillMethod = 'vote';
      const revelationInfo = this.getRevelationInfo(victim);
      
      await this.broadcast(
        `⚖️ **HASIL LYNCH:** ${victim.username} terpilih digantung!${revelationInfo ? '\n' + revelationInfo : ''}`
      );
      
      await this.processLynchEffects(victim);
      
      if (await this.checkWinCondition()) return;
      this.proceedToNight();
    }
  }

async processJudgeDecision() {
  // Find alive judges with remaining convictions and judge actions
  const judgeActions = Object.entries(this.actions).filter(([playerId, action]) => {
    const player = this.players[playerId];
    return action.action === 'judge' && player && player.alive && 
           player.role === 'Judge' && player.convictions > 0;
  });
  
  if (judgeActions.length === 0) {
    this.proceedToNight();
    return;
  }
  
  const [judgeId, judgeAction] = judgeActions[0];
  const judge = this.players[judgeId];
  
  await this.broadcast(`⚖️ *JUDGE memiliki 30 detik untuk mengeksekusi atau skip!*`);
  
  const alive = this.alivePlayers().filter(p => p.id !== judgeId);
  const numbered = alive.map((p, i) => `${i + 1}. ${p.username}`).join('\n');
  
  await this.dm(judgeId, 
    `⚖️ **EKSEKUSI JUDGE** ⚖️\n\n${numbered}\n\n` +
    `Balas: \`/<nomor>\` untuk eksekusi atau \`/skip\` untuk lewat`
  );
  
  this.phase = 'judge_decision';
  this.timers.judgeDecision = setTimeout(() => {
    if (this.phase === 'judge_decision') { // SAFETY CHECK
      this.broadcast("⚖️ Judge tidak membuat keputusan.");
      this.proceedToNight();
    }
  }, 30000);
}

  async processLynchEffects(victim) {
    // Hunter revenge
    if (victim.role === 'Hunter' && victim.canRevenge) {
      this.pendingHunter = victim.id;
      await this.dm(victim.id, 
        `🏹 **BALAS DENDAM HUNTER** 🏹\n\n` +
        `Sebelum mati, pilih satu untuk dibawa bersamamu!\n\n` +
        `${this.listPlayers()}\n\n` +
        `Balas: \`/<nomor>\``
      );
      
      this.timers.hunterTimeout = setTimeout(() => {
        if (this.pendingHunter === victim.id) {
          this.pendingHunter = null;
          this.broadcast("🏹 Panah Hunter tidak dilepaskan.");
          this.checkWinCondition();
        }
      }, this.HUNTER_REVENGE_TIMEOUT);
      return;
    }
    
    // Lil Wolvy effect - wolves get double kill next night
    if (victim.role === 'Lil Wolvy') {
      this.lilWolvyKilled = true;
      await this.broadcast("🐺 **AMARAH KAWANAN!** Kematian si kecil membakar api dendam, Serigala akan berburu 2 korban malam ini!");
    }
    
    // Loudmouth effect - SELALU TERUNGKAP apapun revelation mode-nya
    if (victim.role === 'Loudmouth' && victim.target) {
      const target = this.players[victim.target];
      if (target) {
        await this.broadcast(
          `📢 **TERIAKAN TERAKHIR!** ${victim.username} berteriak mengungkap identitas ${target.username}: **${target.role}**!`
        );
      }
    }
  }

  proceedToNight() {
    if (this.pendingHunter) return; // Wait for hunter revenge
    
    setTimeout(() => {
      if (this.inGame) this.startNight();
    }, 5000);
  }

  // ================= WIN CONDITIONS =================

  async checkWinCondition() {
    const alive = this.alivePlayers();
    const wolves = alive.filter(p => this.isWolfTeam(p));
    const village = alive.filter(p => p.team === 'Baik');
    const neutrals = alive.filter(p => p.team === 'Netral');
    
    // Check Tanner win (highest priority)
    for (const player of Object.values(this.players)) {
      if (player.role === 'Tanner' && !player.alive && player.lastKillMethod === 'vote') {
        await this.broadcast(
          `👺 *TANNER MENANG!* ${player.username} berhasil membuat dirinya digantung! ` +
          `Kekacauan total melanda desa!`
        );
        this.endGame();
        return true;
      }
    }

  if (this.lovers.length === 2) {
    const aliveLover1 = alive.find(p => p.id === this.lovers[0]);
    const aliveLover2 = alive.find(p => p.id === this.lovers[1]);
    
    if (aliveLover1 && aliveLover2 && alive.length === 2) {
      // Find the Cupid who created this love bond
      const cupid = Object.values(this.players).find(p => p.role === 'Cupid');
      
      let winMessage = `💘 **LOVERS MENANG!** ${aliveLover1.username} dan ${aliveLover2.username} bertahan bersama sampai akhir! Cinta sejati mengalahkan segalanya!`;
      
      if (cupid) {
        if (cupid.alive) {
          winMessage += `\n\n💘 **CUPID IKUT MENANG!** ${cupid.username} berhasil menciptakan cinta yang mengalahkan semua kekuatan jahat!`;
        } else {
          winMessage += `\n\n💘 **CUPID MENANG DARI ALAM BAKA!** Arwah ${cupid.username} tersenyum bahagia melihat ikatan cinta ciptaannya menang!`;
        }
      }
      
      await this.broadcast(winMessage);
      this.endGame();
      return true;
    }
  }
    
    // Check Headhunter win
    for (const player of Object.values(this.players)) {
      if (player.role === 'Headhunter' && player.alive && player.target) {
        const target = this.players[player.target];
        if (target && !target.alive && target.lastKillMethod === 'vote') {
          await this.broadcast(
            `🎯 **HEADHUNTER MENANG!** ${player.username} berhasil ` +
            `membuat targetnya digantung!`
          );
          this.endGame();
          return true;
        }
      }
    }
    
    // Check solo wins
    if (alive.length === 1) {
      const survivor = alive[0];
      let winMessage = "";
      
      switch (survivor.role) {
        case 'Serial Killer':
          winMessage = `🔪 **SERIAL KILLER MENANG!** ${survivor.username} membantai semua!`;
          break;
        case 'Arsonist':
          winMessage = `🔥 **ARSONIST MENANG!** ${survivor.username} membakar dunia!`;
          break;
        case 'Cannibal':
          winMessage = `🖤 **CANNIBAL MENANG!** ${survivor.username} memakan semua!`;
          break;
        default:
          winMessage = `👑 **${survivor.username} MENANG SENDIRI!** Satu-satunya survivor!`;
      }
      
      await this.broadcast(winMessage);
      this.endGame();
      return true;
    }
    
    // Check team wins
    if (wolves.length === 0) {
      await this.broadcast(
        `🌅 **DESA MENANG!** Semua serigala telah dibasmi!\n\n` +
        `**Pemenang:**\n${village.map(p => `• ${p.username} (${p.role})`).join('\n')}`
      );
      this.endGame();
      return true;
    }
    
    if (wolves.length >= village.length) {
      await this.broadcast(
        `🐺 **SERIGALA MENANG!** Kegelapan menguasai Eldermoor!\n\n` +
        `**Pemenang:**\n${wolves.map(p => `• ${p.username} (${p.role})`).join('\n')}`
      );
      this.endGame();
      return true;
    }
    
    return false;
  }

  // ================= WHISPER SYSTEM =================

  async whisper(senderGId, targetGId, text) {
    const sender = this.players[senderGId];
    const target = this.players[targetGId];
    
    if (!sender || !target) return false;
    
    await this.dm(target.id, `📩 **Whisper dari ${sender.username}:**\n\n${text}`);
    this.whisperReplies[targetGId] = senderGId;
    this.whispers[senderGId] = { to: targetGId, lastText: text };
    
    return true;
  }

  async replyWhisper(responderGId, text) {
    const lastFrom = this.whisperReplies[responderGId];
    if (!lastFrom) {
      await this.dm(responderGId, "❌ Tidak ada whisper untuk dibalas.");
      return false;
    }
    
    return this.whisper(responderGId, lastFrom, text);
  }

  // ================= GAME MANAGEMENT =================

  async forceEndGame(hostGId) {
    if (hostGId !== this.hostId) return false;
    
    await this.broadcast("🛑 **Permainan dihentikan paksa oleh host.**");
    this.endGame();
    return true;
  }

   async endGame() {
    if (this.showRolesAtEnd) {
      const allPlayers = Object.values(this.players)
        .map(p => {
          let roleDisplay = p.role;
          if (p.role === 'Fool') {
            roleDisplay = `${p.role} yang bodoh mengira dirinya Seer`;
          }
          return `${p.alive ? '💚' : '💀'} ${p.username} - **${roleDisplay}** (${p.team})`;
        })
        .join('\n');
      
      await this.broadcast(
        `📋 **DAFTAR LENGKAP PEMAIN:**\n\n${allPlayers}\n\n` +
        `Terima kasih telah bermain di Eldermoor yang terkutuk! 🎭`
      );
    }

    this.clearAllTimers();
      if (this.pendingHunter) {
        this.pendingHunter = null;
      }
    
    this.inGame = false;
    this.inLobby = false;
    this.phase = null;
    this.clearAllTimers();
  }

  // ================= ADDITIONAL FEATURES =================

  async showGameComposition() {
    if (!this.inGame) return;
    
    let compositionText = '';
    
    switch (this.revelationMode) {
      case 'HIDDEN':
        compositionText = `Total pemain: ${this.playerCount()} orang\nSemua identitas tersembunyi.`;
        break;
        
      case 'AURA_ONLY':
        const auraCounts = {};
        Object.values(this.players).forEach(p => {
          if (p.alive) {
            auraCounts[p.aura] = (auraCounts[p.aura] || 0) + 1;
          }
        });
        compositionText = `**Komposisi Aura (Hidup):**\n` + 
          Object.entries(auraCounts)
            .map(([aura, count]) => `• ${aura}: ${count} orang`)
            .join('\n');
        break;
        
      case 'PROGRESSIVE':
        if (this.day <= 1) {
          compositionText = `Total pemain: ${this.playerCount()} orang\nInformasi akan terungkap bertahap.`;
        } else if (this.day === 2) {
          const auraCounts = {};
          Object.values(this.players).forEach(p => {
            if (p.alive) {
              auraCounts[p.aura] = (auraCounts[p.aura] || 0) + 1;
            }
          });
          compositionText = `**Komposisi Aura (Hari 2):**\n` + 
            Object.entries(auraCounts)
              .map(([aura, count]) => `• ${aura}: ${count} orang`)
              .join('\n');
        } else {
          const aliveRoles = this.alivePlayers().map(p => p.role);
          const roleCounts = {};
          aliveRoles.forEach(role => {
            roleCounts[role] = (roleCounts[role] || 0) + 1;
          });
          compositionText = `**Komposisi Role (Hidup):**\n` +
            Object.entries(roleCounts)
              .map(([role, count]) => `• ${role}: ${count} orang`)
              .join('\n');
        }
        break;
        
      case 'FULL':
      default:
        const aliveRoles = this.alivePlayers().map(p => p.role);
        const roleCounts = {};
        aliveRoles.forEach(role => {
          roleCounts[role] = (roleCounts[role] || 0) + 1;
        });
        compositionText = `**Komposisi Role (Hidup):**\n` +
          Object.entries(roleCounts)
            .map(([role, count]) => `• ${role}: ${count} orang`)
            .join('\n');
        break;
    }
    
    await this.broadcast(`📊 **STATUS PERMAINAN HARI ${this.day}**\n\n${compositionText}`);
  }

  // ================= UTILITY =================

  getGameStats() {
    if (!this.inGame) return null;
    
    return {
      day: this.day,
      phase: this.phase,
      totalPlayers: this.playerCount(),
      alivePlayers: this.alivePlayers().length,
      aliveWolves: this.playersOfTeam('Jahat').length,
      hideRoles: this.hideRoles,
      revelationMode: this.revelationMode
    };
  }

  getPlayerStatus(gId) {
    const player = this.players[gId];
    if (!player) return null;
    
    return {
      username: player.username,
      role: this.hideRoles ? player.aura : player.role,
      alive: player.alive,
      day: this.day,
      phase: this.phase
    };
  }

  // ================= ADMIN COMMANDS =================

  async setRevelationModeCommand(hostGId, mode) {
    if (hostGId !== this.hostId) return false;
    
    const success = this.setRevelationMode(mode);
    if (success) {
      await this.broadcast(`🔧 **Mode revelation diubah ke: ${this.revelationMode}**`);
      return true;
    }
    
    await this.broadcast(`❌ Mode tidak valid. Pilihan: FULL, HIDDEN, AURA_ONLY, PROGRESSIVE`);
    return false;
  }

  async forceKillPlayer(hostGId, targetUsername) {
    if (hostGId !== this.hostId) return false;
    
    const target = Object.values(this.players).find(p => 
      p.username.toLowerCase() === targetUsername.toLowerCase() && p.alive
    );
    
    if (!target) {
      await this.broadcast(`❌ Pemain ${targetUsername} tidak ditemukan atau sudah mati.`);
      return false;
    }
    
    target.alive = false;
    target.lastKillMethod = 'admin_kill';
    await this.broadcast(`🔧 **${target.username} dibunuh oleh Dewa!**`);
    
    setTimeout(() => this.checkWinCondition(), 1000);
    return true;
  }

  async forceRevivePlayer(hostGId, targetUsername) {
    if (hostGId !== this.hostId) return false;
    
    const target = Object.values(this.players).find(p => 
      p.username.toLowerCase() === targetUsername.toLowerCase() && !p.alive
    );
    
    if (!target) {
      await this.broadcast(`❌ Pemain ${targetUsername} tidak ditemukan atau masih hidup.`);
      return false;
    }
    
    target.alive = true;
    await this.broadcast(`🔧 **${target.username} dibangkitkan oleh Dewa!**`);
    return true;
  }
}

module.exports = WerewolfGame;