/**
 * RAG Knowledge Base Ingestion Script
 *
 * Reads all veterinary markdown documents from the knowledge-base directory,
 * splits them into section-level chunks, generates OpenAI embeddings, and
 * upserts everything into the knowledge_documents + knowledge_chunks tables.
 *
 * Usage (run from repo root):
 *   npx ts-node -P apps/api/tsconfig.app.json apps/api/src/rag/scripts/ingest-knowledge.ts
 *
 * Required env vars:
 *   DATABASE_URL   — PostgreSQL connection string
 *   OPENAI_API_KEY — OpenAI API key for text-embedding-3-small
 *
 * Prerequisites:
 *   1. Enable pgvector in Supabase: Extensions → Search "vector" → Enable
 *   2. Run `npx prisma db push` to create knowledge_documents + knowledge_chunks tables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KNOWLEDGE_BASE_DIR = path.resolve(__dirname, '../knowledge-base');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Sections to skip — meta content not useful for clinical retrieval
const SKIP_SECTIONS = new Set(['Disclaimer']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Frontmatter {
  id: string;
  title: string;
  species?: string;
  topic?: string;
  tags?: string[];
  analytes?: string[];
}

interface ParsedSection {
  heading: string;
  content: string;
  embeddingText: string;
}

interface ParsedDocument {
  frontmatter: Frontmatter;
  sections: ParsedSection[];
  filePath: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (handles simple YAML — no external dependency needed)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: { id: '', title: '' }, body: raw };

  const yamlStr = match[1];
  const body = match[2];
  const data: Record<string, unknown> = {};

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      data[key] = raw;
    }
  }

  return { data: data as unknown as Frontmatter, body };
}

// ---------------------------------------------------------------------------
// Section splitter
// ---------------------------------------------------------------------------

function splitIntoSections(
  body: string,
  documentTitle: string
): ParsedSection[] {
  const parts = ('\n' + body).split(/\n## /);
  // parts[0] is content before first ##, skip it

  const sections: ParsedSection[] = [];

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const newlineIdx = block.indexOf('\n');
    if (newlineIdx === -1) continue;

    const heading = block.slice(0, newlineIdx).trim();
    const content = block.slice(newlineIdx + 1).trim();

    if (!content || SKIP_SECTIONS.has(heading)) continue;

    // Build embedding text: include document title for better context
    const embeddingText = `${documentTitle} — ${heading}\n\n${content}`;

    sections.push({ heading, content, embeddingText });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      entry.name !== 'README.md' &&
      entry.name !== 'analyte-codes-reference.md'
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

async function ingest(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const prisma = new PrismaClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`\nVet AI — RAG Knowledge Base Ingestion`);
  console.log(`Knowledge base: ${KNOWLEDGE_BASE_DIR}`);
  console.log(`Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)\n`);

  const files = findMarkdownFiles(KNOWLEDGE_BASE_DIR);
  console.log(`Found ${files.length} documents to process\n`);

  // Parse all documents first
  const documents: ParsedDocument[] = [];

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data: frontmatter, body } = parseFrontmatter(raw);

    if (!frontmatter.id || !frontmatter.title) {
      console.warn(
        `  SKIP  ${path.relative(
          KNOWLEDGE_BASE_DIR,
          filePath
        )} — missing id or title`
      );
      continue;
    }

    const sections = splitIntoSections(body, frontmatter.title);
    if (sections.length === 0) {
      console.warn(
        `  SKIP  ${path.relative(
          KNOWLEDGE_BASE_DIR,
          filePath
        )} — no sections found`
      );
      continue;
    }

    const relPath = path.relative(KNOWLEDGE_BASE_DIR, filePath);
    documents.push({ frontmatter, sections, filePath: relPath });
  }

  // Collect all embedding texts for a single batched API call
  const allTexts: string[] = [];
  for (const doc of documents) {
    for (const section of doc.sections) {
      allTexts.push(section.embeddingText);
    }
  }

  console.log(
    `Generating embeddings for ${allTexts.length} chunks via OpenAI...`
  );

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: allTexts,
  });

  const embeddings = embeddingResponse.data.map((e) => e.embedding);
  console.log(`Embeddings generated (${embeddings.length})\n`);

  // Assign embeddings back to sections
  let embeddingIdx = 0;
  const documentsWithEmbeddings = documents.map((doc) => ({
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      embedding: embeddings[embeddingIdx++],
    })),
  }));

  // Upsert documents and chunks
  let docsCreated = 0;
  let docsUpdated = 0;
  let chunksTotal = 0;

  for (const doc of documentsWithEmbeddings) {
    const { frontmatter, sections, filePath } = doc;
    const relFilePath = filePath;

    // Upsert the KnowledgeDocument
    const existingDoc = await prisma.knowledgeDocument.findUnique({
      where: { filePath: relFilePath },
      select: { id: true },
    });

    let documentId: string;

    if (existingDoc) {
      // Delete old chunks (will cascade from ON DELETE CASCADE, but let's be explicit)
      await prisma.knowledgeChunk.deleteMany({
        where: { documentId: existingDoc.id },
      });
      await prisma.knowledgeDocument.update({
        where: { id: existingDoc.id },
        data: {
          title: frontmatter.title,
          species: frontmatter.species ?? null,
          topic: frontmatter.tags?.[0] ?? null,
          status: 'ACTIVE',
          updatedAt: new Date(),
        },
      });
      documentId = existingDoc.id;
      docsUpdated++;
    } else {
      const created = await prisma.knowledgeDocument.create({
        data: {
          title: frontmatter.title,
          species: frontmatter.species ?? null,
          topic: frontmatter.tags?.[0] ?? null,
          sourceType: 'markdown',
          status: 'ACTIVE',
          filePath: relFilePath,
          scope: 'GLOBAL',
        },
      });
      documentId = created.id;
      docsCreated++;
    }

    // Insert chunks via raw SQL (pgvector requires $1::vector cast)
    for (const section of sections) {
      const chunkId = crypto.randomUUID();
      const vectorStr = `[${section.embedding.join(',')}]`;
      const metadataJson = JSON.stringify({
        documentId: frontmatter.id,
        species: frontmatter.species ?? null,
        tags: frontmatter.tags ?? [],
        analytes: frontmatter.analytes ?? [],
        section: section.heading,
      });

      await prisma.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks
           (id, "documentId", "tenantId", scope, section, content, embedding, "metadataJson", "createdAt", "updatedAt")
         VALUES
           ($1, $2, NULL, 'GLOBAL', $3, $4, $5::vector, $6::jsonb, now(), now())`,
        chunkId,
        documentId,
        section.heading,
        section.content,
        vectorStr,
        metadataJson
      );

      chunksTotal++;
    }

    const action = existingDoc ? 'UPDATED' : 'CREATED';
    console.log(`  ${action}  ${relFilePath} → ${sections.length} chunks`);
  }

  await prisma.$disconnect();

  console.log(`\n✓ Ingestion complete`);
  console.log(`  Documents created: ${docsCreated}`);
  console.log(`  Documents updated: ${docsUpdated}`);
  console.log(`  Total chunks: ${chunksTotal}\n`);
}

ingest().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
