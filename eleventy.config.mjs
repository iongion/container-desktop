// Eleventy config for the container-desktop.com website.
// Sources live in website-src/ and compile into website/ (committed + published
// to GitHub Pages). Keep this minimal — markdown content + Nunjucks layouts,
// near-zero client JS, build-time version injection from package.json.
export default function (eleventyConfig) {
  // Static assets copied verbatim to the published site root and /assets.
  // (favicons, CNAME, webmanifest, browserconfig, img/, videos/ -> site root)
  eleventyConfig.addPassthroughCopy({ "website-src/static": "." });
  eleventyConfig.addPassthroughCopy({ "website-src/assets": "assets" });

  // The OS setup guides, authored as markdown in website-src/manual/*.md.
  // Ordered by their `order` front-matter so the Manual sidebar is stable.
  eleventyConfig.addCollection("guides", (api) =>
    api.getFilteredByGlob("website-src/manual/*.md").sort((a, b) => (a.data.order || 0) - (b.data.order || 0)),
  );

  // ISO-8601 date helper — used by sitemap.njk for per-URL <lastmod> timestamps.
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString());

  return {
    dir: { input: "website-src", output: "website", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
}
