const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');

// =========================
// ⚙️ الإعدادات الأساسية
// =========================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// 📦 قاعدة البيانات (نظام الجولات)
// =========================
let db;
try {
  db = JSON.parse(fs.readFileSync('./database.json'));
} catch {
  db = {
    currentRound: 1,
    rounds: {
      "1": { teams: {}, players: {} }
    },
    liveScore: { channelId: null, messageId: null },
    logChannelId: null
  };
}

function saveDB() {
  fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

// =========================
// 🛠️ وظائف مساعدة
// =========================

// تحديث الـ Live Score
async function updateLiveScore(guild) {
  if (!db.liveScore.channelId || !db.liveScore.messageId) return;

  const channel = guild.channels.cache.get(db.liveScore.channelId);
  if (!channel) return;

  try {
    const msg = await channel.messages.fetch(db.liveScore.messageId);
    const roundData = db.rounds[db.currentRound];

    const topTeams = Object.entries(roundData.teams)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const topPlayers = Object.entries(roundData.players)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const embed = new EmbedBuilder()
      .setTitle(`📊 النتائج الحية - الجولة ${db.currentRound}`)
      .setColor("#2f3136")
      .setDescription("يتم تحديث هذه اللوحة تلقائياً فورياً")
      .addFields(
        {
          name: "🏆 أفضل 3 فرق",
          value: topTeams.map((t, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
            const role = guild.roles.cache.get(t[0]);
            return `${medal} **${role?.name || "فريق غير معروف"}**: ${t[1]} نقطة`;
          }).join("\n") || "لا توجد بيانات بعد",
          inline: false
        },
        {
          name: "👤 أفضل 3 لاعبين",
          value: topPlayers.map((p, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
            return `${medal} <@${p[0]}>: ${p[1]} نقطة`;
          }).join("\n") || "لا توجد بيانات بعد",
          inline: false
        }
      )
      .setTimestamp();

    await msg.edit({ embeds: [embed] });
  } catch (e) {
    console.error("Error updating live score:", e);
  }
}

// إرسال لوج
async function sendLog(guild, content) {
  if (!db.logChannelId) return;
  const channel = guild.channels.cache.get(db.logChannelId);
  if (channel) channel.send({ embeds: [content] });
}

// =========================
// 🚀 تسجيل الأوامر (Slash Commands)
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('إضافة نقاط للاعب وفريقه')
    .addUserOption(opt => opt.setName('user').setDescription('اللاعب').setRequired(true))
    .addRoleOption(opt => opt.setName('team').setDescription('الفريق').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('العدد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('dis')
    .setDescription('خصم نقاط من لاعب وفريقه')
    .addUserOption(opt => opt.setName('user').setDescription('اللاعب').setRequired(true))
    .addRoleOption(opt => opt.setName('team').setDescription('الفريق').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('العدد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('score')
    .setDescription('عرض ترتيب الفرق'),

  new SlashCommandBuilder()
    .setName('lb')
    .setDescription('عرض ترتيب اللاعبين'),

  new SlashCommandBuilder()
    .setName('mr')
    .setDescription('عرض مركزك ونقاطك'),

  new SlashCommandBuilder()
    .setName('mtr')
    .setDescription('عرض مركز فريقك'),

  new SlashCommandBuilder()
    .setName('next-round')
    .setDescription('بدء جولة جديدة وأرشفة الحالية'),

  new SlashCommandBuilder()
    .setName('round')
    .setDescription('عرض بيانات جولة سابقة')
    .addIntegerOption(opt => opt.setName('num').setDescription('رقم الجولة').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setup-channels')
    .setDescription('إعداد قنوات اللوج والسكور المباشر')
    .addChannelOption(opt => opt.setName('log').setDescription('قناة السجلات').setRequired(true))
    .addChannelOption(opt => opt.setName('live').setDescription('قناة السكور المباشر').setRequired(true)),

  new SlashCommandBuilder()
    .setName('reset-all')
    .setDescription('تصفير كل البيانات والجولات (نهائي)')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('جاري تحديث أوامر السلاش...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('تم تحديث الأوامر بنجاح!');
  } catch (error) {
    console.error(error);
  }
})();

// =========================
// 🎮 معالجة الأوامر
// =========================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, member, user: executer } = interaction;
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.ManageGuild);

  // 1. أمر الإضافة والخصم
  if (commandName === 'add' || commandName === 'dis') {
    if (!isAdmin) return interaction.reply({ content: "⛔ هذا الأمر للمشرفين فقط", ephemeral: true });

    const targetUser = options.getUser('user');
    const targetRole = options.getRole('team');
    const amount = options.getInteger('amount');
    const isAdd = commandName === 'add';

    const roundData = db.rounds[db.currentRound];
    const multiplier = isAdd ? 1 : -1;

    roundData.players[targetUser.id] = (roundData.players[targetUser.id] || 0) + (amount * multiplier);
    roundData.teams[targetRole.id] = (targetRole.id in roundData.teams ? roundData.teams[targetRole.id] : 0) + (amount * multiplier);

    saveDB();

    const embed = new EmbedBuilder()
      .setTitle(isAdd ? "➕ تم إضافة نقاط" : "➖ تم خصم نقاط")
      .setColor(isAdd ? "#2ecc71" : "#e74c3c")
      .setDescription(`تم ${isAdd ? 'إضافة' : 'خصم'} **${amount} نقطة** لـ <@${targetUser.id}>`)
      .addFields(
        { name: "👥 الفريق", value: `**${targetRole.name}**`, inline: false },
        { name: "👤 نقاط اللاعب", value: `**${roundData.players[targetUser.id]}**`, inline: true },
        { name: "🏆 نقاط الفريق", value: `**${roundData.teams[targetRole.id]}**`, inline: true }
      );

    await interaction.reply({ embeds: [embed] });

    // اللوج واللايف سكور
    const logEmbed = new EmbedBuilder()
      .setTitle(isAdd ? "Log: إضافة نقاط" : "Log: خصم نقاط")
      .setColor(isAdd ? "#2ecc71" : "#e74c3c")
      .addFields(
        { name: "المشرف", value: `<@${executer.id}>`, inline: true },
        { name: "المستلم", value: `<@${targetUser.id}>`, inline: true },
        { name: "الكمية", value: `${amount}`, inline: true },
        { name: "الجولة", value: `${db.currentRound}`, inline: true }
      ).setTimestamp();

    sendLog(guild, logEmbed);
    updateLiveScore(guild);
  }

  // 2. أوامر الترتيب (Score & LB) مع Pagination
  if (commandName === 'score' || commandName === 'lb') {
    const isTeam = commandName === 'score';
    const roundData = db.rounds[db.currentRound];
    const sorted = Object.entries(isTeam ? roundData.teams : roundData.players)
      .sort((a, b) => b[1] - a[1]);

    let page = 0;
    const size = 10;

    const generateEmbed = (p) => {
      const start = p * size;
      const pageData = sorted.slice(start, start + size);

      const desc = pageData.map((item, i) => {
        const rank = start + i;
        const medal = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `**#${rank + 1}**`;
        const identifier = isTeam ? (guild.roles.cache.get(item[0])?.name || "فريق محذوف") : `<@${item[0]}>`;
        return `${medal} ${identifier} — **${item[1]}** نقطة`;
      }).join("\n\n");

      return new EmbedBuilder()
        .setTitle(isTeam ? `🏆 ترتيب الفرق - الجولة ${db.currentRound}` : `🏅 ترتيب اللاعبين - الجولة ${db.currentRound}`)
        .setDescription(desc || "لا توجد بيانات حالياً")
        .setColor(isTeam ? "#1E88E5" : "#FFD600")
        .setFooter({ text: `صفحة ${p + 1} من ${Math.ceil(sorted.length / size) || 1}` });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({ embeds: [generateEmbed(page)], components: [row], fetchReply: true });

    const collector = response.createMessageComponentCollector({ time: 60000 });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: "لا يمكنك التحكم في هذا القائمة", ephemeral: true });
      if (i.customId === 'next') page++;
      if (i.customId === 'prev') page--;
      if (page < 0) page = 0;
      if (page >= Math.ceil(sorted.length / size)) page = Math.ceil(sorted.length / size) - 1;
      await i.update({ embeds: [generateEmbed(page)], components: [row] });
    });
  }

  // =========================
  // مركزك ومركز فريقك (mr & mtr)
  // =========================
  if (commandName === 'mr') {
    const roundData = db.rounds[db.currentRound];
    const sorted = Object.entries(roundData.players).sort((a, b) => b[1] - a[1]);
    const userId = interaction.user.id;
    
    // بندور على مركز اللاعب
    const rankIndex = sorted.findIndex(x => x[0] === userId);
    const rank = rankIndex !== -1 ? rankIndex + 1 : "غير مصنف";
    const points = roundData.players[userId] || 0;

    return interaction.reply(`📊 أنت في المركز **#${rank}**\n🏅 نقاطك: **${points}**`);
  }

  if (commandName === 'mtr') {
    const roundData = db.rounds[db.currentRound];
    
    // بندور على الرتبة بتاعة اللاعب اللي متسجلة كفريق في الداتا بيز
    const teamRole = interaction.member.roles.cache.find(r => roundData.teams[r.id] !== undefined);

    if (!teamRole) {
      return interaction.reply({ content: "❌ أنت لا تنتمي لأي فريق مسجل، أو أن فريقك لم يحصل على أي نقاط بعد في هذه الجولة.", ephemeral: true });
    }

    const sorted = Object.entries(roundData.teams).sort((a, b) => b[1] - a[1]);
    const rank = sorted.findIndex(x => x[0] === teamRole.id) + 1;
    const points = roundData.teams[teamRole.id];

    return interaction.reply(`🏆 فريقك (**${teamRole.name}**) في المركز **#${rank}**\n🏅 النقاط: **${points}**`);
  }


  // 3. نظام الجولات
  if (commandName === 'next-round') {
    if (!isAdmin) return interaction.reply({ content: "⛔ للمشرفين فقط", ephemeral: true });
    db.currentRound++;
    db.rounds[db.currentRound] = { teams: {}, players: {} };
    saveDB();
    interaction.reply(`✅ تم بدء **الجولة ${db.currentRound}** بنجاح. البيانات السابقة مؤرشفة.`);
    updateLiveScore(guild);
  }

  if (commandName === 'round') {
    const rNum = options.getInteger('num');
    const rData = db.rounds[rNum];
    if (!rData) return interaction.reply({ content: "❌ هذه الجولة غير موجودة", ephemeral: true });

    const topTeams = Object.entries(rData.teams).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const embed = new EmbedBuilder()
      .setTitle(`📚 أرشيف الجولة ${rNum}`)
      .setColor("#95a5a6")
      .setDescription(topTeams.map((t, i)=> `#${i+1} ${guild.roles.cache.get(t[0])?.name || t[0]}: ${t[1]}ن`).join("\n") || "لا بيانات");

    interaction.reply({ embeds: [embed] });
  }

  // 4. الإعدادات
  if (commandName === 'setup-channels') {
    if (!isAdmin) return interaction.reply("⛔ للمشرفين فقط");
    const logChan = options.getChannel('log');
    const liveChan = options.getChannel('live');

    db.logChannelId = logChan.id;
    db.liveScore.channelId = liveChan.id;

    const liveEmbed = new EmbedBuilder().setTitle("لوحة النتائج المباشرة").setDescription("جاري التحميل...");
    const liveMsg = await liveChan.send({ embeds: [liveEmbed] });
    db.liveScore.messageId = liveMsg.id;

    saveDB();
    interaction.reply("✅ تم إعداد القنوات بنجاح!");
    updateLiveScore(guild);
  }

  if (commandName === 'reset-all') {
    if (!isAdmin) return interaction.reply("⛔ للمشرفين فقط");
    db = { currentRound: 1, rounds: { "1": { teams: {}, players: {} } }, liveScore: { channelId: null, messageId: null }, logChannelId: null };
    saveDB();
    interaction.reply("♻️ تم مسح كافة البيانات والجولات.");
  }
});

client.login(TOKEN);
