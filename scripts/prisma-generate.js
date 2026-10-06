const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Auto-load .env
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const dbUrl = process.env.DATABASE_URL || '';
const isPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
const schema = isPostgres ? 'prisma/schema.prisma' : 'prisma/schema.sqlite.prisma';

console.log(`[prisma-generate] Target provider: ${isPostgres ? 'PostgreSQL' : 'SQLite'} (Schema: ${schema})`);

try {
  execSync(`npx prisma generate --schema=${schema}`, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
  console.log('[prisma-generate] Successfully generated Prisma Client.');
} catch (err) {
  console.error('[prisma-generate] Failed to generate Prisma Client:', err.message);
  process.exit(1);
}
