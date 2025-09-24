// Eldermoor Dramatic Broadcast Messages for Group Events

// Welcome Messages for New Members (randomly selected) - now includes names
const welcomeMessages = [
  (displayName) => `🌙 **SELAMAT DATANG DI ELDERMOOR** 🌙

Langit kelam menyambut kedatangan seorang jiwa baru...

🕯️ Kabut tebal menyelimuti desa terkutuk ini, di mana kepercayaan adalah kemewahan yang langka dan kecurigaan adalah kunci bertahan hidup. Langkah kaki ${displayName} telah menyentuh tanah yang dibasahi darah dan air mata.

🐺 Di kejauhan, lolongan serigala bergema melalui hutan gelap. Mereka mengetahui kehadiranmu, ${displayName}. Mereka sedang mengintai dari bayang-bayang, menunggu momen yang tepat untuk menerkam.

⚡ Takdir telah membawa ${displayName} ke tempat ini. Apakah kau akan menjadi penyelamat yang dibutuhkan desa, ataukah justru menjadi bagian dari kegelapan yang mengancam?

🕰️ Waktu terus berdetak... dan malam semakin mendekat.

💀 *Selamat datang, ${displayName}, di dunia di mana tidak ada yang bisa dipercaya sepenuhnya, dan setiap pilihan bisa menjadi yang terakhir.*

🔗 Ketik /link untuk menghubungkan jiwamu dengan takdir Eldermoor.`,

  (displayName) => `🌫️ **GERBANG ELDERMOOR TERBUKA** 🌫️

Angin dingin membawa aroma kematian saat ${displayName} memasuki desa...

🏚️ Rumah-rumah tua berdiri kokoh bagaikan saksi bisu dari tragedi yang telah berlalu. Jendela-jendela gelap menatap tajam pada ${displayName}, seolah menilai apakah kau layak bertahan hidup di tempat ini.

🌙 Bulan sabit menyinari jalan berliku yang telah dilalui ${displayName}. Tidak ada jalan kembali. Eldermoor telah menerimamu, dan sekarang kau terikat dengan nasib penduduk lainnya.

👁️ Mata-mata tak terlihat mengawasi ${displayName} dari celah-celah kegelapan. Beberapa penuh harapan, berharap kau adalah sekutu. Yang lain... mereka melihatmu sebagai mangsa.

🗡️ Di sini, setiap senyuman bisa menyembunyikan niat jahat. Setiap tawa bisa menutupi haus darah. Dan setiap janji bisa menjadi jebakan mematikan.

🎭 Topeng-topeng telah dipasang, peran telah dibagikan. Permainan telah dimulai sejak lama, dan kini ${displayName} adalah bagian darinya.

⚔️ *Bertahan hidup bukan hanya soal kekuatan, tetapi juga tentang kepintaran membaca hati manusia.*

🎮 Mulai perjalananmu dengan /link - jika kau berani, ${displayName}.`,

  (displayName) => `⚡ **KEDATANGAN YANG DITAKDIRKAN** ⚡

Petir menyambar... kilatan cahaya menerangi wajah ${displayName} di Eldermoor...

🌊 Seperti ombak yang menghantam karang, takdir telah membawa ${displayName} ke pantai yang berbahaya ini. Desa Eldermoor bukan tempat untuk yang lemah hati.

🕷️ Jaring-jaring kecurigaan telah ditenun rapat. Setiap penduduk adalah pemain dalam permainan mematikan di mana satu kesalahan bisa berarti kematian. ${displayName} kini menjadi bagian dari permainan ini.

🔥 Api perapian berkedip-kedip di rumah-rumah, tetapi kehangatan sejati sulit ditemukan. Hati yang dingin dan pikiran yang tajam adalah satu-satunya yang bisa diandalkan, ${displayName}.

🦉 Burung hantu bersuara nyaring dari menara lonceng tua, memberitahu seluruh desa bahwa ${displayName} telah tiba. Apakah ini pertanda baik atau buruk?

⚰️ Kuburan di pinggir desa semakin ramai setiap harinya. Batu nisan baru terus bertambah, menyimpan nama-nama mereka yang gagal bertahan dalam permainan mematikan ini.

🎪 Pertunjukan besar sedang berlangsung, dan ${displayName} telah mendapat tiket masuk. Apakah kau akan menjadi bintang pertunjukan, atau justru menjadi korban?

🌟 *Bintang-bintang di langit Eldermoor tidak memberikan harapan, melainkan menyaksikan tragedi demi tragedi.*

🔮 Nasib ${displayName} kini terjalin dengan yang lain. Gunakan /link untuk memulai babak barumu.`
];

