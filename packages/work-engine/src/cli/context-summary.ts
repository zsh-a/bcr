/** Bounded JSON summaries retain small facts and explicitly account for omitted records. */
const MAX_SUMMARY_CHARACTERS = 12_000;
const sensitive = /base64|audio(?:data|content)|reference(?:audio|wav)|private/i;

function omitted(value: unknown, reason: string) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  return {
    $omitted: true,
    type,
    reason,
    serializedBytes: Buffer.byteLength(JSON.stringify(value)),
    ...(Array.isArray(value) ? { recordCount: value.length, omittedRecords: value.length } : {}),
    ...(value && typeof value === 'object' && !Array.isArray(value)
      ? { fieldCount: Object.keys(value).length }
      : {}),
    ...(typeof value === 'string' ? { characters: value.length } : {}),
  };
}

export function summarizeData(value: unknown) {
  let nodes = 0;
  function visit(item: unknown, depth = 0, key = ''): unknown {
    if (sensitive.test(key)) {
      return omitted(item, 'private-or-encoded-payload');
    }
    if (++nodes > 120 || depth > 5) {
      return omitted(item, 'summary-depth-or-node-limit');
    }
    if (typeof item === 'string') {
      if (/^data:|^[A-Za-z0-9+/]{128,}={0,2}$/.test(item)) {
        return omitted(item, 'encoded-payload');
      }
      return item.length > 240 ? omitted(item, 'string-limit') : item;
    }
    if (Array.isArray(item)) {
      if (
        item.length <= 12 &&
        item.every(
          (entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry),
        )
      ) {
        return item.map((entry) => visit(entry, depth + 1));
      }
      return omitted(item, 'records-are-query-only');
    }
    if (!item || typeof item !== 'object') {
      return item;
    }
    const entries = Object.entries(item);
    if (entries.some(([name]) => name.length > 120)) {
      return omitted(item, 'object-key-limit');
    }
    if (entries.some(([name]) => ['$omitted', '$omittedFields'].includes(name))) {
      return omitted(item, 'reserved-summary-marker');
    }
    const output: Record<string, unknown> = Object.create(null);
    const priority = ['status', 'parameters', 'exact', 'simulation', 'checks'];
    entries.sort(([a], [b]) => {
      const rank = (name: string) =>
        priority.includes(name) ? priority.indexOf(name) : priority.length;
      return rank(a) - rank(b);
    });
    const selected = entries.slice(0, 24);
    for (const [name, child] of selected) {
      output[name] = visit(child, depth + 1, name);
    }
    if (entries.length > selected.length) {
      output.$omittedFields = {
        count: entries.length - selected.length,
        reason: 'object-field-limit',
      };
    }
    if (JSON.stringify(output).length > MAX_SUMMARY_CHARACTERS) {
      return omitted(item, 'summary-character-limit');
    }
    return output;
  }
  return {
    value: visit(value),
    limits: {
      characters: MAX_SUMMARY_CHARACTERS,
      depth: 5,
      fieldsPerObject: 24,
      primitiveArrayRecords: 12,
    },
    policy:
      'Omitted values remain in data.json; query the relevant path or run the model check instead of reading all records.',
  };
}
