const fs = require("fs");
const USERS_FILE = "./users.json";

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function set(id, username) {
  const users = loadUsers();
  if (!users[id]) {
    users[id] = { username, createdAt: Date.now() };
  } else {
    users[id].username = username;
  }
  saveUsers(users);
  return users[id];
}

function get(id) {
  const users = loadUsers();
  return users[id]?.username || null;
}

// restored for compatibility
function getUser(id) {
  const users = loadUsers();
  return users[id] || null;
}

function all() {
  return loadUsers();
}

module.exports = {
  set,
  get,
  getUser,
  all,
};
