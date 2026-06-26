import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const appPath = (process.env.FIRESTORE_APP_PATH || "salesTaskApps/abcClinic")
  .split("/")
  .map((segment) => segment.trim())
  .filter(Boolean);
const candidatePath = [...appPath, "data", "current"];
const manualJudgmentPath = [...appPath, "data", "manualJudgments"];
const syncHealthPath = [...appPath, "data", "syncHealth"];
const localCandidatePath = join(process.cwd(), "public", "data", "candidates.json");
const localManualJudgmentPath = join(process.cwd(), "public", "data", "manual-judgments.json");
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
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
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

function firestoreUrl(projectId, pathSegments) {
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodedPath}`;
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

async function setFirestoreDocument({ accessToken, projectId, pathSegments, data }) {
  const response = await fetchWithRetry(firestoreUrl(projectId, pathSegments), {
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
  }, `Firestore write ${pathSegments.join("/")}`);
  if (!response.ok) {
    throw new Error(`Firestore write failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function setSyncHealth({ accessToken, projectId, data }) {
  await setFirestoreDocument({
    accessToken,
    projectId,
    pathSegments: syncHealthPath,
    data: {
      updatedAt: new Date().toISOString(),
      ...data
    }
  });
}

function makeChatworkTokenError(message, code = "CHATWORK_TOKEN_INVALID") {
  const error = new Error(message);
  error.healthCode = code;
  return error;
}

async function verifyChatworkToken() {
  if (!process.env.CHATWORK_API_TOKEN) {
    throw makeChatworkTokenError(
      "CHATWORK_API_TOKEN is not set. Update the GitHub Actions secret CHATWORK_API_TOKEN.",
      "CHATWORK_TOKEN_MISSING"
    );
  }

  try {
    const response = await fetchWithRetry("https://api.chatwork.com/v2/me", {
      headers: { "X-ChatWorkToken": process.env.CHATWORK_API_TOKEN }
    }, "Chatwork token check");

    if (!response.ok) {
      throw makeChatworkTokenError(
        "Chatwork API token check failed. Update the GitHub Actions secret CHATWORK_API_TOKEN."
      );
    }

    return response.json();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      throw makeChatworkTokenError(
        "Chatwork API token is invalid or expired. Update the GitHub Actions secret CHATWORK_API_TOKEN."
      );
    }
    throw error;
  }
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
      env: { ...process.env, ...options.env }
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function ensureManualJudgments(accessToken, projectId) {
  if (existsSync(localManualJudgmentPath)) return;

  const remoteManualJudgments = await getFirestoreDocument({
    accessToken,
    projectId,
    pathSegments: manualJudgmentPath
  });
  if (!remoteManualJudgments) {
    console.warn("manualJudgments document was not found. Sync will run without manual judgments.");
    return;
  }

  await mkdir(join(process.cwd(), "public", "data"), { recursive: true });
  await writeFile(localManualJudgmentPath, JSON.stringify(remoteManualJudgments, null, 2));
  console.log(`downloaded manual judgments to ${localManualJudgmentPath}`);
}

async function main() {
  const serviceAccount = await loadServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) throw new Error("Firebase project id could not be resolved.");

  const accessToken = await getAccessToken(serviceAccount);

  let chatworkAccount;
  try {
    chatworkAccount = await verifyChatworkToken();
  } catch (error) {
    const message = error.healthCode
      ? "Chatwork APIトークンが未設定、無効、または失効しています。GitHub Actions secret の CHATWORK_API_TOKEN を更新してください。"
      : "Chatwork APIトークンの検証中にエラーが発生しました。GitHub Actions のログを確認してください。";
    await setSyncHealth({
      accessToken,
      projectId,
      data: {
        status: "error",
        code: error.healthCode || "CHATWORK_TOKEN_CHECK_FAILED",
        message,
        checkedAt: new Date().toISOString(),
        recovery: "GitHub > AXIS-AD/sales-task > Settings > Secrets and variables > Actions > CHATWORK_API_TOKEN を新しいChatwork APIトークンで更新"
      }
    });
    if (error.healthCode) {
      console.error(`::error title=Chatwork token invalid::${message}`);
    }
    throw error;
  }

  await ensureManualJudgments(accessToken, projectId);
  await run(process.execPath, ["scripts/fetch-chatwork.mjs"]);

  const [candidateData, manualJudgmentData] = await Promise.all([
    readFile(localCandidatePath, "utf8").then(JSON.parse),
    existsSync(localManualJudgmentPath)
      ? readFile(localManualJudgmentPath, "utf8").then(JSON.parse)
      : Promise.resolve({ generatedAt: new Date().toISOString(), source: "empty", total: 0, counts: {}, judgments: [] })
  ]);

  await Promise.all([
    setFirestoreDocument({
      accessToken,
      projectId,
      pathSegments: candidatePath,
      data: candidateData
    }),
    setFirestoreDocument({
      accessToken,
      projectId,
      pathSegments: manualJudgmentPath,
      data: manualJudgmentData
    }),
    setSyncHealth({
      accessToken,
      projectId,
      data: {
        status: "ok",
        code: "CHATWORK_TOKEN_OK",
        message: "Chatwork APIトークンは有効です。",
        checkedAt: new Date().toISOString(),
        chatworkAccountId: chatworkAccount.account_id || null,
        chatworkAccountName: chatworkAccount.name || ""
      }
    })
  ]);

  console.log(`synced ${candidateData.candidates?.length || 0} candidates to Firestore.`);
  console.log(`Firestore path: ${candidatePath.join("/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
