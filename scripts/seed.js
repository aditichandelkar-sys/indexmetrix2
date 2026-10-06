const fs = require('fs');
const path = require('path');

// Auto-load .env if DATABASE_URL not set
if (!process.env.DATABASE_URL && fs.existsSync(path.resolve(__dirname, '../.env'))) {
  const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
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

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('--- SEEDING INDEX MATRIX DATABASE ---');

  // 1. Seed Owner Account
  const ownerEmail = process.env.OWNER_EMAIL || 'naina@indexmetrix.com';
  const ownerPass = process.env.OWNER_INITIAL_PASSWORD || 'Naina@123';
  const ownerHash = await bcrypt.hash(ownerPass, 12);

  // Check if an existing primary OWNER already exists in database
  const existingOwner = await prisma.user.findFirst({
    where: { role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });

  let owner;
  if (existingOwner && existingOwner.email !== ownerEmail) {
    console.log(`[i] Updating primary owner account from ${existingOwner.email} to ${ownerEmail}...`);
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
            balance: 0, // Ignored because creditMode == UNLIMITED
            lifetimeUsed: 0,
            lifetimePurchased: 0,
          },
        },
      },
      include: { wallet: true },
    });
  }

  console.log(`[+] Owner account configured: ${owner.email} (creditMode: ${owner.creditMode})`);

  // 2. Seed Demo Customer
  const demoEmail = 'customer@indexmatrix.io';
  const demoPass = 'Customer123!';
  const demoHash = await bcrypt.hash(demoPass, 12);

  const customer = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      passwordHash: demoHash,
      name: 'Acme Digital Media',
      role: 'CUSTOMER',
      creditMode: 'LIMITED',
      status: 'ACTIVE',
      wallet: {
        create: {
          balance: 150,
          lifetimeUsed: 25,
          lifetimePurchased: 175,
        },
      },
    },
    include: { wallet: true },
  });

  console.log(`[+] Demo Customer created: ${customer.email} (balance: ${customer.wallet?.balance} credits)`);

  // 3. Create Sample Project for Customer
  const DEMO_PROJECT_UUID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';
  const project = await prisma.project.upsert({
    where: { id: DEMO_PROJECT_UUID },
    update: {},
    create: {
      id: DEMO_PROJECT_UUID,
      userId: customer.id,
      name: 'Example Commerce Blog',
      domain: 'example.com',
      description: 'Primary corporate blog & technical content hub',
    },
  });

  // 4. Create Initial URLs
  const sampleUrls = [
    {
      projectId: project.id,
      originalUrl: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
      path: '/',
      status: 'ANALYZED',
      httpStatus: 200,
    },
    {
      projectId: project.id,
      originalUrl: 'https://example.com/blog/seo-checklist',
      normalizedUrl: 'https://example.com/blog/seo-checklist',
      hostname: 'example.com',
      path: '/blog/seo-checklist',
      status: 'INDEXED',
      httpStatus: 200,
    },
    {
      projectId: project.id,
      originalUrl: 'https://example.com/private/draft-post',
      normalizedUrl: 'https://example.com/private/draft-post',
      hostname: 'example.com',
      path: '/private/draft-post',
      status: 'BLOCKED',
      httpStatus: 403,
    },
  ];

  for (const u of sampleUrls) {
    await prisma.url.upsert({
      where: {
        projectId_normalizedUrl: {
          projectId: u.projectId,
          normalizedUrl: u.normalizedUrl,
        },
      },
      update: {},
      create: u,
    });
  }

  // 5. Default System Settings
  const defaultSettings = [
    { key: 'COST_URL_ANALYSIS', value: '1', description: 'Credit cost for single technical URL analysis' },
    { key: 'COST_GOOGLE_INSPECTION', value: '2', description: 'Credit cost for Search Console URL inspection' },
    { key: 'COST_SUPPORTED_INDEXING', value: '3', description: 'Credit cost for eligible Indexing API workflow' },
    { key: 'COST_SITEMAP_PROCESS', value: '5', description: 'Credit cost for parsing & importing XML sitemaps' },
  ];

  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  console.log('[+] System settings seeded successfully.');
  console.log('--- SEEDING COMPLETE ---');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
