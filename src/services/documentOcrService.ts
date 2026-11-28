/**
 * Offline Document Intelligence & OCR Pre-Screening Service (Module B)
 *
 * Uses locally installed `sharp` + `tesseract.js` (WASM) with bundled
 * `Backend/assets/tessdata/eng.traineddata.gz` — $0 cost, zero external API calls.
 *
 * Capabilities:
 *   1. Real signal-processing blur detection (3x3 Laplacian variance) + blank detection
 *   2. Image enhancement pipeline (auto-rotate, grayscale, normalize, sharpen)
 *   3. Local LSTM OCR (tesseract.js) + BMDC 7-requirement keyword verification
 *   4. Fuzzy Levenshtein trainee-name matching against registered profile
 *   5. Dedicated ID picture check (white-background ratio, resolution, subject contrast)
 *   6. Graceful PDF skipping + strict timeout + Passive/Advisory guarantee (never throws)
 */

import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import type { Worker } from 'tesseract.js';
import { logger } from '../utils/logger';
import type {
  IdPhotoAdvisoryChecks,
  RequirementOcrAnalysis,
  RequirementOcrStatus,
} from '../types/advisory';

export const OCR_ENGINE_VERSION = 'tesseract-wasm-7-sharp-v1';

export const DEFAULT_OCR_CONFIG = {
  min_blur_variance: 80,
  min_name_match: 0.65,
  timeout_ms: 15000,
};

export interface OcrScreeningConfig {
  min_blur_variance: number;
  min_name_match: number;
  timeout_ms: number;
}

export interface AnalyzeRequirementDocumentParams {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
  requirementType: string;
  traineeFirstName?: string | null;
  traineeLastName?: string | null;
  config?: Partial<OcrScreeningConfig>;
}

// ---------------------------------------------------------------------------
// BMDC 7-Requirement Keyword Profiles
// ---------------------------------------------------------------------------

export const DOC_TYPE_KEYWORDS: Record<string, string[]> = {
  valid_id_copy: [
    'republic',
    'philippines',
    'republika',
    'pilipinas',
    'driver',
    'license',
    'passport',
    'sss',
    'umid',
    'philsys',
    'philhealth',
    'tin',
    'postal',
    'voter',
    'identification',
    'national id',
    'prc',
    'lto',
    'id no',
    'card',
  ],
  birth_certificate_copy: [
    'live birth',
    'certificate of live birth',
    'birth',
    'philippine statistics',
    'psa',
    'nso',
    'civil registrar',
    'registry',
    'date of birth',
    'municipal',
    'republic of the philippines',
  ],
  marriage_certificate_copy: [
    'marriage',
    'certificate of marriage',
    'philippine statistics',
    'psa',
    'nso',
    'husband',
    'wife',
    'civil registrar',
    'contracting parties',
    'solemnizing',
  ],
  report_card_tor_copy: [
    'transcript',
    'records',
    'report card',
    'deped',
    'ched',
    'department of education',
    'school',
    'grade',
    'grades',
    'student',
    'semester',
    'subject',
    'general average',
    'form 137',
    'form 138',
    'registrar',
    'academic',
  ],
  barangay_no_grade_certification: [
    'barangay',
    'certification',
    'certify',
    'punong barangay',
    'office of the',
    'to whom it may concern',
    'resident',
    'municipality',
    'bongabong',
    'oriental mindoro',
    'clearance',
    'no grade',
    'good standing',
  ],
  accomplished_learners_profile_form: [
    'learner',
    'profile',
    'tesda',
    'bmdc',
    'trainee',
    'manpower',
    'enrollment',
    'qualification',
    'registration',
    'form',
  ],
};

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ---------------------------------------------------------------------------
// Pure Helpers (100% unit-testable)
// ---------------------------------------------------------------------------

export function resolveOcrConfig(
  rawConfig: Record<string, unknown> | null | undefined
): OcrScreeningConfig {
  const minBlur =
    typeof rawConfig?.min_blur_variance === 'number' &&
    rawConfig.min_blur_variance >= 10 &&
    rawConfig.min_blur_variance <= 500
      ? rawConfig.min_blur_variance
      : DEFAULT_OCR_CONFIG.min_blur_variance;

  const minName =
    typeof rawConfig?.min_name_match === 'number' &&
    rawConfig.min_name_match >= 0.3 &&
    rawConfig.min_name_match <= 1.0
      ? rawConfig.min_name_match
      : DEFAULT_OCR_CONFIG.min_name_match;

  const timeoutMs =
    typeof rawConfig?.timeout_ms === 'number' &&
    rawConfig.timeout_ms >= 2000 &&
    rawConfig.timeout_ms <= 30000
      ? rawConfig.timeout_ms
      : DEFAULT_OCR_CONFIG.timeout_ms;

  return {
    min_blur_variance: minBlur,
    min_name_match: minName,
    timeout_ms: timeoutMs,
  };
}

