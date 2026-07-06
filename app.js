/* ==========================================================================
   IBFS Portal Core JS Controller
   ========================================================================== */

// Default configuration settings
const DEFAULT_CONFIG = {
  apiBaseUrl: "https://script.google.com/macros/s/AKfycbxbrnm4hSudJVyyrBlOKncnzfogQfA7P6NPKAiCaZ5vgWp11ngKbAe3adgTaPm2W-BZUA/exec",
  specialSchoolCode: "230101018",
  maxRegisterPhotos: 10,
  cacheMs: 45000,
  persistentCacheMs: 86400000, // 24 hours
  requestTimeoutMs: 180000,
  maxImageDimension: 1400,
  jpegQuality: 0.72,
  maxPdfBytes: 5000000 // 5 MB
};

// Load configurations from localStorage if exists
let CONFIG = { ...DEFAULT_CONFIG };
try {
  const savedConfig = localStorage.getItem("ibfs_config");
  if (savedConfig) {
    const parsed = JSON.parse(savedConfig);
    if (parsed && typeof parsed.apiBaseUrl === "string" && parsed.apiBaseUrl.trim().startsWith("https://script.google.com/")) {
      CONFIG = { ...DEFAULT_CONFIG, ...parsed, apiBaseUrl: parsed.apiBaseUrl.trim() };
    } else {
      console.warn("Invalid apiBaseUrl in stored config, ignoring saved URL.");
      CONFIG = { ...DEFAULT_CONFIG, ...parsed, apiBaseUrl: DEFAULT_CONFIG.apiBaseUrl };
    }
  }
} catch (e) {
  console.error("Failed to load settings:", e);
}

const CAMPUS_NAMES = {
  "230101010": "Adam Doki-11268",
  "260101009": "Bachal Patani-103058",
  "230101016": "Dhandari-803192",
  "230101011": "Dhani Bux-103699",
  "230101009": "Eidan Khaskheli-4179",
  "230101013": "Sakro-803188",
  "230101015": "Hamzo Jat-803190",
  "230101014": "Jherruck-803189",
  "230101008": "Kakrand-3489",
  "230101012": "Ayoob Junejo-103700",
  "230101006": "Hassan Jat-11289",
  "230101007": "Hassan Turk-222",
  "230101017": "Naoon Road-803193",
  "230101018": "New Aabadi-805170",
  "260101010": "Atharki-102981",
  "Office": "Office"
};

function getCampusName(code) {
  return CAMPUS_NAMES[String(code).trim()] || "Unknown Campus";
}

const MENUS = {
  admin: [
    ["Dashboard", "📊", "System summary"],
    ["Employees", "👥", "Employee data & registry"],
    ["Employee Approval", "🆕", "Approve new employee requests"],
    ["Resignation Approval", "📤", "Approve resignation requests"],
    ["Attendance Approval", "✅", "Teacher-wise approval"],
    ["Petty Cash Setup", "⚙️", "Select each school's petty cash recipient"],
    ["Petty Cash Approval", "🧾", "Approve principal petty cash submissions"],
    ["Salary Advances", "💳", "Issue advance and set installments"],
    ["Salary Generation", "💰", "Generate monthly salary"],
    ["School Salary Sheets", "📄", "School-wise PDFs"],
    ["Combined Reports", "📚", "Monthly combined PDF"],
    ["Payslips", "🧾", "Teacher payslips"],
    ["Audit Log", "📝", "Activity history logs"],
    ["Settings", "⚙️", "Configuration manager"]
  ],
  coordinator: [
    ["Dashboard", "📊", "System summary"],
    ["Attendance Approval", "✅", "Check attendance and recommend"],
    ["Employee Approval", "🆕", "Recommend new employee requests"],
    ["Resignation Approval", "📤", "Recommend resignation requests"],
    ["Petty Cash Approval", "🧾", "Recommend petty cash submissions"]
  ],
  principal: [
    ["Dashboard", "📊", "My school summary"],
    ["Attendance Entry", "📋", "Submit attendance"],
    ["Attendance Status", "🔎", "Submission status"],
    ["Petty Cash", "🧾", "Submit petty cash and bill photo"],
    ["Teachers", "👥", "My school staff"],
    ["New Employee", "🆕", "Submit new employee request"],
    ["Salary Sheet", "📄", "School salary PDF"],
    ["Payslips", "🧾", "Teacher payslips"],
    ["Resignation", "📤", "Submit resignation request"],
    ["Profile", "👤", "My account & profile"]
  ]
};

const state = {
  user: null,
  page: "Dashboard",
  cache: {},
  selectedApproval: null,
  showExceptionsOnly: false,
  attendance: { month: "", schoolCode: "", photos: [], staff: [] },
  step: 0,
  attendanceQuery: "",
  attendanceFilter: "all",
  expandedCards: {}
};

const MONTH_STORAGE_KEY = "ibfs_selected_month_v2";

// ==========================================================================
// Helper Utility Functions
// ==========================================================================
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] || c));
const money = n => "Rs. " + Number(n || 0).toLocaleString("en-PK");
const isAdmin = () => String(state.user?.role || "").toLowerCase() === "admin";
const isCoordinator = () => String(state.user?.role || "").toLowerCase() === "coordinator";
const isSchoolAssigned = (code) => {
  if (isAdmin()) return true;
  const userSchool = String(state.user?.schoolCode || "").trim();
  if (!userSchool) return false;
  const schools = userSchool.split(",").map(s => s.trim().toLowerCase());
  return schools.includes(String(code).trim().toLowerCase());
};
const month = () => $("globalMonth")?.value || currentMonth();
function currentMonth() {
  const saved = localStorage.getItem(MONTH_STORAGE_KEY);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(saved || "")) return saved;

  const today = new Date();
  const payrollDate = new Date(today.getFullYear(), today.getMonth(), 1);
  if (today.getDate() <= 10) payrollDate.setMonth(payrollDate.getMonth() - 1);
  const fallback = `${payrollDate.getFullYear()}-${String(payrollDate.getMonth() + 1).padStart(2, "0")}`;
  localStorage.setItem(MONTH_STORAGE_KEY, fallback);
  return fallback;
}
const msg = (t, type = "") => `<div class="message ${type}">${esc(t)}</div>`;
const setTitle = (t, s) => { 
  if ($("title")) $("title").textContent = t; 
  if ($("subtitle")) $("subtitle").textContent = s || ""; 
};
const js = v => String(v ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "").replace(/\n/g, "\\n");

// ==========================================================================
// Toast Notification Engine
// ==========================================================================
const TOAST_ICONS = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "ℹ",
  loading: null
};

const TOAST_TITLES = {
  success: "Success",
  error:   "Error",
  warning: "Warning",
  info:    "Info",
  loading: "Please wait…"
};

let _toastContainer = null;
function _getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement("div");
    _toastContainer.id = "toast-container";
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

/**
 * Show a toast notification
 * @param {string} message  — main text
 * @param {string} type     — "success" | "error" | "warning" | "info" | "loading"
 * @param {object} opts     — { title, duration, id }
 * @returns {HTMLElement}   — the toast element
 */
