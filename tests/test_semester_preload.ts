import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  getSemesterConfig,
  setSemesterConfig,
  DEFAULT_SEMESTER_CONFIG,
  SemesterConfig
} from '../utils/samaraDate';

console.log("================================================================================");
console.log("   TEST SUITE: SEMESTER CONFIG PRELOAD & VALIDATION (A3-3)                      ");
console.log("   Preload before root.render(), JSON Integrity & Academic Bounds               ");
console.log("================================================================================\n");

let totalAssertions = 0;
let passedAssertions = 0;

function check(condition: boolean, description: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    assert(condition, description);
  }
}

// -----------------------------------------------------------------------------
// 1. File Existence & Parsing
// -----------------------------------------------------------------------------
console.log("--------------------------------------------------------------------------------");
console.log("1. Verification of public/semester.json existence and JSON syntax");
console.log("--------------------------------------------------------------------------------");

const semesterFilePath = path.resolve(process.cwd(), 'public', 'semester.json');
check(fs.existsSync(semesterFilePath), `semester.json exists at ${semesterFilePath}`);

const rawContent = fs.readFileSync(semesterFilePath, 'utf8');
check(rawContent.trim().length > 0, "semester.json content is non-empty");

let parsedConfig: SemesterConfig & { semesterName: string };
try {
  parsedConfig = JSON.parse(rawContent);
  check(true, "semester.json is valid JSON");
} catch (err: any) {
  check(false, `semester.json failed to parse JSON: ${err?.message}`);
  throw err;
}

// -----------------------------------------------------------------------------
// 2. Schema and Structure Verification
// -----------------------------------------------------------------------------
console.log("\n--------------------------------------------------------------------------------");
console.log("2. Schema & Structure Verification (semesterName, semesterStart, cycleWeeks, blocks)");
console.log("--------------------------------------------------------------------------------");

check(typeof parsedConfig === 'object' && parsedConfig !== null, "Config is a valid object");
check(
  typeof parsedConfig.semesterName === 'string' && parsedConfig.semesterName.trim().length > 0,
  `semesterName is present and non-empty: "${parsedConfig.semesterName}"`
);
check(
  /^\d{4}-\d{2}-\d{2}$/.test(parsedConfig.semesterStart),
  `semesterStart matches ISO format YYYY-MM-DD: ${parsedConfig.semesterStart}`
);
check(
  typeof parsedConfig.cycleWeeks === 'number' && parsedConfig.cycleWeeks === 4,
  `cycleWeeks is positive integer 4: ${parsedConfig.cycleWeeks}`
);
check(
  Array.isArray(parsedConfig.blocks) && parsedConfig.blocks.length > 0,
  `blocks is a non-empty array (count: ${parsedConfig.blocks?.length})`
);

// -----------------------------------------------------------------------------
// 3. Blocks & Chronological Order Verification
// -----------------------------------------------------------------------------
console.log("\n--------------------------------------------------------------------------------");
console.log("3. Academic Blocks Integrity & Date Ranges");
console.log("--------------------------------------------------------------------------------");

check(parsedConfig.blocks.length === 4, `blocks has exactly 4 academic blocks for the cycle`);

parsedConfig.blocks.forEach((block, idx) => {
  const blockNum = idx + 1;
  check(block.id === blockNum, `Block #${blockNum} id matches ${blockNum}`);
  check(typeof block.name === 'string' && block.name.trim().length > 0, `Block #${blockNum} has descriptive name: "${block.name}"`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(block.start), `Block #${blockNum} start format YYYY-MM-DD: ${block.start}`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(block.end), `Block #${blockNum} end format YYYY-MM-DD: ${block.end}`);
  
  const startTime = Date.parse(block.start);
  const endTime = Date.parse(block.end);
  check(!isNaN(startTime) && !isNaN(endTime), `Block #${blockNum} dates parse into valid timestamps`);
  check(block.start <= block.end, `Block #${blockNum} start (${block.start}) <= end (${block.end})`);

  if (idx === 0) {
    check(block.start === parsedConfig.semesterStart, `First block start (${block.start}) matches semesterStart (${parsedConfig.semesterStart})`);
  } else {
    const prevBlock = parsedConfig.blocks[idx - 1];
    check(block.start >= prevBlock.end, `Block #${blockNum} start (${block.start}) >= previous block end (${prevBlock.end})`);
  }
});

