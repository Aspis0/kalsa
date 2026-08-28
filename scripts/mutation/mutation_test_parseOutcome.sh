#!/usr/bin/env bash
# Mutation test for the extractParseOutcome field added in this commit.
# Verifies that removing or breaking the field causes harness failures.

set -e

echo "=== Mutation Test: extractParseOutcome field ==="
echo ""

# Backup original files
cp src/memory/memoryTelemetry.ts src/memory/memoryTelemetry.ts.mut_backup
cp src/memory/MemoryStore.ts src/memory/MemoryStore.ts.mut_backup

cleanup() {
    echo "Restoring original files..."
    if [ -f src/memory/memoryTelemetry.ts.mut_backup ]; then
        mv src/memory/memoryTelemetry.ts.mut_backup src/memory/memoryTelemetry.ts
    fi
    if [ -f src/memory/MemoryStore.ts.mut_backup ]; then
        mv src/memory/MemoryStore.ts.mut_backup src/memory/MemoryStore.ts
    fi
}
trap cleanup EXIT

echo "Mutation 1: Remove extractParseOutcome from MemoryTelemetry interface"
echo "----------------------------------------------------------------------"
# Remove the field from the interface
sed -i '' '/extractParseOutcome: number;/d' src/memory/memoryTelemetry.ts

echo "Running tsc..."
if npx tsc --noEmit > /tmp/tsc_mut1.log 2>&1; then
    echo "❌ MUTATION 1 NOT DETECTED: tsc should have failed"
    exit 1
else
    echo "✓ MUTATION 1 DETECTED: tsc failed when field removed from interface"
fi

echo ""
echo "Mutation 2: Remove trackMemoryParseOutcome export"
echo "--------------------------------------------------"
# Restore interface first
mv src/memory/memoryTelemetry.ts.mut_backup src/memory/memoryTelemetry.ts
cp src/memory/memoryTelemetry.ts src/memory/memoryTelemetry.ts.mut_backup

# Remove the export keyword from trackMemoryParseOutcome
sed -i '' 's/export function trackMemoryParseOutcome/function trackMemoryParseOutcome/' src/memory/MemoryStore.ts

echo "Running tsc..."
if npx tsc --noEmit > /tmp/tsc_mut2.log 2>&1; then
    echo "❌ MUTATION 2 NOT DETECTED: tsc should have failed"
    exit 1
else
    echo "✓ MUTATION 2 DETECTED: tsc failed when export removed"
fi

echo ""
echo "Mutation 3: Remove extractParseOutcome from telemetry accumulator"
echo "------------------------------------------------------------------"
# Restore original
mv src/memory/MemoryStore.ts.mut_backup src/memory/MemoryStore.ts
cp src/memory/MemoryStore.ts src/memory/MemoryStore.ts.mut_backup

# Remove the field from the accumulator initialization
sed -i '' '/extractParseOutcome: 0,/d' src/memory/MemoryStore.ts

echo "Running tsc..."
if npx tsc --noEmit > /tmp/tsc_mut3.log 2>&1; then
    echo "❌ MUTATION 3 NOT DETECTED: tsc should have failed"
    exit 1
else
    echo "✓ MUTATION 3 DETECTED: tsc failed when accumulator field removed"
fi

echo ""
echo "Mutation 4: Remove extractParseOutcome from formatMemoryLine"
echo "-------------------------------------------------------------"
# Restore original
mv src/memory/MemoryStore.ts.mut_backup src/memory/MemoryStore.ts

# Remove the field from the formatter
sed -i '' '/extractParseOutcome: t.extractParseOutcome,/d' src/memory/memoryTelemetry.ts

echo "Running harness..."
if node scripts/harnesses/memoryTelemetryHarness.mjs > /tmp/harness_mut4.log 2>&1; then
    echo "❌ MUTATION 4 NOT DETECTED: harness should have failed"
    exit 1
else
    if grep -q "Exactly 8 fields must be present\|extractParseOutcome must be present" /tmp/harness_mut4.log; then
        echo "✓ MUTATION 4 DETECTED: harness failed when field removed from formatter"
    else
        echo "❌ MUTATION 4 NOT DETECTED: harness failed but for wrong reason"
        cat /tmp/harness_mut4.log
        exit 1
    fi
fi

echo ""
echo "=== All mutations detected ==="
echo "✓ The extractParseOutcome field is properly tested"
