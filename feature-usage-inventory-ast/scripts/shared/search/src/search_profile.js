"use strict";
const LANGUAGE_EXTENSIONS = Object.freeze({ js: [".js", ".jsx", ".mjs", ".cjs"], javascript: [".js", ".jsx", ".mjs", ".cjs"], ts: [".ts", ".tsx"], typescript: [".ts", ".tsx"], cpp: [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl"], "c++": [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl"], c: [".c", ".h"] });
function normalizeSearchProfile(config = {}) {
  const profile = config.searchProfile || config;
  const languages = profile.languages || [];
  if (!Array.isArray(languages) || !Array.isArray(profile.extensions || [])) throw new Error("Search languages and extensions must be arrays");
  const derived = languages.flatMap(language => { const value = LANGUAGE_EXTENSIONS[String(language).toLowerCase()]; if (!value && profile.extensions) return []; if (!value) throw new Error(`Unsupported search language ${language}; supply explicit extensions`); return value; });
  const extensions = profile.extensions || (derived.length ? derived : [".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".xml"]);
  if (!extensions.length) throw new Error("Search profile requires at least one extension");
  return { languages: languages.map(String), extensions: [...new Set(extensions.map(extension => { const value=String(extension).replace(/^\*/, "").toLowerCase(); if (!/^\.?[a-z0-9]+$/.test(value)) throw new Error(`Invalid search extension: ${extension}`); return value.startsWith(".") ? value : `.${value}`; }))] };
}
module.exports = { normalizeSearchProfile };
