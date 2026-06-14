// Manual sidebar scroll-spy + click highlight. No-op on pages without a sidebar.
// Click sets the active link immediately (covers the last item, which can't
// scroll high enough to trip the scroll position check); a short lock keeps the
// smooth-scroll from overriding the choice. Vanilla, no dependencies.
(() => {
  var links = Array.prototype.slice.call(document.querySelectorAll(".side a"));
  if (!links.length) return;
  var map = {};
  var ids = [];
  links.forEach((l) => {
    var id = l.getAttribute("href").slice(1);
    map[id] = l;
    ids.push(id);
  });
  var sections = ids.map((id) => document.getElementById(id)).filter(Boolean);
  var clickLock = 0;
  function setActive(id) {
    links.forEach((x) => {
      x.classList.remove("active");
    });
    if (map[id]) map[id].classList.add("active");
  }
  function onScroll() {
    if (Date.now() - clickLock < 800) return;
    var offset = 110;
    var current = sections.length ? sections[0].id : null;
    var i;
    for (i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top - offset <= 0) current = sections[i].id;
      else break;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
      current = sections[sections.length - 1].id;
    if (current) setActive(current);
  }
  links.forEach((l) => {
    l.addEventListener("click", () => {
      setActive(l.getAttribute("href").slice(1));
      clickLock = Date.now();
    });
  });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
})();
