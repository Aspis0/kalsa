#!/usr/bin/env node
/**
 * Re-grade campaigns with the new decline-aware fact_recall metric
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gradeFile } from './benchGrade.mjs';

const campaigns = [
  { path: '/Users/marco/.claude/jobs/c32b104e/tmp/camp31760', model: '2B', label: 'camp31760' },
  { path: '/Users/marco/.claude/jobs/c32b104e/tmp/c4b3', model: '4B', label: 'c4b3' }
];

const results = [];

for (const campaign of campaigns) {
  console.log(`\n=== Re-grading ${campaign.model} campaign (${campaign.label}) ===\n`);
  
  // List directories (arms)
  const arms = readdirSync(campaign.path, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const arm of arms) {
    const armPath = join(campaign.path, arm);
    const oldResultPath = join(armPath, 'result.json');
    const newResultPath = join(armPath, 'result_new.json');
    
    if (!existsSync(oldResultPath)) {
      console.log(`  ${arm}: no result.json, skipping`);
      continue;
    }
    
    // Read old result
    const oldResult = JSON.parse(readFileSync(oldResultPath, 'utf-8'));
    
    // Re-grade with new metric
    const rawJsonPath = join(armPath, 'raw.json');
    const newResult = gradeFile(rawJsonPath);
    writeFileSync(newResultPath, JSON.stringify(newResult, null, 2));
    
    // Extract fact_recall metrics
    const oldRecall = oldResult.recall || 0;
    const newRecall = newResult.recall || 0;
    
    // Count declined probes
    const earlyStats = newResult.byFamily?.fact_recall_early || { found: 0, total: 0, declined: 0 };
    const lateStats = newResult.byFamily?.fact_recall_late || { found: 0, total: 0, declined: 0 };
    
    const recovered = earlyStats.found + lateStats.found;
    const wrong = (earlyStats.total - earlyStats.found) + (lateStats.total - lateStats.found);
    const declined = earlyStats.declined + lateStats.declined;
    
    const delta = newRecall - oldRecall;
    const deltaStr = delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3);
    
    console.log(`  ${arm}: ${oldRecall.toFixed(3)} → ${newRecall.toFixed(3)} (${deltaStr})`);
    console.log(`    recovered=${recovered}, wrong=${wrong}, declined=${declined}`);
    
    results.push({
      campaign: campaign.model,
      arm,
      oldRecall,
      newRecall,
      delta,
      recovered,
      wrong,
      declined
    });
  }
}

// Summary
console.log('\n\n=== SUMMARY ===\n');

const bare2B = results.filter(r => r.campaign === '2B' && r.arm.startsWith('baseline'));
const bare4B = results.filter(r => r.campaign === '4B' && r.arm.startsWith('baseline'));
const ciswire2B = results.filter(r => r.campaign === '2B' && r.arm.startsWith('ciswire'));
const ciswire4B = results.filter(r => r.campaign === '4B' && r.arm.startsWith('ciswire'));

function summarize(label, arms) {
  if (arms.length === 0) return;
  const avgOld = arms.reduce((s, a) => s + a.oldRecall, 0) / arms.length;
  const avgNew = arms.reduce((s, a) => s + a.newRecall, 0) / arms.length;
  const avgDelta = avgNew - avgOld;
  const totalDeclined = arms.reduce((s, a) => s + a.declined, 0);
  
  console.log(`${label}:`);
  console.log(`  Old avg: ${avgOld.toFixed(3)}`);
  console.log(`  New avg: ${avgNew.toFixed(3)} (${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(3)})`);
  console.log(`  Total declined: ${totalDeclined}`);
  console.log();
}

summarize('2B Baseline (bare)', bare2B);
summarize('4B Baseline (bare)', bare4B);
summarize('2B Ciswire', ciswire2B);
summarize('4B Ciswire', ciswire4B);

// Write summary to file
writeFileSync('/tmp/regrade_summary.json', JSON.stringify(results, null, 2));
console.log('Detailed results saved to /tmp/regrade_summary.json');
