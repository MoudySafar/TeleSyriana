const STORE_KEY = "tsos_v1";

const defaultState = {
const state = {
  lang: "en",
  currentUser: null,
  staff: [
    { staffCode: "0001", name: "Qamar", role: "agent", pin: "2411", hourlyRate: 1.25, currency: "USD", active: true, supervisor: "1001" },
    { staffCode: "1001", name: "Raghad", role: "supervisor", pin: "5566", hourlyRate: 2.5, currency: "USD", active: true },
    { staffCode: "2001", name: "Mohammad", role: "manager", pin: "7788", hourlyRate: 4, currency: "GBP", active: true },
    { staffCode: "9999", name: "Owner", role: "admin", pin: "0000", hourlyRate: 7, currency: "USD", active: true }
  ],
  tickets: [],
  chat: [],
  tracking: {}
};

const i18n = {
  en: { login_title: "Staff Login", staff_code: "Staff Code", pin: "PIN", login: "Login", logout: "Logout", time_tracking: "Time Tracking", tickets: "Tickets", create_ticket: "Create Ticket", chat: "Internal Chat", send: "Send", manager_tools: "Manager / Supervisor Tools" },
  ar: { login_title: "تسجيل دخول الموظف", staff_code: "كود الموظف", pin: "الرقم السري", login: "دخول", logout: "خروج", time_tracking: "تتبع الوقت", tickets: "التكتات", create_ticket: "إنشاء تكت", chat: "الشات الداخلي", send: "إرسال", manager_tools: "أدوات المشرف / المدير" }
};

const ticketTypes = ["address_change", "product_not_arrived", "item_not_genuine", "return", "exchange", "angry_customer", "refund_request", "chargeback_risk", "general_question"];
const priorities = ["emergency", "high", "medium", "normal"];

function updateI18n() {
  document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = i18n[state.lang][el.dataset.i18n] || el.textContent);
  document.getElementById("langEn").classList.toggle("active", state.lang === "en");
  document.getElementById("langAr").classList.toggle("active", state.lang === "ar");
}

function now() { return new Date().toISOString(); }

function login(staffCode, pin) {
  return state.staff.find(s => s.staffCode === staffCode && s.pin === pin && s.active);
}

function renderDashboard() {
  const user = state.currentUser;
  byId("welcomeText").textContent = `${user.name} (${user.role})`;
  renderTickets(); renderChat(); renderTracking(); renderManagerTools(); renderStaff();
}

function renderTracking() {
  const user = state.currentUser;
  const t = state.tracking[user.staffCode] || {};
  const workedMs = t.clockIn && t.clockOut ? new Date(t.clockOut) - new Date(t.clockIn) : 0;
  const breakMs = (t.breakEnd && t.breakStart) ? new Date(t.breakEnd) - new Date(t.breakStart) : 0;
  const lateMin = Math.max(0, Math.floor((breakMs - 45 * 60000) / 60000));
  const paidMs = Math.max(0, workedMs - breakMs);
  const pay = ((paidMs / 3600000) * user.hourlyRate).toFixed(2);
  byId("timeSummary").textContent = `Worked: ${Math.floor(workedMs/60000)}m | Break: ${Math.floor(breakMs/60000)}m | Late: ${lateMin}m | Est Pay: ${pay} ${user.currency}`;
}

function renderTickets() {
  const role = state.currentUser.role;
  const list = byId("ticketsList");
  const visible = ["manager", "admin"].includes(role)
    ? state.tickets
    : state.tickets.filter(t => t.assignedTo === state.currentUser.staffCode || t.createdBy === state.currentUser.staffCode);
  list.innerHTML = visible.map(t => `<li><b>${t.ticketId}</b> #${t.orderNumber} • ${t.type} • ${t.priority} • ${t.status}</li>`).join("") || "<li>No tickets</li>";
}

function renderChat() {
  byId("chatMessages").innerHTML = state.chat.slice(-30).map(m => `<p><b>${m.by}</b>: ${m.text} <small>${m.at}</small></p>`).join("") || "<p>No messages</p>";
}