function toast(message, type = "info", opts = {}) {
  const container = _getToastContainer();
  const duration  = opts.duration ?? (type === "loading" ? 0 : type === "error" ? 5000 : 3500);
  const title     = opts.title   ?? TOAST_TITLES[type] ?? "Notice";
  const id        = opts.id;

  // Remove existing toast with same id
  if (id) {
    const existing = container.querySelector(`[data-toast-id="${id}"]`);
    if (existing) _dismissToast(existing, true);
  }

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  if (id) el.dataset.toastId = id;

  const iconHtml = type === "loading"
    ? `<div class="toast-spinner"></div>`
    : `<span>${TOAST_ICONS[type] || "ℹ"}</span>`;

  el.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Dismiss">✕</button>
    ${duration > 0 ? `<div class="toast-progress" style="animation-duration:${duration}ms;"></div>` : ""}
  `;

  el.querySelector(".toast-close").onclick = (e) => { e.stopPropagation(); _dismissToast(el); };
  el.onclick = () => _dismissToast(el);

  container.appendChild(el);

  if (duration > 0) {
    setTimeout(() => _dismissToast(el), duration);
  }

  // Keep max 5 toasts visible
  const toasts = container.querySelectorAll(".toast:not(.toast-hiding)");
  if (toasts.length > 5) _dismissToast(toasts[0], true);

  return el;
}

function _dismissToast(el, instant = false) {
  if (!el || el.classList.contains("toast-hiding")) return;
  if (instant) { el.remove(); return; }
  el.classList.add("toast-hiding");
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400); // safety fallback
}

// Convenience wrappers
function toastSuccess(msg, title)  { return toast(msg, "success", { title }); }
function toastError(msg, title)    { return toast(msg, "error",   { title, duration: 6000 }); }
function toastWarning(msg, title)  { return toast(msg, "warning", { title }); }
function toastInfo(msg, title)     { return toast(msg, "info",    { title }); }

// Loading toast — returns dismiss function
function toastLoading(msg = "Processing…") {
  const el = toast(msg, "loading", { id: "loading-toast" });
  return () => _dismissToast(el);
}

let content;

document.addEventListener("DOMContentLoaded", () => {
  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => console.log('Service Worker registered successfully.', reg))
      .catch((err) => console.warn('Service Worker registration failed:', err));
  }

  content = $("content");
  
  if ($("loginBtn")) $("loginBtn").onclick = login;
  if ($("logoutBtn")) $("logoutBtn").onclick = logout;
  if ($("menuBtn")) $("menuBtn").onclick = () => {
    const isOpen = $("sidebar").classList.toggle("open");
    $("app").classList.toggle("sidebar-open", isOpen);
    $("menuBtn").setAttribute("aria-expanded", String(isOpen));
  };
  if ($("closeSidebarBtn")) $("closeSidebarBtn").onclick = () => {
    $("sidebar").classList.remove("open");
    $("app").classList.remove("sidebar-open");
    $("menuBtn")?.setAttribute("aria-expanded", "false");
  };
  // Close sidebar on overlay click
  $("app")?.addEventListener("click", (e) => {
    if (e.target === $("app") && $("sidebar").classList.contains("open")) {
      $("sidebar").classList.remove("open");
      $("app").classList.remove("sidebar-open");
      $("menuBtn")?.setAttribute("aria-expanded", "false");
    }
  });
  
  if ($("globalMonth")) {
    $("globalMonth").value = currentMonth();
    $("globalMonth").onchange = () => {
      localStorage.setItem(MONTH_STORAGE_KEY, $("globalMonth").value);
      state.cache = {};
      renderPage();
    };
  }
  
  if ($("loginForm")) {
    $("loginForm").onsubmit = (e) => {
      e.preventDefault();
      login();
    };
  }
  
  updateNetworkStatus();
  
  const urlParams = new URLSearchParams(window.location.search);
  
  // --- IBFS PORTAL TOKEN INTERCEPTION ---
  const portalToken = urlParams.get("token");
  const portalApiUrl = urlParams.get("portalApiUrl");
  const portalAppId = urlParams.get("appId") || "salaryApp";

  if (portalToken && portalApiUrl) {
    if ($("loginView")) {
      $("loginView").style.display = "none";
      const loader = document.createElement("div");
      loader.id = "ssoLoader";
      loader.style.cssText = "position:fixed;inset:0;background:linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Outfit',sans-serif;";
      loader.innerHTML = `
        <div style="width:70px;height:70px;border:5px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:24px;box-shadow:0 0 20px rgba(99,102,241,0.2);"></div>
        <h2 style="color:#1e293b;font-size:24px;font-weight:700;margin:0 0 8px 0;letter-spacing:-0.5px;">Connecting to Central Portal</h2>
        <p style="color:#64748b;font-size:16px;margin:0;font-weight:500;">Please wait while we verify your secure session...</p>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
      `;
      document.body.appendChild(loader);
    }
    
    fetch(portalApiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "verifyAccess",
        token: portalToken,
        appId: portalAppId
      })
    })
    .then(res => res.json())
    .then(data => {
      if ($("ssoLoader")) $("ssoLoader").remove();
      if (data.status === "success" && data.allowed) {
        state.user = data.user;
        sessionStorage.setItem("ibfs_user", JSON.stringify(data.user));
        
        window.history.replaceState({}, document.title, window.location.pathname);
        afterLogin();
      } else {
        if ($("loginView")) $("loginView").style.display = "flex";
        if ($("loginMsg")) $("loginMsg").innerHTML = msg(data.message || "Invalid Portal Session.", "bad");
      }
    })
    .catch(e => {
      if ($("ssoLoader")) $("ssoLoader").remove();
      if ($("loginView")) $("loginView").style.display = "flex";
      if ($("loginMsg")) $("loginMsg").innerHTML = msg("Portal connection failed.", "bad");
    });
    
    return;
  }
  // --- END PORTAL TOKEN INTERCEPTION ---

  const demoRole = urlParams.get("demo");
  if (demoRole === "admin") {
    state.user = {
      success: true,
      role: "admin",
      email: "admin@ibfs.com",
      name: "Admin Tester (Demo)",
      schoolCode: "",
      sessionToken: "demo-admin-session-999"
    };
    sessionStorage.setItem("ibfs_user", JSON.stringify(state.user));
  } else if (demoRole === "coordinator") {
    state.user = {
      success: true,
      role: "coordinator",
      email: "coordinator@ibfs.com",
      name: "Coordinator Tester (Demo)",
      schoolCode: "230101018,230101020",
      sessionToken: "demo-coordinator-session-777"
    };
    sessionStorage.setItem("ibfs_user", JSON.stringify(state.user));
  } else if (demoRole === "principal") {
    state.user = {
      success: true,
      role: "principal",
      email: "principal@ibfs.com",
      name: "Principal Tester (Demo)",
      schoolCode: "230101018",
      sessionToken: "demo-principal-session-888"
    };
    sessionStorage.setItem("ibfs_user", JSON.stringify(state.user));
  }

  const saved = sessionStorage.getItem("ibfs_user");
  if (saved) { 
    try { 
      state.user = JSON.parse(saved); 
      afterLogin(); 
    } catch (e) { 
      sessionStorage.removeItem("ibfs_user"); 
    } 
  }
});

// ==========================================================================
// Persistent Caching & API Request Handlers
// ==========================================================================
function cacheKey(action, params) { 
  return action + ":" + JSON.stringify(params); 
}

function persistentKey(key) { 
  return "ibfs_cache:" + key; 
}

function readPersistent(key) {
  try {
    const found = JSON.parse(localStorage.getItem(persistentKey(key)) || "null");
    if (found && Date.now() - found.t < CONFIG.persistentCacheMs) return found;
  } catch (e) {}
  return null;
}

function writePersistent(key, value) {
  try { 
    localStorage.setItem(persistentKey(key), JSON.stringify({ t: Date.now(), v: value })); 
  } catch (e) {}
}

function clearLocalCache() {
  const keys = Object.keys(localStorage);
  let count = 0;
  keys.forEach(k => {
    if (k.startsWith("ibfs_cache:")) {
      localStorage.removeItem(k);
      count++;
    }
  });
  state.cache = {};
  addAuditLog("Clear Cache", `Cleared ${count} cached items from local storage`);
  return count;
}

function authParams(params = {}) {
  return state.user?.sessionToken ? { ...params, sessionToken: state.user.sessionToken } : params;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { 
    clearTimeout(timer); 
  }
}

function checkSessionExpired(json) {
  if (json && json.success === false && json.message && 
      (json.message.toLowerCase().includes("session expired") || 
       json.message.toLowerCase().includes("login again"))) {
    sessionStorage.removeItem("ibfs_user");
    toastError("Your session has expired. Please login again.", "Session Expired");
    location.reload();
    return true;
  }
  return false;
}

async function apiGet(action, params = {}, useCache = true) {
  params = authParams(params);
  
  // Demo Sandbox Mode mock responses
  if (state.user?.sessionToken && state.user.sessionToken.startsWith("demo-")) {
    return handleDemoGet(action, params);
  }

  const key = cacheKey(action, params);
  const found = state.cache[key];
  if (useCache && found && Date.now() - found.t < CONFIG.cacheMs) return found.v;
  const q = new URLSearchParams({ action, ...params });
  try {
    const json = await fetchJson(`${CONFIG.apiBaseUrl}?${q.toString()}`);
    if (checkSessionExpired(json)) {
      return json;
    }
    if (useCache) { 
      state.cache[key] = { t: Date.now(), v: json }; 
      writePersistent(key, json); 
    }
    return json;
  } catch (error) {
    const offline = useCache && readPersistent(key);
    if (offline) return { ...offline.v, _offline: true };
    throw error;
  }
}

async function apiPost(payload) {
  payload = authParams(payload);
  
  // Demo Sandbox Mode mock responses
  if (state.user?.sessionToken && state.user.sessionToken.startsWith("demo-")) {
    return handleDemoPost(payload);
  }

  const json = await fetchJson(CONFIG.apiBaseUrl, {
    method: "POST", 
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  if (checkSessionExpired(json)) {
    return json;
  }
  state.cache = {}; // Invalidate read caches on writes
  return json;
}

// ==========================================================================
// Audit Logs Simulation System
// ==========================================================================
function addAuditLog(action, details) {
  try {
    const logs = JSON.parse(localStorage.getItem("ibfs_audit_logs") || "[]");
    logs.unshift({
      t: Date.now(),
      user: state.user?.email || "Guest",
      action,
      details
    });
    // Cap at 200 logs to prevent storage bloating
    localStorage.setItem("ibfs_audit_logs", JSON.stringify(logs.slice(0, 200)));
  } catch (e) {
    console.error("Failed to add audit log:", e);
  }
}

function getAuditLogs() {
  try {
    return JSON.parse(localStorage.getItem("ibfs_audit_logs") || "[]");
  } catch (e) {
    return [];
  }
}

// ==========================================================================
// Demo Sandbox Mock Data Handlers
// ==========================================================================
function initDemoDb() {
  if (sessionStorage.getItem("ibfs_demo_db")) {
    try {
      window.demoDb = JSON.parse(sessionStorage.getItem("ibfs_demo_db"));
      return;
    } catch(e) {}
  }
  
  window.demoDb = {
    employeeRequests: [
      { requestId: "demo-req-1", schoolCode: "230101018", employeeName: "Kashif Ali", cnic: "42101-9876543-1", qualification: "M.Sc Mathematics", designation: "SST Teacher", basicSalary: 40000, accountTitle: "Kashif Ali", accountNo: "1234567890", bankName: "National Bank of Pakistan", joiningDate: "2026-06-01", photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150", certificateUrl: "", status: "Pending" },
      { requestId: "demo-req-2", schoolCode: "230101020", employeeName: "Yasmin Khan", cnic: "42101-1234567-2", qualification: "B.Ed English", designation: "PST Teacher", basicSalary: 30000, accountTitle: "Yasmin Khan", accountNo: "0987654321", bankName: "National Bank of Pakistan", joiningDate: "2026-06-05", photoUrl: "", certificateUrl: "", status: "Pending" }
    ],
    resignationRequests: [
      { requestId: "demo-res-1", schoolCode: "230101018", employeeId: "EMP-105", employeeName: "Farzana Parveen", resignationDate: "2026-06-30", reason: "Better opportunity elsewhere", photoUrl: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300", status: "Pending" }
    ],
    attendanceForApproval: [
      {
        schoolCode: "230101018",
        month: currentMonth(),
        approvalStatus: "Pending",
        totalTeachers: 3,
        RegisterPhotoURLs: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300",
        teachers: [
          { employeeId: "EMP-101", employeeName: "Abdul Karim", absent: 0, cl: 1, medicalLeave: 0, withoutPayLeave: 0, deductionDays: 0, approvalStatus: "Pending" },
          { employeeId: "EMP-102", employeeName: "Zahid Hussain", absent: 1, cl: 0, medicalLeave: 0, withoutPayLeave: 0, deductionDays: 1, approvalStatus: "Pending" },
          { employeeId: "EMP-104", employeeName: "Muhammad Ali", absent: 0, cl: 0, medicalLeave: 0, withoutPayLeave: 1, deductionDays: 1, approvalStatus: "Pending" }
        ]
      },
      {
        schoolCode: "230101020",
        month: currentMonth(),
        approvalStatus: "Pending",
        totalTeachers: 2,
        RegisterPhotoURLs: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300",
        teachers: [
          { employeeId: "EMP-201", employeeName: "Sana Gul", absent: 0, cl: 0, medicalLeave: 0, withoutPayLeave: 0, deductionDays: 0, approvalStatus: "Pending" },
          { employeeId: "EMP-202", employeeName: "Tariq Jamil", absent: 2, cl: 0, medicalLeave: 0, withoutPayLeave: 0, deductionDays: 2, approvalStatus: "Pending" }
        ]
      }
    ],
    pettyCashSubmissions: [
      { SubmissionID: "demo-pc-1", SchoolCode: "230101018", EmployeeID: "EMP-101", PettyCash: 12000, PettyCashDetail: "Office cleaning supplies and minor repair of classroom board.", BillPhotoURL: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300", Status: "Submitted", Month: currentMonth() },
      { SubmissionID: "demo-pc-2", SchoolCode: "230101020", EmployeeID: "EMP-201", PettyCash: 8500, PettyCashDetail: "Drinking water supply and chalk box purchase.", BillPhotoURL: "", Status: "Submitted", Month: currentMonth() }
    ],
    pettyCashRecipients: [
      { EmployeeID: "EMP-101", EmployeeName: "Abdul Karim", AccountTitle: "Abdul Karim Petty Cash", SchoolCode: "230101018" },
      { EmployeeID: "EMP-201", EmployeeName: "Sana Gul", AccountTitle: "Sana Gul Petty Cash", SchoolCode: "230101020" }
    ],
    teachers: [
      { employeeId: "EMP-101", employeeName: "Abdul Karim", designation: "Principal", basicSalary: 65000, deductionAmount: 0, netSalary: 65000, schoolCode: "230101018" },
      { employeeId: "EMP-102", employeeName: "Zahid Hussain", designation: "Senior Teacher", basicSalary: 45000, deductionAmount: 1500, netSalary: 43500, schoolCode: "230101018" },
      { employeeId: "EMP-103", employeeName: "Sobia Naz", designation: "Junior Teacher", basicSalary: 35000, deductionAmount: 0, netSalary: 35000, schoolCode: "230101018" },
      { employeeId: "EMP-104", employeeName: "Muhammad Ali", designation: "PST Teacher", basicSalary: 32000, deductionAmount: 3200, netSalary: 28800, schoolCode: "230101018" },
      { employeeId: "EMP-105", employeeName: "Farzana Parveen", designation: "Naib Qasid", basicSalary: 20000, deductionAmount: 0, netSalary: 20000, schoolCode: "230101018" },
      { employeeId: "EMP-201", employeeName: "Sana Gul", designation: "Principal", basicSalary: 60000, deductionAmount: 0, netSalary: 60000, schoolCode: "230101020" },
      { employeeId: "EMP-202", employeeName: "Tariq Jamil", designation: "SST Teacher", basicSalary: 40000, deductionAmount: 2666, netSalary: 37334, schoolCode: "230101020" }
    ]
  };
  sessionStorage.setItem("ibfs_demo_db", JSON.stringify(window.demoDb));
}

function saveDemoDb() {
  sessionStorage.setItem("ibfs_demo_db", JSON.stringify(window.demoDb));
}

function handleDemoGet(action, params) {
  initDemoDb();
  
  if (action === "dashboard") {
    const isAdm = String(state.user.role).toLowerCase() === "admin";
    const isCoord = String(state.user.role).toLowerCase() === "coordinator";
    const assignedSchool = String(state.user.schoolCode || "");
    const filterSchool = (sc) => {
      if (isAdm) return true;
      const list = assignedSchool.split(",").map(x => x.trim().toLowerCase());
      return list.includes(String(sc).trim().toLowerCase());
    };
    
    const teachersList = window.demoDb.teachers.filter(t => filterSchool(t.schoolCode));
    
    const totalDeduction = teachersList.reduce((sum, t) => sum + (t.deductionAmount || 0), 0);
    const totalNet = teachersList.reduce((sum, t) => sum + (t.netSalary || 0), 0);
    const totalGross = teachersList.reduce((sum, t) => sum + (t.basicSalary || 0), 0);
    
    const assignedAtt = window.demoDb.attendanceForApproval.filter(it => filterSchool(it.schoolCode));
    const pendingAtt = assignedAtt.filter(it => String(it.approvalStatus || "Pending").toLowerCase() === "pending").length;
    const recommendedAtt = assignedAtt.filter(it => String(it.approvalStatus).toLowerCase() === "recommended").length;
    const approvedAtt = assignedAtt.filter(it => String(it.approvalStatus).toLowerCase() === "approved").length;
    const totalSchools = isCoord
      ? String(state.user?.schoolCode || "").split(",").map(s => s.trim()).filter(Boolean).length
      : [...new Set(teachersList.map(t => t.schoolCode))].length;
    
    const cards = {
      totalSchools: totalSchools || 1,
      totalEmployees: teachersList.length,
      totalDeductionAmount: totalDeduction,
      pendingAttendanceSchools: pendingAtt,
      recommendedAttendanceSchools: recommendedAtt,
      approvedAttendanceSchools: approvedAtt
    };
    
    if (isAdm) {
      cards.grossSalary = totalGross || 3650000;
      cards.netSalary = totalNet || 3505000;
      cards.totalSchools = 18;
      cards.totalEmployees = 114;
    } else if (isCoord) {
      cards.totalSchools = totalSchools;
      cards.totalEmployees = teachersList.length;
    } else {
      return {
        success: true,
        cards: {
          mySchoolTeachers: teachersList.length,
          grossSalary: totalGross,
          totalDeductionAmount: totalDeduction,
          netSalary: totalNet,
          attendanceStatus: assignedAtt[0]?.approvalStatus || "Pending"
        },
        teachers: teachersList
      };
    }
    
    return {
      success: true,
      cards: cards,
      teachers: teachersList,
      schoolWise: [
        { schoolCode: "230101018", totalEmployees: 5, netSalary: 192300 },
        { schoolCode: "230101020", totalEmployees: 8, netSalary: 295000 }
      ].filter(sw => filterSchool(sw.schoolCode))
    };
  }
  
  if (action === "attendanceStatus") {
    const sc = state.user.schoolCode || "230101018";
    const att = window.demoDb.attendanceForApproval.find(it => it.schoolCode === sc) || {};
    return {
      success: true,
      status: att.approvalStatus || "Pending",
      month: month(),
      schoolCode: sc,
      totalTeachers: att.teachers ? att.teachers.length : 3,
      RegisterPhotoURLs: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300",
      rejectReason: ""
    };
  }
  
  if (action === "employeeRequests") {
    return {
      success: true,
      items: window.demoDb.employeeRequests
    };
  }
  
  if (action === "resignationRequests") {
    return {
      success: true,
      items: window.demoDb.resignationRequests
    };
  }
  
  if (action === "attendanceForApproval") {
    return {
      success: true,
      items: window.demoDb.attendanceForApproval
    };
  }
  
  if (action === "pettyCashSubmissions") {
    return {
      success: true,
      submissions: window.demoDb.pettyCashSubmissions
    };
  }
  
  if (action === "pettyCashRecipients") {
    return {
      success: true,
      recipients: window.demoDb.pettyCashRecipients
    };
  }
  
  if (action === "payslip") {
    const empId = params.employeeId || "EMP-101";
    const t = window.demoDb.teachers.find(x => x.employeeId === empId) || {};
    return {
      success: true,
      payslip: {
        EmployeeName: t.employeeName || "Abdul Karim",
        EmployeeID: empId,
        BasicSalary: t.basicSalary || 65000,
        TotalDeductionDays: t.deductionAmount ? 1 : 0,
        DeductionAmount: t.deductionAmount || 0,
        NetSalary: t.netSalary || 65000
      }
    };
  }
  
  return { success: true };
}

function handleDemoPost(payload) {
  initDemoDb();
  const action = payload.action;
  
  return new Promise((resolve) => {
    setTimeout(() => {
      if (action === "approveAttendance") {
        const schoolCode = payload.schoolCode;
        const empId = payload.employeeId;
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          const t = school.teachers.find(x => x.employeeId === empId);
          if (t) t.approvalStatus = "Approved";
          const allApproved = school.teachers.every(x => x.approvalStatus === "Approved");
          if (allApproved) school.approvalStatus = "Approved";
        }
        saveDemoDb();
      }
      else if (action === "recommendAttendance") {
        const schoolCode = payload.schoolCode;
        const empId = payload.employeeId;
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          const t = school.teachers.find(x => x.employeeId === empId);
          if (t) t.approvalStatus = "Recommended";
          const allRec = school.teachers.every(x => x.approvalStatus === "Recommended");
          if (allRec) school.approvalStatus = "Recommended";
        }
        saveDemoDb();
      }
      else if (action === "approveAllAttendance") {
        const schoolCode = payload.schoolCode;
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          school.approvalStatus = "Approved";
          school.teachers.forEach(x => x.approvalStatus = "Approved");
        }
        saveDemoDb();
      }
      else if (action === "recommendAllAttendance") {
        const schoolCode = payload.schoolCode;
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          school.approvalStatus = "Recommended";
          school.teachers.forEach(x => x.approvalStatus = "Recommended");
        }
        saveDemoDb();
      }
      else if (action === "approveSelectedAttendance") {
        const schoolCode = payload.schoolCode;
        const ids = payload.employeeIds || [];
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          school.teachers.forEach(x => {
            if (ids.includes(x.employeeId)) x.approvalStatus = "Approved";
          });
          const allApproved = school.teachers.every(x => x.approvalStatus === "Approved");
          if (allApproved) school.approvalStatus = "Approved";
        }
        saveDemoDb();
      }
      else if (action === "recommendSelectedAttendance") {
        const schoolCode = payload.schoolCode;
        const ids = payload.employeeIds || [];
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          school.teachers.forEach(x => {
            if (ids.includes(x.employeeId)) x.approvalStatus = "Recommended";
          });
          const allRec = school.teachers.every(x => x.approvalStatus === "Recommended");
          if (allRec) school.approvalStatus = "Recommended";
        }
        saveDemoDb();
      }
      else if (action === "rejectAttendance" || action === "rejectSelectedAttendance") {
        const schoolCode = payload.schoolCode;
        const ids = payload.employeeId ? [payload.employeeId] : (payload.employeeIds || []);
        const school = window.demoDb.attendanceForApproval.find(x => x.schoolCode === schoolCode);
        if (school) {
          school.approvalStatus = "Rejected";
          school.teachers.forEach(x => {
            if (ids.includes(x.employeeId)) x.approvalStatus = "Rejected";
          });
        }
        saveDemoDb();
      }
      else if (action === "approveEmployeeRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.employeeRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Approved";
          window.demoDb.teachers.push({
            employeeId: "EMP-" + (100 + window.demoDb.teachers.length + 1),
            employeeName: req.employeeName,
            designation: req.designation,
            basicSalary: req.basicSalary,
            deductionAmount: 0,
            netSalary: req.basicSalary,
            schoolCode: req.schoolCode
          });
          window.demoDb.employeeRequests = window.demoDb.employeeRequests.filter(x => x.requestId !== reqId);
        }
        saveDemoDb();
      }
      else if (action === "recommendEmployeeRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.employeeRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Recommended";
        }
        saveDemoDb();
      }
      else if (action === "rejectEmployeeRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.employeeRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Rejected";
          window.demoDb.employeeRequests = window.demoDb.employeeRequests.filter(x => x.requestId !== reqId);
        }
        saveDemoDb();
      }
      else if (action === "approveResignationRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.resignationRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Approved";
          const t = window.demoDb.teachers.find(x => x.employeeId === req.employeeId);
          if (t) t.resigned = true;
          window.demoDb.resignationRequests = window.demoDb.resignationRequests.filter(x => x.requestId !== reqId);
        }
        saveDemoDb();
      }
      else if (action === "recommendResignationRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.resignationRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Recommended";
        }
        saveDemoDb();
      }
      else if (action === "rejectResignationRequest") {
        const reqId = payload.requestId;
        const req = window.demoDb.resignationRequests.find(x => x.requestId === reqId);
        if (req) {
          req.status = "Rejected";
          window.demoDb.resignationRequests = window.demoDb.resignationRequests.filter(x => x.requestId !== reqId);
        }
        saveDemoDb();
      }
      else if (action === "reviewPettyCash") {
        const subId = payload.submissionId;
        const dec = payload.decision;
        const sub = window.demoDb.pettyCashSubmissions.find(x => x.SubmissionID === subId);
        if (sub) {
          sub.Status = dec;
        }
        saveDemoDb();
      }
      
      resolve({
        success: true,
        message: `Demo Mode: Action "${action}" executed successfully.`,
        downloadUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        pdfUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
      });
    }, 1000);
  });
}

// ==========================================================================
// Authentication Logic
// ==========================================================================
async function login() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value.trim();
  if (!email || !password) { 
    $("loginMsg").innerHTML = msg("Email and password are required.", "bad"); 
    return; 
  }
  
  $("loginBtn").disabled = true; 
  $("loginMsg").innerHTML = msg("Signing in securely...", "ok");
  

  try {
    const r = await apiPost({ action: "login", email, password });
    if (!r.success) { 
      $("loginMsg").innerHTML = msg(r.message || "Invalid login credentials.", "bad"); 
      addAuditLog("Login Failure", `Failed login attempt for ${email}: ${r.message}`);
      return; 
    }
    
    state.user = r; 
    sessionStorage.setItem("ibfs_user", JSON.stringify(r)); 
    addAuditLog("Login Success", `User logged in with role: ${r.role}`);
    afterLogin();
  } catch (e) { 
    $("loginMsg").innerHTML = msg("Connection failed: " + e.message + " (" + e.toString() + "). Check internet or API settings.", "bad"); 
  } finally { 
    $("loginBtn").disabled = false; 
  }
}

function logout() {
  addAuditLog("Logout", "User logged out of the session");
  sessionStorage.removeItem("ibfs_user"); 
  location.reload(); 
}

function afterLogin() {
  if (!state.user.schoolCode && state.user.SchoolCode) {
    state.user.schoolCode = state.user.SchoolCode;
  }
  
  $("loginView").classList.add("hidden"); 
  $("app").classList.remove("hidden");
  
  $("sideName").textContent = state.user.name || state.user.email;
  $("sideMeta").textContent = `${state.user.role.toUpperCase()} · ${state.user.schoolCode || "ALL SCHOOLS"}`;
  
  // Set avatar letter
  const nameLetter = (state.user.name || state.user.email || "U").charAt(0).toUpperCase();
  $("avatarName").textContent = nameLetter;
  
  $("schoolPill").textContent = `🏫 ${state.user.schoolCode || "ALL"}`;
  
  if(isAdmin() || isCoordinator()){
    $("sidebar").classList.remove("hidden");
    document.querySelector(".main-wrapper").style.marginLeft = "";
    document.querySelector(".main-wrapper").style.width = "";
    $("menuBtn").classList.remove("hidden");
  } else {
    $("sidebar").classList.add("hidden");
    document.querySelector(".main-wrapper").style.marginLeft = "0";
    document.querySelector(".main-wrapper").style.width = "100%";
    $("menuBtn").classList.add("hidden");
  }
  
  renderMenu(); 
  renderPage();
}

function renderMenu() {
  const roleKey = isAdmin() ? "admin" : (isCoordinator() ? "coordinator" : "principal");
  const userMenu = MENUS[roleKey];
  $("menu").innerHTML = userMenu.map(m =>
    `<button class="${m[0] === state.page ? "active" : ""}" onclick="openPage('${m[0]}')" title="${m[2]}" aria-current="${m[0] === state.page ? 'page' : 'false'}">
      <span class="icon" aria-hidden="true">${m[1]}</span>
      <span>${m[0]}</span>
     </button>`
  ).join("");
}

function openPage(p) { 
  state.page = p; 
  $("sidebar").classList.remove("open"); 
  renderMenu(); 
  renderPage(); 
}

function skeleton(text = "Loading data from backend...") { 
  content.innerHTML = `
    <div class="card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px; gap: 20px; border: 0; background: var(--bg-card);">
      <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 320px;">
        <div class="skeleton-loader" style="height: 14px; width: 70%; border-radius: 99px;"></div>
        <div class="skeleton-loader" style="height: 14px; width: 50%; border-radius: 99px;"></div>
        <div class="skeleton-loader" style="height: 14px; width: 85%; border-radius: 99px;"></div>
      </div>
      <p class="muted" style="font-size: 13px; font-weight: 500;">${esc(text)}</p>
    </div>`; 
}

// ==========================================================================
// Dashboard Screen
// ==========================================================================
function timeAgo(t) {
  const diff = Date.now() - Number(t);
  if (isNaN(diff) || diff < 0) return "Just now";
  if (diff < 60000) return "Just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function dashboard() {
  setTitle(isAdmin() ? "Admin Dashboard" : (isCoordinator() ? "Coordinator Dashboard" : "Principal Dashboard"), "Fast live summary from Apps Script");
  if(isAdmin() || isCoordinator()){
    skeleton("Loading system summary...");
    try {
      const r = await apiGet("dashboard", { email: state.user.email, month: month() });
      if (!r.success) { 
        content.innerHTML = msg(r.message || "Dashboard loading failed.", "bad"); 
        return; 
      }
      
      const c = r.cards || {};
      const modules = MENUS[isAdmin() ? "admin" : "coordinator"].filter(x => x[0] !== "Dashboard");
      
      // Fetch recent activities
      const logs = getAuditLogs().slice(0, 6);
      let logsHtml = "";
      if (logs.length > 0) {
        logsHtml = logs.map((l, i) => {
          let badgeClass = "pending";
          const action = String(l.action || "");
          if (action.includes("Approve") || action.includes("Success") || action.includes("Submitted") || action.includes("Recommended") || action.includes("Recommend")) {
            badgeClass = "approved";
          } else if (action.includes("Failure") || action.includes("Reject") || action.includes("Offline")) {
            badgeClass = "rejected";
          }
          const userLetter = (l.user || "U").charAt(0).toUpperCase();
          return `
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border-color, #e2e8f0); transition: background 0.15s;" onmouseenter="this.style.background='hsl(245,100%,99%)'" onmouseleave="this.style.background=''">
              <div style="width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, var(--primary-light), hsl(245,70%,90%)); display: grid; place-items: center; font-weight: 800; font-size: 13px; color: var(--primary); flex-shrink: 0; border: 1.5px solid var(--border-color);">
                ${userLetter}
              </div>
              <div style="flex-grow: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                  <span class="status ${badgeClass}" style="padding: 2px 9px; font-size: 10px;">${esc(l.action)}</span>
                  <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">${timeAgo(l.t)}</span>
                </div>
                <p style="font-size: 12.5px; font-weight: 500; color: var(--text-main); margin: 0; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(l.details)}</p>
              </div>
            </div>
          `;
        }).join("");
      } else {
        logsHtml = `<div style="text-align: center; padding: 28px 20px;"><span style="font-size: 28px; display: block; margin-bottom: 10px;">📋</span><p class="muted" style="margin: 0; font-size: 13px; font-weight: 500;">No portal activity recorded yet.</p></div>`;
      }
      
      let statsHtml = "";
      let secondaryStatsHtml = "";
      
      if (isAdmin()) {
        statsHtml = `
          <div class="grid stats" style="margin-bottom: 16px;">
            <div class="card stat grad-indigo">
              <span>🏫</span>
              <strong>${c.totalSchools ?? 0}</strong>
              <small>Total Schools</small>
            </div>
            <div class="card stat grad-blue">
              <span>👥</span>
              <strong>${c.totalEmployees ?? 0}</strong>
              <small>Total Employees</small>
            </div>
            <div class="card stat grad-amber">
              <span>💰</span>
              <strong>${money(c.grossSalary)}</strong>
              <small>Gross Salary</small>
            </div>
            <div class="card stat grad-emerald">
              <span>✅</span>
              <strong>${money(c.netSalary)}</strong>
              <small>Net Salary</small>
            </div>
          </div>
        `;
        secondaryStatsHtml = `
          <div class="grid stats" style="grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px;">
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">🟡</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Pending Attendance</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #d97706; font-weight: 800;">${c.pendingAttendanceSchools ?? 0}</strong>
              </div>
            </div>
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">🟢</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Approved Attendance</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #166534; font-weight: 800;">${c.approvedAttendanceSchools ?? 0}</strong>
              </div>
            </div>
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">📉</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Total Deductions</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #991b1b; font-weight: 800;">${money(c.totalDeductionAmount)}</strong>
              </div>
            </div>
          </div>
        `;
      } else {
        statsHtml = `
          <div class="grid stats" style="margin-bottom: 16px; grid-template-columns: repeat(2, 1fr);">
            <div class="card stat grad-indigo">
              <span>🏫</span>
              <strong>${c.totalSchools ?? 0}</strong>
              <small>Total Assigned Schools</small>
            </div>
            <div class="card stat grad-blue">
              <span>👥</span>
              <strong>${c.totalEmployees ?? 0}</strong>
              <small>Total Employees</small>
            </div>
          </div>
        `;
        secondaryStatsHtml = `
          <div class="grid stats" style="grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px;">
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">🟡</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Pending Recommendation</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #d97706; font-weight: 800;">${c.pendingAttendanceSchools ?? 0}</strong>
              </div>
            </div>
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">🔵</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Recommended by Me</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #3b82f6; font-weight: 800;">${c.recommendedAttendanceSchools ?? 0}</strong>
              </div>
            </div>
            <div class="card stat" style="padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); background: var(--bg-card);">
              <span style="font-size: 20px;">🟢</span>
              <div style="text-align: left;">
                <small class="muted" style="font-size: 10px; text-transform: uppercase; font-weight: bold; display: block; line-height: 1;">Approved by Admin</small>
                <strong style="font-size: 16px; display: block; margin-top: 4px; color: #166534; font-weight: 800;">${c.approvedAttendanceSchools ?? 0}</strong>
              </div>
            </div>
          </div>
        `;
      }
      
      content.innerHTML = `
        ${r._offline ? msg("⚠️ Offline viewing mode. Displaying cached dashboard data.", "bad") : ""}
        
        <div class="card hero-card" style="margin-bottom: 24px; padding: 28px 32px; position: relative; overflow: hidden;">
          <div style="position: relative; z-index: 1;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,0.15); display: grid; place-items: center; font-size: 20px; backdrop-filter: blur(4px);">${isAdmin() ? "🏛️" : "📋"}</div>
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.5);">${isAdmin() ? "Admin Dashboard" : "Coordinator Dashboard"}</span>
            </div>
            <h2 style="margin: 0 0 6px; font-weight: 900; color: #ffffff; font-size: 24px; letter-spacing: -0.5px;">Welcome back, ${esc((state.user.name || state.user.email).split(" ")[0])}! 👋</h2>
            <p style="margin: 0; color: rgba(255,255,255,0.55); font-size: 13.5px; line-height: 1.5;">Current payroll period: <span style="color: rgba(255,255,255,0.85); font-weight: 700;">${esc(month())}</span></p>
          </div>
        </div>

        ${statsHtml}
        ${secondaryStatsHtml}

        <div class="dashboard-layout">
          <div class="modules-column">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <h3 style="margin: 0; font-weight: 800; font-size: 15px; color: var(--text-main);">Quick Access Modules</h3>
              <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">${modules.length} modules</span>
            </div>
            <div class="grid modules" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px;">
              ${modules.map(m => `
                <button class="card module" onclick="openPage('${m[0]}')">
                   <span class="module-icon">${m[1]}</span>
                   <h3>${m[0]}</h3>
                   <p>${m[2]}</p>
                </button>`).join("")}
            </div>
          </div>
          
          <div class="activity-column">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <h3 style="margin: 0; font-weight: 800; font-size: 15px; color: var(--text-main);">Recent Activity</h3>
              <span class="status pending" style="font-size: 10.5px; padding: 3px 10px;">Live</span>
            </div>
            <div class="card" style="padding: 4px 0;">
              ${logsHtml}
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      content.innerHTML = msg("Dashboard API connection error: " + e.message + " (" + e.toString() + "). Please check settings.", "bad");
    }
  } else {
    // Principal Single-Screen Home Hub
    let attStatusText = "Loading status...";
    let staffCountText = "";
    try {
      const dbResult = await apiGet("dashboard", { email: state.user.email, month: month() });
      const staffList = await loadTeachers();
      
      if (dbResult.success) {
        const s = String(dbResult.cards?.attendanceStatus || "Not Submitted").toLowerCase();
        const displayStatus = dbResult.cards?.attendanceStatus || "Not Submitted";
        const badgeClass = s==="approved" ? "approved" : s==="rejected" ? "rejected" : "pending";
        attStatusText = `<span class="status ${badgeClass}" style="padding: 2px 8px; font-size:11px; font-weight:bold;">${displayStatus}</span>`;
      } else {
        attStatusText = `<span class="status pending" style="padding: 2px 8px; font-size:11px; font-weight:bold;">Not Submitted</span>`;
      }

      if (staffList && staffList.length) {
        staffCountText = `<span style="font-size: 12px; font-weight: 600; color: var(--text-muted); display: block; margin-top: 6px;">👤 ${staffList.length} Staff Members Registered</span>`;
      }
    } catch(e) {
      attStatusText = `<span class="status pending" style="padding: 2px 8px; font-size:11px; font-weight:bold;">Unknown</span>`;
    }

    content.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px; margin-top:10px;">
        <!-- Attendance Card (Blue) -->
        <div class="card" style="border-top: 5px solid var(--primary); display:flex; flex-direction:column; justify-content:space-between; min-height: 180px;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size: 32px;">📋</span>
              <div>${attStatusText}</div>
            </div>
            <h3 style="margin: 8px 0 6px 0; color: var(--primary);">Attendance</h3>
            <p class="muted" style="margin: 0; font-size: 13px;">Submit monthly attendance and verify submission status.</p>
            ${staffCountText}
          </div>
          <div style="margin-top: 15px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn primary full" onclick="openPage('Attendance Entry')">Submit Monthly Attendance</button>
            <button class="btn secondary full" onclick="openPage('Attendance Status')">Check Submission Status</button>
          </div>
        </div>

        <!-- Petty Cash Card (Orange) -->
        <div class="card" style="border-top: 5px solid var(--warning); display:flex; flex-direction:column; justify-content:space-between; min-height: 180px;">
          <div>
            <div style="font-size: 32px; margin-bottom: 8px;">🧾</div>
            <h3 style="margin: 0 0 6px 0; color: var(--warning);">Petty Cash & Bills</h3>
            <p class="muted" style="margin: 0; font-size: 13px;">Submit school expenditures and view previous bills.</p>
          </div>
          <div style="margin-top: 15px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn warning full" style="color: white; background: var(--warning);" onclick="openPage('Petty Cash')">Submit Bills & Petty Cash</button>
          </div>
        </div>

        <!-- Staff Card (Purple) -->
        <div class="card" style="border-top: 5px solid #8b5cf6; display:flex; flex-direction:column; justify-content:space-between; min-height: 180px;">
          <div>
            <div style="font-size: 32px; margin-bottom: 8px;">👥</div>
            <h3 style="margin: 0 0 6px 0; color: #8b5cf6;">Staff Management</h3>
            <p class="muted" style="margin: 0; font-size: 13px;">Manage active school staff, add new employees, or submit resignations.</p>
          </div>
          <div style="margin-top: 15px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn primary full" style="background: #8b5cf6;" onclick="openPage('Teachers')">View My Staff List</button>
            <button class="btn secondary full" onclick="openPage('New Employee')">Request New Employee</button>
            <button class="btn secondary full" onclick="openPage('Resignation')">Submit Resignation Request</button>
          </div>
        </div>

        <!-- Salaries & Documents Card (Green) -->
        <div class="card" style="border-top: 5px solid var(--success); display:flex; flex-direction:column; justify-content:space-between; min-height: 180px;">
          <div>
            <div style="font-size: 32px; margin-bottom: 8px;">📄</div>
            <h3 style="margin: 0 0 6px 0; color: var(--success);">Salaries & Payslips</h3>
            <p class="muted" style="margin: 0; font-size: 13px;">Download school salary sheet PDF and individual teacher payslip PDFs.</p>
          </div>
          <div style="margin-top: 15px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn success full" onclick="openPage('Salary Sheet')">Download Salary Sheet PDF</button>
            <button class="btn secondary full" onclick="openPage('Payslips')">Browse & Download Payslips</button>
          </div>
        </div>

        <!-- Profile Card (Gray) -->
        <div class="card" style="border-top: 5px solid var(--muted); display:flex; flex-direction:column; justify-content:space-between; min-height: 180px;">
          <div>
            <div style="font-size: 32px; margin-bottom: 8px;">👤</div>
            <h3 style="margin: 0 0 6px 0; color: var(--muted);">Profile & System</h3>
            <p class="muted" style="margin: 0; font-size: 13px;">Manage your account credentials, clear offline cache, or sign out.</p>
          </div>
          <div style="margin-top: 15px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn secondary full" onclick="openPage('Profile')">My Profile & Cache</button>
            <button class="btn danger full" onclick="logout()">Logout</button>
          </div>
        </div>
      </div>
    `;
  }
}

// ==========================================================================
// Teachers (Principal) & Employees (Admin) Screen
// ==========================================================================
function normalizeTeacher(t) {
  if (!t) return null;
  return {
    employeeId: String(t.EmployeeID || t.employeeId || t.EmployeeId || "").trim(),
    employeeName: String(t.EmployeeName || t.employeeName || t.Name || "").trim(),
    designation: String(t.Designation || t.designation || "").trim(),
    schoolCode: String(t.SchoolCode !== undefined ? t.SchoolCode : (t.schoolCode !== undefined ? t.schoolCode : "")).trim(),
    basicSalary: Number(t.BasicSalary !== undefined ? t.BasicSalary : (t.basicSalary !== undefined ? t.basicSalary : 0)),
    deductionAmount: Number(t.DeductionAmount !== undefined ? t.DeductionAmount : (t.deductionAmount !== undefined ? t.deductionAmount : 0)),
    netSalary: Number(t.NetSalary !== undefined ? t.NetSalary : (t.netSalary !== undefined ? t.netSalary : 0)),
    status: String(t.Status || t.status || "").trim(),
    joiningDate: t.JoiningDate || t.joiningDate || "",
    gender: t.Gender || t.gender || "",
    qualification: t.Qualification || t.qualification || "",
    accountNo: String(t.AccountNo || t.accountNo || t.AccountNumber || t.accountNumber || ""),
    accountTitle: t.AccountTitle || t.accountTitle || "",
    bankName: t.BankName || t.bankName || "",
    pettyCash: Number(t.PettyCash !== undefined ? t.PettyCash : (t.pettyCash !== undefined ? t.pettyCash : 0)),
    pettyCashDetail: t.PettyCashDetail || t.pettyCashDetail || ""
  };
}

async function loadTeachers() {
  let list = [];
  try {
    const r = await apiGet("teachers", { email: state.user.email });
    if (r.success) {
      list = r.items || [];
    } else {
      const db = await apiGet("dashboard", { email: state.user.email, month: month() });
      list = db.teachers || [];
    }
  } catch (e) {
    console.warn("Failed to load teachers from API, using fallback", e);
    const db = await apiGet("dashboard", { email: state.user.email, month: month() });
    list = db.teachers || [];
  }
  return list.map(normalizeTeacher).filter(Boolean);
}

async function teachers() {
  if (isAdmin()) {
    return employeesAdmin(); // Delegate to Admin-specific employees browser
  }
  
  setTitle("Teachers", "My school staff members list");
  skeleton("Loading staff details...");
  try {
    const rows = await loadTeachers();
    content.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>S#</th>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Basic Salary</th>
                <th>Deductions</th>
                <th>Net Salary</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr>
                  <td data-label="S#">${i + 1}</td>
                  <td data-label="Employee ID"><b>${esc(r.employeeId)}</b></td>
                  <td data-label="Name"><b>${esc(r.employeeName)}</b></td>
                  <td data-label="Designation">${esc(r.designation)}</td>
                  <td data-label="Basic Salary">${money(r.basicSalary)}</td>
                  <td data-label="Deductions" class="danger">${money(r.deductionAmount)}</td>
                  <td data-label="Net Salary"><b>${money(r.netSalary)}</b></td>
                </tr>`).join("") || `<tr><td colspan="7">No staff records found for this school.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { 
    content.innerHTML = msg(e.message, "bad"); 
  }
}

// Fully Implemented Admin Employee Browser
async function employeesAdmin() {
  setTitle("Employees", "Admin Employee Management Panel");
  skeleton("Loading system employees...");
  
  try {
    // Attempt to pull teachers list from cache/dashboard or local storage fallback
    let staff = [];
    try {
      const r = await apiGet("dashboard", { email: state.user.email, month: month() });
      staff = r.teachers || [];
    } catch(e) {
      staff = JSON.parse(localStorage.getItem("ibfs_mock_employees") || "[]");
    }
    
    // Store in localStorage if we got fresh list to ensure backup exists
    if (staff.length > 0) {
      localStorage.setItem("ibfs_mock_employees", JSON.stringify(staff));
    } else {
      staff = JSON.parse(localStorage.getItem("ibfs_mock_employees") || "[]");
    }
    
    window.__adminEmployees = staff;
    renderEmployeesAdminList(staff);
  } catch (e) {
    content.innerHTML = msg("Failed to load employee list.", "bad");
  }
}

function renderEmployeesAdminList(staff) {
  content.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div>
          <h3 style="margin: 0;">Employee Registry</h3>
          <p class="muted">Search and filter active staff records.</p>
        </div>
        <div class="actions" style="margin: 0;">
          <input id="empSearch" placeholder="Search by name, ID or design..." style="width: 220px;" oninput="filterAdminEmployees()">
          <input id="empSchoolFilter" placeholder="School code..." style="width: 140px;" oninput="filterAdminEmployees()">
        </div>
      </div>
      
      <div class="table-wrap">
        <table class="data-table" id="adminEmpTable">
          <thead>
            <tr>
              <th>S#</th>
              <th>School Code</th>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Designation</th>
              <th>Basic Salary</th>
              <th>Deduction</th>
              <th>Net Salary</th>
            </tr>
          </thead>
          <tbody>
            ${staff.map((r, i) => `
              <tr class="emp-row" data-name="${esc(r.employeeName).toLowerCase()}" data-id="${esc(r.employeeId).toLowerCase()}" data-design="${esc(r.designation).toLowerCase()}" data-school="${esc(r.schoolCode || "").toLowerCase()}">
                <td data-label="S#">${i + 1}</td>
                <td data-label="School Code"><b>${esc(r.schoolCode || "N/A")}</b></td>
                <td data-label="Employee ID"><b>${esc(r.employeeId)}</b></td>
                <td data-label="Name"><b>${esc(r.employeeName)}</b></td>
                <td data-label="Designation">${esc(r.designation)}</td>
                <td data-label="Basic Salary">${money(r.basicSalary)}</td>
                <td data-label="Deduction" class="danger">${money(r.deductionAmount)}</td>
                <td data-label="Net Salary"><b>${money(r.netSalary)}</b></td>
              </tr>`).join("") || `<tr><td colspan="8">No employees found.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function filterAdminEmployees() {
  const query = $("empSearch").value.toLowerCase().trim();
  const school = $("empSchoolFilter").value.toLowerCase().trim();
  const rows = document.querySelectorAll(".emp-row");
  
  rows.forEach(r => {
    const matchesQuery = !query || r.dataset.name.includes(query) || r.dataset.id.includes(query) || r.dataset.design.includes(query);
    const matchesSchool = !school || r.dataset.school.includes(school);
    
    if (matchesQuery && matchesSchool) {
      r.classList.remove("hidden");
    } else {
      r.classList.add("hidden");
    }
  });
}

