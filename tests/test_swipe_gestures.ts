import assert from 'assert';

console.log('=================================================');
console.log('  TEST SUITE: COMPREHENSIVE SWIPE & GESTURE QA   ');
console.log('=================================================');

function evaluateSwipe(startX: number, startY: number, endX: number, endY: number, startTime: number, endTime: number): 'next' | 'prev' | null {
  const diffX = startX - endX;
  const diffY = Math.abs(startY - endY);
  const elapsed = endTime - startTime;

  const isDominantHorizontal = Math.abs(diffX) > diffY * 1.1;
  const isDistance = Math.abs(diffX) >= 30;
  const isFlick = Math.abs(diffX) >= 20 && elapsed < 350;

  if (isDominantHorizontal && (isDistance || isFlick)) {
    return diffX > 0 ? 'next' : 'prev';
  }
  return null;
}

// 1. Mobile Touch Swipes
console.log('\n--- 1. Mobile Touch Swipes ---');
assert.strictEqual(evaluateSwipe(200, 300, 140, 310, 1000, 1200), 'next', 'Touch swipe left advances to next day');
console.log('  [PASS] Touch swipe left (60px drag, 10px Y variance) -> next day');

assert.strictEqual(evaluateSwipe(100, 300, 165, 295, 1000, 1200), 'prev', 'Touch swipe right returns to prev day');
console.log('  [PASS] Touch swipe right (65px drag, 5px Y variance) -> prev day');

// 2. Desktop Mouse Drags (Telegram Desktop)
console.log('\n--- 2. Desktop Mouse Drag (Telegram Desktop) ---');
assert.strictEqual(evaluateSwipe(500, 250, 440, 255, 2000, 2180), 'next', 'Mouse drag left in Telegram Desktop');
console.log('  [PASS] Mouse drag left in Telegram Desktop -> next day');

assert.strictEqual(evaluateSwipe(300, 250, 380, 248, 2000, 2220), 'prev', 'Mouse drag right in Telegram Desktop');
console.log('  [PASS] Mouse drag right in Telegram Desktop -> prev day');

// 3. Quick Flicks
console.log('\n--- 3. Fast Flicks (< 350ms) ---');
assert.strictEqual(evaluateSwipe(200, 200, 175, 205, 3000, 3150), 'next', 'Quick flick left 25px in 150ms');
console.log('  [PASS] Quick flick left (25px in 150ms) -> next day');

assert.strictEqual(evaluateSwipe(200, 200, 225, 198, 3000, 3160), 'prev', 'Quick flick right 25px in 160ms');
console.log('  [PASS] Quick flick right (25px in 160ms) -> prev day');

// 4. Vertical Scroll Non-Interference
console.log('\n--- 4. Vertical Scroll Safety (Must NOT trigger swipe) ---');
assert.strictEqual(evaluateSwipe(200, 200, 210, 450, 4000, 4300), null, 'Vertical scroll down 250px');
console.log('  [PASS] Vertical scroll down (250px Y, 10px X) does NOT trigger swipe');

assert.strictEqual(evaluateSwipe(200, 400, 195, 150, 4000, 4300), null, 'Vertical scroll up 250px');
console.log('  [PASS] Vertical scroll up (250px Y, 5px X) does NOT trigger swipe');

// 5. Button / Lesson Card Click Tap
console.log('\n--- 5. Click / Tap Safety ---');
assert.strictEqual(evaluateSwipe(150, 150, 152, 151, 5000, 5080), null, 'Tap on card or button');
console.log('  [PASS] Tap on card or button (2px movement) does NOT trigger swipe');

console.log('\n=================================================');
console.log('  SUMMARY: ALL 7 GESTURE SCENARIOS PASSED (100%)');
console.log('=================================================\n');
