#!/usr/bin/env node
import sharp from "sharp";
import { execSync } from "child_process";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const buildDir = join(rootDir, "build");

async function main() {
  // Ensure build directory exists
  const pngPath = join(buildDir, "icon.png");

  // Convert SVG to 1024x1024 PNG (required by electron-icon-builder)
  console.log("Converting SVG to PNG...");
  const svgPath = join(buildDir, "icon.svg");
  const svgBuffer = readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(pngPath);

  console.log(`Created ${pngPath}`);

  // Now run electron-icon-builder with the PNG
  console.log("Generating icons...");
  execSync(`npx electron-icon-builder --input=build/icon.png --output=build`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  console.log("Icons generated successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
