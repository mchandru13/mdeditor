/**
 * Reclaims space in `src-tauri/target/`.
 *
 * Cargo never evicts old build fingerprints. Because the release profile sets
 * `lto = true`, every release build leaves a single ~340 MB
 * `libmdeditor_lib.rlib`, so a session of repeated builds grows the directory
 * without bound — one session reached 19 GB of debug artifacts.
 *
 * The default removes only this crate's artifacts (`cargo clean -p mdeditor` in
 * both profiles), which is where essentially all the space is. The dependency
 * caches are kept, so the next build stays incremental instead of starting from
 * scratch.
 *
 * Usage:
 *   npm run clean                 # this crate's artifacts, both profiles
 *   npm run clean -- --all        # everything, including the dependency cache
 *   npm run clean -- --dry-run    # report what would be removed
 *
 * The release installers in `target/release/bundle/` are never removed unless
 * `--all` is passed, and even then they are reported first so a release can be
 * re-published from them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_DIR = 'src-tauri';
const TARGET_DIR = join(MANIFEST_DIR, 'target');
const BUNDLE_DIR = join(TARGET_DIR, 'release', 'bundle');

const args = new Set(process.argv.slice(2));
const all = args.has('--all');
const dryRun = args.has('--dry-run');

/** `du` is not available everywhere; walk the tree instead. */
function directorySize(path) {
  if (!existsSync(path)) return 0;
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-ChildItem -LiteralPath '${path.replace(/'/g, "''")}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`,
      ],
      { encoding: 'utf8' },
    ).trim();
    const bytes = Number.parseInt(out, 10);
    return Number.isFinite(bytes) ? bytes : 0;
  } catch {
    return 0;
  }
}

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;

function cargoClean(cargoArgs) {
  console.log(`  cargo ${cargoArgs.join(' ')}`);
  if (dryRun) return;
  execFileSync('cargo', cargoArgs, { cwd: MANIFEST_DIR, stdio: 'inherit' });
}

if (!existsSync(TARGET_DIR)) {
  console.log('Nothing to clean: src-tauri/target does not exist.');
  process.exit(0);
}

const before = directorySize(TARGET_DIR);
console.log(`src-tauri/target is ${mib(before)}.`);

if (existsSync(BUNDLE_DIR)) {
  console.log(`Installers in target/release/bundle: ${mib(directorySize(BUNDLE_DIR))}.`);
  if (all) {
    console.log('  --all also removes these; they can be rebuilt with npm run tauri:build.');
  } else {
    console.log('  Kept. Use --all to remove them too.');
  }
}

// The note about memory is a separate failure mode and worth repeating here,
// because "clean the target directory" looks like a fix for a failed build and
// is not one.
console.log('');
console.log('Cleaning:');

if (all) {
  cargoClean(['clean']);
} else {
  // `-p` keeps the dependency cache, which is the bulk of a cold rebuild.
  cargoClean(['clean', '-p', 'mdeditor']);
  cargoClean(['clean', '-p', 'mdeditor', '--release']);
}

if (dryRun) {
  console.log('\n--dry-run: nothing removed.');
  process.exit(0);
}

const after = directorySize(TARGET_DIR);
console.log('');
console.log(`src-tauri/target is now ${mib(after)} (reclaimed ${mib(before - after)}).`);
console.log('');
console.log(
  'A rustc "memory allocation failed" or STATUS_STACK_BUFFER_OVERRUN is the ' +
    'machine running out of commit charge, not a code error; freeing disk does ' +
    'not help. Check %Memory\\Committed Bytes against %Memory\\Commit Limit first.',
);
