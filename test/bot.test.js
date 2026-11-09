// The bot's agents run as hub-agent through the Hub's runner, never as root (bot.js, runAgent). What can be checked
// off the app host: the runner is what is started, with the Discord message as one argument, in no directory of
// root's and with none of the bot's environment, and a missing runner fails the run instead of falling back to root.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DISCORD_TOKEN = 'test-token-not-real';
const { agentArgs, runAgent, CRM_NOTE, AGENT_RUN } = require('../bot.js');

function stubRunner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-runner-'));
  const stub = path.join(dir, 'agent-run.sh');
  // Answers as claude would, echoing what it was given: its arguments, directory and environment.
  fs.writeFileSync(stub, `#!${process.execPath}
process.stdout.write(JSON.stringify({ result: JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env }) }));
`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

test('defaults to the installed runner, not root’s claude', () => {
  assert.strictEqual(AGENT_RUN, '/usr/local/lib/hub-agent/agent-run.sh');
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
  assert.doesNotMatch(src, /execFile\('claude'|\/root\//);
});

test('the agent reads the CRM with hub-agent’s crm-read.js and is told where the reports are', () => {
  assert.match(CRM_NOTE, /node \/usr\/local\/lib\/hub-agent\/crm\/crm-read\.js tables/);
  assert.match(CRM_NOTE, /\/var\/lib\/hub-agent\/reports\.json/);
  assert.doesNotMatch(CRM_NOTE, /\/root/);
});

test('the runner gets the message as one argument, outside /root, with none of the bot’s environment', async () => {
  const message = `it's $(id) \`whoami\` "quoted" ; echo pwned`;
  const out = await runAgent('market-intelligence-analyst', message, stubRunner());
  const seen = JSON.parse(out.result);
  assert.deepStrictEqual(seen.args, [
    '-p',
    `Use the market-intelligence-analyst to: ${message}`,
    '--allowedTools',
    'Read,Write,Bash,WebSearch,WebFetch',
    '--append-system-prompt',
    CRM_NOTE,
    '--output-format',
    'json',
  ]);
  assert.deepStrictEqual(seen.args, agentArgs('market-intelligence-analyst', message));
  assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync('/'));
  assert.strictEqual(seen.env.DISCORD_TOKEN, undefined);
});

test('a missing runner fails the run and says so: no fallback to root', async () => {
  await assert.rejects(
    runAgent('market-intelligence-analyst', 'hello', '/nonexistent/agent-run.sh'),
    (err) => /not installed .*Agents do not run as root/.test(String(err)),
  );
});
