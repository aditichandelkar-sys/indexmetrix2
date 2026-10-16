const https = require('https');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, family: 4 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('INDEX METRIX PRODUCTION VERIFICATION SCRIPT');
  console.log('Host: https://indexmetrix.com');
  console.log('====================================================\n');

  // 1. Authenticate with Production
  console.log('[1/4] Authenticating with production server...');
  const loginRes = await request(
    {
      hostname: 'indexmetrix.com',
      port: 443,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({ email: 'naina@indexmetrix.com', password: 'Naina@123' })
  );

  console.log('Login HTTP Status:', loginRes.status);
  const setCookie = loginRes.headers['set-cookie'];
  if (!setCookie || !setCookie[0]) {
    throw new Error('Authentication failed: No session cookie returned.');
  }

  const sessionCookie = setCookie[0].split(';')[0];
  console.log('Session Cookie Acquired:', sessionCookie.slice(0, 35) + '...\n');

  // 2. Fetch /quick-index HTML and find Client Bundle Chunks
  console.log('[2/4] Fetching /quick-index page and analyzing client bundles...');
  const pageRes = await request({
    hostname: 'indexmetrix.com',
    port: 443,
    path: '/quick-index',
    method: 'GET',
    headers: { Cookie: sessionCookie },
  });

  console.log('Quick-Index HTTP Status:', pageRes.status);

  // Extract static chunk paths from the HTML
  const chunkMatches = pageRes.body.match(/static\/chunks\/[^"'\s<>]+/g) || [];
  const uniqueChunks = Array.from(new Set(chunkMatches));
  console.log('Referenced Static Chunks (' + uniqueChunks.length + ' chunks):');
  for (const chunk of uniqueChunks) {
    console.log(' - /_next/' + chunk);
  }

  // Specifically check chunks for quick-index page
  let foundQuickIndexChunk = null;
  let quickIndexChunkContent = '';

  for (const chunk of uniqueChunks) {
    if (chunk.includes('quick-index') || chunk.includes('page-')) {
      const chunkRes = await request({
        hostname: 'indexmetrix.com',
        port: 443,
        path: '/_next/' + chunk,
        method: 'GET',
      });

      if (chunkRes.body.includes('Real-Time Google SERP') || chunkRes.body.includes('Check Live on Google')) {
        foundQuickIndexChunk = chunk;
        quickIndexChunkContent = chunkRes.body;
        console.log('\nFound Quick-Index Client Bundle:', chunk);
        break;
      }
    }
  }

  if (foundQuickIndexChunk) {
    const hasNewConfirmedIndexed = quickIndexChunkContent.includes('CONFIRMED INDEXED ON GOOGLE SERP');
    const hasNewUnableToVerify = quickIndexChunkContent.includes('UNABLE TO VERIFY (GOOGLE RATE-LIMITED OR BLOCKED)');
    const hasNewNotIndexed = quickIndexChunkContent.includes('NOT INDEXED ON GOOGLE SERP');
    const hasOldCrawlQueuedBanner = quickIndexChunkContent.includes('CRAWL QUEUED — PENDING PUBLIC SERP PLACEMENT');
    const hasNewSignalsDispatchedTelemetry = quickIndexChunkContent.includes('Signals Dispatched');

    console.log('\nClient Bundle Feature Flags (Commit 203f753 Codebase Audit):');
    console.log('  - Has "UNABLE TO VERIFY" banner:', hasNewUnableToVerify);
    console.log('  - Has "NOT INDEXED ON GOOGLE SERP" banner:', hasNewNotIndexed);
    console.log('  - Has "Signals Dispatched" telemetry:', hasNewSignalsDispatchedTelemetry);
    console.log('  - Has OLD "CRAWL QUEUED — PENDING PUBLIC SERP" banner:', hasOldCrawlQueuedBanner);
  } else {
    console.log('\nNote: Quick-index client chunk not directly isolated in initial HTML references.');
  }

  // 3. Test Absent / Inconclusive URL against live /api/urls/check-index
  console.log('\n[3/4] Testing Absent URL against live /api/urls/check-index endpoint...');
  const absentUrl = 'https://example.com/nonexistent-audit-test-page-' + Date.now();
  console.log('Target URL (Absent):', absentUrl);

  const absentRes = await request(
    {
      hostname: 'indexmetrix.com',
      port: 443,
      path: '/api/urls/check-index',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
    },
    JSON.stringify({ url: absentUrl })
  );

  console.log('Absent Check HTTP Status:', absentRes.status);
  let absentData;
  try {
    absentData = JSON.parse(absentRes.body);
  } catch {
    absentData = absentRes.body;
  }
  console.log('Absent Check Response:', JSON.stringify(absentData, null, 2));

  // Also test the specific URL mentioned in the original bug report:
  console.log('\nTesting ProBoards forum URL from bug report...');
  const proboardsUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
  const proboardsRes = await request(
    {
      hostname: 'indexmetrix.com',
      port: 443,
      path: '/api/urls/check-index',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
    },
    JSON.stringify({ url: proboardsUrl })
  );

  console.log('ProBoards Check HTTP Status:', proboardsRes.status);
  let proboardsData;
  try {
    proboardsData = JSON.parse(proboardsRes.body);
  } catch {
    proboardsData = proboardsRes.body;
  }
  console.log('ProBoards Check Response:', JSON.stringify(proboardsData, null, 2));

  // 4. Test Known Live URL against live /api/urls/check-index
  console.log('\n[4/4] Testing Known Live URL against live /api/urls/check-index endpoint...');
  const liveUrl = 'https://en.wikipedia.org/wiki/Main_Page';
  console.log('Target URL (Known Live):', liveUrl);

  const liveRes = await request(
    {
      hostname: 'indexmetrix.com',
      port: 443,
      path: '/api/urls/check-index',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
    },
    JSON.stringify({ url: liveUrl })
  );

  console.log('Live URL Check HTTP Status:', liveRes.status);
  let liveData;
  try {
    liveData = JSON.parse(liveRes.body);
  } catch {
    liveData = liveRes.body;
  }
  console.log('Live URL Check Response:', JSON.stringify(liveData, null, 2));

  console.log('\n====================================================');
  console.log('VERIFICATION SUMMARY');
  console.log('====================================================');
  if (absentData && absentData.report) {
    console.log('Absent URL Verification State:', absentData.report.verificationState);
    console.log('Absent URL isIndexed Flag:', absentData.report.isIndexed);
  }
  if (proboardsData && proboardsData.report) {
    console.log('ProBoards URL Verification State:', proboardsData.report.verificationState);
    console.log('ProBoards URL isIndexed Flag:', proboardsData.report.isIndexed);
  }
  if (liveData && liveData.report) {
    console.log('Known Live URL Verification State:', liveData.report.verificationState);
    console.log('Known Live URL isIndexed Flag:', liveData.report.isIndexed);
  }
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
