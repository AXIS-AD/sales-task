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
const localCandidatePath = join(process.cwd(), "public", "data", "candidates.json");
const localManualJudgmentPath = join(process.cwd(), "public", "data", "manual-judgments.json");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64;
  if (rawBase64) return JSON.parse(Buffer.from(rawBase64, "base64").toString("utf8"));

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")
      : "{}");
  }

  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
}

async function loadServiceAccountAsync() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return loadServiceAccount();
  }
  const raw = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
  return JSON.parse(raw);
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(serviceAccount)
    })
  });
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
  const response = await fetch(firestoreUrl(projectId, pathSegments), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore get failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return fromFirestoreFields(data.fields || {});
}

async function setFirestoreDocument({ accessToken, projectId, pathSegments, data }) {
  const response = await fetch(firestoreUrl(projectId, pathSegments), {
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
  });
  if (!response.ok) {
    throw new Error(`Firestore write failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
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
  if (!process.env.CHATWORK_API_TOKEN) {
    throw new Error("CHATWORK_API_TOKEN is not set.");
  }

  const serviceAccount = await loadServiceAccountAsync();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) throw new Error("Firebase project id could not be resolved.");

  const accessToken = await getAccessToken(serviceAccount);
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
    })
  ]);

  console.log(`synced ${candidateData.candidates?.length || 0} candidates to Firestore.`);
  console.log(`Firestore path: ${candidatePath.join("/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
