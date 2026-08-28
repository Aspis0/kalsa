#!/bin/bash
# Proper mutation test: directly modify source and show what breaks

set -e

echo "=== Mutation Test: What Would Go Red ==="
echo ""

# Backup
cp scripts/benchGraders.mjs scripts/benchGraders.mjs.test_backup
cp src/rules/entityContainment.js src/rules/entityContainment.js.test_backup

echo "Mutation 1: Remove locale validation (allow all locales to use three-way classification)"
echo "------------------------------------------------------------------------------------------"
echo "Change: VALIDATED_LOCALES set check → always true"
echo ""

# Actually modify the code
cat > /tmp/mutate.mjs << 'MUTATOR'
import { readFileSync, writeFileSync } from 'fs';
const file = 'scripts/benchGraders.mjs';
let code = readFileSync(file, 'utf8');
// Replace the locale check to always enable three-way
code = code.replace(
  'const threeWayEnabled = VALIDATED_LOCALES.has(localeStr);',
  'const threeWayEnabled = true; // MUTATION: always enable'
);
writeFileSync(file, code);
MUTATOR

node /tmp/mutate.mjs

echo "Running tests with mutation..."
echo ""
node scripts/mutation_test.mjs 2>&1 | grep -E "(Test [0-9]|Input:|fact_|PASS|FAIL|abstained|FOUND)" | head -30

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -ne 0 ]; then
    echo "✓ MUTATION 1 DETECTED: Tests failed when locale validation removed"
else
    echo "❌ MUTATION 1 NOT DETECTED: Tests should have failed"
fi
echo ""

# Restore
cp scripts/benchGraders.mjs.test_backup scripts/benchGraders.mjs

echo "Mutation 2: Remove abstained flag from probes"
echo "----------------------------------------------"
echo "Change: Don't set abstained=true on fact probes"
echo ""

cat > /tmp/mutate2.mjs << 'MUTATOR'
import { readFileSync, writeFileSync } from 'fs';
const file = 'scripts/benchGraders.mjs';
let code = readFileSync(file, 'utf8');
// Remove the abstained flag
code = code.replace(
  /found: null,\s+abstained: true,/g,
  'found: null, // MUTATION: no abstained flag'
);
writeFileSync(file, code);
MUTATOR

node /tmp/mutate2.mjs

echo "Running tests with mutation..."
echo ""
node scripts/mutation_test.mjs 2>&1 | grep -E "(Test [0-9]|Input:|fact_|abstained=)" | head -20

echo ""
echo "Checking if abstained flag is present..."
if node scripts/mutation_test.mjs 2>&1 | grep -q "abstained=true"; then
    echo "❌ MUTATION 2 NOT DETECTED: abstained flag still present"
else
    echo "✓ MUTATION 2 DETECTED: abstained flag removed"
fi
echo ""

# Restore
cp scripts/benchGraders.mjs.test_backup scripts/benchGraders.mjs

echo "Mutation 3: Remove containsFactShapedTokens from declined check"
echo "----------------------------------------------------------------"
echo "Change: Don't check for fact-shaped tokens (always classify as declined)"
echo ""

cat > /tmp/mutate3.mjs << 'MUTATOR'
import { readFileSync, writeFileSync } from 'fs';
const file = 'scripts/benchGraders.mjs';
let code = readFileSync(file, 'utf8');
// Remove the containsFactShapedTokens check
code = code.replace(
  'const declined = !empty && !anyFactMatches && !containsFactShapedTokens(stripped);',
  'const declined = !empty && !anyFactMatches; // MUTATION: no fact-shaped check'
);
writeFileSync(file, code);
MUTATOR

node /tmp/mutate3.mjs

echo "Running tests with mutation..."
echo ""
node scripts/mutation_test.mjs 2>&1 | grep -E "(Test [0-9]|Input:|fact_|PASS|FAIL|FOUND|NOT_FOUND)" | head -30

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -ne 0 ]; then
    echo "✓ MUTATION 3 DETECTED: Tests failed when fact-shaped check removed"
else
    echo "❌ MUTATION 3 NOT DETECTED: Tests should have failed"
fi
echo ""

# Restore
cp scripts/benchGraders.mjs.test_backup scripts/benchGraders.mjs

echo "Mutation 4: Restore old umlaut detection in entityContainment.js"
echo "-----------------------------------------------------------------"
echo "Change: Re-add hasNounCapitalizationSignal and nounCapDetected logic"
echo ""

cat > /tmp/mutate4.mjs << 'MUTATOR'
import { readFileSync, writeFileSync } from 'fs';
const file = 'src/rules/entityContainment.js';
let code = readFileSync(file, 'utf8');
// Re-add the umlaut detection
code = code.replace(
  'function containsFactShapedTokens(text) {',
  `function hasNounCapitalizationSignal(text) {
  return /[äöüÄÖÜß]/.test(String(text ?? ""));
}

function containsFactShapedTokens(text) {
  const nounCapDetected = hasNounCapitalizationSignal(text);`
);
// Modify the logic to use nounCapDetected
code = code.replace(
  'if (tokens.length === 1) {\n    if (isCapitalized(tokens[0])) {',
  'if (tokens.length === 1) {\n    if (!nounCapDetected && isCapitalized(tokens[0])) {'
);
code = code.replace(
  'if (i > 0 && !prevTokenEndedSentence && isCapitalized(token)) {',
  'if (!nounCapDetected && i > 0 && !prevTokenEndedSentence && isCapitalized(token)) {'
);
writeFileSync(file, code);
MUTATOR

node /tmp/mutate4.mjs

echo "Running tests with mutation..."
echo ""
node scripts/mutation_test.mjs 2>&1 | grep -E "(Test [0-9]|Input:|fact_|PASS|FAIL)" | head -20

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -ne 0 ]; then
    echo "✓ MUTATION 4 DETECTED: Tests failed with umlaut detection restored"
else
    echo "⚠️  MUTATION 4 NOT DETECTED: Tests still pass (but umlaut detection is still wrong)"
fi
echo ""

# Restore
cp src/rules/entityContainment.js.test_backup src/rules/entityContainment.js

echo "Final verification: Tests pass with original code"
echo "--------------------------------------------------"
node scripts/mutation_test.mjs 2>&1 | tail -10

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✓ Code properly restored"
else
    echo ""
    echo "❌ Restoration failed"
fi

# Cleanup
rm -f scripts/benchGraders.mjs.test_backup src/rules/entityContainment.js.test_backup
rm -f /tmp/mutate*.mjs

echo ""
echo "=== Mutation Test Complete ==="
