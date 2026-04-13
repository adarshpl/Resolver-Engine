// ─── Local merge engine (mirrors the original smartDemoMerge JS logic) ────────
// Used as an instant fallback when no Anthropic API key is supplied.

import { ConflictInfo } from './types';

export function smartDemoMerge(c: ConflictInfo, files: Record<string, string>): string {
  const aLines       = c.devA.code.split('\n');
  const bLines       = c.devB.code.split('\n');
  const baseLines    = (files[c.filename] ?? '').split('\n');
  const conflictSet  = new Set(c.lines ?? []);

  if (!conflictSet.size) return c.devB.code;

  const baseSet = new Set(baseLines.map(l => l.trim()).filter(Boolean));

  const uniqueToA: { line: string; trim: string; idx: number }[] = [];
  const uniqueToB: { line: string; trim: string; idx: number }[] = [];

  aLines.forEach((l, i) => {
    const t = l.trim();
    if (t && conflictSet.has(i) && !baseSet.has(t)) uniqueToA.push({ line: l, trim: t, idx: i });
  });
  bLines.forEach((l, i) => {
    const t = l.trim();
    if (t && conflictSet.has(i) && !baseSet.has(t)) uniqueToB.push({ line: l, trim: t, idx: i });
  });

  // IF-block merge
  if (/^if\s*\(/.test(uniqueToA[0]?.trim ?? '') || /^if\s*\(/.test(uniqueToB[0]?.trim ?? '')) {
    return mergeIfBlocks(aLines, bLines, conflictSet, c.filename);
  }

  // Generic additive merge
  return mergeAdditive(aLines, bLines, conflictSet, uniqueToA, uniqueToB, c.filename);
}

// ── If-block merger ────────────────────────────────────────────────────────────
function mergeIfBlocks(
  aLines: string[],
  bLines: string[],
  conflictSet: Set<number>,
  filename: string,
): string {
  const seed = [...conflictSet].sort((x, y) => x - y)[0];

  function findBlock(lines: string[], approxLine: number) {
    let start = approxLine;
    for (let i = approxLine; i >= Math.max(0, approxLine - 8); i--) {
      if (/^\s*if\s*\(/.test(lines[i])) { start = i; break; }
    }
    let braces = 0, end = start, started = false;
    for (let i = start; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { braces++; started = true; }
        if (ch === '}') braces--;
      }
      if (!started && lines[i].includes(';') && i > start) { end = i; break; }
      if (started && braces === 0) { end = i; break; }
    }
    const raw   = lines.slice(start, end + 1).join('\n');
    const cm    = raw.match(/if\s*\(\s*([\s\S]+?)\s*\)\s*(?:\n\s*)?\{/)
               ?? raw.match(/if\s*\(\s*([\s\S]+?)\s*\)\s+\S/);
    const cond  = cm ? cm[1].trim() : null;
    const bo    = raw.indexOf('{');
    const bc    = raw.lastIndexOf('}');
    const body  = bo >= 0 && bc > bo ? raw.slice(bo + 1, bc) : null;
    const indent = (lines[start] ?? '').match(/^(\s*)/)?.[1] ?? '';
    return { start, end, cond, body, indent, raw };
  }

  const aBlk = findBlock(aLines, seed);
  const bBlk = findBlock(bLines, seed);
  if (!aBlk.cond || !bBlk.cond) return bLines.join('\n');

  const ind    = aBlk.indent;
  const body   = aBlk.body ?? bBlk.body;
  let merged: string;

  if (body !== null) {
    const bodyLines = body.split('\n').filter(l => l.trim());
    const nb        = bodyLines.map(l => `${ind}    ${l.trim()}`).join('\n');
    merged = `${ind}if (${aBlk.cond} || ${bBlk.cond})\n${ind}{\n${nb}\n${ind}}`;
  } else {
    const sb = aBlk.raw.replace(/if\s*\([^)]+\)\s*/, '').trim();
    merged   = `${ind}if (${aBlk.cond} || ${bBlk.cond}) ${sb}`;
  }

  const result = [...aLines.slice(0, aBlk.start), merged, ...aLines.slice(aBlk.end + 1)].join('\n');
  return filename.endsWith('.json') ? fixJsonCommas(result) : result;
}

// ── Generic additive merger ────────────────────────────────────────────────────
function mergeAdditive(
  aLines: string[],
  bLines: string[],
  conflictSet: Set<number>,
  _uA: unknown[],
  _uB: unknown[],
  filename: string,
): string {
  const aTrimSet = new Set(aLines.map(l => l.trim()));
  const result   = [...aLines];
  const toAdd    = bLines.filter(l => { const t = l.trim(); return t && !aTrimSet.has(t); });
  if (!toAdd.length) return aLines.join('\n');

  const insertAfter = [...conflictSet].sort((x, y) => x - y).at(-1) ?? 0;
  result.splice(insertAfter + 1, 0, ...toAdd);

  const joined = result.join('\n');
  return filename.endsWith('.json') ? fixJsonCommas(joined) : joined;
}

// ── JSON comma fixer ───────────────────────────────────────────────────────────
function fixJsonCommas(jsonText: string): string {
  const lines  = jsonText.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trimEnd();

    let next = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim()) { next = lines[j].trim(); break; }
    }

    const endsWithValue = /["\\d\\w\]true false null]$/.test(trimmed) && !/[{[,]$/.test(trimmed);
    if (endsWithValue) {
      if (/^"/.test(next))        line = trimmed.replace(/,\s*$/, '') + ',';
      else if (/^[}\]]/.test(next)) line = trimmed.replace(/,\s*$/, '');
    }
    result.push(line);
  }
  return result.join('\n');
}
