// Highlights the visitor's OS download card, picks the best Linux package when
// possible, and keeps the custom package menu in sync.
(() => {
  var ua = `${navigator.userAgent} ${navigator.platform || ""}`;
  var os = detectOs(ua);
  var arch = detectArch(ua);
  var linuxFormat = detectLinuxFormat(ua);
  var cards = document.querySelectorAll(".dlc");
  var currentCard;
  var hb;
  var i;
  var menu;
  var menus;
  var optionIndex;
  var options;
  var primary;
  var trigger;

  function detectOs(value) {
    if (/Win/i.test(value)) return "Windows";
    if (/Mac|iPhone|iPad/i.test(value)) return "macOS";
    return "Linux";
  }

  function detectArch(value) {
    if (/aarch64|arm64|arm.*64/i.test(value)) return "arm64";
    return "x64";
  }

  function detectLinuxFormat(value) {
    if (/fedora|red hat|rhel|centos|rocky|alma|suse|opensuse/i.test(value)) return "rpm";
    return "deb";
  }

  function primaryPackageOption(card) {
    return card?.querySelector('.dl-menu-option[data-primary="true"]');
  }

  function findPackageOption(packageMenu, format, packageArch) {
    var option;
    var optionIndex;
    var options;
    options = packageMenu.querySelectorAll(".dl-menu-option");
    for (optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      option = options[optionIndex];
      if (option.dataset.format === format && option.dataset.arch === packageArch) return option;
    }
    return undefined;
  }

  function setMenuOpen(packageMenu, open) {
    var trigger;
    if (!packageMenu) return;
    trigger = packageMenu.querySelector(".dl-menu-trigger");
    packageMenu.setAttribute("data-open", open ? "true" : "false");
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeMenus(except) {
    var menu;
    var menuIndex;
    for (menuIndex = 0; menuIndex < menus.length; menuIndex += 1) {
      menu = menus[menuIndex];
      if (menu !== except) setMenuOpen(menu, false);
    }
  }

  function setDetectedPackageOption(option) {
    var menu;
    var optionIndex;
    var options;
    if (!option) return;
    menu = option.closest(".dl-package-menu");
    options = menu.querySelectorAll(".dl-menu-option");
    for (optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      options[optionIndex].setAttribute("data-primary", options[optionIndex] === option ? "true" : "false");
    }
    updateCardDownload(option.closest(".dlc"));
  }

  function updateCardDownload(card) {
    var button;
    var fmt;
    var label;
    var selected;
    if (!card) return;
    selected = primaryPackageOption(card);
    if (!selected) return;
    button = card.querySelector(".get");
    if (button && selected.href) {
      button.setAttribute("href", selected.href);
      label = button.querySelector(".get-label");
      if (label) label.textContent = selected.dataset.label || selected.dataset.text;
    }
    fmt = card.querySelector(".fmt");
    if (fmt && selected.dataset.note) fmt.innerHTML = selected.dataset.note;
  }

  function updateAllCards() {
    var i;
    for (i = 0; i < cards.length; i += 1) {
      updateCardDownload(cards[i]);
    }
  }

  function chooseDetectedPackage() {
    var packageMenu;
    var selected;
    if (os !== "Linux") return;
    packageMenu = currentCard?.querySelector(".dl-package-menu");
    if (!packageMenu) return;
    selected =
      findPackageOption(packageMenu, linuxFormat, arch) ||
      findPackageOption(packageMenu, "deb", arch) ||
      findPackageOption(packageMenu, linuxFormat, "x64") ||
      findPackageOption(packageMenu, "deb", "x64");
    setDetectedPackageOption(selected);
  }

  function markDetectedCard() {
    var c;
    var cur;
    var i;
    var tag;
    var t;
    currentCard = undefined;
    for (i = 0; i < cards.length; i += 1) {
      c = cards[i];
      cur = c.getAttribute("data-os") === os;
      c.classList.toggle("cur", cur);
      if (cur) currentCard = c;
      tag = c.querySelector(".tag");
      if (cur && !tag) {
        t = document.createElement("div");
        t.className = "tag";
        t.textContent = "DETECTED";
        c.insertBefore(t, c.firstChild);
      } else if (!cur && tag) {
        tag.remove();
      }
    }
  }

  function syncHeroDownload() {
    if (!hb) return;
    hb.textContent = `⬇ Download for ${os}`;
    primary = currentCard?.querySelector(".get");
    if (primary) hb.setAttribute("href", primary.getAttribute("href"));
  }

  function applyDetection() {
    markDetectedCard();
    chooseDetectedPackage();
    updateAllCards();
    syncHeroDownload();
  }

  function focusOption(packageMenu, direction) {
    var activeIndex;
    var nextIndex;
    var optionIndex;
    var options;
    options = packageMenu.querySelectorAll(".dl-menu-option");
    activeIndex = 0;
    for (optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      if (options[optionIndex] === document.activeElement) activeIndex = optionIndex;
    }
    nextIndex = (activeIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
  }

  function onTriggerClick(event) {
    var isOpen;
    var packageMenu;
    event.stopPropagation();
    packageMenu = event.currentTarget.closest(".dl-package-menu");
    isOpen = packageMenu.getAttribute("data-open") === "true";
    closeMenus(packageMenu);
    setMenuOpen(packageMenu, !isOpen);
  }

  function onMenuKeydown(event) {
    var packageMenu;
    packageMenu = event.currentTarget.closest(".dl-package-menu");
    if (event.key === "Escape") {
      setMenuOpen(packageMenu, false);
      packageMenu.querySelector(".dl-menu-trigger")?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(packageMenu, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(packageMenu, -1);
    }
  }

  function onDocumentClick(event) {
    if (!event.target.closest(".dl-package-menu")) closeMenus();
  }

  function refineDetection(hints) {
    ua = `${ua} ${hints.platform || ""} ${hints.architecture || ""} ${hints.bitness || ""}`;
    os = detectOs(ua);
    arch = detectArch(ua);
    linuxFormat = detectLinuxFormat(ua);
    applyDetection();
  }

  // Manual page only: land the visitor on their detected OS section, unless they deep-linked to a
  // specific anchor. The guide-os headers are id="windows|macos|linux" — exactly detectOs() lowercased
  // — and their CSS scroll-margin-top clears the sticky header. No-op on pages without those sections.
  function scrollToDetectedGuide() {
    if (location.hash) return;
    var section = document.getElementById(os.toLowerCase());
    if (section && section.classList.contains("guide-os")) {
      section.scrollIntoView({ behavior: "auto" });
    }
  }

  hb = document.getElementById("heroDownload");
  menus = document.querySelectorAll(".dl-package-menu");
  for (i = 0; i < menus.length; i += 1) {
    menu = menus[i];
    trigger = menu.querySelector(".dl-menu-trigger");
    options = menu.querySelectorAll(".dl-menu-option");
    if (trigger) trigger.addEventListener("click", onTriggerClick);
    trigger?.addEventListener("keydown", onMenuKeydown);
    // Menu items are direct download links. Do not attach click handlers that
    // turn the matrix into a secondary selector for the primary button.
    for (optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      options[optionIndex].addEventListener("keydown", onMenuKeydown);
    }
  }
  document.addEventListener("click", onDocumentClick);
  applyDetection();
  scrollToDetectedGuide();
  if (navigator.userAgentData?.getHighEntropyValues) {
    navigator.userAgentData
      .getHighEntropyValues(["platform", "architecture", "bitness"])
      .then(refineDetection)
      .catch(() => undefined);
  }
})();