// ==========================================================================
// New Employee Request (Principal) & Approval (Admin)
// ==========================================================================
function newEmployeeRequest() {
  setTitle("New Employee Request", "Submit a new employee for Admin approval");
  if (isAdmin()) { 
    content.innerHTML = msg("Admin should use the Employee Approval screen.", "bad"); 
    return; 
  }
  
  content.innerHTML = `
    <div class="card hero-card">
      <h3 style="margin-bottom: 8px; font-weight: 800;">New Employee Registry Request</h3>
      <p class="muted" style="margin-bottom: 20px;">Fill in the profile details carefully. The employee will be registered in the system after Admin verification.</p>
      
      <form id="newEmpForm" onsubmit="submitNewEmployeeRequest(); return false;">
        <div class="form-grid">
          <div class="form-group">
            <label>School Code</label>
            <input id="empSchoolCode" value="${esc(state.user.schoolCode || "")}" readonly>
          </div>
          <div class="form-group">
            <label>Employee Name *</label>
            <input id="empName" placeholder="Full legal name" required>
          </div>
          <div class="form-group">
            <label>Father / Husband Name *</label>
            <input id="empFather" placeholder="Name" required>
          </div>
          <div class="form-group">
            <label>CNIC Number *</label>
            <input id="empCnic" placeholder="xxxxx-xxxxxxx-x" pattern="^[0-9]{5}-[0-9]{7}-[0-9]$" required title="Format: xxxxx-xxxxxxx-x">
          </div>
          <div class="form-group">
            <label>Qualification *</label>
            <input id="empQualification" placeholder="e.g., MA / M.Ed" required>
          </div>
          <div class="form-group">
            <label>Designation *</label>
            <input id="empDesignation" placeholder="e.g., Junior Teacher" required>
          </div>
          <div class="form-group">
            <label>Basic Salary (PKR) *</label>
            <input id="empBasicSalary" type="number" min="1000" placeholder="0" required>
          </div>
          <div class="form-group">
            <label>Account Title</label>
            <input id="empAccountTitle" placeholder="Bank account title name">
          </div>
          <div class="form-group">
            <label>Account / IBAN Number</label>
            <input id="empAccountNo" placeholder="Account no. or IBAN">
          </div>
          <div class="form-group">
            <label>Bank Name</label>
            <input id="empBankName" placeholder="e.g., HBL, UBL">
          </div>
          <div class="form-group">
            <label>Date of Joining *</label>
            <input id="empJoiningDate" type="date" required>
          </div>
          <div class="form-group">
            <label>CNIC / Employee Photo *</label>
            <input id="empPhoto" type="file" accept="image/*" required>
          </div>
          <div class="form-group">
            <label>Educational Certificate *</label>
            <input id="empCertificate" type="file" accept="image/*,.pdf" required>
          </div>
        </div>
        <div class="form-group">
          <label>Remarks / Notes</label>
          <textarea id="empRemarks" placeholder="Optional remarks..."></textarea>
        </div>
        
        <div class="actions">
          <button class="btn primary" type="submit">Submit Request</button>
        </div>
        <div id="empRequestMsg" style="margin-top: 16px;"></div>
      </form>
    </div>`;
}

async function fileInputToBase64(inputId) {
  const file = $(inputId)?.files?.[0];
  if (!file) return null;
  return fileObj(file).then(({ fileName, mimeType, base64 }) => ({ fileName, mimeType, base64 }));
}

async function submitNewEmployeeRequest() {
  const name = $("empName").value.trim();
  const designation = $("empDesignation").value.trim();
  const basicSalary = Number($("empBasicSalary").value || 0);
  
  $("empRequestMsg").innerHTML = msg("Uploading documents and submitting request...", "ok");
  
  try {
    const photo = await fileInputToBase64("empPhoto");
    const certificatePhoto = await fileInputToBase64("empCertificate");
    
    const r = await apiPost({
      action: "submitEmployeeRequest",
      email: state.user.email,
      schoolCode: state.user.schoolCode,
      employee: {
        employeeName: name,
        fatherName: $("empFather").value.trim(),
        cnic: $("empCnic").value.trim(),
        qualification: $("empQualification").value.trim(),
        designation,
        basicSalary,
        accountTitle: $("empAccountTitle").value.trim(),
        accountNo: $("empAccountNo").value.trim(),
        bankName: $("empBankName").value.trim(),
        joiningDate: $("empJoiningDate").value,
        remarks: $("empRemarks").value.trim(),
        photo,
        certificatePhoto
      }
    });
    
    if (r.success) {
      $("empRequestMsg").innerHTML = msg(r.message || "Employee request submitted successfully.", "ok");
      addAuditLog("New Employee Request", `Submitted request for employee: ${name} (${designation})`);
      $("newEmpForm").reset();
    } else {
      $("empRequestMsg").innerHTML = msg(r.message || "Employee request failed.", "bad");
    }
  } catch (e) {
    $("empRequestMsg").innerHTML = msg("Employee request API failure. Please check file sizes and connection.", "bad");
  }
}

