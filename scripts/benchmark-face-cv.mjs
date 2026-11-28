#!/usr/bin/env node
/**
 * BMDC Outside-Judge Benchmark — Module A (Local Computer Vision Face Verification)
 *
 * Executes REAL neural network inference (TinyFaceDetector + FaceLandmark68TinyNet +
 * FaceRecognitionNet 128-D ResNet) using the EXACT quantized weights bundled in
 * `Frontend/public/models/` and decoded via `sharp` -> TensorFlow.js tensors (100% offline).
 *
 * Evaluation suite:
 *   - Default mode: Uses the 6 real human face photographs bundled with @vladmandic/face-api
 *     (`sample1.jpg`..`sample6.jpg`), generating realistic same-person attendance variations
 *     (brightness shift, dim lighting, slight rotation, slight crop/zoom) for Genuine pairs,
 *     cross-person pairings for Impostor pairs, plus Wall/Blank/Text-only No-Face frames.
 *   - Custom dataset mode (`--dataset <dir>`): Drop consenting team photos named `<personId>_<n>.jpg`
 *     to benchmark your own real-camera defense dataset.
 *
 * Usage:
 *   npm --prefix Backend run benchmark:face-cv
 *   node Backend/scripts/benchmark-face-cv.mjs --dataset ./my-team-photos
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'Frontend', 'public', 'models');
const DEMO_DIR = path.join(REPO_ROOT, 'Frontend', 'node_modules', '@vladmandic', 'face-api', 'demo');
const FACE_API_ESM = path.join(
  REPO_ROOT,
  'Frontend',
  'node_modules',
  '@vladmandic',
  'face-api',
  'dist',
  'face-api.esm.js'
);

// Provide minimal browser platform globals so face-api.esm.js uses PlatformBrowser
// (global TextEncoder + our local disk-backed fetch) without needing native tfjs-node C++ binaries.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { createElement: () => ({}) };
}

// Local disk-backed fetch shim so face-api loads weights strictly from Frontend/public/models/
const LOCAL_MODEL_ORIGIN = 'http://local-models.invalid';
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const urlStr = typeof url === 'string' ? url : String(url?.url ?? url);
  if (urlStr.startsWith(LOCAL_MODEL_ORIGIN)) {
    const rel = urlStr.slice(LOCAL_MODEL_ORIGIN.length).replace(/^\/+/, '');
    const abs = path.join(MODELS_DIR, rel);
    const buf = await fs.promises.readFile(abs);
    return new Response(buf, { status: 200 });
  }
  return origFetch(url, opts);
};

function euclideanToSimilarity(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return Math.max(0, Math.min(1, Math.round((1 - distance / 1.2) * 10000) / 10000));
}

function descriptorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function bufferToRgbTensor(tf, buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return tf.tensor3d(new Int32Array(data), [info.height, info.width, 3], 'int32');
}

async function extractPrimaryDescriptor(faceapi, options, buffer) {
  const t0 = performance.now();
  const tensor = await bufferToRgbTensor(faceapi.tf, buffer);
  try {
    const detections = await faceapi
      .detectAllFaces(tensor, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    const ms = Math.round(performance.now() - t0);
    if (!detections || detections.length === 0) {
      return { faceCount: 0, descriptor: null, ms };
    }
    const primary = detections.reduce((best, curr) =>
      curr.detection.box.area > best.detection.box.area ? curr : best
    );
    return {
      faceCount: detections.length,
      descriptor: new Float32Array(primary.descriptor),
      ms,
    };
  } finally {
    faceapi.tf.dispose(tensor);
  }
}

async function buildNoFaceSpoofFrames() {
  const wall = await sharp({
    create: { width: 480, height: 360, channels: 3, background: { r: 215, g: 210, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  const darkCeiling = await sharp({
    create: { width: 480, height: 360, channels: 3, background: { r: 22, g: 24, b: 28 } },
  })
    .jpeg()
    .toBuffer();

  const textCard = await sharp(
    Buffer.from(
      `<svg width="480" height="360" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8fafc"/>
        <text x="40" y="180" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#0f172a">NO FACE HERE</text>
      </svg>`
    )
  )
    .jpeg()
    .toBuffer();

  return [
    { name: 'blank_wall.jpg', buffer: wall },
    { name: 'dark_ceiling.jpg', buffer: darkCeiling },
    { name: 'text_card_no_face.jpg', buffer: textCard },
  ];
}

async function loadFixtures(customDatasetDir) {
  if (customDatasetDir) {
    const absDir = path.resolve(process.cwd(), customDatasetDir);
    const files = fs
      .readdirSync(absDir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();
    const byPerson = new Map();
    for (const file of files) {
      const personId = file.split('_')[0];
      if (!byPerson.has(personId)) byPerson.set(personId, []);
      byPerson.get(personId).push({
        label: file,
        buffer: fs.readFileSync(path.join(absDir, file)),
      });
    }
    return { mode: `custom (${absDir})`, byPerson };
  }

  // Default: use real human face photos bundled in @vladmandic/face-api/demo/
  const sampleFiles = ['sample1.jpg', 'sample2.jpg', 'sample3.jpg', 'sample4.jpg', 'sample5.jpg', 'sample6.jpg']
    .map((name) => path.join(DEMO_DIR, name))
    .filter((p) => fs.existsSync(p));

  const byPerson = new Map();
  for (let i = 0; i < sampleFiles.length; i++) {
    const baseBuf = fs.readFileSync(sampleFiles[i]);
    const personId = `person_${i + 1}`;

    // Realistic attendance selfie variations (dim indoor light, bright daylight, slight tilt, slight JPEG compression)
    const dimBuf = await sharp(baseBuf).modulate({ brightness: 0.72, saturation: 0.9 }).jpeg({ quality: 78 }).toBuffer();
    const brightBuf = await sharp(baseBuf).modulate({ brightness: 1.22 }).jpeg({ quality: 82 }).toBuffer();
    const tiltedBuf = await sharp(baseBuf).rotate(4, { background: { r: 180, g: 180, b: 180 } }).jpeg({ quality: 80 }).toBuffer();

    byPerson.set(personId, [
      { label: `${personId}_ref`, buffer: baseBuf },
      { label: `${personId}_dim`, buffer: dimBuf },
      { label: `${personId}_bright`, buffer: brightBuf },
      { label: `${personId}_tilted`, buffer: tiltedBuf },
    ]);
  }

  return { mode: 'bundled-real-faces + lighting/tilt attendance variations', byPerson };
}

async function main() {
  const datasetArgIdx = process.argv.indexOf('--dataset');
  const customDatasetDir = datasetArgIdx !== -1 ? process.argv[datasetArgIdx + 1] : null;

  console.log('=== BMDC Outside-Judge Benchmark: Module A (Local Computer Vision Face Verification) ===\n');
  const faceapi = await import(pathToFileURL(FACE_API_ESM).href);
  await faceapi.tf.setBackend('cpu');
  await faceapi.tf.ready();

  const loadT0 = performance.now();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL_MODEL_ORIGIN),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(LOCAL_MODEL_ORIGIN),
    faceapi.nets.faceRecognitionNet.loadFromUri(LOCAL_MODEL_ORIGIN),
  ]);
  const loadMs = Math.round(performance.now() - loadT0);
  console.log(`Loaded local weights from Frontend/public/models/ in ${loadMs}ms (backend=${faceapi.tf.getBackend()})`);

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.45,
  });

  const { mode, byPerson } = await loadFixtures(customDatasetDir);
  console.log(`Fixture mode: ${mode}\n`);

  // Extract 128-D embeddings for every fixture face
  const embeddings = new Map();
  const latencies = [];
  let totalImages = 0;
  let detectedImages = 0;

  for (const [personId, samples] of byPerson.entries()) {
    const personEntries = [];
    for (const s of samples) {
      totalImages++;
      const res = await extractPrimaryDescriptor(faceapi, options, s.buffer);
      latencies.push(res.ms);
      if (res.descriptor) {
        detectedImages++;
        personEntries.push({ label: s.label, descriptor: res.descriptor });
      }
    }
    if (personEntries.length > 0) {
      embeddings.set(personId, personEntries);
    }
  }

  // Build Genuine (same-person) and Impostor (cross-person) comparison pairs
  const genuineScores = [];
  const impostorScores = [];
  const personIds = Array.from(embeddings.keys());

  for (const pid of personIds) {
    const list = embeddings.get(pid);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = descriptorDistance(list[i].descriptor, list[j].descriptor);
        genuineScores.push(euclideanToSimilarity(d));
      }
    }
  }

  for (let a = 0; a < personIds.length; a++) {
    for (let b = a + 1; b < personIds.length; b++) {
      const refA = embeddings.get(personIds[a])[0];
      const refB = embeddings.get(personIds[b])[0];
      const d = descriptorDistance(refA.descriptor, refB.descriptor);
      impostorScores.push(euclideanToSimilarity(d));
    }
  }

  // Evaluate No-Face / Wall spoof frames
  const spoofFrames = await buildNoFaceSpoofFrames();
  let noFaceCorrect = 0;
  for (const sf of spoofFrames) {
    const res = await extractPrimaryDescriptor(faceapi, options, sf.buffer);
    latencies.push(res.ms);
    if (res.faceCount === 0) noFaceCorrect++;
    console.log(`[NO-FACE] ${sf.name.padEnd(24)} | faces=${res.faceCount} | ${res.ms}ms`);
  }

  console.log(`\nFaces detected in portrait fixtures: ${detectedImages}/${totalImages}`);
  console.log(`Genuine pairs evaluated:  ${genuineScores.length} (mean similarity=${genuineScores.length ? (genuineScores.reduce((a, b) => a + b, 0) / genuineScores.length).toFixed(3) : 'N/A'})`);
  console.log(`Impostor pairs evaluated: ${impostorScores.length} (mean similarity=${impostorScores.length ? (impostorScores.reduce((a, b) => a + b, 0) / impostorScores.length).toFixed(3) : 'N/A'})\n`);

  console.log('Threshold |   TP |   FN |   TN |   FP |    TAR |    FRR |    FAR | Accuracy');
  console.log('----------|------|------|------|------|--------|--------|--------|---------');

  let defaultRow = null;
  for (const th of [0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
    const tp = genuineScores.filter((s) => s >= th).length;
    const fn = genuineScores.length - tp;
    const fp = impostorScores.filter((s) => s >= th).length;
    const tn = impostorScores.length - fp;
    const tar = genuineScores.length > 0 ? tp / genuineScores.length : 0;
    const frr = genuineScores.length > 0 ? fn / genuineScores.length : 0;
    const far = impostorScores.length > 0 ? fp / impostorScores.length : 0;
    const acc = genuineScores.length + impostorScores.length > 0 ? (tp + tn) / (genuineScores.length + impostorScores.length) : 0;

    if (th === 0.5) defaultRow = { tp, fn, tn, fp, tar, frr, far, acc };

    console.log(
      `   ${th.toFixed(2)}   | ${String(tp).padStart(4)} | ${String(fn).padStart(4)} | ${String(tn).padStart(4)} | ${String(fp).padStart(4)} | ${(tar * 100).toFixed(1).padStart(5)}% | ${(frr * 100).toFixed(1).padStart(5)}% | ${(far * 100).toFixed(1).padStart(5)}% |  ${(acc * 100).toFixed(1).padStart(5)}%`
    );
  }

  const medianMs = percentile(latencies, 50);
  const p95Ms = percentile(latencies, 95);
  const noFaceRate = spoofFrames.length > 0 ? noFaceCorrect / spoofFrames.length : 0;

  console.log('\n--- Summary Metrics at Calibrated Default Threshold (0.50 / d <= 0.60) ---');
  if (defaultRow) {
    console.log(`Genuine TAR:          ${(defaultRow.tar * 100).toFixed(1)}%   (Target >= 85.0%: ${defaultRow.tar >= 0.85 ? 'PASS' : 'MISS'})`);
    console.log(`Impostor FAR:         ${(defaultRow.far * 100).toFixed(1)}%   (Target <=  5.0%: ${defaultRow.far <= 0.05 ? 'PASS' : 'MISS'})`);
    console.log(`No-Face Rejection:    ${(noFaceRate * 100).toFixed(1)}%   (${noFaceCorrect}/${spoofFrames.length}, Target = 100.0%: ${noFaceRate === 1 ? 'PASS' : 'MISS'})`);
  }
  console.log(`CPU-Backend Latency:  median=${medianMs}ms / p95=${p95Ms}ms (Browser WebGL is ~4-8x faster)`);

  // Zero-fill all ephemeral vectors before exiting (RA 10173 hygiene)
  for (const list of embeddings.values()) {
    for (const item of list) item.descriptor.fill(0);
  }
}

main().catch((err) => {
  console.error('Face CV benchmark failed:', err);
  process.exit(1);
});