export function normalizeOcrText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tokenSimilarity(target: string, candidate: string): number {
  if (!target || !candidate) return 0;
  if (target === candidate) return 1;
  const maxLen = Math.max(target.length, candidate.length);
  if (maxLen === 0) return 0;
  const dist = levenshteinDistance(target, candidate);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Match expected BMDC document-type keywords inside normalized OCR text.
 * Returns a [0, 1] score (saturating at 3 distinct keyword hits = 1.0) and matched phrases.
 */
export function matchDocumentKeywords(
  ocrText: string,
  requirementType: string
): { score: number; matchedKeywords: string[] } {
  const keywords = DOC_TYPE_KEYWORDS[requirementType] ?? [];
  if (keywords.length === 0) {
    return { score: 0.5, matchedKeywords: [] };
  }

  const normalized = normalizeOcrText(ocrText);
  if (!normalized) {
    return { score: 0, matchedKeywords: [] };
  }

  const words = normalized.split(' ').filter((w) => w.length >= 2);
  const matched: string[] = [];

  for (const kw of keywords) {
    const normKw = normalizeOcrText(kw);
    if (!normKw) continue;

    if (normalized.includes(normKw)) {
      matched.push(kw.toUpperCase());
      continue;
    }

    // Fuzzy single-word fallback for minor OCR typos on words >= 5 chars
    if (!normKw.includes(' ') && normKw.length >= 5) {
      const foundFuzzy = words.some((w) => tokenSimilarity(normKw, w) >= 0.82);
      if (foundFuzzy) {
        matched.push(kw.toUpperCase());
      }
    }
  }

  const uniqueMatched = Array.from(new Set(matched)).slice(0, 8);
  // 1 hit -> 0.40, 2 hits -> 0.75, 3+ hits -> 1.00
  const score =
    uniqueMatched.length === 0
      ? 0
      : uniqueMatched.length === 1
        ? 0.4
        : uniqueMatched.length === 2
          ? 0.75
          : 1;

  return { score, matchedKeywords: uniqueMatched };
}

/**
 * Fuzzy match trainee first & last name tokens against OCR extracted text.
 * Weighted 60% last name + 40% first name so compound first names stay tolerant.
 */
export function computeFuzzyNameMatch(
  ocrText: string,
  firstName?: string | null,
  lastName?: string | null
): { score: number | null; detectedTokens: string[] } {
  const firstTokens = normalizeOcrText(firstName ?? '')
    .split(' ')
    .filter((t) => t.length >= 2);
  const lastTokens = normalizeOcrText(lastName ?? '')
    .split(' ')
    .filter((t) => t.length >= 2);

  if (firstTokens.length === 0 && lastTokens.length === 0) {
    return { score: null, detectedTokens: [] };
  }

  const ocrWords = normalizeOcrText(ocrText)
    .split(' ')
    .filter((w) => w.length >= 2);
  if (ocrWords.length === 0) {
    return { score: 0, detectedTokens: [] };
  }

  const bestForTokens = (targets: string[]) => {
    const hits: string[] = [];
    if (targets.length === 0) return { avg: 0, hits };
    let total = 0;
    for (const target of targets) {
      let best = 0;
      for (const word of ocrWords) {
        const sim = tokenSimilarity(target, word);
        if (sim > best) best = sim;
        if (best === 1) break;
      }
      total += best;
      if (best >= 0.72) hits.push(target.toUpperCase());
    }
    return { avg: total / targets.length, hits };
  };

  const firstRes = bestForTokens(firstTokens);
  const lastRes = bestForTokens(lastTokens);

  let score: number;
  if (firstTokens.length > 0 && lastTokens.length > 0) {
    score = lastRes.avg * 0.6 + firstRes.avg * 0.4;
  } else if (lastTokens.length > 0) {
    score = lastRes.avg;
  } else {
    score = firstRes.avg;
  }

  return {
    score: Math.round(score * 10000) / 10000,
    detectedTokens: Array.from(new Set([...firstRes.hits, ...lastRes.hits])),
  };
}

/**
 * Compute image sharpness via discrete 3x3 Laplacian variance + blank detection.
 */
export async function computeImageQualityMetrics(buffer: Buffer): Promise<{
  blurScore: number;
  stdDev: number;
  isBlank: boolean;
  width: number;
  height: number;
}> {
  const metadata = await sharp(buffer).rotate().metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const pixelCount = w * h;
  if (pixelCount === 0 || w < 3 || h < 3) {
    return { blurScore: 0, stdDev: 0, isBlank: true, width: origWidth, height: origHeight };
  }

  // Pixel mean & stdDev (detects solid/blank images)
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = data[i];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / pixelCount;
  const pixelVar = Math.max(0, sumSq / pixelCount - mean * mean);
  const stdDev = Math.sqrt(pixelVar);

  // 3x3 Laplacian response variance over interior pixels
  let lapSum = 0;
  let lapSumSq = 0;
  let lapCount = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const lap =
        data[idx - w] +
        data[idx + w] +
        data[idx - 1] +
        data[idx + 1] -
        4 * data[idx];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapCount++;
    }
  }

  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const lapVariance =
    lapCount > 0 ? Math.max(0, lapSumSq / lapCount - lapMean * lapMean) : 0;

  return {
    blurScore: Math.round(lapVariance * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    isBlank: stdDev < 10.0,
    width: origWidth,
    height: origHeight,
  };
}

