function chunk(arr, size) {
  // Split arr into arrays of length `size`. The last chunk may be shorter.
  // If size < 1, throw RangeError.
  if (size < 1) {
    throw new RangeError("size must be at least 1");
  }

  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

module.exports = { chunk };
