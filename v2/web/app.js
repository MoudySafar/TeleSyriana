import { translate } from "./i18n.js";

const CAP = Object.freeze({
  PROJECTS_MANAGE: "projects.manage",
  EMPLOYEES_VIEW: "employees.view",
  EMPLOYEES_CREATE: "employees.create",
  EMPLOYEES_CHANGE_ROLE: "employees.change_role",
  EMPLOYEES_ASSIGN_PROJECT: "employees.assign_project",
  TEAMS_VIEW: "teams.view",
  TEAMS_CREATE: "teams.create",
  TEAMS_MANAGE_OWN: "teams.manage_own",
  TEAMS_MANAGE_PROJECT: "teams.manage_project",
  ORDERS_SEARCH: "orders.search",
  TICKETS_CREATE: "tickets.create",
  TICKETS_VIEW_OWN: "tickets.view_own",
  TICKETS_VIEW_TEAM: "tickets.view_team",
  TICKETS_VIEW_PROJECT: "tickets.view_project",
  TICKETS_SEARCH: "tickets.search",
  CHAT_READ: "chat.read",
  JOBS_CREATE: "jobs.create",
  JOBS_MANAGE: "jobs.manage",
  JOBS_APPLY: "jobs.apply",
  JOBS_REFER: "jobs.refer",
  INTEGRATIONS_MANAGE: "integrations.manage",
});

const state = {
  me: null,
  projects: [],
  projectId: null,
  workspace: null,
  locale: localStorage.getItem("ts_locale") || "en",
  theme: localStorage.getItem("ts_theme") || "system",
  page: "dashboard",
  ticketMode: "queue",
  activeChannelId: null,
};

const els = {
  loginView: document.getElementById("loginView"),
  loginForm: document.getElementById("loginForm"),
  loginStaffCode: document.getElementById("loginStaffCode"),
  loginSecret: document.getElementById("loginSecret"),
  loginButton: document.getElementById("loginButton"),
  loginError: document.getElementById("loginError"),
  appShell: document.getElementById("appShell"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  navigation: document.getElementById("navigation"),
  workspaceName: document.getElementById("workspaceName"),
  workspaceRole: document.getElementById("workspaceRole"),
  projectSelectorWrap: document.getElementById("projectSelectorWrap"),
  projectSelector: document.getElementById("projectSelector"),
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  pageContent: document.getElementById("pageContent"),
  themeSelector: document.getElementById("themeSelector"),
  userInitials: document.getElementById("userInitials"),
  userName: document.getElementById("userName"),
  userRole: document.getElementById("userRole"),
  logoutButton: document.getElementById("logoutButton"),
  toastRegion: document.getElementById("toastRegion"),
  modalRoot: document.getElementById("modalRoot"),
};

function t(key) {
  return translate(state.locale, key);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat(state.locale === "ar" ? "ar" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function initials(name) {
  return String(name || "TS")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "TS";
}

function has(capability) {
  return Boolean(state.workspace?.capabilities?.[capability]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.code;
    if (response.status === 401) {
      showLogin();
      toast(t("toast.sessionExpired"), "error");
    }
    throw error;
  }
  return body;
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  els.toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function modal({ title, body, onReady }) {
  els.modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="icon-button" type="button" data-close-modal>×</button>
        </div>
        ${body}
      </section>
    </div>`;
  const close = () => { els.modalRoot.innerHTML = ""; };
  els.modalRoot.querySelector("[data-close-modal]").addEventListener("click", close);
  els.modalRoot.querySelector("[data-modal-backdrop]").addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-backdrop]")) close();
  });
  onReady?.({ root: els.modalRoot, close });
}

function applyLocale(locale, { persistCloud = false } = {}) {
  state.locale = locale === "ar" ? "ar" : "en";
  localStorage.setItem("ts_locale", state.locale);
  document.documentElement.lang = state.locale;
  document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".locale-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.locale === state.locale);
  });
  if (persistCloud && state.me) savePreferences().catch((error) => toast(error.message, "error"));
  if (state.me && state.workspace) renderCurrentPage();
}

function effectiveTheme(theme) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, { persistCloud = false } = {}) {
  state.theme = ["light", "dark", "system"].includes(theme) ? theme : "system";
  localStorage.setItem("ts_theme", state.theme);
  document.documentElement.dataset.theme = effectiveTheme(state.theme);
  els.themeSelector.value = state.theme;
  if (persistCloud && state.me) savePreferences().catch((error) => toast(error.message, "error"));
}

async function savePreferences() {
  const result = await api("/api/profile/preferences", {
    method: "PATCH",
    body: JSON.stringify({ locale: state.locale, theme: state.theme }),
  });
  state.me = { ...state.me, ...result.user };
}

function showLogin() {
  state.me = null;
  state.workspace = null;
  els.appShell.classList.add("hidden");
  els.loginView.classList.remove("hidden");
  els.loginSecret.value = "";
}

function showApp() {
  els.loginView.classList.add("hidden");
  els.appShell.classList.remove("hidden");
}

async function hydrateSession(mePayload = null) {
  const payload = mePayload || await api("/api/me");
  state.me = payload.user;
  state.projects = payload.projects || [];
  state.locale = state.me.locale || state.locale;
  state.theme = state.me.theme || state.theme;
  applyLocale(state.locale);
  applyTheme(state.theme);

  const defaultProject = state.projects.find((project) => project.isDefault) || state.projects[0];
  state.projectId = defaultProject?.id || null;
  if (!state.projectId) throw new Error("No active project is available for this account.");

  els.userName.textContent = state.me.displayName;
  els.userInitials.textContent = initials(state.me.displayName);
  els.userRole.textContent = state.me.platformRole;

  const canViewAll = Boolean(payload.canViewAllProjects);
  els.projectSelectorWrap.classList.toggle("hidden", !canViewAll);
  if (canViewAll) {
    els.projectSelector.innerHTML = state.projects
      .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`)
      .join("");
    els.projectSelector.value = state.projectId;
  }

  showApp();
  await loadWorkspace(state.projectId);
}

async function loadWorkspace(projectId) {
  state.projectId = projectId;
  const payload = await api(`/api/projects/${encodeURIComponent(projectId)}/context`);
  state.workspace = payload;
  els.workspaceName.textContent = payload.project.name;
  els.workspaceRole.textContent = payload.membership?.role || payload.platformRole;
  els.userRole.textContent = payload.membership?.role || payload.platformRole;
  if (!els.projectSelectorWrap.classList.contains("hidden")) els.projectSelector.value = projectId;
  renderNavigation();
  if (!pageAllowed(state.page)) state.page = "dashboard";
  await renderCurrentPage();
}

function navigationItems() {
  const items = [
    { page: "dashboard", label: "nav.dashboard", icon: "⌂", group: "main", allowed: true },
    { page: "tickets", label: "nav.tickets", icon: "▤", group: "main", allowed: has(CAP.TICKETS_SEARCH) },
    { page: "orders", label: "nav.orders", icon: "◫", group: "main", allowed: has(CAP.ORDERS_SEARCH) },
    { page: "chat", label: "nav.chat", icon: "◌", group: "main", allowed: has(CAP.CHAT_READ) },
    { page: "jobs", label: "nav.jobs", icon: "◇", group: "main", allowed: has(CAP.JOBS_APPLY) || has(CAP.JOBS_MANAGE) },
    { page: "employees", label: "nav.employees", icon: "♙", group: "workforce", allowed: has(CAP.EMPLOYEES_VIEW) },
    { page: "teams", label: "nav.teams", icon: "♧", group: "workforce", allowed: has(CAP.TEAMS_VIEW) },
    { page: "integrations", label: "nav.integrations", icon: "⚙", group: "management", allowed: has(CAP.INTEGRATIONS_MANAGE) },
    { page: "projects", label: "nav.projects", icon: "▦", group: "management", allowed: has(CAP.PROJECTS_MANAGE) },
  ];
  return items.filter((item) => item.allowed);
}

function pageAllowed(page) {
  return navigationItems().some((item) => item.page === page);
}

function renderNavigation() {
  const items = navigationItems();
  const groups = [
    ["main", null],
    ["workforce", "nav.workforce"],
    ["management", "nav.management"],
  ];
  els.navigation.innerHTML = groups.map(([group, title]) => {
    const groupItems = items.filter((item) => item.group === group);
    if (!groupItems.length) return "";
    return `
      ${title ? `<div class="nav-section-title">${escapeHtml(t(title))}</div>` : ""}
      ${groupItems.map((item) => `
        <button class="nav-button ${state.page === item.page ? "active" : ""}" type="button" data-page="${item.page}">
          <span class="nav-icon">${item.icon}</span>
          <span>${escapeHtml(t(item.label))}</span>
        </button>`).join("")}`;
  }).join("");

  els.navigation.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.page = button.dataset.page;
      els.sidebar.classList.remove("open");
      renderNavigation();
      await renderCurrentPage();
    });
  });
}