/**
 * Evaluate BMDC `id_pictures` requirements: white background ratio, portrait contrast,
 * resolution, and near-square aspect ratio using pure sharp pixel stats.
 */
export async function analyzeIdPictureQuality(
  buffer: Buffer,
  origWidth: number,
  origHeight: number
): Promise<IdPhotoAdvisoryChecks> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 200, height: 200, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;

  let borderPixels = 0;
  let whiteBorderPixels = 0;
  let centerNonWhite = 0;
  let centerPixels = 0;

  const topLimit = Math.max(1, Math.floor(h * 0.18));
  const sideLimit = Math.max(1, Math.floor(w * 0.15));
  const cxStart = Math.floor(w * 0.3);
  const cxEnd = Math.ceil(w * 0.7);
  const cyStart = Math.floor(h * 0.25);
  const cyEnd = Math.ceil(h * 0.75);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * channels;
      const r = data[idx];
      const g = channels > 1 ? data[idx + 1] : r;
      const b = channels > 2 ? data[idx + 2] : r;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const isWhiteish = minC >= 190 && maxC - minC <= 40;

      const isBorder = y < topLimit || x < sideLimit || x >= w - sideLimit;
      if (isBorder) {
        borderPixels++;
        if (isWhiteish) whiteBorderPixels++;
      }

      if (x >= cxStart && x < cxEnd && y >= cyStart && y < cyEnd) {
        centerPixels++;
        if (!isWhiteish) centerNonWhite++;
      }
    }
  }

  const whiteBgRatio =
    borderPixels > 0
      ? Math.round((whiteBorderPixels / borderPixels) * 1000) / 1000
      : 0;
  const centerSubjectRatio = centerPixels > 0 ? centerNonWhite / centerPixels : 0;
  const aspectRatio =
    origHeight > 0 ? Math.round((origWidth / origHeight) * 100) / 100 : 0;

  return {
    white_bg_ratio: whiteBgRatio,
    aspect_ratio: aspectRatio,
    min_resolution_ok: origWidth >= 150 && origHeight >= 150,
    portrait_center_contrast_ok: centerSubjectRatio >= 0.22,
  };
}

/**
 * Derive final Passive / Advisory OCR verdict from computed metrics.
 */
