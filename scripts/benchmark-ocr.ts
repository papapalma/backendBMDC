#!/usr/bin/env ts-node
/**
 * BMDC Outside-Judge Benchmark — Module B (Offline Requirement OCR & Quality Screening)
 *
 * Runs REAL local `sharp` + `tesseract.js` WASM inference (zero mocked OCR, zero network calls)
 * across a 24-case labeled benchmark covering all 7 BMDC requirement types:
 *   - Clean & slightly degraded valid documents (Valid ID, PSA Birth/Marriage Cert, TOR, Barangay Cert, Profile Form, 1x1 ID Photo)
 *   - Blurred scans (Laplacian variance blur check)
 *   - Blank / solid-colored uploads
 *   - Wrong-document-type & wrong-trainee-name mismatches
 *   - Non-white-background & subject-less 1x1 ID photos
 *   - PDF uploads (safe skip)
 *
 * Usage:
 *   npm --prefix Backend run benchmark:ocr
 */

import path from 'path';
import Module from 'module';
import sharp from 'sharp';

// Lightweight `@/` path alias resolver so ts-node runs without tsconfig-paths
const origResolve = (Module as any)._resolveFilename;
const srcRoot = path.resolve(__dirname, '..', 'src');
(Module as any)._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    return origResolve.call(this, path.join(srcRoot, request.slice(2)), parent, isMain, options);
  }
  return origResolve.call(this, request, parent, isMain, options);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  analyzeRequirementDocument,
  resolveOcrConfig,
  terminateOcrWorker,
} = require('../src/services/documentOcrService');

interface BenchmarkCase {
  id: string;
  label: string;
  requirementType: string;
  fileName: string;
  mimeType: string;
  traineeFirstName: string;
  traineeLastName: string;
  expectedIssue: boolean; // true = should be flagged or needs_review; false = likely_valid (or skipped_pdf handled separately)
  isBlurCase?: boolean;
  expectedBlurry?: boolean;
  isPdfCase?: boolean;
  expectedNameMatch?: boolean;
  buildBuffer: () => Promise<Buffer>;
}

async function renderDocument(
  lines: string[],
  opts?: { blur?: number; bg?: string; rotate?: number; fontSize?: number }
): Promise<Buffer> {
  const bg = opts?.bg ?? '#ffffff';
  const fontSize = opts?.fontSize ?? 32;
  const svgLines = lines
    .map(
      (line, idx) =>
        `<text x="64" y="${105 + idx * 54}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#111111">${line}</text>`
    )
    .join('');

  const svg = Buffer.from(
    `<svg width="1120" height="680" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${bg}"/>
      <rect x="24" y="24" width="1072" height="632" fill="none" stroke="#222222" stroke-width="4"/>
      ${svgLines}
    </svg>`
  );

  let p = sharp(svg);
  if (opts?.rotate) p = p.rotate(opts.rotate, { background: bg });
  if (opts?.blur) p = p.blur(opts.blur);
  return p.png().toBuffer();
}

async function renderIdPhoto(bg: string, withSubject: boolean, blur?: number): Promise<Buffer> {
  const subject = withSubject
    ? `<circle cx="150" cy="115" r="46" fill="#7c503a"/>
       <ellipse cx="150" cy="240" rx="82" ry="68" fill="#1e3a8a"/>`
    : '';
  const svg = Buffer.from(
    `<svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${bg}"/>
      ${subject}
    </svg>`
  );
  let p = sharp(svg);
  if (blur) p = p.blur(blur);
  return p.png().toBuffer();
}