function renderManagerTools() {
  const panel = byId("managerPanel");
  if (!["supervisor", "manager", "admin"].includes(state.currentUser.role)) return panel.classList.add("hidden");
  panel.classList.remove("hidden");
  const open = state.tickets.filter(t => !["closed", "resolved"].includes(t.status)).length;
  const escalated = state.tickets.filter(t => t.status === "escalated").length;
  byId("teamSummary").textContent = `Open tickets: ${open} | Escalated: ${escalated}`;
  byId("alertsList").innerHTML = state.tickets.filter(t => t.priority === "emergency" || t.status === "escalated")
    .map(t => `<li>${t.ticketId} (${t.priority}/${t.status})</li>`).join("") || "<li>No alerts</li>";
}

function renderStaff() {
  const panel = byId("adminPanel");
  if (!canManageStaff(state.currentUser.role)) return panel.classList.add("hidden");
  panel.classList.remove("hidden");
  byId("staffList").innerHTML = state.staff.map(s => `<li>${s.staffCode} - ${s.name} (${s.role}) ${s.active ? "✅" : "⛔"}</li>`).join("");
  document.getElementById("welcomeText").textContent = `${user.name} (${user.role})`;
  renderTickets();
  renderChat();
  renderTracking();
  renderManagerTools();
}

function renderTracking() {
  const t = state.tracking[state.currentUser.staffCode] || {};
  const breakMs = (t.breakEnd && t.breakStart) ? new Date(t.breakEnd) - new Date(t.breakStart) : 0;
  const lateMin = Math.max(0, Math.floor((breakMs - 45 * 60000) / 60000));
  document.getElementById("timeSummary").textContent = `In: ${t.clockIn || "-"} | Out: ${t.clockOut || "-"} | Break: ${Math.floor(breakMs/60000)}m | Late: ${lateMin}m`;
}

function renderTickets() {
  const list = document.getElementById("ticketsList");
  const visible = ["manager","admin"].includes(state.currentUser.role)
    ? state.tickets
    : state.tickets.filter(t => t.assignedTo === state.currentUser.staffCode || t.createdBy === state.currentUser.staffCode);
  list.innerHTML = visible.map(t => `<li><b>${t.ticketId}</b> #${t.orderNumber} • ${t.type} • ${t.priority} • ${t.status}</li>`).join("");
}

function renderChat() {
  const box = document.getElementById("chatMessages");
  box.innerHTML = state.chat.slice(-20).map(m => `<p><b>${m.by}</b>: ${m.text} <small>${m.at}</small></p>`).join("");
}

function renderManagerTools() {
  const panel = document.getElementById("managerPanel");
  if (!["supervisor", "manager", "admin"].includes(state.currentUser.role)) return panel.classList.add("hidden");
  panel.classList.remove("hidden");
  const open = state.tickets.filter(t => t.status !== "closed" && t.status !== "resolved").length;
  const escalated = state.tickets.filter(t => t.status === "escalated").length;
  document.getElementById("teamSummary").textContent = `Open tickets: ${open} | Escalated: ${escalated}`;
  const alerts = state.tickets.filter(t => t.priority === "emergency" || t.status === "escalated");
  document.getElementById("alertsList").innerHTML = alerts.map(a => `<li>${a.ticketId} requires attention (${a.priority}/${a.status})</li>`).join("") || "<li>No alerts</li>";
}

function generateTicket(orderNumber, type, priority, note) {
  const id = `TK-${String(state.tickets.length + 1).padStart(7, "0")}`;
  const normalized = note.toLowerCase();
  const escalationWords = ["chargeback", "legal", "fake", "angry", "social", "refund dispute"];
  const escalated = escalationWords.some(w => normalized.includes(w)) || ["angry_customer", "chargeback_risk", "item_not_genuine", "product_not_arrived", "address_change"].includes(type);
  return { ticketId: id, orderNumber: orderNumber.replace("#", ""), type, priority, status: escalated ? "escalated" : "open", assignedTo: state.currentUser.staffCode, createdBy: state.currentUser.staffCode, createdAt: now(), updatedAt: now(), internalNotes: note, risk: escalated ? "high" : "low" };
}

byId("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const user = login(byId("staffCode").value.trim(), byId("pin").value.trim());
  if (!user) return alert("Invalid credentials");
  state.currentUser = user;
  byId("loginCard").classList.add("hidden");
  byId("dashboardCard").classList.remove("hidden");
  renderDashboard();
});

byId("logoutBtn").addEventListener("click", () => { state.currentUser = null; byId("loginCard").classList.remove("hidden"); byId("dashboardCard").classList.add("hidden"); });
byId("syncBtn").addEventListener("click", () => { save(); alert("Saved locally. Connect Firebase next."); });

