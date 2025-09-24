// anti-spam.js - Handler Anti-Spam yang Lebih Santai
class AntiSpamHandler {
  constructor() {
    // Tracking user messages: userId -> { count, lastMessage, firstMessageTime, warnings }
    this.userMessages = new Map();
    
    // Spam thresholds - MADE MORE RELAXED
    this.MAX_MESSAGES_PER_MINUTE = 40; // Increased from 20 to 40
    this.MAX_SAME_MESSAGE = 15; // Increased from 10 to 15
    this.WARNING_THRESHOLD = 12; // Increased from 5 to 12
    this.TIMEOUT_DURATION = 30000; // Reduced from 60 to 30 seconds
    this.RESET_TIME = 90000; // Increased from 60 to 90 seconds (longer grace period)
    this.BURST_ALLOWANCE = 8; // Allow 8 quick messages before checking rate
    
    // Respon kocak untuk spammer (lebih santai)
    this.spamResponses = [
      "🐵 Woy, pelan-pelan dong! Gak usah buru-buru!",
      "🚫 Santai bang! Botnya masih hidup kok, gak perlu di-flood!",
      "😅 Kebanyakan semangat nih! Break dulu 30 detik ya!",
      "🤡 Antusias banget sih! Tapi slow down dikit dong!",
      "🦆 Cuakkk! Kelamaan ngetik, istirahat bentar!",
      "🔥 Woah woah, calm down fire! Cooling time 30 detik!",
      "🚨 Spam alert! Tapi santai aja, cuma timeout bentar!",
      "💀 Keyboard overheating detected! Let it rest!",
      "🍕 Order spam pizza? Yang ada cuma timeout 30 detik!",
      "🎪 Easy there, tiger! Take a 30-second breather!"
    ];
    
    this.warningResponses = [
      "⚠️ Hey, slow down a bit! Jangan terburu-buru!",
      "🐌 Easy does it! Ini bukan lomba ngetik!",
      "😊 Santai aja bro, pelan-pelan tapi pasti!",
      "🎯 Quality over quantity ya!",
      "🧘‍♂️ Deep breath... No rush!",
      "🚦 Yellow light! Pelan-pelan aja!",
      "🎮 Combo breaker! Slow down untuk avoid spam!"
    ];
    
    // More chill blocked responses
    this.blockedResponses = [
      "🔒 Timeout ${remaining} detik lagi! Santai aja!",
      "⏰ Cooling down ${remaining} detik. Grab some snacks!",
      "🚫 Still chilling for ${remaining} seconds! Relax!",
      "🧊 Ice time! ${remaining} detik lagi ya!",
      "💤 Power nap ${remaining} detik. See ya soon!",
      "☕ Coffee break! ${remaining} detik tersisa!",
      "🎵 Listen to music for ${remaining} seconds!",
      "📱 Check Instagram dulu, ${remaining} detik lagi!"
    ];
    
    // Blocked users (temporary timeout)
    this.blockedUsers = new Map();
  }

  isSpamming(userId, message) {
    const now = Date.now();
    const userStats = this.userMessages.get(userId);

    // Clean up expired blocks
    this.cleanupBlockedUsers(now);

    // Check if user is currently blocked
    if (this.isBlocked(userId)) {
      // Only respond every 10 seconds to avoid spam responses
      const lastBlockResponse = this.blockedUsers.get(userId + '_lastResponse') || 0;
      if (now - lastBlockResponse > 10000) {
        this.blockedUsers.set(userId + '_lastResponse', now);
        return {
          isSpam: true,
          action: 'blocked',
          response: this.getRandomBlockedResponse(userId)
        };
      }
      return { isSpam: true, action: 'blocked_silent' };
    }

    // Initialize user stats if first time
    if (!userStats) {
      this.userMessages.set(userId, {
        count: 1,
        lastMessage: message,
        firstMessageTime: now,
        lastMessageTime: now,
        warnings: 0,
        sameMessageCount: 1,
        burstCount: 1
      });
      return { isSpam: false };
    }

    // Reset count if more than RESET_TIME has passed
    if (now - userStats.firstMessageTime > this.RESET_TIME) {
      this.userMessages.set(userId, {
        count: 1,
        lastMessage: message,
        firstMessageTime: now,
        lastMessageTime: now,
        warnings: 0,
        sameMessageCount: 1,
        burstCount: 1
      });
      return { isSpam: false };
    }

    // Update stats
    userStats.count++;
    const timeSinceLastMessage = now - userStats.lastMessageTime;
    userStats.lastMessageTime = now;
    
    // Reset burst count if more than 5 seconds between messages
    if (timeSinceLastMessage > 5000) {
      userStats.burstCount = 1;
    } else {
      userStats.burstCount++;
    }
    
    // Check for same message spam
    if (userStats.lastMessage === message) {
      userStats.sameMessageCount++;
    } else {
      userStats.sameMessageCount = 1;
      userStats.lastMessage = message;
    }

    // Check spam conditions - MORE LENIENT
    const timeWindow = now - userStats.firstMessageTime;
    const messagesPerMinute = (userStats.count / timeWindow) * 60000;

    // Only check spam if burst allowance exceeded
    if (userStats.burstCount <= this.BURST_ALLOWANCE) {
      return { isSpam: false };
    }

    // Same message spam (copy-paste spam) - more tolerance
    if (userStats.sameMessageCount >= this.MAX_SAME_MESSAGE) {
      this.blockUser(userId);
      return {
        isSpam: true,
        action: 'timeout',
        response: this.getRandomResponse() + "\n\n🔄 *Too many identical messages!*"
      };
    }

    // Too many messages in short time - more tolerance
    if (messagesPerMinute > this.MAX_MESSAGES_PER_MINUTE && userStats.count > 15) {
      this.blockUser(userId);
      return {
        isSpam: true,
        action: 'timeout',
        response: this.getRandomResponse()
      };
    }

    // Warning threshold - more lenient
    if (userStats.count >= this.WARNING_THRESHOLD && userStats.warnings === 0 && messagesPerMinute > 25) {
      userStats.warnings = 1;
      return {
        isSpam: false,
        action: 'warning',
        response: this.getRandomWarningResponse()
      };
    }

    return { isSpam: false };
  }