async function employeeApproval() {
  const title = isCoordinator() ? "Employee Recommendations" : "Employee Approval";
  const subtitle = isCoordinator() ? "Review and recommend new employee requests" : "Approve or reject new employee requests";
  setTitle(title, subtitle);
  if (!isAdmin() && !isCoordinator()) { 
    content.innerHTML = msg("Only Admin or Coordinator can access Employee Approval.", "bad"); 
    return; 
  }
  
  skeleton("Loading employee requests...");
  try {
    const targetStatus = isCoordinator() ? "Pending" : "Recommended";
    const r = await apiGet("employeeRequests", { email: state.user.email, status: targetStatus }, false);
    if (!r.success) { 
      content.innerHTML = msg(r.message || "Employee requests loading failed.", "bad"); 
      return; 
    }
    
    const allRows = r.items || r.requests || [];
    const rows = allRows.filter(x => isSchoolAssigned(x.schoolCode || x.SchoolCode));
    
    content.innerHTML = `
      <div class="card hero-card">
        <h3 style="margin-bottom: 4px;">${isCoordinator() ? "Pending Recommendation Requests" : "Pending Employee Requests"}</h3>
        <p class="muted" style="margin-bottom: 20px;">${isCoordinator() ? "Review new employee requests submitted by principals and submit recommendations." : "Review requests recommended by coordinators. Approved employees will be added to the registry system."}</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>S#</th>
                <th>School</th>
                <th>Name / CNIC</th>
                <th>Details</th>
                <th>Basic Salary</th>
                <th>Account Info</th>
                <th>CNIC/Photo</th>
                <th>Cert.</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((x, i) => {
                const reqId = x.requestId || x.RequestID || x.id || "";
                return `
                <tr>
                  <td data-label="S#">${i + 1}</td>
                  <td data-label="School"><b>${esc(x.schoolCode || x.SchoolCode)}</b></td>
                  <td data-label="Name / CNIC">
                    <b>${esc(x.employeeName || x.EmployeeName)}</b><br>
                    <span class="muted" style="font-size: 11px;">${esc(x.cnic || x.CNIC || "")}</span>
                  </td>
                  <td data-label="Details">
                    <b>${esc(x.designation || x.Designation)}</b><br>
                    <span class="muted" style="font-size: 12px;">Qual: ${esc(x.qualification || x.Qualification || "")}</span>
                  </td>
                  <td data-label="Basic Salary">${money(x.basicSalary || x.BasicSalary)}</td>
                  <td data-label="Account Info">
                    <span style="font-size: 12px;">
                      Title: ${esc(x.accountTitle || x.AccountTitle || "")}<br>
                      No: ${esc(x.accountNo || x.AccountNo || "")}<br>
                      Bank: ${esc(x.bankName || x.BankName || "")}
                    </span>
                  </td>
                  <td data-label="CNIC/Photo">
                    ${x.photoUrl || x.PhotoUrl ? `<button class="btn btn-sm secondary" onclick="openPhoto('${esc(x.photoUrl || x.PhotoUrl)}')">View</button>` : `<span class="muted">No photo</span>`}
                  </td>
                  <td data-label="Cert.">
                    ${x.certificateUrl || x.CertificateUrl || x.certificatePhotoUrl || x.CertificatePhotoUrl ? `<button class="btn btn-sm secondary" onclick="openPhoto('${esc(x.certificateUrl || x.CertificateUrl || x.certificatePhotoUrl || x.CertificatePhotoUrl)}')">View Cert</button>` : `<span class="muted">No cert</span>`}
                  </td>
                  <td data-label="Action">
                    <div style="display: flex; gap: 6px;">
                      <button class="btn btn-sm success" onclick="approveEmployeeRequest('${esc(reqId)}', '${esc(x.employeeName || x.EmployeeName)}')">${isCoordinator() ? "Recommend" : "Approve"}</button>
                      <button class="btn btn-sm danger" onclick="rejectEmployeeRequest('${esc(reqId)}', '${esc(x.employeeName || x.EmployeeName)}')">Reject</button>
                    </div>
                  </td>
                </tr>`;
              }).join("") || `<tr><td colspan="9" style="text-align:center; padding: 20px;">No pending employee registration requests.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { 
    content.innerHTML = msg("Employee approval list loading failed.", "bad"); 
  }
}

async function approveEmployeeRequest(requestId, name) {
  if (!requestId) { 
    toastWarning("Request ID missing.", "Validation"); 
    return; 
  }
  const action = isCoordinator() ? "recommendEmployeeRequest" : "approveEmployeeRequest";
  const confirmMsg = isCoordinator() ? `Recommend employee request for "${name}"?` : `Are you sure you want to approve the employee registry for "${name}"?`;
  if (!confirm(confirmMsg)) return;
  
  const dismissLoading = toastLoading(isCoordinator() ? "Processing recommendation…" : "Processing approval…");
  try {
    const r = await apiPost({ action, email: state.user.email, requestId });
    dismissLoading();
    r.success ? toastSuccess(r.message || (isCoordinator() ? "Employee recommended successfully." : "Employee approved successfully.")) : toastError(r.message || "Operation failed.");
    addAuditLog(isCoordinator() ? "Recommend Employee" : "Approve Employee", `${isCoordinator() ? "Recommended" : "Approved"} employee request ID: ${requestId} for ${name}`);
    employeeApproval();
  } catch(e) {
    dismissLoading();
    toastError("API connection error while processing request.", "Error");
    employeeApproval();
  }
}

async function rejectEmployeeRequest(requestId, name) {
  if (!requestId) { 
    toastWarning("Request ID missing.", "Validation"); 
    return; 
  }
  const reason = prompt("Enter rejection reason:");
  if (reason === null) return; // cancel
  if (!reason.trim()) {
    toastWarning("A rejection reason is required to proceed.", "Validation");
    return;
  }
  
  skeleton("Processing employee rejection...");
  try {
    const r = await apiPost({ action: "rejectEmployeeRequest", email: state.user.email, requestId, reason: reason.trim() });
    r.success ? toastSuccess(r.message || "Employee request rejected.") : toastError(r.message || "Rejection failed.");
    addAuditLog("Reject Employee", `Rejected request ID: ${requestId} for ${name}. Reason: ${reason}`);
    employeeApproval();
  } catch(e) {
    toastError("API connection error while rejecting.", "Error");
    employeeApproval();
  }
}

// ==========================================================================
// Resignation Request (Principal) & Approval (Admin)
// ==========================================================================
async function resignationRequest() {
  setTitle("Resignation Request", "Submit employee resignation for Admin approval");
  if (isAdmin()) { 
    content.innerHTML = msg("Admin should use Resignation Approval screen.", "bad"); 
    return; 
  }
  
  skeleton("Loading staff list...");
  try {
    const rows = await loadTeachers();
    content.innerHTML = `
      <div class="card hero-card">
        <h3 style="margin-bottom: 8px; font-weight: 800;">Submit Resignation Request</h3>
        <p class="muted" style="margin-bottom: 20px;">Select the staff member, upload the resignation letter image, and submit for verification.</p>
        
        <form id="resForm" onsubmit="submitResignationRequest(); return false;">
          <div class="form-grid">
            <div class="form-group">
              <label>Select Employee *</label>
              <select id="resEmployeeId" required>
                <option value="">-- Select Employee --</option>
                ${rows.map(r => `<option value="${esc(r.employeeId)}">${esc(r.employeeId)} — ${esc(r.employeeName)} (${esc(r.designation)})</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label>Resignation Effective Date *</label>
              <input id="resDate" type="date" required>
            </div>
            <div class="form-group">
              <label>Resignation Letter Photo / Scan *</label>
              <input id="resPhoto" type="file" accept="image/*" required>
            </div>
          </div>
          <div class="form-group">
            <label>Reason / Remarks *</label>
            <textarea id="resReason" placeholder="Describe the reason for resignation..." required></textarea>
          </div>
          
          <div class="actions">
            <button class="btn primary" type="submit">Submit Resignation</button>
          </div>
          <div id="resMsg" style="margin-top: 16px;"></div>
        </form>
      </div>`;
  } catch (e) { 
    content.innerHTML = msg(e.message, "bad"); 
  }
}

async function submitResignationRequest() {
  const employeeId = $("resEmployeeId").value;
  const resignationDate = $("resDate").value;
  const reason = $("resReason").value.trim();
  
  $("resMsg").innerHTML = msg("Uploading letter and submitting request...", "ok");
  
  try {
    const photo = await fileInputToBase64("resPhoto");
    const r = await apiPost({
      action: "submitResignationRequest",
      email: state.user.email,
      month: month(),
      schoolCode: state.user.schoolCode,
      employeeId,
      resignationDate,
      reason,
      photo
    });
    
    if (r.success) {
      $("resMsg").innerHTML = msg(r.message || "Resignation request submitted successfully.", "ok");
      addAuditLog("Resignation Request", `Submitted resignation for employee ID: ${employeeId}`);
      $("resForm").reset();
    } else {
      $("resMsg").innerHTML = msg(r.message || "Resignation submission failed.", "bad");
    }
  } catch (e) { 
    $("resMsg").innerHTML = msg("Resignation request API failure. Please check file sizes and connection.", "bad"); 
  }
}

async function resignationApproval() {
  const title = isCoordinator() ? "Resignation Recommendations" : "Resignation Approval";
  const subtitle = isCoordinator() ? "Review and recommend resignation requests" : "Approve or reject resignation requests";
  setTitle(title, subtitle);
  if (!isAdmin() && !isCoordinator()) { 
    content.innerHTML = msg("Only Admin or Coordinator can access Resignation Approval.", "bad"); 
    return; 
  }
  
  skeleton("Loading resignations...");
  try {
    const targetStatus = isCoordinator() ? "Pending" : "Recommended";
    const r = await apiGet("resignationRequests", { email: state.user.email, status: targetStatus }, false);
    if (!r.success) { 
      content.innerHTML = msg(r.message || "Resignation requests loading failed.", "bad"); 
      return; 
    }
    
    const allRows = r.items || r.requests || [];
    const rows = allRows.filter(x => isSchoolAssigned(x.schoolCode || x.SchoolCode));
    content.innerHTML = `
      <div class="card hero-card">
        <h3 style="margin-bottom: 4px;">${isCoordinator() ? "Pending Recommendation Requests" : "Pending Resignation Requests"}</h3>
        <p class="muted" style="margin-bottom: 20px;">${isCoordinator() ? "Review resignation requests submitted by principals and submit recommendations." : "Review requests recommended by coordinators. After approval, the employee status will change to Resigned."}</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>S#</th>
                <th>School Code</th>
                <th>Employee details</th>
                <th>Resign Date</th>
                <th>Reason</th>
                <th>Document</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((x, i) => {
                const reqId = x.requestId || x.RequestID || x.id || "";
                const empId = x.employeeId || x.EmployeeID;
                const empName = x.employeeName || x.EmployeeName || "";
                return `
                <tr>
                  <td data-label="S#">${i + 1}</td>
                  <td data-label="School Code"><b>${esc(x.schoolCode || x.SchoolCode)}</b></td>
                  <td data-label="Employee details">
                    <b>${esc(empId)}</b><br>
                    <span class="muted">${esc(empName)}</span>
                  </td>
                  <td data-label="Resign Date">${esc(x.resignationDate || x.ResignationDate)}</td>
                  <td data-label="Reason">${esc(x.reason || x.Reason || "")}</td>
                  <td data-label="Document">
                    ${x.photoUrl || x.PhotoUrl ? `<button class="btn btn-sm secondary" onclick="openPhoto('${esc(x.photoUrl || x.PhotoUrl)}')">View Scan</button>` : `<span class="muted">No letter uploaded</span>`}
                  </td>
                  <td data-label="Action">
                    <div style="display: flex; gap: 6px;">
                      <button class="btn btn-sm success" onclick="approveResignationRequest('${esc(reqId)}', '${esc(empId)}')">${isCoordinator() ? "Recommend" : "Approve"}</button>
                      <button class="btn btn-sm danger" onclick="rejectResignationRequest('${esc(reqId)}', '${esc(empId)}')">Reject</button>
                    </div>
                  </td>
                </tr>`;
              }).join("") || `<tr><td colspan="7" style="text-align:center; padding: 20px;">No pending resignation requests.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { 
    content.innerHTML = msg("Resignation approval API error loading requests.", "bad"); 
  }
}

async function approveResignationRequest(requestId, empId) {
  if (!requestId) { toastWarning("Request ID missing.", "Validation"); return; }
  const action = isCoordinator() ? "recommendResignationRequest" : "approveResignationRequest";
  const confirmMsg = isCoordinator() ? `Recommend resignation for employee "${empId}"?` : `Confirm resignation approval for employee "${empId}"?`;
  if (!confirm(confirmMsg)) return;
  
  skeleton(isCoordinator() ? "Processing resignation recommendation..." : "Processing resignation approval...");
  try {
    const r = await apiPost({ action, email: state.user.email, requestId });
    r.success ? toastSuccess(r.message || (isCoordinator() ? "Resignation recommended." : "Resignation approved.")) : toastError(r.message || "Operation failed.");
    addAuditLog(isCoordinator() ? "Recommend Resignation" : "Approve Resignation", `${isCoordinator() ? "Recommended" : "Approved"} resignation for employee ${empId}`);
    resignationApproval();
  } catch(e) {
    toastError("API connection error while processing resignation.", "Error");
    resignationApproval();
  }
}

async function rejectResignationRequest(requestId, empId) {
  if (!requestId) { toastWarning("Request ID missing.", "Validation"); return; }
  const reason = prompt("Enter rejection reason:");
  if (reason === null) return;
  if (!reason.trim()) {
    toastWarning("A rejection reason is required.", "Validation");
    return;
  }
  
  skeleton("Processing resignation rejection...");
  try {
    const r = await apiPost({ action: "rejectResignationRequest", email: state.user.email, requestId, reason: reason.trim() });
    r.success ? toastSuccess(r.message || "Resignation request rejected.") : toastError(r.message || "Rejection failed.");
    addAuditLog("Reject Resignation", `Rejected resignation for ${empId}. Reason: ${reason}`);
    resignationApproval();
  } catch(e) {
    toastError("API connection error while rejecting resignation.", "Error");
    resignationApproval();
  }
}

// ==========================================================================
// Attendance Entry (Principal)
// ==========================================================================
function resetAttendance() {
  const m = month();
  const sc = state.user.schoolCode || "";
  if (state.attendance.month !== m || state.attendance.schoolCode !== sc) {
    state.step = 0; 
    state.attendance = { month: m, schoolCode: sc, photos: [], staff: [] };
  }
}

async function attendanceEntry() {
  setTitle("Attendance Entry", "Submit monthly staff attendance report (v2)");
  if (isAdmin()) { 
    content.innerHTML = msg("Admin cannot submit attendance. Please use Attendance Approval.", "bad"); 
    return; 
  }
  
  resetAttendance();
  
  state.attendance.isApproved = false;
  skeleton("Checking monthly attendance status...");
  try {
    const statusResult = await apiGet("dashboard", { email: state.user.email, month: state.attendance.month });
    if (statusResult.success && String(statusResult.cards?.attendanceStatus || "").toLowerCase() === "approved") {
      state.attendance.isApproved = true;
    }
  } catch (e) {
    console.warn("Unable to check monthly status online, proceeding.", e);
  }

  const draftStr = localStorage.getItem("ibfs_attendance_draft");
  if (draftStr) {
    try {
      const draft = JSON.parse(draftStr);
      if (draft.schoolCode === state.attendance.schoolCode && draft.month === state.attendance.month) {
        state.attendance = draft;
        console.log("Restored attendance draft from localStorage");
      }
    } catch(e) {
      console.warn("Failed to restore draft", e);
    }
  }

  if (!state.attendance.staff.length) {
    skeleton("Loading school staff list...");
    try {
      const rows = await loadTeachers();
      state.attendance.staff = rows.map(t => ({ 
        employeeId: t.employeeId, 
        employeeName: t.employeeName, 
        designation: t.designation, 
        absent: 0, 
        cl: 0, 
        medicalLeave: 0, 
        withoutPayLeave: 0, 
        remarks: "" 
      }));
    } catch (e) { 
      content.innerHTML = msg(e.message, "bad"); 
      return; 
    }
  }
  renderAttendanceStep();
}

function renderAttendanceStep() {
  const steps = ["Select Month", "Register Photos", "Enter Attendance", "Review & Submit"];
  
  content.innerHTML = `
    <div class="card">
      <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--border-color);">
        ${steps.map((s, i) => `
          <div style="padding: 8px 16px; border-radius: var(--radius-md); font-weight: 700; font-size: 13px; white-space: nowrap;
                      background-color: ${i === state.step ? 'var(--primary)' : 'var(--bg-app)'};
                      color: ${i === state.step ? '#ffffff' : 'var(--text-muted)'}">
            ${i + 1}. ${s}
          </div>`).join("")}
      </div>
      <div id="attBody"></div>
    </div>`;
    
  const b = $("attBody");
  if (state.step === 0) {
    b.innerHTML = `
      <h3 style="margin-bottom: 12px; font-weight: 800;">Select Month</h3>
      ${state.attendance.isApproved ? `
        <div class="message bad" style="margin-bottom: 16px; border-left: 4px solid var(--danger); display: flex; align-items: center; gap: 8px; font-size: 13px;">
          <span>⚠️</span>
          <div>
            <strong>Locked:</strong> Attendance for <b>${state.attendance.month}</b> has already been approved by the Admin and cannot be edited. Please select a different month.
          </div>
        </div>
      ` : ""}
      <div class="form-grid">
        <div class="form-group">
          <label>School Code</label>
          <input value="${esc(state.attendance.schoolCode)}" readonly>
        </div>
        <div class="form-group">
          <label>Select Month</label>
          <input id="attMonth" type="month" value="${esc(state.attendance.month)}">
        </div>
      </div>
      ${nav(false, true, state.attendance.isApproved)}`;
  }
  else if (state.step === 1) {
    b.innerHTML = `
      <div class="screen-head" style="margin-bottom: 8px;">
        <div>
          <h3 style="margin: 0; font-weight: 800;">Register Photos</h3>
          <p class="muted">Upload at least one clear picture of the school attendance register.</p>
        </div>
      </div>
      <div class="form-group" style="max-width: 350px; margin-bottom: 20px;">
        <input id="photos" type="file" accept="image/*">
      </div>
      <div class="photo-grid">
        ${state.attendance.photos.map((p, i) => `
          <div class="photo">
            <img src="${p.dataUrl}" loading="lazy" onclick="openPhoto('${js(p.dataUrl)}')">
            <small>${esc(p.fileName)}</small>
            <button class="btn danger btn-sm btn-full" onclick="removePhoto(${i})">Remove</button>
          </div>`).join("") || msg("No register photos selected yet.", "bad")}
      </div>
      ${nav(true, true)}`;
  }
  else if (state.step === 2) {
    const query = (state.attendanceQuery || "").toLowerCase();
    const filter = state.attendanceFilter || "all";
    
    const filteredStaff = state.attendance.staff.map((r, i) => ({ ...r, originalIndex: i }))
      .filter(r => {
        const matchesSearch = String(r.employeeName).toLowerCase().includes(query) ||
                              String(r.employeeId).toLowerCase().includes(query);
        if(!matchesSearch) return false;
        
        const ded = deduct(r, state.attendance.schoolCode);
        if(filter === "deductions") {
          return ded > 0;
        } else if(filter === "modified") {
          return (Number(r.absent||0) > 0 || Number(r.cl||0) > 0 || Number(r.medicalLeave||0) > 0 || Number(r.withoutPayLeave||0) > 0 || r.remarks);
        }
        return true;
      });

    b.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-weight: 800;">Teacher Attendance</h3>
        <span class="badge" style="background:var(--soft); color:var(--dark); font-weight:800; padding:6px 12px; border-radius:999px; font-size:12px;">
          Showing: ${filteredStaff.length} of ${state.attendance.staff.length}
        </span>
      </div>
      
      <div class="search-filter-bar">
        <input id="cardSearch" class="search-input" type="text" placeholder="🔍 Search teacher name or ID..." value="${esc(state.attendanceQuery)}">
        <div class="filter-tabs">
          <button class="filter-tab ${filter==='all'?'active':''}" onclick="setCardFilter('all')">All</button>
          <button class="filter-tab ${filter==='deductions'?'active':''}" onclick="setCardFilter('deductions')">Deductions</button>
          <button class="filter-tab ${filter==='modified'?'active':''}" onclick="setCardFilter('modified')">Modified</button>
        </div>
      </div>
      
      <div class="cards-list">
        ${filteredStaff.map(r => {
          const i = r.originalIndex;
          const isExpanded = !!state.expandedCards[i];
          const ded = deduct(r, state.attendance.schoolCode);
          const hasDeductions = ded > 0;
          const isModified = (Number(r.absent||0) > 0 || Number(r.cl||0) > 0 || Number(r.medicalLeave||0) > 0 || Number(r.withoutPayLeave||0) > 0 || r.remarks);
          
          return `
            <div id="card-${i}" class="teacher-card ${isExpanded ? 'expanded' : ''}">
              <div class="teacher-card-header" onclick="toggleCard(${i})">
                <div>
                  <h4 class="teacher-card-title">${esc(r.employeeName)}</h4>
                  <p class="teacher-card-subtitle">${esc(r.designation || "Staff")} • ID: ${esc(r.employeeId)}</p>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                  ${hasDeductions ? `
                    <span class="teacher-card-badge warning">Deduction: ${ded} days</span>
                  ` : isModified ? `
                    <span class="teacher-card-badge warning" style="background:#fff7ed; color:#c2410c;">Modified</span>
                  ` : `
                    <span class="teacher-card-badge ok">✔️ Present</span>
                  `}
                  <span style="font-size:14px; color:var(--text-muted); transition: transform 0.2s;" id="arrow-${i}">
                    ${isExpanded ? '▲' : '▼'}
                  </span>
                </div>
              </div>
              
              <div class="teacher-card-body">
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; margin-bottom:12px;">
                  
                  <div>
                    <label style="margin-top:0; font-size:11px;">Absent Days</label>
                    <input data-i="${i}" data-f="absent" type="number" min="0" value="${r.absent}" style="padding: 8px; font-size: 14px;">
                  </div>
                  
                  <div>
                    <label style="margin-top:0; font-size:11px;">Casual Leave (CL)</label>
                    <input data-i="${i}" data-f="cl" type="number" min="0" value="${r.cl}" style="padding: 8px; font-size: 14px;">
                  </div>
                  
                  <div>
                    <label style="margin-top:0; font-size:11px;">Medical Leave</label>
                    <input data-i="${i}" data-f="medicalLeave" type="number" min="0" value="${r.medicalLeave}" style="padding: 8px; font-size: 14px;">
                  </div>
                  
                  <div>
                    <label style="margin-top:0; font-size:11px;">Without Pay (WPL)</label>
                    <input data-i="${i}" data-f="withoutPayLeave" type="number" min="0" value="${r.withoutPayLeave}" style="padding: 8px; font-size: 14px;">
                  </div>
                  
                </div>
                
                <div style="display:grid; grid-template-columns: 1fr; gap:10px;">
                  <div>
                    <label style="margin-top:0; font-size:11px;">Remarks / Detail</label>
                    <input data-i="${i}" data-f="remarks" value="${esc(r.remarks)}" placeholder="Optional remarks or leave reason" style="padding: 9px 12px; font-size:13px;">
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join("") || msg("No teachers found matching filters.", "bad")}
      </div>
      ${nav(true, true)}
    `;
  }
  else if (state.step === 3) {
    b.innerHTML = reviewHtml();
  }
  bindAttendance();
}

function nav(back, next, nextDisabled = false) { 
  return `
    <div class="actions" style="margin-top: 24px;">
      ${back ? `<button class="btn secondary" id="backStep">Back</button>` : ""}
      ${next ? `<button class="btn primary" id="nextStep" ${nextDisabled ? "disabled" : ""}>Continue</button>` : ""}
    </div>`; 
}

function saveAttendanceDraft() {
  try {
    localStorage.setItem("ibfs_attendance_draft", JSON.stringify(state.attendance));
  } catch(e) {
    console.error("Draft save failed", e);
  }
}

function toggleCard(i) {
  const card = $("card-" + i);
  const arrow = $("arrow-" + i);
  if(card) {
    card.classList.toggle("expanded");
    const isExpanded = card.classList.contains("expanded");
    state.expandedCards[i] = isExpanded;
    if(arrow) arrow.textContent = isExpanded ? '▲' : '▼';
  }
}

function adjustNum(i, field, delta) {
  const r = state.attendance.staff[i];
  const current = Number(r[field] || 0);
  r[field] = Math.max(0, current + delta);
  saveAttendanceDraft();
  renderAttendanceStep();
}

function setCardFilter(filterVal) {
  state.attendanceFilter = filterVal;
  renderAttendanceStep();
}

function bindAttendance() {
  const next = $("nextStep");
  const back = $("backStep");
  const attMonth = $("attMonth");
  const photos = $("photos");
  const cardSearch = $("cardSearch");
  
  if (cardSearch) {
    cardSearch.oninput = () => {
      state.attendanceQuery = cardSearch.value;
      renderAttendanceStep();
      const input = $("cardSearch");
      if(input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    };
  }
  
  if (attMonth) {
    attMonth.onchange = async () => { 
      try {
        state.attendance.month = attMonth.value; 
        $("globalMonth").value = attMonth.value; 
        saveAttendanceDraft();
        
        attMonth.disabled = true;
        try {
          const statusResult = await apiGet("dashboard", { email: state.user.email, month: state.attendance.month });
          state.attendance.isApproved = (statusResult.success && String(statusResult.cards?.attendanceStatus || "").toLowerCase() === "approved");
        } catch(e) {
          state.attendance.isApproved = false;
        }
        attMonth.disabled = false;
        renderAttendanceStep();
      } catch(err) {
        toastError("Month change error: " + err.message, "Error");
      }
    };
  }
  
  if (next) {
    next.onclick = () => { 
      try {
        if (!validateStep()) return; 
        
        if (state.step === 0 && state.attendance.isApproved) {
          toastWarning(`Attendance for ${state.attendance.month} has already been approved by Admin and cannot be modified.`, "Locked");
          return;
        }
        
        state.step = Math.min(3, state.step + 1); 
        renderAttendanceStep(); 
      } catch(err) {
        toastError("Step error: " + err.message, "Error");
      }
    };
  }
  
  if (back) {
    back.onclick = () => { 
      state.step = Math.max(0, state.step - 1); 
      renderAttendanceStep(); 
    };
  }
  
  if (photos) {
    photos.onchange = async e => {
      for (const file of Array.from(e.target.files || [])) {
        if (state.attendance.photos.length >= CONFIG.maxRegisterPhotos) break;
        try {
          const compressed = await fileObj(file);
          state.attendance.photos.push(compressed);
        } catch(err) {
          toastError(`File error: ${err.message}`, "File Error");
        }
      }
      saveAttendanceDraft();
      renderAttendanceStep();
    };
  }
  
  document.querySelectorAll("[data-f]").forEach(el => {
    el.onchange = () => {
      const idx = Number(el.dataset.i);
      const field = el.dataset.f;
      const r = state.attendance.staff[idx];
      r[field] = field === "remarks" ? el.value : Math.max(0, Number(el.value || 0));
      saveAttendanceDraft();
      renderAttendanceStep();
    };
  });
}

function validateStep() {
  if (state.step === 0 && !state.attendance.month) { 
    toastWarning("Please choose a valid month.", "Validation"); 
    return false; 
  }
  if (state.step === 1 && !state.attendance.photos.length) { 
    toastWarning("At least one register photo is required to proceed.", "Validation"); 
    return false; 
  }
  return true;
}

function deduct(r, sc) {
  const allowed = String(sc) === CONFIG.specialSchoolCode ? 1 : 2;
  const casual = Number(r.cl || 0);
  const medical = Number(r.medicalLeave || 0);
  const absent = Number(r.absent || 0);
  const unpaid = Number(r.withoutPayLeave || 0);
  
  return absent + unpaid + Math.max(0, casual + medical - allowed);
}

function reviewHtml() {
  return `
    <h3 style="margin-bottom: 6px; font-weight: 800;">Review & Submit Attendance</h3>
    <p class="muted" style="margin-bottom: 20px;">Review details in the table below. Check the confirmation checkbox to submit.</p>
    
    <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">
      School Code: <b>${esc(state.attendance.schoolCode)}</b> | Month: <b>${esc(state.attendance.month)}</b> | Photos Uploaded: <b>${state.attendance.photos.length}</b>
    </div>
    
    <div class="table-wrap" style="margin-bottom: 16px; max-height: 280px; overflow-y: auto; position: relative;">
      <table class="review-table">
        <colgroup>
          <col style="width: 16px;">
          <col style="width: auto;">
          <col style="width: 20px;">
          <col style="width: 18px;">
          <col style="width: 20px;">
          <col style="width: 20px;">
          <col style="width: 20px;">
          <col style="width: 40px;">
        </colgroup>
        <thead>
          <tr>
            <th title="Serial Number">S#</th>
            <th style="text-align: left;">Name</th>
            <th title="Absent">Ab</th>
            <th title="Casual Leave">CL</th>
            <th title="Medical Leave">Me</th>
            <th title="Without Pay Leave">WP</th>
            <th title="Deduction">Dd</th>
            <th title="Remarks">Rem</th>
          </tr>
        </thead>
        <tbody>
          ${state.attendance.staff.map((r, i) => {
            const ded = deduct(r, state.attendance.schoolCode);
            const isModified = (Number(r.absent||0) > 0 || Number(r.cl||0) > 0 || Number(r.medicalLeave||0) > 0 || Number(r.withoutPayLeave||0) > 0 || r.remarks);
            
            let rowStyle = "";
            if (ded > 0) {
              rowStyle = "background-color: #fef2f2;";
            } else if (isModified) {
              rowStyle = "background-color: #fff7ed;";
            }
            
            return `
              <tr style="${rowStyle}">
                <td>${i + 1}</td>
                <td style="text-align: left;">
                  <strong>${esc(r.employeeName)}</strong>
                  <div style="font-size: 11px; color: var(--text-muted);">${esc(r.employeeId)}</div>
                </td>
                <td>${r.absent || 0}</td>
                <td>${r.cl || 0}</td>
                <td>${r.medicalLeave || 0}</td>
                <td>${r.withoutPayLeave || 0}</td>
                <td><strong>${ded}</strong></td>
                <td style="font-size: 10px;">${esc(r.remarks || "-")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
    
    <label style="margin: 20px 0; display: flex; align-items: center; text-transform: none; font-size: 14px;">
      <input id="confirmAtt" type="checkbox" style="width: auto; margin-right: 8px;"> 
      I confirm this attendance is correct.
    </label>
    
    <div class="actions">
      <button class="btn secondary" id="backStep">Back</button>
      <button class="btn success" onclick="submitAttendance()">Submit Report</button>
    </div>`;
}

function removePhoto(i) {
  state.attendance.photos.splice(i, 1);
  renderAttendanceStep();
}

async function fileObj(file) {
  if (file.type.startsWith("image/")) {
    return compressImage(file);
  }
  if (file.size > CONFIG.maxPdfBytes) {
    throw new Error("File exceeds maximum size limit of 5 MB.");
  }
  return rawFile(file);
}

function rawFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
        base64: dataUrl.split(",")[1] || ""
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to read image structure."));
      img.onload = () => {
        const scale = Math.min(1, CONFIG.maxImageDimension / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", CONFIG.jpegQuality);
        resolve({
          fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          mimeType: "image/jpeg",
          dataUrl,
          base64: dataUrl.split(",")[1] || ""
        });
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

async function submitAttendance() {
  if (!$("confirmAtt")?.checked) {
    toastWarning("Please check the confirmation box before submitting.", "Validation");
    return;
  }
  
  skeleton("Uploading photos and saving attendance report...");
  try {
    const result = await apiPost({
      action: "submitAttendance",
      email: state.user.email,
      month: state.attendance.month,
      schoolCode: state.attendance.schoolCode,
      registerImages: state.attendance.photos.map(p => ({
        fileName: p.fileName,
        mimeType: p.mimeType,
        base64: p.base64
      })),
      teachers: state.attendance.staff.map(r => ({
        employeeId: r.employeeId,
        absent: r.absent,
        cl: r.cl,
        medicalLeave: r.medicalLeave,
        withoutPayLeave: r.withoutPayLeave,
        remarks: r.remarks
      }))
    });
    
    if (result.success) {
      toastSuccess(result.message || "Attendance report submitted successfully.", "Submitted");
      addAuditLog("Attendance Submitted", `Submitted attendance for school ${state.attendance.schoolCode}, Month: ${state.attendance.month}`);
      localStorage.removeItem("ibfs_attendance_draft");
      state.attendance = { month: month(), schoolCode: state.user.schoolCode || "", photos: [], staff: [] };
      state.step = 0;
      openPage("Dashboard");
    } else {
      toastError(result.message || "Attendance submission failed. Please try again.");
      renderAttendanceStep();
    }
  } catch (e) {
    toastError("Attendance submission API error. Please try again.", "Error");
    renderAttendanceStep();
  }
}

// ==========================================================================
// Attendance Status (Principal)
// ==========================================================================
async function attendanceStatus() {
  setTitle("Attendance Status", "Monthly submission approval status");
  skeleton("Loading attendance submission record...");
  try {
    const db = await apiGet("dashboard", {
      email: state.user.email,
      month: month()
    });
    
    if (!db.success) {
      content.innerHTML = msg(db.message || "Failed to fetch submission status.", "bad");
      return;
    }
    
    const statusVal = db.cards?.attendanceStatus || "Not Submitted";
    
    content.innerHTML = `
      ${db._offline ? msg("Offline viewing mode. Displaying cached status.", "bad") : ""}
      <div class="card">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <h3 style="margin: 0; font-weight: 800;">Status Report</h3>
          ${badge(statusVal)}
        </div>
        <div class="summary">
          <div class="row"><span>Reporting Month</span><b>${esc(month())}</b></div>
          <div class="row"><span>School Code</span><b>${esc(state.user.schoolCode || db.cards?.schoolCode || "")}</b></div>
          <div class="row"><span>Total Teachers reported</span><b>${db.cards?.totalEmployees || 0}</b></div>
          <div class="row"><span>Register Photos uploaded</span><b>-</b></div>
          <div class="row"><span>Rejection Remarks / Notes</span><b class="danger">None</b></div>
        </div>
      </div>`;
  } catch (e) {
    content.innerHTML = msg("Attendance status API connection error: " + e.message, "bad");
  }
}

function badge(s) {
  const status = String(s || "Pending");
  const low = status.toLowerCase();
  const cls = low === "approved" ? "approved" : 
              low === "rejected" ? "rejected" : 
              low === "recommended" ? "recommended" : 
              "pending";
  return `<span class="status ${cls}">${esc(status)}</span>`;
}

// ==========================================================================
// Attendance Approval (Admin)
// ==========================================================================
async function attendanceApproval() {
  const title = isCoordinator() ? "Attendance Recommendations" : "Attendance Approval";
  const subtitle = isCoordinator() ? "Review monthly school attendance sheets and recommend" : "Fast bulk verification and approvals";
  setTitle(title, subtitle);
  if (!isAdmin() && !isCoordinator()) { 
    content.innerHTML = msg("Only Admin or Coordinator can access Attendance Approval.", "bad"); 
    return; 
  }
  
  if (state.selectedApproval) {
    renderSelectedApproval();
    return;
  }
  
  skeleton("Loading monthly attendance records...");
  try {
    const r = await apiGet("attendanceForApproval", { email: state.user.email, month: month(), status: "all" }, false);
    if (!r.success) {
      content.innerHTML = msg(r.message || "Attendance for approval loading failed.", "bad");
      return;
    }
    
    const allItems = r.items || [];
    const assignedItems = allItems.filter(it => isSchoolAssigned(it.schoolCode));
    
    const totalSchools = isCoordinator()
      ? String(state.user?.schoolCode || "").split(",").map(s => s.trim()).filter(Boolean).length
      : assignedItems.length;
    const pendingSchools = assignedItems.filter(it => String(it.approvalStatus || "Pending").toLowerCase() === "pending").length;
    const recommendedSchools = assignedItems.filter(it => String(it.approvalStatus).toLowerCase() === "recommended").length;
    const approvedSchools = assignedItems.filter(it => String(it.approvalStatus).toLowerCase() === "approved").length;
    
    const targetStatus = isCoordinator() ? "pending" : "recommended";
    const items = assignedItems.filter(it => String(it.approvalStatus || "Pending").toLowerCase() === targetStatus);
    window.__approvalItems = items;
    
    let rowsHtml = "";
    if (items.length > 0) {
      rowsHtml = items.map((it, i) => {
        const teachers = it.teachers || [];
        const s = approvalSummary(teachers);
        const hasExceptions = s.exceptions > 0;
        const status = it.approvalStatus || "Pending";
        
        let exceptionBadge = "";
        if (hasExceptions) {
          exceptionBadge = `<span class="status pending" style="background:#fff7ed; color:#c2410c; padding: 2px 8px; font-size:11px; font-weight:bold;">⚠️ ${s.exceptions} Exceptions</span>`;
        } else {
          exceptionBadge = `<span class="status approved" style="background:#ecfdf5; color:#166534; padding: 2px 8px; font-size:11px; font-weight:bold;">✔️ 0 Exceptions</span>`;
        }
        
        let actionsHtml = `<button class="btn btn-sm primary" onclick="selectApproval(${i})">Review</button>`;
        if (!hasExceptions && status.toLowerCase() === (isCoordinator() ? "pending" : "recommended")) {
          const quickLabel = isCoordinator() ? "Quick Recommend" : "Quick Approve";
          actionsHtml += ` <button class="btn btn-sm success" onclick="quickApproveSchool(${i})" style="margin-left:4px;">${quickLabel}</button>`;
        }
        
        return `
          <tr>
            <td data-label="School Code"><b>${esc(it.schoolCode)}</b></td>
            <td data-label="Staff Count">${esc(it.totalTeachers || teachers.length)}</td>
            <td data-label="Exceptions">${exceptionBadge}</td>
            <td data-label="Status">${badge(status)}</td>
            <td data-label="Actions">${actionsHtml}</td>
          </tr>
        `;
      }).join("");
    } else {
      rowsHtml = `<tr><td colspan="5" style="text-align:center; padding: 20px;">No attendance submissions found matching status "${targetStatus}" for ${esc(month())}.</td></tr>`;
    }
    
    let kpisHtml = "";
    if (isCoordinator()) {
      kpisHtml = `
        <div class="kpi-row" style="margin-bottom: 0;">
          <div class="kpi" style="padding: 10px;">
            <span>Total Assigned Schools</span>
            <b style="font-size: 18px;">${totalSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Pending Recommendation</span>
            <b style="font-size: 18px; color: #d97706;">${pendingSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Recommended by Me</span>
            <b style="font-size: 18px; color: #3b82f6;">${recommendedSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Approved by Admin</span>
            <b style="font-size: 18px; color: #166534;">${approvedSchools}</b>
          </div>
        </div>
      `;
    } else {
      kpisHtml = `
        <div class="kpi-row" style="margin-bottom: 0;">
          <div class="kpi" style="padding: 10px;">
            <span>Total Schools</span>
            <b style="font-size: 18px;">${totalSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Pending Coordinator</span>
            <b style="font-size: 18px; color: #d97706;">${pendingSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Pending Admin Approval</span>
            <b style="font-size: 18px; color: #3b82f6;">${recommendedSchools}</b>
          </div>
          <div class="kpi" style="padding: 10px;">
            <span>Approved Sheets</span>
            <b style="font-size: 18px; color: #166534;">${approvedSchools}</b>
          </div>
        </div>
      `;
    }
    
    content.innerHTML = `
      <div class="card hero-card" style="margin-bottom: 20px;">
        <h3 style="margin-bottom: 4px;">School Submissions Queue</h3>
        <p class="muted" style="margin-bottom: 20px;">${isCoordinator() ? "Track, review, and recommend monthly school attendance sheets." : "Track, review, and approve monthly school attendance sheets."}</p>
        ${kpisHtml}
      </div>
      
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>School Code</th>
                <th>Staff Count</th>
                <th>Exceptions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = msg("Attendance approval list API connection error: " + e.message, "bad");
  }
}

function fileId(url) {
  const t = String(url || "");
  let m = t.match(/\/file\/d\/([^/]+)/) || t.match(/\/d\/([^/]+)/) || t.match(/[?&]id=([^&]+)/) || t.match(/[-\w]{25,}/);
  return m ? m[1] || m[0] : "";
}

function thumb(url, sz = "w200") {
  const id = fileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=${sz}` : String(url || "");
}

function attendanceException(t) {
  const absent = Number(t.absent ?? t.Absent ?? 0);
  const wpl = Number(t.withoutPayLeave ?? t.WithoutPayLeave ?? 0);
  const ded = Number(t.deductionDays ?? t.TotalDeductionDays ?? t.totalDeductionDays ?? 0);
  return absent > 0 || wpl > 0 || ded > 0;
}

function approvalSummary(teachers) {
  return teachers.reduce((acc, t) => {
    acc.staff++;
    acc.absent += Number(t.absent ?? t.Absent ?? 0);
    acc.cl += Number(t.cl ?? t.CL ?? 0);
    acc.medical += Number(t.medicalLeave ?? t.MedicalLeave ?? 0);
    acc.wpl += Number(t.withoutPayLeave ?? t.WithoutPayLeave ?? 0);
    acc.ded += Number(t.deductionDays ?? t.TotalDeductionDays ?? t.totalDeductionDays ?? 0);
    if (attendanceException(t)) acc.exceptions++;
    return acc;
  }, { staff: 0, absent: 0, cl: 0, medical: 0, wpl: 0, ded: 0, exceptions: 0 });
}

function selectApproval(idx) {
  const item = (window.__approvalItems || [])[idx];
  if (!item) return;
  state.selectedApproval = item;
  state.showExceptionsOnly = false;
  renderSelectedApproval();
}

function backToQueue() {
  state.selectedApproval = null;
  attendanceApproval();
}

async function quickApproveSchool(idx) {
  const item = (window.__approvalItems || [])[idx];
  if (!item) return;
  const total = (item.teachers || []).length;
  if (!total) { toastWarning("No teachers found to approve.", "Empty"); return; }
  
  const action = isCoordinator() ? "recommendAllAttendance" : "approveAllAttendance";
  const label = isCoordinator() ? "Quick Recommendation" : "Quick Approval";
  const confirmMsg = isCoordinator() ? 
    `Confirm Quick Recommendation for school ${item.schoolCode} (0 exceptions, ${total} staff)?` :
    `Confirm Quick Approval for school ${item.schoolCode} (0 exceptions, ${total} staff)?`;
  if (!confirm(confirmMsg)) return;
  
  skeleton(`Processing quick review for school ${item.schoolCode}...`);
  try {
    const r = await apiPost({
      action: action,
      email: state.user.email,
      month: item.month,
      schoolCode: item.schoolCode
    });
    if (r.success) {
      addAuditLog(isCoordinator() ? "Attendance Recommended (Bulk)" : "Attendance Approved (Bulk)", `Quick reviewed school ${item.schoolCode}, Month: ${item.month}`);
    }
    r.success ? toastSuccess(r.message || "Operation completed.") : toastError(r.message || "Operation failed.");
    attendanceApproval();
  } catch (e) {
    toastError("API connection error during approval.", "Error");
    attendanceApproval();
  }
}

function renderSelectedApproval() {
  const item = state.selectedApproval;
  if (!item) return;
  
  let photos = [];
  const rawPhotos = item.RegisterPhotoURLs || item.registerPhotoURLs || item.RegisterPhotoUrls || item.registerPhotoUrls || item.RegisterPhotoURL || item.registerPhotoURL || item.RegisterPhotoUrl || item.registerPhotoUrl || item.photos || item.Photos || item.registerImages || item.RegisterImages || [];
  if (Array.isArray(rawPhotos)) {
    photos = rawPhotos;
  } else if (typeof rawPhotos === "string") {
    photos = rawPhotos.split(",").map(url => url.trim()).filter(Boolean);
  }
  const allTeachers = item.teachers || [];
  const teachers = state.showExceptionsOnly ? allTeachers.filter(attendanceException) : allTeachers;
  const s = approvalSummary(allTeachers);
  
  const bulkLabel = isCoordinator() ? "Recommend All Staff" : "Approve All Staff";
  const selectLabel = isCoordinator() ? "Recommend Selected" : "Approve Selected";
  
  content.innerHTML = `
    <div style="margin-bottom: 16px;">
      <button class="btn secondary" onclick="backToQueue()" style="padding: 8px 12px; background:#fff; border:1px solid var(--border-color); font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family: inherit;">← Back to Queue</button>
    </div>
    
    <div class="card">
      <div class="toolbar">
        <div>
          <h3 style="margin: 0; font-weight: 800;">School: ${esc(item.schoolCode)} (${esc(item.month)})</h3>
          <p class="muted" style="margin-top: 4px;">Status: ${badge(item.approvalStatus)}</p>
        </div>
        <div class="actions" style="margin: 0;">
          <button class="btn secondary" onclick="toggleExceptionsOnly()">${state.showExceptionsOnly ? "Show All Staff" : "Show Exceptions Only"}</button>
          <button class="btn success" onclick="approveAllTeachers()">${bulkLabel}</button>
        </div>
      </div>
      
      <div class="kpi-row">
        <div class="kpi"><span>Total Staff</span><b>${s.staff}</b></div>
        <div class="kpi"><span>Absent Total</span><b>${s.absent}</b></div>
        <div class="kpi"><span>Leaves (CL/Med)</span><b>${s.cl + s.medical}</b></div>
        <div class="kpi"><span>Without Pay</span><b>${s.wpl}</b></div>
        <div class="kpi"><span>Exceptions</span><b class="${s.exceptions > 0 ? 'warning-dark' : ''}">${s.exceptions}</b></div>
      </div>
      
      <h4 style="margin: 20px 0 10px; font-weight: 800;">Register Photo References</h4>
      <div class="photo-grid">
        ${photos.map((u, i) => `
          <div class="photo">
            <img src="${esc(thumb(u, "w250"))}" loading="lazy" onclick="openPhoto('${js(thumb(u, "w1000"))}')">
            <button class="btn btn-sm btn-full secondary" onclick="openPhoto('${js(u)}')">Open Register ${i + 1}</button>
          </div>`).join("") || `
            <div style="width: 100%;">
              ${msg("No register files linked.", "bad")}
              <details style="font-size: 11px; color: var(--text-muted); margin-top: 8px; cursor: pointer; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color);">
                <summary style="font-weight: bold;">🔍 Diagnostic Info (Developer/Debug)</summary>
                <div style="margin-top: 6px; font-family: monospace; white-space: pre-wrap; word-break: break-all;">
                  <strong>Available keys:</strong> ${esc(JSON.stringify(Object.keys(item)))}
                  <br/><br/>
                  <strong>RegisterPhotoURLs:</strong> ${esc(item.RegisterPhotoURLs || item.registerPhotoURLs || item.RegisterPhotoUrls || item.registerPhotoUrls || "undefined")}
                  <br/>
                  <strong>RegisterPhotoURL:</strong> ${esc(item.RegisterPhotoURL || item.registerPhotoURL || item.RegisterPhotoUrl || item.registerPhotoUrl || "undefined")}
                </div>
              </details>
            </div>
          `}
      </div>
      
      <div class="toolbar" style="margin-top: 28px;">
        <div class="mini-card" style="display: flex; align-items: center; padding: 10px 14px;">
          <label style="margin: 0; display: flex; align-items: center; text-transform: none; font-size: 13px;">
            <input id="selectAllTeachers" type="checkbox" onchange="toggleTeacherChecks(this.checked)"> Select All Visible
          </label>
        </div>
        <div class="actions" style="margin: 0;">
          <button class="btn success btn-sm" onclick="approveSelectedTeachers()">${selectLabel}</button>
          <button class="btn danger btn-sm" onclick="rejectSelectedTeachers()">Reject Selected</button>
        </div>
      </div>
      
      <div id="bulkProgress"></div>
      
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="check-cell">✓</th>
              <th>S#</th>
              <th>Employee ID</th>
              <th>Staff Member</th>
              <th>Attendance Days</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map((t, idx) => {
              const tid = String(t.employeeId || t.EmployeeID || "").trim();
              const st = t.approvalStatus || t.ApprovalStatus || "Pending";
              const excp = attendanceException(t);
              
              const canAct = isCoordinator() ? (st.toLowerCase() === "pending" || st.toLowerCase() === "submitted") : (st.toLowerCase() === "recommended");
              const actionsHtml = canAct ? `
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-sm success" onclick="approveTeacher('${js(tid)}')">${isCoordinator() ? "Recommend" : "Approve"}</button>
                  <button class="btn btn-sm danger" onclick="rejectTeacher('${js(tid)}')">Reject</button>
                </div>
              ` : `<span class="muted">-</span>`;
              
              return `
              <tr>
                <td data-label="✓" class="check-cell">
                  <input class="teacher-check" type="checkbox" value="${esc(tid)}">
                </td>
                <td data-label="S#">${idx + 1}</td>
                <td data-label="Employee ID"><b>${esc(tid)}</b></td>
                <td data-label="Staff Member">
                  <b>${esc(t.employeeName || t.EmployeeName || "-")}</b>
                  ${excp ? `<br><span class="status pending" style="font-size: 10px; padding: 2px 6px;">Exception</span>` : ""}
                </td>
                <td data-label="Attendance Days">
                  <span style="font-size: 13px;">
                    Absents: ${t.absent ?? t.Absent ?? 0} | CLs: ${t.cl ?? t.CL ?? 0}<br>
                    Meds: ${t.medicalLeave ?? t.MedicalLeave ?? 0} | WPLs: ${t.withoutPayLeave ?? t.WithoutPayLeave ?? 0}<br>
                    Total Deductions: <b>${t.deductionDays ?? t.TotalDeductionDays ?? 0} days</b>
                  </span>
                </td>
                <td data-label="Status">${badge(st)}</td>
                <td data-label="Actions">
                  ${actionsHtml}
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="7">No staff list found.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function toggleExceptionsOnly() { 
  state.showExceptionsOnly = !state.showExceptionsOnly; 
  renderSelectedApproval(); 
}

function toggleTeacherChecks(checked) { 
  document.querySelectorAll(".teacher-check").forEach(c => c.checked = checked); 
}

function selectedTeacherIds() {
  const ids = [];
  document.querySelectorAll(".teacher-check:checked").forEach(c => ids.push(c.value));
  return ids;
}

function setBulkProgress(cur, total, text) {
  const container = $("bulkProgress");
  if (!container) return;
  if (cur === total) {
    container.innerHTML = msg(text, "ok");
    return;
  }
  const pct = Math.round((cur / total) * 100);
  container.innerHTML = `
    <div class="card mini-card" style="margin-top: 14px;">
      <div style="font-size: 13px; font-weight: bold; margin-bottom: 6px;">${esc(text)}</div>
      <div class="progress" style="height: 6px; margin: 0;"><span style="width: ${pct}%;"></span></div>
    </div>
  `;
}

async function bulkApproveByLoop(ids) {
  let ok = 0, fail = 0;
  const it = state.selectedApproval;
  if (!it) return;
  const action = isCoordinator() ? "recommendAttendance" : "approveAttendance";
  
  for (let i = 0; i < ids.length; i++) {
    setBulkProgress(i, ids.length, `Processing staff ${i + 1} of ${ids.length}...`);
    try {
      const r = await apiPost({
        action: action,
        email: state.user.email,
        month: it.month,
        schoolCode: it.schoolCode,
        employeeId: ids[i]
      });
      if (r.success) {
        ok++;
        const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(ids[i]).trim());
        if (teacher) {
          teacher.approvalStatus = isCoordinator() ? "Recommended" : "Approved";
          teacher.ApprovalStatus = isCoordinator() ? "Recommended" : "Approved";
        }
      } else {
        fail++;
      }
    } catch (e) { 
      fail++; 
    }
  }
  setBulkProgress(ids.length, ids.length, `Bulk operations done. Approved: ${ok}, Failed: ${fail}.`);
}

async function approveAllTeachers() {
  const it = state.selectedApproval;
  if (!it) return;
  const total = (it.teachers || []).length;
  if (!total) { toastWarning("No teachers found to approve.", "Empty"); return; }
  
  const action = isCoordinator() ? "recommendAllAttendance" : "approveAllAttendance";
  const label = isCoordinator() ? "recommendation" : "approval";
  const confirmMsg = isCoordinator() ? 
    `Submit recommendation for all ${total} staff members for school ${it.schoolCode}?` :
    `Approve all ${total} staff members for school ${it.schoolCode}?`;
  if (!confirm(confirmMsg)) return;
  
  setBulkProgress(0, total, `Submitting bulk ${label} request...`);
  try {
    const r = await apiPost({
      action: action,
      email: state.user.email,
      month: it.month,
      schoolCode: it.schoolCode
    });
    if (r.success) {
      setBulkProgress(total, total, r.message || `All staff ${label} submitted successfully!`);
      addAuditLog(isCoordinator() ? "Attendance Recommended (Bulk)" : "Attendance Approved (Bulk)", `Bulk reviewed school ${it.schoolCode}, Month: ${it.month}`);
      state.selectedApproval = null;
      setTimeout(attendanceApproval, 1000);
      return;
    }
  } catch (e) {}
  
  await bulkApproveByLoop((it.teachers || []).map(t => String(t.employeeId || t.EmployeeID || "").trim()).filter(Boolean));
  state.selectedApproval = null;
  setTimeout(attendanceApproval, 1200);
}

async function approveSelectedTeachers() {
  const ids = selectedTeacherIds();
  const it = state.selectedApproval;
  if (!it) return;
  if (!ids.length) { toastWarning("Please select at least one teacher.", "Validation"); return; }
  
  const action = isCoordinator() ? "recommendSelectedAttendance" : "approveSelectedAttendance";
  const label = isCoordinator() ? "recommendation" : "approval";
  const confirmMsg = isCoordinator() ? 
    `Recommend ${ids.length} selected staff members?` : 
    `Approve ${ids.length} selected staff members?`;
  if (!confirm(confirmMsg)) return;
  
  setBulkProgress(0, ids.length, `Submitting selected ${label} request...`);
  try {
    const r = await apiPost({
      action: action,
      email: state.user.email,
      month: it.month,
      schoolCode: it.schoolCode,
      employeeIds: ids
    });
    if (r.success) {
      setBulkProgress(ids.length, ids.length, r.message || `Selected staff ${label} submitted successfully.`);
      addAuditLog(isCoordinator() ? "Attendance Recommended (Selected)" : "Attendance Approved (Selected)", `${isCoordinator() ? "Recommended" : "Approved"} ${ids.length} teachers for school ${it.schoolCode}`);
      ids.forEach(id => {
        const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(id).trim());
        if (teacher) {
          teacher.approvalStatus = isCoordinator() ? "Recommended" : "Approved";
          teacher.ApprovalStatus = isCoordinator() ? "Recommended" : "Approved";
        }
      });
      setTimeout(attendanceApproval, 1000);
      return;
    }
  } catch (e) {}
  
  await bulkApproveByLoop(ids);
  setTimeout(attendanceApproval, 1200);
}

async function rejectSelectedTeachers() {
  const ids = selectedTeacherIds();
  const it = state.selectedApproval;
  if (!it) return;
  if (!ids.length) { toastWarning("Please select at least one teacher.", "Validation"); return; }
  const reason = prompt("Enter rejection reason:");
  if (reason === null) return;
  if (!reason.trim()) { toastWarning("A rejection reason is required.", "Validation"); return; }
  
  setBulkProgress(0, ids.length, "Submitting selected rejection request...");
  try {
    const r = await apiPost({
      action: "rejectSelectedAttendance",
      email: state.user.email,
      month: it.month,
      schoolCode: it.schoolCode,
      employeeIds: ids,
      reason: reason.trim()
    });
    if (r.success) {
      setBulkProgress(ids.length, ids.length, r.message || "Selected staff reports rejected successfully.");
      addAuditLog("Attendance Rejected (Selected)", `Rejected ${ids.length} teachers for school ${it.schoolCode}. Reason: ${reason}`);
      ids.forEach(id => {
        const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(id).trim());
        if (teacher) {
          teacher.approvalStatus = "Rejected";
          teacher.ApprovalStatus = "Rejected";
        }
      });
      setTimeout(attendanceApproval, 1000);
      return;
    }
  } catch (e) {}
  
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i++) {
    setBulkProgress(i, ids.length, "Rejecting selected teachers...");
    try {
      const r = await apiPost({
        action: "rejectAttendance",
        email: state.user.email,
        month: it.month,
        schoolCode: it.schoolCode,
        employeeId: ids[i],
        reason: reason.trim()
      });
      if (r.success) {
        ok++;
        const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(ids[i]).trim());
        if (teacher) {
          teacher.approvalStatus = "Rejected";
          teacher.ApprovalStatus = "Rejected";
        }
      } else {
        fail++;
      }
    } catch (e) { fail++; }
  }
  setBulkProgress(ids.length, ids.length, `Completed. Rejected: ${ok}, Failed: ${fail}.`);
  setTimeout(attendanceApproval, 1200);
}

async function approveTeacher(employeeId) {
  const it = state.selectedApproval;
  if (!it) return;
  const action = isCoordinator() ? "recommendAttendance" : "approveAttendance";
  const label = isCoordinator() ? "recommendation" : "approval";
  try {
    const r = await apiPost({
      action: action,
      email: state.user.email,
      month: it.month,
      schoolCode: it.schoolCode,
      employeeId
    });
    r.success ? toastSuccess(r.message || `Attendance ${label} submitted.`) : toastError(r.message || `${label} failed.`);
    addAuditLog(isCoordinator() ? "Attendance Recommended (Single)" : "Attendance Approved (Single)", `${isCoordinator() ? "Recommended" : "Approved"} attendance for ID: ${employeeId}, School: ${it.schoolCode}`);
    if (r.success) {
      const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(employeeId).trim());
      if (teacher) {
        teacher.approvalStatus = isCoordinator() ? "Recommended" : "Approved";
        teacher.ApprovalStatus = isCoordinator() ? "Recommended" : "Approved";
      }
    }
    attendanceApproval();
  } catch(e) {
    toastError("Connection error. Please check your internet.", "Network Error");
  }
}

async function rejectTeacher(employeeId) {
  const it = state.selectedApproval;
  if (!it) return;
  const reason = prompt("Enter rejection reason:");
  if (reason === null) return;
  if (!reason.trim()) { toastWarning("A rejection reason is required.", "Validation"); return; }
  
  try {
    const r = await apiPost({
      action: "rejectAttendance",
      email: state.user.email,
      month: it.month,
      schoolCode: it.schoolCode,
      employeeId,
      reason: reason.trim()
    });
    r.success ? toastSuccess(r.message || "Attendance rejected.") : toastError(r.message || "Rejection failed.");
    addAuditLog("Attendance Rejected (Single)", `Rejected attendance for ID: ${employeeId}, School: ${it.schoolCode}. Reason: ${reason}`);
    if (r.success) {
      const teacher = it.teachers.find(t => String(t.employeeId || t.EmployeeID || "").trim() === String(employeeId).trim());
      if (teacher) {
        teacher.approvalStatus = "Rejected";
        teacher.ApprovalStatus = "Rejected";
      }
    }
    attendanceApproval();
  } catch(e) {
    toastError("Connection error. Please check your internet.", "Network Error");
  }
}

async function salaryGeneration() {
  setTitle("Salary Generation", "Calculate and generate monthly payroll database");
  if (!isAdmin()) { 
    content.innerHTML = msg("Only Admin can access Salary Generation.", "bad"); 
    return; 
  }
  skeleton("Loading schools status for payroll...");
  try {
    const r = await apiGet("attendanceForApproval", { email: state.user.email, month: month(), status: "all" }, false);
    if (!r.success) {
      content.innerHTML = msg(r.message || "Failed to load schools status.", "bad");
      return;
    }
    state.salarySchools = r.items || [];
    renderSalaryGenerationUI();
  } catch (e) {
    content.innerHTML = msg("Error loading payroll dashboard.", "bad");
  }
}

function renderSalaryGenerationUI() {
  const items = state.salarySchools || [];
  const approvedCount = items.filter(it => String(it.approvalStatus).toLowerCase() === "approved").length;
  let summaryText = `<b>${approvedCount}</b> of <b>${items.length}</b> schools approved.`;
  
  const pendingCount = items.filter(it => String(it.approvalStatus || "Pending").toLowerCase() === "pending").length;
  if (pendingCount > 0) {
    summaryText += ` <span class="warning-dark" style="font-weight:600; margin-left: 8px;">⚠️ ${pendingCount} pending attendance approval.</span>`;
  } else {
    summaryText += ` <span class="success-dark" style="font-weight:600; margin-left: 8px;">✔️ All approved.</span>`;
  }

  content.innerHTML = `
    <div class="card hero-card" id="salaryGenCard">
      <h3 style="margin-bottom: 8px;">Run Salary Engine</h3>
      <p class="muted" style="margin-bottom: 20px;">Generate the salary registry for the selected month. Choose whether to generate for all approved schools or a specific school.</p>
      
      <div class="summary" style="margin-bottom: 24px;">
        <div class="row"><span>Selected Payroll Month</span><b>${esc(month())}</b></div>
        <div class="row"><span>Approval Status Summary</span><span>${summaryText}</span></div>
        <div class="row"><span>Engine Status</span><b id="salaryEngineStatus">Pending Run</b></div>
      </div>
      
      <div class="form-grid" style="margin-bottom: 20px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div>
          <label for="salaryScope">Generation Scope</label>
          <select id="salaryScope" onchange="toggleSalaryScope()">
            <option value="all">All Approved Schools (Skip Unapproved)</option>
            <option value="single">Specific School Only</option>
          </select>
        </div>
        <div id="singleSchoolContainer" class="hidden">
          <label for="salarySchoolSelect">Select School</label>
          <select id="salarySchoolSelect">
            <option value="">-- Select School --</option>
            ${items.map(it => {
              const isApproved = String(it.approvalStatus).toLowerCase() === "approved";
              return `<option value="${esc(it.schoolCode)}" ${!isApproved ? 'style="color: var(--text-muted); background: #f8fafc;"' : ''}>
                ${esc(it.schoolCode)} (${isApproved ? 'Approved' : 'Pending'})
              </option>`;
            }).join("")}
          </select>
        </div>
      </div>
      
      <div id="salaryProgressContainer" class="hidden" style="margin-bottom: 20px;">
        <div class="progress" style="height: 8px; background: rgba(0,0,0,0.05); border-radius: 99px; overflow: hidden; margin-bottom: 8px;">
          <span id="salaryProgressBar" style="display: block; height: 100%; width: 0%; background: var(--primary); transition: width 0.3s ease;"></span>
        </div>
        <p id="salaryProgressText" class="muted" style="font-size: 13px; font-weight: 600; margin: 0;"></p>
      </div>
      
      <button class="btn primary" id="btnRunSalary" onclick="generateSalaryNow()">Generate Salary for ${esc(month())}</button>
      <div id="salaryGenMsg" style="margin-top: 16px;"></div>
    </div>`;
}

function toggleSalaryScope() {
  const scope = $("salaryScope").value;
  const container = $("singleSchoolContainer");
  if (scope === "single") {
    container.classList.remove("hidden");
  } else {
    container.classList.add("hidden");
  }
}

async function generateSalaryNow() {
  const scope = $("salaryScope").value;
  let schoolCode = "";
  let skipUnapproved = false;
  
  if (scope === "single") {
    schoolCode = $("salarySchoolSelect").value;
    if (!schoolCode) {
      toastWarning("Please select a target school first.", "Validation");
      return;
    }
    const items = state.salarySchools || [];
    const targetItem = items.find(it => String(it.schoolCode) === String(schoolCode));
    if (targetItem && String(targetItem.approvalStatus).toLowerCase() !== "approved") {
      if (!confirm(`Warning: Attendance for school "${schoolCode}" has not been approved yet. Do you still want to generate salary for it?`)) {
        return;
      }
    }
  } else {
    skipUnapproved = true;
    const items = state.salarySchools || [];
    const approvedCount = items.filter(it => String(it.approvalStatus).toLowerCase() === "approved").length;
    if (approvedCount === 0) {
      toastWarning("There are no approved schools for this month to generate salary.", "Info");
      return;
    }
  }
  
  const confirmMsg = scope === "single"
    ? `Run salary generation engine for school "${schoolCode}" for ${month()}?`
    : `Run salary generation engine for all approved schools for ${month()} (skipping unapproved ones)?`;
    
  if (!confirm(confirmMsg)) return;
  
  const btn = $("btnRunSalary");
  const progContainer = $("salaryProgressContainer");
  const progBar = $("salaryProgressBar");
  const progText = $("salaryProgressText");
  const statusLabel = $("salaryEngineStatus");
  const msgBox = $("salaryGenMsg");
  
  btn.disabled = true;
  progContainer.classList.remove("hidden");
  statusLabel.textContent = "Running Engine...";
  statusLabel.style.color = "var(--primary)";
  msgBox.innerHTML = "";
  
  const steps = [
    { pct: 15, text: "Loading school registry and submission details..." },
    { pct: 45, text: "Reconciling attendance exceptions and deductions..." },
    { pct: 75, text: "Computing basic salaries, advances and adjustments..." },
    { pct: 90, text: "Finalizing bank transfer records & audit logs..." },
    { pct: 100, text: "Writing final payroll database records..." }
  ];
  
  for (let i = 0; i < steps.length; i++) {
    progBar.style.width = `${steps[i].pct}%`;
    progText.textContent = steps[i].text;
    await new Promise(r => setTimeout(r, 600));
  }
  
  progText.textContent = "Submitting to database...";
  
  try {
    const r = await apiPost({ 
      action: "generateSalary", 
      email: state.user.email, 
      month: month(),
      scope: scope,
      schoolCode: schoolCode,
      skipUnapproved: skipUnapproved
    });
    if (r.success) {
      statusLabel.textContent = "Completed Successfully";
      statusLabel.style.color = "var(--success)";
      progContainer.classList.add("hidden");
      
      const logDetails = scope === "single"
        ? `Triggered salary calculations for school ${schoolCode} (Month: ${month()})`
        : `Triggered salary calculations for all approved schools (Month: ${month()})`;
      addAuditLog("Salary Generated", logDetails);
      
      msgBox.innerHTML = `
        <div class="message ok" style="margin-bottom: 20px;">
          <b>Success!</b> ${esc(r.message || "Salary registry database written successfully.")}
        </div>
        <h4 style="margin: 20px 0 10px; font-weight: 800;">Next Steps / Post-Run Actions</h4>
        <div class="actions" style="margin: 0; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn success" onclick="openPage('Salary Sheet')">📄 Download School Sheets</button>
          <button class="btn primary" style="background:#8b5cf6;" onclick="openPage('Combined Reports')">📊 View Combined Reports</button>
          <button class="btn secondary" onclick="openPage('Payslips')">👤 Browse Payslips</button>
        </div>
      `;
      btn.classList.add("hidden");
    } else {
      statusLabel.textContent = "Execution Failed";
      statusLabel.style.color = "var(--danger)";
      progContainer.classList.add("hidden");
      msgBox.innerHTML = msg(r.message || "Salary generation failed.", "bad");
      btn.disabled = false;
    }
  } catch (e) {
    statusLabel.textContent = "Connection Error";
    statusLabel.style.color = "var(--danger)";
    progContainer.classList.add("hidden");
    msgBox.innerHTML = msg("Salary generation engine connection error.", "bad");
    btn.disabled = false;
  }
}

async function salarySheet() {
  if (isAdmin()) {
    setTitle("School Salary Sheets", "Generate and download school-wise salary PDFs");
    skeleton("Loading school registries...");
    try {
      const r = await apiGet("dashboard", { email: state.user.email, month: month() });
      if (!r.success) {
        content.innerHTML = msg(r.message || "School registries list loading failed.", "bad");
        return;
      }
      
      const schools = r.schoolWise || [];
      content.innerHTML = `
        <div class="card">
          <h3 style="margin-bottom: 6px;">School Salary Sheets</h3>
          <p class="muted" style="margin-bottom: 20px;">View or generate PDF reports showing salaries for individual schools.</p>
          
          <div class="form-group" style="max-width: 400px; margin-bottom: 20px;">
            <label>Select Target School</label>
            <select id="pdfSchool" onchange="onSchoolSelectChange()">
              <option value="">-- Select School Code --</option>
              ${schools.map(s => `
                <option value="${esc(s.schoolCode)}">${esc(s.schoolCode)} - ${esc(getCampusName(s.schoolCode))}</option>`).join("")}
            </select>
          </div>
          
          <div class="actions">
            <button class="btn primary" onclick="viewSchoolSalaries()">👁️ View Salaries</button>
            <button class="btn success" onclick="downloadSchoolPdf()">📄 Download PDF</button>
          </div>
          <div id="pdfMsg" style="margin-top: 16px;"></div>
        </div>
        <div id="schoolSalariesContainer"></div>`;
    } catch (e) {
      content.innerHTML = msg("School list loading API failure.", "bad");
    }
    return;
  }
  
  // Principal view
  setTitle("Salary Sheet", "Generate my school salary sheet PDF");
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom: 6px;">School Payroll Sheet</h3>
      <p class="muted" style="margin-bottom: 20px;">Download the official approved monthly salary spreadsheet for your school.</p>
      
      <div class="summary" style="margin-bottom: 20px;">
        <div class="row"><span>Reporting Month</span><b>${esc(month())}</b></div>
        <div class="row"><span>My School Code</span><b>${esc(state.user.schoolCode || "-")}</b></div>
      </div>
      
      <div class="actions">
        <button class="btn primary" onclick="downloadMySchoolPdf()">Download Salary Sheet PDF</button>
      </div>
      <div id="pdfMsg" style="margin-top: 16px;"></div>
    </div>`;
}

async function viewSchoolSalaries() {
  const sc = $("pdfSchool")?.value || "";
  if (!sc) { toastWarning("Please select a school first.", "Validation"); return; }
  
  const container = $("schoolSalariesContainer");
  container.innerHTML = `<div class="card">` + msg("Loading school salary records...", "ok") + `</div>`;
  
  try {
    const r = await apiGet("dashboard", { email: state.user.email, month: month(), schoolCode: sc }, false);
    if (!r.success) {
      container.innerHTML = `<div class="card">` + msg(r.message || "Failed to load salaries.", "bad") + `</div>`;
      return;
    }
    
    const allTeachers = r.teachers || [];
    const teachers = allTeachers.filter(t => String(t.schoolCode || t.SchoolCode || "").trim() === String(sc).trim());
    if (teachers.length === 0) {
      container.innerHTML = `<div class="card">` + msg("No salary records found for this school for the selected month.", "bad") + `</div>`;
      return;
    }
    
    let rowsHtml = teachers.map((t, i) => {
      return `
        <tr>
          <td class="hide-mobile">${i + 1}</td>
          <td><b>${esc(t.employeeId || t.EmployeeID)}</b></td>
          <td><b>${esc(t.employeeName || t.EmployeeName)}</b></td>
          <td class="hide-mobile">${esc(t.designation || t.Designation || "")}</td>
          <td class="hide-mobile">${money(t.basicSalary || t.BasicSalary)}</td>
          <td class="hide-mobile">${esc(t.totalDeductionDays ?? t.DeductionDays ?? 0)}</td>
          <td class="hide-mobile">${money(t.deductionAmount ?? t.DeductionAmount ?? 0)}</td>
          <td><b>${money(t.netSalary || t.NetSalary)}</b></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-sm secondary" style="padding: 2px 6px; font-size: 11px;" onclick="viewPayslip('${esc(t.employeeId || t.EmployeeID)}')">View Summary</button>
              <button class="btn btn-sm success" style="padding: 2px 6px; font-size: 11px;" onclick="downloadPayslip('${esc(t.employeeId || t.EmployeeID)}')">PDF</button>
            </div>
          </td>
        </tr>`;
    }).join("");
    
    container.innerHTML = `
      <div class="card">
        <h3 style="margin-bottom: 4px;">Salary Sheet: School ${esc(sc)} (${esc(month())})</h3>
        <p class="muted" style="margin-bottom: 16px;">Calculated salaries for school staff.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="hide-mobile">S#</th>
                <th>Employee ID</th>
                <th>Staff Member</th>
                <th class="hide-mobile">Designation</th>
                <th class="hide-mobile">Basic Salary</th>
                <th class="hide-mobile">Deductions (Days)</th>
                <th class="hide-mobile">Deduction Amt</th>
                <th>Net Salary</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="card">` + msg("Error fetching salary records: " + (e.message || e), "bad") + `</div>`;
  }
}

function onSchoolSelectChange() {
  const container = $("schoolSalariesContainer");
  if (container) container.innerHTML = "";
}

function getBase64BlobUrl(base64, mimeType = "application/pdf") {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (e) {
    return "";
  }
}

function forceDownload(url, defaultName = "ibfs_document.pdf") {
  // Convert Google Drive view URLs to download URLs automatically
  if (url.includes('drive.google.com/file/d/')) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      url = `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }
  
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function pdfUrl(r) { 
  if(!r) return "";
  if(typeof r === "string"){
    if(/^https?:\/\//i.test(r)) return r;
    try { return pdfUrl(JSON.parse(r)); } catch(e) { return ""; }
  }
  const b64 = r.base64 || r.pdfBase64 || r.fileBase64 || r.contentBase64 || r.pdfBytes;
  if(b64) {
    return getBase64BlobUrl(b64, r.mimeType || "application/pdf");
  }
  const direct = r.downloadUrl || r.pdfUrl || r.pdfLink || r.url || r.link ||
    r.fileUrl || r.driveUrl || r.viewUrl || r.webViewLink || r.downloadLink;
  if(direct) return direct;
  if(r.fileId) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(r.fileId)}`;
  return pdfUrl(r.data) || pdfUrl(r.result) || pdfUrl(r.response) || pdfUrl(r.payload) || "";
}

function showPdf(id, r, text) {
  const el = $(id);
  if (!el) return;
  if (text) {
    el.innerHTML = msg(text, "ok");
    return;
  }
  const url = pdfUrl(r);
  if (r?.success) {
    el.innerHTML = `
      <div class="message ok">
        <b>PDF generated successfully!</b><br>
        <p style="margin-top: 8px;">${esc(r.message || "Your file is ready.")}</p>
        ${url ? `<a class="btn success" style="margin-top: 14px;" href="#" onclick="forceDownload('${esc(url)}'); return false;">📥 Open / Download PDF</a>` : `PDF generated, but no link was returned. Response: ${esc(JSON.stringify(r))}`}
      </div>`;
  } else {
    el.innerHTML = msg(r?.message || "PDF generation request failed.", "bad");
  }
}

async function downloadSchoolPdf() {
  const sc = $("pdfSchool")?.value || "";
  if (!sc) { toastWarning("Please select a school first.", "Validation"); return; }
  
  showPdf("pdfMsg", {}, "Requesting PDF generation... please wait.");
  try {
    const r = await apiPost({ action: "generateSchoolSalaryPdf", email: state.user.email, month: month(), schoolCode: sc });
    showPdf("pdfMsg", r);
    const url = pdfUrl(r);
    if (r.success && url) {
      addAuditLog("PDF Generated", `Generated school salary PDF for ${sc}, Month: ${month()}`);
      forceDownload(url);
    }
  } catch(e) {
    showPdf("pdfMsg", { success: false, message: "PDF generator script timed out or returned error." });
  }
}

async function downloadMySchoolPdf() {
  showPdf("pdfMsg", {}, "Requesting PDF generation... please wait.");
  try {
    const r = await apiPost({ action: "generateSchoolSalaryPdf", email: state.user.email, month: month(), schoolCode: state.user.schoolCode });
    showPdf("pdfMsg", r);
    const url = pdfUrl(r);
    if (r.success && url) {
      addAuditLog("PDF Generated", `Generated my school salary PDF for ${state.user.schoolCode}, Month: ${month()}`);
      forceDownload(url);
    }
  } catch(e) {
    showPdf("pdfMsg", { success: false, message: "PDF generator script error." });
  }
}

function combinedReports() {
  if (!isAdmin()) { 
    content.innerHTML = msg("Only Admin can access Combined Reports.", "bad"); 
    return; 
  }
  
  setTitle("Combined Reports", "Download consolidated monthly payroll report");
  content.innerHTML = `
    <div class="card hero-card">
      <h3 style="margin-bottom: 6px;">Consolidated System Report</h3>
      <p class="muted" style="margin-bottom: 20px;">Download a combined report containing the salary sheets for all schools.</p>
      
      <div class="summary" style="margin-bottom: 20px;">
        <div class="row"><span>Payroll Month</span><b>${esc(month())}</b></div>
        <div class="row"><span>Report Type</span><b>All Schools Consolidated PDF</b></div>
      </div>
      
      <div class="actions">
        <button class="btn success" onclick="downloadCombinedPdf()">Generate Consolidated PDF</button>
      </div>
      <div id="combinedMsg" style="margin-top: 16px;"></div>
    </div>`;
}

async function downloadCombinedPdf() {
  showPdf("combinedMsg", {}, "Consolidating all school data and drawing PDF... This might take up to 20 seconds.");
  try {
    const r = await apiPost({ action: "generateCombinedSalaryPdf", email: state.user.email, month: month() });
    showPdf("combinedMsg", r);
    const url = pdfUrl(r);
    if (r.success && url) {
      addAuditLog("Consolidated Report", `Generated combined system reports for Month: ${month()}`);
      forceDownload(url);
    }
  } catch(e) {
    showPdf("combinedMsg", { success: false, message: "Consolidation script returned error." });
  }
}

// ==========================================================================
// Payslips Module
// ==========================================================================
async function payslips() {
  setTitle("Payslips", "View and download teacher payslips");
  if (isAdmin()) { 
    content.innerHTML = `
      <div class="card">
        <h3>Payslip Registry Browser</h3>
        <p class="muted">To generate payslips, browse using school codes in "School Salary Sheets" or search for specific teachers.</p>
      </div>`; 
    return; 
  }
  
  skeleton("Loading staff details...");
  try {
    const rows = await loadTeachers();
    content.innerHTML = `
      <div class="card">
        <h3 style="margin-bottom: 8px;">Payslips Panel</h3>
        <p class="muted" style="margin-bottom: 20px;">View detailed breakdown or generate PDF payslip documents.</p>
        
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>S#</th>
                <th>Employee ID</th>
                <th>Staff Name</th>
                <th>Designation</th>
                <th>Net Salary</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => {
                const empId = String(r.employeeId || r.EmployeeID || r.empId || r.id || "").trim();
                return `
                <tr>
                  <td data-label="S#">${i + 1}</td>
                  <td data-label="Employee ID"><b>${esc(empId)}</b></td>
                  <td data-label="Staff Name"><b>${esc(r.employeeName)}</b></td>
                  <td data-label="Designation">${esc(r.designation)}</td>
                  <td data-label="Net Salary"><b>${money(r.netSalary)}</b></td>
                  <td data-label="Actions">
                    <div style="display: flex; gap: 6px;">
                      <button class="btn btn-sm primary" onclick="viewPayslip('${esc(empId)}')">View Summary</button>
                      <button class="btn btn-sm success" onclick="downloadPayslip('${esc(empId)}')">Download PDF</button>
                    </div>
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div id="payslipBox" style="margin-top: 24px;"></div>
      </div>`;
  } catch (e) { 
    content.innerHTML = msg(e.message, "bad"); 
  }
}

async function viewPayslip(employeeId) {
  openGeneralModal(msg("Fetching payslip details...", "ok"));
  
  try {
    const r = await apiGet("payslip", { email: state.user.email, month: month(), employeeId }, false);
    if (!r.success) {
      openGeneralModal(msg((r.message || "Failed to load payslip data.") + ` Selected month: ${month()}.`, "bad"));
      return;
    }
    
    const p = r.payslip;
    openGeneralModal(`
      <div style="border-top: 4px solid var(--primary); padding-top: 8px;">
        <h3 style="margin-bottom: 14px; font-weight: 800; color: var(--primary);">Salary Payslip: ${esc(p.EmployeeName)}</h3>
        <div class="summary">
          <div class="row"><span>Employee ID</span><b>${esc(p.EmployeeID)}</b></div>
          <div class="row"><span>Reporting Month</span><b>${esc(month())}</b></div>
          <div class="row"><span>Basic Salary</span><b>${money(p.BasicSalary)}</b></div>
          <div class="row"><span>Deduction Days</span><b class="${p.TotalDeductionDays > 0 ? 'danger' : ''}">${esc(p.TotalDeductionDays)} days</b></div>
          <div class="row"><span>Deductions Amount</span><b class="${p.DeductionAmount > 0 ? 'danger' : ''}">${money(p.DeductionAmount)}</b></div>
          <div class="row" style="border-top: 2px solid var(--border-color); padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between;">
            <span>NET SALARY PAYABLE</span>
            <b style="font-size: 18px; color: var(--primary);">${money(p.NetSalary)}</b>
          </div>
        </div>
        <div style="margin-top: 24px; text-align: right;">
          <button class="btn primary" onclick="closeGeneralModal()">Close</button>
        </div>
      </div>`);
  } catch(e) {
    openGeneralModal(msg("API Error loading payslip data.", "bad"));
  }
}

async function downloadPayslip(employeeId) {
  toastInfo("Requesting payslip PDF generation...", "Processing");
  try {
    const r = await apiPost({ action: "generatePayslipPdf", email: state.user.email, month: month(), employeeId });
    const url = pdfUrl(r);
    if (r.success && url) {
      forceDownload(url, r.fileName || `IBFS_Payslip_${employeeId}_${month()}.pdf`);
      toastSuccess("Payslip PDF is ready.", "Downloaded");
    } else {
      r.success !== false
        ? toastSuccess(r.message || "Payslip ready.")
        : toastError((r.message || "Payslip PDF generation failed.") + ` Selected month: ${month()}.`);
    }
  } catch(e) {
    toastError("API error generating payslip PDF. Selected month: " + month(), "Error");
  }
}

// ==========================================================================
// Audit Log (Admin)
// ==========================================================================
function auditLog() {
  setTitle("Audit Log", "System activity and event tracking logs");
  if (!isAdmin()) {
    content.innerHTML = msg("Only Admin can access Audit Log.", "bad");
    return;
  }
  
  const logs = getAuditLogs();
  content.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div>
          <h3 style="margin: 0;">Activity History Log</h3>
          <p class="muted">Tracks actions performed in this browser/session.</p>
        </div>
        <div class="actions" style="margin: 0;">
          <button class="btn btn-sm secondary" onclick="downloadLogsCSV()">Export CSV</button>
          <button class="btn btn-sm danger" onclick="clearAuditLogs()">Clear Logs</button>
        </div>
      </div>
      
      <div class="timeline">
        ${logs.map(log => `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <h4>${esc(log.action)}</h4>
              <p>${esc(log.details)}</p>
              <span class="time">User: ${esc(log.user)} | ${new Date(log.t).toLocaleString()}</span>
            </div>
          </div>`).join("") || `<p class="muted">No activity events recorded yet.</p>`}
      </div>
    </div>`;
}

function clearAuditLogs() {
  if (!confirm("Are you sure you want to clear all local activity logs?")) return;
  localStorage.setItem("ibfs_audit_logs", "[]");
  auditLog();
}

function downloadLogsCSV() {
  const logs = getAuditLogs();
  if (logs.length === 0) { toastWarning("No logs to export.", "Empty"); return; }
  
  let csv = "Timestamp,User,Action,Details\n";
  logs.forEach(l => {
    const time = new Date(l.t).toISOString();
    const user = `"${l.user.replace(/"/g, '""')}"`;
    const action = `"${l.action.replace(/"/g, '""')}"`;
    const details = `"${l.details.replace(/"/g, '""')}"`;
    csv += `${time},${user},${action},${details}\n`;
  });
  
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `ibfs_audit_logs_${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================================================
// Settings Module
// ==========================================================================
function settings() {
  setTitle("Settings", "System variables & configuration settings");
  content.innerHTML = `
    <div class="card hero-card">
      <h3 style="margin-bottom: 8px; font-weight: 800;">System Settings Manager</h3>
      <p class="muted" style="margin-bottom: 24px;">Configure backend deployment endpoints, caching times, and parameters. Saved in this browser's local storage.</p>
      
      <form id="settingsForm" onsubmit="saveSettings(); return false;">
        <div class="form-grid">
          <div class="form-group">
            <label>API Base Endpoint URL</label>
            <input id="setApiUrl" value="${esc(CONFIG.apiBaseUrl)}" required>
          </div>
          <div class="form-group">
            <label>Special School Code (1-day allowance)</label>
            <input id="setSpecialSchool" value="${esc(CONFIG.specialSchoolCode)}">
          </div>
          <div class="form-group">
            <label>Max upload photos per register</label>
            <input id="setMaxPhotos" type="number" min="1" max="20" value="${CONFIG.maxRegisterPhotos}">
          </div>
          <div class="form-group">
            <label>Memory cache duration (seconds)</label>
            <input id="setCacheSec" type="number" min="5" value="${CONFIG.cacheMs / 1000}">
          </div>
          <div class="form-group">
            <label>Persistent offline cache (hours)</label>
            <input id="setOfflineHr" type="number" min="1" value="${CONFIG.persistentCacheMs / 3600000}">
          </div>
          <div class="form-group">
            <label>Client Image Max Dimension (px)</label>
            <input id="setImageDim" type="number" min="400" max="3000" value="${CONFIG.maxImageDimension}">
          </div>
          <div class="form-group">
            <label>JPEG Compression Quality (0.1 - 1.0)</label>
            <input id="setImageQual" type="number" min="0.1" max="1.0" step="0.05" value="${CONFIG.jpegQuality}">
          </div>
          <div class="form-group">
            <label>Max non-image file size (MB)</label>
            <input id="setPdfMb" type="number" min="1" max="50" value="${CONFIG.maxPdfBytes / 1000000}">
          </div>
        </div>
        
        <div class="actions">
          <button class="btn primary" type="submit">Save Configurations</button>
          <button class="btn secondary" type="button" onclick="resetSettings()">Reset to Defaults</button>
          <button class="btn info" type="button" onclick="runDiagnostics()" style="background-color: var(--secondary); border: 1px solid var(--border-color); color: var(--text-main);">Test Connection</button>
        </div>
        <div id="settingsMsg" style="margin-top: 16px;"></div>
        <div id="diagnosticsOutput" style="margin-top: 16px; padding: 14px; border-radius: var(--radius-md); background-color: var(--bg-app); border: 1px solid var(--border-color); display: none; font-family: monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--text-main);"></div>
      </form>
    </div>`;
}

async function runDiagnostics() {
  const output = $("diagnosticsOutput");
  if (!output) return;
  output.style.display = "block";
  output.innerHTML = "Starting connection self-test...\n";
  
  const testUrl = $("setApiUrl")?.value.trim() || CONFIG.apiBaseUrl;
  output.innerHTML += `Target Endpoint: ${testUrl}\n`;
  output.innerHTML += `Browser UserAgent: ${navigator.userAgent}\n`;
  output.innerHTML += `Online Status (navigator.onLine): ${navigator.onLine}\n`;
  
  try {
    output.innerHTML += "Sending ping request (GET)... ";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    
    const url = new URL(testUrl);
    url.searchParams.set("action", "ping");
    
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    
    output.innerHTML += `\nHTTP Status: ${res.status} ${res.statusText}\n`;
    const text = await res.text();
    output.innerHTML += `Raw Response: ${text.substring(0, 500)}\n`;
    
    try {
      const parsed = JSON.parse(text);
      output.innerHTML += `Parsed JSON: ${JSON.stringify(parsed, null, 2)}\n`;
      if (parsed.success === false && parsed.message && parsed.message.includes("Session expired")) {
        output.innerHTML += "\n✅ Connection successful! The script is reachable and returned the correct session expiration response.\n";
      } else {
        output.innerHTML += "\n⚠️ Warning: Response is not the standard session-expired JSON. Check Apps Script code.\n";
      }
    } catch(jsonErr) {
      output.innerHTML += `\n⚠️ Warning: Response is not valid JSON. (${jsonErr.message})\n`;
    }
  } catch(e) {
    output.innerHTML += `\n❌ Request FAILED!\nError: ${e.message}\nString: ${e.toString()}\n`;
    output.innerHTML += `\nPossible causes:\n1. Invalid URL\n2. Lack of internet connection\n3. CORS blocked in WebView\n4. Apps Script execution is disabled/deleted.\n`;
  }

  // Active User session diagnostics
  if (state.user) {
    output.innerHTML += "\n========================================\n";
    output.innerHTML += "ACTIVE USER SESSION DETECTED\n";
    output.innerHTML += `Name: ${state.user.name}\n`;
    output.innerHTML += `Email: ${state.user.email}\n`;
    output.innerHTML += `Role: ${state.user.role}\n`;
    output.innerHTML += `School Code: ${state.user.schoolCode}\n`;
    output.innerHTML += `Session Token: ${state.user.sessionToken}\n`;
    output.innerHTML += "========================================\n";
    output.innerHTML += `Testing Dashboard API Query (Month: ${month()})...\n`;

    try {
      const qParams = new URLSearchParams({
        action: "dashboard",
        email: state.user.email,
        month: month(),
        sessionToken: state.user.sessionToken || ""
      });
      
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 15000);
      
      const res2 = await fetch(`${testUrl}?${qParams.toString()}`, { signal: controller2.signal });
      clearTimeout(timer2);
      
      output.innerHTML += `Dashboard Query Status: ${res2.status} ${res2.statusText}\n`;
      const text2 = await res2.text();
      output.innerHTML += `Raw Payload: ${text2.substring(0, 1500)}\n`;
      
      try {
        const parsed2 = JSON.parse(text2);
        output.innerHTML += `Parsed Dashboard JSON keys: ${Object.keys(parsed2).join(", ")}\n`;
        if (parsed2.success) {
          output.innerHTML += `Teachers Count: ${parsed2.teachers ? parsed2.teachers.length : "undefined"}\n`;
          output.innerHTML += `Cards Info: ${JSON.stringify(parsed2.cards, null, 2)}\n`;
        } else {
          output.innerHTML += `⚠️ Dashboard API returned success=false. Message: ${parsed2.message}\n`;
        }
      } catch(e2) {
        output.innerHTML += `⚠️ Failed to parse dashboard JSON: ${e2.message}\n`;
      }
    } catch(err2) {
      output.innerHTML += `❌ Dashboard fetch failed: ${err2.message}\n`;
    }

    // Also test "employees" action
    output.innerHTML += "\n----------------------------------------\n";
    output.innerHTML += "Testing Employees API Query...\n";
    try {
      const qParamsEmp = new URLSearchParams({
        action: "employees",
        email: state.user.email,
        sessionToken: state.user.sessionToken || ""
      });
      
      const controller3 = new AbortController();
      const timer3 = setTimeout(() => controller3.abort(), 15000);
      
      const res3 = await fetch(`${testUrl}?${qParamsEmp.toString()}`, { signal: controller3.signal });
      clearTimeout(timer3);
      
      output.innerHTML += `Employees Query Status: ${res3.status} ${res3.statusText}\n`;
      const text3 = await res3.text();
      output.innerHTML += `Raw Payload: ${text3.substring(0, 1500)}\n`;
      
      try {
        const parsed3 = JSON.parse(text3);
        output.innerHTML += `Parsed Employees JSON keys: ${Object.keys(parsed3).join(", ")}\n`;
        if (parsed3.success) {
          const listName = parsed3.employees ? "employees" : (parsed3.items ? "items" : (parsed3.teachers ? "teachers" : "unknown"));
          const count = parsed3[listName] ? parsed3[listName].length : "undefined";
          output.innerHTML += `List Key Found: "${listName}" (Count: ${count})\n`;
        } else {
          output.innerHTML += `⚠️ Employees API returned success=false. Message: ${parsed3.message}\n`;
        }
      } catch(e3) {
        output.innerHTML += `⚠️ Failed to parse employees JSON: ${e3.message}\n`;
      }
    } catch(err3) {
      output.innerHTML += `❌ Employees fetch failed: ${err3.message}\n`;
    }
  } else {
    output.innerHTML += "\n(No active user logged in to test session-based APIs. Log in first to test dashboard queries.)\n";
  }
}

function saveSettings() {
  try {
    const newConfig = {
      apiBaseUrl: $("setApiUrl").value.trim(),
      specialSchoolCode: $("setSpecialSchool").value.trim(),
      maxRegisterPhotos: Number($("setMaxPhotos").value),
      cacheMs: Number($("setCacheSec").value) * 1000,
      persistentCacheMs: Number($("setOfflineHr").value) * 3600000,
      requestTimeoutMs: CONFIG.requestTimeoutMs,
      maxImageDimension: Number($("setImageDim").value),
      jpegQuality: Number($("setImageQual").value),
      maxPdfBytes: Number($("setPdfMb").value) * 1000000
    };
    
    CONFIG = newConfig;
    localStorage.setItem("ibfs_config", JSON.stringify(newConfig));
    $("settingsMsg").innerHTML = msg("Configurations saved successfully and loaded into active memory.", "ok");
    addAuditLog("Update Settings", "Updated CONFIG variables");
  } catch(e) {
    $("settingsMsg").innerHTML = msg("Failed to save configuration settings: " + e.message, "bad");
  }
}

function resetSettings() {
  if (!confirm("Are you sure you want to restore default configuration settings?")) return;
  CONFIG = { ...DEFAULT_CONFIG };
  localStorage.removeItem("ibfs_config");
  addAuditLog("Reset Settings", "Restored configurations to defaults");
  settings();
}

// ==========================================================================
// Profile Module
// ==========================================================================
function profile() {
  setTitle("Profile", "My account details & system cache utility");
  
  // Count local cache items
  const keys = Object.keys(localStorage);
  const cacheCount = keys.filter(k => k.startsWith("ibfs_cache:")).length;
  
  content.innerHTML = `
    <div class="card hero-card">
      <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
        <div class="user-avatar" style="width: 70px; height: 70px; font-size: 28px;">
          ${(state.user?.name || state.user?.email || "U").charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 style="margin: 0; font-weight: 800;">${esc(state.user?.name || "Account Profile")}</h2>
          <p class="muted">${esc(state.user?.email)}</p>
        </div>
      </div>
      
      <h3 style="margin-bottom: 12px; font-weight: 700; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">Account Details</h3>
      <div class="summary" style="margin-bottom: 28px;">
        <div class="row"><span>User Account ID (Email)</span><b>${esc(state.user?.email)}</b></div>
        <div class="row"><span>Role Permission</span><b style="text-transform: uppercase;">${esc(state.user?.role)}</b></div>
        <div class="row"><span>Assigned School Code</span><b>${esc(state.user?.schoolCode || "All Access (Admin)")}</b></div>
        <div class="row"><span>Active Session Token</span><b style="font-family: monospace; font-size: 11px;">${esc(state.user?.sessionToken || "None")}</b></div>
      </div>
      
      <h3 style="margin-bottom: 12px; font-weight: 700; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">Browser Cache Status</h3>
      <div class="summary">
        <div class="row"><span>Local Persistent Cache Count</span><b>${cacheCount} items</b></div>
        <div class="row"><span>Max Offline Lifetime</span><b>${CONFIG.persistentCacheMs / 3600000} hours</b></div>
      </div>
      
      <div class="actions">
        <button class="btn secondary" onclick="handleClearProfileCache()">Clear Offline Cache</button>
        <button class="btn danger" onclick="logout()">Sign Out</button>
      </div>
      <div id="profileMsg" style="margin-top: 16px;"></div>
    </div>`;
}

function handleClearProfileCache() {
  const cleared = clearLocalCache();
  $("profileMsg").innerHTML = msg(`Successfully cleared ${cleared} offline cached records from storage.`, "ok");
  setTimeout(profile, 1200);
}

// ==========================================================================
// Page Routing and Rendering
// ==========================================================================
async function renderPage() {
  const p = state.page;
  closePhoto();
  closeGeneralModal();
  
  if (!content) {
    console.error("Content container not found");
    return;
  }
  
  try {
    switch (p) {
      case "Dashboard":
        await dashboard();
        break;
      case "Employees":
      case "Teachers":
        await teachers();
        break;
      case "Employee Approval":
        await employeeApproval();
        break;
      case "Resignation Approval":
        await resignationApproval();
        break;
      case "Attendance Approval":
        await attendanceApproval();
        break;
      case "Salary Advances":
        await salaryAdvances();
        break;
      case "Petty Cash Setup":
        await pettyCashSetup();
        break;
      case "Petty Cash Approval":
        await pettyCashApproval();
        break;
      case "Petty Cash":
        await pettyCashSubmission();
        break;
      case "Salary Generation":
        await salaryGeneration();
        break;
      case "School Salary Sheets":
      case "Salary Sheet":
        await salarySheet();
        break;
      case "Combined Reports":
        await combinedReports();
        break;
      case "Payslips":
        await payslips();
        break;
      case "Audit Log":
        await auditLog();
        break;
      case "Settings":
        await settings();
        break;
      case "Attendance Entry":
        await attendanceEntry();
        break;
      case "Attendance Status":
        await attendanceStatus();
        break;
      case "New Employee":
        await newEmployeeRequest();
        break;
      case "Resignation":
        await resignationRequest();
        break;
      case "Profile":
        await profile();
        break;
      default:
        content.innerHTML = msg(`Page "${p}" is not implemented yet.`, "bad");
    }
  } catch (err) {
    console.error("Error rendering page:", err);
    content.innerHTML = msg(`Error loading page "${p}": ${err.message}`, "bad");
  }

  const backBtn = $("headerBackBtn");
  if (backBtn) {
    if (!isAdmin() && state.page !== "Dashboard") {
      backBtn.classList.remove("hidden");
    } else {
      backBtn.classList.add("hidden");
    }
  }

  if (!navigator.onLine) {
    const offlineDiv = document.createElement("div");
    offlineDiv.className = "message warning";
    offlineDiv.style.marginBottom = "16px";
    offlineDiv.style.borderLeft = "4px solid var(--warning)";
    offlineDiv.style.display = "flex";
    offlineDiv.style.alignItems = "center";
    offlineDiv.style.gap = "8px";
    offlineDiv.style.fontSize = "13px";
    offlineDiv.innerHTML = `
      <span>⚠️</span>
      <div>
        <strong>Working Offline:</strong> Your actions (including attendance drafts) are saved locally on this device. They will be synchronized automatically once your internet connection is restored.
      </div>`;
    content.prepend(offlineDiv);
  }
}

async function salaryAdvances(){
  setTitle("Salary Advances","Issue advances and recover them in monthly installments");
  const [employeesResult,advancesResult]=await Promise.all([apiGet("employees",{status:"Active"},false),apiGet("salaryAdvances",{},false)]);
  const employees=employeesResult.items||employeesResult.employees||employeesResult.rows||[], advances=advancesResult.advances||[];
  state.advanceEmployees=employees;
  const schools=employeesResult.schools||[...new Set(employees.map(e=>e.schoolCode||e.SchoolCode).filter(Boolean))].sort();
  content.innerHTML=`<div class="card"><h3>Issue Salary Advance</h3><div class="form-grid">
    <div><label>School Code</label><select id="advSchool" onchange="filterAdvanceEmployees()"><option value="">Select school</option>${schools.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></div>
    <div><label>Employee</label><select id="advEmployee" disabled><option value="">Select school first</option></select></div>
    <div><label>Advance Date</label><input id="advDate" type="date"></div><div><label>Advance Amount</label><input id="advAmount" type="number" min="1"></div>
    <div><label>Monthly Installment</label><input id="advInstallment" type="number" min="1"></div><div><label>Remarks</label><input id="advRemarks"></div></div>
    <div class="actions"><button class="btn primary" onclick="saveSalaryAdvance()">Save Advance</button></div><div id="advanceMsg"></div></div>
    <div class="card"><h3>Advance Ledger</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Employee</th><th>School</th><th>Advance</th><th>Installment</th><th>Recovered</th><th>Balance</th><th>Status</th></tr></thead><tbody>${advances.map(a=>`<tr><td>${esc(a.AdvanceID)}</td><td>${esc(a.EmployeeID)}</td><td>${esc(a.SchoolCode)}</td><td>${money(a.AdvanceAmount)}</td><td>${money(a.InstallmentAmount)}</td><td>${money(a.RecoveredAmount)}</td><td>${money(a.AdvanceBalance)}</td><td>${badge(a.Status)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function filterAdvanceEmployees(){
  const school=$("advSchool").value, select=$("advEmployee");
  const employees=(state.advanceEmployees||[]).filter(e=>String(e.schoolCode||e.SchoolCode||"")===String(school));
  select.innerHTML=school?`<option value="">Select employee</option>${employees.map(e=>`<option value="${esc(e.EmployeeID||e.employeeId)}">${esc(e.EmployeeName||e.employeeName)} — ${esc(e.EmployeeID||e.employeeId)}</option>`).join("")}`:`<option value="">Select school first</option>`;
  select.disabled=!school||!employees.length;
}
async function saveSalaryAdvance(){ if(!$("advSchool").value||!$("advEmployee").value){$("advanceMsg").innerHTML=msg("Please select school and employee.","bad");return;} const r=await apiPost({action:"createSalaryAdvance",employeeId:$("advEmployee").value,advanceDate:$("advDate").value,advanceAmount:$("advAmount").value,installmentAmount:$("advInstallment").value,remarks:$("advRemarks").value});$("advanceMsg").innerHTML=msg(r.message,r.success?"ok":"bad");if(r.success)salaryAdvances(); }
async function pettyCashSubmission(){
  setTitle("Petty Cash","Submit petty cash detail and bill photo");
  const [recipientResult,r]=await Promise.all([apiGet("pettyCashRecipients",{},false),apiGet("pettyCashSubmissions",{month:month()},false)]);
  const employees=recipientResult.recipients||[], rows=r.submissions||[];
  content.innerHTML=`<div class="card"><h3>Petty Cash Submission</h3><div class="form-grid"><div><label>Petty Cash Recipient</label><select id="pcEmployee"><option value="">Select employee</option>${employees.map(e=>`<option value="${esc(e.EmployeeID)}">${esc(e.EmployeeName)} — ${esc(e.EmployeeID)} — ${esc(e.AccountTitle)}</option>`).join("")}</select></div><div><label>Month</label><input id="pcMonth" type="month" value="${esc(month())}"></div><div><label>Petty Cash Amount</label><input id="pcAmount" type="number" min="0"></div><div><label>Petty Cash Detail</label><input id="pcDetail"></div><div><label>Bill Photo</label><input id="pcBill" type="file" accept="image/*"></div><div><label>Remarks</label><input id="pcRemarks"></div></div><div class="actions"><button class="btn primary" onclick="savePettyCash()">Submit</button></div><div id="pcMsg">${employees.length?"":msg("Admin has not selected a petty cash recipient for your school.","bad")}</div></div><div class="card"><h3>Previous Submissions</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Month</th><th>Employee</th><th>Amount</th><th>Detail</th><th>Bill</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.Month)}</td><td>${esc(x.EmployeeID)}</td><td>${money(x.PettyCash)}</td><td>${esc(x.PettyCashDetail)}</td><td>${x.BillPhotoURL?`<button class="btn btn-sm secondary" onclick="openPhoto('${esc(x.BillPhotoURL)}')">View Bill</button>`:"-"}</td><td>${badge(x.Status)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
async function savePettyCash(){ const input=$("pcBill"); if(!$("pcEmployee").value){$("pcMsg").innerHTML=msg("Please select employee.","bad");return;} if(!input.files||!input.files[0]){$("pcMsg").innerHTML=msg("Please upload bill photo.","bad");return;} const bill=await fileObj(input.files[0]);const r=await apiPost({action:"submitPettyCash",employeeId:$("pcEmployee").value,month:$("pcMonth").value,pettyCash:$("pcAmount").value,pettyCashDetail:$("pcDetail").value,billPhoto:bill,remarks:$("pcRemarks").value});$("pcMsg").innerHTML=msg(r.message,r.success?"ok":"bad");if(r.success)pettyCashSubmission(); }
async function pettyCashApproval(){
  const title = isCoordinator() ? "Petty Cash Recommendations" : "Petty Cash Approval";
  const subtitle = isCoordinator() ? "Recommend principal petty cash submissions" : "Approve principal submissions before salary generation";
  setTitle(title, subtitle);
  if (!isAdmin() && !isCoordinator()) {
    content.innerHTML = msg("Only Admin or Coordinator can access Petty Cash Approval.", "bad");
    return;
  }
  
  const r = await apiGet("pettyCashSubmissions", { month: month() }, false);
  const allRows = r.submissions || [];
  const assignedRows = allRows.filter(x => isSchoolAssigned(x.SchoolCode));
  
  const targetStatus = isCoordinator() ? "submitted" : "recommended";
  const rows = assignedRows.filter(x => String(x.Status).toLowerCase() === targetStatus);
  
  content.innerHTML = `<div class="card">
    <h3>${isCoordinator() ? "Pending Recommendations" : "Pending Approvals"} — ${esc(month())}</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>School</th>
            <th>Employee</th>
            <th>Amount</th>
            <th>Detail</th>
            <th>Bill</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(x => {
            const canReview = isCoordinator() ? (String(x.Status).toLowerCase() === "submitted") : (String(x.Status).toLowerCase() === "recommended");
            const actionBtn = isCoordinator() ? 
              `<button class="btn success btn-sm" onclick="reviewPettyCashSubmission('${js(x.SubmissionID)}','Recommended')">Recommend</button>` : 
              `<button class="btn success btn-sm" onclick="reviewPettyCashSubmission('${js(x.SubmissionID)}','Approved')">Approve</button>`;
            const rejectBtn = `<button class="btn danger btn-sm" onclick="reviewPettyCashSubmission('${js(x.SubmissionID)}','Rejected')">Reject</button>`;
            const actionsHtml = canReview ? `<div style="display:flex; gap:4px;">${actionBtn} ${rejectBtn}</div>` : "-";
            
            return `<tr>
              <td>${esc(x.SchoolCode)}</td>
              <td>${esc(x.EmployeeID)}</td>
              <td>${money(x.PettyCash)}</td>
              <td>${esc(x.PettyCashDetail)}</td>
              <td>${x.BillPhotoURL ? `<button class="btn btn-sm secondary" onclick="openPhoto('${esc(x.BillPhotoURL)}')">View Bill</button>` : "-"}</td>
              <td>${badge(x.Status)}</td>
              <td>${actionsHtml}</td>
            </tr>`;
          }).join("") || `<tr><td colspan="7" style="text-align:center; padding:20px;">No submissions found matching status "${targetStatus}" for ${esc(month())}.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="pcApprovalMsg"></div>
  </div>`;
}

async function reviewPettyCashSubmission(submissionId,decision){ 
  const remarks = decision === "Rejected" ? (prompt("Rejection reason:") || "") : ""; 
  if (decision === "Rejected" && !remarks) return; 
  const r = await apiPost({action: "reviewPettyCash", submissionId, decision, remarks}); 
  const container = $("pcApprovalMsg");
  if (container) {
    container.innerHTML = msg(r.message, r.success ? "ok" : "bad");
  } else {
    r.success ? toastSuccess(r.message) : toastError(r.message);
  }
  if (r.success) {
    setTimeout(pettyCashApproval, 1200);
  }
}
async function pettyCashSetup(){
  setTitle("Petty Cash Setup","Select the employee account used for each school's petty cash");
  const [employeeResult,recipientResult]=await Promise.all([apiGet("employees",{status:"Active"},false),apiGet("pettyCashRecipients",{},false)]);
  const employees=employeeResult.items||[], schools=employeeResult.schools||[], recipients=recipientResult.recipients||[];
  state.pettySetupEmployees=employees;
  content.innerHTML=`<div class="card"><h3>Select Petty Cash Recipient</h3><div class="form-grid"><div><label>School Code</label><select id="pcSetupSchool" onchange="filterPettySetupEmployees()"><option value="">Select school</option>${schools.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></div><div><label>Employee Account</label><select id="pcSetupEmployee" disabled><option value="">Select school first</option></select></div></div><div class="actions"><button class="btn primary" onclick="savePettyCashRecipient()">Save Recipient</button></div><div id="pcSetupMsg"></div></div><div class="card"><h3>Current Recipients</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>School</th><th>Employee</th><th>Name</th><th>Account Title</th></tr></thead><tbody>${recipients.map(x=>`<tr><td>${esc(x.SchoolCode)}</td><td>${esc(x.EmployeeID)}</td><td>${esc(x.EmployeeName)}</td><td>${esc(x.AccountTitle)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function filterPettySetupEmployees(){const school=$("pcSetupSchool").value, select=$("pcSetupEmployee");const rows=(state.pettySetupEmployees||[]).filter(e=>String(e.schoolCode)===String(school));select.innerHTML=school?`<option value="">Select employee</option>${rows.map(e=>`<option value="${esc(e.employeeId)}">${esc(e.employeeName)} — ${esc(e.employeeId)} — ${esc(e.accountTitle)}</option>`).join("")}`:`<option value="">Select school first</option>`;select.disabled=!school||!rows.length;}
async function savePettyCashRecipient(){if(!$("pcSetupSchool").value||!$("pcSetupEmployee").value){$("pcSetupMsg").innerHTML=msg("Please select school and employee.","bad");return;}const r=await apiPost({action:"setPettyCashRecipient",schoolCode:$("pcSetupSchool").value,employeeId:$("pcSetupEmployee").value});$("pcSetupMsg").innerHTML=msg(r.message,r.success?"ok":"bad");if(r.success)pettyCashSetup();}

// ==========================================================================
// Photo Lightbox modal controller
// ==========================================================================
window.__currentRotation = 0;
function openPhoto(url) { 
  window.__currentRotation = 0;
  const img = $("modalImage");
  if (img) img.style.transform = "rotate(0deg) scale(1)";
  $("modalImage").src = thumb(url, "w1000"); 
  $("photoModal").classList.remove("hidden"); 
}

function closePhoto() { 
  $("photoModal").classList.add("hidden"); 
  $("modalImage").src = ""; 
}

function rotatePhoto(angle) {
  window.__currentRotation = (window.__currentRotation + angle) % 360;
  const img = $("modalImage");
  if (!img) return;
  
  const isSideways = Math.abs(window.__currentRotation % 180) === 90;
  if (isSideways) {
    const targetW = window.innerWidth * 0.9;
    const targetH = window.innerHeight * 0.8;
    const imgW = img.offsetWidth;
    const imgH = img.offsetHeight;
    
    const scaleX = targetW / imgH;
    const scaleY = targetH / imgW;
    const scale = Math.min(scaleX, scaleY, 1);
    
    img.style.transform = `rotate(${window.__currentRotation}deg) scale(${scale})`;
  } else {
    img.style.transform = `rotate(${window.__currentRotation}deg) scale(1)`;
  }
}

function openGeneralModal(html) {
  $("generalModalContent").innerHTML = html;
  $("generalModal").classList.remove("hidden");
}

function closeGeneralModal() {
  $("generalModal").classList.add("hidden");
  $("generalModalContent").innerHTML = "";
}

// ==========================================================================
// App Initialization
// ==========================================================================
// window.onload logic is now handled in DOMContentLoaded listener above

function updateNetworkStatus() {
  const pill = $("networkPill"); 
  if (!pill) return;
  
  const online = navigator.onLine;
  pill.textContent = online ? "Online" : "Offline Cache";
  pill.className = `status-pill ${online ? 'status-online' : 'status-offline'}`;
}

window.addEventListener("online", () => { 
  updateNetworkStatus(); 
  state.cache = {}; 
  if (state.user) {
    addAuditLog("Network Online", "Connection restored; cache cleared");
    renderPage(); 
  }
});

window.addEventListener("offline", () => {
  updateNetworkStatus();
  addAuditLog("Network Offline", "Switched to offline caching mode");
});
