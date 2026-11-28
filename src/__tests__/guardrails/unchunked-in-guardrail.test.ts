import * as fs from 'fs';
import * as path from 'path';

interface InCallViolation {
  file: string;
  line: number;
  column: string;
  valuesExpr: string;
  reason: string;
}

interface BoundedAllowlistEntry {
  file: string;
  column: string;
  argPattern: RegExp;
  reason: string;
}

/**
 * Explicitly reviewed, provably small-cardinality dynamic `.in(...)` call sites.
 * Do NOT add unbounded tenant-wide ID arrays (users, trainees, enrollments, programs,
 * conversations, sessions across date ranges) here — chunk them with `chunkIds` / `chunkArray`
 * or replace with a PostgREST `!inner` join instead.
 */
const BOUNDED_IN_ALLOWLIST: BoundedAllowlistEntry[] = [
  {
    file: 'app/api/trainees/[id]/personal-data/route.ts',
    column: 'enrollment_id',
    argPattern: /^\(enrollments\s*\?\?\s*\[\]\)\.map\(/,
    reason: 'Single trainee enrollment list (bounded per-person)',
  },
  {
    file: 'services/attendanceService.ts',
    column: 'session_id',
    argPattern: /^(?:sessionIds|todaySessionIds)\b/,
    reason: 'Single program sessions on a single date',
  },
  {
    file: 'services/messengerService.ts',
    column: 'tenant_id',
    argPattern: /^activeTenantIds$/,
    reason: 'Small bounded set of active LGU tenants',
  },
  {
    file: 'services/nonAttendanceDateService.ts',
    column: 'program_id',
    argPattern: /^\[(?:filters\.program_id|programId),\s*null\]$/,
    reason: 'Fixed 2-element array [programId, null]',
  },
];

/**
 * Replaces JS/TS comments with spaces while preserving line numbers and string literals.
 */
function stripCommentsPreservingLines(source: string): string {
  const out: string[] = [];
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      out.push(ch);
      if (ch === '\\' && i + 1 < source.length) {
        out.push(next);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < source.length) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join('');
}

function splitTopLevelArgs(argList: string): string[] {
  const args: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < argList.length; i += 1) {
    const ch = argList[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen -= 1;
    else if (ch === '[') depthBracket += 1;
    else if (ch === ']') depthBracket -= 1;
    else if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace -= 1;
    else if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      args.push(argList.slice(start, i).trim());
      start = i + 1;
    }
  }

  const tail = argList.slice(start).trim();
  if (tail.length > 0) args.push(tail);
  return args;
}

function isStaticOrConstantArray(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return false;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return true;

  const elements = splitTopLevelArgs(inner);
  return elements.every((el) => {
    const item = el.trim();
    if (/^'(?:\\.|[^'\\])*'$/.test(item)) return true;
    if (/^"(?:\\.|[^"\\])*"$/.test(item)) return true;
    if (/^-?\d+(?:\.\d+)?$/.test(item)) return true;
    if (item === 'null') return true;
    // Allow bounded enum spreads like `[...ACTIVE_ENROLLMENT_STATUSES]`
    if (/^\.\.\.[A-Z][A-Z0-9_]+$/.test(item)) return true;
    return false;
  });
}

