// Publishes health alerts to the existing AWS SNS topic using the EC2 instance role.
// The role needs sns:Publish on the topic; subscribers (email etc.) are managed in SNS itself.
// Runs after every health check: silent while healthy, one alert per state change, repeats hourly while unhealthy.
import fs from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const healthFile = '.data/operations/health.json';
const stateFile = '.data/operations/alert-delivery.json';
const test = process.argv.includes('--test');
const read = (path, fallback) => { try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; } };

const status = read(healthFile, { ok: false, error: 'health.json missing or unreadable', checkedAt: new Date().toISOString() });
const healthy = Boolean(status.ok) && !status.diskWarning;
const prior = read(stateFile, {});
if (!test && healthy && prior.healthy !== false) process.exit(0);
if (!test && prior.healthy === healthy && Date.now() - (prior.sentAt ?? 0) < 3_600_000) process.exit(0);

async function imds(path, token) {
  const r = await fetch(`http://169.254.169.254/latest/${path}`, { headers: { 'X-aws-ec2-metadata-token': token }, signal: AbortSignal.timeout(3_000) });
  if (!r.ok) throw new Error(`instance metadata ${path} returned ${r.status}`);
  return r.text();
}
const token = await (await fetch('http://169.254.169.254/latest/api/token', { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' }, signal: AbortSignal.timeout(3_000) })).text();
const role = (await imds('meta-data/iam/security-credentials/', token)).trim();
const creds = JSON.parse(await imds(`meta-data/iam/security-credentials/${role}`, token));
const identity = JSON.parse(await imds('dynamic/instance-identity/document', token));
const region = identity.region;
const topicArn = process.env.ALERT_TOPIC_ARN ?? `arn:aws:sns:${region}:${identity.accountId}:edgebounty-alerts`;

const subject = `EdgeBounty ${test ? 'TEST alert' : healthy ? 'recovered' : 'health alert'}`;
const message = [
  test ? 'This is an authorized delivery test.' : '',
  `Checked: ${status.checkedAt}`,
  `Database: ${status.database}`, `Chain: ${status.chain}`, `Worker: ${status.worker}`,
  `Free disk bytes: ${status.freeBytes}${status.diskWarning ? ' (LOW)' : ''}`,
  status.error ? `Error: ${status.error}` : '',
  'No credentials or customer data are included.',
].filter(Boolean).join('\n');

// AWS Signature Version 4 for a single SNS Publish request.
const host = `sns.${region}.amazonaws.com`;
const body = new URLSearchParams({ Action: 'Publish', Version: '2010-03-31', TopicArn: topicArn, Subject: subject, Message: message }).toString();
const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
const day = amzDate.slice(0, 8);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const hmac = (k, v) => createHmac('sha256', k).update(v).digest();
const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host, 'x-amz-date': amzDate, 'x-amz-security-token': creds.Token };
const signed = Object.keys(headers).sort();
const canonical = ['POST', '/', '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), sha(body)].join('\n');
const scope = `${day}/${region}/sns/aws4_request`;
const key = hmac(hmac(hmac(hmac(`AWS4${creds.SecretAccessKey}`, day), region), 'sns'), 'aws4_request');
const signature = createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha(canonical)}`).digest('hex');
headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.AccessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;

const response = await fetch(`https://${host}/`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
const text = await response.text();
if (!response.ok) {
  const reason = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? `HTTP ${response.status}`;
  console.error(`SNS alert not delivered: ${reason}`);
  process.exit(1);
}
const messageId = /<MessageId>([^<]+)<\/MessageId>/.exec(text)?.[1];
fs.mkdirSync('.data/operations', { recursive: true, mode: 0o700 });
fs.writeFileSync(stateFile, JSON.stringify({ healthy, sentAt: Date.now(), providerMessageId: messageId }), { mode: 0o600 });
console.log(`SNS accepted alert ${messageId}; subscriber receipt must still be confirmed.`);
