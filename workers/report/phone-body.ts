/**
 * The phone body's shape gate.
 *
 * `X-Kalsa-App` is the only thing in the request that says who sent it, and its
 * os component is the discriminator: the phone builds
 * `${version}/${Platform.OS}/arm64` (`sendLog`'s `app`) and the desktop
 * `${version}/${std::env::consts::OS}/${arch}` (`report::app_header`), which
 * is macos, windows or linux. A phone body is therefore the one whose every
 * line is one of the two shapes the phone's log writer emits, and anything else
 * in it is dropped and counted.
 *
 * This is a shape gate on the client's own word, not an identity proof: a
 * caller that lies *toward* a phone os gets the gate (a stricter body), while a
 * phone that claims a desktop os gets the desktop treatment — redaction only,
 * exactly like a desktop. There is no client attestation to check, so the
 * residual risk is stated in the README rather than papered over here.
 */

/** `<ISO-8601> <KALSA_TAG> {json>` — the console writer (`collector`'s
 *  `captureConsoleLine` → `formatRecord`), the payload running to end of line.
 *  The tag is checked against the `KALSA_` prefix the client requires of every
 *  log call, not against its own `TAG_SCHEMAS` key set: the client adds tags
 *  over time and a new one must not be dropped. */
const KALSA_LINE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (KALSA_[A-Z0-9_]+) (\{[\s\S]*)$/;

/**
 * `<ISO-8601> js_error name=<name> frame=<basename:line:col>|none` — the
 * second and only other writer (`recordJsError` → `formatJsErrorLine`), the
 * lines that carry the crashes the reports exist for.
 *
 * The two fields are the *shapes*, not the client's `SAFE_NAMES` /
 * `BUNDLE_BASENAMES` values: both sets hold only letters, digits, dots and
 * dashes (`Sha256VerificationUnavailableError` has digits in it), so nothing
 * identifying can ride in, and a name or bundle basename a future build adds is
 * never dropped. The longest record the client can build is 92 characters, so
 * its 300-character clip can never truncate one of these.
 */
const JS_ERROR_LINE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z js_error name=[A-Za-z0-9]{1,64} frame=(?:[A-Za-z0-9._-]{1,64}:\d{1,9}:\d{1,9}|none)$/;

/** `finalizeLine` clips the `TAG {json}` record — the timestamp prefix is added
 *  after the cut — at this many characters (`normalize`'s `MAX_LINE_CHARS`). */
const CLIENT_LINE_CLIP = 300;

/** The longest line the client can produce: the ISO prefix, a space, the clip. */
const MAX_PHONE_LINE_CHARS = 25 + CLIENT_LINE_CLIP;

export type Kept = { text: string; dropped: number };

export function isPhoneApp(app: string): boolean {
  const os = app.split("/")[1];
  return os === "android" || os === "ios";
}

function parsesAsJson(payload: string): boolean {
  try {
    JSON.parse(payload);
    return true;
  } catch {
    return false;
  }
}

function conforms(line: string): boolean {
  if (JS_ERROR_LINE.test(line)) return true;
  const match = KALSA_LINE.exec(line);
  if (match === null) return false;
  const [, stamp, tag, payload] = match;
  if (Number.isNaN(Date.parse(stamp))) return false;
  // The clip is the ceiling: no real payload is longer than what is left of the
  // 300-character budget after the tag. Checking it first is also what keeps a
  // multi-megabyte line from ever reaching JSON.parse.
  const ceiling = CLIENT_LINE_CLIP - tag.length - 1;
  if (payload.length > ceiling) return false;
  if (parsesAsJson(payload)) return true;
  // Only a payload cut at exactly the clip is a real truncated line. Anything
  // else that does not parse is not a line this client writes, and is the kind
  // of line this gate exists to drop.
  return payload.length === ceiling;
}

export function keepPhoneLines(body: string): Kept {
  const kept: string[] = [];
  let dropped = 0;
  for (const line of body.split("\n")) {
    if (line.length > MAX_PHONE_LINE_CHARS) {
      // The client clips before it timestamps, so nothing longer can come from
      // its writer whatever it contains.
      dropped += 1;
    } else if (conforms(line)) {
      kept.push(line);
    } else if (line.trim() !== "") {
      // Blank lines store nothing and are not a line the client wrote either;
      // counting them would report a body as noisier than it is.
      dropped += 1;
    }
  }
  return { text: kept.join("\n"), dropped };
}