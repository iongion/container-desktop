// Eleventy config for the container-desktop.com website.
// Sources live in website-src/ and compile into website/ (committed + published
// to GitHub Pages). Keep this minimal — markdown content + Nunjucks layouts,
// near-zero client JS, build-time version injection from package.json.
export default function (eleventyConfig) {
  // Static assets copied verbatim to the published site root and /assets.
  // (favicons, CNAME, webmanifest, browserconfig, img/, videos/ -> site root)
  eleventyConfig.addPassthroughCopy({ "website-src/static": "." });
  eleventyConfig.addPassthroughCopy({ "website-src/assets": "assets" });

  // Demo replayer, version-locked to the recorder (@rrweb/record): serve the installed rrweb build
  // instead of a floating "current" CDN channel (which mis-applied the 2.0.1 mutation format and made
  // the replay accumulate/duplicate DOM). Renamed to .js so GitHub Pages serves it as JS under nosniff.
  eleventyConfig.addPassthroughCopy({ "node_modules/rrweb/dist/rrweb.umd.min.cjs": "vendor/rrweb/rrweb.umd.min.js" });
  eleventyConfig.addPassthroughCopy({ "node_modules/rrweb/dist/style.min.css": "vendor/rrweb/rrweb.css" });

  // The OS setup guides, authored as markdown in website-src/manual/*.md.
  // Ordered by their `order` front-matter so the Manual sidebar is stable.
  eleventyConfig.addCollection("guides", (api) =>
    api.getFilteredByGlob("website-src/manual/*.md").sort((a, b) => (a.data.order || 0) - (b.data.order || 0)),
  );

  return {
    dir: { input: "website-src", output: "website", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
}
