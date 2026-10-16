/**
 * An address at the end of a sentence is still an address.
 *
 * Both rules used to read a trailing full stop as the start of one more part —
 * another domain label, a fifth octet — and, finding none, refuse the whole
 * token: `write to marco@example.com.` was stored as it arrived. A dot followed
 * by a digit still refuses, because `1.2.3.4.5` is a version, not an address.
 */
import { redactLine } from "./redact";

const cases: [string, string][] = [
  ["write to marco@example.com.", "write to <email>."],
  ["host 10.0.0.7.", "host <ip>."],
  ["peer 2001:db8::1.", "peer <ip6>."],
  ["10.0.0.7.nip.io", "<ip>.nip.io"],
  ["10.0.0.7..2001:db8::1word", "<ip>..2001:db8::1word"],
  ["mail marco@example.com. Then", "mail <email>. Then"],
  ["1.2.3.4.5", "1.2.3.4.5"],
  ["version 10.0.0.7.8 ok", "version 10.0.0.7.8 ok"],
  ["v1.2.3.4", "v1.2.3.4"],
];

test.each(cases)("%s", (input, want) => {
  const once = redactLine(input).text;
  expect(once).toBe(want);
  expect(redactLine(once).text).toBe(once);
});
