export function normalizeEns(value) {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.eth$/.test(name)) return null;
  return name;
}
