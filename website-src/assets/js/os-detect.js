// Highlights the visitor's OS download card + updates the hero button.
// No-op on pages without download cards. Vanilla, ~20 lines, no dependencies.
(() => {
  var ua = `${navigator.userAgent} ${navigator.platform || ""}`;
  var os = /Win/i.test(ua) ? "Windows" : /Mac|iPhone|iPad/i.test(ua) ? "macOS" : "Linux";
  var currentCard;
  var primary;
  var t;
  document.querySelectorAll(".dlc").forEach((c) => {
    var cur = c.getAttribute("data-os") === os;
    c.classList.toggle("cur", cur);
    if (cur) currentCard = c;
    var tag = c.querySelector(".tag");
    if (cur && !tag) {
      t = document.createElement("div");
      t.className = "tag";
      t.textContent = "DETECTED";
      c.insertBefore(t, c.firstChild);
    } else if (!cur && tag) {
      tag.remove();
    }
  });
  var hb = document.getElementById("heroDownload");
  if (hb) {
    hb.textContent = `⬇ Download for ${os}`;
    primary = currentCard?.querySelector(".get");
    if (primary) hb.setAttribute("href", primary.getAttribute("href"));
  }
})();