function setPageHeading(titleKey, subtitle = "") {
  els.pageTitle.textContent = t(titleKey);
  els.pageSubtitle.textContent = subtitle;
}

function loadingCard() {
  return `<div class="card"><div class="skeleton" style="width:40%;height:18px"></div><div class="skeleton" style="width:80%;height:14px;margin-top:12px"></div></div>`;
}

async function renderCurrentPage() {
  const renderers = {
    dashboard: renderDashboard,
    tickets: renderTickets,
    orders: renderOrders,
    chat: renderChat,
    jobs: renderJobs,
    employees: renderEmployees,
    teams: renderTeams,
    integrations: renderIntegrations,
    projects: renderProjects,
  };
  renderNavigation();
  els.pageContent.innerHTML = loadingCard();
  try {
    await (renderers[state.page] || renderDashboard)();
  } catch (error) {
    els.pageContent.innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
  }
}

async function renderDashboard() {
  setPageHeading("dashboard.title", `${t("dashboard.welcome")}, ${state.me.displayName}`);
  const requests = [];
  if (has(CAP.TICKETS_SEARCH)) {
    requests.push(api(`/api/projects/${state.projectId}/tickets?status=active&activity=all&limit=200`).then((x) => ["tickets", x.tickets.length]).catch(() => ["tickets", "—"]));
  }
  if (has(CAP.CHAT_READ)) {
    requests.push(api(`/api/projects/${state.projectId}/chat/channels`).then((x) => ["chat", x.channels.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0)]).catch(() => ["chat", "—"]));
  }
  if (has(CAP.JOBS_APPLY) || has(CAP.JOBS_MANAGE)) {
    requests.push(api(`/api/projects/${state.projectId}/jobs?status=open&limit=200`).then((x) => ["jobs", x.jobs.length]).catch(() => ["jobs", "—"]));
  }
  const metrics = Object.fromEntries(await Promise.all(requests));
  const role = state.workspace.membership?.role || state.workspace.platformRole;
  els.pageContent.innerHTML = `
    <div class="grid cards-4">
      <div class="card metric-card"><span class="muted">${escapeHtml(t("dashboard.activeTickets"))}</span><div class="metric-value">${escapeHtml(metrics.tickets ?? "—")}</div></div>
      <div class="card metric-card"><span class="muted">${escapeHtml(t("dashboard.unreadChat"))}</span><div class="metric-value">${escapeHtml(metrics.chat ?? "—")}</div></div>
      <div class="card metric-card"><span class="muted">${escapeHtml(t("dashboard.openJobs"))}</span><div class="metric-value">${escapeHtml(metrics.jobs ?? "—")}</div></div>
      <div class="card metric-card"><span class="muted">${escapeHtml(t("dashboard.workspaceRole"))}</span><div class="metric-value" style="font-size:1.2rem">${escapeHtml(role)}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <strong>${escapeHtml(state.workspace.project.name)}</strong>
      <p class="muted">${escapeHtml(state.workspace.project.timezone || "")}</p>
      <div class="notice">${state.workspace.globalProjectViewer ? "Global project visibility is enabled for this account." : "Your workspace is isolated to the projects assigned to your account."}</div>
    </div>`;
}

