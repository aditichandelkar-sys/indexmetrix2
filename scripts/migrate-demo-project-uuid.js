const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VALID_DEMO_PROJECT_ID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';

async function main() {
  console.log('[*] Checking for non-UUID projects...');
  const oldProject = await prisma.project.findUnique({
    where: { id: 'demo-project-1' },
  });

  if (!oldProject) {
    console.log('[+] No project with id "demo-project-1" found. Migration not needed or already applied.');
    return;
  }

  console.log(`[!] Found old project "demo-project-1" for user ${oldProject.userId}. Migrating to ${VALID_DEMO_PROJECT_ID}...`);

  // Check if valid project already exists
  let targetProject = await prisma.project.findUnique({
    where: { id: VALID_DEMO_PROJECT_ID },
  });

  if (!targetProject) {
    targetProject = await prisma.project.create({
      data: {
        id: VALID_DEMO_PROJECT_ID,
        userId: oldProject.userId,
        name: oldProject.name,
        domain: oldProject.domain,
        description: oldProject.description,
        googlePropertyId: oldProject.googlePropertyId,
        googlePropertyUrl: oldProject.googlePropertyUrl,
      },
    });
    console.log(`[+] Created project with valid UUID: ${targetProject.id}`);
  }

  // Update referencing Urls
  const updatedUrls = await prisma.url.updateMany({
    where: { projectId: 'demo-project-1' },
    data: { projectId: VALID_DEMO_PROJECT_ID },
  });
  console.log(`[+] Updated ${updatedUrls.count} URLs to point to valid project UUID.`);

  // Update referencing Sitemaps
  const updatedSitemaps = await prisma.sitemap.updateMany({
    where: { projectId: 'demo-project-1' },
    data: { projectId: VALID_DEMO_PROJECT_ID },
  });
  console.log(`[+] Updated ${updatedSitemaps.count} sitemaps.`);

  // Update referencing SC Properties
  const updatedProperties = await prisma.searchConsoleProperty.updateMany({
    where: { projectId: 'demo-project-1' },
    data: { projectId: VALID_DEMO_PROJECT_ID },
  });
  console.log(`[+] Updated ${updatedProperties.count} SC properties.`);

  // Delete old project
  await prisma.project.delete({
    where: { id: 'demo-project-1' },
  });
  console.log('[+] Successfully removed legacy "demo-project-1" project.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
