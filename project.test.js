const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('server JavaScript syntax is valid', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'src/server.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('admin creation script JavaScript syntax is valid', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'src/create-admin.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('wallet top-up is manual and clearly configured for the supplied number', () => {
  const server = read('src/server.js');
  const html = read('public/index.html');
  const env = read('.env.example');
  assert.match(env, /PAYMENT_MODE=manual/);
  assert.match(env, /PAYMENT_WALLET_PHONE=01114887511/);
  assert.match(server, /automaticVerification: false/);
  assert.match(server, /\/api\/wallet\/topups/);
  assert.match(html, /01114887511/);
  assert.match(html, /اعتماد بعد التحقق/);
});

test('top-up approval is restricted to authenticated administrators', () => {
  const server = read('src/server.js');
  assert.match(server, /app\.post\('\/api\/admin\/topups\/:id\/approve', requireAuth, requireAdmin/);
  assert.match(server, /app\.post\('\/api\/admin\/topups\/:id\/reject', requireAuth, requireAdmin/);
});

test('wallet credit and ledger entry are written in the same transaction', () => {
  const server = read('src/server.js');
  const approval = server.slice(server.indexOf("app.post('/api/admin/topups/:id/approve'"), server.indexOf("app.post('/api/admin/topups/:id/reject'"));
  assert.match(approval, /prisma\.\$transaction/);
  assert.match(approval, /tx\.wallet\.update/);
  assert.match(approval, /tx\.walletLedger\.create/);
  assert.match(approval, /topup\.status !== 'PENDING'/);
});

test('duplicate payment references and duplicate ledger top-up entries are database constrained', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /providerReference String\s+@unique/);
  assert.match(schema, /topUpId\s+String\?\s+@unique/);
});

test('secrets are excluded from version control and example secrets are placeholders', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.match(read('.env.example'), /replace_with_a_random_secret_at_least_32_chars/);
  assert.match(read('.env.example'), /ADMIN_PASSWORD=set_the_admin_password_in_your_secret_manager/);
});

test('health and readiness endpoints are defined', () => {
  const server = read('src/server.js');
  assert.match(server, /app\.get\('\/api\/health'/);
  assert.match(server, /app\.get\('\/api\/ready'/);
});

test('deployment and migration files exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'Dockerfile')));
  assert.ok(fs.existsSync(path.join(root, 'docker-compose.yml')));
  assert.ok(fs.existsSync(path.join(root, 'render.yaml')));
  assert.ok(fs.existsSync(path.join(root, 'prisma/migrations/20261016000000_init/migration.sql')));
});

test('admin operational routes are protected and audit support-ticket status changes', () => {
  const server = read('src/server.js');
  assert.match(server, /app\.get\('\/api\/admin\/overview', requireAuth, requireAdmin/);
  assert.match(server, /app\.get\('\/api\/admin\/tickets', requireAuth, requireAdmin/);
  assert.match(server, /app\.patch\('\/api\/admin\/tickets\/:id\/status', requireAuth, requireAdmin/);
  assert.match(server, /SUPPORT_TICKET_STATUS_CHANGED/);
  assert.match(server, /app\.get\('\/api\/admin\/campaigns', requireAuth, requireAdmin/);
});

test('admin ticket workflow is represented in the Arabic frontend', () => {
  const html = read('public/index.html');
  assert.match(html, /adminTicketsPanel/);
  assert.match(html, /adminOverview/);
  assert.match(html, /\/api\/admin\/overview/);
  assert.match(html, /\/api\/admin\/tickets/);
  assert.match(html, /data-ticket-save/);
  assert.match(html, /تم تحديث حالة التذكرة/);
});


test('only the fixed administrator email can use admin permissions', () => {
  const server = read('src/server.js');
  const adminScript = read('src/create-admin.js');
  assert.match(server, /const ADMIN_EMAIL = 'giedogroup@gmail\.com'/);
  assert.match(server, /req\.user\?\.email\?\.toLowerCase\(\) === ADMIN_EMAIL/);
  assert.match(server, /email === ADMIN_EMAIL.*هذا البريد مخصص لحساب الإدارة/s);
  assert.match(adminScript, /const ADMIN_EMAIL = 'giedogroup@gmail\.com'/);
  assert.match(adminScript, /role: 'ADMIN', email: \{ not: ADMIN_EMAIL \}/);
});

test('wallet top-up remains manual and admin approval is the only credit path', () => {
  const server = read('src/server.js');
  assert.match(server, /automaticVerification: false/);
  assert.match(server, /تم تسجيل الطلب للمراجعة فقط؛ لم تتم إضافة رصيد/);
  assert.match(server, /TOPUP_APPROVED/);
  assert.match(server, /تم اعتماد الطلب وإضافة الرصيد مرة واحدة/);
});


test('container bootstrap applies migrations and provisions the sole admin before serving', () => {
  const dockerfile = read('Dockerfile');
  const compose = read('docker-compose.yml');
  const render = read('render.yaml');
  assert.match(dockerfile, /prisma migrate deploy && npm run admin:create && node src\/server.js/);
  assert.match(compose, /ADMIN_PASSWORD: \$\{ADMIN_PASSWORD:\?Set a unique ADMIN_PASSWORD/);
  assert.match(render, /key: ADMIN_PASSWORD[\s\S]*sync: false/);
});
