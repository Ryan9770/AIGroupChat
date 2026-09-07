export const FORMAT_VERSION = 1;

export function serialize(record) {
  if (typeof record?.name !== 'string' || record.name.length === 0) {
    throw new Error('name is required');
  }
  return JSON.stringify({
    v: FORMAT_VERSION,
    name: record.name,
    tags: record.tags ?? [],
  });
}

export function parse(text) {
  const raw = JSON.parse(text);
  if (raw.v !== FORMAT_VERSION) {
    throw new Error(`unsupported format version: ${raw.v}`);
  }
  return {
    name: raw.name,
    tags: raw.tags ?? [],
  };
}