function ticketListHtml(tickets) {
  if (!tickets.length) return `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`;
  return tickets.map((ticket) => `
    <button class="list-item" type="button" data-ticket-code="${escapeHtml(ticket.ticketCode)}">
      <div class="list-item-title">
        <span>${escapeHtml(ticket.ticketCode)}</span>
        <span class="badge ${ticket.priority === "emergency" ? "danger" : ticket.priority === "high" ? "warning" : ""}">${escapeHtml(ticket.priority || "normal")}</span>
      </div>
      <div class="list-item-meta">#${escapeHtml(ticket.orderNumber || "—")} · ${escapeHtml(ticket.status)} · ${formatDate(ticket.updatedAt)}</div>
    </button>`).join("");
}

async function renderTickets() {
  setPageHeading("tickets.title", t("tickets.searchMode"));
  els.pageContent.innerHTML = `
    <div class="toolbar">
      <form id="ticketSearchForm" class="search-field grow"><input id="ticketSearch" placeholder="${escapeHtml(t("tickets.searchPlaceholder"))}" /></form>
      <select id="ticketStatusFilter">
        <option value="active">${escapeHtml(t("tickets.status.active"))}</option>
        <option value="resolved">${escapeHtml(t("tickets.status.resolved"))}</option>
        <option value="all">${escapeHtml(t("tickets.status.all"))}</option>
      </select>
      <select id="ticketActivityFilter">
        <option value="all">${escapeHtml(t("tickets.activity.all"))}</option>
        <option value="today">${escapeHtml(t("tickets.activity.today"))}</option>
        <option value="yesterday">${escapeHtml(t("tickets.activity.yesterday"))}</option>
        <option value="last_7_days">${escapeHtml(t("tickets.activity.last7"))}</option>
        <option value="last_30_days">${escapeHtml(t("tickets.activity.last30"))}</option>
      </select>
      ${has(CAP.TICKETS_CREATE) ? `<button id="newTicketButton" class="primary-button" type="button">${escapeHtml(t("tickets.create"))}</button>` : ""}
    </div>
    <div class="split-view">
      <section id="ticketList" class="list-pane"><div class="empty-state">${escapeHtml(t("common.loading"))}</div></section>
      <section id="ticketDetail" class="detail-pane"><div class="empty-state">${escapeHtml(t("tickets.queue"))}</div></section>
    </div>`;

  const list = els.pageContent.querySelector("#ticketList");
  const status = els.pageContent.querySelector("#ticketStatusFilter");
  const activity = els.pageContent.querySelector("#ticketActivityFilter");
  const loadQueue = async () => {
    state.ticketMode = "queue";
    list.innerHTML = `<div class="empty-state">${escapeHtml(t("common.loading"))}</div>`;
    const payload = await api(`/api/projects/${state.projectId}/tickets?status=${encodeURIComponent(status.value)}&activity=${encodeURIComponent(activity.value)}&limit=200`);
    list.innerHTML = ticketListHtml(payload.tickets || []);
    bindTicketList();
  };
  const bindTicketList = () => {
    list.querySelectorAll("[data-ticket-code]").forEach((button) => {
      button.addEventListener("click", () => loadTicketDetail(button.dataset.ticketCode));
    });
  };

  els.pageContent.querySelector("#ticketSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.pageContent.querySelector("#ticketSearch").value.trim();
    if (!query) return loadQueue();
    state.ticketMode = "search";
    const payload = await api(`/api/projects/${state.projectId}/tickets/search?q=${encodeURIComponent(query)}&limit=100`);
    list.innerHTML = ticketListHtml(payload.tickets || []);
    bindTicketList();
  });
  status.addEventListener("change", loadQueue);
  activity.addEventListener("change", loadQueue);
  els.pageContent.querySelector("#newTicketButton")?.addEventListener("click", openCreateTicketModal);
  await loadQueue();
}

