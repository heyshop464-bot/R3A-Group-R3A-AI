require('dotenv').config();
const express = require('express');
const path = require('node:path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient, Prisma } = require('@prisma/client');
const { z } = require('zod');

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 3000);
// Exactly one administrator is allowed. Keep this identity fixed in code; do not make it user-configurable.
const ADMIN_EMAIL = 'giedogroup@gmail.com';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Startup blocked: JWT_SECRET must be configured and at least 32 characters.');
  process.exit(1);
}
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
// The current single-file UI contains inline CSS/JS. Keep a restrictive policy otherwise,
// while explicitly allowing those two inline blocks until a nonce/hash build is introduced.
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '32kb' }));
// Serve static files. index.html lives at repository root for this project, so serve from __dirname.
// If you later move static assets into a ./public directory, update this path accordingly.
app.use(express.static(path.join(__dirname), { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'R3A AI API', time: new Date().toISOString() }));
app.get('/api/ready', asyncRoute(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, database: 'connected', time: new Date().toISOString() });
}));
app.get('/api/payment/instructions', (_req, res) => res.json({
  provider: process.env.PAYMENT_PROVIDER_LABEL || 'اتصالات كاش',
  phone: process.env.PAYMENT_WALLET_PHONE || '01114887511',
  mode: 'manual',
  automaticVerification: false,
  currency: 'EGP',
  message: 'يحّول العميل إلى الرقم، ثم يرسل طلبًا من حسابه. يراجع المشرف سجل المحفظة الفعلي؛ وبعد التحقق يعتمد الطلب.'
}));

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const registerSchema = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128) });
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
const topupSchema = z.object({ amount: z.coerce.number().finite().min(1).max(1000000), providerReference: z.string().trim().min(4).max(120), senderName: z.string().trim().max(120).optional(), notes: z.string().trim().max(500).optional() });
const campaignSchema = z.object({ platform: z.string().trim().min(2).max(40), goal: z.string().trim().min(2).max(100), title: z.string().trim().min(2).max(120), budget: z.coerce.number().finite().min(0) });
const ticketSchema = z.object({ category: z.string().trim().min(2).max(80), title: z.string().trim().min(2).max(120), body: z.string().trim().min(5).max(5000) });

function signToken(user) {
  const role = user.email.toLowerCase() === ADMIN_EMAIL && user.role === 'ADMIN' ? 'ADMIN' : 'USER';
  return jwt.sign({ sub: user.id, role }, process.env.JWT_SECRET, { expiresIn: '2h', issuer: 'r3a-ai', audience: 'r3a-ai-web' });
}
const requireAuth = asyncRoute(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'r3a-ai', audience: 'r3a-ai-web' });
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true } });
    if (!user) return res.status(401).json({ error: 'الجلسة غير صالحة.' });
    req.user = user; next();
  } catch (err) { return res.status(401).json({ error: 'انتهت الجلسة أو أنها غير صالحة.' }); }
});
const requireAdmin = (req, res, next) => (req.user?.role === 'ADMIN' && req.user?.email?.toLowerCase() === ADMIN_EMAIL) ? next() : res.status(403).json({ error: 'هذه العملية للمشرف فقط.' });
async function audit(tx, actorId, action, entity, entityId, metadata = undefined) {
  await tx.auditLog.create({ data: { actorId, action, entity, entityId, ...(metadata ? { metadata } : {}) } });
}

app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.trim().toLowerCase();
  if (email === ADMIN_EMAIL) return res.status(409).json({ error: 'هذا البريد مخصص لحساب الإدارة ولا يمكن إنشاؤه من التسجيل العام.' });
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash, wallet: { create: {} } }, select: { id: true, email: true, role: true } });
  res.status(201).json({ user, token: signToken(user) });
}));
app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
  res.json({ user: { id: user.id, email: user.email, role: user.role }, token: signToken(user) });
}));
app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, email: true, role: true, createdAt: true, wallet: { select: { balance: true, currency: true } } } });
  res.json({ user });
}));

