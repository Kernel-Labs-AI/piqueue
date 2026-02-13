(function () {
  var hljsReady = false;
  var domReady = false;
  var attempts = 0;
  var maxAttempts = 120;
  var initialApplied = false;

  function safeLanguage(block) {
    if (!block) return "";
    var lang = block.getAttribute("data-lang");
    if (!lang) return "";
    return lang.trim().toLowerCase();
  }

  function markAndHighlight(block) {
    if (!block || !window.hljs || !window.hljs.highlightElement) return;
    if (block.classList.contains("hljs")) return;

    var lang = safeLanguage(block);
    if (lang) {
      block.classList.add("language-" + lang);
    }

    try {
      window.hljs.highlightElement(block);
    } catch (_error) {
      // Ignore highlight failures for unknown languages.
    }
  }

  function applyToCodeBlocks(root) {
    if (!root || !window.hljs || !window.hljs.highlightElement) return;

    var blocks = root.querySelectorAll(".output-item-body-md .md-code code");
    for (var i = 0; i < blocks.length; i++) {
      markAndHighlight(blocks[i]);
    }
  }

  function tryInitialApply() {
    if (initialApplied) return;
    if (!hljsReady || !domReady) return;

    initialApplied = true;
    applyToCodeBlocks(document);
  }

  function markDomReady() {
    if (domReady) return;
    domReady = true;
    tryInitialApply();
  }

  function initHighlighting() {
    attempts++;
    if (!window.hljs || !window.hljs.highlightElement) {
      if (attempts < maxAttempts) {
        setTimeout(initHighlighting, 50);
      }
      return;
    }

    hljsReady = true;
    tryInitialApply();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        markDomReady();
      },
      { once: true }
    );
  } else {
    markDomReady();
  }

  initHighlighting();

  function handleSwap() {
    if (!hljsReady || !window.hljs || !window.hljs.highlightElement) return;
    applyToCodeBlocks(document);
  }

  function handleDetailsToggle(event) {
    var target = event && event.target;
    if (!target || !target.matches || !target.matches("details.output-item-tool[open]")) return;
    if (!hljsReady || !window.hljs || !window.hljs.highlightElement) return;

    applyToCodeBlocks(target);
  }

  document.addEventListener("htmx:afterSwap", handleSwap);
  document.addEventListener("htmx:oobAfterSwap", handleSwap);
  document.addEventListener("toggle", handleDetailsToggle, true);
  window.addEventListener("load", function () {
    if (!hljsReady || !window.hljs || !window.hljs.highlightElement) return;
    applyToCodeBlocks(document);
  });
})();
