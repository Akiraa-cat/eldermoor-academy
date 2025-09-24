// index.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require('qrcode-terminal');
const { handleGroupParticipantUpdate } = require("./broadcast-messages");
const CommandHandler = require("./command");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");

  const sock = makeWASocket({
    auth: state,
    // Remove the deprecated printQRInTerminal option
  });

  // Use Map to store handlers per group
  const handlers = new Map();

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    // Handle QR code manually
    if (qr) {
      console.log("📱 Scan QR code di bawah ini:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot berhasil terhubung!");
    } else if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Koneksi terputus:", lastDisconnect?.error);
      
      if (shouldReconnect) {
        console.log("🔄 Mencoba reconnect...");
        startBot();
      } else {
        console.log("🚪 Logged out. Hapus folder 'session' dan restart bot untuk login ulang.");
      }
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
     try {
       const { id, participants, action } = update;
       console.log(`👥 Group participant update - Group: ${id}, Action: ${action}, Participants:`, participants);
       if (action === 'add' || action === 'remove') {
         await handleGroupParticipantUpdate(sock, id, participants, action);
       }
     } catch (error) {
       console.error("⚠️ Error handling group participant update:", error);
     }
   });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;

    const from = m.key.remoteJid; // grup atau DM
    const isGroup = from.endsWith("@g.us");
    const sender = m.key.participant || from; // DM → sama dengan from

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      null;

    if (!text) return;

    console.log(
      `💬 Pesan diterima dari ${sender} di ${isGroup ? "GRUP" : "DM"}: ${text}`
    );

    if (text.startsWith("/")) {
      try {
        // Get or create handler for this group/context
        let handler;
        const handlerKey = isGroup ? from : "global"; // Use group ID as key, or "global" for DMs
        
        if (!handlers.has(handlerKey)) {
          handler = new CommandHandler(sock, isGroup ? from : null);
          handlers.set(handlerKey, handler);
          console.log(`🔧 Created new handler for ${handlerKey}`);
        } else {
          handler = handlers.get(handlerKey);
        }

        await handler.handleCommand(from, text, isGroup, sender);
      } catch (err) {
        console.error("⚠️ Error saat handleCommand:", err);

        // fallback: kalo group → balas ke group, kalo DM → balas ke sender
        const target = isGroup ? from : sender;

        await sock.sendMessage(target, {
          text: "❌ Terjadi error saat memproses command.",
        });
      }
    }
  });
}

startBot();