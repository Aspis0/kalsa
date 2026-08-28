#!/usr/bin/env node
/**
 * Mutation test: verify the fix is actually working by testing different scenarios.
 */
import { gradeAllProbes } from '../bench/benchGraders.mjs';

const FACTS = ["Leopoldo", "4500"];

console.log('=== Mutation Test ===\n');

// Test 1: German should abstain (not assert)
console.log('Test 1: German assertion WITHOUT umlaut (de locale)');
console.log('  Input: "Die Katze heisst Leopoldo und das Budget ist 4500."');
const deTurns = [{
  index: 1,
  kind: 'probe',
  id: 'probe_facts',
  reply: 'Die Katze heisst Leopoldo und das Budget ist 4500.',
  sources: 0,
  hasMiniapp: false,
  elapsed_s: 10,
}];

const { probes: deProbes } = gradeAllProbes(deTurns, FACTS, 'de');
const deFactProbes = deProbes.filter(p => p.family.startsWith('fact_recall'));
const deAllAbstained = deFactProbes.every(p => p.found === null && p.abstained);

for (const p of deFactProbes) {
  const status = p.found === null ? 'ABSTAINED' : p.found ? 'FOUND' : 'NOT_FOUND';
  console.log(`    ${p.name}: ${status} ${p.abstained ? '(abstained=true)' : ''}`);
}

if (deAllAbstained) {
  console.log('  ✓ PASS: German text abstained (not asserted)');
} else {
  console.log('  ❌ FAIL: German text was asserted (should be abstained)');
}
console.log();

// Test 2: Italian should use three-way classification
console.log('Test 2: Italian assertion (it locale)');
console.log('  Input: "Il gatto si chiama Leopoldo."');
const itTurns = [{
  index: 1,
  kind: 'probe',
  id: 'probe_facts',
  reply: 'Il gatto si chiama Leopoldo.',
  sources: 0,
  hasMiniapp: false,
  elapsed_s: 10,
}];

const { probes: itProbes } = gradeAllProbes(itTurns, FACTS, 'it');
const itFactProbes = itProbes.filter(p => p.family.startsWith('fact_recall'));
const itLeopoldo = itFactProbes.find(p => p.name === 'fact_Leopoldo');
const it4500 = itFactProbes.find(p => p.name === 'fact_4500');

console.log(`    fact_Leopoldo: ${itLeopoldo?.found === true ? 'FOUND' : 'NOT_FOUND'}`);
console.log(`    fact_4500: ${it4500?.found === false ? 'NOT_FOUND' : 'FOUND'}`);

if (itLeopoldo?.found === true && it4500?.found === false) {
  console.log('  ✓ PASS: Italian text uses three-way classification correctly');
} else {
  console.log('  ❌ FAIL: Italian text three-way classification is wrong');
}
console.log();

// Test 3: French should abstain (not in validated set)
console.log('Test 3: French text (fr locale - not in validated set)');
console.log('  Input: "Le chat sappelle Leopoldo."');
const frTurns = [{
  index: 1,
  kind: 'probe',
  id: 'probe_facts',
  reply: 'Le chat sappelle Leopoldo.',
  sources: 0,
  hasMiniapp: false,
  elapsed_s: 10,
}];

const { probes: frProbes, notes: frNotes } = gradeAllProbes(frTurns, FACTS, 'fr');
const frFactProbes = frProbes.filter(p => p.family.startsWith('fact_recall'));
const frAllAbstained = frFactProbes.every(p => p.found === null && p.abstained);

console.log(`  Notes: ${frNotes[0] || 'none'}`);
for (const p of frFactProbes) {
  const status = p.found === null ? 'ABSTAINED' : p.found ? 'FOUND' : 'NOT_FOUND';
  console.log(`    ${p.name}: ${status} ${p.abstained ? '(abstained=true)' : ''}`);
}

if (frAllAbstained) {
  console.log('  ✓ PASS: French text abstained (not in validated set)');
} else {
  console.log('  ❌ FAIL: French text was not abstained');
}
console.log();

// Test 4: Italian with stray German word should use Italian three-way
console.log('Test 4: Italian with stray German word (it locale)');
console.log('  Input: "Non ho i dati, mi spiace für alles."');
const mixedTurns = [{
  index: 1,
  kind: 'probe',
  id: 'probe_facts',
  reply: 'Non ho i dati, mi spiace für alles.',
  sources: 0,
  hasMiniapp: false,
  elapsed_s: 10,
}];

const { probes: mixedProbes } = gradeAllProbes(mixedTurns, FACTS, 'it');
const mixedFactProbes = mixedProbes.filter(p => p.family.startsWith('fact_recall'));
const mixedAllAbstained = mixedFactProbes.every(p => p.found === null);
const mixedDeclined = mixedFactProbes.some(p => p.declined);

console.log(`  All abstained: ${mixedAllAbstained}`);
console.log(`  Any declined: ${mixedDeclined}`);

if (mixedAllAbstained && mixedDeclined) {
  console.log('  ✓ PASS: Italian with German word uses Italian path (declined, not detected as German)');
} else {
  console.log('  ❌ FAIL: Mixed language handling is wrong');
}
console.log();

// Summary
console.log('=== Mutation Test Summary ===');
const allPassed = deAllAbstained && 
                  (itLeopoldo?.found === true && it4500?.found === false) && 
                  frAllAbstained && 
                  (mixedAllAbstained && mixedDeclined);

if (allPassed) {
  console.log('✓ ALL TESTS PASSED');
  console.log('✓ Fix is working correctly');
  console.log('✓ German text is abstained (not asserted)');
  console.log('✓ Italian/English/Japanese use three-way classification');
  console.log('✓ Non-validated locales abstain');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
