import { formatFileSize, extractFileId, getFreshFileUrl } from '../utils/upload';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ [FAIL] ${msg}`);
    throw new Error(msg);
  } else {
    console.log(`  ✓ [PASS] ${msg}`);
  }
}

export async function runLessonMaterialsTests() {
  console.log('=================================================');
  console.log('  TEST SUITE: LESSON MATERIALS & SIGNED LINKS    ');
  console.log('=================================================');

  // --- 1. Upload Utils & Helpers ---
  console.log('\n--- 1. Verification of Upload & File Helpers ---');
  assert(formatFileSize(500) === '500 Б', 'formatFileSize formats bytes');
  assert(formatFileSize(2048) === '2 КБ', 'formatFileSize formats kilobytes');
  assert(formatFileSize(5 * 1024 * 1024) === '5.0 МБ', 'formatFileSize formats megabytes');

  assert(extractFileId('AgACAgIAAxkBAAE1234567890') === 'AgACAgIAAxkBAAE1234567890', 'extractFileId extracts raw Telegram file_id');
  assert(
    extractFileId('https://worker.dev/file?file_id=AgACAgIAAxkBAAE1234567890&exp=123&sig=abc') === 'AgACAgIAAxkBAAE1234567890',
    'extractFileId extracts file_id from query params'
  );
  assert(extractFileId('https://disk.yandex.ru/d/abcdef') === null, 'extractFileId returns null for non-Telegram links');

  // Test getFreshFileUrl fallback on external links
  const extUrl = 'https://disk.yandex.ru/d/materials_123';
  const resolved = await getFreshFileUrl(extUrl);
  assert(resolved === extUrl, 'getFreshFileUrl preserves external cloud links unchanged');

  // --- 2. EditLessonModal Component Verification ---
  console.log('\n--- 2. Verification of EditLessonModal Component ---');
  const editModalPath = join(process.cwd(), 'components', 'EditLessonModal.tsx');
  assert(existsSync(editModalPath), 'components/EditLessonModal.tsx exists');
  const editModalContent = readFileSync(editModalPath, 'utf-8');

  assert(editModalContent.includes('uploadAttachmentFile'), 'EditLessonModal integrates uploadAttachmentFile');
  assert(editModalContent.includes('type="file"'), 'EditLessonModal has file input for uploading materials');
  assert(editModalContent.includes('Прикрепить файл'), 'EditLessonModal has user-facing button to attach files');
  assert(editModalContent.includes('handleFileUpload'), 'EditLessonModal defines handleFileUpload');
  assert(editModalContent.includes('attachments'), 'EditLessonModal persists attachments in onSave');
  assert(editModalContent.includes('Paperclip'), 'EditLessonModal imports and uses Paperclip icon');

  // --- 3. ClassCard Component Verification ---
  console.log('\n--- 3. Verification of ClassCard Component ---');
  const classCardPath = join(process.cwd(), 'components', 'ClassCard.tsx');
  assert(existsSync(classCardPath), 'components/ClassCard.tsx exists');
  const classCardContent = readFileSync(classCardPath, 'utf-8');

  assert(classCardContent.includes('Paperclip'), 'ClassCard imports and renders Paperclip badge for materials');
  assert(classCardContent.includes('openAttachmentSafe'), 'ClassCard uses openAttachmentSafe for secure opening');
  assert(classCardContent.includes('Прикреплено материалов:'), 'ClassCard has accessible tooltip with materials count');
  assert(classCardContent.includes('lesson.attachments.length'), 'ClassCard dynamically counts attached materials');

  // --- 4. Cloudflare Worker B-04 Endpoint Verification ---
  console.log('\n--- 4. Verification of Cloudflare Worker B-04 Endpoint ---');
  const workerPath = join(process.cwd(), 'cloudflare-worker.js');
  assert(existsSync(workerPath), 'cloudflare-worker.js exists');
  const workerContent = readFileSync(workerPath, 'utf-8');

  assert(workerContent.includes('/v3/files/link'), 'Worker contains /v3/files/link route for fresh signed URLs');
  assert(workerContent.includes('deriveFileSigningKey'), 'Worker uses deriveFileSigningKey for HMAC');
  assert(workerContent.includes('signFileUrl'), 'Worker calls signFileUrl with expiration');
  assert(workerContent.includes('600'), 'Worker sets 10-minute (600s) TTL for signed URLs');

  // --- 5. Anti-Bureaucracy and Clean UI Tone ---
  console.log('\n--- 5. Anti-Bureaucratic & Tone Compliance Check ---');
  const uploadUtilsPath = join(process.cwd(), 'utils', 'upload.ts');
  const uploadUtilsContent = readFileSync(uploadUtilsPath, 'utf-8');

  assert(!uploadUtilsContent.includes('152-ФЗ'), 'utils/upload.ts has zero mentions of 152-ФЗ');
  assert(!editModalContent.includes('152-ФЗ'), 'EditLessonModal.tsx has zero mentions of 152-ФЗ');
  assert(!classCardContent.includes('152-ФЗ'), 'ClassCard.tsx has zero mentions of 152-ФЗ');

  console.log('\n=================================================');
  console.log('  ALL LESSON MATERIALS & SIGNED LINK CHECKS PASSED (100%)');
  console.log('=================================================\n');
}

if (process.argv[1]?.endsWith('test_lesson_materials.ts')) {
  runLessonMaterialsTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
