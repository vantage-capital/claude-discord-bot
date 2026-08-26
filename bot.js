require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const WORK_DIR = '/root';
const DASHBOARD_URL = 'http://127.0.0.1:3000/report';

const CHANNEL_AGENTS = {
  '1490287319167537234': 'market-intelligence-analyst',
  '1490287347756171428': 'investment-recommendation',
  '1490287384577835049': 'client-intelligence-briefer',
};

const CHANNEL_TITLES = {
  '1490287319167537234': '📊 Market Intelligence',
  '1490287347756171428': '💡 Investment Recommendation',
  '1490287384577835049': '👥 Client Intelligence',
};

const CHANNEL_COLORS = {
  '1490287319167537234': 0x378ADD,
  '1490287347756171428': 0x7F77DD,
  '1490287384577835049': 0xBA7517,
};

const GENERAL_CHANNEL = '1489140389465165947';

async function runAgent(agentName, prompt) {
  return new Promise((resolve, reject) => {
    const AIRTABLE_TOOLS = "mcp__airtable__list_records_for_table,mcp__airtable__search_records,mcp__airtable__list_tables_for_base,mcp__airtable__get_table_schema,mcp__airtable__list_bases,mcp__airtable__list_bases";
    const cmd = `cd ${WORK_DIR} && claude -p "Use the ${agentName} to: ${prompt}" --allowedTools "Read,Write,Bash,WebSearch,WebFetch,${AIRTABLE_TOOLS}" --output-format json < /dev/null`;
    exec(cmd, { timeout: 900000 }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch {
        reject('Failed to parse response');
      }
    });
  });
}

async function sendReport(result, agentName, prompt, message, title, color) {
  const response = result.result || '';
  const cost = result.total_cost_usd ? `$${result.total_cost_usd.toFixed(4)}` : 'N/A';
  const duration = result.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)}s` : 'N/A';

  fetch(DASHBOARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: Date.now().toString(),
      agent: agentName,
      prompt,
      result: response,
      cost: result.total_cost_usd || 0,
      duration: result.duration_ms || 0,
      searches: result.usage?.server_tool_use?.web_search_requests || 0,
      timestamp: new Date().toISOString()
    })
  }).catch(err => console.error('Dashboard error:', err));

  const chunks = [];
  let text = response;
  while (text.length > 0) {
    chunks.push(text.slice(0, 1024));
    text = text.slice(1024);
  }

  const embed = new EmbedBuilder()
    .setColor(color || 0x0099FF)
    .setTitle(title || 'Agent Response')
    .setDescription(chunks[0] || 'No response.')
    .setFooter({ text: `Cost: ${cost} | Duration: ${duration} | ${agentName}` })
    .setTimestamp();

  for (let i = 1; i < Math.min(chunks.length, 5); i++) {
    embed.addFields({ name: '\u200b', value: chunks[i] });
  }

  await message.reply({ embeds: [embed] });
}

client.on('clientReady', () => {
  console.log(`Bot is online as ${client.user.tag}`);
  console.log('Servers:', client.guilds.cache.map(g => `${g.name} (${g.id})`));
  console.log('Watching channels:', Object.keys(CHANNEL_AGENTS));
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channelId = message.channelId;
  const content = message.content.trim();

  console.log(`Message in channel ${channelId}: ${content}`);

  if (CHANNEL_AGENTS[channelId]) {
    if (!content) return;
    const agentName = CHANNEL_AGENTS[channelId];
    const title = CHANNEL_TITLES[channelId];
    const color = CHANNEL_COLORS[channelId];

    await message.reply('⏳ Working on it...');
    try {
      const result = await runAgent(agentName, content);
      await sendReport(result, agentName, content, message, title, color);
    } catch (err) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Agent Error')
        .setDescription(String(err))
        .setTimestamp();
      await message.reply({ embeds: [errorEmbed] });
    }
    return;
  }

  if (channelId === GENERAL_CHANNEL) {
    if (!content.startsWith('!agent')) return;
    const parts = content.replace('!agent', '').trim().split(' ');
    const agentName = parts[0];
    const prompt = parts.slice(1).join(' ');

    if (!prompt) return message.reply('Usage: `!agent <agent-name> <your request>`');

    await message.reply(`⏳ Running **${agentName}**...`);
    try {
      const result = await runAgent(agentName, prompt);
      await sendReport(result, agentName, prompt, message, `🤖 ${agentName}`, 0x888888);
    } catch (err) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Agent Error')
        .setDescription(String(err))
        .setTimestamp();
      await message.reply({ embeds: [errorEmbed] });
    }
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
