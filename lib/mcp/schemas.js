const { z } = require('zod');

// Candidate schema: rich structure used across MCP tools
const CandidateSchema = z.object({
  title: z.string().min(1, 'title is required'),
  trigger: z.string().min(1, 'trigger is required'),
  language: z.string().min(1, 'language is required'),
  summary: z.string().optional(),
  summary_cn: z.string().optional(),
  summary_en: z.string().optional(),
  code: z.string().optional(),
  usageGuide: z.string().optional(),
  usageGuide_cn: z.string().optional(),
  usageGuide_en: z.string().optional(),
  category: z.string().optional(),
  headers: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  quality: z.record(z.string(), z.unknown()).optional(),
  relatedRecipes: z.array(z.record(z.string(), z.unknown())).optional()
});

// Minimal candidate subset for duplicate check
const MinimalCandidateSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  usageGuide: z.string().optional(),
  code: z.string().optional()
});

// Draft submission schema (internal parsing result)
const DraftRecipeSchema = z.object({
  title: z.string(),
  trigger: z.string(),
  language: z.string(),
  summary: z.string().optional(),
  summary_cn: z.string().optional(),
  summary_en: z.string().optional(),
  usageGuide: z.string().optional(),
  usageGuide_cn: z.string().optional(),
  usageGuide_en: z.string().optional(),
  code: z.string().optional(),
  category: z.string().optional(),
  headers: z.array(z.string()).optional()
});

module.exports = { CandidateSchema, MinimalCandidateSchema, DraftRecipeSchema };
