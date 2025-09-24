const roles = require("./roles.json");

function getRoleInfo(role) {
  return roles[role] || null;
}

function listRoles() {
  return Object.keys(roles).map((r) => {
    const info = roles[r];
    return `${info.emoji} *${r}* (${info.team})\n⚔️ ${info.nightAction}\n${info.description}`;
  });
}

function isGood(role) {
  const good = [
    "Seer",
    "Detective",
    "Guardian Angel",
    "Hunter",
    "Gunner",
    "Harlot",
    "Cupid",
    "Mason",
    "Angel",
    "Fool",
    "Witch",
    "Wild Child",
  ];
  return good.includes(role);
}

function isEvil(role) {
  const evil = [
    "Werewolf",
    "Alpha Werewolf",
    "Cursed", 
    "Traitor",
    "Lycan",
  ];
  return evil.includes(role);
}

function isNeutral(role) {
  return [
    "Arsonist",
    "Serial Killer",
    "Doppelganger",
    "Tanner",
    "Siren"
  ].includes(role);
}

module.exports = { getRoleInfo, listRoles, isGood, isEvil, isNeutral };
