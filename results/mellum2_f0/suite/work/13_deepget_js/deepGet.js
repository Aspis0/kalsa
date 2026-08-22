function deepGet(obj, path) {
  // path is a dot-separated string (e.g. "a.b.0").
  // Return the nested value, or undefined if any segment is missing.
  // Empty path returns obj.
  if (path === "") {
    return obj;
  }

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

module.exports = { deepGet };
