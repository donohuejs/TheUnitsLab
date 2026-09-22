const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function normalizeInviteCode(value: string) {
  return value.trim().toUpperCase().replaceAll("-", "");
}

export function isInviteCode(value: string) {
  return (
    value.length === 8 && [...value].every((character) => INVITE_CODE_ALPHABET.includes(character))
  );
}

export function formatInviteCode(value: string) {
  const normalized = normalizeInviteCode(value);
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}
