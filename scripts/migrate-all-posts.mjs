import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const archiveRoot = path.resolve(projectRoot, '../ArchieveBlog');
const postRoot = path.join(archiveRoot, 'post');

const excluded = new Set(['about']);
const slugs = fs
  .readdirSync(postRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((slug) => !excluded.has(slug))
  .sort();

console.log(`Migrating ${slugs.length} archived posts...`);
console.log(slugs.join('\n'));

for (const slug of slugs) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'migrate-one-post.mjs'), slug], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`Failed to migrate slug: ${slug}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll archive posts have been migrated.');