async function renderBlank(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 500, height: 500, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

const CASES: BenchmarkCase[] = [
  // --- 8 Valid Cases (expectedIssue = false) ---
  {
    id: 'V1',
    label: 'Clean PSA Birth Certificate',
    requirementType: 'birth_certificate_copy',
    fileName: 'psa_birth_juan.png',
    mimeType: 'image/png',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'REPUBLIC OF THE PHILIPPINES',
        'PHILIPPINE STATISTICS AUTHORITY',
        'CERTIFICATE OF LIVE BIRTH',
        'CHILD NAME: JUAN DELA CRUZ',
        'MUNICIPALITY OF BONGABONG ORIENTAL MINDORO',
      ]),
  },
  {
    id: 'V2',
    label: 'Clean Philippine Valid ID (PhilSys / LTO)',
    requirementType: 'valid_id_copy',
    fileName: 'valid_id_maria.png',
    mimeType: 'image/png',
    traineeFirstName: 'Maria',
    traineeLastName: 'Santos',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'REPUBLIC OF THE PHILIPPINES',
        'PHILIPPINE IDENTIFICATION CARD PHILSYS',
        'LAST NAME: SANTOS',
        'GIVEN NAME: MARIA',
        'ID NO 1234 5678 9012',
      ]),
  },
  {
    id: 'V3',
    label: 'Clean PSA Marriage Certificate',
    requirementType: 'marriage_certificate_copy',
    fileName: 'psa_marriage_ana.png',
    mimeType: 'image/png',
    traineeFirstName: 'Ana',
    traineeLastName: 'Reyes',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'REPUBLIC OF THE PHILIPPINES',
        'PHILIPPINE STATISTICS AUTHORITY',
        'CERTIFICATE OF MARRIAGE',
        'WIFE: ANA REYES',
        'HUSBAND: PEDRO REYES',
      ]),
  },
  {
    id: 'V4',
    label: 'Clean Report Card / TOR',
    requirementType: 'report_card_tor_copy',
    fileName: 'tor_carlo.png',
    mimeType: 'image/png',
    traineeFirstName: 'Carlo',
    traineeLastName: 'Mendoza',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'DEPARTMENT OF EDUCATION DEPED',
        'OFFICIAL TRANSCRIPT OF RECORDS FORM 137',
        'STUDENT NAME: CARLO MENDOZA',
        'GENERAL AVERAGE GRADE: 89',
      ]),
  },
  {
    id: 'V5',
    label: 'Clean Barangay Certification',
    requirementType: 'barangay_no_grade_certification',
    fileName: 'brgy_cert_elena.png',
    mimeType: 'image/png',
    traineeFirstName: 'Elena',
    traineeLastName: 'Bautista',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'OFFICE OF THE PUNONG BARANGAY',
        'BARANGAY POBLACION BONGABONG ORIENTAL MINDORO',
        'CERTIFICATION',
        'TO WHOM IT MAY CONCERN THIS IS TO CERTIFY THAT',
        'ELENA BAUTISTA IS A RESIDENT IN GOOD STANDING',
      ]),
  },
  {
    id: 'V6',
    label: 'Clean Learners Profile Form',
    requirementType: 'accomplished_learners_profile_form',
    fileName: 'learners_profile_paolo.png',
    mimeType: 'image/png',
    traineeFirstName: 'Paolo',
    traineeLastName: 'Palma',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument([
        'TESDA BMDC MANPOWER DEVELOPMENT CENTER',
        'LEARNERS PROFILE REGISTRATION FORM',
        'TRAINEE NAME: PAOLO PALMA',
        'QUALIFICATION ENROLLMENT',
      ]),
  },
  {
    id: 'V7',
    label: 'Slightly Tilted Smartphone Valid ID Scan',
    requirementType: 'valid_id_copy',
    fileName: 'tilted_id_ramon.png',
    mimeType: 'image/png',
    traineeFirstName: 'Ramon',
    traineeLastName: 'Villanueva',
    expectedIssue: false,
    expectedBlurry: false,
    expectedNameMatch: true,
    buildBuffer: () =>
      renderDocument(
        [
          'REPUBLIC OF THE PHILIPPINES',
          'LAND TRANSPORTATION OFFICE LTO',
          'DRIVER LICENSE IDENTIFICATION CARD',
          'NAME: RAMON VILLANUEVA',
        ],
        { bg: '#f4f4f0', rotate: 2 }
      ),
  },
  {
    id: 'V8',
    label: 'Valid 1x1 White-Background ID Picture',
    requirementType: 'id_pictures',
    fileName: 'id_pic_valid.png',
    mimeType: 'image/png',
    traineeFirstName: 'Liza',
    traineeLastName: 'Garcia',
    expectedIssue: false,
    expectedBlurry: false,
    buildBuffer: () => renderIdPhoto('#ffffff', true),
  },

  // --- 4 Blurry Scans (expectedIssue = true, expectedBlurry = true) ---
  {
    id: 'B1',
    label: 'Severely Blurred PSA Birth Cert',
    requirementType: 'birth_certificate_copy',
    fileName: 'blur_psa.png',
    mimeType: 'image/png',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: true,
    isBlurCase: true,
    expectedBlurry: true,
    buildBuffer: () =>
      renderDocument(
        ['REPUBLIC OF THE PHILIPPINES', 'CERTIFICATE OF LIVE BIRTH', 'JUAN DELA CRUZ'],
        { blur: 11 }
      ),
  },
  {
    id: 'B2',
    label: 'Severely Blurred Valid ID',
    requirementType: 'valid_id_copy',
    fileName: 'blur_id.png',
    mimeType: 'image/png',
    traineeFirstName: 'Maria',
    traineeLastName: 'Santos',
    expectedIssue: true,
    isBlurCase: true,
    expectedBlurry: true,
    buildBuffer: () =>
      renderDocument(
        ['REPUBLIC OF THE PHILIPPINES', 'DRIVER LICENSE', 'MARIA SANTOS'],
        { blur: 10 }
      ),
  },
  {
    id: 'B3',
    label: 'Severely Blurred Barangay Cert',
    requirementType: 'barangay_no_grade_certification',
    fileName: 'blur_brgy.png',
    mimeType: 'image/png',
    traineeFirstName: 'Elena',
    traineeLastName: 'Bautista',
    expectedIssue: true,
    isBlurCase: true,
    expectedBlurry: true,
    buildBuffer: () =>
      renderDocument(
        ['OFFICE OF THE PUNONG BARANGAY', 'CERTIFICATION', 'ELENA BAUTISTA'],
        { blur: 12 }
      ),
  },
  {
    id: 'B4',
    label: 'Blurred 1x1 ID Photo',
    requirementType: 'id_pictures',
    fileName: 'blur_id_pic.png',
    mimeType: 'image/png',
    traineeFirstName: 'Liza',
    traineeLastName: 'Garcia',
    expectedIssue: true,
    isBlurCase: true,
    expectedBlurry: true,
    buildBuffer: () => renderIdPhoto('#ffffff', true, 12),
  },

  // --- 4 Wrong Document / Blank Uploads (expectedIssue = true) ---
  {
    id: 'W1',
    label: 'Blank White Page Uploaded as Valid ID',
    requirementType: 'valid_id_copy',
    fileName: 'blank_white.png',
    mimeType: 'image/png',
    traineeFirstName: 'Maria',
    traineeLastName: 'Santos',
    expectedIssue: true,
    buildBuffer: () => renderBlank(255, 255, 255),
  },
  {
    id: 'W2',
    label: 'Dark Covered Lens Uploaded as Birth Cert',
    requirementType: 'birth_certificate_copy',
    fileName: 'blank_black.png',
    mimeType: 'image/png',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: true,
    buildBuffer: () => renderBlank(8, 8, 8),
  },
  {
    id: 'W3',
    label: 'Grocery Receipt Uploaded as PSA Birth Cert',
    requirementType: 'birth_certificate_copy',
    fileName: 'wrong_receipt.png',
    mimeType: 'image/png',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'SUPERMARKET CASH RECEIPT',
        'APPLES BANANAS BREAD MILK',
        'SUBTOTAL 450 PESOS CASH TENDERED 500',
        'THANK YOU FOR SHOPPING WITH US',
      ]),
  },
  {
    id: 'W4',
    label: 'Promo Flyer Uploaded as Barangay Cert',
    requirementType: 'barangay_no_grade_certification',
    fileName: 'wrong_flyer.png',
    mimeType: 'image/png',
    traineeFirstName: 'Elena',
    traineeLastName: 'Bautista',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'SUMMER MEGA SALE FIFTY PERCENT OFF',
        'BUY ONE TAKE ONE SNEAKERS AND SHIRTS',
        'VISIT OUR DOWNTOWN STORE THIS WEEKEND',
      ]),
  },

  // --- 4 Wrong Trainee Name Mismatches (expectedIssue = true) ---
  {
    id: 'N1',
    label: 'PSA Birth Cert Belonging to Different Person',
    requirementType: 'birth_certificate_copy',
    fileName: 'wrong_owner_psa.png',
    mimeType: 'image/png',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'REPUBLIC OF THE PHILIPPINES',
        'PHILIPPINE STATISTICS AUTHORITY',
        'CERTIFICATE OF LIVE BIRTH',
        'CHILD NAME: ROBERTO FRANCISCO AQUINO',
      ]),
  },
  {
    id: 'N2',
    label: 'Valid ID Belonging to Different Person',
    requirementType: 'valid_id_copy',
    fileName: 'wrong_owner_id.png',
    mimeType: 'image/png',
    traineeFirstName: 'Maria',
    traineeLastName: 'Santos',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'REPUBLIC OF THE PHILIPPINES',
        'DRIVER LICENSE IDENTIFICATION CARD',
        'NAME: FERDINAND MAGALLANES TORRES',
      ]),
  },
  {
    id: 'N3',
    label: 'TOR Belonging to Different Person',
    requirementType: 'report_card_tor_copy',
    fileName: 'wrong_owner_tor.png',
    mimeType: 'image/png',
    traineeFirstName: 'Carlo',
    traineeLastName: 'Mendoza',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'DEPARTMENT OF EDUCATION DEPED',
        'OFFICIAL TRANSCRIPT OF RECORDS',
        'STUDENT NAME: KATRINA VELASQUEZ',
        'GENERAL AVERAGE GRADE: 92',
      ]),
  },
  {
    id: 'N4',
    label: 'Barangay Cert Belonging to Different Person',
    requirementType: 'barangay_no_grade_certification',
    fileName: 'wrong_owner_brgy.png',
    mimeType: 'image/png',
    traineeFirstName: 'Elena',
    traineeLastName: 'Bautista',
    expectedIssue: true,
    expectedBlurry: false,
    expectedNameMatch: false,
    buildBuffer: () =>
      renderDocument([
        'OFFICE OF THE PUNONG BARANGAY',
        'CERTIFICATION TO WHOM IT MAY CONCERN',
        'THIS IS TO CERTIFY THAT DANILO NAVARRO IS A RESIDENT',
      ]),
  },

  // --- 2 Invalid 1x1 ID Photos (expectedIssue = true) ---
  {
    id: 'I1',
    label: 'Blue Background ID Photo (Not White)',
    requirementType: 'id_pictures',
    fileName: 'blue_bg_id.png',
    mimeType: 'image/png',
    traineeFirstName: 'Liza',
    traineeLastName: 'Garcia',
    expectedIssue: true,
    buildBuffer: () => renderIdPhoto('#1d4ed8', true),
  },
  {
    id: 'I2',
    label: 'Blank White Paper Uploaded as ID Photo',
    requirementType: 'id_pictures',
    fileName: 'empty_id_pic.png',
    mimeType: 'image/png',
    traineeFirstName: 'Liza',
    traineeLastName: 'Garcia',
    expectedIssue: true,
    buildBuffer: () => renderIdPhoto('#ffffff', false),
  },

  // --- 2 PDF Uploads (Safe Skip) ---
  {
    id: 'P1',
    label: 'PDF Birth Certificate Safe Skip',
    requirementType: 'birth_certificate_copy',
    fileName: 'psa_birth.pdf',
    mimeType: 'application/pdf',
    traineeFirstName: 'Juan',
    traineeLastName: 'Dela Cruz',
    expectedIssue: false,
    isPdfCase: true,
    buildBuffer: async () => Buffer.from('%PDF-1.4\n%BMDC sample PDF'),
  },
  {
    id: 'P2',
    label: 'PDF Valid ID Safe Skip',
    requirementType: 'valid_id_copy',
    fileName: 'valid_id.pdf',
    mimeType: 'application/pdf',
    traineeFirstName: 'Maria',
    traineeLastName: 'Santos',
    expectedIssue: false,
    isPdfCase: true,
    buildBuffer: async () => Buffer.from('%PDF-1.4\n%BMDC sample PDF 2'),
  },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log('=== BMDC Outside-Judge Benchmark: Module B (Offline Document OCR) ===\n');
  const config = resolveOcrConfig({ timeout_ms: 15000 });

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  let blurTotal = 0;
  let blurCorrect = 0;
  let pdfTotal = 0;
  let pdfSafe = 0;
  let nameTotal = 0;
  let nameCorrect = 0;

  const latencies: number[] = [];

  for (const c of CASES) {
    const buffer = await c.buildBuffer();
    const res = await analyzeRequirementDocument({
      buffer,
      fileName: c.fileName,
      mimeType: c.mimeType,
      requirementType: c.requirementType,
      traineeFirstName: c.traineeFirstName,
      traineeLastName: c.traineeLastName,
      config,
    });

    if (!c.isPdfCase) {
      latencies.push(res.processing_ms);
    }

    if (c.isPdfCase) {
      pdfTotal++;
      if (res.status === 'skipped_pdf') pdfSafe++;
    } else {
      const predictedIssue = res.status === 'flagged' || res.status === 'needs_review';
      if (c.expectedIssue && predictedIssue) tp++;
      else if (!c.expectedIssue && predictedIssue) fp++;
      else if (!c.expectedIssue && !predictedIssue) tn++;
      else fn++;
    }

    if (typeof c.expectedBlurry === 'boolean') {
      blurTotal++;
      if (res.is_blurry === c.expectedBlurry) blurCorrect++;
    }

    if (typeof c.expectedNameMatch === 'boolean' && res.trainee_name_match_score !== null) {
      nameTotal++;
      const matched = res.trainee_name_match_score >= config.min_name_match;
      if (matched === c.expectedNameMatch) nameCorrect++;
    }

    console.log(
      `[${c.id.padEnd(2)}] ${c.label.padEnd(44)} | status=${res.status.padEnd(12)} | blur=${String(res.blur_score ?? '-').padStart(7)} | doc=${res.doc_type_match_score.toFixed(2)} | name=${res.trainee_name_match_score !== null ? res.trainee_name_match_score.toFixed(2) : '  - '} | ${res.processing_ms}ms`
    );
  }

  await terminateOcrWorker();

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const blurAcc = blurTotal > 0 ? blurCorrect / blurTotal : 0;
  const pdfAcc = pdfTotal > 0 ? pdfSafe / pdfTotal : 0;
  const nameAcc = nameTotal > 0 ? nameCorrect / nameTotal : 0;
  const medianMs = percentile(latencies, 50);
  const p95Ms = percentile(latencies, 95);

  console.log('\n--- Summary Metrics (Outside Judge) ---');
  console.log(`Confusion Matrix (Issue Detection, N=${tp + fp + tn + fn}): TP=${tp}, FP=${fp}, TN=${tn}, FN=${fn}`);
  console.log(`Precision:            ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall:               ${(recall * 100).toFixed(1)}%`);
  console.log(`F1-Score:             ${(f1 * 100).toFixed(1)}%   (Target >= 80.0%: ${f1 >= 0.8 ? 'PASS' : 'MISS'})`);
  console.log(`Blur Detection Acc:   ${(blurAcc * 100).toFixed(1)}%   (${blurCorrect}/${blurTotal}, Target >= 90.0%: ${blurAcc >= 0.9 ? 'PASS' : 'MISS'})`);
  console.log(`Name Match Accuracy:  ${(nameAcc * 100).toFixed(1)}%   (${nameCorrect}/${nameTotal})`);
  console.log(`PDF Safe-Skip Rate:   ${(pdfAcc * 100).toFixed(1)}%   (${pdfSafe}/${pdfTotal}, Target = 100.0%: ${pdfAcc === 1 ? 'PASS' : 'MISS'})`);
  console.log(`Latency (Median/p95): ${medianMs}ms / ${p95Ms}ms (Target p95 <= 5000ms: ${p95Ms <= 5000 ? 'PASS' : 'MISS'})`);
}

main().catch(async (err) => {
  console.error('Benchmark failed:', err);
  await terminateOcrWorker();
  process.exit(1);
});
