#!/usr/bin/env node
// One-off: links Simkl to this site by exchanging a PIN for the access token
// that scripts/fetch-now.mjs reads as SIMKL_ACCESS_TOKEN.
//
//   node --env-file=.env scripts/simkl-token.mjs   (needs SIMKL_CLIENT_ID)
//
// Simkl's PIN tokens last about five years and can't be refreshed, so this only
// needs running again when the series feed starts failing with a 401.

const clientId = process.env.SIMKL_CLIENT_ID;
if (!clientId) {
  console.error('SIMKL_CLIENT_ID is missing — add it to .env first.');
  process.exit(1);
}

const query = new URLSearchParams({
  client_id: clientId,
  'app-name': 'pedrocastro-eu',
  'app-version': '1.0',
});
const headers = { 'user-agent': 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)' };

async function get(path) {
  const res = await fetch(`https://api.simkl.com${path}?${query}`, { headers });
  if (!res.ok) throw new Error(`Simkl ${res.status}`);
  return res.json();
}

const pin = await get('/oauth/pin');
if (!pin.user_code) {
  console.error('Simkl did not return a code:', pin);
  process.exit(1);
}
console.log(`Enter ${pin.user_code} at ${pin.verification_url ?? pin.verification_uri}`);

const deadline = Date.now() + (pin.expires_in ?? 900) * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, (pin.interval ?? 5) * 1000));
  const check = await get(`/oauth/pin/${pin.user_code}`);
  if (check.result === 'OK' && check.access_token) {
    console.log('\nLinked. Add this as the SIMKL_ACCESS_TOKEN repository secret:\n');
    console.log(check.access_token);
    process.exit(0);
  }
  // Polling a code that no longer exists returns a fresh PIN instead.
  if (check.device_code) break;
}
console.error('The code expired before it was entered. Run this again.');
process.exit(1);
