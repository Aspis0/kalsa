/** Responses shared by every route of the download Worker. */

const TEXT_HEADERS: Record<string, string> = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const UNAVAILABLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kalsa alpha</title>
</head>
<body>
<p>Kalsa downloads are temporarily unavailable. Try again in a few minutes.</p>
</body>
</html>
`;

export function notFound(): Response {
  return new Response("Not Found\n", { status: 404, headers: TEXT_HEADERS });
}

export function methodNotAllowed(): Response {
  return new Response("Method Not Allowed\n", {
    status: 405,
    headers: { ...TEXT_HEADERS, allow: "GET, HEAD" },
  });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...TEXT_HEADERS, location } });
}

export function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { etag, "cache-control": "no-cache" } });
}

/** Bucket or manifest failure, or bytes that do not match the manifest. */
export function serviceUnavailable(): Response {
  return new Response(UNAVAILABLE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'",
      "cache-control": "no-store",
      "retry-after": "300",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
