require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ADMIN_EMAIL = 'giedogroup@gmail.com';
(async () => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('Set ADMIN_PASSWORD to the administrator password in the hosting secret manager or local .env (8–128 characters). Use a unique, stronger password before public launch.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async tx => {
    // Enforce one and only one ADMIN role in the database.
    await tx.user.updateMany({ where: { role: 'ADMIN', email: { not: ADMIN_EMAIL } }, data: { role: 'USER' } });
    return tx.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { passwordHash, role: 'ADMIN' },
      create: { email: ADMIN_EMAIL, passwordHash, role: 'ADMIN', wallet: { create: {} } },
      select: { id: true, email: true, role: true }
    });
  });
  console.log(`Only administrator account is ready: ${user.email} (${user.role}). Password is not printed.`);
})().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