// Farewell Messages for Leaving Members (randomly selected) - now includes names
const farewellMessages = [
  (displayName) => `💀 **KEPERGIAN YANG MENYISAKAN JEJAK** 💀

Bayangan gelap menyelimuti Eldermoor... ${displayName} telah meninggalkan desa...

🌫️ Kabut malam menelan sosok ${displayName} yang pergi, meninggalkan hanya jejak kaki di tanah yang basah. Eldermoor merasakan kehilangan, meski tak semua kehilangan itu disesali.

⚱️ Apakah kepergian ${displayName} adalah pelarian dari takdir yang mengerikan? Ataukah justru bagian dari rencana yang lebih besar dan lebih kelam?

🕯️ Lilin-lilin di jendela bergoyang tertiup angin, seolah memberikan penghormatan terakhir untuk ${displayName}. Atau mungkin... sebuah peringatan bagi yang tersisa.

🐺 Serigala-serigala di hutan melolong lebih pilu malam ini. Mereka kehilangan satu target, atau mungkin... kehilangan satu rekan bernama ${displayName}?

⚡ Langit mendung semakin gelap. Hujan mulai turun, membasuh jejak-jejak yang ditinggalkan ${displayName}. Seolah alam ingin menghapus memori akan kehadiran yang telah hilang.

🌙 Bulan bersembunyi di balik awan tebal. Bahkan cahaya pun enggan menyinari kepergian ${displayName}.

👻 *Eldermoor tidak pernah benar-benar melepaskan siapa pun. Roh ${displayName} akan selalu tertinggal dalam kenangan dan mimpi buruk.*

🕰️ Waktu terus berdetak untuk yang tersisa. Permainan belum berakhir...`,

  (displayName) => `🌪️ **ANGIN PERPISAHAN BERHEMBUS** 🌪️

Daun-daun kering berterbangan... membawa serta kenangan akan ${displayName} yang telah pergi...

🏚️ Pintu sebuah rumah terbuka lebar, berderit tertiup angin. Kosong. Sunyi. Hanya menyisakan gema dari tawa dan tangis ${displayName} yang pernah terdengar.

🕊️ Seekor burung gagak hinggap di ambang jendela, menatap ke dalam ruangan kosong. Bahkan makhluk kegelapan pun merasa ada yang kurang tanpa kehadiran ${displayName}.

⚔️ Medan perang Eldermoor kehilangan satu pejuang. Entah pahlawan atau penjahat, kepergian ${displayName} meninggalkan lubang dalam permainan besar ini.

🌹 Bunga mawar di taman layu seketika, seolah ikut berduka atas kepergian ${displayName} yang tak terduga. Atau mungkin lega karena ancaman telah hilang?

📜 Cerita Eldermoor kehilangan satu bab tentang ${displayName}. Akankah ini membuat kisah lebih indah, ataukah justru lebih tragis?

🎭 Topeng yang pernah dikenakan ${displayName} kini tergeletak di tanah, ditinggalkan begitu saja. Identitas sejati tak akan pernah terungkap.

⏳ *Waktu adalah hakim yang adil. Ia akan menentukan apakah kepergian ${displayName} adalah keselamatan atau justru permulaan dari penyesalan.*

🌟 Bintang di langit berkedip redup, memberikan penghormatan terakhir untuk ${displayName} yang telah memilih jalannya sendiri.`
];