export function deriveOcrVerdict(params: {
  requirementType: string;
  blurScore: number;
  isBlank: boolean;
  ocrConfidence: number | null;
  docTypeMatchScore: number;
  matchedKeywords: string[];
  traineeNameMatchScore: number | null;
  idPhotoChecks?: IdPhotoAdvisoryChecks;
  config: OcrScreeningConfig;
}): { status: RequirementOcrStatus; isBlurry: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const isBlurry = params.blurScore < params.config.min_blur_variance;

  if (params.isBlank) {
    warnings.push('Uploaded image appears blank or solid-colored');
    return { status: 'flagged', isBlurry, warnings };
  }

  if (isBlurry) {
    warnings.push(
      `Image appears blurry (sharpness ${Math.round(params.blurScore)} < ${params.config.min_blur_variance})`
    );
  }

  // Dedicated branch for 1x1 white-background ID pictures
  if (params.requirementType === 'id_pictures' && params.idPhotoChecks) {
    const idc = params.idPhotoChecks;
    if (!idc.portrait_center_contrast_ok) {
      warnings.push('No clear portrait subject detected in center of ID photo');
      return { status: 'flagged', isBlurry, warnings };
    }
    if (idc.white_bg_ratio < 0.45) {
      warnings.push(
        `Background may not be plain white (${Math.round(idc.white_bg_ratio * 100)}% white border)`
      );
    }
    if (!idc.min_resolution_ok) {
      warnings.push('ID photo resolution is below recommended 150x150px');
    }
    if (idc.aspect_ratio < 0.65 || idc.aspect_ratio > 1.45) {
      warnings.push(`Aspect ratio (${idc.aspect_ratio}) does not look like a 1x1 portrait`);
    }
    const status: RequirementOcrStatus =
      warnings.length === 0 ? 'likely_valid' : 'needs_review';
    return { status, isBlurry, warnings };
  }

  // Handwritten Learner's Profile Form stays gentle to avoid false red flags
  if (params.requirementType === 'accomplished_learners_profile_form') {
    if (params.docTypeMatchScore === 0) {
      warnings.push('Expected learner profile keywords not detected — manual staff review recommended');
    } else if (warnings.length === 0) {
      warnings.push('Handwritten fields require manual staff verification');
    }
    return {
      status: isBlurry ? 'needs_review' : params.docTypeMatchScore >= 0.4 ? 'likely_valid' : 'needs_review',
      isBlurry,
      warnings,
    };
  }

  // Text-heavy Philippine requirements (Valid ID, PSA Birth/Marriage Cert, TOR, Barangay Cert)
  if (params.ocrConfidence !== null && params.ocrConfidence < 45) {
    warnings.push(`Low OCR readability confidence (${Math.round(params.ocrConfidence)}%)`);
  }

  if (params.docTypeMatchScore === 0) {
    warnings.push('Expected document-type keywords were not detected in this scan');
  }

  const nameChecked = params.traineeNameMatchScore !== null;
  const namePassed = !nameChecked || params.traineeNameMatchScore! >= params.config.min_name_match;
  if (nameChecked && !namePassed) {
    warnings.push(
      `Trainee name match is low (${Math.round(params.traineeNameMatchScore! * 100)}%) — check ownership`
    );
  }

  if (
    params.docTypeMatchScore === 0 &&
    nameChecked &&
    params.traineeNameMatchScore! < 0.35
  ) {
    return { status: 'flagged', isBlurry, warnings };
  }

  if (!isBlurry && params.docTypeMatchScore >= 0.4 && namePassed) {
    return { status: 'likely_valid', isBlurry, warnings };
  }

  return { status: 'needs_review', isBlurry, warnings };
}

// ---------------------------------------------------------------------------
// Local Offline Tesseract WASM Worker (Zero Network Requests, Warm Across Chunks)
// ---------------------------------------------------------------------------

interface OcrWorkerRuntimeState {
  workerInstance: Worker | null;
  workerInitPromise: Promise<Worker> | null;
  workerChain: Promise<unknown>;
}

const globalForOcrWorker = globalThis as typeof globalThis & {
  __bmdcOcrWorkerState?: OcrWorkerRuntimeState;
};

const ocrWorkerState: OcrWorkerRuntimeState =
  globalForOcrWorker.__bmdcOcrWorkerState ??
  (globalForOcrWorker.__bmdcOcrWorkerState = {
    workerInstance: null,
    workerInitPromise: null,
    workerChain: Promise.resolve(),
  });

function resolveLocalTessdataDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets', 'tessdata'),
    path.resolve(process.cwd(), 'Backend', 'assets', 'tessdata'),
    path.resolve(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0'),
    path.resolve(process.cwd(), 'Backend', 'node_modules', '@tesseract.js-data', 'eng', '4.0.0'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'eng.traineddata.gz'))) {
      return dir;
    }
  }
  return candidates[0];
}

