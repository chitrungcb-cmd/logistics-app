// Human-readable random password generator (BƯỚC 1b). Deliberately excludes characters that are
// easy to misread when an admin reads a password aloud or copies it onto paper: 0/O, 1/l/I.
// Uses the Web Crypto RNG (available in both the browser and Node's globalThis), never Math.random.
const LOWER = "abcdefghjkmnpqrstuvwxyz"; // no i, l, o
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const ALL = LOWER + UPPER + DIGITS;

function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/** Returns a 16-char password containing at least one lowercase, uppercase and digit. */
export function generateReadablePassword(): string {
  const length = 16;
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  const chars = [...required, ...rest];

  // Fisher–Yates shuffle so the guaranteed chars aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
