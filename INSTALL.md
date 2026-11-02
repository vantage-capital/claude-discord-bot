# Claude Discord Bot — Installation Guide

Discord bot that runs Claude Code subagents on demand and posts
results both to Discord and to the intelligence-hub dashboard.

## How it works


Channel → agent mapping is hard-coded at the top of `bot.js`. Each
channel routes to a specific Claude Code subagent name.

## Prerequisites

- Ubuntu 24.04 LTS, root
- Node.js 20+, npm
- pm2 installed globally
- **Claude Code CLI** installed and authenticated as the root user
  (`claude --version` must work for root)
- **Custom subagents** defined at `/root/.claude/agents/*.md` for each
  agent name referenced in `bot.js`:
  - `market-intelligence-analyst.md`
  - `investment-recommendation.md`
  - `client-intelligence-briefer.md`
  - (optionally: `market-research.md`, `portfolio-intelligence.md`)
- A Discord application + bot token (https://discord.com/developers)
- The companion `intelligence-hub` repo running at localhost:3000
  (for the dashboard webhook)

## ⚠️ Backup the subagent definitions

The subagents in `/root/.claude/agents/` are NOT part of this repo
but are required for the bot to work. Back them up separately:

    sudo tar -czf /var/backups/claude-agents-$(date +%Y%m%d).tar.gz \
        /root/.claude/agents/

## 1. System packages

    sudo apt update
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs git
    sudo npm install -g pm2

## 2. Install Claude Code CLI

    sudo npm install -g @anthropic-ai/claude-code

Authenticate (interactive — log in with your Anthropic account):

    sudo claude
    # follow the OAuth flow

Verify:

    sudo claude --version

## 3. Restore subagent definitions

    sudo mkdir -p /root/.claude/agents
    sudo tar -xzf /var/backups/claude-agents-YYYYMMDD.tar.gz -C /

(Or hand-write the agent .md files. Each subagent is a markdown file
with a system prompt and tool list. See Anthropic docs for format.)

## 4. Clone this repo

    sudo git clone https://github.com/LucasGaita-VC/claude-discord-bot.git \
        /root/claude-discord-bot

## 5. Install dependencies

    cd /root/claude-discord-bot
    sudo npm install

## 6. Configure secrets

    sudo nano /root/claude-discord-bot/.env

Required variables:

    DISCORD_TOKEN=<your bot token>

(Optional: anything else your subagents need at run time, e.g. Anthropic
keys — currently configured via the `claude` CLI auth itself.)

The bot lets the agents use Read, Write, Bash, WebSearch and WebFetch only.
The Airtable MCP tools are gone (the firm has left Airtable): remove the
`airtable` MCP server from root's Claude config (`claude mcp remove airtable`)
and any `mcp__airtable__*` tool or Airtable instruction from the subagent
files in `/root/.claude/agents/`.

## 7. Update channel IDs

`bot.js` has channel IDs hard-coded at the top. Update them to match
your Discord server's channel IDs:

    const CHANNEL_AGENTS = {
      '<channel_id_1>': 'market-intelligence-analyst',
      '<channel_id_2>': 'investment-recommendation',
      '<channel_id_3>': 'client-intelligence-briefer',
    };

## 8. Run with pm2

    cd /root/claude-discord-bot
    sudo pm2 start bot.js --name discord-bot
    sudo pm2 save

## 9. Smoke test

    sudo pm2 logs discord-bot --lines 30

You should see "Logged in as <bot-name>" in the logs.

In Discord, post a message in one of the configured channels — the
bot should respond with an embed and POST the report to the dashboard.

## Maintenance

### Pull latest
    cd /root/claude-discord-bot
    sudo git pull
    sudo npm install
    sudo pm2 restart discord-bot

### Logs
    sudo pm2 logs discord-bot

### Add or change a subagent
1. Edit `/root/.claude/agents/<name>.md`
2. Re-back-up the agents tarball
3. Restart the bot if necessary