async function getOcrWorker(): Promise<Worker> {
  if (ocrWorkerState.workerInstance) return ocrWorkerState.workerInstance;
  if (!ocrWorkerState.workerInitPromise) {
    ocrWorkerState.workerInitPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = resolveLocalTessdataDir();
      const worker = await createWorker('eng', 1, {
        langPath,
        gzip: true,
        cacheMethod: 'none',
        logger: () => {},
      });
      ocrWorkerState.workerInstance = worker;
      return worker;
    })().catch((err) => {
      ocrWorkerState.workerInitPromise = null;
      throw err;
    });
  }
  return ocrWorkerState.workerInitPromise;
}

/**
 * Cleanly terminate the shared local Tesseract worker (used by benchmarks and tests).
 */
export async function terminateOcrWorker(): Promise<void> {
  if (ocrWorkerState.workerInstance) {
    const w = ocrWorkerState.workerInstance;
    ocrWorkerState.workerInstance = null;
    ocrWorkerState.workerInitPromise = null;
    await w.terminate();
  }
}

async function recognizeBufferLocally(pngBuffer: Buffer): Promise<{
  text: string;
  confidence: number;
}> {
  const job = ocrWorkerState.workerChain.then(async () => {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(pngBuffer);
    return {
      text: data.text ?? '',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
    };
  });
  ocrWorkerState.workerChain = job.catch(() => {});
  return job;
}

// ---------------------------------------------------------------------------
// Public Entry Point (Strictly Passive / Advisory — Never Throws)
// ---------------------------------------------------------------------------

