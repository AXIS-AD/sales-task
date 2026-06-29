import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const appPath = (process.env.FIRESTORE_APP_PATH || "salesTaskApps/abcClinic")
  .split("/")
  .map((segment) => segment.trim())
  .filter(Boolean);
const sharedStatePath = [...appPath, "state", "shared"];
const chatworkRoomId = Number(process.env.CHATWORK_REQUEST_ROOM_ID || 416823106);
const chatworkRoomName = process.env.CHATWORK_REQUEST_ROOM_NAME || "営業部　〜ゾスの精神〜";
const chatworkAssigneeId = Number(process.env.CHATWORK_REQUEST_ASSIGNEE_ID || 10345896);
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt, response) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30000);
  }
  return Math.min(1000 * 2 ** attempt, 10000);
}

async function fetchWithRetry(url, options = {}, label = String(url), attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status === 404) return response;

      const body = await response.text();
      const error = new Error(`${label}: ${response.status} ${body}`);
      error.status = response.status;
      error.response = response;
      if (!retryableStatuses.has(response.status) || attempt === attempts - 1) throw error;
      lastError = error;
      await sleep(retryDelay(attempt, response));
    } catch (error) {
      lastError = error;
      if (error.status && !retryableStatuses.has(error.status)) throw error;
      if (attempt === attempts - 1) throw error;
      await sleep(retryDelay(attempt));
    }
  }
  throw lastError;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64;
  if (rawBase64) return JSON.parse(Buffer.from(rawBase64, "base64").toString("utf8"));

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return JSON.parse(raw);
  }

  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
}

function createJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedJwt = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  return `${unsignedJwt}.${base64url(signer.sign(serviceAccount.private_key))}`;
}

async function getAccessToken(serviceAccount) {
  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(serviceAccount)
    })
  }, "OAuth token");
  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.access_token;
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])
        )
      }
    };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

function firestoreUrl(projectId, pathSegments, updateMaskFields = []) {
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodedPath}`);
  updateMaskFields.forEach((field) => url.searchParams.append("updateMask.fieldPaths", field));
  return url;
}

async function getFirestoreDocument({ accessToken, projectId, pathSegments }) {
  const response = await fetchWithRetry(firestoreUrl(projectId, pathSegments), {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, `Firestore get ${pathSegments.join("/")}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore get failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return fromFirestoreFields(data.fields || {});
}

async function patchFirestoreFields({ accessToken, projectId, pathSegments, data, updateMaskFields }) {
  const response = await fetchWithRetry(firestoreUrl(projectId, pathSegments, updateMaskFields), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])
      )
    })
  }, `Firestore patch ${pathSegments.join("/")}`);
  if (!response.ok) {
    throw new Error(`Firestore patch failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function isPendingRequest(request) {
  return Boolean(
    request?.id &&
      request.chatworkTaskStatus === "pending" &&
      !request.chatworkTaskCreatedAt &&
      !request.chatworkTaskIds?.length
  );
}

function dueDateToChatworkLimit(dueDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || ""))) return "";
  const timestamp = Date.parse(`${dueDate}T23:59:59+09:00`);
  if (!Number.isFinite(timestamp)) return "";
  return String(Math.floor(timestamp / 1000));
}

function chatworkTaskBody(request) {
  return [
    "[info][title]営業部タスク管理ツール 依頼フォーム[/title]",
    `[To:${chatworkAssigneeId}] 松﨑さん`,
    "",
    `依頼者: ${request.requester}`,
    `優先度: ${request.priority}`,
    `期日: ${request.dueDate}`,
    "",
    "内容:",
    request.body,
    "",
    `依頼ID: ${request.id}`,
    "[/info]"
  ].join("\n");
}

async function createChatworkTask(request) {
  const body = new URLSearchParams({
    body: chatworkTaskBody(request),
    to_ids: String(chatworkAssigneeId)
  });
  const limit = dueDateToChatworkLimit(request.dueDate);
  if (limit) body.set("limit", limit);

  const response = await fetchWithRetry(`https://api.chatwork.com/v2/rooms/${chatworkRoomId}/tasks`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": process.env.CHATWORK_API_TOKEN,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  }, `Chatwork create task ${request.id}`);

  if (!response.ok) {
    throw new Error(`Chatwork task create failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function updateRequest(accessToken, projectId, requestId, patch, options = {}) {
  const sharedState = await getFirestoreDocument({
    accessToken,
    projectId,
    pathSegments: sharedStatePath
  }) || {};
  const manualRequests = Array.isArray(sharedState.manualRequests) ? sharedState.manualRequests : [];
  const current = manualRequests.find((request) => request.id === requestId);
  if (!current) return null;
  if (options.onlyIfPending && !isPendingRequest(current)) return null;

  const nextRequests = manualRequests.map((request) => (
    request.id === requestId ? { ...request, ...patch } : request
  ));

  await patchFirestoreFields({
    accessToken,
    projectId,
    pathSegments: sharedStatePath,
    updateMaskFields: ["manualRequests", "requestTaskProcessor"],
    data: {
      manualRequests: nextRequests,
      requestTaskProcessor: {
        updatedAt: new Date().toISOString(),
        chatworkRoomId,
        chatworkRoomName,
        chatworkAssigneeId
      }
    }
  });

  return nextRequests.find((request) => request.id === requestId);
}

async function main() {
  if (!process.env.CHATWORK_API_TOKEN) {
    throw new Error("CHATWORK_API_TOKEN is not set.");
  }

  const serviceAccount = await loadServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) throw new Error("Firebase project id could not be resolved.");

  const accessToken = await getAccessToken(serviceAccount);
  const sharedState = await getFirestoreDocument({
    accessToken,
    projectId,
    pathSegments: sharedStatePath
  }) || {};
  const manualRequests = Array.isArray(sharedState.manualRequests) ? sharedState.manualRequests : [];
  const pendingRequests = manualRequests.filter(isPendingRequest);

  if (!pendingRequests.length) {
    console.log("No pending request form Chatwork tasks.");
    return;
  }

  console.log(`Processing ${pendingRequests.length} request form Chatwork task(s).`);
  for (const request of pendingRequests) {
    const processingAt = new Date().toISOString();
    const lockedRequest = await updateRequest(accessToken, projectId, request.id, {
      chatworkTaskStatus: "processing",
      chatworkTaskProcessingAt: processingAt,
      chatworkTaskRoomId,
      chatworkTaskRoomName,
      chatworkTaskAssigneeId
    }, { onlyIfPending: true });
    if (!lockedRequest) continue;

    try {
      const result = await createChatworkTask(lockedRequest);
      const taskIds = Array.isArray(result.task_ids) ? result.task_ids.map(String) : [];
      await updateRequest(accessToken, projectId, lockedRequest.id, {
        chatworkTaskStatus: "created",
        chatworkTaskCreatedAt: new Date().toISOString(),
        chatworkTaskIds: taskIds,
        chatworkTaskRoomId,
        chatworkTaskRoomName,
        chatworkTaskAssigneeId,
        chatworkTaskError: ""
      });
      console.log(`Created Chatwork task for request ${lockedRequest.id}: ${taskIds.join(",") || "no task id returned"}`);
    } catch (error) {
      await updateRequest(accessToken, projectId, lockedRequest.id, {
        chatworkTaskStatus: "error",
        chatworkTaskError: error.message.slice(0, 500),
        chatworkTaskErrorAt: new Date().toISOString(),
        chatworkTaskRoomId,
        chatworkTaskRoomName,
        chatworkTaskAssigneeId
      });
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
