const decisionStorageKey = "abcTaskDecisions:v2";
const themeStorageKey = "abcTaskTheme";
const taskStatusStorageKey = "abcTaskStatuses:v1";
const taskNoteStorageKey = "abcTaskNotes:v1";
const deletedTasksStorageKey = "abcDeletedTasks:v1";
const appliedTasksStorageKey = "abcAppliedTasks:v1";
const completedTasksStorageKey = "abcCompletedTasks:v1";
const restoredCandidatesStorageKey = "abcRestoredCandidates:v1";
const dashboardDueDatesStorageKey = "abcDashboardDueDates:v1";
const dashboardStatusesStorageKey = "abcDashboardStatuses:v1";
const dashboardNotesStorageKey = "abcDashboardNotes:v1";
const dashboardBallOwnersStorageKey = "abcDashboardBallOwners:v1";
const dashboardNextActionsStorageKey = "abcDashboardNextActions:v1";
const dashboardViewStorageKey = "abcDashboardView:v1";
const learnedRulesStorageKey = "abcLearnedRules:v1";
const manualRequestsStorageKey = "abcManualRequests:v1";
const authTokenStorageKey = "abcAuthToken:v1";
const authConfig = window.ABC_TASK_AUTH_CONFIG || {};
const allowedAuthDomain = authConfig.allowedDomain || "shibuya-ad.com";
const dataSource = authConfig.dataSource || "local";
const firestoreAppPath = Array.isArray(authConfig.firestoreAppPath)
  ? authConfig.firestoreAppPath
  : ["salesTaskApps", "abcClinic"];
const firebaseRequiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
let firebaseModulesPromise = null;
let remoteSaveTimer = null;
let pendingRemotePatch = {};

const state = {
  data: null,
  manualJudgments: null,
  syncHealth: null,
  decisions: JSON.parse(localStorage.getItem(decisionStorageKey) || "{}"),
  taskStatuses: JSON.parse(localStorage.getItem(taskStatusStorageKey) || "{}"),
  taskNotes: JSON.parse(localStorage.getItem(taskNoteStorageKey) || "{}"),
  deletedTasks: JSON.parse(localStorage.getItem(deletedTasksStorageKey) || "{}"),
  appliedTasks: JSON.parse(localStorage.getItem(appliedTasksStorageKey) || "{}"),
  completedTasks: JSON.parse(localStorage.getItem(completedTasksStorageKey) || "{}"),
  restoredCandidates: JSON.parse(localStorage.getItem(restoredCandidatesStorageKey) || "{}"),
  dashboardDueDates: JSON.parse(localStorage.getItem(dashboardDueDatesStorageKey) || "{}"),
  dashboardStatuses: JSON.parse(localStorage.getItem(dashboardStatusesStorageKey) || "{}"),
  dashboardNotes: JSON.parse(localStorage.getItem(dashboardNotesStorageKey) || "{}"),
  dashboardBallOwners: JSON.parse(localStorage.getItem(dashboardBallOwnersStorageKey) || "{}"),
  dashboardNextActions: JSON.parse(localStorage.getItem(dashboardNextActionsStorageKey) || "{}"),
  dashboardView: localStorage.getItem(dashboardViewStorageKey) || "table",
  learnedRules: JSON.parse(localStorage.getItem(learnedRulesStorageKey) || "[]"),
  selectedDetailRow: null,
  manualRequests: JSON.parse(localStorage.getItem(manualRequestsStorageKey) || "[]"),
  activeSection: "dashboard",
  activeTab: "tasks",
  theme: localStorage.getItem(themeStorageKey) || "light",
  authToken: localStorage.getItem(authTokenStorageKey) || "",
  currentUser: null,
  dataLoaded: false,
  firebaseApp: null,
  firebaseAuth: null,
  firestoreDb: null,
  firebaseModules: null,
  authMode: dataSource === "firestore" ? "firebase" : "google"
};

function isFirestoreMode() {
  return dataSource === "firestore";
}

function hasFirebaseConfig() {
  return Boolean(
    authConfig.firebaseConfig &&
      firebaseRequiredKeys.every((key) => String(authConfig.firebaseConfig[key] || "").trim())
  );
}

async function loadFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
    ]).then(([app, auth, firestore]) => ({ ...app, ...auth, ...firestore }));
  }
  return firebaseModulesPromise;
}

function emptyData() {
  return {
    generatedAt: "",
    scope: "firestore",
    rooms: [],
    categories: [],
    manualJudgments: {
      totalJudgments: 0,
      matchedCandidates: 0,
      unmatchedJudgments: 0
    },
    excludedCandidates: { count: 0 },
    candidates: []
  };
}

