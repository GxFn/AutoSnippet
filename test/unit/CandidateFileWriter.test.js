import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CandidateFileWriter,
  computeCandidateHash,
  parseCandidateMarkdown,
  CANDIDATES_DIR,
} from '../../lib/service/candidate/CandidateFileWriter.js';

/* ────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────── */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asd-cfw-'));
}

function makeCandidate(overrides = {}) {
  return {
    id: 'aaaa-bbbb-cccc-dddddddddddd',
    code: 'func hello() { print("world") }',
    language: 'swift',
    category: 'utility',
    source: 'manual',
    status: 'pending',
    createdBy: 'test-user',
    createdAt: 1700000000,
    updatedAt: 1700000000,
    reasoning: {
      whyStandard: 'common greeting pattern',
      sources: ['file.swift'],
      confidence: 0.9,
    },
    metadata: {
      title: 'Hello World Helper',
      description: 'A simple greeting function',
    },
    statusHistory: [],
    ...overrides,
  };
}

/* ────────────────────────────────────────────
 *  Tests
 * ──────────────────────────────────────────── */
describe('CandidateFileWriter', () => {
  let tmpDir, writer;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writer = new CandidateFileWriter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /* ── CANDIDATES_DIR constant ─────────────── */
  test('CANDIDATES_DIR should be AutoSnippet/candidates', () => {
    expect(CANDIDATES_DIR).toBe('AutoSnippet/candidates');
  });

  /* ── serializeToMarkdown ─────────────────── */
  describe('serializeToMarkdown', () => {
    test('should produce valid YAML frontmatter + Markdown body', () => {
      const md = writer.serializeToMarkdown(makeCandidate());

      expect(md).toMatch(/^---\n/);
      expect(md).toMatch(/\n---\n/);
      expect(md).toContain('id: aaaa-bbbb-cccc-dddddddddddd');
      expect(md).toContain('status: pending');
      expect(md).toContain('language: swift');
      expect(md).toContain('category: utility');
      expect(md).toContain('source: manual');
      expect(md).toContain('createdBy: test-user');
      expect(md).toContain('_contentHash:');
    });

    test('should include code block in body', () => {
      const md = writer.serializeToMarkdown(makeCandidate());

      expect(md).toContain('```swift');
      expect(md).toContain('func hello() { print("world") }');
      expect(md).toContain('```');
    });

    test('should include reasoning section', () => {
      const md = writer.serializeToMarkdown(makeCandidate());

      expect(md).toContain('## Why Standard');
      expect(md).toContain('common greeting pattern');
      expect(md).toContain('## Sources');
      expect(md).toContain('- file.swift');
    });

    test('should include title from metadata', () => {
      const md = writer.serializeToMarkdown(makeCandidate());

      expect(md).toContain('## Hello World Helper');
    });

    test('should handle missing metadata gracefully', () => {
      const md = writer.serializeToMarkdown(makeCandidate({ metadata: {} }));

      expect(md).toContain('## Candidate aaaa-bbb');
    });

    test('should include approved fields when present', () => {
      const c = makeCandidate({
        status: 'approved',
        approvedBy: 'reviewer-1',
        approvedAt: 1700001000,
      });
      const md = writer.serializeToMarkdown(c);

      expect(md).toContain('approvedBy: reviewer-1');
      expect(md).toContain('approvedAt: 1700001000');
    });

    test('should include rejected fields when present', () => {
      const c = makeCandidate({
        status: 'rejected',
        rejectedBy: 'reviewer-2',
        rejectionReason: 'too simple',
      });
      const md = writer.serializeToMarkdown(c);

      expect(md).toContain('rejectedBy: reviewer-2');
      expect(md).toContain('rejectionReason:');
      expect(md).toContain('too simple');
    });
  });

  /* ── Content Hash Round-Trip ─────────────── */
  describe('contentHash', () => {
    test('computeCandidateHash should be deterministic', () => {
      const content = 'some test content\nwith multiple lines';
      const h1 = computeCandidateHash(content);
      const h2 = computeCandidateHash(content);

      expect(h1).toBe(h2);
      expect(h1).toHaveLength(16);
    });

    test('should strip _contentHash line before hashing', () => {
      const base = 'line1\nline2';
      const withHash = 'line1\n_contentHash: abc123\nline2';

      expect(computeCandidateHash(base)).toBe(computeCandidateHash(withHash));
    });

    test('serialized markdown should have correct embedded hash', () => {
      const md = writer.serializeToMarkdown(makeCandidate());
      const hashMatch = md.match(/_contentHash:\s*(\w+)/);

      expect(hashMatch).not.toBeNull();
      const embeddedHash = hashMatch[1];
      const verifyHash = computeCandidateHash(md);

      expect(embeddedHash).toBe(verifyHash);
    });
  });

  /* ── parseCandidateMarkdown ──────────────── */
  describe('parseCandidateMarkdown', () => {
    test('should round-trip basic fields', () => {
      const md = writer.serializeToMarkdown(makeCandidate());
      const parsed = parseCandidateMarkdown(md, 'utility/hello.md');

      expect(parsed.id).toBe('aaaa-bbbb-cccc-dddddddddddd');
      expect(parsed.status).toBe('pending');
      expect(parsed.language).toBe('swift');
      expect(parsed.category).toBe('utility');
      expect(parsed.source).toBe('manual');
      expect(parsed.createdBy).toBe('test-user');
      expect(parsed._sourceFile).toBe('utility/hello.md');
    });

    test('should parse _reasoning as JSON object', () => {
      const md = writer.serializeToMarkdown(makeCandidate());
      const parsed = parseCandidateMarkdown(md, 'test.md');

      expect(parsed._reasoning).toBeDefined();
      expect(typeof parsed._reasoning).toBe('object');
      expect(parsed._reasoning.whyStandard).toBe('common greeting pattern');
    });

    test('should parse _metadata as JSON object', () => {
      const md = writer.serializeToMarkdown(makeCandidate());
      const parsed = parseCandidateMarkdown(md, 'test.md');

      expect(parsed._metadata).toBeDefined();
      expect(parsed._metadata.title).toBe('Hello World Helper');
    });

    test('should extract code block from body', () => {
      const md = writer.serializeToMarkdown(makeCandidate());
      const parsed = parseCandidateMarkdown(md, 'test.md');

      expect(parsed._bodyCode).toBe('func hello() { print("world") }');
    });
  });

  /* ── persistCandidate ────────────────────── */
  describe('persistCandidate', () => {
    test('should create .md file in correct category directory', () => {
      const candidate = makeCandidate();
      const filePath = writer.persistCandidate(candidate);

      expect(filePath).not.toBeNull();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toContain(path.join('AutoSnippet', 'candidates', 'utility'));
      expect(filePath).toEndWith('.md');
    });

    test('should use title slug as filename', () => {
      const filePath = writer.persistCandidate(makeCandidate());

      expect(path.basename(filePath)).toBe('hello-world-helper.md');
    });

    test('should fallback to id prefix when no title', () => {
      const c = makeCandidate({ metadata: {} });
      const filePath = writer.persistCandidate(c);

      expect(path.basename(filePath)).toBe('aaaa-bbb.md');
    });

    test('should return null for candidate without id', () => {
      const result = writer.persistCandidate({ code: 'test' });

      expect(result).toBeNull();
    });

    test('should create category directory recursively', () => {
      const c = makeCandidate({ category: 'network/http' });
      const filePath = writer.persistCandidate(c);

      expect(filePath).not.toBeNull();
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('file content should be valid markdown with correct hash', () => {
      writer.persistCandidate(makeCandidate());

      const catDir = path.join(tmpDir, 'AutoSnippet', 'candidates', 'utility');
      const files = fs.readdirSync(catDir);
      expect(files.length).toBe(1);

      const content = fs.readFileSync(path.join(catDir, files[0]), 'utf8');
      const hashMatch = content.match(/_contentHash:\s*(\w+)/);
      expect(hashMatch).not.toBeNull();
      expect(computeCandidateHash(content)).toBe(hashMatch[1]);
    });
  });

  /* ── removeCandidate ─────────────────────── */
  describe('removeCandidate', () => {
    test('should remove existing candidate file', () => {
      const c = makeCandidate();
      const filePath = writer.persistCandidate(c);
      expect(fs.existsSync(filePath)).toBe(true);

      const removed = writer.removeCandidate(c);

      expect(removed).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('should return false for non-existent candidate', () => {
      const result = writer.removeCandidate(makeCandidate());

      expect(result).toBe(false);
    });

    test('should return false for candidate without id', () => {
      const result = writer.removeCandidate({});

      expect(result).toBe(false);
    });
  });

  /* ── cleanupOldFile (category change) ────── */
  describe('category change cleanup', () => {
    test('should remove old file when category changes', () => {
      const c = makeCandidate({ category: 'utility' });
      const oldPath = writer.persistCandidate(c);
      expect(fs.existsSync(oldPath)).toBe(true);

      // "移动" — 改 category 后重新 persist
      c.category = 'network';
      const newPath = writer.persistCandidate(c);

      expect(newPath).not.toBeNull();
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
    });
  });
});

/* ────────────────────────────────────────────
 *  Custom matcher
 * ──────────────────────────────────────────── */
expect.extend({
  toEndWith(received, suffix) {
    const pass = typeof received === 'string' && received.endsWith(suffix);
    return {
      message: () => `expected "${received}" to end with "${suffix}"`,
      pass,
    };
  },
});
