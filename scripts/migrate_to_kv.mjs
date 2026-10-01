// One-time migration script from ExtendsClass bins directly into Cloudflare Worker KV
const WORKER_BASE = 'https://floral-union-26d1.alexeyberezin2.workers.dev';

const OLD_BINS = {
  schedule: 'https://extendsclass.com/api/json-storage/bin/cecbcbf',
  homework: 'https://extendsclass.com/api/json-storage/bin/dfdebcc',
  attendance: 'https://extendsclass.com/api/json-storage/bin/cdaacff'
};

async function migrate() {
  console.log('--- STARTING DATA MIGRATION TO CLOUDFLARE KV ---');

  for (const [type, binUrl] of Object.entries(OLD_BINS)) {
    console.log(`\nFetching ${type} from ${binUrl}...`);
    try {
      const res = await fetch(`${binUrl}?_t=${Date.now()}`);
      if (!res.ok) {
        console.warn(`Failed to fetch ${type}: HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      const payload = typeof raw.payload === 'string' ? JSON.parse(raw.payload) : (raw.data || raw);
      const byGroup = payload.byGroup || {};

      // If byGroup is missing or only top-level items exist for attendance
      if (type === 'attendance' && Array.isArray(payload.records)) {
        payload.records.forEach(r => {
          const gid = r.groupId || 'ingt-310';
          if (!byGroup[gid]) byGroup[gid] = { records: [] };
          byGroup[gid].records.push(r);
        });
      }

      const groupIds = Object.keys(byGroup);
      console.log(`Found ${groupIds.length} groups for ${type}: ${groupIds.join(', ')}`);

      for (const gid of groupIds) {
        const groupData = byGroup[gid];
        console.log(`Migrating ${type}:${gid}...`);
        const putUrl = `${WORKER_BASE}/sync/${type}?groupId=${encodeURIComponent(gid)}`;
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            byGroup: {
              [gid]: groupData
            }
          })
        });

        if (putRes.ok) {
          const respJson = await putRes.json().catch(() => ({}));
          console.log(`  -> SUCCESS: ${type}:${gid} saved to KV (updatedAt: ${respJson.updatedAt})`);
        } else {
          const errText = await putRes.text();
          console.error(`  -> ERROR: ${type}:${gid} failed (HTTP ${putRes.status}): ${errText}`);
        }
      }
    } catch (err) {
      console.error(`Error during migration of ${type}:`, err);
    }
  }

  console.log('\n--- VERIFYING MIGRATED DATA IN KV ---');
  for (const gid of ['ingt-310', 'ingt-303']) {
    for (const type of ['attendance', 'homework', 'schedule']) {
      const checkRes = await fetch(`${WORKER_BASE}/sync/${type}?groupId=${encodeURIComponent(gid)}`);
      if (checkRes.ok) {
        const json = await checkRes.json();
        const count = json.byGroup?.[gid]?.records?.length ?? json.byGroup?.[gid]?.items?.length ?? 'OK';
        console.log(`VERIFIED ${type}:${gid} -> Data present (${count})`);
      } else {
        console.warn(`CHECK FAILED for ${type}:${gid}: HTTP ${checkRes.status}`);
      }
    }
  }

  console.log('\n--- MIGRATION COMPLETED SUCCESSFULLY ---');
}

migrate().catch(console.error);