async function loadTicketDetail(ticketCode) {
  const detail = els.pageContent.querySelector("#ticketDetail");
  if (!detail) return;
  detail.innerHTML = `<div class="empty-state">${escapeHtml(t("common.loading"))}</div>`;
  const payload = await api(`/api/projects/${state.projectId}/tickets/${encodeURIComponent(ticketCode)}`);
  const ticket = payload.ticket;
  const comments = payload.comments || [];
  const history = payload.history || [];
  const foreignAgent = state.workspace.membership?.role === "agent" &&
    ticket.assignedToUserId !== state.me.id && ticket.createdByUserId !== state.me.id;
  detail.innerHTML = `
    <div class="detail-section">
      <div class="page-header">
        <div><h2>${escapeHtml(ticket.ticketCode)}</h2><p class="muted">#${escapeHtml(ticket.orderNumber || "—")}</p></div>
        <span class="badge primary">${escapeHtml(ticket.status)}</span>
      </div>
      ${foreignAgent ? `<div class="notice warning">${escapeHtml(t("tickets.readOnlyNotice"))}</div>` : ""}
      <div class="detail-grid" style="margin-top:15px">
        <div><span class="detail-label">${escapeHtml(t("tickets.customer"))}</span>${escapeHtml(ticket.customerName || "—")}</div>
        <div><span class="detail-label">${escapeHtml(t("tickets.email"))}</span>${escapeHtml(ticket.customerEmail || "—")}</div>
        <div><span class="detail-label">${escapeHtml(t("tickets.tracking"))}</span>${escapeHtml(ticket.trackingNumber || "—")}</div>
        <div><span class="detail-label">${escapeHtml(t("tickets.priority"))}</span>${escapeHtml(ticket.priority || "—")}</div>
        <div><span class="detail-label">${escapeHtml(t("tickets.type"))}</span>${escapeHtml(ticket.type || "—")}</div>
        <div><span class="detail-label">${escapeHtml(t("common.updated"))}</span>${formatDate(ticket.updatedAt)}</div>
      </div>
    </div>
    <div class="detail-section">
      <div class="actions-row">
        <strong>${escapeHtml(t("common.status"))}</strong>
        <select id="ticketStatusChange" ${foreignAgent ? "disabled" : ""}>
          ${["open","waiting_customer","waiting_courier","waiting_supplier","escalated","resolved","closed"].map((value) => `<option value="${value}" ${ticket.status === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(t("tickets.comments"))}</h3>
      <div id="ticketComments">${comments.length ? comments.map((comment) => `
        <div class="card" style="margin-top:8px">
          <div class="small-text muted">${escapeHtml(comment.authorName || comment.authorUserId || "") } · ${formatDate(comment.createdAt)}</div>
          <div style="margin-top:7px;white-space:pre-wrap">${comment.deleted ? "<em>Deleted</em>" : escapeHtml(comment.body)}</div>
        </div>`).join("") : `<p class="muted">${escapeHtml(t("common.noResults"))}</p>`}</div>
      ${foreignAgent ? "" : `<form id="ticketCommentForm" class="stack" style="margin-top:12px"><textarea id="ticketCommentBody" placeholder="${escapeHtml(t("tickets.commentPlaceholder"))}" required></textarea><button class="secondary-button" type="submit">${escapeHtml(t("tickets.addComment"))}</button></form>`}
    </div>
    <div class="detail-section">
      <h3>${escapeHtml(t("tickets.history"))}</h3>
      ${history.length ? history.map((item) => `<div class="list-item-meta" style="margin:8px 0">${formatDate(item.createdAt)} · ${escapeHtml(item.eventType || item.action || "activity")}</div>`).join("") : `<p class="muted">${escapeHtml(t("common.noResults"))}</p>`}
    </div>`;

  detail.querySelector("#ticketStatusChange")?.addEventListener("change", async (event) => {
    try {
      const result = await api(`/api/projects/${state.projectId}/tickets/${encodeURIComponent(ticket.ticketCode)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: event.target.value, expectedVersion: ticket.version }),
      });
      toast(t("toast.saved"));
      await loadTicketDetail(result.ticket.ticketCode);
    } catch (error) {
      toast(error.message, "error");
      await loadTicketDetail(ticket.ticketCode);
    }
  });
  detail.querySelector("#ticketCommentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = detail.querySelector("#ticketCommentBody").value;
    try {
      await api(`/api/projects/${state.projectId}/tickets/${encodeURIComponent(ticket.ticketCode)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await loadTicketDetail(ticket.ticketCode);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function openCreateTicketModal() {
  modal({
    title: t("tickets.create"),
    body: `
      <form id="createTicketForm" class="stack">
        <div class="modal-grid">
          <label>${escapeHtml(t("tickets.order"))}<input name="orderNumber" required /></label>
          <label>${escapeHtml(t("tickets.email"))}<input name="customerEmail" type="email" /></label>
          <label>${escapeHtml(t("tickets.tracking"))}<input name="trackingNumber" /></label>
          <label>${escapeHtml(t("tickets.type"))}<select name="type"><option value="general_question">general_question</option><option value="product_not_arrived">product_not_arrived</option><option value="return">return</option><option value="refund_request">refund_request</option><option value="chargeback_risk">chargeback_risk</option></select></label>
          <label>${escapeHtml(t("tickets.priority"))}<select name="priority"><option value="normal">normal</option><option value="medium">medium</option><option value="high">high</option><option value="emergency">emergency</option></select></label>
        </div>
        <label>Subject<input name="subject" /></label>
        <label>Internal summary<textarea name="internalSummary"></textarea></label>
        <button class="primary-button" type="submit">${escapeHtml(t("common.create"))}</button>
      </form>`,
    onReady: ({ root, close }) => {
      root.querySelector("#createTicketForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        try {
          await api(`/api/projects/${state.projectId}/tickets`, { method: "POST", body: JSON.stringify(data) });
          close();
          toast(t("toast.saved"));
          await renderTickets();
        } catch (error) { toast(error.message, "error"); }
      });
    },
  });
}

async function renderOrders() {
  setPageHeading("orders.title");
  els.pageContent.innerHTML = `
    <form id="orderSearchForm" class="toolbar">
      <div class="search-field grow"><input id="orderSearch" placeholder="${escapeHtml(t("orders.searchPlaceholder"))}" required /></div>
      <button class="primary-button" type="submit">${escapeHtml(t("orders.search"))}</button>
    </form>
    <div id="orderResults" class="grid"></div>`;
  els.pageContent.querySelector("#orderSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = els.pageContent.querySelector("#orderResults");
    output.innerHTML = loadingCard();
    try {
      const query = els.pageContent.querySelector("#orderSearch").value.trim();
      const payload = await api(`/api/projects/${state.projectId}/orders/search?q=${encodeURIComponent(query)}`);
      const orders = payload.orders || [];
      output.innerHTML = orders.length ? orders.map((item) => {
        const order = item.order || {};
        const customer = item.customer || {};
        return `<div class="card">
          <div class="page-header"><div><h2>${escapeHtml(order.number || "Order")}</h2><p class="muted">${escapeHtml(customer.name || customer.email || "")}</p></div><span class="badge primary">${escapeHtml(order.fulfillment_status || "—")}</span></div>
          <div class="detail-grid">
            <div><span class="detail-label">${escapeHtml(t("orders.payment"))}</span>${escapeHtml(order.payment_status || "—")}</div>
            <div><span class="detail-label">${escapeHtml(t("orders.total"))}</span>${escapeHtml(order.total_paid?.amount || "—")} ${escapeHtml(order.total_paid?.currency || "")}</div>
            <div><span class="detail-label">${escapeHtml(t("orders.items"))}</span>${escapeHtml((item.items || []).length)}</div>
            <div><span class="detail-label">${escapeHtml(t("orders.refunds"))}</span>${escapeHtml((item.refunds || []).length)}</div>
          </div>
        </div>`;
      }).join("") : `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`;
    } catch (error) { output.innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`; }
  });
}

