import { readFileSync } from 'node:fs';
const password = readFileSync('/home/nasser/apps/idea-stream/private/initial-password.txt','utf8').trim();
const headers = { Authorization: `Basic ${Buffer.from(`nasser:${password}`).toString('base64')}` };
try {
  const health = await fetch('http://127.0.0.1:5185/api/healthz', {headers, signal:AbortSignal.timeout(3000)});
  const notebooks = await fetch('http://127.0.0.1:5185/api/subjects', {headers, signal:AbortSignal.timeout(3000)});
  if (!health.ok || !notebooks.ok || !Array.isArray(await notebooks.json())) process.exit(1);
  console.log('Idea Stream API and database are healthy.');
} catch { process.exit(1); }
