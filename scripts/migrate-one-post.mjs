import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const archiveRoot = path.resolve(projectRoot, '../ArchieveBlog');
const slug = process.argv[2] || 'hello-github';
const postDir = path.join(archiveRoot, 'post', slug);
const outputAssetDir = path.join(projectRoot, 'src/assets/posts', slug);
const outputContentDir = path.join(projectRoot, 'src/content/blog');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extractFirst(html, regex) {
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

function makeSafeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
}

function resolveArchiveLocalAsset(remoteUrl) {
  try {
    const parsed = new URL(remoteUrl);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const basename = path.basename(pathname) || 'image';
    const candidates = [
      path.join(archiveRoot, 'post-images', basename),
      path.join(archiveRoot, 'images', basename),
      path.join(archiveRoot, 'post-images', decodeURIComponent(pathname.split('/').pop() || basename)),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  } catch {
    return null;
  }
}

function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        resolve(downloadFile(response.headers.location, targetPath));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Request failed with status ${response.statusCode} for ${url}`));
        return;
      }

      const file = fs.createWriteStream(targetPath);
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function copyAssetToLocal(remoteUrl, localRootDir, fallbackName) {
  const archiveSource = resolveArchiveLocalAsset(remoteUrl);
  const parsed = new URL(remoteUrl);
  const ext = path.extname(parsed.pathname) || '.png';
  const safeName = `${makeSafeFileName(fallbackName)}${ext}`;
  const targetPath = path.join(localRootDir, safeName);

  ensureDir(localRootDir);
  if (archiveSource) {
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(archiveSource, targetPath);
    }
    return `../../assets/posts/${slug}/${safeName}`;
  }

  if (!fs.existsSync(targetPath)) {
    await downloadFile(remoteUrl, targetPath);
  }

  return `../../assets/posts/${slug}/${safeName}`;
}

async function main() {
  const htmlPath = path.join(postDir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const title = extractFirst(html, /<title>\s*(.*?)\s*\|\s*Her Blog\s*<\/title>/is) || 'Untitled';
  const dateMatch = extractFirst(html, /<time class="post-time">\s*·\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*·\s*<\/time>/i);
  const pubDate = dateMatch || '1970-01-01';
  const featureMatch = extractFirst(html, /<div class="post-feature-image"[^>]*style="background-image:\s*url\('([^']+)'\)"[^>]*>/i);

  const bodyMatch = html.match(/<div class="post-content">([\s\S]*?)<\/div>\s*<\/article>/i);
  let bodyHtml = bodyMatch ? bodyMatch[1].trim() : '<p>Missing body content.</p>';

  const imageUrls = [...new Set([...bodyHtml.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]))];
  const localImageRefs = [];

  for (const imageUrl of imageUrls) {
    const relativePath = await copyAssetToLocal(imageUrl, outputAssetDir, path.basename(new URL(imageUrl).pathname) || 'image');
    localImageRefs.push({ from: imageUrl, to: relativePath });
    bodyHtml = bodyHtml.replaceAll(imageUrl, relativePath);
  }

  let coverLocalPath = null;
  if (featureMatch) {
    coverLocalPath = await copyAssetToLocal(featureMatch, outputAssetDir, 'feature');
  }

  const safeTitle = title.replace(/\s+/g, ' ').trim();
  const frontmatterLines = [
    '---',
    `title: "${safeTitle}"`,
    'description: "Migrated from Gridea archive"',
    `pubDate: ${pubDate}`,
  ];

  if (coverLocalPath) {
    frontmatterLines.push(`heroImage: "${coverLocalPath}"`);
  }

  frontmatterLines.push('---');
  const markdown = `${frontmatterLines.join('\n')}\n\n${bodyHtml}\n`;

  ensureDir(outputContentDir);
  const outputContentPath = path.join(outputContentDir, `${slug}.md`);
  fs.writeFileSync(outputContentPath, markdown, 'utf8');

  console.log(JSON.stringify({
    slug,
    title: safeTitle,
    sourcePost: postDir,
    outputMarkdown: outputContentPath,
    outputAssetDir,
    featureImage: coverLocalPath,
    embeddedImages: localImageRefs.length,
    allImageRefs: localImageRefs.map((item) => ({ from: item.from, to: item.to })),
  }, null, 2));
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
