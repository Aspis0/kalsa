const THEME_STORAGE_KEY = "aspis-bio.theme";

function normalizeThemeMode(value) {
  return value === "dark" ? "dark" : "light";
}

module.exports = {
  THEME_STORAGE_KEY,
  normalizeThemeMode,
};