// Special welcome for first-time member - now includes name
const firstMemberWelcome = (displayName) => `👑 **PELOPOR ELDERMOOR TELAH TIBA** 👑

Keheningan desa terpecah oleh langkah kaki ${displayName}...

🌟 ${displayName} adalah yang pertama. Yang berani membuka gerbang menuju dunia yang penuh misteri dan bahaya. Sejarah Eldermoor dimulai dari ${displayName}.

🔮 Kristal takdir berkilau terang, menandakan dimulainya sebuah legenda baru. ${displayName} adalah perintis, penjelajah pertama yang memasuki domain yang belum dijamah.

🗝️ Kunci gerbang Eldermoor kini berada di tangan ${displayName}. Keputusanmu akan menentukan siapa yang layak mengikuti jejak langkahmu ke dalam kegelapan ini.

🏰 Kastil tua di puncak bukit menyala untuk pertama kalinya dalam berabad-abad. Pemilik sejati Eldermoor, ${displayName}, telah tiba.

🐉 Naga-naga kuno terbangun dari tidur panjang mereka. Mereka merasakan kehadiran ${displayName} yang akan mengubah segalanya.

⚡ *${displayName} bukan sekadar pemain. Kau adalah raja pertama di tanah yang akan dihuni oleh para pejuang berani.*

🎯 Gunakan /link untuk mengklaim takhtamu sebagai Pelopor Eldermoor, ${displayName}.`;

// Function to get random welcome message
function getRandomWelcomeMessage(displayName) {
  const randomIndex = Math.floor(Math.random() * welcomeMessages.length);
  return welcomeMessages[randomIndex](displayName);
}

// Function to get random farewell message  
function getRandomFarewellMessage(displayName) {
  const randomIndex = Math.floor(Math.random() * farewellMessages.length);
  return farewellMessages[randomIndex](displayName);
}

// Function to get display name from WhatsApp ID
async function getDisplayName(sock, jid) {
  try {
    const contact = await sock.onWhatsApp(jid);
    if (contact && contact[0] && contact[0].notify) {
      return contact[0].notify;
    }
    // Fallback to phone number
    const number = jid.split('@')[0];
    return `User${number.slice(-4)}`;
  } catch (err) {
    console.error("Error getting display name:", err);
    const number = jid.split('@')[0];
    return `User${number.slice(-4)}`;
  }
}

// Function to handle group participant updates
async function handleGroupParticipantUpdate(sock, groupId, participants, action) {
  try {
    for (const participant of participants) {
      let message = '';
      
      // Get participant's display name
      const displayName = await getDisplayName(sock, participant);
      
      if (action === 'add') {
        // Check if this is the first member
        const groupMetadata = await sock.groupMetadata(groupId);
        const memberCount = groupMetadata.participants.length;
        
        if (memberCount === 1) {
          message = firstMemberWelcome(displayName);
        } else {
          message = getRandomWelcomeMessage(displayName);
        }
        
      } else if (action === 'remove') {
        message = getRandomFarewellMessage(displayName);
      }
      
      if (message) {
        // Add dramatic delay for effect
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await sock.sendMessage(groupId, { 
          text: message,
          mentions: action === 'add' ? [participant] : []
        });
      }
    }
  } catch (error) {
    console.error('Error sending broadcast message:', error);
  }
}

// Usage example in your main WhatsApp bot code:
/*
sock.ev.on('group-participants.update', async (update) => {
  const { id, participants, action } = update;
  
  if (action === 'add' || action === 'remove') {
    await handleGroupParticipantUpdate(sock, id, participants, action);
  }
});
*/

module.exports = {
  welcomeMessages,
  farewellMessages,
  firstMemberWelcome,
  getRandomWelcomeMessage,
  getRandomFarewellMessage,
  getDisplayName,
  handleGroupParticipantUpdate
};