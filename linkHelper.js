// linkHelper.js
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const LINKS_FILE = path.join(DATA_DIR, "user_links.json");

class LinkHelper {
  constructor() {
    this.ensureDataDir();
    this.links = this.loadLinks();
    this.pendingLinks = new Map(); // groupId -> { code, expires, groupMemberId }
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadLinks() {
    try {
      if (fs.existsSync(LINKS_FILE)) {
        const data = fs.readFileSync(LINKS_FILE, "utf8");
        return JSON.parse(data);
      }
    } catch (err) {
      console.error("Error loading user links:", err);
    }
    return {};
  }

  saveLinks() {
    try {
      fs.writeFileSync(LINKS_FILE, JSON.stringify(this.links, null, 2));
    } catch (err) {
      console.error("Error saving user links:", err);
    }
  }

  // Generate random 6-digit code
  generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Start linking process from group
  async initiateLinking(sock, groupId, groupMemberId, username) {
    const code = this.generateCode();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.pendingLinks.set(groupMemberId, {
      code,
      expires,
      groupId,
      groupMemberId,
      username
    });

    // Send code via DM
    try {
      await sock.sendMessage(groupMemberId, {
        text: `🔗 *KODE LINK AKUN*\n\nKode linkmu: *${code}*\n\nKetik: */link ${code}*\n\n⚠️ Kode berlaku 5 menit.`
      });
      return true;
    } catch (err) {
      console.error("Failed to send link code:", err);
      this.pendingLinks.delete(groupMemberId);
      return false;
    }
  }

  // Confirm linking from DM
  confirmLink(dmId, inputCode) {
    // Find pending link by code
    let pendingLink = null;
    let groupMemberId = null;

    for (const [memberId, link] of this.pendingLinks.entries()) {
      if (link.code === inputCode && link.expires > Date.now()) {
        pendingLink = link;
        groupMemberId = memberId;
        break;
      }
    }

    if (!pendingLink) {
      return false; // Invalid or expired code
    }

    // Create the link
    this.links[dmId] = {
      groupId: pendingLink.groupId,
      groupMemberId: groupMemberId,
      username: pendingLink.username,
      customUsername: null, // Will be set with /usn command
      linkedAt: new Date().toISOString(),
      linked: true
    };

    // Also create reverse mapping
    this.links[groupMemberId] = {
      dmId: dmId,
      groupId: pendingLink.groupId,
      username: pendingLink.username,
      customUsername: null, // Will be set with /usn command
      linkedAt: new Date().toISOString(),
      linked: true
    };

    this.pendingLinks.delete(groupMemberId);
    this.saveLinks();
    return true;
  }

  // Get user info by any ID (DM or group member ID)
  getUser(id) {
    const link = this.links[id];
    if (!link || !link.linked) {
      return null;
    }
    return {
      username: link.customUsername || link.username, // Prefer custom username
      displayName: link.username, // Original WhatsApp name
      linkedAt: link.linkedAt
    };
  }

  // Set custom username
  setCustomUsername(id, customUsername) {
    const link = this.links[id];
    if (!link || !link.linked) {
      return null;
    }

    // Update both directions of the link
    const correspondingId = link.dmId || link.groupMemberId;
    
    this.links[id].customUsername = customUsername;
    if (correspondingId && this.links[correspondingId]) {
      this.links[correspondingId].customUsername = customUsername;
    }

    this.saveLinks();
    return {
      username: customUsername,
      displayName: link.username,
      linkedAt: link.linkedAt
    };
  }

  // Check if custom username is taken
  isUsernameTaken(username, excludeId = null) {
    const lowerUsername = username.toLowerCase();
    
    for (const [id, link] of Object.entries(this.links)) {
      if (id === excludeId) continue;
      if (!link.linked) continue;
      
      const currentUsername = (link.customUsername || link.username).toLowerCase();
      if (currentUsername === lowerUsername) {
        return true;
      }
    }
    return false;
  }

  // Get link info by ID
  getLinks(id) {
    return this.links[id] || null;
  }

  // Get all users
  getAllUsers() {
    return this.links;
  }

  // Get user info for /myid command
  getMyId(id) {
    const link = this.links[id];
    if (!link) {
      return "❌ Akun belum terhubung. Gunakan /link di grup untuk menghubungkan akun.";
    }

    if (!link.linked) {
      return "❌ Proses linking belum selesai. Coba /link lagi di grup.";
    }

    const displayUsername = link.customUsername || link.username;
    const info = `📱 *INFORMASI AKUN*

👤 Username Game: *${displayUsername}*
📱 WhatsApp Name: ${link.username}
🔗 Status: Terhubung
📅 Linked: ${new Date(link.linkedAt).toLocaleString('id-ID')}
🆔 Group ID: ${link.groupId?.substring(0, 20)}...
🆔 DM ID: ${link.dmId?.substring(0, 20) || id.substring(0, 20)}...

💡 Gunakan /usn <nama> untuk mengubah username game.`;

    return info;
  }

  // Check if user is linked (can be called with either DM ID or group member ID)
  isLinked(id) {
    const link = this.links[id];
    return link && link.linked;
  }

  // Get the corresponding ID (if given DM ID, return group member ID and vice versa)
  getCorrespondingId(id) {
    const link = this.links[id];
    if (!link || !link.linked) {
      return null;
    }
    
    return link.dmId || link.groupMemberId;
  }

  // Clean expired pending links (call this periodically)
  cleanExpiredLinks() {
    const now = Date.now();
    for (const [key, link] of this.pendingLinks.entries()) {
      if (link.expires < now) {
        this.pendingLinks.delete(key);
      }
    }
  }

  // Remove a user's link
  removeLink(id) {
    const link = this.links[id];
    if (link) {
      // Remove both directions of the link
      if (link.dmId) {
        delete this.links[link.dmId];
      }
      if (link.groupMemberId) {
        delete this.links[link.groupMemberId];
      }
      delete this.links[id];
      this.saveLinks();
      return true;
    }
    return false;
  }
  
  getDmId(groupMemberId) {
    const link = this.links[groupMemberId];
    if (link && link.dmId) return link.dmId;
    return null;
  }

  getGroupMemberId(dmId) {
    const link = this.links[dmId];
    if (link && link.groupMemberId) return link.groupMemberId;
    return null;
  }

}

// Singleton instance
const linkHelper = new LinkHelper();

// Clean expired links every 10 minutes
setInterval(() => {
  linkHelper.cleanExpiredLinks();
}, 10 * 60 * 1000);

module.exports = linkHelper;