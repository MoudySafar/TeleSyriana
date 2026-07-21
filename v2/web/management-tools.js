const cache = {
  me: null,
  context: null,
  projectId: null,
};

function ar() {
  return document.documentElement.lang === "ar";
}

function ltr(en, arabic) {
  return ar() ? arabic : en;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function notify(message, type = "success") {
  const region = document.getElementById("toastRegion");
  if (!region) return;
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  region.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function openModal(title, html, onReady) {
  const root = document.getElementById("modalRoot");
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" data-management-backdrop>
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="icon-button" type="button" data-management-close>×</button>
        </div>
        ${html}
      </section>
    </div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector("[data-management-close]")?.addEventListener("click", close);
  root.querySelector("[data-management-backdrop]")?.addEventListener("click", (event) => {
    if (event.target.matches("[data-management-backdrop]")) close();
  });
  onReady?.({ root, close });
}

async function currentProjectId() {
  const selector = document.getElementById("projectSelector");
  if (selector?.value) return selector.value;
  if (!cache.me) cache.me = await api("/api/me");
  return cache.me.projects?.find((project) => project.isDefault)?.id || cache.me.projects?.[0]?.id || null;
}

async function currentContext({ force = false } = {}) {
  const projectId = await currentProjectId();
  if (!projectId) return null;
  if (!force && cache.context && cache.projectId === projectId) return cache.context;
  cache.projectId = projectId;
  cache.context = await api(`/api/projects/${encodeURIComponent(projectId)}/context`);
  return cache.context;
}

function activePage() {
  return document.querySelector(".nav-button.active")?.dataset?.page || null;
}

function refreshMainPage() {
  const active = document.querySelector(".nav-button.active[data-page]");
  active?.click();
}

async function addAuditNavigation() {
  const context = await currentContext();
  const navigation = document.getElementById("navigation");
  if (!context || !navigation || !context.capabilities?.["audit.view"]) return;
  if (navigation.querySelector("[data-management-audit]")) return;

  const section = document.createElement("div");
  section.innerHTML = `
    <div class="nav-section-title">${escapeHtml(ltr("Governance", "الحوكمة"))}</div>
    <button class="nav-button" type="button" data-management-audit>
      <span class="nav-icon">◷</span>
      <span>${escapeHtml(ltr("Audit Log", "سجل التدقيق"))}</span>
    </button>`;
  while (section.firstElementChild) navigation.appendChild(section.firstElementChild);
  navigation.querySelector("[data-management-audit]")?.addEventListener("click", renderAudit);
}

async function renderAudit() {
  const projectId = await currentProjectId();
  if (!projectId) return;
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  document.querySelector("[data-management-audit]")?.classList.add("active");
  const title = document.getElementById("pageTitle");
  const subtitle = document.getElementById("pageSubtitle");
  const content = document.getElementById("pageContent");
  if (title) title.textContent = ltr("Audit Log", "سجل التدقيق");
  if (subtitle) subtitle.textContent = ltr("Sensitive project changes and administrative activity", "التغييرات الحساسة والنشاط الإداري داخل المشروع");
  if (!content) return;
  content.innerHTML = `<div class="card"><div class="skeleton" style="height:18px;width:45%"></div></div>`;

  try {
    const payload = await api(`/api/projects/${encodeURIComponent(projectId)}/audit?limit=250`);
    const events = payload.events || [];
    content.innerHTML = `
      <div class="toolbar">
        <input id="auditFilter" class="grow" placeholder="${escapeHtml(ltr("Filter action, employee or target…", "تصفية حسب الإجراء أو الموظف أو الهدف…"))}" />
      </div>
      <div id="auditTable" class="table-wrap"></div>`;
    const table = content.querySelector("#auditTable");
    const render = (filter = "") => {
      const term = filter.trim().toLowerCase();
      const filtered = events.filter((event) => !term || JSON.stringify(event).toLowerCase().includes(term));
      table.innerHTML = `<table>
        <thead><tr><th>${escapeHtml(ltr("Time", "الوقت"))}</th><th>${escapeHtml(ltr("Actor", "المستخدم"))}</th><th>${escapeHtml(ltr("Action", "الإجراء"))}</th><th>${escapeHtml(ltr("Target", "الهدف"))}</th><th>${escapeHtml(ltr("Details", "التفاصيل"))}</th></tr></thead>
        <tbody>${filtered.map((event) => `<tr>
          <td>${escapeHtml(new Date(event.createdAt).toLocaleString())}</td>
          <td>${escapeHtml(event.actorName || event.actorUserId || "System")}</td>
          <td><span class="badge primary">${escapeHtml(event.action)}</span></td>
          <td>${escapeHtml(`${event.targetType || ""} ${event.targetId || ""}`.trim())}</td>
          <td><code>${escapeHtml(JSON.stringify(event.metadata || {}))}</code></td>
        </tr>`).join("") || `<tr><td colspan="5">${escapeHtml(ltr("No audit events found.", "لا توجد أحداث تدقيق."))}</td></tr>`}</tbody>
      </table>`;
    };
    render();
    content.querySelector("#auditFilter")?.addEventListener("input", (event) => render(event.target.value));
  } catch (error) {
    content.innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`;
  }
}

async function enhanceEmployees() {
  if (activePage() !== "employees") return;
  const projectId = await currentProjectId();
  const context = await currentContext();
  if (!projectId || !context) return;

  const payload = await api(`/api/projects/${encodeURIComponent(projectId)}/employees`);
  const employees = payload.employees || [];
  const globalViewer = Boolean(context.globalProjectViewer);
  const manager = context.membership?.role === "manager";
  const canProjectManage = globalViewer || manager;

  const header = document.querySelector("#pageContent .page-header");
  if (globalViewer && header && !header.querySelector("[data-assign-existing]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.assignExisting = "true";
    button.textContent = ltr("Assign existing employee", "إسناد موظف موجود للمشروع");
    header.appendChild(button);
    button.addEventListener("click", openAssignExistingEmployee);
  }

  document.querySelectorAll("#pageContent tbody tr").forEach((row) => {
    if (row.dataset.managementEnhanced === "true") return;
    const staffCode = row.cells?.[1]?.textContent?.trim();
    const employee = employees.find((item) => item.staffCode === staffCode);
    if (!employee) return;
    row.dataset.managementEnhanced = "true";
    row.dataset.employeeId = employee.id;
    const actionCell = row.cells[row.cells.length - 1];
    if (!actionCell) return;

    if (canProjectManage && employee.membershipStatus === "active" && employee.id !== cache.me?.user?.id) {
      const disable = document.createElement("button");
      disable.type = "button";
      disable.className = "danger-button";
      disable.style.marginInlineStart = "6px";
      disable.textContent = ltr("Remove from project", "تعطيل ضمن المشروع");
      disable.addEventListener("click", async () => {
        if (!confirm(ltr("Disable this employee's membership in this project? Their history will be preserved.", "تعطيل عضوية هذا الموظف في المشروع؟ سيبقى السجل محفوظاً."))) return;
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/employees/${encodeURIComponent(employee.id)}/disable`, { method: "POST" });
          notify(ltr("Project membership disabled.", "تم تعطيل العضوية في المشروع."));
          refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
      actionCell.appendChild(disable);
    }

    if (canProjectManage && employee.membershipStatus !== "active") {
      const reactivate = document.createElement("button");
      reactivate.type = "button";
      reactivate.className = "secondary-button";
      reactivate.style.marginInlineStart = "6px";
      reactivate.textContent = ltr("Reactivate project", "إعادة تفعيل المشروع");
      reactivate.addEventListener("click", async () => {
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/employees/${encodeURIComponent(employee.id)}/reactivate`, { method: "POST" });
          notify(ltr("Project membership reactivated.", "تمت إعادة تفعيل العضوية."));
          refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
      actionCell.appendChild(reactivate);
    }

    if (globalViewer && employee.id !== cache.me?.user?.id) {
      const globalButton = document.createElement("button");
      globalButton.type = "button";
      globalButton.className = employee.accountStatus === "active" ? "danger-button" : "secondary-button";
      globalButton.style.marginInlineStart = "6px";
      globalButton.textContent = employee.accountStatus === "active"
        ? ltr("Disable account", "تعطيل الحساب بالكامل")
        : ltr("Reactivate account", "إعادة تفعيل الحساب");
      globalButton.addEventListener("click", async () => {
        const disabling = employee.accountStatus === "active";
        if (disabling && !confirm(ltr("Disable this TeleSyriana account globally? Existing history will be preserved and active sessions revoked.", "تعطيل حساب تيلي سيريانا بالكامل؟ سيبقى السجل محفوظاً وسيتم إنهاء الجلسات النشطة."))) return;
        try {
          const endpoint = disabling ? "disable-account" : "reactivate-account";
          await api(`/api/employees/${encodeURIComponent(employee.id)}/${endpoint}`, { method: "POST" });
          notify(ltr("Account status updated.", "تم تحديث حالة الحساب."));
          refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
      actionCell.appendChild(globalButton);
    }
  });
}

async function openAssignExistingEmployee() {
  const projectId = await currentProjectId();
  const [global, projectEmployees, teamsPayload] = await Promise.all([
    api("/api/workforce/employees?limit=500"),
    api(`/api/projects/${encodeURIComponent(projectId)}/employees`),
    api(`/api/projects/${encodeURIComponent(projectId)}/teams`),
  ]);
  const currentIds = new Set((projectEmployees.employees || []).filter((item) => item.membershipStatus === "active").map((item) => item.id));
  const candidates = (global.employees || []).filter((item) => !currentIds.has(item.id) && item.status === "active");
  const supervisors = (projectEmployees.employees || []).filter((item) => ["supervisor", "manager"].includes(item.projectRole) && item.membershipStatus === "active");
  const teams = teamsPayload.teams || [];

  openModal(
    ltr("Assign existing employee", "إسناد موظف موجود للمشروع"),
    `<form id="assignExistingForm" class="stack">
      <label>${escapeHtml(ltr("Employee", "الموظف"))}<select name="userId" required>${candidates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)} (${escapeHtml(item.staffCode)})</option>`).join("")}</select></label>
      <label>${escapeHtml(ltr("Project role", "الدور في المشروع"))}<select name="role"><option value="agent">Agent</option><option value="supervisor">Supervisor</option><option value="manager">Manager</option></select></label>
      <label>${escapeHtml(ltr("Supervisor", "المشرف"))}<select name="supervisorUserId"><option value="">—</option>${supervisors.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</option>`).join("")}</select></label>
      <label>${escapeHtml(ltr("Team", "الفريق"))}<select name="teamId"><option value="">—</option>${teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("")}</select></label>
      ${candidates.length ? `<button class="primary-button" type="submit">${escapeHtml(ltr("Assign to project", "إسناد للمشروع"))}</button>` : `<div class="notice">${escapeHtml(ltr("No unassigned active employees found.", "لا يوجد موظفون نشطون غير مسندين لهذا المشروع."))}</div>`}
    </form>`,
    ({ root, close }) => {
      root.querySelector("#assignExistingForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        if (!data.supervisorUserId) delete data.supervisorUserId;
        if (!data.teamId) delete data.teamId;
        const userId = data.userId;
        delete data.userId;
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/employees/${encodeURIComponent(userId)}/membership`, { method: "PUT", body: JSON.stringify(data) });
          close();
          notify(ltr("Employee assigned to project.", "تم إسناد الموظف للمشروع."));
          refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
    },
  );
}

