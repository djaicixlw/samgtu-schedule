import { getDayName } from '../attendance';

// Simulate running getDayName on a Date created from "2026-09-07"
const dUtc = new Date("2026-09-07");
console.log("dUtc.toISOString():", dUtc.toISOString());
console.log("dUtc.getUTCDay():", dUtc.getUTCDay(), "(1 = Monday)");
console.log("dUtc.getDay() on current machine:", dUtc.getDay(), "(Samara is UTC+4, so 04:00 Monday)");

// What if the user is in London (UTC 0)?
// At 2026-09-07T00:00:00Z, London is in BST (UTC+1, so 01:00 Monday).
// What if user is in Rio / New York / Chicago / LA?
// In New York (UTC-4): 2026-09-07T00:00:00Z is 2026-09-06 20:00 (Sunday)!
// date.getDay() returns 0 -> 'Воскресенье'!
console.log("If UTC-4: getDay() would be Sunday! getDayName returns:", "Воскресенье");
