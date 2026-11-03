// Run locally after npm install: node generate-admin-hash.js
// Password input is hidden. Never paste the password into ChatGPT.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error('Run this in a real terminal so the password can be hidden.');
  process.exit(1);
}
process.stdout.write('Admin password (12-72 characters; hidden): ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password = '';
process.stdin.on('data', async chunk => {
  const key = chunk.toString('utf8');
  if (key === '\u0003') process.exit(1);
  if (key === '\r' || key === '\n') {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
    if (password.length < 12 || password.length > 72) {
      console.error('Use a unique password between 12 and 72 characters.'); process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);
    password = '';
    console.log('ADMIN_PASSWORD_HASH=' + hash);
    console.log('SESSION_SECRET=' + crypto.randomBytes(48).toString('hex'));
    console.log('\nSave these values in Render Environment Variables. Never share them.');
    return;
  }
  if (key === '\u007f' || key === '\b') password = password.slice(0, -1);
  else if (key.length === 1 && password.length < 72) password += key;
});
