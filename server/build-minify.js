/**
 * DigiCom Lossless Asset Minifier
 * AST-based safe minification for CSS & JS (Zero variable renaming, 100% loss-free)
 */

const fs = require('fs');
const path = require('path');
const { minify: minifyJs } = require('terser');
const CleanCSS = require('clean-css');

const PUBLIC_DIR = path.join(__dirname, '../public');

async function buildMinifiedAssets() {
  console.log('[+] Starting lossless minification process...');

  // 1. Minify CSS
  const cssFiles = ['css/style.css'];
  for (const relPath of cssFiles) {
    const fullPath = path.join(PUBLIC_DIR, relPath);
    const minPath = fullPath.replace(/\.css$/, '.min.css');
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      const minified = new CleanCSS({ level: 1 }).minify(code);
      if (minified.styles) {
        fs.writeFileSync(minPath, minified.styles, 'utf8');
        console.log(`  [CSS] ${relPath} (${code.length} bytes) -> ${path.basename(minPath)} (${minified.styles.length} bytes)`);
      }
    }
  }

  // 2. Minify JS (mangle: false -> 100% exact identifier preservation)
  const jsFiles = [
    'js/app.js',
    'js/webrtc-call.js',
    'js/idb-store.js',
    'js/push-client.js',
    'js/guided-tour.js',
    'js/qrcode.js'
  ];

  for (const relPath of jsFiles) {
    const fullPath = path.join(PUBLIC_DIR, relPath);
    const minPath = fullPath.replace(/\.js$/, '.min.js');
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      try {
        const result = await minifyJs(code, {
          compress: false,
          mangle: false,
          format: {
            comments: false
          }
        });
        if (result.code) {
          fs.writeFileSync(minPath, result.code, 'utf8');
          console.log(`  [JS]  ${relPath} (${code.length} bytes) -> ${path.basename(minPath)} (${result.code.length} bytes)`);
        }
      } catch (err) {
        console.error(`  [-] Error minifying ${relPath}:`, err.message);
      }
    }
  }

  console.log('[+] Lossless minification completed successfully.');
}

if (require.main === module) {
  buildMinifiedAssets();
} else {
  module.exports = buildMinifiedAssets;
}
