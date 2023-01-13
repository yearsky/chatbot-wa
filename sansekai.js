const {
  BufferJSON,
  WA_DEFAULT_EPHEMERAL,
  generateWAMessageFromContent,
  proto,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  areJidsSameUser,
  getContentType,
} = require("@adiwajshing/baileys");
const fs = require("fs");
const util = require("util");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const chalk = require("chalk");
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config();

module.exports = sansekai = async (client, m, chatUpdate, store) => {
  try {
    var body =
      m.mtype === "conversation"
        ? m.message.conversation
        : m.mtype == "imageMessage"
        ? m.message.imageMessage.caption
        : m.mtype == "videoMessage"
        ? m.message.videoMessage.caption
        : m.mtype == "extendedTextMessage"
        ? m.message.extendedTextMessage.text
        : m.mtype == "buttonsResponseMessage"
        ? m.message.buttonsResponseMessage.selectedButtonId
        : m.mtype == "listResponseMessage"
        ? m.message.listResponseMessage.singleSelectReply.selectedRowId
        : m.mtype == "templateButtonReplyMessage"
        ? m.message.templateButtonReplyMessage.selectedId
        : m.mtype === "messageContextInfo"
        ? m.message.buttonsResponseMessage?.selectedButtonId ||
          m.message.listResponseMessage?.singleSelectReply.selectedRowId ||
          m.text
        : "";
    // console.log(client)
    // console.log(m)
    var budy = typeof m.text == "string" ? m.text : "";
    // var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/"
    var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/";
    const isCmd2 = body.startsWith(prefix);
    const command = body
      .replace(prefix, "")
      .trim()
      .split(/ +/)
      .shift()
      .toLowerCase();
    const args = body.trim().split(/ +/);
    const pushname = m.pushName || "No Name";
    const botNumber = await client.decodeJid(client.user.id);
    const doc = new GoogleSpreadsheet(
      "1T51M2Rbn0tNMXTnFbXyQUlIFWPwFf9qtSjvNdmhPNho"
    );
    const itsMe = m.sender == botNumber ? true : false;
    let text = (q = args.slice(1).join(" "));
    const arg = budy.trim().substring(budy.indexOf(" ") + 1);

    const arg1 = arg.trim().substring(arg.indexOf(" ") + 1);

    const from = m.chat;
    const reply = m.reply;
    const sender = m.sender;
    let setting = process.env;
    const auto_ai = setting.AUTO_AI == "false" ? false : true;
    const mek = chatUpdate.messages[0];
    const t_tugas = "List Tugas";
    const lowerTugasText = t_tugas.toLowerCase();
    const lowerBudyText = budy.toLowerCase();
    const txtCmd = lowerBudyText.startsWith(lowerTugasText) ? true : false;

    const color = (text, color) => {
      return !color ? chalk.green(text) : chalk.keyword(color)(text);
    };
    // Group
    const groupMetadata = m.isGroup
      ? await client.groupMetadata(m.chat).catch((e) => {})
      : "";
    const groupName = m.isGroup ? groupMetadata.subject : "";
    // Push Message To Console
    let argsLog = budy.length > 30 ? `${q.substring(0, 30)}...` : budy;

    if (setting.auto_ai) {
      // Push Message To Console && Auto Read
      if (argsLog && !m.isGroup) {
        // client.sendReadReceipt(m.chat, m.sender, [m.key.id])
        console.log(
          chalk.black(chalk.bgWhite("[ LOGS ]")),
          color(argsLog, "turquoise"),
          chalk.magenta("From"),
          chalk.green(pushname),
          chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`)
        );
      } else if (argsLog && m.isGroup) {
        // client.sendReadReceipt(m.chat, m.sender, [m.key.id])
        console.log(
          chalk.black(chalk.bgWhite("[ LOGS ]")),
          color(argsLog, "turquoise"),
          chalk.magenta("From"),
          chalk.green(pushname),
          chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`),
          chalk.blueBright("IN"),
          chalk.green(groupName)
        );
      }
    } else if (!setting.auto_ai) {
      if (isCmd2 && !m.isGroup) {
        console.log(
          chalk.black(chalk.bgWhite("[ LOGS ]")),
          color(argsLog, "turquoise"),
          chalk.magenta("From"),
          chalk.green(pushname),
          chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`)
        );
      } else if (isCmd2 && m.isGroup) {
        console.log(
          chalk.black(chalk.bgWhite("[ LOGS ]")),
          color(argsLog, "turquoise"),
          chalk.magenta("From"),
          chalk.green(pushname),
          chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`),
          chalk.blueBright("IN"),
          chalk.green(groupName)
        );
      }
    }

    if (setting.auto_ai) {
      if (budy) {
        try {
          const configuration = new Configuration({
            apiKey: setting.OPENAI_SECRET_KEY,
          });
          const openai = new OpenAIApi(configuration);

          const response = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: budy,
            temperature: 0.3,
            max_tokens: 3000,
            top_p: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
          });
          m.reply(`${response.data.choices[0].text}\n\n`);
        } catch (err) {
          console.log(err);
          m.reply("Maaf, sepertinya ada yang error");
        }
      }
    }

    if (!setting.auto_ai) {
      if (isCmd2) {
        switch (command) {
          case "kai":
            try {
              if (!text) return reply(`Halo ada apa?`);
              const configuration = new Configuration({
                apiKey: setting.OPENAI_SECRET_KEY,
                headers: {
                  Authorization: `Bearer ${setting.OPENAI_SECRET_KEY}`,
                },
              });
              const openai = new OpenAIApi(configuration);

              const response = await openai.createCompletion({
                model: "text-davinci-003",
                prompt: text,
                temperature: 0,
                max_tokens: 3000,
                top_p: 1.0,
                frequency_penalty: 0.0,
                presence_penalty: 0.0,
              });
              m.reply(`${response.data.choices[0].text}\n\n`);
            } catch (err) {
              console.log(err);
              m.reply("Maaf, sepertinya ada yang error");
            }
            break;
          case "help":
            try {
              const txt = `*Saya bisa memberikan informasi terkait:*\n\n 1. Jadwal Tugas Multimedia 😏\n\n Contoh: Tugas 5 February 2023.\n\n 2. Input Jadwal Tugas 📝\n Contoh: Input Tugas {nama} {Tanggal} \n\n 3. Bible 📃 \n Contoh: Alkitab,Kej 1\n\n 4. Bisa jadi teman kamu😎 \n\n "Saat kesepian menghampiri, jangan merasa sendiri. Aku bisa menjadi teman baikmu yang akan mendengarkan, memahami, dan memberikan dukungan dalam setiap kondisi. Bersama kita akan mengatasi kesepian dan membuat hidupmu lebih bermakna 🤜🤛." \n\nPanggil aku dengan *#kai* maka aku akan menjawab semua pertanyaan kamu\n\n Contoh: #kai cara mempunyai pasangan agar tidak kesepian`;
              return reply(txt);
            } catch (err) {
              console.log(err);
              m.reply("Maaf, kai sepertinya tidak tau apa yang anda maksut :(");
            }
            break;
          default: {
            if (isCmd2 && budy.toLowerCase() != undefined) {
              if (m.chat.endsWith("broadcast")) return;
              if (m.isBaileys) return;
              if (!budy.toLowerCase()) return;
              if (argsLog || (isCmd2 && !m.isGroup)) {
                // client.sendReadReceipt(m.chat, m.sender, [m.key.id])
                console.log(
                  chalk.black(chalk.bgRed("[ ERROR ]")),
                  color("command", "turquoise"),
                  color(argsLog, "turquoise"),
                  color("tidak tersedia", "turquoise")
                );
              } else if (argsLog || (isCmd2 && m.isGroup)) {
                // client.sendReadReceipt(m.chat, m.sender, [m.key.id])
                console.log(
                  chalk.black(chalk.bgRed("[ ERROR ]")),
                  color("command", "turquoise"),
                  color(argsLog, "turquoise"),
                  color("tidak tersedia", "turquoise")
                );
              }
            }
          }
        }
      }
    }

    if (txtCmd) {
      let getDateText = lowerBudyText
        .replace(/ /g, "")
        .replace("listtugas,", "");
      let toDate = new Date(getDateText);
      m.reply(`Sebentar ya, lagi proses permintaan mu 😉`);
      if (!isNaN(toDate)) {
        try {
          await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY,
          });

          await doc.loadInfo(); // loads document properties and worksheets
          const sheet = doc.sheetsByIndex[0];
          const rows = await sheet.getRows();
          const fmDate = formatDate(getDateText);
          let filter_data = rows.filter((el) => {
            return formatDate(el.Tanggal) == fmDate;
          });

          if (filter_data.length === "") {
            m.reply(`🤖 : Beep,beep data tidak ditemukan!`);
            return false;
          }
          let respond;
          let dataArray = [];

          for (let i = 0; i < filter_data.length; i++) {
            nama = filter_data[i].Nama;
            tanggal = filter_data[i].Tanggal;
            tugas = filter_data[i].Tugas;
            wib = filter_data[i].WIB;

            respond = `\n[${
              i + 1
            }]Nama = ${nama}, \nTugas = ${tugas}, \nPukul = ${wib}\n`;
            dataArray.push(respond);
          }
          result =
            `Berikut adalah data yang bertugas:\n` +
            dataArray.join("\n") +
            `\nSelamat Melayani ya ❤️🤍`;
          return reply(result);
        } catch (err) {
          console.log(err);
          m.reply(
            "Maaf, kai sekarang lagi pusing jadi ga bisa proses permintaan mu 😵‍💫"
          );
        }
      } else {
        m.reply(
          "Emm, Sepertinya ada yang salah 😞 Apakah kamu sudah menambahkan tanggal yang valid?\nContoh: List Tugas, 5 Februari 2023"
        );
      }
    }
  } catch (err) {
    m.reply(util.format(err));
  }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});

function formatDate(date) {
  var d = new Date(date),
    month = "" + (d.getMonth() + 1),
    day = "" + d.getDate(),
    year = d.getFullYear();

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return [year, month, day].join("-");
}
