# Vet AI — RAG Knowledge Base

Veterinary clinical knowledge documents for use in AI-assisted lab result interpretation.

## Structure

```
knowledge-base/
  dogs/
    dog-ehrlichia.md
    dog-anaplasma.md
    dog-babesia.md
    dog-kidney-disease.md
    dog-liver-disease.md
    dog-giardia.md
    dog-ancylostoma.md
    dog-isospora.md
    dog-distemper.md
    dog-parvovirus.md
  cats/
    cat-hemobartonella.md
    cat-fiv.md
    cat-felv.md
    cat-panleukopenia.md
    cat-kidney-disease.md
    cat-liver-disease.md
  analyte-codes-reference.md   ← canonical analyte code mappings
  README.md
```

## Document Format

Each document uses YAML frontmatter for metadata and a consistent section structure:

```yaml
---
id: unique-kebab-case-id
title: Human-readable title
species: dog | cat | both
tags: [tag1, tag2, ...]
analytes: [CODE1, CODE2, ...]   ← analyte codes this document is relevant to
---
```

Sections per document:

1. **Disease Overview** — etiology and epidemiology
2. **Common Symptoms** — clinical presentation
3. **Related Analytes** — table of codes, names, and roles
4. **CBC / Chemistry Patterns** — specific lab findings
5. **Interpretation Hints** — how to read the results in context
6. **Suggested Next Tests** — diagnostic follow-up
7. **Disclaimer** — for all AI-generated outputs

## Current Coverage (MVP v1)

| Document           | Species | Category                   |
| ------------------ | ------- | -------------------------- |
| dog-ehrlichia      | Dog     | Tick-borne / Rickettsial   |
| dog-anaplasma      | Dog     | Tick-borne / Rickettsial   |
| dog-babesia        | Dog     | Tick-borne / Hemoprotozoan |
| dog-kidney-disease | Dog     | Metabolic / Renal          |
| dog-liver-disease  | Dog     | Metabolic / Hepatic        |
| dog-giardia        | Dog     | Intestinal Parasite        |
| dog-ancylostoma    | Dog     | Intestinal Parasite        |
| dog-isospora       | Dog     | Intestinal Parasite        |
| dog-distemper      | Dog     | Viral                      |
| dog-parvovirus     | Dog     | Viral                      |
| cat-hemobartonella | Cat     | Hemoprotozoan              |
| cat-fiv            | Cat     | Retroviral                 |
| cat-felv           | Cat     | Retroviral                 |
| cat-panleukopenia  | Cat     | Viral                      |
| cat-kidney-disease | Cat     | Metabolic / Renal          |
| cat-liver-disease  | Cat     | Metabolic / Hepatic        |

## Intended RAG Pipeline (next step)

1. **Chunking**: Split each document by section (H2 heading boundaries). Each chunk retains frontmatter metadata.
2. **Embedding**: Use `text-embedding-3-small` (OpenAI) or Voyage AI `voyage-3-lite` to embed each chunk.
3. **Vector store**: Store embeddings in pgvector (already on Supabase PostgreSQL) — add a `rag_chunks` table.
4. **Retrieval**: At interpretation time, embed the user query (analyte flags + species + symptoms) and retrieve the top-K most relevant chunks.
5. **Augmentation**: Inject retrieved chunks into the Claude system prompt as "relevant clinical context."

## Adding New Documents

1. Create a new `.md` file in the appropriate species folder.
2. Follow the frontmatter schema above.
3. Use analyte codes from `analyte-codes-reference.md`.
4. Keep interpretation hints conservative — do not speculate beyond established clinical patterns.
5. Always include the standard disclaimer section.