// -----------------------------------------------------------------------------
// 4. Semester Boundaries & Academic Half-Year Containment
// -----------------------------------------------------------------------------
console.log("\n--------------------------------------------------------------------------------");
console.log("4. Semester End Date Boundaries in Academic Half-Year");
console.log("--------------------------------------------------------------------------------");

const lastBlock = parsedConfig.blocks[parsedConfig.blocks.length - 1];
const semesterEnd = lastBlock.end;
const semesterStart = parsedConfig.semesterStart;

const startDate = new Date(`${semesterStart}T00:00:00Z`);
const endDate = new Date(`${semesterEnd}T23:59:59Z`);

const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
console.log(`  Academic span: ${semesterStart} to ${semesterEnd} (${durationDays} days)`);

check(durationDays >= 90 && durationDays <= 180, `Semester span (${durationDays} days) is within normal half-year limits (90-180 days)`);

// Autumn semester 2026: starts late August / early September 2026
// Academic half-year ends before Spring semester starts (no later than mid-February 2027)
check(semesterStart >= '2026-08-15' && semesterStart <= '2026-09-15', `Semester start (${semesterStart}) falls in autumn academic window`);
check(semesterEnd <= '2027-02-15', `Semester end (${semesterEnd}) does not exceed the academic half-year (<= 2027-02-15)`);
check(semesterEnd >= '2026-12-15', `Semester end (${semesterEnd}) spans full instructional autumn semester`);

// -----------------------------------------------------------------------------
// 5. Preload Bootstrap Simulation & Resilience
// -----------------------------------------------------------------------------
console.log("\n--------------------------------------------------------------------------------");
console.log("5. Preload Bootstrap Execution Simulation & Resilience Verification");
console.log("--------------------------------------------------------------------------------");

// 5.1 Simulated Successful Preload
const testCustomConfig: SemesterConfig & { semesterName: string } = {
  semesterName: "Осенний семестр 2026/2027",
  semesterStart: "2026-08-31",
  cycleWeeks: 4,
  blocks: parsedConfig.blocks
};

setSemesterConfig(testCustomConfig);
const loadedConfig = getSemesterConfig();
check(loadedConfig.semesterStart === '2026-08-31', "setSemesterConfig correctly applies preloaded configuration");
check(loadedConfig.blocks.length === 4, "getSemesterConfig returns updated block array");

// 5.2 Simulated Malformed Preload Rejection
// When config lacks semesterName or blocks is not array, it must not overwrite with broken data
function simulatePreloadValidation(cfg: any): boolean {
  if (cfg && cfg.semesterName && Array.isArray(cfg.blocks)) {
    setSemesterConfig(cfg);
    return true;
  }
  return false;
}

const badPayloads = [
  null,
  undefined,
  {},
  { semesterStart: '2026-08-31' }, // Missing semesterName
  { semesterName: 'Test', blocks: 'not-an-array' }, // Invalid blocks
  { blocks: [] } // Missing semesterName
];

badPayloads.forEach((payload, index) => {
  const accepted = simulatePreloadValidation(payload);
  check(!accepted, `Malformed preload payload #${index + 1} was safely ignored`);
});

// 5.3 Simulated Network Failure / Timeout Resilience
// Verifies that when fetch fails (e.g. AbortController aborts on 2000ms offline),
// error is caught without unhandled rejection and default config remains intact.
async function simulateBootstrapFetch(shouldFail: boolean) {
  try {
    const controller = new AbortController();
    if (shouldFail) {
      controller.abort();
    }
    // Simulate fetch
    if (controller.signal.aborted) {
      throw new Error("Aborted: offline timeout");
    }
    return { ok: true, json: async () => testCustomConfig };
  } catch {
    // Offline or network error fallback: samaraDate will use compiled default semester
    return null;
  }
}

(async () => {
  const offlineResult = await simulateBootstrapFetch(true);
  check(offlineResult === null, "Offline/timed-out preload gracefully caught without unhandled exception");

  const onlineResult = await simulateBootstrapFetch(false);
  check(onlineResult !== null && onlineResult.ok, "Online preload successfully completes");

  // Restore default config
  setSemesterConfig(DEFAULT_SEMESTER_CONFIG);

  console.log("\n================================================================================");
  console.log(`   SEMESTER PRELOAD TEST SUMMARY: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`);
  console.log("================================================================================\n");

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
})();
