/**
 * Markdown pipeline benchmark.
 *
 * Measures the work that happens off the main thread: parse, HAST transform
 * (highlighting, placeholders) and sanitization. Browser paint and React commit
 * are NOT measured here; see README "Performance" for the boundaries.
 *
 * Run with: npm run bench
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arch, cpus, platform, totalmem } from 'node:os';

import { renderMarkdown } from '../src/lib/markdownPipeline';

const OUT_DIR = join(process.cwd(), 'bench');

const OPTIONS = {
  base: { kind: 'none' as const },
  assetOrigin: null,
  disableRichContent: false,
};

function buildDocument(targetBytes: number): string {
  const sections: string[] = ['# Benchmark document\n\n'];
  let size = sections[0]!.length;
  let index = 0;

  while (size < targetBytes) {
    index += 1;
    const block = [
      `## Section ${index}\n\n`,
      `Paragraph ${index} with **bold**, *italic*, ~~struck~~ and \`inline code\`. `,
      'A [link](https://example.com) and an autolink https://example.com.\n\n',
      '| Column A | Column B | Column C |\n| --- | --- | --- |\n',
      `| ${index} | value | ${index * 2} |\n\n`,
      '- [x] completed task\n- [ ] pending task\n\n',
      '```js\n',
      `const value${index} = ${index};\n`,
      'function compute(input) {\n  return input * 2 + 1;\n}\n',
      '```\n\n',
      `Inline math $a_${index}^2 + b_${index}^2 = c_${index}^2$ and a block:\n\n`,
      '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n\n',
      '```mermaid\n',
      'graph TD;\n  A[Start] --> B{Decision};\n  B -->|Yes| C[Finish];\n  B -->|No| A;\n',
      '```\n\n',
      '> A quotation with some text to measure blockquote handling.\n\n',
    ].join('');

    sections.push(block);
    size += block.length;
  }

  return sections.join('');
}

interface Measurement {
  bytes: number;
  runs: { parse: number; transform: number; sanitize: number; total: number }[];
  median: { parse: number; transform: number; sanitize: number; total: number };
  minTotal: number;
  heapDeltaMb: number;
  headings: number;
  placeholders: { math: number; mermaid: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function measure(source: string, runs = 3): Measurement {
  const results: Measurement['runs'] = [];

  if (globalThis.gc) globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  let headings = 0;
  let placeholders = { math: 0, mermaid: 0 };

  for (let index = 0; index < runs; index += 1) {
    const output = renderMarkdown(source, OPTIONS);
    results.push(output.timings);
    headings = output.headings.length;
    placeholders = output.placeholders;
  }

  const heapAfter = process.memoryUsage().heapUsed;

  return {
    bytes: Buffer.byteLength(source, 'utf8'),
    runs: results,
    median: {
      parse: median(results.map((run) => run.parse)),
      transform: median(results.map((run) => run.transform)),
      sanitize: median(results.map((run) => run.sanitize)),
      total: median(results.map((run) => run.total)),
    },
    minTotal: Math.min(...results.map((run) => run.total)),
    heapDeltaMb: Math.round(((heapAfter - heapBefore) / 1024 / 1024) * 10) / 10,
    headings,
    placeholders,
  };
}

function format(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const fixtures: { name: string; target: number }[] = [
    { name: '200KB', target: 200 * 1024 },
    { name: '5MB', target: 5 * 1024 * 1024 },
  ];

  const environment = {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    totalMemoryGb: Math.round(totalmem() / 1024 / 1024 / 1024),
    node: process.version,
    measuredAt: new Date().toISOString(),
  };

  const report: { environment: typeof environment; results: Record<string, Measurement> } = {
    environment,
    results: {},
  };

  for (const fixture of fixtures) {
    const source = buildDocument(fixture.target);
    writeFileSync(join(OUT_DIR, `${fixture.name}.md`), source, 'utf8');
    report.results[fixture.name] = measure(source);

    const result = report.results[fixture.name]!;
    process.stdout.write(
      [
        `${fixture.name} (${(result.bytes / 1024).toFixed(0)} KB, ${result.headings} headings)`,
        `  parse      ${format(result.median.parse)}`,
        `  transform  ${format(result.median.transform)}`,
        `  sanitize   ${format(result.median.sanitize)}`,
        `  total      ${format(result.median.total)} (best ${format(result.minTotal)})`,
        `  heap delta ${result.heapDeltaMb} MB`,
        '',
      ].join('\n'),
    );
  }

  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`Report written to ${join(OUT_DIR, 'results.json')}\n`);
}

main();
