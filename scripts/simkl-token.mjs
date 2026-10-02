#!/usr/bin/env node
// One-off: links Simkl to this site and prints the refresh token that
// scripts/fetch-now.mjs reads as SIMKL_REFRESH_TOKEN.
//
//   node --env-file=.env scripts/simkl-token.mjs   (needs SIMKL_CLIENT_ID)
//
// This is Simkl's AUTH V2 device flow: it prints a code, you approve it on
// simkl.com, and it prints the refresh token. That token doesn't rotate, but it
// expires 180 days after its last use — so a manual site refresh twice a year
// keeps it alive, and if it ever lapses, run this again.

const clientId = process.env.SIMKL_CLIENT_ID;
if (!clientId) {
  console.error('SIMKL_CLIENT_ID is missing — add it to .env first.');
  process.exit(1);
}

const UA = 'pedrocastro.eu/1.0 (+https://pedrocastro.eu)';

async function post(path, params) {
  const res = await fetch(`https://api.simkl.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
    },
    body: new URLSearchParams(params),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// media:read only — the site reads the library and never writes to it.
const device = await post('/oauth2/device', { client_id: clientId, scope: 'media:read' });
if (!device.json.device_code) {
  console.error(`Simkl refused the device request (${device.status}):`, device.json);
  process.exit(1);
}

console.log(`Enter ${device.json.user_code} at ${device.json.verification_uri}`);
if (device.json.verification_uri_complete) {
  console.log(`or open ${device.json.verification_uri_complete} to skip typing it.`);
}
console.log('Waiting for approval...');

let interval = (device.json.interval ?? 5) * 1000;
const deadline = Date.now() + (device.json.expires_in ?? 900) * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, interval));
  const { status, json } = await post('/oauth2/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: device.json.device_code,
    client_id: clientId,
  });
  if (json.refresh_token) {
    console.log('\nLinked. Add this as the SIMKL_REFRESH_TOKEN repository secret:\n');
    console.log(json.refresh_token);
    console.log(`\n(scope: ${json.scope ?? 'unknown'})`);
    process.exit(0);
  }
  // Still waiting is the only error worth polling through; slow_down also asks
  // for a longer gap between attempts.
  if (json.error === 'slow_down') {
    interval += 5000;
    continue;
  }
  if (json.error === 'authorization_pending') continue;
  console.error(`Simkl stopped the login (${status}):`, json.error ?? json);
  process.exit(1);
}

console.error('The code expired before it was approved. Run this again.');
process.exit(1);