["clockInBtn", "clockOutBtn", "startBreakBtn", "endBreakBtn"].forEach(id => {
  byId(id).addEventListener("click", () => {
    const code = state.currentUser.staffCode;
    state.tracking[code] = state.tracking[code] || {};
    const key = ({ clockInBtn: "clockIn", clockOutBtn: "clockOut", startBreakBtn: "breakStart", endBreakBtn: "breakEnd" })[id];
    state.tracking[code][key] = now();
    save(); renderTracking();
  });
});

byId("ticketForm").addEventListener("submit", e => {
  e.preventDefault();
  state.tickets.unshift(generateTicket(byId("orderNumber").value, byId("ticketType").value, byId("ticketPriority").value, byId("ticketNote").value || ""));
  save(); renderTickets(); renderManagerTools(); e.target.reset();
});

byId("chatForm").addEventListener("submit", e => {
  e.preventDefault();
  state.chat.push({ by: state.currentUser.name, text: byId("chatInput").value.trim(), at: now() });
  save(); renderChat(); e.target.reset();
});

byId("staffForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!canManageStaff(state.currentUser.role)) return;
  const newStaff = {
    staffCode: byId("newStaffCode").value.trim(),
    name: byId("newStaffName").value.trim(),
    role: byId("newStaffRole").value,
    pin: byId("newStaffPin").value.trim(),
    hourlyRate: Number(byId("newStaffRate").value),
    currency: byId("newStaffCurrency").value,
    active: true
  };
  if (state.staff.some(s => s.staffCode === newStaff.staffCode)) return alert("Staff code already exists");
  state.staff.push(newStaff);
  save(); renderStaff(); e.target.reset();
});

function bootstrapSelectors() {
  ticketTypes.forEach(v => byId("ticketType").insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  priorities.forEach(v => byId("ticketPriority").insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  staffRoles.forEach(v => byId("newStaffRole").insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
}

byId("langEn").addEventListener("click", () => { state.lang = "en"; updateI18n(); save(); });
byId("langAr").addEventListener("click", () => { state.lang = "ar"; updateI18n(); save(); });

bootstrapSelectors();
updateI18n();
save();
  const riskWords = ["chargeback", "fake", "angry", "refund", "legal", "social"]; 
  const risk = riskWords.some(w => type.includes(w) || note.toLowerCase().includes(w));
  return { ticketId: id, orderNumber: orderNumber.replace("#", ""), type, priority, status: risk ? "escalated" : "open", assignedTo: state.currentUser.staffCode, createdBy: state.currentUser.staffCode, createdAt: now(), updatedAt: now(), internalNotes: note, risk: risk ? "high" : "low" };
}

document.getElementById("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const user = login(staffCode.value.trim(), pin.value.trim());
  if (!user) return alert("Invalid credentials");
  state.currentUser = user;
  loginCard.classList.add("hidden");
  dashboardCard.classList.remove("hidden");
  renderDashboard();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  state.currentUser = null;
  loginCard.classList.remove("hidden");
  dashboardCard.classList.add("hidden");
});

["clockInBtn","clockOutBtn","startBreakBtn","endBreakBtn"].forEach(id => {
  document.getElementById(id).addEventListener("click", () => {
    const code = state.currentUser.staffCode;
    state.tracking[code] = state.tracking[code] || {};
    const key = ({clockInBtn:"clockIn",clockOutBtn:"clockOut",startBreakBtn:"breakStart",endBreakBtn:"breakEnd"})[id];
    state.tracking[code][key] = now();
    renderTracking();
  });
});

document.getElementById("ticketForm").addEventListener("submit", e => {
  e.preventDefault();
  const t = generateTicket(orderNumber.value, ticketType.value, ticketPriority.value, ticketNote.value || "");
  state.tickets.unshift(t);
  renderTickets();
  renderManagerTools();
  e.target.reset();
});

document.getElementById("chatForm").addEventListener("submit", e => {
  e.preventDefault();
  state.chat.push({ by: state.currentUser.name, text: chatInput.value.trim(), at: now() });
  renderChat();
  e.target.reset();
});

function bootstrapSelectors() {
  ticketTypes.forEach(v => ticketType.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  priorities.forEach(v => ticketPriority.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
}

document.getElementById("langEn").addEventListener("click", () => { state.lang = "en"; updateI18n(); });
document.getElementById("langAr").addEventListener("click", () => { state.lang = "ar"; updateI18n(); });

bootstrapSelectors();
updateI18n();
