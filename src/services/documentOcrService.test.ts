import { describe, it, expect, afterAll } from '@jest/globals';
import sharp from 'sharp';
import {
  analyzeRequirementDocument,
  computeFuzzyNameMatch,
  computeImageQualityMetrics,
  matchDocumentKeywords,
  resolveOcrConfig,
  terminateOcrWorker,
} from './documentOcrService';

async function renderTextDocumentPng(lines: string[], opts?: { blur?: number }): Promise<Buffer> {
  const svgLines = lines
    .map(
      (line, idx) =>
        `<text x="60" y="${110 + idx * 58}" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="bold" fill="#111111">${line}</text>`
    )
    .join('');

  const svg = Buffer.from(
    `<svg width="1100" height="650" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <rect x="24" y="24" width="1052" height="602" fill="none" stroke="#222222" stroke-width="4"/>
      ${svgLines}
    </svg>`
  );

  let pipeline = sharp(svg).png();
  if (opts?.blur && opts.blur > 0) {
    pipeline = pipeline.blur(opts.blur);
  }
  return pipeline.toBuffer();
}

async function renderIdPhotoPng(bgColor: string, includeSubject: boolean): Promise<Buffer> {
  const subject = includeSubject
    ? `<circle cx="150" cy="115" r="46" fill="#7c503a"/>
       <ellipse cx="150" cy="240" rx="82" ry="68" fill="#1e3a8a"/>`
    : '';

  const svg = Buffer.from(
    `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${bgColor}"/>
      ${subject}
    </svg>`
  );
  return sharp(svg).png().toBuffer();
}

describe('documentOcrService (offline Tesseract WASM + sharp quality checks)', () => {
  afterAll(async () => {
    await terminateOcrWorker();
  });

  it('safely skips PDF files in passive advisory mode', async () => {
    const res = await analyzeRequirementDocument({
      buffer: Buffer.from('%PDF-1.4 dummy'),
      fileName: 'psa_birth_cert.pdf',
      mimeType: 'application/pdf',
      requirementType: 'birth_certificate_copy',
      traineeFirstName: 'Juan',
      traineeLastName: 'Dela Cruz',
    });

    expect(res.status).toBe('skipped_pdf');
    expect(res.warnings[0]).toMatch(/PDF/i);
  });

  it('flags blank solid-white images immediately', async () => {
    const blank = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const quality = await computeImageQualityMetrics(blank);
    expect(quality.isBlank).toBe(true);

    const res = await analyzeRequirementDocument({
      buffer: blank,
      fileName: 'blank.png',
      mimeType: 'image/png',
      requirementType: 'valid_id_copy',
      traineeFirstName: 'Maria',
      traineeLastName: 'Santos',
    });
    expect(res.status).toBe('flagged');
    expect(res.is_blank).toBe(true);
  });

  it('distinguishes sharp vs heavily blurred text scans via Laplacian variance', async () => {
    const sharpDoc = await renderTextDocumentPng([
      'REPUBLIC OF THE PHILIPPINES',
      'CERTIFICATE OF LIVE BIRTH',
      'NAME: JUAN DELA CRUZ',
    ]);
    const blurryDoc = await renderTextDocumentPng(
      ['REPUBLIC OF THE PHILIPPINES', 'CERTIFICATE OF LIVE BIRTH', 'NAME: JUAN DELA CRUZ'],
      { blur: 10 }
    );

    const qSharp = await computeImageQualityMetrics(sharpDoc);
    const qBlurry = await computeImageQualityMetrics(blurryDoc);

    expect(qSharp.blurScore).toBeGreaterThan(150);
    expect(qBlurry.blurScore).toBeLessThan(qSharp.blurScore / 4);
  });

  it('evaluates fuzzy trainee name matching tolerating 1-char OCR noise', () => {
    const clean = computeFuzzyNameMatch(
      'REPUBLIC OF THE PHILIPPINES NAME: PAOLO PALMA BONGABONG',
      'Paolo',
      'Palma'
    );
    expect(clean.score).toBe(1);
    expect(clean.detectedTokens).toEqual(expect.arrayContaining(['PAOLO', 'PALMA']));

    const noisy = computeFuzzyNameMatch(
      'CERTIFICATE ISSUED TO PA0LO PALM4 OF ORIENTAL MINDORO',
      'Paolo',
      'Palma'
    );
    expect(noisy.score).toBeGreaterThanOrEqual(0.75);

    const mismatch = computeFuzzyNameMatch(
      'CERTIFICATE ISSUED TO ROBERTO MENDOZA',
      'Paolo',
      'Palma'
    );
    expect(mismatch.score).toBeLessThan(0.5);
  });

  it('scores Philippine requirement document keywords accurately', () => {
    const psa = matchDocumentKeywords(
      'Republic of the Philippines Philippine Statistics Authority Certificate of Live Birth',
      'birth_certificate_copy'
    );
    expect(psa.score).toBe(1);
    expect(psa.matchedKeywords.length).toBeGreaterThanOrEqual(3);

    const wrongDoc = matchDocumentKeywords(
      'Random grocery receipt apples bananas total 250 pesos',
      'birth_certificate_copy'
    );
    expect(wrongDoc.score).toBe(0);
  });

  it('checks id_pictures for white background and centered portrait contrast', async () => {
    const goodId = await renderIdPhotoPng('#ffffff', true);
    const darkBgId = await renderIdPhotoPng('#1d4ed8', true);

    const goodRes = await analyzeRequirementDocument({
      buffer: goodId,
      fileName: 'id_pic.png',
      mimeType: 'image/png',
      requirementType: 'id_pictures',
    });
    expect(goodRes.status).toBe('likely_valid');
    expect(goodRes.id_photo_checks?.white_bg_ratio).toBeGreaterThan(0.7);

    const darkRes = await analyzeRequirementDocument({
      buffer: darkBgId,
      fileName: 'blue_bg_id.png',
      mimeType: 'image/png',
      requirementType: 'id_pictures',
    });
    expect(darkRes.status).toBe('needs_review');
    expect(darkRes.id_photo_checks?.white_bg_ratio).toBeLessThan(0.2);
  });

  it('runs real offline Tesseract WASM OCR end-to-end on a PSA Birth Certificate image', async () => {
    const psaImg = await renderTextDocumentPng([
      'REPUBLIC OF THE PHILIPPINES',
      'PHILIPPINE STATISTICS AUTHORITY',
      'CERTIFICATE OF LIVE BIRTH',
      'CHILD NAME: MARIA CLARA SANTOS',
      'MUNICIPALITY OF BONGABONG ORIENTAL MINDORO',
    ]);

    const res = await analyzeRequirementDocument({
      buffer: psaImg,
      fileName: 'psa_maria_santos.png',
      mimeType: 'image/png',
      requirementType: 'birth_certificate_copy',
      traineeFirstName: 'Maria Clara',
      traineeLastName: 'Santos',
      config: resolveOcrConfig({ timeout_ms: 15000 }),
    });

    expect(res.status).toBe('likely_valid');
    expect(res.doc_type_match_score).toBeGreaterThanOrEqual(0.75);
    expect(res.trainee_name_match_score).toBeGreaterThanOrEqual(0.8);
    expect(res.is_blurry).toBe(false);
    expect(res.matched_keywords.length).toBeGreaterThanOrEqual(2);
  }, 20000);
});
