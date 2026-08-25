/**
 * Convert a source image (JPEG/PNG/webp) into the required Expo app assets:
 * icon.png, adaptive-icon.png, splash.png, favicon.png
 *
 * Uses @expo/image-utils (bundled with Expo) to decode and resize - no extra deps.
 */
const fs = require('fs');
const path = require('path');
const { generateImageAsync } = require('@expo/image-utils');

const SOURCE_IMAGE = process.argv[2] || 'C:\\Users\\IT & Brand\\Downloads\\Gemini_Generated_Image_11ryx111ryx111ry.jpg';
const DARK_TEAL = '#08131a';

async function main() {
  if (!fs.existsSync(SOURCE_IMAGE)) {
    console.error('Source image not found: ' + SOURCE_IMAGE);
    process.exit(1);
  }

  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const common = { src: SOURCE_IMAGE };

  // 1. App icon (iOS + Android legacy) - full bleed square
  console.log('Generating icon.png (1024x1024)...');
  const icon = await generateImageAsync(
    { projectRoot: __dirname },
    {
      ...common,
      name: 'icon.png',
      width: 1024,
      height: 1024,
      resizeMode: 'cover',
      backgroundColor: DARK_TEAL,
    }
  );
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), icon.source);
  console.log('Created: assets/icon.png (' + icon.source.length + ' bytes)');

  // 2. Android adaptive icon foreground - full bleed square (launcher masks it)
  console.log('Generating adaptive-icon.png (1024x1024)...');
  const adaptive = await generateImageAsync(
    { projectRoot: __dirname },
    {
      ...common,
      name: 'adaptive-icon.png',
      width: 1024,
      height: 1024,
      resizeMode: 'cover',
      backgroundColor: 'transparent',
    }
  );
  fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptive.source);
  console.log('Created: assets/adaptive-icon.png (' + adaptive.source.length + ' bytes)');

  // 3. Splash - contained on dark teal background
  console.log('Generating splash.png (2048x2048)...');
  const splash = await generateImageAsync(
    { projectRoot: __dirname },
    {
      ...common,
      name: 'splash.png',
      width: 2048,
      height: 2048,
      resizeMode: 'contain',
      backgroundColor: DARK_TEAL,
    }
  );
  fs.writeFileSync(path.join(assetsDir, 'splash.png'), splash.source);
  console.log('Created: assets/splash.png (' + splash.source.length + ' bytes)');

  // 4. Favicon - small square
  console.log('Generating favicon.png (48x48)...');
  const favicon = await generateImageAsync(
    { projectRoot: __dirname },
    {
      ...common,
      name: 'favicon.png',
      width: 48,
      height: 48,
      resizeMode: 'cover',
      backgroundColor: DARK_TEAL,
    }
  );
  fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favicon.source);
  console.log('Created: assets/favicon.png (' + favicon.source.length + ' bytes)');

  console.log('All assets generated successfully from: ' + SOURCE_IMAGE);
}

main().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});