import { writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const nextPkg = require.resolve("next/package.json");
    return require(require.resolve("sharp", { paths: [dirname(nextPkg)] }));
  }
}

const sharp = loadSharp();
const svgPath = join(root, "public", "favicon.svg");
const svg = readFileSync(svgPath);

const png16 = await sharp(svg).resize(16, 16).png().toBuffer();
const png32 = await sharp(svg).resize(32, 32).png().toBuffer();
const png48 = await sharp(svg).resize(48, 48).png().toBuffer();

async function icoFromPngs(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  for (const png of pngs) {
    const meta = Buffer.alloc(16);
    const size = await sharp(png).metadata();
    meta[0] = size.width >= 256 ? 0 : size.width;
    meta[1] = size.height >= 256 ? 0 : size.height;
    meta[2] = 0;
    meta[3] = 0;
    meta.writeUInt16LE(1, 4);
    meta.writeUInt16LE(32, 6);
    meta.writeUInt32LE(png.length, 8);
    meta.writeUInt32LE(offset, 12);
    entries.push(meta);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

const ico = await icoFromPngs([png16, png32, png48]);
writeFileSync(join(root, "public", "favicon.ico"), ico);
writeFileSync(join(root, "src", "app", "favicon.ico"), ico);
console.log("favicon.ico written:", ico.length, "bytes");