async function enhanceTeams() {
  if (activePage() !== "teams") return;
  const projectId = await currentProjectId();
  const context = await currentContext();
  if (!projectId || !context) return;
  const canManage = Boolean(
    context.globalProjectViewer ||
    context.membership?.role === "manager" ||
    context.capabilities?.["teams.manage_own"],
  );
  if (!canManage) return;

  document.querySelectorAll("[data-team-members]").forEach((membersButton) => {
    if (membersButton.parentElement?.querySelector(`[data-manage-team="${CSS.escape(membersButton.dataset.teamMembers)}"]`)) return;
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "secondary-button";
    manage.style.marginInlineStart = "6px";
    manage.dataset.manageTeam = membersButton.dataset.teamMembers;
    manage.textContent = ltr("Manage team", "إدارة الفريق");
    membersButton.insertAdjacentElement("afterend", manage);
    manage.addEventListener("click", () => openTeamManager(manage.dataset.manageTeam));
  });
}

async function openTeamManager(teamId) {
  const projectId = await currentProjectId();
  const [membersPayload, employeesPayload, teamsPayload] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/members`),
    api(`/api/projects/${encodeURIComponent(projectId)}/employees`),
    api(`/api/projects/${encodeURIComponent(projectId)}/teams`),
  ]);
  const members = membersPayload.members || [];
  const employees = employeesPayload.employees || [];
  const team = (teamsPayload.teams || []).find((item) => item.id === teamId);
  const memberIds = new Set(members.map((item) => item.userId));
  const eligibleAgents = employees.filter((item) => item.projectRole === "agent" && item.membershipStatus === "active" && !memberIds.has(item.id));
  const supervisors = employees.filter((item) => ["supervisor", "manager"].includes(item.projectRole) && item.membershipStatus === "active");
  const context = await currentContext();
  const canChangeSupervisor = Boolean(context.globalProjectViewer || context.membership?.role === "manager");

  openModal(
    `${ltr("Manage team", "إدارة الفريق")}: ${team?.name || teamId}`,
    `<div class="stack">
      ${canChangeSupervisor ? `<form id="teamSupervisorForm" class="stack"><label>${escapeHtml(ltr("Supervisor", "المشرف"))}<select name="supervisorUserId">${supervisors.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === team?.supervisorUserId ? "selected" : ""}>${escapeHtml(item.displayName)}</option>`).join("")}</select></label><button class="secondary-button" type="submit">${escapeHtml(ltr("Change Supervisor", "تغيير المشرف"))}</button></form>` : ""}
      <strong>${escapeHtml(ltr("Members", "الأعضاء"))}</strong>
      <div id="managedTeamMembers">${members.map((member) => `<div class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><strong>${escapeHtml(member.displayName || member.userId)}</strong><div class="muted small-text">${escapeHtml(member.projectRole || "")}</div></div><button class="danger-button" type="button" data-remove-team-user="${escapeHtml(member.userId)}">${escapeHtml(ltr("Remove", "إزالة"))}</button></div>`).join("") || `<span class="muted">${escapeHtml(ltr("No members yet.", "لا يوجد أعضاء بعد."))}</span>`}</div>
      <form id="addTeamMemberForm" class="stack"><label>${escapeHtml(ltr("Add Agent", "إضافة موظف"))}<select name="userId">${eligibleAgents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</option>`).join("")}</select></label>${eligibleAgents.length ? `<button class="primary-button" type="submit">${escapeHtml(ltr("Add member", "إضافة عضو"))}</button>` : `<div class="notice">${escapeHtml(ltr("No eligible Agents are available in your current scope.", "لا يوجد موظفون مؤهلون ضمن نطاقك الحالي."))}</div>`}</form>
    </div>`,
    ({ root, close }) => {
      root.querySelector("#teamSupervisorForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const { supervisorUserId } = Object.fromEntries(new FormData(event.currentTarget));
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/supervisor`, { method: "PUT", body: JSON.stringify({ supervisorUserId }) });
          close(); notify(ltr("Team Supervisor updated.", "تم تحديث مشرف الفريق.")); refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
      root.querySelector("#addTeamMemberForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const { userId } = Object.fromEntries(new FormData(event.currentTarget));
        if (!userId) return;
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, { method: "PUT" });
          close(); notify(ltr("Team member added.", "تمت إضافة عضو الفريق.")); refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
      root.querySelectorAll("[data-remove-team-user]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm(ltr("Remove this employee from the team?", "إزالة هذا الموظف من الفريق؟"))) return;
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(button.dataset.removeTeamUser)}`, { method: "DELETE" });
          close(); notify(ltr("Team member removed.", "تمت إزالة عضو الفريق.")); refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      }));
    },
  );
}

async function enhanceTicketAssignment() {
  if (activePage() !== "tickets") return;
  const context = await currentContext();
  const role = context?.membership?.role;
  const allowed = context?.platformRole === "ceo" || role === "manager" || role === "supervisor";
  if (!allowed) return;
  const detail = document.querySelector("#ticketDetail");
  const header = detail?.querySelector(".page-header");
  const code = header?.querySelector("h2")?.textContent?.trim();
  if (!detail || !header || !code || header.querySelector("[data-ticket-assignment]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.dataset.ticketAssignment = code;
  button.textContent = ltr("Assign", "إسناد");
  header.appendChild(button);
  button.addEventListener("click", () => openTicketAssignment(code));
}

async function openTicketAssignment(ticketCode) {
  const projectId = await currentProjectId();
  const [ticketPayload, employeesPayload, teamsPayload] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketCode)}`),
    api(`/api/projects/${encodeURIComponent(projectId)}/employees`),
    api(`/api/projects/${encodeURIComponent(projectId)}/teams`),
  ]);
  const ticket = ticketPayload.ticket;
  const employees = (employeesPayload.employees || []).filter((item) => item.membershipStatus === "active");
  const teams = teamsPayload.teams || [];

  openModal(
    `${ltr("Assign ticket", "إسناد التذكرة")} ${ticketCode}`,
    `<form id="ticketAssignmentForm" class="stack">
      <label>${escapeHtml(ltr("Assign type", "نوع الإسناد"))}<select name="kind" id="ticketAssignmentKind"><option value="employee">${escapeHtml(ltr("Employee", "موظف"))}</option><option value="team">${escapeHtml(ltr("Team", "فريق"))}</option><option value="unassigned">${escapeHtml(ltr("Unassigned", "بدون إسناد"))}</option></select></label>
      <label id="ticketEmployeeWrap">${escapeHtml(ltr("Employee", "الموظف"))}<select name="assignedToUserId">${employees.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === ticket.assignedToUserId ? "selected" : ""}>${escapeHtml(item.displayName)} — ${escapeHtml(item.projectRole)}</option>`).join("")}</select></label>
      <label id="ticketTeamWrap" class="hidden">${escapeHtml(ltr("Team", "الفريق"))}<select name="assignedTeamId">${teams.map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === ticket.assignedTeamId ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("")}</select></label>
      <button class="primary-button" type="submit">${escapeHtml(ltr("Save assignment", "حفظ الإسناد"))}</button>
    </form>`,
    ({ root, close }) => {
      const kind = root.querySelector("#ticketAssignmentKind");
      const employeeWrap = root.querySelector("#ticketEmployeeWrap");
      const teamWrap = root.querySelector("#ticketTeamWrap");
      const sync = () => {
        employeeWrap.classList.toggle("hidden", kind.value !== "employee");
        teamWrap.classList.toggle("hidden", kind.value !== "team");
      };
      kind.addEventListener("change", sync);
      sync();
      root.querySelector("#ticketAssignmentForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const body = { expectedVersion: ticket.version };
        if (data.kind === "employee") body.assignedToUserId = data.assignedToUserId;
        if (data.kind === "team") body.assignedTeamId = data.assignedTeamId;
        try {
          await api(`/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketCode)}/assignment`, { method: "PATCH", body: JSON.stringify(body) });
          close(); notify(ltr("Ticket assignment updated.", "تم تحديث إسناد التذكرة.")); refreshMainPage();
        } catch (error) { notify(error.message, "error"); }
      });
    },
  );
}

async function enhanceChatEditing() {
  if (activePage() !== "chat") return;
  const projectId = await currentProjectId();
  document.querySelectorAll("[data-delete-message]").forEach((deleteButton) => {
    const messageId = deleteButton.dataset.deleteMessage;
    const actions = deleteButton.parentElement;
    if (!actions || actions.querySelector(`[data-edit-message="${CSS.escape(messageId)}"]`)) return;
    const message = deleteButton.closest(".message");
    const bodyNode = message?.querySelector(".message-body");
    if (!bodyNode) return;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "reaction-button";
    edit.dataset.editMessage = messageId;
    edit.textContent = ltr("Edit", "تعديل");
    deleteButton.insertAdjacentElement("beforebegin", edit);
    edit.addEventListener("click", () => {
      openModal(
        ltr("Edit message", "تعديل الرسالة"),
        `<form id="editChatMessageForm" class="stack"><textarea name="body" required>${escapeHtml(bodyNode.textContent)}</textarea><button class="primary-button" type="submit">${escapeHtml(ltr("Save", "حفظ"))}</button></form>`,
        ({ root, close }) => root.querySelector("#editChatMessageForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const { body } = Object.fromEntries(new FormData(event.currentTarget));
          try {
            await api(`/api/projects/${encodeURIComponent(projectId)}/chat/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ body }) });
            close(); notify(ltr("Message updated.", "تم تحديث الرسالة.")); refreshMainPage();
          } catch (error) { notify(error.message, "error"); }
        }),
      );
    });
  });
}

let enhancementTimer = null;
async function enhance() {
  clearTimeout(enhancementTimer);
  enhancementTimer = setTimeout(async () => {
    try {
      if (document.getElementById("appShell")?.classList.contains("hidden")) return;
      await addAuditNavigation();
      await Promise.all([
        enhanceEmployees(),
        enhanceTeams(),
        enhanceTicketAssignment(),
        enhanceChatEditing(),
      ]);
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) console.error("TeleSyriana management UI enhancement error:", error);
    }
  }, 80);
}

const observer = new MutationObserver(enhance);
observer.observe(document.body, { childList: true, subtree: true });

document.getElementById("projectSelector")?.addEventListener("change", () => {
  cache.context = null;
  cache.projectId = null;
  enhance();
});

document.getElementById("logoutButton")?.addEventListener("click", () => {
  cache.me = null;
  cache.context = null;
  cache.projectId = null;
});

enhance();