async function renderChat() {
  setPageHeading("chat.title");
  const payload = await api(`/api/projects/${state.projectId}/chat/channels`);
  const channels = payload.channels || [];
  if (!state.activeChannelId || !channels.some((c) => c.id === state.activeChannelId)) state.activeChannelId = channels[0]?.id || null;
  els.pageContent.innerHTML = `
    <div class="chat-layout">
      <aside class="chat-channels">
        <strong>${escapeHtml(t("chat.channels"))}</strong>
        <div style="margin-top:10px">${channels.map((channel) => `<button class="channel-button ${channel.id === state.activeChannelId ? "active" : ""}" type="button" data-channel="${escapeHtml(channel.id)}"><span>${escapeHtml(channel.name)}</span>${channel.unreadCount ? `<span class="badge primary">${channel.unreadCount}</span>` : ""}</button>`).join("") || `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`}</div>
      </aside>
      <section class="chat-main">
        <div id="chatHeader" class="chat-header">${escapeHtml(channels.find((c) => c.id === state.activeChannelId)?.name || "")}</div>
        <div id="chatMessages" class="chat-messages"></div>
        <form id="chatComposer" class="chat-composer">
          <textarea id="chatBody" placeholder="${escapeHtml(t("chat.messagePlaceholder"))}" ${state.activeChannelId ? "" : "disabled"}></textarea>
          <button class="primary-button" type="submit" ${state.activeChannelId ? "" : "disabled"}>${escapeHtml(t("chat.send"))}</button>
        </form>
      </section>
    </div>`;
  const loadMessages = async () => {
    if (!state.activeChannelId) return;
    const result = await api(`/api/projects/${state.projectId}/chat/channels/${encodeURIComponent(state.activeChannelId)}/messages?limit=150`);
    const box = els.pageContent.querySelector("#chatMessages");
    box.innerHTML = (result.messages || []).map((message) => `
      <article class="message">
        <div class="message-head"><strong>${escapeHtml(message.authorName || "Employee")}</strong><span class="muted">${formatDate(message.createdAt)}${message.editedAt ? ` · ${escapeHtml(t("chat.edited"))}` : ""}</span></div>
        <div class="message-body">${message.deleted ? `<em>${escapeHtml(t("chat.deleted"))}</em>` : escapeHtml(message.body)}</div>
        ${message.deleted ? "" : `<div class="message-actions">
          ${["👍","❤️","😂","✅","👀"].map((emoji) => `<button class="reaction-button" type="button" data-react-message="${escapeHtml(message.id)}" data-emoji="${emoji}">${emoji} ${(message.reactions || []).filter((r) => r.emoji === emoji).length || ""}</button>`).join("")}
          ${message.authorUserId === state.me.id ? `<button class="reaction-button" type="button" data-delete-message="${escapeHtml(message.id)}">${escapeHtml(t("common.delete"))}</button>` : ""}
        </div>`}
      </article>`).join("") || `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`;
    box.scrollTop = box.scrollHeight;
    const last = result.messages?.at(-1);
    if (last) api(`/api/projects/${state.projectId}/chat/channels/${encodeURIComponent(state.activeChannelId)}/read`, { method: "POST", body: JSON.stringify({ messageId: last.id }) }).catch(() => {});
    box.querySelectorAll("[data-react-message]").forEach((button) => button.addEventListener("click", async () => {
      await api(`/api/projects/${state.projectId}/chat/messages/${encodeURIComponent(button.dataset.reactMessage)}/reactions`, { method: "POST", body: JSON.stringify({ emoji: button.dataset.emoji }) });
      await loadMessages();
    }));
    box.querySelectorAll("[data-delete-message]").forEach((button) => button.addEventListener("click", async () => {
      await api(`/api/projects/${state.projectId}/chat/messages/${encodeURIComponent(button.dataset.deleteMessage)}`, { method: "DELETE" });
      await loadMessages();
    }));
  };
  els.pageContent.querySelectorAll("[data-channel]").forEach((button) => button.addEventListener("click", async () => {
    state.activeChannelId = button.dataset.channel;
    await renderChat();
  }));
  const body = els.pageContent.querySelector("#chatBody");
  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.pageContent.querySelector("#chatComposer").requestSubmit();
    }
  });
  els.pageContent.querySelector("#chatComposer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const messageBody = body.value.trim();
    if (!messageBody || !state.activeChannelId) return;
    await api(`/api/projects/${state.projectId}/chat/channels/${encodeURIComponent(state.activeChannelId)}/messages`, { method: "POST", body: JSON.stringify({ body: messageBody }) });
    body.value = "";
    await loadMessages();
  });
  await loadMessages();
}

