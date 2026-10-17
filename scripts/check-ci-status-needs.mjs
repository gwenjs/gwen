#!/usr/bin/env node
/**
 * Every job id except ci-status must be listed in ci-status.needs,
 * and the status step must read that job's result.
 * A job is exempt when its own if, after collapsing whitespace, is only
 * schedule or workflow_dispatch. if: always() is not exempt.
 * Run: node scripts/check-ci-status-needs.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** @type {ReadonlySet<string>} */
const SCHEDULE_ONLY_IF = new Set([
  "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  'github.event_name == "schedule" || github.event_name == "workflow_dispatch"',
]);

/**
 * @typedef {{ error: string | null, jobs: string[], needs: string[], missing: string[], unread: string[] }} Report
 */

/**
 * @param {string} yaml
 * @returns {Report}
 */
export function evaluateCiStatus(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'jobs:');
  if (start === -1) {
    return { error: 'no jobs key', jobs: [], needs: [], missing: [], unread: [] };
  }
  /** @type {string[]} */
  const jobs = [];
  /** @type {Set<string>} */
  const exempt = new Set();
  /** @type {Set<string>} */
  const seenJobIf = new Set();
  /** @type {string | null} */
  let currentJob = null;
  /** @type {string[] | null} */
  let needs = null;
  /** @type {string[]} */
  const statusLines = [];
  let inStatus = false;
  let inNeedsList = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line) && line.trim() !== '') break;
    const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (job) {
      const id = job[1] ?? '';
      jobs.push(id);
      currentJob = id;
      inStatus = id === 'ci-status';
      inNeedsList = false;
      continue;
    }
    if (currentJob && !seenJobIf.has(currentJob)) {
      const expression = jobIfExpression(line);
      if (expression !== null) {
        seenJobIf.add(currentJob);
        if (SCHEDULE_ONLY_IF.has(expression)) exempt.add(currentJob);
      }
    }
    if (!inStatus) continue;
    statusLines.push(line);
    const inline = line.match(/^ {4}needs:\s*\[([^\]]*)\]\s*$/);
    if (inline) {
      needs = (inline[1] ?? '')
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      inNeedsList = false;
      continue;
    }
    if (/^ {4}needs:\s*$/.test(line)) {
      needs = [];
      inNeedsList = true;
      continue;
    }
    if (inNeedsList) {
      const item = line.match(/^ {6}-\s+(['"]?)([A-Za-z0-9_-]+)\1\s*$/);
      if (item) {
        needs.push(item[2] ?? '');
        continue;
      }
      inNeedsList = false;
    }
  }
  if (!jobs.includes('ci-status')) {
    return {
      error: 'no ci-status job',
      jobs,
      needs: needs ?? [],
      missing: jobs.filter((job) => !exempt.has(job)),
      unread: [],
    };
  }
  if (!needs) {
    const rest = jobs.filter((job) => job !== 'ci-status');
    const missing = rest.filter((job) => !exempt.has(job));
    return { error: 'ci-status has no needs list', jobs, needs: [], missing, unread: rest };
  }
  const missing = jobs.filter((job) => job !== 'ci-status' && !exempt.has(job) && !needs.includes(job));
  const body = statusLines.join('\n');
  const unread = needs.filter((job) => !resultIsRead(body, job));
  return { error: null, jobs, needs, missing, unread };
}

/**
 * Job-level `if:` expression, or null when this line is not that key.
 * Collapses whitespace so spacing does not change the exact-text check.
 * @param {string} line
 * @returns {string | null}
 */
function jobIfExpression(line) {
  const match = line.match(/^ {4}if:\s*(.*)$/);
  if (!match) return null;
  return (match[1] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} body
 * @param {string} id
 * @returns {boolean}
 */
function resultIsRead(body, id) {
  return (
    body.includes(`needs.${id}.result`) ||
    body.includes(`needs['${id}'].result`) ||
    body.includes(`needs["${id}"].result`)
  );
}

function main() {
  const yamlPath = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));
  const report = evaluateCiStatus(readFileSync(yamlPath, 'utf8'));
  if (report.error || report.missing.length > 0 || report.unread.length > 0) {
    if (report.error) console.error(report.error);
    if (report.missing.length > 0) console.error(`ci-status.needs is missing: ${report.missing.join(', ')}`);
    if (report.unread.length > 0) console.error(`ci-status step does not read: ${report.unread.join(', ')}`);
    process.exit(1);
  }
  console.log(`ci-status needs ok (${report.needs.join(', ')})`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
