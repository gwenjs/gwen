// Stub: reads nothing, reports no check. Replaced by the real judge in the next commit.
process.stdout.write(`${JSON.stringify({ arch: process.arch, node: process.version, metrics: {}, checks: {} })}\n`);
process.exit(0);
