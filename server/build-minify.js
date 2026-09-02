/**
 * DigiCom Lossless Asset Minifier & Optimizer
 * AST-based safe minification for CSS & JS + CleanCSS Level 2 + Brotli & Gzip Pre-Compression
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { minify: minifyJs } = require('terser');
const CleanCSS = require('clean-css');

const PUBLIC_DIR = path.join(__dirname, '../public');
const IMG_DIR = path.join(PUBLIC_DIR, 'img');

function precompressFile(fullPath, contentBuffer) {
  try {
    // 1. Brotli (Quality 11 = Maximum compression)
    const brBuffer = zlib.brotliCompressSync(contentBuffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
    });
    fs.writeFileSync(fullPath + '.br', brBuffer);

    // 2. Gzip (Level 9 = Maximum compression)
    const gzBuffer = zlib.gzipSync(contentBuffer, { level: 9 });
    fs.writeFileSync(fullPath + '.gz', gzBuffer);

    const base = path.basename(fullPath);
    console.log(`    ↳ Pre-compressed ${base} -> Gzip: ${gzBuffer.length} B | Brotli: ${brBuffer.length} B`);
  } catch (err) {
    console.error('[-] Pre-compression error for', fullPath, err.message);
  }
}

async function buildMinifiedAssets() {
  console.log('[+] Starting DigiCom Asset Minification & Optimization process...');

  // 1. Minify CSS (CleanCSS Level 2: Advanced deduplication & shorthand merging)
  const cssFiles = ['css/style.css'];
  for (const relPath of cssFiles) {
    const fullPath = path.join(PUBLIC_DIR, relPath);
    const minPath = fullPath.replace(/\.css$/, '.min.css');
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      const minified = new CleanCSS({
        level: {
          1: { all: true },
          2: {
            mergeAdjacentRules: true,
            mergeIntoShorthands: true,
            mergeMedia: true,
            mergeNonAdjacentRules: true,
            removeEmpty: true,
            removeDuplicateFontRules: true,
            removeDuplicateMediaBlocks: true,
            removeDuplicateRules: true
          }
        }
      }).minify(code);

      if (minified.styles) {
        fs.writeFileSync(minPath, minified.styles, 'utf8');
        console.log(`  [CSS] ${relPath} (${code.length} bytes) -> ${path.basename(minPath)} (${minified.styles.length} bytes)`);
        precompressFile(minPath, Buffer.from(minified.styles, 'utf8'));
      }
    }
  }

  // 2. Minify JS (Safe compression, mangle: false -> 100% exact identifier preservation)
  const jsFiles = [
    'js/app.js',
    'js/webrtc-call.js',
    'js/idb-store.js',
    'js/push-client.js',
    'js/guided-tour.js',
    'js/qrcode.js',
    'js/admin-dashboard.js'
  ];

  for (const relPath of jsFiles) {
    const fullPath = path.join(PUBLIC_DIR, relPath);
    const minPath = fullPath.replace(/\.js$/, '.min.js');
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      try {
        const result = await minifyJs(code, {
          compress: {
            dead_code: true,
            unused: true,
            conditionals: true,
            booleans: true
          },
          mangle: false,
          format: {
            comments: false
          }
        });
        if (result.code) {
          fs.writeFileSync(minPath, result.code, 'utf8');
          console.log(`  [JS]  ${relPath} (${code.length} bytes) -> ${path.basename(minPath)} (${result.code.length} bytes)`);
          precompressFile(minPath, Buffer.from(result.code, 'utf8'));
        }
      } catch (err) {
        console.error(`  [-] Error minifying ${relPath}:`, err.message);
      }
    }
  }

  // 3. Pre-compress index.html
  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(htmlPath)) {
    const rawHtml = fs.readFileSync(htmlPath, 'utf8');
    const minHtml = rawHtml
      .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim();
    precompressFile(htmlPath, Buffer.from(minHtml, 'utf8'));
    console.log(`  [HTML] index.html pre-compressed (${rawHtml.length} bytes -> min ${minHtml.length} bytes)`);
  }

  // 3.1 Pre-compress widget/rebonly-widget.js
  const widgetPath = path.join(__dirname, '../widget/rebonly-widget.js');
  if (fs.existsSync(widgetPath)) {
    const widgetCode = fs.readFileSync(widgetPath, 'utf8');
    precompressFile(widgetPath, Buffer.from(widgetCode, 'utf8'));
    console.log(`  [WIDGET] rebonly-widget.js pre-compressed (${widgetCode.length} bytes)`);
  }

  // 4. WebP Image Optimization
  if (fs.existsSync(IMG_DIR)) {
    try {
      const pyScript = `
import os
from PIL import Image

img_dir = '${IMG_DIR.replace(/'/g, "\\'")}'
for f in os.listdir(img_dir):
    if f.endswith(('.png', '.jpeg', '.jpg')) and not f.endswith('.webp'):
        src = os.path.join(img_dir, f)
        base = os.path.splitext(f)[0]
        dst = os.path.join(img_dir, base + '.webp')
        if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
            img = Image.open(src)
            if 'bubble' in base:
                img = img.resize((400, 400), Image.Resampling.LANCZOS)
                img.save(dst, 'WEBP', quality=75, method=6)
            else:
                img.save(dst, 'WEBP', quality=85, method=6)
            print(f'  [IMG] Converted {f} -> {base}.webp')
`;
      execSync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('  [-] WebP auto-conversion notice:', e.message);
    }
  }

  console.log('[+] Asset minification, optimization & Brotli pre-compression completed successfully.');
}

if (require.main === module) {
  buildMinifiedAssets();
} else {
  module.exports = buildMinifiedAssets;
}
