let source = null;
let currentProjectId = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function activePage() {
  return document.querySelector(".nav-button.active")?.dataset?.page || null;
}

function relevantPage(event) {
  const type = String(event?.type || "");
  if (type.startsWith("ticket.")) return "tickets";
  if (type.startsWith("chat.")) return "chat";
  if (type.startsWith("job.")) return "jobs";
  return null;
}

function setConnectionState(state) {
  const node = document.getElementById("connectionState");
  if (!node) return;
  node.dataset.state = state;
  const text = node.querySelector("span:last-child");
  if (text) {
    text.textContent = state === "connected"
      ? (document.documentElement.lang === "ar" ? "متصل" : "Connected")
      : (document.documentElement.lang === "ar" ? "جارٍ إعادة الاتصال…" : "Reconnecting…");
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempt += 1;
  const delay = Math.min(15_000, 1000 * (2 ** Math.min(reconnectAttempt - 1, 4)));
  reconnectTimer = setTimeout(() => connect(currentProjectId), delay);
}

function refreshActivePage(event) {
  const target = relevantPage(event);
  if (!target || activePage() !== target) return;

  // Use the page's existing renderer/navigation handler rather than reloading
  // the whole browser document, preserving session/theme/language state.
  const button = document.querySelector(`.nav-button[data-page="${target}"]`);
  button?.click();
}

function connect(projectId) {
  if (!projectId || projectId === currentProjectId && source?.readyState === EventSource.OPEN) return;
  currentProjectId = projectId;
  clearTimeout(reconnectTimer);
  source?.close();

  setConnectionState("reconnecting");
  source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`, {
    withCredentials: true,
  });

  source.addEventListener("connected", () => {
    reconnectAttempt = 0;
    setConnectionState("connected");
  });

  source.addEventListener("project-change", (message) => {
    try {
      refreshActivePage(JSON.parse(message.data));
    } catch {
      // Ignore malformed event payloads; the SSE connection remains alive.
    }
  });

  source.onerror = () => {
    setConnectionState("reconnecting");
    source?.close();
    scheduleReconnect();
  };
}

async function resolveCurrentProject() {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) return null;
    const payload = await response.json();
    const selector = document.getElementById("projectSelector");
    if (selector?.value) return selector.value;
    return payload.projects?.find((project) => project.isDefault)?.id || payload.projects?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function boot() {
  const projectId = await resolveCurrentProject();
  if (projectId) connect(projectId);

  document.getElementById("projectSelector")?.addEventListener("change", (event) => {
    connect(event.target.value);
  });

  // Login is handled by the main app. Watch for the shell becoming visible so
  // a freshly authenticated session receives realtime events without reload.
  const shell = document.getElementById("appShell");
  if (shell) {
    const observer = new MutationObserver(async () => {
      if (shell.classList.contains("hidden")) {
        source?.close();
        setConnectionState("reconnecting");
        return;
      }
      const active = await resolveCurrentProject();
      if (active) connect(active);
    });
    observer.observe(shell, { attributes: true, attributeFilter: ["class"] });
  }
}

window.addEventListener("beforeunload", () => {
  clearTimeout(reconnectTimer);
  source?.close();
});

boot();
