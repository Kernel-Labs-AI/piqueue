(function () {
  var root = document.getElementById("webhook-page");
  if (!root) {
    return;
  }

  var secret = root.dataset.secret || "";
  var masked = root.dataset.masked || "";
  var url = root.dataset.url || `${location.origin}/api/tasks`;

  var webhookUrlElement = document.getElementById("webhook-url");
  if (webhookUrlElement) {
    webhookUrlElement.textContent = url;
  }

  var curlLines = [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    "  -d '{\"title\": \"Test task\", \"prompt\": \"Say hello\"}'",
  ];

  var webhookCurlElement = document.getElementById("webhook-curl");
  if (webhookCurlElement) {
    webhookCurlElement.textContent = curlLines.join("\n");
  }

  var revealBtn = document.getElementById("reveal-btn");
  var secretDisplay = document.getElementById("webhook-secret-display");
  if (revealBtn && secretDisplay) {
    revealBtn.addEventListener("click", function () {
      if (revealBtn.textContent === "reveal") {
        secretDisplay.textContent = secret;
        revealBtn.textContent = "hide";
      } else {
        secretDisplay.textContent = masked;
        revealBtn.textContent = "reveal";
      }
    });
  }

  var testForm = document.getElementById("webhook-test-form");
  var testStatus = document.getElementById("webhook-test-status");
  var testBtn = document.getElementById("webhook-test-btn");
  var testTitle = document.getElementById("webhook-test-title");
  var testPrompt = document.getElementById("webhook-test-prompt");

  if (testForm && testStatus && testBtn && testTitle && testPrompt) {
    testForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var payload = {
        title: String(testTitle.value || "").trim(),
        prompt: String(testPrompt.value || "").trim(),
      };

      if (!payload.title || !payload.prompt) {
        testStatus.textContent = "Please fill out both title and prompt.";
        testStatus.classList.remove("webhook-status-success");
        testStatus.classList.add("webhook-status-error");
        return;
      }

      var prevText = testBtn.textContent || "";
      testBtn.disabled = true;
      testBtn.textContent = "Sending...";
      testStatus.textContent = "Sending test task...";
      testStatus.classList.remove("webhook-status-error", "webhook-status-success");

      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + secret,
        },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          return response
            .json()
            .then(function (parsed) {
              return { response: response, body: parsed };
            })
            .catch(function () {
              return { response: response, body: null };
            });
        })
        .then(function (result) {
          if (!result.response.ok) {
            var message = (result.body && result.body.error) || ("Request failed with status " + result.response.status);
            testStatus.textContent = message;
            testStatus.classList.add("webhook-status-error");
            return;
          }

          if (!result.body || !result.body.id) {
            testStatus.textContent = "Task submitted but no ID was returned.";
            testStatus.classList.add("webhook-status-error");
            return;
          }

          var taskLink = document.createElement("a");
          taskLink.href = "/tasks/" + result.body.id;
          taskLink.textContent = result.body.id;
          testStatus.textContent = "Test task queued successfully with ID: ";
          testStatus.appendChild(taskLink);
          testStatus.classList.add("webhook-status-success");
        })
        .catch(function () {
          testStatus.textContent = "Network error while sending test task.";
          testStatus.classList.add("webhook-status-error");
        })
        .finally(function () {
          testBtn.disabled = false;
          testBtn.textContent = prevText;
        });
    });
  }

  root.addEventListener("click", function (event) {
    var button = event.target.closest("[data-copy]");
    if (!button) return;

    var key = button.dataset.copy;
    var content;
    if (key === "secret") {
      content = secret;
    } else {
      var el = document.getElementById(key);
      if (!el) return;
      content = el.textContent || "";
    }

    var doCopy = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(content);
        } else {
          throw new Error("clipboard-fallback");
        }
      } catch {
        var ta = document.createElement("textarea");
        ta.value = content;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    };

    doCopy()
      .then(() => {
        button.textContent = "Copied!";
        button.classList.add("btn-copy-success");
        setTimeout(function () {
          button.textContent = "Copy";
          button.classList.remove("btn-copy-success");
        }, 1500);
      })
      .catch(() => {
        button.textContent = "Failed";
        setTimeout(function () {
          button.textContent = "Copy";
        }, 1500);
      });
  });
})();
