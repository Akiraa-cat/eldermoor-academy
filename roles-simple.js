// roles-simple.js — Simple Edition dengan narasi super dramatis

function listRoles() {
  return [
    "🐺 *Werewolf* — Makhluk buas yang lapar darah. Setiap malam kalian mengaum di kegelapan, " +
      "mencabik-cabik seorang warga tanpa ampun. Kalian menang ketika bayangan menelan Eldermoor.",

    "👹 *Alpha Werewolf* — Pemimpin kawanan serigala. Aura kelammu membuat yang lain tunduk. " +
      "Jika kau berkuasa, hanya teror yang tersisa di desa ini.",

    "🐍 *Traitor* — Mata-mu tampak polos, tapi hatimu busuk. Kau warga yang berkhianat, " +
      "menunggu saat desa runtuh untuk tertawa bersama para serigala.",

    "🔮 *Seer* — Pewaris mata batin kuno. Setiap malam kau menyingkap satu jiwa, " +
      "mencari kebenaran yang terkubur di balik senyuman palsu.",

    "👼 *Guardian Angel* — Sayap sucimu membentang di atas desa. Kau pilih satu jiwa tiap malam, " +
      "mencegah maut merenggut mereka... jika takdir mengizinkan.",

    "🏹 *Hunter* — Pemanah terakhir Eldermoor. Jika kau mati karena suara warga, " +
      "panah sucimu akan mencari dada seorang pendosa sebelum napas terakhirmu padam.",

    "🧙‍♀️ *Witch* — Penyihir kesepian dengan dua botol rapuh: satu berisi kehidupan, satu berisi maut. " +
      "Hanya sekali kau bisa mencicipkan ramuan itu... lalu takdir akan berubah selamanya.",

    "🕵️ *Detective* — Mata yang mengintai di balik bayangan. Kau mengikuti langkah seseorang tiap malam, " +
      "dan menemukan apakah ia berpihak pada terang... atau hanyut dalam kegelapan.",

    "👨‍🌾 *Villager* — Warga sederhana tanpa kekuatan gaib. Namun jangan remehkan, " +
      "suaramu di alun-alun bisa lebih menusuk daripada taring serigala."
  ];
}

// Informasi role untuk DM pemain saat game dimulai
function roleInfo(role) {
  const map = {
    "Werewolf":
      "🐺 Kau adalah *Werewolf*! Setiap malam pilih korban untuk dimangsa bersama kawananmu. " +
      "Kau menang bila desa ditelan kegelapan.",

    "Alpha Werewolf":
      "👹 Kau adalah *Alpha Werewolf*! Aura kelammu menuntun kawananmu. " +
      "Dalam permainan besar, taringmu adalah simbol dominasi.",

    "Traitor":
      "🐍 Kau adalah *Traitor*! Kau terlihat sebagai warga, namun hatimu milik serigala. " +
      "Kau menang bersama mereka, meski mereka tak mengenalmu.",

    "Seer":
      "🔮 Kau adalah *Seer*! Setiap malam kau dapat menyingkap identitas seseorang. " +
      "Gunakan matamu yang bercahaya untuk melindungi desa.",

    "Guardian Angel":
      "👼 Kau adalah *Guardian Angel*! Sayap sucimu mampu melindungi satu jiwa dari serangan malam. " +
      "Kau adalah benteng terakhir desa.",

    "Hunter":
      "🏹 Kau adalah *Hunter*! Jika kau mati karena voting, kau dapat menarik satu orang " +
      "bersamamu ke liang lahat.",

    "Witch":
      "🧙‍♀️ Kau adalah *Witch*! Kau memiliki dua ramuan: penyembuh dan racun. " +
      "Kedua ramuan hanya bisa digunakan sekali seumur hidup.",

    "Detective":
      "🕵️ Kau adalah *Detective*! Setiap malam kau menyelidiki seseorang dan mengetahui apakah ia " +
      "bersekutu dengan kegelapan atau tidak.",

    "Villager":
      "👨‍🌾 Kau hanyalah *Villager*. Tak ada kekuatan gaib, hanya suara dan intuisi. " +
      "Namun seringkali, justru itulah senjata paling tajam."
  };
  return map[role] || role;
}

// Narasi khusus ketika role terbunuh
function deathFlavor(role, name) {
  const map = {
    "Werewolf": `🌑 Jasad ${name} ditemukan hancur. Rahasia terbongkar: ia adalah *Werewolf*! Taringnya kini patah, kawanan kehilangan kekuatan.`,
    "Alpha Werewolf": `👹 Dengan jeritan terakhir, ${name} roboh. Sang pemimpin kegelapan, *Alpha Werewolf*, akhirnya tumbang.`,
    "Traitor": `🐍 ${name} tewas dengan senyum sinis. Ternyata ia adalah *Traitor*, warga yang menusuk dari dalam.`,
    "Seer": `🔮 ${name} ditemukan mati dengan bola kristal hancur berkeping-keping. Cahaya terakhir sang *Seer* padam.`,
    "Guardian Angel": `👼 Sayap ${name} patah di tanah. *Guardian Angel* desa gugur, dan cahaya perlindungan pun meredup.`,
    "Hunter": `🏹 ${name} jatuh, tapi panah terakhirnya melesat tajam. *Hunter* tidak pergi sendirian.`,
    "Witch": `🧙‍♀️ ${name} ditemukan dengan botol ramuan pecah. *Witch* telah pergi, meninggalkan rahasia di dalam kabut.`,
    "Detective": `🕵️ ${name} ditemukan mati di sudut jalan. Catatan penyelidikan sang *Detective* berserakan, sebagian terbakar.`,
    "Villager": `👨‍🌾 ${name}, seorang warga biasa, kini terbujur kaku. Suaranya tak akan lagi terdengar di alun-alun.`
  };
  return map[role] || `💀 ${name} tewas tragis malam itu.`;
}

module.exports = { listRoles, roleInfo, deathFlavor };