async function renderJobs() {
  setPageHeading("jobs.title", t("jobs.internal"));
  const payload = await api(`/api/projects/${state.projectId}/jobs?status=${has(CAP.JOBS_MANAGE) ? "all" : "open"}&limit=100`);
  const jobs = payload.jobs || [];
  els.pageContent.innerHTML = `
    <div class="page-header"><div><h2>${escapeHtml(t("jobs.internal"))}</h2></div>${has(CAP.JOBS_CREATE) ? `<button id="createJobButton" class="primary-button">${escapeHtml(t("jobs.create"))}</button>` : ""}</div>
    <div class="grid cards-2">${jobs.map((job) => `<article class="card">
      <div class="page-header"><div><h2>${escapeHtml(job.title)}</h2><p class="muted">${escapeHtml(job.department || state.workspace.project.name)}</p></div><span class="badge ${job.status === "open" ? "success" : ""}">${escapeHtml(job.status)}</span></div>
      <p>${escapeHtml(job.description)}</p>
      <div class="actions-row">
        ${job.status === "open" && has(CAP.JOBS_APPLY) ? `<button class="secondary-button" data-apply-job="${escapeHtml(job.id)}">${escapeHtml(t("common.apply"))}</button>` : ""}
        ${job.status === "open" && has(CAP.JOBS_REFER) ? `<button class="ghost-button" data-refer-job="${escapeHtml(job.id)}">${escapeHtml(t("common.refer"))}</button>` : ""}
        ${has(CAP.JOBS_MANAGE) ? `<button class="ghost-button" data-pipeline-job="${escapeHtml(job.id)}">${escapeHtml(t("jobs.pipeline"))}</button>` : ""}
      </div>
    </article>`).join("") || `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`}</div>`;
  els.pageContent.querySelector("#createJobButton")?.addEventListener("click", openCreateJobModal);
  els.pageContent.querySelectorAll("[data-apply-job]").forEach((button) => button.addEventListener("click", () => openApplyJobModal(button.dataset.applyJob)));
  els.pageContent.querySelectorAll("[data-refer-job]").forEach((button) => button.addEventListener("click", () => openReferJobModal(button.dataset.referJob)));
  els.pageContent.querySelectorAll("[data-pipeline-job]").forEach((button) => button.addEventListener("click", () => openPipeline(button.dataset.pipelineJob)));
}

