/**
 * Suggests which of the lab's EXISTING catalog items each row of its billing
 * list (Item + Descripción) belongs to. Pure and read-only: nothing here picks
 * for the user. A row is only SUGGESTED when exactly one item matches
 * unambiguously; anything similar, duplicated or contested is REVIEW and the
 * user must choose. Rows with no match are never turned into new items.
 */

export interface MappingRowInput {
  code: string;
  description: string;
}

export interface MappingCatalogItem {
  id: string;
  kind: 'TEST' | 'PACKAGE';
  code: string | null;
  name: string;
  billingCode: string | null;
}

export type MatchedBy = 'NAME' | 'CODE' | 'SIMILAR';

export interface MappingCandidate {
  catalogItemId: string;
  kind: 'TEST' | 'PACKAGE';
  internalCode: string | null;
  name: string;
  currentBillingCode: string | null;
  matchedBy: MatchedBy;
  score: number;
}

export type MappingReason =
  | 'DUPLICATE_DESCRIPTION' // another row of the list has the same description
  | 'DUPLICATE_CODE' // the same billing code appears on more than one row
  | 'MULTIPLE_CANDIDATES' // several items match equally well
  | 'CLAIMED_BY_OTHER_ROW' // another row also points at this item
  | 'CODE_ASSIGNED_ELSEWHERE' // the billing code is already on a different item
  | 'NOT_EXACT'; // only similar names / matching internal code with a different name

export type MappingStatus = 'SUGGESTED' | 'REVIEW' | 'NO_MATCH' | 'INVALID';

export interface MappingSuggestion {
  index: number;
  code: string;
  description: string;
  status: MappingStatus;
  reasons: MappingReason[];
  suggestedCatalogItemId: string | null;
  candidates: MappingCandidate[];
}

const STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'y', 'e', 'en', 'con']);
const MAX_CANDIDATES = 5;
const MIN_SIMILARITY = 0.5;

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((t) => t && !STOP_WORDS.has(t))
  );
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function suggestBillingMappings(
  rows: MappingRowInput[],
  items: MappingCatalogItem[]
): MappingSuggestion[] {
  const count = (values: string[]) => {
    const map = new Map<string, number>();
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
    return map;
  };
  const descriptionCounts = count(
    rows.map((r) => normalizeText(r.description)).filter(Boolean)
  );
  const codeCounts = count(
    rows.map((r) => r.code.trim().toLowerCase()).filter(Boolean)
  );
  const itemsByBillingCode = new Map(
    items
      .filter((i) => i.billingCode)
      .map((i) => [(i.billingCode as string).toLowerCase(), i.id])
  );

  const suggestions: MappingSuggestion[] = rows.map((row, index) => {
    const code = row.code.trim();
    const description = row.description.trim();
    const base = {
      index,
      code,
      description,
      reasons: [] as MappingReason[],
      suggestedCatalogItemId: null as string | null,
      candidates: [] as MappingCandidate[],
    };
    if (!code) return { ...base, status: 'INVALID' as const };

    const normalizedDescription = normalizeText(description);
    const candidates: MappingCandidate[] = [];
    for (const item of items) {
      const nameScore = normalizedDescription
        ? similarity(description, item.name)
        : 0;
      const sameName =
        normalizedDescription !== '' &&
        normalizeText(item.name) === normalizedDescription;
      const sameCode =
        !!item.code && item.code.trim().toLowerCase() === code.toLowerCase();

      let matchedBy: MatchedBy | null = null;
      let score = nameScore;
      if (sameName) {
        matchedBy = 'NAME';
        score = 1;
      } else if (sameCode) {
        matchedBy = 'CODE';
        score = Math.max(nameScore, 0.01);
      } else if (nameScore >= MIN_SIMILARITY) {
        matchedBy = 'SIMILAR';
      }
      if (!matchedBy) continue;
      candidates.push({
        catalogItemId: item.id,
        kind: item.kind,
        internalCode: item.code,
        name: item.name,
        currentBillingCode: item.billingCode,
        matchedBy,
        score: Math.round(score * 100) / 100,
      });
    }
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        // NAME before CODE before SIMILAR at equal score
        ['NAME', 'CODE', 'SIMILAR'].indexOf(a.matchedBy) -
          ['NAME', 'CODE', 'SIMILAR'].indexOf(b.matchedBy)
    );
    const top = candidates.slice(0, MAX_CANDIDATES);
    if (top.length === 0) return { ...base, status: 'NO_MATCH' as const };

    const reasons: MappingReason[] = [];
    if ((descriptionCounts.get(normalizedDescription) ?? 0) > 1) {
      reasons.push('DUPLICATE_DESCRIPTION');
    }
    if ((codeCounts.get(code.toLowerCase()) ?? 0) > 1) {
      reasons.push('DUPLICATE_CODE');
    }
    const holder = itemsByBillingCode.get(code.toLowerCase());
    if (holder && !top.some((c) => c.catalogItemId === holder)) {
      reasons.push('CODE_ASSIGNED_ELSEWHERE');
    }

    // A single, unambiguous candidate: the only item with this exact name, or
    // (no exact name anywhere) the only item with this internal code whose
    // name is also reasonably close. Everything else needs a human.
    const nameMatches = top.filter((c) => c.matchedBy === 'NAME');
    const codeMatches = top.filter((c) => c.matchedBy === 'CODE');
    let chosen: MappingCandidate | null = null;
    if (nameMatches.length === 1) {
      chosen = nameMatches[0];
    } else if (nameMatches.length > 1) {
      reasons.push('MULTIPLE_CANDIDATES');
    } else if (codeMatches.length === 1 && codeMatches[0].score >= 0.5) {
      chosen = codeMatches[0];
    } else if (codeMatches.length > 1) {
      reasons.push('MULTIPLE_CANDIDATES');
    } else {
      reasons.push('NOT_EXACT');
    }
    if (chosen && chosen.matchedBy === 'CODE' && chosen.score < 1) {
      // internal code matches and the names are close but not equal: the
      // lab still confirms it, so it is only a suggestion with that note
      reasons.push('NOT_EXACT');
    }

    const blocked = reasons.some((r) =>
      [
        'DUPLICATE_DESCRIPTION',
        'DUPLICATE_CODE',
        'MULTIPLE_CANDIDATES',
        'CODE_ASSIGNED_ELSEWHERE',
        'NOT_EXACT',
      ].includes(r)
    );
    return {
      ...base,
      reasons,
      candidates: top,
      suggestedCatalogItemId: !blocked && chosen ? chosen.catalogItemId : null,
      status: !blocked && chosen ? ('SUGGESTED' as const) : ('REVIEW' as const),
    };
  });

  // Two rows pointing at the same item cannot both be right: neither is
  // suggested, both go to review.
  const claims = count(
    suggestions
      .map((s) => s.suggestedCatalogItemId)
      .filter((id): id is string => !!id)
  );
  return suggestions.map((s) =>
    s.suggestedCatalogItemId && (claims.get(s.suggestedCatalogItemId) ?? 0) > 1
      ? {
          ...s,
          status: 'REVIEW' as const,
          suggestedCatalogItemId: null,
          reasons: [...s.reasons, 'CLAIMED_BY_OTHER_ROW' as const],
        }
      : s
  );
}
