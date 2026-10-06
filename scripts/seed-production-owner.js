/**
 * Production Owner Seeding Script for INDEX METRIX
 * Seeds ONLY the primary owner account into the production database.
 * Does NOT seed demo customers, test projects, or mock URLs.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

// Load .env.production, explicitly overriding development settings
const prodEnvPath = path.resolve(__dirname, '../.env.production');
if (fs.existsSync(prodEnvPath)) {
  const envContent = fs.readFileSync(prodEnvPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

const ownerEmail = process.env.OWNER_EMAIL || 'naina@indexmetrix.com';
const ownerPass = process.env.OWNER_INITIAL_PASSWORD || 'Naina@123';

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set in environment or .env.production');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL }
  }
});

async function main() {
  console.log('--- SEEDING INDEX METRIX PRIMARY OWNER ---');
  console.log(`Target Owner Email: ${ownerEmail}`);

  const ownerHash = await bcrypt.hash(ownerPass, 12);

  // Check if an existing primary OWNER exists
  const existingOwner = await prisma.user.findFirst({
    where: { role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    include: { wallet: true },
  });

  let owner;
  if (existingOwner && existingOwner.email !== ownerEmail) {
    console.log(`[i] Updating existing primary owner account from ${existingOwner.email} to ${ownerEmail}...`);
    owner = await prisma.user.update({
      where: { id: existingOwner.id },
      data: {
        email: ownerEmail,
        passwordHash: ownerHash,
        name: 'System Owner',
        role: 'OWNER',
        creditMode: 'UNLIMITED',
        status: 'ACTIVE',
      },
      include: { wallet: true },
    });
  } else {
    owner = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: {
        passwordHash: ownerHash,
        role: 'OWNER',
        creditMode: 'UNLIMITED',
        status: 'ACTIVE',
      },
      create: {
        email: ownerEmail,
        passwordHash: ownerHash,
        name: 'System Owner',
        role: 'OWNER',
        creditMode: 'UNLIMITED',
        status: 'ACTIVE',
        wallet: {
          create: {
            balance: 0,
            lifetimeUsed: 0,
            lifetimePurchased: 0,
          },
        },
      },
      include: { wallet: true },
    });
  }

  // Ensure wallet exists if updated
  if (!owner.wallet) {
    console.log('[i] Creating owner wallet...');
    await prisma.creditWallet.create({
      data: {
        userId: owner.id,
        balance: 0,
        lifetimeUsed: 0,
        lifetimePurchased: 0,
      }
    });
  }

  console.log(`\n[SUCCESS] Primary Owner provisioned successfully!`);
  console.log(`- ID: ${owner.id}`);
  console.log(`- Email: ${owner.email}`);
  console.log(`- Role: ${owner.role}`);
  console.log(`- Credit Mode: ${owner.creditMode} (Unlimited system access)`);
  console.log(`- Status: ${owner.status}`);
  console.log(`- Wallet: Connected`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