function openCreateJobModal() {
  modal({
    title: t("jobs.create"),
    body: `<form id="jobForm" class="stack"><label>${escapeHtml(t("jobs.titleField"))}<input name="title" required /></label><label>${escapeHtml(t("jobs.department"))}<input name="department" /></label><label>${escapeHtml(t("jobs.description"))}<textarea name="description" required></textarea></label><label>${escapeHtml(t("jobs.requirements"))}<textarea name="requirements"></textarea></label><label>${escapeHtml(t("jobs.positions"))}<input name="positions" type="number" min="1" value="1" /></label><input type="hidden" name="status" value="open" /><button class="primary-button">${escapeHtml(t("common.create"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#jobForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      data.positions = Number(data.positions || 1);
      await api(`/api/projects/${state.projectId}/jobs`, { method: "POST", body: JSON.stringify(data) });
      close(); toast(t("toast.saved")); await renderJobs();
    }),
  });
}

function openApplyJobModal(jobId) {
  modal({
    title: t("common.apply"),
    body: `<form id="applyJobForm" class="stack"><label>${escapeHtml(t("jobs.message"))}<textarea name="message"></textarea></label><button class="primary-button">${escapeHtml(t("common.apply"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#applyJobForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { message } = Object.fromEntries(new FormData(event.currentTarget));
      await api(`/api/projects/${state.projectId}/jobs/${encodeURIComponent(jobId)}/apply`, { method: "POST", body: JSON.stringify({ message }) });
      close(); toast(t("toast.saved"));
    }),
  });
}

function openReferJobModal(jobId) {
  modal({
    title: t("jobs.referCandidate"),
    body: `<form id="referJobForm" class="stack"><label>${escapeHtml(t("jobs.candidateName"))}<input name="candidateName" required /></label><label>${escapeHtml(t("jobs.candidateEmail"))}<input name="candidateEmail" type="email" /></label><label>Notes<textarea name="notes"></textarea></label><button class="primary-button">${escapeHtml(t("common.refer"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#referJobForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      await api(`/api/projects/${state.projectId}/jobs/${encodeURIComponent(jobId)}/refer`, { method: "POST", body: JSON.stringify(data) });
      close(); toast(t("toast.saved"));
    }),
  });
}

async function openPipeline(jobId) {
  const payload = await api(`/api/projects/${state.projectId}/jobs/${encodeURIComponent(jobId)}/pipeline`);
  modal({
    title: t("jobs.pipeline"),
    body: `<div class="stack"><strong>Applications</strong>${(payload.applications || []).map((item) => `<div class="card"><strong>${escapeHtml(item.applicantName || item.applicantUserId)}</strong><div class="muted small-text">${escapeHtml(item.status)}</div></div>`).join("") || `<span class="muted">${escapeHtml(t("common.noResults"))}</span>`}<strong>Referrals</strong>${(payload.referrals || []).map((item) => `<div class="card"><strong>${escapeHtml(item.candidateName)}</strong><div class="muted small-text">${escapeHtml(item.status)}</div></div>`).join("") || `<span class="muted">${escapeHtml(t("common.noResults"))}</span>`}</div>`,
  });
}

async function renderEmployees() {
  setPageHeading("employees.title");
  const payload = await api(`/api/projects/${state.projectId}/employees`);
  const employees = payload.employees || [];
  els.pageContent.innerHTML = `
    <div class="page-header"><div><h2>${escapeHtml(t("employees.title"))}</h2></div>${has(CAP.EMPLOYEES_CREATE) ? `<button id="addEmployeeButton" class="primary-button">${escapeHtml(t("employees.add"))}</button>` : ""}</div>
    <div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("employees.name"))}</th><th>${escapeHtml(t("employees.staffCode"))}</th><th>${escapeHtml(t("employees.projectRole"))}</th><th>${escapeHtml(t("employees.accountStatus"))}</th><th>${escapeHtml(t("common.team"))}</th><th></th></tr></thead><tbody>
      ${employees.map((employee) => `<tr><td><strong>${escapeHtml(employee.displayName)}</strong></td><td>${escapeHtml(employee.staffCode)}</td><td><span class="badge primary">${escapeHtml(employee.projectRole)}</span></td><td><span class="badge ${employee.accountStatus === "active" ? "success" : "danger"}">${escapeHtml(employee.accountStatus)}</span></td><td>${escapeHtml((employee.teamIds || []).join(", ") || "—")}</td><td>${has(CAP.EMPLOYEES_CHANGE_ROLE) ? `<button class="ghost-button" data-role-user="${escapeHtml(employee.id)}" data-current-role="${escapeHtml(employee.projectRole)}">${escapeHtml(t("employees.promote"))}</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
  els.pageContent.querySelector("#addEmployeeButton")?.addEventListener("click", openAddEmployeeModal);
  els.pageContent.querySelectorAll("[data-role-user]").forEach((button) => button.addEventListener("click", () => openRoleModal(button.dataset.roleUser, button.dataset.currentRole)));
}

function openAddEmployeeModal() {
  modal({
    title: t("employees.add"),
    body: `<form id="employeeForm" class="stack"><div class="modal-grid"><label>${escapeHtml(t("employees.name"))}<input name="displayName" required /></label><label>${escapeHtml(t("employees.staffCode"))}<input name="staffCode" required /></label><label>${escapeHtml(t("common.role"))}<select name="role"><option value="agent">Agent</option><option value="supervisor">Supervisor</option>${state.workspace.membership?.role === "manager" || state.workspace.platformRole === "ceo" || state.workspace.platformRole === "hr" ? `<option value="manager">Manager</option>` : ""}</select></label><label>${escapeHtml(t("employees.temporarySecret"))}<input name="temporarySecret" type="password" inputmode="numeric" required /></label></div><button class="primary-button">${escapeHtml(t("common.create"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#employeeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      await api(`/api/projects/${state.projectId}/employees`, { method: "POST", body: JSON.stringify(data) });
      close(); toast(t("toast.saved")); await renderEmployees();
    }),
  });
}

function openRoleModal(userId, currentRole) {
  modal({
    title: t("employees.promote"),
    body: `<form id="roleForm" class="stack"><label>${escapeHtml(t("common.role"))}<select name="role"><option value="agent" ${currentRole === "agent" ? "selected" : ""}>Agent</option><option value="supervisor" ${currentRole === "supervisor" ? "selected" : ""}>Supervisor</option><option value="manager" ${currentRole === "manager" ? "selected" : ""}>Manager</option></select></label><button class="primary-button">${escapeHtml(t("common.save"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#roleForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { role } = Object.fromEntries(new FormData(event.currentTarget));
      await api(`/api/projects/${state.projectId}/employees/${encodeURIComponent(userId)}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      close(); toast(t("toast.saved")); await renderEmployees();
    }),
  });
}

async function renderTeams() {
  setPageHeading("teams.title");
  const payload = await api(`/api/projects/${state.projectId}/teams`);
  const teams = payload.teams || [];
  els.pageContent.innerHTML = `
    <div class="page-header"><div><h2>${escapeHtml(t("teams.title"))}</h2></div>${has(CAP.TEAMS_CREATE) ? `<button id="createTeamButton" class="primary-button">${escapeHtml(t("teams.create"))}</button>` : ""}</div>
    <div class="grid cards-3">${teams.map((team) => `<article class="card"><h3>${escapeHtml(team.name)}</h3><p class="muted">${escapeHtml(t("common.supervisor"))}: ${escapeHtml(team.supervisorUserId || "—")}</p><button class="ghost-button" data-team-members="${escapeHtml(team.id)}">${escapeHtml(t("teams.members"))}</button></article>`).join("") || `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>`}</div>`;
  els.pageContent.querySelector("#createTeamButton")?.addEventListener("click", () => modal({
    title: t("teams.create"),
    body: `<form id="teamForm" class="stack"><label>${escapeHtml(t("teams.name"))}<input name="name" required /></label><label>${escapeHtml(t("common.supervisor"))} ID<input name="supervisorUserId" /></label><button class="primary-button">${escapeHtml(t("common.create"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#teamForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (!data.supervisorUserId) delete data.supervisorUserId; await api(`/api/projects/${state.projectId}/teams`, { method: "POST", body: JSON.stringify(data) }); close(); await renderTeams();
    }),
  }));
  els.pageContent.querySelectorAll("[data-team-members]").forEach((button) => button.addEventListener("click", async () => {
    const members = (await api(`/api/projects/${state.projectId}/teams/${encodeURIComponent(button.dataset.teamMembers)}/members`)).members || [];
    modal({ title: t("teams.members"), body: members.map((member) => `<div class="card" style="margin-bottom:8px"><strong>${escapeHtml(member.displayName || member.userId)}</strong><div class="muted small-text">${escapeHtml(member.projectRole || "")}</div></div>`).join("") || `<div class="empty-state">${escapeHtml(t("common.noResults"))}</div>` });
  }));
}

async function renderIntegrations() {
  setPageHeading("integrations.title");
  const payload = await api(`/api/projects/${state.projectId}/integrations/shopify`);
  const connections = payload.connections || [];
  els.pageContent.innerHTML = `
    <div class="page-header"><div><h2>${escapeHtml(t("integrations.shopify"))}</h2></div><button id="addShopifyButton" class="primary-button">${escapeHtml(t("integrations.addShopify"))}</button></div>
    <div class="grid cards-2">${connections.map((connection) => `<article class="card"><div class="page-header"><div><h3>${escapeHtml(connection.label || connection.shopDomain)}</h3><p class="muted">${escapeHtml(connection.shopDomain || "")}</p></div><span class="badge ${connection.status === "active" ? "success" : "warning"}">${escapeHtml(connection.status)}</span></div>${connection.credentialSource === "legacy_env" ? `<div class="notice">${escapeHtml(t("integrations.protected"))}</div>` : `<div class="actions-row"><button class="secondary-button" data-verify-connection="${escapeHtml(connection.id)}">${escapeHtml(t("integrations.verify"))}</button>${connection.verifiedAt ? `<button class="primary-button" data-activate-connection="${escapeHtml(connection.id)}">${escapeHtml(t("integrations.activate"))}</button>` : ""}</div>`}</article>`).join("")}</div>`;
  els.pageContent.querySelector("#addShopifyButton").addEventListener("click", openShopifyModal);
  els.pageContent.querySelectorAll("[data-verify-connection]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/projects/${state.projectId}/integrations/shopify/${encodeURIComponent(button.dataset.verifyConnection)}/verify`, { method: "POST" }); toast(t("toast.saved")); await renderIntegrations(); }));
  els.pageContent.querySelectorAll("[data-activate-connection]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/projects/${state.projectId}/integrations/shopify/${encodeURIComponent(button.dataset.activateConnection)}/activate`, { method: "POST" }); toast(t("toast.saved")); await renderIntegrations(); }));
}

function openShopifyModal() {
  modal({
    title: t("integrations.addShopify"),
    body: `<form id="shopifyForm" class="stack"><label>${escapeHtml(t("integrations.connectionName"))}<input name="label" required /></label><label>${escapeHtml(t("integrations.shopDomain"))}<input name="shopDomain" placeholder="store.myshopify.com" required /></label><label>${escapeHtml(t("integrations.clientId"))}<input name="clientId" required /></label><label>${escapeHtml(t("integrations.clientSecret"))}<input name="clientSecret" type="password" required /></label><button class="primary-button">${escapeHtml(t("common.create"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#shopifyForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); await api(`/api/projects/${state.projectId}/integrations/shopify`, { method: "POST", body: JSON.stringify(data) }); close(); toast(t("toast.saved")); await renderIntegrations();
    }),
  });
}

async function renderProjects() {
  setPageHeading("projects.title");
  const payload = await api("/api/projects");
  const projects = payload.projects || [];
  els.pageContent.innerHTML = `
    <div class="page-header"><div><h2>${escapeHtml(t("projects.title"))}</h2></div><button id="createProjectButton" class="primary-button">${escapeHtml(t("projects.create"))}</button></div>
    <div class="grid cards-3">${projects.map((project) => `<article class="card"><h3>${escapeHtml(project.name)}</h3><p class="muted">${escapeHtml(project.slug || project.id)}</p><span class="badge ${project.isDefault ? "primary" : "success"}">${project.isDefault ? "Default" : escapeHtml(project.status)}</span></article>`).join("")}</div>`;
  els.pageContent.querySelector("#createProjectButton").addEventListener("click", () => modal({
    title: t("projects.create"),
    body: `<form id="projectForm" class="stack"><label>${escapeHtml(t("projects.name"))}<input name="name" required /></label><label>${escapeHtml(t("projects.slug"))}<input name="slug" /></label><label>${escapeHtml(t("projects.timezone"))}<input name="timezone" value="Europe/London" required /></label><button class="primary-button">${escapeHtml(t("common.create"))}</button></form>`,
    onReady: ({ root, close }) => root.querySelector("#projectForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); await api("/api/projects", { method: "POST", body: JSON.stringify(data) }); close(); toast(t("toast.saved")); const me = await api("/api/me"); state.projects = me.projects; await renderProjects();
    }),
  }));
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.classList.add("hidden");
  els.loginButton.disabled = true;
  const previous = els.loginButton.textContent;
  els.loginButton.textContent = t("auth.signingIn");
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ staffCode: els.loginStaffCode.value.trim(), secret: els.loginSecret.value }),
    });
    await hydrateSession();
  } catch (error) {
    els.loginError.textContent = error.message;
    els.loginError.classList.remove("hidden");
  } finally {
    els.loginButton.disabled = false;
    els.loginButton.textContent = previous;
  }
});

els.logoutButton.addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  showLogin();
});

els.projectSelector.addEventListener("change", () => loadWorkspace(els.projectSelector.value).catch((error) => toast(error.message, "error")));
els.themeSelector.addEventListener("change", () => applyTheme(els.themeSelector.value, { persistCloud: true }));
els.sidebarToggle.addEventListener("click", () => els.sidebar.classList.toggle("open"));
document.querySelectorAll(".locale-button").forEach((button) => button.addEventListener("click", () => applyLocale(button.dataset.locale, { persistCloud: Boolean(state.me) })));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "system") applyTheme("system"); });

applyLocale(state.locale);
applyTheme(state.theme);

api("/api/me")
  .then((payload) => hydrateSession(payload))
  .catch((error) => {
    if (error.status !== 401) console.error(error);
    showLogin();
  });
