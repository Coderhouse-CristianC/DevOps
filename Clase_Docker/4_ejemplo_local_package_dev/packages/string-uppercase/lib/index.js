function uppercase(str) {
  if (typeof str !== "string") {
    throw new TypeError("Expected a string");
  }
  return str.toUpperCase();
}

module.exports = uppercase;