  blockUser(userId) {
    const blockUntil = Date.now() + this.TIMEOUT_DURATION;
    this.blockedUsers.set(userId, blockUntil);
    
    // Reset user stats
    this.userMessages.delete(userId);
  }

  isBlocked(userId) {
    const blockUntil = this.blockedUsers.get(userId);
    if (!blockUntil) return false;
    
    if (Date.now() > blockUntil) {
      this.blockedUsers.delete(userId);
      this.blockedUsers.delete(userId + '_lastResponse');
      return false;
    }
    
    return true;
  }

  cleanupBlockedUsers(now) {
    for (const [userId, blockUntil] of this.blockedUsers.entries()) {
      if (userId.includes('_lastResponse')) continue; // Skip response tracking entries
      
      if (now > blockUntil) {
        this.blockedUsers.delete(userId);
        this.blockedUsers.delete(userId + '_lastResponse');
      }
    }
  }

  getRandomResponse() {
    return this.spamResponses[Math.floor(Math.random() * this.spamResponses.length)];
  }

  getRandomWarningResponse() {
    return this.warningResponses[Math.floor(Math.random() * this.warningResponses.length)];
  }

  getRandomBlockedResponse(userId) {
    const remaining = this.getRemainingTime(userId);
    const template = this.blockedResponses[Math.floor(Math.random() * this.blockedResponses.length)];
    return template.replace('${remaining}', remaining);
  }

  getRemainingTime(userId) {
    const blockUntil = this.blockedUsers.get(userId);
    if (!blockUntil) return 0;
    
    return Math.ceil((blockUntil - Date.now()) / 1000);
  }

  // Check if user is approaching spam limits (for gentle warnings)
  isApproachingSpam(userId) {
    const stats = this.userMessages.get(userId);
    if (!stats) return false;
    
    const now = Date.now();
    const timeWindow = now - stats.firstMessageTime;
    const messagesPerMinute = (stats.count / timeWindow) * 60000;
    
    return stats.count > 8 && messagesPerMinute > 20 && stats.warnings === 0;
  }

  // Get user stats for debugging
  getUserStats(userId) {
    const stats = this.userMessages.get(userId);
    const blocked = this.isBlocked(userId);
    const remaining = blocked ? this.getRemainingTime(userId) : 0;
    
    return {
      stats: stats || null,
      blocked,
      remainingTime: remaining,
      approachingSpam: this.isApproachingSpam(userId)
    };
  }

  // Reset user stats (for admin)
  resetUser(userId) {
    this.userMessages.delete(userId);
    this.blockedUsers.delete(userId);
    this.blockedUsers.delete(userId + '_lastResponse');
    return true;
  }

  // Whitelist user temporarily (for admin - gives 2 minute immunity)
  whitelistUser(userId, duration = 120000) {
    this.userMessages.set(userId + '_whitelist', Date.now() + duration);
  }

  isWhitelisted(userId) {
    const whitelistUntil = this.userMessages.get(userId + '_whitelist');
    if (!whitelistUntil) return false;
    
    if (Date.now() > whitelistUntil) {
      this.userMessages.delete(userId + '_whitelist');
      return false;
    }
    
    return true;
  }

  // Get global stats
  getGlobalStats() {
    const activeBlocks = [...this.blockedUsers.entries()]
      .filter(([key]) => !key.includes('_lastResponse'))
      .map(([userId, blockUntil]) => ({
        userId,
        remaining: Math.ceil((blockUntil - Date.now()) / 1000)
      }));

    return {
      activeUsers: this.userMessages.size,
      blockedUsers: activeBlocks.length,
      totalBlocked: activeBlocks
    };
  }
}

module.exports = AntiSpamHandler;