function isChunkedVariable(expr: string, fileSource: string): boolean {
  const trimmed = expr.trim();
  if (!/^(?:chunk|[a-z][A-Za-z0-9]*Chunk)$/.test(trimmed)) return false;
  return /\b(?:chunkIds|chunkArray)\s*\(/.test(fileSource);
}

function unquoteStringLiteral(expr: string): string {
  const trimmed = expr.trim();
  if (
    (trimmed.startsWith('\'') && trimmed.endsWith('\'')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function scanSourceForUnchunkedInCalls(
  relPosixPath: string,
  source: string
): InCallViolation[] {
  const cleaned = stripCommentsPreservingLines(source);
  const violations: InCallViolation[] = [];
  const callRegex = /\.in\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(cleaned)) !== null) {
    const openParenIdx = cleaned.indexOf('(', match.index);
    let depth = 1;
    let quote: string | null = null;
    let closeParenIdx = -1;

    for (let i = openParenIdx + 1; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (quote) {
        if (ch === '\\') {
          i += 1;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParenIdx = i;
          break;
        }
      }
    }

    if (closeParenIdx === -1) continue;

    const rawArgs = cleaned.slice(openParenIdx + 1, closeParenIdx);
    const args = splitTopLevelArgs(rawArgs);
    if (args.length !== 2) continue;

    const column = unquoteStringLiteral(args[0]);
    const valuesExpr = args[1].replace(/\s+/g, ' ').trim();

    if (isStaticOrConstantArray(valuesExpr)) continue;
    if (isChunkedVariable(valuesExpr, cleaned)) continue;

    const allowlisted = BOUNDED_IN_ALLOWLIST.some(
      (entry) =>
        entry.file === relPosixPath &&
        entry.column === column &&
        entry.argPattern.test(valuesExpr)
    );
    if (allowlisted) continue;

    const line = cleaned.slice(0, match.index).split('\n').length;
    violations.push({
      file: relPosixPath,
      line,
      column,
      valuesExpr,
      reason:
        'Dynamic `.in()` argument is not chunked via `chunkIds`/`chunkArray` or registered as bounded. ' +
        'Large UUID arrays overflow PostgREST 16 KB HTTP headers (UND_ERR_HEADERS_OVERFLOW). ' +
        'Chunk with `chunkIds(ids, 150)` or replace with a PostgREST `!inner` join.',
    });
  }

  return violations;
}

function collectBackendSourceFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (!entry.name.endsWith('.ts')) continue;
        if (/\.(?:test|spec)\.ts$/.test(entry.name)) continue;
        if (entry.name.includes('.backup')) continue;
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}

describe('Rung 3 Guardrail: no unchunked dynamic Supabase .in() queries in Backend/src', () => {
  it('flags synthetic unchunked dynamic .in() calls and accepts chunked or static ones', () => {
    const badSample = `
      const { data } = await supabaseAdmin.from('users').select('*').in('id', userIds);
    `;
    const badViolations = scanSourceForUnchunkedInCalls('app/api/example/route.ts', badSample);
    expect(badViolations).toHaveLength(1);
    expect(badViolations[0].column).toBe('id');
    expect(badViolations[0].valuesExpr).toBe('userIds');

    const goodSample = `
      import { chunkIds } from '@/lib/supabasePagination';
      for (const idChunk of chunkIds(userIds, 150)) {
        await supabaseAdmin.from('users').select('*').in('id', idChunk).in('status', ['active', 'enrolled']);
      }
    `;
    expect(scanSourceForUnchunkedInCalls('app/api/example/route.ts', goodSample)).toEqual([]);
  });

  it('verifies every Backend/src/**/*.ts file has zero unchunked dynamic .in() queries', () => {
    const backendSrcDir = path.resolve(__dirname, '../..');
    const files = collectBackendSourceFiles(backendSrcDir);
    expect(files.length).toBeGreaterThan(20);

    const allViolations: InCallViolation[] = [];

    for (const absFile of files) {
      const relPosixPath = path.relative(backendSrcDir, absFile).split(path.sep).join('/');
      const source = fs.readFileSync(absFile, 'utf8');
      allViolations.push(...scanSourceForUnchunkedInCalls(relPosixPath, source));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  - Backend/src/${v.file}:${v.line} -> .in('${v.column}', ${v.valuesExpr})\n    ${v.reason}`)
        .join('\n');
      throw new Error(`Found ${allViolations.length} unchunked dynamic .in() call(s):\n${report}`);
    }

    expect(allViolations).toEqual([]);
  });
});