app.get('/api/wallet', requireAuth, asyncRoute(async (req, res) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id }, include: { ledger: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  res.json({ wallet });
}));
app.post('/api/wallet/topups', requireAuth, asyncRoute(async (req, res) => {
  const input = topupSchema.parse(req.body);
  const reference = input.providerReference.trim();
  const request = await prisma.$transaction(async tx => {
    const created = await tx.topUpRequest.create({ data: { userId: req.user.id, amount: new Prisma.Decimal(input.amount.toFixed(2)), providerReference: reference, senderName: input.senderName || null, notes: input.notes || null } });
    await tx.auditLog.create({ data: { actorId: req.user.id, action: 'TOPUP_SUBMITTED', entity: 'TopUpRequest', entityId: created.id, metadata: { amount: input.amount, currency: 'EGP' } } });
    return created;
  });
  res.status(201).json({ request, message: 'تم تسجيل الطلب للمراجعة فقط؛ لم تتم إضافة رصيد.' });
}));
app.get('/api/wallet/topups', requireAuth, asyncRoute(async (req, res) => {
  const requests = await prisma.topUpRequest.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, amount: true, currency: true, providerReference: true, status: true, createdAt: true, reviewedAt: true, rejectionReason: true } });
  res.json({ requests });
}));
app.get('/api/admin/topups', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const requests = await prisma.topUpRequest.findMany({ where: { status: 'PENDING' }, include: { user: { select: { id: true, email: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  res.json({ requests });
}));
app.post('/api/admin/topups/:id/approve', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const verified = z.object({ verifiedReceived: z.literal(true), reviewNote: z.string().trim().max(500).optional() }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const topup = await tx.topUpRequest.findUnique({ where: { id: req.params.id } });
    if (!topup) { const e = new Error('طلب الشحن غير موجود.'); e.status = 404; throw e; }
    if (topup.status !== 'PENDING') { const e = new Error('تمت مراجعة هذا الطلب مسبقًا.'); e.status = 409; throw e; }
    const wallet = await tx.wallet.findUnique({ where: { userId: topup.userId } });
    if (!wallet) { const e = new Error('محفظة المستخدم غير موجودة.'); e.status = 409; throw e; }
    const nextBalance = new Prisma.Decimal(wallet.balance).plus(topup.amount);
    const updatedTopup = await tx.topUpRequest.update({ where: { id: topup.id }, data: { status: 'APPROVED', verifiedReceived: verified.verifiedReceived, reviewedById: req.user.id, reviewedAt: new Date() } });
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: nextBalance } });
    await tx.walletLedger.create({ data: { walletId: wallet.id, topUpId: topup.id, type: 'TOPUP', amount: topup.amount, balanceAfter: nextBalance, description: `Verified manual top-up reference ${topup.providerReference}` } });
    await audit(tx, req.user.id, 'TOPUP_APPROVED', 'TopUpRequest', topup.id, { amount: topup.amount.toString(), reviewNote: verified.reviewNote || null });
    return updatedTopup;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ request: result, message: 'تم اعتماد الطلب وإضافة الرصيد مرة واحدة.' });
}));
app.post('/api/admin/topups/:id/reject', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const topup = await tx.topUpRequest.findUnique({ where: { id: req.params.id } });
    if (!topup) { const e = new Error('طلب الشحن غير موجود.'); e.status = 404; throw e; }
    if (topup.status !== 'PENDING') { const e = new Error('تمت مراجعة هذا الطلب مسبقًا.'); e.status = 409; throw e; }
    const updated = await tx.topUpRequest.update({ where: { id: topup.id }, data: { status: 'REJECTED', rejectionReason: input.reason, reviewedById: req.user.id, reviewedAt: new Date() } });
    await audit(tx, req.user.id, 'TOPUP_REJECTED', 'TopUpRequest', topup.id, { reason: input.reason });
    return updated;
  });
  res.json({ request: result });
}));

// Operational administration endpoints. They expose only aggregate data or records needed for support.
app.get('/api/admin/overview', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [users, pendingTopUps, campaigns, openTickets, walletTotals] = await Promise.all([
    prisma.user.count(),
    prisma.topUpRequest.count({ where: { status: 'PENDING' } }),
    prisma.campaign.count(),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.wallet.aggregate({ _sum: { balance: true } })
  ]);
  res.json({ overview: { users, pendingTopUps, campaigns, openTickets, totalWalletBalance: (walletTotals._sum.balance || new Prisma.Decimal(0)).toString(), currency: 'EGP' } });
}));
app.get('/api/admin/tickets', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const allowed = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const status = req.query.status;
  if (status && !allowed.includes(status)) return res.status(400).json({ error: 'حالة التذكرة غير صالحة.' });
  const tickets = await prisma.supportTicket.findMany({ where: status ? { status } : {}, include: { user: { select: { id: true, email: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  res.json({ tickets });
}));
app.patch('/api/admin/tickets/:id/status', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const input = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const ticket = await tx.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) { const e = new Error('تذكرة الدعم غير موجودة.'); e.status = 404; throw e; }
    const updated = await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: input.status } });
    await audit(tx, req.user.id, 'SUPPORT_TICKET_STATUS_CHANGED', 'SupportTicket', ticket.id, { from: ticket.status, to: input.status });
    return updated;
  });
  res.json({ ticket: result });
}));
app.get('/api/admin/campaigns', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const campaigns = await prisma.campaign.findMany({ include: { user: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ campaigns });
}));

app.post('/api/campaigns', requireAuth, asyncRoute(async (req, res) => {
  const input = campaignSchema.parse(req.body);
  const campaign = await prisma.campaign.create({ data: { userId: req.user.id, ...input, budget: new Prisma.Decimal(input.budget.toFixed(2)) } });
  res.status(201).json({ campaign, message: 'تم حفظ الحملة كمسودة؛ لم يتم تشغيل إعلان أو شراء متابعين.' });
}));
app.get('/api/campaigns', requireAuth, asyncRoute(async (req, res) => {
  const campaigns = await prisma.campaign.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ campaigns });
}));
app.post('/api/tickets', requireAuth, asyncRoute(async (req, res) => {
  const input = ticketSchema.parse(req.body);
  const ticket = await prisma.supportTicket.create({ data: { userId: req.user.id, ...input } });
  res.status(201).json({ ticket });
}));
app.get('/api/tickets', requireAuth, asyncRoute(async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ tickets });
}));

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'بيانات غير صالحة.', details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  if (err?.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '');
    const message = target.includes('providerReference') ? 'رقم مرجع العملية مستخدم من قبل؛ راجع الرقم ولا تعاود الإرسال.' : target.includes('email') ? 'البريد الإلكتروني مستخدم بالفعل.' : 'تعارض فريد في قاعدة البيانات.';
    return res.status(409).json({ error: message });
  }
  if (err?.code === 'P2034') return res.status(409).json({ error: 'تعارض أثناء المعالجة؛ أعد المحاولة بعد التحقق من حالة الطلب.' });
  const status = err.status || 500;
  if (status === 500) console.error('Unhandled server error:', err.message || err);
  res.status(status).json({ error: status === 500 ? 'حدث خطأ داخلي.' : err.message });
});

const server = app.listen(PORT, () => console.log(`R3A AI API listening on port ${PORT}`));
async function shutdown() { server.close(async () => { await prisma.$disconnect(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