export async function analyzeRequirementDocument(
  params: AnalyzeRequirementDocumentParams
): Promise<RequirementOcrAnalysis> {
  const startedAt = Date.now();
  const config: OcrScreeningConfig = {
    min_blur_variance: params.config?.min_blur_variance ?? DEFAULT_OCR_CONFIG.min_blur_variance,
    min_name_match: params.config?.min_name_match ?? DEFAULT_OCR_CONFIG.min_name_match,
    timeout_ms: params.config?.timeout_ms ?? DEFAULT_OCR_CONFIG.timeout_ms,
  };

  const ext = path.extname(params.fileName || '').toLowerCase();
  const mime = (params.mimeType || '').toLowerCase();

  // High-Value Images First: PDFs are safely skipped for manual review
  if (mime === 'application/pdf' || ext === '.pdf') {
    return {
      status: 'skipped_pdf',
      blur_score: null,
      is_blurry: false,
      is_blank: false,
      ocr_confidence: null,
      doc_type_match_score: 0,
      matched_keywords: [],
      trainee_name_match_score: null,
      detected_name_tokens: [],
      warnings: ['PDF uploaded — offline OCR applies to image uploads; manual staff review required'],
      engine_version: OCR_ENGINE_VERSION,
      processing_ms: Date.now() - startedAt,
      analyzed_at: new Date().toISOString(),
    };
  }

  const isSupportedImage =
    SUPPORTED_IMAGE_MIMES.has(mime) || (!mime && SUPPORTED_IMAGE_EXTS.has(ext));
  if (!isSupportedImage) {
    return {
      status: 'needs_review',
      blur_score: null,
      is_blurry: false,
      is_blank: false,
      ocr_confidence: null,
      doc_type_match_score: 0,
      matched_keywords: [],
      trainee_name_match_score: null,
      detected_name_tokens: [],
      warnings: ['Unsupported file format for automated OCR — manual staff review required'],
      engine_version: OCR_ENGINE_VERSION,
      processing_ms: Date.now() - startedAt,
      analyzed_at: new Date().toISOString(),
    };
  }

  const runAnalysis = async (): Promise<RequirementOcrAnalysis> => {
    const quality = await computeImageQualityMetrics(params.buffer);

    if (quality.isBlank) {
      const verdict = deriveOcrVerdict({
        requirementType: params.requirementType,
        blurScore: quality.blurScore,
        isBlank: true,
        ocrConfidence: 0,
        docTypeMatchScore: 0,
        matchedKeywords: [],
        traineeNameMatchScore: null,
        config,
      });

      return {
        status: verdict.status,
        blur_score: quality.blurScore,
        is_blurry: verdict.isBlurry,
        is_blank: true,
        ocr_confidence: 0,
        doc_type_match_score: 0,
        matched_keywords: [],
        trainee_name_match_score: null,
        detected_name_tokens: [],
        warnings: verdict.warnings,
        engine_version: OCR_ENGINE_VERSION,
        processing_ms: Date.now() - startedAt,
        analyzed_at: new Date().toISOString(),
      };
    }

    // Dedicated Computer Vision quality check for 1x1 ID Pictures (no text OCR needed)
    if (params.requirementType === 'id_pictures') {
      const idPhotoChecks = await analyzeIdPictureQuality(
        params.buffer,
        quality.width,
        quality.height
      );
      const verdict = deriveOcrVerdict({
        requirementType: params.requirementType,
        blurScore: quality.blurScore,
        isBlank: false,
        ocrConfidence: null,
        docTypeMatchScore: idPhotoChecks.portrait_center_contrast_ok ? 1 : 0,
        matchedKeywords: [],
        traineeNameMatchScore: null,
        idPhotoChecks,
        config,
      });

      return {
        status: verdict.status,
        blur_score: quality.blurScore,
        is_blurry: verdict.isBlurry,
        is_blank: false,
        ocr_confidence: null,
        doc_type_match_score: idPhotoChecks.portrait_center_contrast_ok ? 1 : 0,
        matched_keywords: [],
        trainee_name_match_score: null,
        detected_name_tokens: [],
        id_photo_checks: idPhotoChecks,
        warnings: verdict.warnings,
        engine_version: OCR_ENGINE_VERSION,
        processing_ms: Date.now() - startedAt,
        analyzed_at: new Date().toISOString(),
      };
    }

    // Preprocess image with sharp to boost OCR legibility on smartphone photos
    const enhancedPng = await sharp(params.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .png()
      .toBuffer();

    const ocrResult = await recognizeBufferLocally(enhancedPng);
    const keywordMatch = matchDocumentKeywords(ocrResult.text, params.requirementType);
    const nameMatch = computeFuzzyNameMatch(
      ocrResult.text,
      params.traineeFirstName,
      params.traineeLastName
    );

    const verdict = deriveOcrVerdict({
      requirementType: params.requirementType,
      blurScore: quality.blurScore,
      isBlank: false,
      ocrConfidence: Math.round(ocrResult.confidence * 100) / 100,
      docTypeMatchScore: keywordMatch.score,
      matchedKeywords: keywordMatch.matchedKeywords,
      traineeNameMatchScore: nameMatch.score,
      config,
    });

    return {
      status: verdict.status,
      blur_score: quality.blurScore,
      is_blurry: verdict.isBlurry,
      is_blank: false,
      ocr_confidence: Math.round(ocrResult.confidence * 100) / 100,
      doc_type_match_score: keywordMatch.score,
      matched_keywords: keywordMatch.matchedKeywords,
      trainee_name_match_score: nameMatch.score,
      detected_name_tokens: nameMatch.detectedTokens,
      warnings: verdict.warnings,
      engine_version: OCR_ENGINE_VERSION,
      processing_ms: Date.now() - startedAt,
      analyzed_at: new Date().toISOString(),
    };
  };

  // Give a one-time +8s cold-start grace budget when the WASM worker hasn't initialized yet
  const isColdWorker = !ocrWorkerState.workerInstance;
  const effectiveTimeoutMs = isColdWorker
    ? Math.min(30000, config.timeout_ms + 8000)
    : config.timeout_ms;

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<RequirementOcrAnalysis>([
      runAnalysis(),
      new Promise<RequirementOcrAnalysis>((resolve) => {
        timeoutHandle = setTimeout(
          () =>
            resolve({
              status: 'error',
              blur_score: null,
              is_blurry: false,
              is_blank: false,
              ocr_confidence: null,
              doc_type_match_score: 0,
              matched_keywords: [],
              trainee_name_match_score: null,
              detected_name_tokens: [],
              warnings: ['Offline OCR timed out — manual staff verification recommended'],
              engine_version: OCR_ENGINE_VERSION,
              processing_ms: effectiveTimeoutMs,
              analyzed_at: new Date().toISOString(),
            }),
          effectiveTimeoutMs
        );
      }),
    ]);
  } catch (err: any) {
    logger.warn('[DOCUMENT_OCR] Advisory OCR failed gracefully', {
      requirementType: params.requirementType,
      error: err?.message ?? String(err),
    });
    return {
      status: 'error',
      blur_score: null,
      is_blurry: false,
      is_blank: false,
      ocr_confidence: null,
      doc_type_match_score: 0,
      matched_keywords: [],
      trainee_name_match_score: null,
      detected_name_tokens: [],
      warnings: ['Automated OCR could not analyze this file — manual staff verification required'],
      engine_version: OCR_ENGINE_VERSION,
      processing_ms: Date.now() - startedAt,
      analyzed_at: new Date().toISOString(),
    };
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}
