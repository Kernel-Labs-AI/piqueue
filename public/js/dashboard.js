(function () {
  const SCROLL_KEY = "__outputScrollState";
  const DETAILS_TOOL_SELECTOR = "details[data-tool-id][open]";

  const getState = () => {
    if (!window[SCROLL_KEY]) {
      window[SCROLL_KEY] = {};
    }
    return window[SCROLL_KEY];
  };

  const getOutputContainer = (target) => {
    if (!(target instanceof Element)) return null;
    if (target.matches("[data-follow-output]")) return target;
    return target.querySelector?.("[data-follow-output]");
  };

  const getOpenToolIds = (root) => {
    const details = root.querySelectorAll(DETAILS_TOOL_SELECTOR);
    const toolIds = [];
    for (let i = 0; i < details.length; i++) {
      const detail = details[i];
      const toolId = detail.getAttribute("data-tool-id");
      if (toolId) {
        toolIds.push(toolId);
      }
    }
    return toolIds;
  };

  const reopenTools = (root, openToolIds) => {
    if (!openToolIds || openToolIds.length === 0) {
      return;
    }
    const details = root.querySelectorAll(DETAILS_TOOL_SELECTOR.replace("[open]", ""));
    for (let i = 0; i < openToolIds.length; i++) {
      const toolId = openToolIds[i];
      for (let j = 0; j < details.length; j++) {
        const detail = details[j];
        if (detail.getAttribute("data-tool-id") === toolId && detail instanceof HTMLDetailsElement) {
          detail.open = true;
          break;
        }
      }
    }
  };

  document.addEventListener("htmx:beforeSwap", (evt) => {
    const target = evt.detail.target;
    if (!(target instanceof HTMLElement)) return;
    const outputContainer = getOutputContainer(target);
    if (!(outputContainer instanceof HTMLElement)) return;

    const state = getState();
    const scrollTop = outputContainer.scrollTop;
    const atBottom = outputContainer.scrollHeight - outputContainer.scrollTop - outputContainer.clientHeight < 8;
    const openToolIds = getOpenToolIds(outputContainer);
    state[outputContainer.id || target.id || "task-output"] = {
      atBottom,
      scrollTop,
      openToolIds,
    };
  });

  document.addEventListener("htmx:afterSwap", (evt) => {
    const target = evt.detail.target;
    if (!(target instanceof HTMLElement)) return;
    const outputContainer = getOutputContainer(target);
    if (!(outputContainer instanceof HTMLElement)) return;

    const state = getState();
    const key = outputContainer.id || target.id || "task-output";
    const currentOutputContainer = document.getElementById(key) || outputContainer;
    const prev = state[key];
    if (!prev) return;

    if (prev.atBottom) {
      currentOutputContainer.scrollTop = currentOutputContainer.scrollHeight;
    } else {
      currentOutputContainer.scrollTop = prev.scrollTop;
    }

    reopenTools(currentOutputContainer, prev.openToolIds);
  });
})();
