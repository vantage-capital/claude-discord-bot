require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { execFile } = require('child_process');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

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

// The agents run as the user hub-agent, never root: through the root-owned runner the Hub's own agents use
// (intelligence-hub scheduler/agent-user, installed by its install.sh). It drops to hub-agent with an empty
// environment, so with Bash in its tools an agent can no longer read root's files (the Hub's and vantage-api's .env:
// the proxy secret, the database password) or this bot's Discord token. There is no fallback to root's claude: if
// the runner is not installed the run fails and the reply says so.
const AGENT_RUN = process.env.HUB_AGENT_RUN || '/usr/local/lib/hub-agent/agent-run.sh';
const AGENT_TOOLS = 'Read,Write,Bash,WebSearch,WebFetch';

// No Airtable MCP tools: the firm has left Airtable. The agents read the CRM with the Hub's crm-read.js and a reader
// token (GET on the tables, as viewer, nothing else), as the scheduled agents do (intelligence-hub
// scheduler/run_agent.sh, CRM_NOTE: the same words), whatever their own definitions still say about Airtable.
const CRM_READ = '/usr/local/lib/hub-agent/crm/crm-read.js';
const CRM_NOTE = 'The firm\'s CRM (clients in MFP Database, Trades, Meeting Notes, Pending Log, Documents and the other ' +
  'tables) is not in Airtable and there are no Airtable tools. Read it, read-only, with Bash: ' +
  `'node ${CRM_READ} tables' lists the tables; ` +
  `'node ${CRM_READ} "<table name>" --search <text> --fields "<A>,<B>" --limit <n>' prints records as JSON by field ` +
  'name. The newest agent reports are in /var/lib/hub-agent/reports.json. Never try to write to the CRM.';

/** The runner's arguments for one run: claude's own, the Discord message as one argument. */
function agentArgs(agentName, prompt) {
  return [
    '-p', `Use the ${agentName} to: ${prompt}`,
    '--allowedTools', AGENT_TOOLS,
    '--append-system-prompt', CRM_NOTE,
    '--output-format', 'json',
  ];
}

async function runAgent(agentName, prompt, runner = AGENT_RUN) {
  return new Promise((resolve, reject) => {
    // The Discord message goes to the runner as one argument, never through a shell: until 2026-11-05 it was pasted
    // into a `sh -c` line inside double quotes, so a message with a quote in it ran as a command, as root.
    // The runner needs root to drop to hub-agent (pm2 runs this bot as root); it is given nothing of the bot's
    // environment, and empties its own before the agent starts.
    const child = execFile(runner, agentArgs(agentName, prompt), {
      cwd: '/',
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
      timeout: 900000,
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        return reject(`The agent runner ${runner} is not installed (intelligence-hub scheduler/agent-user/install.sh). Agents do not run as root.`);
      }
      if (error) return reject(stderr || error.message);
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch {
        reject('Failed to parse response');
      }
    });
    // As `< /dev/null` did: claude -p must not wait for input.
    child.stdin.end();
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

if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN);
}

module.exports = { agentArgs, runAgent, CRM_NOTE, AGENT_RUN };
