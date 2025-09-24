// fix_existing_data.js - Run this once to clean up corrupted links
const fs = require("fs");
const path = require("path");

const usersFile = path.join(__dirname, "data", "users.json");
const linksFile = path.join(__dirname, "data", "user_links.json");

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function fixExistingData() {
  console.log("🔧 Starting data cleanup...");
  
  let users = loadJson(usersFile);
  let links = loadJson(linksFile);
  
  console.log("📊 Current users:", Object.keys(users));
  console.log("📊 Current links:", Object.keys(links));
  
  // First, let's identify the real phone number and username
  let realPhoneNumber = null;
  let username = null;
  
  // Look for existing user data
  for (const [userId, userData] of Object.entries(users)) {
    if (userId.endsWith("@s.whatsapp.net")) {
      realPhoneNumber = userId.split('@')[0];
      username = userData.username;
      console.log("✅ Found real user:", userId, "->", username);
      break;
    }
  }
  
  if (!realPhoneNumber || !username) {
    console.log("❌ Cannot find existing user data with proper format");
    console.log("❌ You need to set username first with /usn in DM");
    return;
  }
  
  // Clean up links - remove corrupted entries
  const cleanedLinks = {};
  
  // Create proper participant ID (simple format)
  const participantId = `${realPhoneNumber}@lid`;
  const dmId = `${realPhoneNumber}@s.whatsapp.net`;
  
  console.log("🔧 Creating clean link mapping:");
  console.log("  - Participant ID:", participantId);
  console.log("  - DM ID:", dmId);
  
  // Create proper link structure
  const linkData = {
    participantId: participantId,
    dmId: dmId,
    linked: true, // Set to linked automatically
    linkCode: "FIXED", // Dummy code since it's already linked
    lastLinkedAt: Date.now()
  };
  
  cleanedLinks[participantId] = linkData;
  cleanedLinks[dmId] = linkData;
  
  // Save cleaned data
  saveJson(linksFile, cleanedLinks);
  
  // Also make sure user data is properly formatted
  const cleanedUsers = {};
  cleanedUsers[dmId] = { username, createdAt: users[dmId]?.createdAt || Date.now() };
  saveJson(usersFile, cleanedUsers);
  
  console.log("✅ Data cleanup completed!");
  console.log("📋 New links:", Object.keys(cleanedLinks));
  console.log("📋 New users:", Object.keys(cleanedUsers));
}

// Run the fix
fixExistingData();