const elements = {
  authOverlay: document.querySelector("#authOverlay"),
  googleSignIn: document.querySelector("#googleSignIn"),
  authMessage: document.querySelector("#authMessage"),
  signedInUser: document.querySelector("#signedInUser"),
  signOutButton: document.querySelector("#signOutButton"),
  candidateList: document.querySelector("#candidateList"),
  taskList: document.querySelector("#taskList"),
  deletedList: document.querySelector("#deletedList"),
  emptyState: document.querySelector("#emptyState"),
  categoryFilter: document.querySelector("#categoryFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  searchInput: document.querySelector("#searchInput"),
  roomList: document.querySelector("#roomList"),
  statCandidates: document.querySelector("#statCandidates"),
  statTasks: document.querySelector("#statTasks"),
  statPending: document.querySelector("#statPending"),
  candidateView: document.querySelector("#candidateView"),
  taskView: document.querySelector("#taskView"),
  deletedView: document.querySelector("#deletedView"),
  taskManagementView: document.querySelector("#taskManagementView"),
  dashboardView: document.querySelector("#dashboardView"),
  dashboardSummary: document.querySelector("#dashboardSummary"),
  dashboardTableView: document.querySelector("#dashboardTableView"),
  dashboardKanbanView: document.querySelector("#dashboardKanbanView"),
  duplicateList: document.querySelector("#duplicateList"),
  syncLog: document.querySelector("#syncLog"),
  ruleForm: document.querySelector("#ruleForm"),
  rulePhrase: document.querySelector("#rulePhrase"),
  ruleOutcome: document.querySelector("#ruleOutcome"),
  ruleList: document.querySelector("#ruleList"),
  taskDetailPanel: document.querySelector("#taskDetailPanel"),
  taskDetailContent: document.querySelector("#taskDetailContent"),
  detailCloseButton: document.querySelector("#detailCloseButton"),
  requestView: document.querySelector("#requestView"),
  dashboardBody: document.querySelector("#dashboardBody"),
  themeButton: document.querySelector("#themeButton"),
  requestForm: document.querySelector("#requestForm"),
  requestRequester: document.querySelector("#requestRequester"),
  requestBody: document.querySelector("#requestBody"),
  requestPriority: document.querySelector("#requestPriority"),
  requestDueDate: document.querySelector("#requestDueDate"),
  requestMessage: document.querySelector("#requestMessage")
};

function decodeJwt(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid token");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const json = decodeURIComponent(
    atob(padded)
      .split("")
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
  return JSON.parse(json);
}

function isExpired(payload) {
  if (!payload?.exp) return true;
  return Date.now() / 1000 > payload.exp - 60;
}

function isAllowedUser(payload) {
  const email = String(payload?.email || "").toLowerCase();
  const domain = email.split("@").at(-1);
  return Boolean(email && payload?.email_verified !== false && domain === allowedAuthDomain);
}

function showAuthMessage(message) {
  elements.authMessage.textContent = message;
}

function setAuthenticated(token, payload) {
  state.authToken = token || "";
  state.currentUser = {
    uid: payload.uid || "",
    email: payload.email || "",
    name: payload.name || payload.email || ""
  };
  if (token) localStorage.setItem(authTokenStorageKey, token);
  else localStorage.removeItem(authTokenStorageKey);
  document.body.classList.remove("auth-pending");
  elements.authOverlay.classList.add("hidden");
  elements.signedInUser.textContent = state.currentUser.email;
  elements.signOutButton.classList.remove("hidden");
  if (!state.dataLoaded) {
    loadData().catch((error) => {
      console.error(error);
      elements.emptyState.textContent = "候補データの読み込みに失敗しました。";
    });
  }
}

function clearAuth(message = "") {
  state.authToken = "";
  state.currentUser = null;
  state.dataLoaded = false;
  localStorage.removeItem(authTokenStorageKey);
  document.body.classList.add("auth-pending");
  elements.authOverlay.classList.remove("hidden");
  elements.signedInUser.textContent = "";
  elements.signOutButton.classList.add("hidden");
  showAuthMessage(message);
}

function handleCredentialResponse(response) {
  try {
    const token = response.credential || "";
    const payload = decodeJwt(token);
    if (isExpired(payload)) {
      clearAuth("ログインの有効期限が切れています。もう一度ログインしてください。");
      return;
    }
    if (!isAllowedUser(payload)) {
      clearAuth(`@${allowedAuthDomain} のGoogleアカウントのみ閲覧できます。`);
      return;
    }
    setAuthenticated(token, payload);
  } catch (error) {
    console.error(error);
    clearAuth("ログイン情報を確認できませんでした。もう一度ログインしてください。");
  }
}

function renderGoogleButton() {
  if (isFirestoreMode()) {
    renderFirebaseSignInButton();
    return;
  }
  if (!authConfig.googleClientId) {
    showAuthMessage("Googleログイン設定が未設定です。");
    return;
  }
  elements.googleSignIn.innerHTML = "";
  const tryRender = () => {
    if (!window.google?.accounts?.id) {
      window.setTimeout(tryRender, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: authConfig.googleClientId,
      callback: handleCredentialResponse,
      hd: allowedAuthDomain,
      auto_select: false,
      cancel_on_tap_outside: false
    });
    google.accounts.id.renderButton(elements.googleSignIn, {
      theme: "filled_blue",
      size: "large",
      shape: "pill",
      text: "signin_with",
      locale: "ja"
    });
    google.accounts.id.prompt();
  };
  tryRender();
}

function renderFirebaseSignInButton() {
  elements.googleSignIn.innerHTML = "";
  const button = document.createElement("button");
  button.className = "firebase-signin-button";
  button.type = "button";
  button.textContent = "Googleでログイン";
  button.addEventListener("click", signInWithFirebase);
  elements.googleSignIn.appendChild(button);
}

async function signInWithFirebase() {
  try {
    if (!state.firebaseAuth) {
      showAuthMessage("Firebaseの初期化が完了していません。");
      return;
    }
    const provider = new state.firebaseModules.GoogleAuthProvider();
    provider.setCustomParameters({ hd: allowedAuthDomain });
    await state.firebaseModules.signInWithPopup(state.firebaseAuth, provider);
  } catch (error) {
    console.error(error);
    showAuthMessage("Googleログインに失敗しました。もう一度試してください。");
  }
}

async function initFirebaseAuth() {
  if (!hasFirebaseConfig()) {
    clearAuth("Firebase設定が未設定です。`public/config.js` にfirebaseConfigを設定してください。");
    renderFirebaseSignInButton();
    return;
  }
  try {
    state.firebaseModules = await loadFirebaseModules();
    state.firebaseApp = state.firebaseModules.getApps().length
      ? state.firebaseModules.getApps()[0]
      : state.firebaseModules.initializeApp(authConfig.firebaseConfig);
    state.firebaseAuth = state.firebaseModules.getAuth(state.firebaseApp);
    state.firestoreDb = state.firebaseModules.getFirestore(state.firebaseApp);
    renderFirebaseSignInButton();
    state.firebaseModules.onAuthStateChanged(state.firebaseAuth, async (user) => {
      if (!user) {
        clearAuth("");
        renderFirebaseSignInButton();
        return;
      }
      const email = String(user.email || "").toLowerCase();
      const domain = email.split("@").at(-1);
      if (!email || domain !== allowedAuthDomain) {
        await state.firebaseModules.signOut(state.firebaseAuth);
        clearAuth(`@${allowedAuthDomain} のGoogleアカウントのみ閲覧できます。`);
        renderFirebaseSignInButton();
        return;
      }
      setAuthenticated("", {
        uid: user.uid,
        email,
        name: user.displayName || email
      });
    });
  } catch (error) {
    console.error(error);
    clearAuth("Firebaseの初期化に失敗しました。設定を確認してください。");
    renderFirebaseSignInButton();
  }
}

function initAuth() {
  if (isFirestoreMode()) {
    initFirebaseAuth();
    return;
  }
  if (state.authToken) {
    try {
      const payload = decodeJwt(state.authToken);
      if (!isExpired(payload) && isAllowedUser(payload)) {
        setAuthenticated(state.authToken, payload);
        return;
      }
    } catch (error) {
      console.warn(error);
    }
  }
  clearAuth("");
  renderGoogleButton();
}

async function signOut() {
  if (isFirestoreMode() && state.firebaseAuth && state.firebaseModules) {
    await state.firebaseModules.signOut(state.firebaseAuth);
    return;
  }
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  clearAuth("ログアウトしました。");
  renderGoogleButton();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  elements.themeButton.setAttribute("aria-pressed", String(state.theme === "dark"));
  elements.themeButton.lastChild.textContent = state.theme === "dark" ? "ライト" : "ダーク";
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem(themeStorageKey, state.theme);
  applyTheme();
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getDecision(candidate) {
  if (state.decisions[candidate.id]) return state.decisions[candidate.id];
  const mergedMatches = (candidate.mergedFromIds || [])
    .map((id) => state.decisions[id])
    .filter(Boolean);
  if (mergedMatches.length) {
    const unique = [...new Set(mergedMatches)];
    return unique.length === 1 ? unique[0] : "確認必要";
  }
  const legacyPrefix = `${candidate.roomId}-${candidate.messageId}-`;
  const legacyMatches = Object.entries(state.decisions).filter(([id]) => id.startsWith(legacyPrefix));
  if (legacyMatches.length === 1) return legacyMatches[0][1];
  return candidate.decision || "未判断";
}

function saveDecision(id, decision) {
  state.decisions[id] = decision;
  localStorage.setItem(decisionStorageKey, JSON.stringify(state.decisions));
  persistRemoteState({ decisions: state.decisions });
  render();
}

function getTaskStatus(candidate) {
  return state.taskStatuses[candidate.id] || candidate.manualTaskStatus || { type: "", other: "" };
}

function saveTaskStatus(id, status) {
  state.taskStatuses[id] = status;
  localStorage.setItem(taskStatusStorageKey, JSON.stringify(state.taskStatuses));
  persistRemoteState({ taskStatuses: state.taskStatuses });
}

function getTaskNote(candidate) {
  return state.taskNotes[candidate.id] || "";
}

function saveTaskNote(id, note) {
  state.taskNotes[id] = note;
  localStorage.setItem(taskNoteStorageKey, JSON.stringify(state.taskNotes));
  persistRemoteState({ taskNotes: state.taskNotes });
}

function taskKey(task) {
  return task.sourceCandidateId || task.id || task.candidateId;
}

function messageIdsForTask(task) {
  return [
    ...String(task.messageId || "").split(","),
    ...(task.mergedMessageIds || [])
  ].map((id) => String(id).trim()).filter(Boolean);
}

function roomIdForTask(task) {
  if (task.roomId) return Number(task.roomId);
  const match = String(task.chatworkUrl || task.href || "").match(/rid(\d+)/);
  return match ? Number(match[1]) : 0;
}

function lineScenarioDuplicateKey(task) {
  const text = `${task.body || ""}\n${task.originalBody || ""}\n${task.reviewReason || ""}`;
  if (
    text.includes("LINEシナリオ") &&
    (text.includes("CPF") || text.includes("介入")) &&
    (text.includes("クリニック回答") || text.includes("開始時期") || text.includes("社内リソース"))
  ) {
    return "topic:line-scenario-cpf";
  }
  return "";
}

function taskDuplicateKey(task) {
  const lineKey = lineScenarioDuplicateKey(task);
  if (lineKey) return lineKey;

  const roomId = roomIdForTask(task);
  const ids = messageIdsForTask(task);
  if (roomId && ids.length) return `message:${roomId}:${[...new Set(ids)].sort().join(",")}`;

  return `id:${taskKey(task)}`;
}

function taskArchivePriority(task, source) {
  let priority = source === "current" ? 30 : source === "applied" ? 20 : 10;
  const text = `${task.body || ""}\n${task.originalBody || ""}`;
  if (text.includes("CPF/LINEシナリオ介入条件・開始時期・社内リソース")) priority += 60;
  else if (text.includes("CPF/LINEシナリオ介入条件") || text.includes("クリニック回答")) priority += 50;
  if (text.includes("pangleサーバー対策")) priority += 5;
  return priority;
}

function currentCandidateForTask(task) {
  const key = taskKey(task);
  const taskMessageIds = new Set(messageIdsForTask(task));
  return (state.data?.candidates || []).find((candidate) => {
    if (candidate.id === key || taskKey(candidate) === key) return true;
    if (!taskMessageIds.size) return false;
    return messageIdsForTask(candidate).some((messageId) => taskMessageIds.has(messageId));
  });
}

function isRestoredCandidate(candidate) {
  return Boolean(state.restoredCandidates[taskKey(candidate)]);
}

function isDeletedCandidate(candidate) {
  const key = taskKey(candidate);
  if (isRestoredCandidate(candidate)) return false;
  if (state.deletedTasks[key]) return true;
  return Boolean(
    state.manualJudgments?.judgments?.some((judgment) => {
      return judgment.decision === "不要" && judgment.candidateId === key;
    })
  );
}

function isAppliedCandidate(candidate) {
  const key = taskKey(candidate);
  if (isRestoredCandidate(candidate)) return false;
  if (state.appliedTasks[key]) return true;
  if (candidate.forcedTarget && getDecision(candidate) === "タスク候補") return true;
  if (candidate.manualDecision && getDecision(candidate) === "タスク候補") return true;
  return Boolean(
    state.manualJudgments?.judgments?.some((judgment) => {
      return judgment.decision === "タスク候補" && (
        judgment.candidateId === key ||
        taskDuplicateKey(judgment) === taskDuplicateKey(candidate)
      );
    })
  );
}

function manualDecisionFor(id) {
  return state.manualJudgments?.judgments?.find((judgment) => judgment.candidateId === id)?.decision || "";
}

function localDecisionFor(id) {
  return state.decisions[id] || "";
}

function hasAppliedKeepDecision(id) {
  return Boolean(state.appliedTasks[id] && localDecisionFor(id) === "タスク候補");
}

function isCompletedTask(task) {
  return Boolean(state.completedTasks[taskKey(task)]);
}

function firestoreDocRef(...segments) {
  return state.firebaseModules.doc(state.firestoreDb, ...firestoreAppPath, ...segments);
}

function persistRemoteState(patch) {
  if (!isFirestoreMode() || !state.firestoreDb || !state.currentUser) return;
  pendingRemotePatch = { ...pendingRemotePatch, ...patch };
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(flushRemoteState, 500);
}

async function flushRemoteState() {
  if (!Object.keys(pendingRemotePatch).length || !state.firestoreDb || !state.currentUser) return;
  const patch = pendingRemotePatch;
  pendingRemotePatch = {};
  try {
    await state.firebaseModules.setDoc(
      firestoreDocRef("state", "shared"),
      {
        ...patch,
        updatedAt: state.firebaseModules.serverTimestamp(),
        updatedBy: state.currentUser.email
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
    showAuthMessage("Firestoreへの保存に失敗しました。権限またはネットワークを確認してください。");
    pendingRemotePatch = { ...patch, ...pendingRemotePatch };
  }
}

function cacheStateValue(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function applyRemoteState(remoteState = {}) {
  const mapFields = [
    ["decisions", decisionStorageKey],
    ["taskStatuses", taskStatusStorageKey],
    ["taskNotes", taskNoteStorageKey],
    ["deletedTasks", deletedTasksStorageKey],
    ["appliedTasks", appliedTasksStorageKey],
    ["completedTasks", completedTasksStorageKey],
    ["restoredCandidates", restoredCandidatesStorageKey],
    ["dashboardDueDates", dashboardDueDatesStorageKey],
    ["dashboardStatuses", dashboardStatusesStorageKey],
    ["dashboardNotes", dashboardNotesStorageKey],
    ["dashboardBallOwners", dashboardBallOwnersStorageKey],
    ["dashboardNextActions", dashboardNextActionsStorageKey]
  ];
  mapFields.forEach(([field, storageKey]) => {
    if (!remoteState[field] || typeof remoteState[field] !== "object") return;
    state[field] = remoteState[field];
    cacheStateValue(storageKey, state[field]);
  });
  if (Array.isArray(remoteState.learnedRules)) {
    state.learnedRules = remoteState.learnedRules;
    cacheStateValue(learnedRulesStorageKey, state.learnedRules);
  }
  if (Array.isArray(remoteState.manualRequests)) {
    state.manualRequests = remoteState.manualRequests;
    cacheStateValue(manualRequestsStorageKey, state.manualRequests);
  }
  if (remoteState.dashboardView) {
    state.dashboardView = remoteState.dashboardView;
    localStorage.setItem(dashboardViewStorageKey, state.dashboardView);
  }
}

function saveDeletedTasks() {
  localStorage.setItem(deletedTasksStorageKey, JSON.stringify(state.deletedTasks));
  persistRemoteState({ deletedTasks: state.deletedTasks });
}

function saveAppliedTasks() {
  localStorage.setItem(appliedTasksStorageKey, JSON.stringify(state.appliedTasks));
  persistRemoteState({ appliedTasks: state.appliedTasks });
}

function saveCompletedTasks() {
  localStorage.setItem(completedTasksStorageKey, JSON.stringify(state.completedTasks));
  persistRemoteState({ completedTasks: state.completedTasks });
}

function saveRestoredCandidates() {
  localStorage.setItem(restoredCandidatesStorageKey, JSON.stringify(state.restoredCandidates));
  persistRemoteState({ restoredCandidates: state.restoredCandidates });
}

function saveDashboardDueDates() {
  localStorage.setItem(dashboardDueDatesStorageKey, JSON.stringify(state.dashboardDueDates));
  persistRemoteState({ dashboardDueDates: state.dashboardDueDates });
}

function saveDashboardStatuses() {
  localStorage.setItem(dashboardStatusesStorageKey, JSON.stringify(state.dashboardStatuses));
  persistRemoteState({ dashboardStatuses: state.dashboardStatuses });
}

function saveDashboardNotes() {
  localStorage.setItem(dashboardNotesStorageKey, JSON.stringify(state.dashboardNotes));
  persistRemoteState({ dashboardNotes: state.dashboardNotes });
}

function saveDashboardBallOwners() {
  localStorage.setItem(dashboardBallOwnersStorageKey, JSON.stringify(state.dashboardBallOwners));
  persistRemoteState({ dashboardBallOwners: state.dashboardBallOwners });
}

function saveDashboardNextActions() {
  localStorage.setItem(dashboardNextActionsStorageKey, JSON.stringify(state.dashboardNextActions));
  persistRemoteState({ dashboardNextActions: state.dashboardNextActions });
}

function saveLearnedRules() {
  localStorage.setItem(learnedRulesStorageKey, JSON.stringify(state.learnedRules));
  persistRemoteState({ learnedRules: state.learnedRules });
}

function saveManualRequests() {
  localStorage.setItem(manualRequestsStorageKey, JSON.stringify(state.manualRequests));
  persistRemoteState({ manualRequests: state.manualRequests });
}

function saveDecisions() {
  localStorage.setItem(decisionStorageKey, JSON.stringify(state.decisions));
  persistRemoteState({ decisions: state.decisions });
}

function archiveCandidate(candidate) {
  return {
    ...candidate,
    archivedAt: new Date().toISOString(),
    sourceCandidateId: candidate.id,
    decision: "不要",
    metaLabel: candidate.metaLabel || `${formatDate(candidate.sentAt)} / ${candidate.accountName} / ${candidate.roomName}`,
    manualTaskStatus: getTaskStatus(candidate),
    manualTaskNote: getTaskNote(candidate)
  };
}

function archiveCompletedTask(task) {
  return {
    ...task,
    id: taskKey(task),
    sourceCandidateId: taskKey(task),
    completedAt: new Date().toISOString(),
    decision: "完了済み",
    metaLabel: task.metaLabel || `${formatDate(task.sentAt)} / ${task.accountName} / ${task.roomName}`,
    manualTaskStatus: getTaskStatus(task),
    manualTaskNote: getTaskNote(task)
  };
}

function archiveTaskCandidate(candidate) {
  return {
    ...candidate,
    appliedAt: new Date().toISOString(),
    sourceCandidateId: candidate.id,
    decision: "タスク候補",
    metaLabel: candidate.metaLabel || `${formatDate(candidate.sentAt)} / ${candidate.accountName} / ${candidate.roomName}`,
    manualTaskStatus: getTaskStatus(candidate),
    manualTaskNote: getTaskNote(candidate)
  };
}

function restoreCandidateFromTask(task) {
  const key = taskKey(task);
  return {
    ...task,
    id: key,
    sourceCandidateId: key,
    decision: "確認必要",
    restoredAt: new Date().toISOString(),
    metaLabel: task.metaLabel || `${formatDate(task.sentAt)} / ${task.accountName} / ${task.roomName}`,
    manualTaskStatus: getTaskStatus(task),
    manualTaskNote: getTaskNote(task)
  };
}

function splitManualMeta(meta = "") {
  const [timeLabel = "", accountName = "", roomName = ""] = meta.split(" / ");
  return { timeLabel, accountName, roomName };
}

function manualDeletedTask(judgment) {
  const meta = splitManualMeta(judgment.meta);
  return {
    id: `manual-deleted-${judgment.candidateId}`,
    sourceCandidateId: judgment.candidateId,
    messageId: judgment.messageId,
    roomId: judgment.roomId,
    roomName: meta.roomName,
    accountName: meta.accountName,
    metaLabel: judgment.meta || "",
    category: judgment.category,
    decision: "不要",
    body: judgment.body,
    originalBody: judgment.body,
    chatworkUrl: judgment.href,
    scopeReason: meta.accountName.includes("松﨑") ? "松﨑から送信" : "",
    manualTaskStatus: judgment.taskStatus || { type: "", other: "" },
    manualTaskNote: "",
    archivedAt: state.manualJudgments?.generatedAt || ""
  };
}

function manualTaskItem(judgment) {
  const meta = splitManualMeta(judgment.meta);
  return {
    id: `manual-task-${judgment.candidateId}`,
    sourceCandidateId: judgment.candidateId,
    messageId: judgment.messageId,
    roomId: judgment.roomId,
    roomName: meta.roomName,
    accountName: meta.accountName,
    metaLabel: judgment.meta || "",
    category: judgment.category,
    decision: "タスク候補",
    body: judgment.body,
    originalBody: judgment.body,
    chatworkUrl: judgment.href,
    scopeReason: meta.accountName.includes("松﨑") ? "松﨑から送信" : "",
    manualTaskStatus: judgment.taskStatus || { type: "", other: "" },
    manualTaskNote: "",
    appliedAt: state.manualJudgments?.generatedAt || ""
  };
}

function deletedTaskArchive() {
  const items = new Map();
  for (const judgment of state.manualJudgments?.judgments || []) {
    if (judgment.decision !== "不要") continue;
    if (state.restoredCandidates[judgment.candidateId]) continue;
    if (hasAppliedKeepDecision(judgment.candidateId)) continue;
    const item = manualDeletedTask(judgment);
    items.set(item.sourceCandidateId || item.id, item);
  }
  for (const item of Object.values(state.deletedTasks)) {
    const key = taskKey(item);
    if (state.restoredCandidates[key]) continue;
    items.set(key, item);
  }
  return [...items.values()];
}

function taskArchive() {
  const items = new Map();
  const duplicateKeys = new Map();
  const priorities = new Map();

  const setArchiveItem = (item, source) => {
    const key = taskKey(item);
    const duplicateKey = taskDuplicateKey(item);
    const priority = taskArchivePriority(item, source);
    const existingKey = duplicateKeys.get(duplicateKey);

    if (existingKey && items.has(existingKey)) {
      const existingPriority = priorities.get(existingKey) || 0;
      if (priority < existingPriority) return;
      items.delete(existingKey);
      priorities.delete(existingKey);
    }

    items.set(key, item);
    duplicateKeys.set(duplicateKey, key);
    priorities.set(key, priority);
  };

  for (const judgment of state.manualJudgments?.judgments || []) {
    if (judgment.decision !== "タスク候補") continue;
    if (state.deletedTasks[judgment.candidateId]) continue;
    if (state.restoredCandidates[judgment.candidateId]) continue;
    const item = manualTaskItem(judgment);
    setArchiveItem(item, "manual");
  }
  for (const candidate of state.data?.candidates || []) {
    if (isDeletedCandidate(candidate)) continue;
    if (getDecision(candidate) !== "タスク候補" || !isAppliedCandidate(candidate)) continue;
    setArchiveItem(candidate, "current");
  }
  const candidatesById = new Map((state.data?.candidates || []).map((candidate) => [candidate.id, candidate]));
  for (const item of Object.values(state.appliedTasks)) {
    const key = taskKey(item);
    if (state.deletedTasks[key]) continue;
    if (state.restoredCandidates[key]) continue;
    if (item.decision !== "タスク候補") continue;
    const currentCandidate = candidatesById.get(key);
    if (currentCandidate && getDecision(currentCandidate) !== "タスク候補") continue;
    const manualDecision = manualDecisionFor(key);
    const localDecision = localDecisionFor(key);
    if (localDecision && localDecision !== "タスク候補") continue;
    if (!localDecision && manualDecision && manualDecision !== "タスク候補") continue;
    setArchiveItem(item, "applied");
  }
  return [...items.values()];
}

function candidateArchive() {
  const items = new Map();
  for (const candidate of state.data?.candidates || []) {
    if (isDeletedCandidate(candidate)) continue;
    if (isAppliedCandidate(candidate)) continue;
    items.set(candidate.id, candidate);
  }
  for (const candidate of Object.values(state.restoredCandidates)) {
    if (isDeletedCandidate(candidate)) continue;
    if (isAppliedCandidate(candidate)) continue;
    items.set(taskKey(candidate), candidate);
  }
  return [...items.values()];
}

function splitTaskBody(body) {
  const text = (body || "").trim();
  if (!text) return [];
  if (text === "制作料・キャスティング費用請求のFIX状況を確認する") {
    return ["キャスティング費用請求のFIX状況を確認する"];
  }
  if (!text.includes("・")) return [text];

  const parts = text.split("・").map((part) => part.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";
  const suffixMatch = lastPart.match(/^(.+?)(を.+)$/);
  if (!suffixMatch) return parts;

  const suffix = suffixMatch[2];
  const stems = [...parts.slice(0, -1), suffixMatch[1]];
  return stems.map((part, index) => {
    if (part === "進捗" && index > 0) return `${stems[index - 1]}の進捗${suffix}`;
    return `${part}${suffix}`;
  });
}

function normalizeDashboardTaskText(text) {
  return text
    .replace(/pangle(?!サーバー)対策/g, "pangleサーバー対策")
    .replace(/対象メニュー詳細/g, "実質無料になるメニューの価格と内容")
    .replace(/NG訴求まとめ/g, "現時点でNGになる可能性のある訴求まとめ")
    .replace(/確認する$/g, "確認")
    .replace(/\s+/g, " ")
    .trim();
}

function taskStatusText(task) {
  const status = getTaskStatus(task);
  if (!status.type) return "不明";
  if (status.type !== "その他") return status.type;
  return status.other || "その他";
}

function dashboardStatusText(status) {
  if (!status?.type) return "不明";
  if (status.type !== "その他") return status.type;
  return status.other || "その他";
}

const ballOwnerOptions = ["", "営業部", "ミチガエル", "ABC側", "AXIS社内", "エックスラボ"];
const dashboardStatusOptions = [
  ["", "自動判定"],
  ["営業部ボール", "営業部ボール"],
  ["先方確認中", "先方確認中"],
  ["要確認", "要確認"],
  ["その他", "その他(自由入力)"],
  ["重複", "重複"],
  ["完了", "完了"]
];

function normalizeBallOwner(value) {
  if (value === "YA") return "ABC側";
  if (value === "社内運用") return "AXIS社内";
  if (value === "不明") return "";
  return value || "";
}

function inferBallOwner(task, body) {
  const text = `${body || ""}\n${task.body || ""}\n${task.originalBody || ""}\n${task.category || ""}\n${task.roomName || ""}`;
  if (text.includes("エックスラボ") || text.includes("Xラボ")) return "エックスラボ";
  if (text.includes("ワイエージェンシー") || /\bYA\b/.test(text)) return "ABC側";
  if (task.category === "社内運用部への確認" || text.includes("社内") || text.includes("運用")) return "AXIS社内";
  if (text.includes("ABC側") || text.includes("クリニック") || text.includes("クライアント")) return "ABC側";
  if (text.includes("ミチガエル") || text.includes("PG")) return "ミチガエル";
  if (text.includes("営業部")) return "営業部";
  return "";
}

function inferNextAction(task, body) {
  const text = `${body || ""}\n${task.originalBody || ""}`;
  if (body.includes("期日") || body.includes("適用日") || body.includes("日時")) return `${body.replace(/を確認$/, "")}の回答を確認`;
  if (body.includes("価格") || body.includes("内容")) return "価格・内容の共有を待って確認";
  if (body.includes("進捗シート")) return "進捗シートの共有状況を確認";
  if (body.includes("NG") && body.includes("訴求")) return "NG可能性のある訴求まとめの共有を確認";
  if (body.includes("FIX") || text.includes("本日中")) return "FIX回答の有無を確認";
  if (body.includes("参加可否")) return "参加可否の返答を確認";
  if (body.includes("日程調整")) return "日程調整状況を確認";
  if (body.includes("整備") || body.includes("判断基準")) return "整備方針の回答を確認";
  if (body.includes("請求")) return "請求可否・請求範囲の回答を確認";
  return "次の返答・更新有無を確認";
}

function inferDashboardStatus(task, body, ballOwner) {
  const text = `${body || ""}\n${task.body || ""}\n${task.originalBody || ""}\n${task.reviewReason || ""}\n${task.statusSuggestion || ""}`;
  const externalWaitingSignals = [
    "回答待ち",
    "返答待ち",
    "確認中",
    "確認待ち",
    "後ほど",
    "追いかけ",
    "共有待ち",
    "先方",
    "クリニック",
    "ミチガエル",
    "エックスラボ",
    "Xラボ",
    "YA",
    "ワイエージェンシー"
  ];
  if (["ミチガエル", "ABC側", "エックスラボ"].includes(ballOwner)) return { type: "先方確認中", other: "" };
  if (externalWaitingSignals.some((signal) => text.includes(signal))) return { type: "先方確認中", other: "" };
  if (["営業部", "AXIS社内"].includes(ballOwner)) return { type: "営業部ボール", other: "" };
  if (body.includes("社内") || body.includes("リソース") || body.includes("対応方針")) return { type: "営業部ボール", other: "" };
  return { type: "営業部ボール", other: "" };
}

function dashboardStatusFor(key, task, body, ballOwner) {
  const savedStatus = state.dashboardStatuses[key];
  if (savedStatus?.type || savedStatus?.other) return savedStatus;
  const taskStatus = getTaskStatus(task);
  if (taskStatus.type) return taskStatus;
  return inferDashboardStatus(task, body, ballOwner);
}

function hasDonePossibility(task, body) {
  const completionSource = task.completionStatus ? task : currentCandidateForTask(task);
  if (completionSource?.completionStatus === "done-possible") {
    const scopes = completionSource.completionScopes || [];
    if (!scopes.length || scopes.some((scope) => body.includes(scope))) return true;
  }
  return false;
}

function daysSince(value) {
  if (!value) return 0;
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  return Math.floor((now - start) / 86400000);
}

function waitingAlertLabel(row) {
  if (row.status.type !== "先方確認中") return "";
  const days = daysSince(row.sentAt);
  const threshold = [10, 7, 4, 2].find((value) => days >= value);
  return threshold ? `先方確認中 ${threshold}日超` : "";
}

function rowAlert(row) {
  if (row.completed || row.duplicate) return "";
  if (row.dueDate) {
    const due = new Date(`${row.dueDate}T23:59:59`);
    if (!Number.isNaN(due.getTime()) && due < new Date()) return "期日超過";
  }
  const waitingAlert = waitingAlertLabel(row);
  if (waitingAlert) return waitingAlert;
  if (!row.dueDate && daysSince(row.sentAt) >= 3) return "期日なし 3日超";
  return "";
}

function dashboardParentMeta(task, childIndex, childrenCount) {
  const date = formatDate(task.sentAt);
  const room = task.roomName || "依頼";
  const child = childrenCount > 1 ? ` / 子タスク ${childIndex + 1}/${childrenCount}` : "";
  return `${date} / ${room}${child}`;
}

function dashboardRows() {
  const rows = [];
  let rowIndex = 0;
  for (const task of taskArchive()) {
    const key = taskKey(task);
    const taskParts = splitTaskBody(task.body);
    taskParts.forEach((body, index) => {
      const rowKey = `${key}::${index}`;
      const normalizedBody = normalizeDashboardTaskText(body);
      const ballOwner = normalizeBallOwner(state.dashboardBallOwners[rowKey] ?? inferBallOwner(task, normalizedBody));
      const status = dashboardStatusFor(rowKey, task, normalizedBody, ballOwner);
      const nextAction = state.dashboardNextActions[rowKey] ?? inferNextAction(task, normalizedBody);
      const dueDate = state.dashboardDueDates[rowKey] || "";
      const completed = status.type === "完了";
      const duplicate = status.type === "重複";
      const row = {
        key: rowKey,
        parentKey: key,
        childIndex: index,
        childrenCount: taskParts.length,
        task,
        body: normalizedBody,
        meta: dashboardParentMeta(task, index, taskParts.length),
        category: task.category || "",
        roomName: task.roomName || "",
        accountName: task.accountName || "",
        sentAt: task.sentAt || "",
        chatworkUrl: task.chatworkUrl || "",
        originalBody: task.originalBody || task.body || "",
        reviewReason: task.reviewReason || "",
        ballOwner,
        nextAction,
        status,
        statusText: dashboardStatusText(status),
        dueDate,
        note: state.dashboardNotes[rowKey] || "",
        donePossibility: hasDonePossibility(task, normalizedBody),
        tone: rowIndex % 6,
        duplicate,
        completed
      };
      row.alert = rowAlert(row);
      rows.push({
        ...row
      });
      rowIndex += 1;
    });
  }
  for (const request of state.manualRequests) {
    const rowKey = `request:${request.id}`;
    const ballOwner = normalizeBallOwner(state.dashboardBallOwners[rowKey] ?? "営業部");
    const status = state.dashboardStatuses[rowKey] || inferDashboardStatus(request, request.body, ballOwner);
    rows.push({
      key: rowKey,
      parentKey: rowKey,
      childIndex: 0,
      childrenCount: 1,
      task: request,
      body: request.body,
      meta: `依頼者: ${request.requester} / 優先度: ${request.priority}`,
      category: "依頼",
      roomName: "依頼",
      accountName: request.requester,
      sentAt: request.createdAt,
      chatworkUrl: "",
      originalBody: request.body,
      reviewReason: "依頼フォームから追加",
      ballOwner,
      nextAction: state.dashboardNextActions[rowKey] ?? "依頼内容を確認して対応方針を決める",
      status,
      statusText: dashboardStatusText(status),
      dueDate: state.dashboardDueDates[rowKey] || request.dueDate || "",
      note: state.dashboardNotes[rowKey] || "",
      donePossibility: false,
      tone: rowIndex % 6,
      duplicate: status.type === "重複",
      completed: status.type === "完了"
    });
    rows.at(-1).alert = rowAlert(rows.at(-1));
    rowIndex += 1;
  }
  return [
    ...rows.filter((row) => !row.completed && !row.duplicate),
    ...rows.filter((row) => row.duplicate),
    ...rows.filter((row) => row.completed)
  ];
}

function saveDashboardDueDate(key, value) {
  if (value) {
    state.dashboardDueDates[key] = value;
  } else {
    delete state.dashboardDueDates[key];
  }
  saveDashboardDueDates();
}

function saveDashboardStatus(key, status) {
  if (status.type || status.other) {
    state.dashboardStatuses[key] = status;
  } else {
    delete state.dashboardStatuses[key];
  }
  saveDashboardStatuses();
}

function learnDuplicateRule(item) {
  const phrase = (item.body || "").trim();
  if (!phrase) return;
  const exists = state.learnedRules.some((rule) => {
    return rule.phrase === phrase && rule.outcome === "統合候補";
  });
  if (exists) return;
  const id = crypto.randomUUID ? crypto.randomUUID() : `rule-${Date.now()}`;
  state.learnedRules.unshift({
    id,
    phrase,
    outcome: "統合候補",
    source: "ステータス:重複",
    taskKey: item.key || taskKey(item),
    createdAt: new Date().toISOString()
  });
  saveLearnedRules();
  renderLearnedRules();
}

function saveDashboardBallOwner(key, value) {
  const normalizedValue = normalizeBallOwner(value);
  if (normalizedValue) {
    state.dashboardBallOwners[key] = normalizedValue;
  } else {
    delete state.dashboardBallOwners[key];
  }
  saveDashboardBallOwners();
}

function saveDashboardNextAction(key, value) {
  if (value) {
    state.dashboardNextActions[key] = value;
  } else {
    delete state.dashboardNextActions[key];
  }
  saveDashboardNextActions();
}

function saveDashboardNote(key, value) {
  if (value) {
    state.dashboardNotes[key] = value;
  } else {
    delete state.dashboardNotes[key];
  }
  saveDashboardNotes();
}

function clearDashboardRowState(parentKey) {
  const matchesParent = (key) => key === parentKey || key.startsWith(`${parentKey}::`);
  [
    [state.dashboardDueDates, saveDashboardDueDates],
    [state.dashboardStatuses, saveDashboardStatuses],
    [state.dashboardBallOwners, saveDashboardBallOwners],
    [state.dashboardNextActions, saveDashboardNextActions],
    [state.dashboardNotes, saveDashboardNotes]
  ].forEach(([store, save]) => {
    Object.keys(store).forEach((key) => {
      if (matchesParent(key)) delete store[key];
    });
    save();
  });
}

function archiveDashboardTask(row) {
  const key = row.parentKey || taskKey(row.task);
  return {
    ...row.task,
    id: key,
    sourceCandidateId: key,
    archivedAt: new Date().toISOString(),
    decision: "不要",
    metaLabel: row.task.metaLabel || row.meta || `${formatDate(row.sentAt)} / ${row.accountName} / ${row.roomName}`,
    manualTaskStatus: row.status,
    manualTaskNote: row.note || ""
  };
}

function deleteDashboardRow(row) {
  const key = row.parentKey || row.key;
  if (key.startsWith("request:")) {
    const requestId = key.replace("request:", "");
    state.manualRequests = state.manualRequests.filter((request) => request.id !== requestId);
    saveManualRequests();
  } else {
    state.deletedTasks[key] = archiveDashboardTask(row);
    state.decisions[key] = "不要";
    delete state.appliedTasks[key];
    delete state.completedTasks[key];
    delete state.restoredCandidates[key];
    saveDeletedTasks();
    saveAppliedTasks();
    saveCompletedTasks();
    saveRestoredCandidates();
    saveDecisions();
  }
  clearDashboardRowState(key);
  closeTaskDetail();
  render();
}

function toggleCompletedTask(task) {
  const key = taskKey(task);
  if (state.completedTasks[key]) {
    delete state.completedTasks[key];
  } else {
    state.completedTasks[key] = archiveCompletedTask(task);
  }
  saveCompletedTasks();
  render();
}

function restoreDeletedTask(task) {
  const key = taskKey(task);
  state.restoredCandidates[key] = restoreCandidateFromTask(task);
  state.decisions[key] = "確認必要";
  delete state.deletedTasks[key];
  delete state.appliedTasks[key];
  delete state.completedTasks[key];
  localStorage.setItem(decisionStorageKey, JSON.stringify(state.decisions));
  saveDeletedTasks();
  saveAppliedTasks();
  saveCompletedTasks();
  saveRestoredCandidates();
  state.activeTab = "candidates";
  render();
}

function displayScopeReason(candidate) {
  if (candidate.scopeReason === "松﨑から送信" || candidate.accountName.includes("松﨑")) return "松﨑からの送信";
  if (candidate.scopeReason?.includes("To")) return "松﨑宛てTo";
  return "";
}

function filteredCandidates() {
  const candidates = candidateArchive();
  const status = elements.statusFilter.value;
  const category = elements.categoryFilter.value;
  const query = elements.searchInput.value.trim().toLowerCase();

  return candidates.filter((candidate) => {
    if (isDeletedCandidate(candidate)) return false;
    if (isAppliedCandidate(candidate)) return false;
    const decision = getDecision(candidate);
    if (status !== "all" && decision !== status) return false;
    if (category !== "all" && candidate.category !== category) return false;
    if (!query) return true;
    const haystack = [candidate.body, candidate.roomName, candidate.accountName, candidate.category, getTaskNote(candidate)].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderCandidate(candidate, options = {}) {
  const showDecisionActions = options.showDecisionActions ?? true;
  const showCompleteAction = options.showCompleteAction ?? false;
  const showRestoreAction = options.showRestoreAction ?? false;
  const template = document.querySelector("#candidateTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  const decision = getDecision(candidate);

  node.querySelector(".meta").textContent = candidate.metaLabel || `${formatDate(candidate.sentAt)} / ${candidate.accountName} / ${candidate.roomName}`;
  node.querySelector("h3").textContent = candidate.category;
  const scopePill = node.querySelector(".scope-pill");
  const scopeLabel = displayScopeReason(candidate);
  scopePill.textContent = scopeLabel;
  scopePill.classList.toggle("hidden", !scopeLabel);
  node.querySelector(".body").textContent = candidate.body;

  const taskStatus = getTaskStatus(candidate);
  const statusLabel = node.querySelector(".task-status");
  const statusSelect = node.querySelector(".task-status-select");
  const statusOther = node.querySelector(".task-status-other");
  statusSelect.value = taskStatus.type || "";
  statusOther.value = taskStatus.other || "";
  statusLabel.classList.toggle("other", statusSelect.value === "その他");
  node.classList.toggle("task-card-muted", statusSelect.value === "重複");
  statusSelect.addEventListener("change", () => {
    const nextStatus = {
      type: statusSelect.value,
      other: statusSelect.value === "その他" ? statusOther.value : ""
    };
    statusLabel.classList.toggle("other", statusSelect.value === "その他");
    node.classList.toggle("task-card-muted", nextStatus.type === "重複");
    saveTaskStatus(candidate.id, nextStatus);
    if (nextStatus.type === "重複") learnDuplicateRule(candidate);
    if (statusSelect.value === "その他") statusOther.focus();
  });
  statusOther.addEventListener("input", () => {
    saveTaskStatus(candidate.id, { type: "その他", other: statusOther.value });
  });

  const taskNote = node.querySelector(".task-note");
  taskNote.value = getTaskNote(candidate) || candidate.manualTaskNote || "";
  taskNote.addEventListener("input", () => {
    saveTaskNote(candidate.id, taskNote.value);
  });

  node.querySelector(".source-body").textContent = candidate.originalBody || candidate.body;

  node.querySelectorAll("button[data-decision]").forEach((button) => {
    if (!showDecisionActions) {
      button.remove();
      return;
    }
    button.classList.toggle("selected", button.dataset.decision === decision);
    button.setAttribute("aria-pressed", String(button.dataset.decision === decision));
    button.addEventListener("click", () => saveDecision(candidate.id, button.dataset.decision));
  });

  if (showCompleteAction) {
    const actions = node.querySelector(".actions");
    const completeButton = document.createElement("button");
    completeButton.className = "complete-button";
    completeButton.type = "button";
    completeButton.innerHTML = '<span class="action-icon keep" aria-hidden="true"></span>完了済み';
    completeButton.classList.toggle("selected", isCompletedTask(candidate));
    completeButton.setAttribute("aria-pressed", String(isCompletedTask(candidate)));
    completeButton.addEventListener("click", () => toggleCompletedTask(candidate));
    actions.prepend(completeButton);
  }

  if (showRestoreAction) {
    const actions = node.querySelector(".actions");
    const restoreButton = document.createElement("button");
    restoreButton.className = "restore-button";
    restoreButton.type = "button";
    restoreButton.innerHTML = '<span class="action-icon restore" aria-hidden="true"></span>候補に戻す';
    restoreButton.addEventListener("click", () => restoreDeletedTask(candidate));
    actions.prepend(restoreButton);
  }

  const link = node.querySelector("a");
  if (candidate.chatworkUrl) {
    link.href = candidate.chatworkUrl;
  } else {
    link.remove();
  }

  return node;
}

function renderRooms() {
  elements.roomList.innerHTML = "";
  for (const room of state.data?.rooms || []) {
    const item = document.createElement("li");
    item.textContent = `${room.id} / ${room.name}`;
    elements.roomList.appendChild(item);
  }
}

function renderFilters() {
  if (elements.categoryFilter.options.length > 1) return;
  for (const category of state.data?.categories || []) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.categoryFilter.appendChild(option);
  }
}

function renderStats() {
  const activeCandidates = candidateArchive();
  const taskCount = taskArchive().length;
  const pendingCount = activeCandidates.filter((candidate) => getDecision(candidate) === "確認必要").length;
  elements.statCandidates.textContent = String(activeCandidates.length);
  elements.statTasks.textContent = String(taskCount);
  elements.statPending.textContent = String(pendingCount);
}

function renderLists() {
  const candidates = filteredCandidates();
  elements.candidateList.innerHTML = "";
  elements.taskList.innerHTML = "";
  elements.deletedList.innerHTML = "";
  const visibleCandidates = candidateArchive();
  elements.emptyState.classList.toggle("hidden", visibleCandidates.length > 0);

  for (const candidate of candidates) {
    elements.candidateList.appendChild(renderCandidate(candidate, { showDecisionActions: true }));
  }

  const tasks = taskArchive();
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "タスク化された候補はまだありません。";
    elements.taskList.appendChild(empty);
  } else {
    for (const task of tasks) elements.taskList.appendChild(renderCandidate(task, { showDecisionActions: false, showCompleteAction: true }));
  }

  const deletedTasks = deletedTaskArchive();
  if (!deletedTasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "削除済みタスクはまだありません。";
    elements.deletedList.appendChild(empty);
  } else {
    for (const task of deletedTasks) elements.deletedList.appendChild(renderCandidate(task, { showDecisionActions: false, showRestoreAction: true }));
  }
}

function duplicateKey(body) {
  const text = body.replace(/\s/g, "");
  if (text.includes("キャスティング") && text.includes("請求")) return "キャスティング費用請求";
  if ((text.includes("制作料金") || text.includes("制作料")) && text.includes("請求")) return "制作料金請求";
  if (text.includes("レギュ") && text.includes("明文化")) return "レギュ明文化";
  if (text.includes("実質無料") && text.includes("訴求")) return "実質無料訴求";
  if (text.includes("承認") && text.includes("体制")) return "承認体制";
  return "";
}

function duplicateGroups(rows) {
  const groups = new Map();
  rows.filter((row) => !row.completed && !row.duplicate).forEach((row) => {
    const key = duplicateKey(row.body);
    if (!key) return;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  });
  return [...groups.entries()]
    .map(([key, items]) => ({ key, items }))
    .filter((group) => new Set(group.items.map((row) => row.parentKey)).size > 1);
}

function renderDashboardSummary(rows) {
  const activeRows = rows.filter((row) => !row.completed && !row.duplicate);
  const waitingRows = activeRows.filter((row) => row.status.type === "先方確認中");
  const alertRows = activeRows.filter((row) => row.alert);
  const noDueRows = activeRows.filter((row) => !row.dueDate);
  const duplicateCount = duplicateGroups(rows).length;
  const duplicateRows = rows.filter((row) => row.duplicate).length;
  const items = [
    ["未完了", activeRows.length],
    ["先方確認中", waitingRows.length],
    ["滞留", alertRows.length],
    ["期日なし", noDueRows.length],
    ["重複候補", duplicateCount],
    ["重複", duplicateRows]
  ];
  elements.dashboardSummary.innerHTML = "";
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = label === "滞留" && value > 0 ? "summary-card summary-card-alert" : "summary-card";
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    elements.dashboardSummary.appendChild(item);
  });
}

function renderDuplicateList(rows) {
  const groups = duplicateGroups(rows);
  elements.duplicateList.innerHTML = "";
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "insight-empty";
    empty.textContent = "重複候補はありません。";
    elements.duplicateList.appendChild(empty);
    return;
  }
  groups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "insight-item";
    const title = document.createElement("strong");
    title.textContent = group.key;
    item.appendChild(title);
    group.items.slice(0, 3).forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = row.body;
      button.addEventListener("click", () => openTaskDetail(row));
      item.appendChild(button);
    });
    elements.duplicateList.appendChild(item);
  });
}

function renderSyncLog() {
  const generatedAt = state.data?.generatedAt ? formatDate(state.data.generatedAt) : "-";
  const rooms = state.data?.rooms?.length || 0;
  const visible = state.data?.candidates?.length || 0;
  const excluded = state.data?.excludedCandidates?.count || 0;
  const matched = state.data?.manualJudgments?.matchedCandidates || 0;
  const total = state.data?.manualJudgments?.totalJudgments || 0;
  const health = state.syncHealth || null;
  elements.syncLog.innerHTML = "";

  const lines = [
    `最終取得: ${generatedAt}`,
    `対象ルーム: ${rooms}`,
    `表示候補: ${visible}`,
    `不要除外: ${excluded}`,
    `手動判断反映: ${matched}/${total}`
  ].map((text) => ({ text, className: "sync-line" }));

  if (health?.status === "error") {
    lines.unshift({
      text: `同期状態: エラー / ${health.message || "Chatwork APIトークンを確認してください。"}`,
      className: "sync-line sync-line--error"
    });
    if (health.recovery) {
      lines.splice(1, 0, {
        text: `対応: ${health.recovery}`,
        className: "sync-line sync-line--error"
      });
    }
  } else if (health?.status === "ok") {
    lines.unshift({
      text: `Chatworkトークン: 確認済み${health.checkedAt ? ` ${formatDate(health.checkedAt)}` : ""}`,
      className: "sync-line sync-line--ok"
    });
  }

  lines.forEach(({ text, className }) => {
    const item = document.createElement("p");
    item.className = className;
    item.textContent = text;
    elements.syncLog.appendChild(item);
  });
}

function renderLearnedRules() {
  elements.ruleList.innerHTML = "";
  if (!state.learnedRules.length) {
    const empty = document.createElement("p");
    empty.className = "insight-empty";
    empty.textContent = "画面上の試作用ルールはまだありません。";
    elements.ruleList.appendChild(empty);
    return;
  }
  state.learnedRules.forEach((rule) => {
    const item = document.createElement("div");
    item.className = "rule-item";
    const text = document.createElement("span");
    text.textContent = `${rule.phrase} / ${rule.outcome}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "削除";
    button.addEventListener("click", () => {
      state.learnedRules = state.learnedRules.filter((itemRule) => itemRule.id !== rule.id);
      saveLearnedRules();
      renderLearnedRules();
    });
    item.appendChild(text);
    item.appendChild(button);
    elements.ruleList.appendChild(item);
  });
}

function renderDashboardPanels(rows) {
  renderDashboardSummary(rows);
  renderDuplicateList(rows);
  renderSyncLog();
  renderLearnedRules();
  document.querySelectorAll(".dashboard-view-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.dashboardView === state.dashboardView);
  });
  elements.dashboardTableView.classList.toggle("hidden", state.dashboardView !== "table");
  elements.dashboardKanbanView.classList.toggle("hidden", state.dashboardView !== "kanban");
}

function detailLine(label, value) {
  const row = document.createElement("div");
  row.className = "detail-line";
  const key = document.createElement("span");
  key.textContent = label;
  const body = document.createElement("strong");
  body.textContent = value || "-";
  row.appendChild(key);
  row.appendChild(body);
  return row;
}

function openTaskDetail(row) {
  state.selectedDetailRow = row;
  renderTaskDetail(row);
}

function closeTaskDetail() {
  state.selectedDetailRow = null;
  elements.taskDetailPanel.classList.add("hidden");
  elements.taskDetailContent.innerHTML = "";
}

function renderTaskDetail(row) {
  elements.taskDetailContent.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = row.body;
  elements.taskDetailContent.appendChild(title);
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  [
    ["親投稿", row.meta],
    ["カテゴリ", row.category],
    ["ボール先", row.ballOwner || "不明"],
    ["ステータス", row.statusText],
    ["期日", row.dueDate || "不明"],
    ["次アクション", row.nextAction],
    ["滞留", row.alert || "なし"]
  ].forEach(([label, value]) => grid.appendChild(detailLine(label, value)));
  elements.taskDetailContent.appendChild(grid);

  const reason = document.createElement("section");
  reason.className = "detail-section";
  const reasonTitle = document.createElement("h3");
  reasonTitle.textContent = "判断理由";
  const reasonBody = document.createElement("p");
  reasonBody.textContent = row.reviewReason || "判断理由なし";
  reason.appendChild(reasonTitle);
  reason.appendChild(reasonBody);
  elements.taskDetailContent.appendChild(reason);

  const source = document.createElement("section");
  source.className = "detail-section";
  const sourceBody = document.createElement("pre");
  sourceBody.textContent = row.originalBody || row.body;
  source.appendChild(Object.assign(document.createElement("h3"), { textContent: "チャット本文" }));
  source.appendChild(sourceBody);
  elements.taskDetailContent.appendChild(source);

  if (row.chatworkUrl) {
    const link = document.createElement("a");
    link.className = "detail-chatwork-link";
    link.href = row.chatworkUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Chatworkリンクを開く";
    elements.taskDetailContent.appendChild(link);
  }
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "detail-delete-button";
  deleteButton.type = "button";
  deleteButton.textContent = "削除";
  deleteButton.addEventListener("click", () => deleteDashboardRow(row));
  actions.appendChild(deleteButton);
  elements.taskDetailContent.appendChild(actions);
  elements.taskDetailPanel.classList.remove("hidden");
}

function renderKanban(rows) {
  const columns = [
    ["不明", (row) => !row.status.type],
    ["営業部ボール", (row) => row.status.type === "営業部ボール"],
    ["先方確認中", (row) => row.status.type === "先方確認中"],
    ["その他", (row) => row.status.type === "その他"],
    ["重複", (row) => row.duplicate],
    ["完了", (row) => row.completed]
  ];
  elements.dashboardKanbanView.innerHTML = "";
  columns.forEach(([label, predicate]) => {
    const column = document.createElement("section");
    column.className = "kanban-column";
    const header = document.createElement("h2");
    const columnRows = rows.filter(predicate);
    header.textContent = `${label} ${columnRows.length}`;
    column.appendChild(header);
    columnRows.forEach((row) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = [
        "kanban-card",
        row.alert ? "kanban-card-alert" : "",
        row.duplicate ? "kanban-card-muted" : ""
      ].filter(Boolean).join(" ");
      const title = document.createElement("strong");
      title.textContent = row.body;
      if (row.donePossibility) {
        const tag = document.createElement("span");
        tag.className = "dashboard-done-possibility-tag";
        tag.textContent = "済の可能性";
        title.appendChild(tag);
      }
      const meta = document.createElement("span");
      meta.textContent = `${row.ballOwner || "ボール先不明"} / ${row.dueDate || "期日なし"}`;
      const action = document.createElement("small");
      action.textContent = row.nextAction;
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(action);
      card.addEventListener("click", () => openTaskDetail(row));
      column.appendChild(card);
    });
    elements.dashboardKanbanView.appendChild(column);
  });
}

function renderDashboard() {
  elements.dashboardBody.innerHTML = "";
  const rows = dashboardRows();
  renderDashboardPanels(rows);
  renderKanban(rows);
  if (state.selectedDetailRow) {
    const currentRow = rows.find((row) => row.key === state.selectedDetailRow.key);
    if (currentRow) renderTaskDetail(currentRow);
    else closeTaskDetail();
  }
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "dashboard-empty";
    cell.colSpan = 5;
    cell.textContent = "表示できるタスクはまだありません。";
    row.appendChild(cell);
    elements.dashboardBody.appendChild(row);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = [
      "dashboard-row",
      row.duplicate ? "dashboard-row-muted" : "",
      row.completed ? "dashboard-row-muted dashboard-row-completed" : ""
    ].filter(Boolean).join(" ");
    const bodyCell = document.createElement("td");
    bodyCell.className = `dashboard-task-cell dashboard-tone-${row.tone}`;
    const taskText = document.createElement("div");
    taskText.className = "dashboard-task-body";
    taskText.textContent = row.body;
    if (row.donePossibility) {
      const doneTag = document.createElement("span");
      doneTag.className = "dashboard-done-possibility-tag";
      doneTag.textContent = "済の可能性";
      taskText.appendChild(doneTag);
    }
    bodyCell.appendChild(taskText);
    const taskTools = document.createElement("div");
    taskTools.className = "dashboard-task-tools";
    if (row.alert) {
      const alert = document.createElement("span");
      alert.className = "dashboard-alert-pill";
      alert.textContent = row.alert;
      taskTools.appendChild(alert);
    }
    const detailButton = document.createElement("button");
    detailButton.className = "dashboard-detail-button";
    detailButton.type = "button";
    detailButton.textContent = "詳細";
    detailButton.addEventListener("click", () => openTaskDetail(row));
    taskTools.appendChild(detailButton);
    bodyCell.appendChild(taskTools);
    if (row.meta) {
      const taskMeta = document.createElement("div");
      taskMeta.className = "dashboard-task-meta";
      taskMeta.textContent = row.meta;
      bodyCell.appendChild(taskMeta);
    }

    const ballOwnerCell = document.createElement("td");
    const ballOwnerSelect = document.createElement("select");
    ballOwnerSelect.className = "dashboard-ball-owner";
    ballOwnerOptions.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || "不明";
      ballOwnerSelect.appendChild(option);
    });
    ballOwnerSelect.value = row.ballOwner || "";
    ballOwnerSelect.addEventListener("change", () => {
      saveDashboardBallOwner(row.key, ballOwnerSelect.value);
      renderDashboard();
    });
    ballOwnerCell.appendChild(ballOwnerSelect);

    const nextActionCell = document.createElement("td");
    const nextActionInput = document.createElement("textarea");
    nextActionInput.className = "dashboard-next-action";
    nextActionInput.rows = 2;
    nextActionInput.value = row.nextAction;
    nextActionInput.addEventListener("input", () => {
      saveDashboardNextAction(row.key, nextActionInput.value);
    });
    nextActionCell.appendChild(nextActionInput);

    const statusCell = document.createElement("td");
    statusCell.className = "dashboard-status-cell";
    const statusSelect = document.createElement("select");
    statusSelect.className = "dashboard-status-select";
    dashboardStatusOptions.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusSelect.appendChild(option);
    });
    statusSelect.value = row.status.type || "";
    const statusOther = document.createElement("input");
    statusOther.className = "dashboard-status-other";
    statusOther.type = "text";
    statusOther.placeholder = "ステータスを入力";
    statusOther.value = row.status.other || "";
    statusOther.classList.toggle("hidden", statusSelect.value !== "その他");
    statusSelect.addEventListener("change", () => {
      const nextStatus = {
        type: statusSelect.value,
        other: statusSelect.value === "その他" ? statusOther.value : ""
      };
      saveDashboardStatus(row.key, nextStatus);
      if (nextStatus.type === "重複") learnDuplicateRule(row);
      renderDashboard();
    });
    statusOther.addEventListener("input", () => {
      saveDashboardStatus(row.key, { type: "その他", other: statusOther.value });
    });
    statusCell.appendChild(statusSelect);
    statusCell.appendChild(statusOther);

    const dueDateCell = document.createElement("td");
    const dueDateInput = document.createElement("input");
    dueDateInput.className = "dashboard-due-date";
    dueDateInput.type = "date";
    dueDateInput.value = row.dueDate;
    dueDateInput.addEventListener("change", () => saveDashboardDueDate(row.key, dueDateInput.value));
    dueDateCell.appendChild(dueDateInput);

    tr.appendChild(bodyCell);
    tr.appendChild(ballOwnerCell);
    tr.appendChild(nextActionCell);
    tr.appendChild(statusCell);
    tr.appendChild(dueDateCell);
    elements.dashboardBody.appendChild(tr);

    const noteRow = document.createElement("tr");
    noteRow.className = [
      "dashboard-note-row",
      row.duplicate ? "dashboard-row-muted" : "",
      row.completed ? "dashboard-row-muted dashboard-row-completed" : ""
    ].filter(Boolean).join(" ");
    const noteCell = document.createElement("td");
    noteCell.colSpan = 5;
    const noteDetails = document.createElement("details");
    noteDetails.className = "dashboard-note-panel";
    const noteSummary = document.createElement("summary");
    noteSummary.textContent = "備考";
    const noteTextarea = document.createElement("textarea");
    noteTextarea.className = "dashboard-note-input";
    noteTextarea.rows = 2;
    noteTextarea.placeholder = "補足・確認メモ";
    noteTextarea.value = row.note;
    noteTextarea.addEventListener("input", () => saveDashboardNote(row.key, noteTextarea.value));
    noteDetails.appendChild(noteSummary);
    noteDetails.appendChild(noteTextarea);
    noteCell.appendChild(noteDetails);
    noteRow.appendChild(noteCell);
    elements.dashboardBody.appendChild(noteRow);
  }
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === state.activeTab);
  });
  elements.candidateView.classList.toggle("hidden", state.activeTab !== "candidates");
  elements.taskView.classList.toggle("hidden", state.activeTab !== "tasks");
  elements.deletedView.classList.toggle("hidden", state.activeTab !== "deleted");
}

function renderSections() {
  document.querySelectorAll(".sidebar-nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === state.activeSection);
  });
  document.querySelectorAll(".task-management-sidebar").forEach((section) => {
    section.classList.toggle("hidden", state.activeSection !== "taskManagement");
  });
  document.querySelectorAll(".task-management-action").forEach((button) => {
    button.classList.toggle("hidden", state.activeSection !== "taskManagement");
  });
  elements.taskManagementView.classList.toggle("hidden", state.activeSection !== "taskManagement");
  elements.dashboardView.classList.toggle("hidden", state.activeSection !== "dashboard");
  elements.requestView.classList.toggle("hidden", state.activeSection !== "request");
}

function render() {
  renderFilters();
  renderRooms();
  renderStats();
  renderLists();
  renderDashboard();
  renderTabs();
  renderSections();
}

function applyDecisions() {
  for (const task of taskArchive()) {
    if (!isCompletedTask(task)) continue;
    const key = taskKey(task);
    state.deletedTasks[key] = state.completedTasks[key] || archiveCompletedTask(task);
    delete state.appliedTasks[key];
    delete state.completedTasks[key];
  }
  for (const candidate of candidateArchive()) {
    const decision = getDecision(candidate);
    if (decision === "不要" && !isDeletedCandidate(candidate)) {
      const key = taskKey(candidate);
      state.deletedTasks[key] = archiveCandidate(candidate);
      delete state.appliedTasks[key];
      delete state.completedTasks[key];
      delete state.restoredCandidates[key];
    }
    if (decision === "タスク候補" && !isAppliedCandidate(candidate)) {
      const key = taskKey(candidate);
      state.appliedTasks[key] = archiveTaskCandidate(candidate);
      delete state.restoredCandidates[key];
    }
  }
  saveDeletedTasks();
  saveAppliedTasks();
  saveCompletedTasks();
  saveRestoredCandidates();
  state.activeTab = "tasks";
  render();
}

function resetDecisions() {
  localStorage.removeItem(decisionStorageKey);
  localStorage.removeItem(taskStatusStorageKey);
  localStorage.removeItem(taskNoteStorageKey);
  localStorage.removeItem(dashboardBallOwnersStorageKey);
  localStorage.removeItem(dashboardNextActionsStorageKey);
  state.decisions = {};
  state.taskStatuses = {};
  state.taskNotes = {};
  state.dashboardBallOwners = {};
  state.dashboardNextActions = {};
  persistRemoteState({
    decisions: {},
    taskStatuses: {},
    taskNotes: {},
    dashboardBallOwners: {},
    dashboardNextActions: {}
  });
  render();
}

function setDashboardView(view) {
  state.dashboardView = view;
  localStorage.setItem(dashboardViewStorageKey, view);
  persistRemoteState({ dashboardView: view });
  renderDashboard();
}

function handleRuleSubmit(event) {
  event.preventDefault();
  const phrase = elements.rulePhrase.value.trim();
  const outcome = elements.ruleOutcome.value;
  if (!phrase) return;
  const id = crypto.randomUUID ? crypto.randomUUID() : `rule-${Date.now()}`;
  state.learnedRules.unshift({
    id,
    phrase,
    outcome,
    createdAt: new Date().toISOString()
  });
  saveLearnedRules();
  elements.ruleForm.reset();
  renderLearnedRules();
}

function handleRequestSubmit(event) {
  event.preventDefault();
  const requester = elements.requestRequester.value.trim();
  const body = elements.requestBody.value.trim();
  const priority = elements.requestPriority.value;
  const dueDate = elements.requestDueDate.value;
  if (!requester || !body || !priority || !dueDate) return;

  const id = crypto.randomUUID ? crypto.randomUUID() : `request-${Date.now()}`;
  state.manualRequests.push({
    id,
    requester,
    body,
    priority,
    dueDate,
    createdAt: new Date().toISOString()
  });
  saveManualRequests();
  elements.requestForm.reset();
  elements.requestMessage.textContent = "ダッシュボードに追加しました。";
  state.activeSection = "dashboard";
  render();
}

async function loadLocalData() {
  const response = await fetch("./data/candidates.json", { cache: "no-store" });
  state.data = await response.json();
  try {
    const manualResponse = await fetch("./data/manual-judgments.json", { cache: "no-store" });
    state.manualJudgments = manualResponse.ok ? await manualResponse.json() : null;
  } catch {
    state.manualJudgments = null;
  }
  state.dataLoaded = true;
  render();
}

async function loadFirestoreData() {
  if (!state.firestoreDb) {
    state.data = emptyData();
    state.manualJudgments = null;
    state.syncHealth = null;
    state.dataLoaded = true;
    render();
    showAuthMessage("Firestoreに接続できていません。Firebase設定を確認してください。");
    return;
  }
  const [candidateSnapshot, judgmentSnapshot, syncHealthSnapshot, sharedStateSnapshot] = await Promise.all([
    state.firebaseModules.getDoc(firestoreDocRef("data", "current")),
    state.firebaseModules.getDoc(firestoreDocRef("data", "manualJudgments")),
    state.firebaseModules.getDoc(firestoreDocRef("data", "syncHealth")),
    state.firebaseModules.getDoc(firestoreDocRef("state", "shared"))
  ]);
  state.data = candidateSnapshot.exists() ? candidateSnapshot.data() : emptyData();
  state.manualJudgments = judgmentSnapshot.exists() ? judgmentSnapshot.data() : null;
  state.syncHealth = syncHealthSnapshot.exists() ? syncHealthSnapshot.data() : null;
  if (sharedStateSnapshot.exists()) applyRemoteState(sharedStateSnapshot.data());
  state.dataLoaded = true;
  render();
}

async function loadData() {
  if (isFirestoreMode()) {
    await loadFirestoreData();
    return;
  }
  await loadLocalData();
}

document.querySelector("#reloadButton").addEventListener("click", loadData);
document.querySelector("#resetButton").addEventListener("click", resetDecisions);
document.querySelector("#applyButton").addEventListener("click", applyDecisions);
elements.themeButton.addEventListener("click", toggleTheme);
elements.signOutButton.addEventListener("click", signOut);
elements.requestForm.addEventListener("submit", handleRequestSubmit);
elements.ruleForm.addEventListener("submit", handleRuleSubmit);
elements.detailCloseButton.addEventListener("click", closeTaskDetail);
elements.taskDetailPanel.addEventListener("click", (event) => {
  if (event.target === elements.taskDetailPanel) closeTaskDetail();
});
elements.statusFilter.addEventListener("change", render);
elements.categoryFilter.addEventListener("change", render);
elements.searchInput.addEventListener("input", render);
document.querySelectorAll(".dashboard-view-button").forEach((button) => {
  button.addEventListener("click", () => setDashboardView(button.dataset.dashboardView));
});
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    render();
  });
});
document.querySelectorAll(".sidebar-nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeSection = button.dataset.section;
    render();
  });
});

applyTheme();
initAuth();
