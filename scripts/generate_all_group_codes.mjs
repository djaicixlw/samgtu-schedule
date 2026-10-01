import { createGroupCodeRecord } from './make-group-code.mjs';
import fs from 'fs';

const GROUPS = [
  { id: 'ingt-310', name: '3-ИНГТ-110' },
  { id: 'ingt-301', name: '3-ИНГТ-101' },
  { id: 'ingt-302', name: '3-ИНГТ-102' },
  { id: 'ingt-303', name: '3-ИНГТ-103' },
  { id: 'ingt-304', name: '3-ИНГТ-104' },
  { id: 'ingt-305', name: '3-ИНГТ-105' },
  { id: 'ingt-306', name: '3-ИНГТ-106' },
  { id: 'ingt-307', name: '3-ИНГТ-107' },
  { id: 'ingt-308', name: '3-ИНГТ-108' },
  { id: 'ingt-309', name: '3-ИНГТ-109' },
  { id: 'ingt-311', name: '3-ИНГТ-111' },
  { id: 'ingt-312', name: '3-ИНГТ-112' },
  { id: 'ingt-313', name: '3-ИНГТ-113' },
  { id: 'ingt-314', name: '3-ИНГТ-114' },
  { id: 'faid-310', name: '3-ФАИД-110' },
  { id: 'htf-215',  name: '2-ХТФ-115' },
  { id: 'ingt-209', name: '2-ИНГТ-109' },
  { id: 'iait-308', name: '3-ИАИТ-108' },
  { id: 'admin',    name: 'Администратор (Куратор)' }
];

async function run() {
  const results = [];
  const kvEntries = [];

  for (const g of GROUPS) {
    const record = await createGroupCodeRecord(g.id);
    results.push({
      groupId: g.id,
      groupName: g.name,
      code: record.code,
      codeSalt: record.kvData.codeSalt,
      codeHash: record.kvData.codeHash
    });
    kvEntries.push({
      key: `g:${g.id.toLowerCase()}`,
      value: JSON.stringify(record.kvData)
    });
  }

  // Save KV bulk upload file
  fs.writeFileSync('kv-group-codes.json', JSON.stringify(kvEntries, null, 2), 'utf-8');

  console.log('| № | ID группы | Название группы | Код старосты (передать лично) |');
  console.log('|---|---|---|---|');
  results.forEach((r, idx) => {
    console.log(`| ${idx + 1} | \`${r.groupId}\` | **${r.groupName}** | \`${r.code}\` |`);
  });

  console.log('\n--- WRANGLER COMMANDS ---');
  results.forEach(r => {
    const data = JSON.stringify({
      codeSalt: r.codeSalt,
      codeHash: r.codeHash,
      codeVer: 1,
      staff: [],
      slots: []
    });
    console.log(`wrangler kv:key put --binding=APP_DATA "g:${r.groupId}" '${data}'`);
  });
}

run().catch(console.error);
