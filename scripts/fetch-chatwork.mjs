import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const token = process.env.CHATWORK_API_TOKEN;
if (!token) {
  console.error("CHATWORK_API_TOKEN is not set. Run: source ~/.zshrc && npm run fetch:chatwork");
  process.exit(1);
}

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const fetchErrors = [];

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

async function fetchJsonWithRetry(url, options, label, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();

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

const rooms = [
  { id: 411043022, name: "【ASP】※ABCクリニック専用　アクシス（Pino）×ミチガエル（PG）", confidence: "high" },
  { id: 323899466, name: "【ASP】アクシス×ミチガエル(PG)", confidence: "candidate" },
  { id: 417896756, name: "佐藤有一【】", confidence: "candidate" },
  { id: 423224639, name: "皆川心人【】", confidence: "candidate" },
  { id: 416823106, name: "営業部　〜ゾスの精神〜", confidence: "candidate" },
  { id: 421365894, name: "営業朝会", confidence: "candidate" },
  { id: 196861688, name: "【フロント⇆全体】情報共有", confidence: "candidate" }
];

const matsuzakiAccountId = 10345896;
const personalRoomIds = new Set([417896756, 423224639]);

const forcedTargetMessages = [
  {
    roomId: 417896756,
    messageId: "2117202441555685376",
    title: "YA/X/ミチ/アクシス共有タスク管理シートの作成後、過不足を確認する",
    category: "返答待ちの管理",
    reviewReason: "佐藤さん側で共有タスク管理シートを作成後、AXIS側で過不足確認が必要なため"
  },
  {
    roomId: 417896756,
    messageId: "2118633173121499136",
    title: "ワイエージェンシーMTG日程調整状況・Xラボ定例参加可否を確認する",
    category: "返答待ちの管理",
    reviewReason: "ワイエージェンシーMTGの日程調整状況とXラボ定例参加可否の返答待ちのため"
  },
  {
    roomId: 411043022,
    messageIds: ["2119295122767347712", "2119304299468304384", "2119308238775394304", "2119339440756502528"],
    title: "実質無料訴求の適用日・実質無料になるメニューの価格と内容・確認事項進捗シート・現時点でNGになる可能性のある訴求まとめを確認する",
    category: "クリエイティブ/LP/訴求確認",
    reviewReason: "適用日は先方回答待ち、実質無料になるメニューの価格と内容は後ほど共有、確認事項進捗シートと現時点でNGになる可能性のある訴求まとめは承知済みで返答待ちのため"
  },
  {
    roomId: 417896756,
    messageIds: ["2117156938478530560", "2117157398585278464", "2117163088917827584", "2117170149055541248", "2117170614837186560"],
    title: "ミコ/Lトラックの予約率基準とエックスラボMTG参加体制を確認する",
    category: "成果・承認まわりの確認",
    reviewReason: "ミコとLトラックどちらを予約率の基準にするか回答待ちで、MTG参加者の社内調整も必要なため"
  },
  {
    roomId: 417896756,
    messageIds: ["2116109013770051584", "2116112709316771840", "2116116584736239616"],
    title: "キャスティング費用請求のFIX状況を確認する",
    category: "条件交渉",
    reviewReason: "制作料金請求は06/04のレギュ変更告知なしNGタスクに集約し、06/09はキャスティング費用請求のFIX状況確認として残すため"
  },
  {
    roomId: 423224639,
    messageIds: ["2114384182347304960", "2114384705720942592", "2114421286435553280"],
    title: "レギュ変更告知なしのNGに対する制作料金請求を調整する",
    category: "条件交渉",
    reviewReason: "過去OK後のNG化に対する制作料金請求を皆川さんが調整する文脈のため。体制整備の具体内容は元本文から断定しない"
  }
];

const completionEvidenceTargets = [
  {
    key: "overlap-cv-approval",
    roomId: 411043022,
    messageIds: ["2118673000877522944", "2118673468785692672", "2118673714693541888"],
    label: "済の可能性",
    scopes: ["重複CV承認体制"],
    matchesCandidate: (candidate) => {
      const text = `${candidate.body || ""}\n${candidate.originalBody || ""}`;
      return (
        text.includes("重複CV承認体制") ||
        (text.includes("Lトラック") && text.includes("ミコクラウド") && text.includes("承認体制"))
      );
    },
    matchesEvidence: (messageBody) => (
      messageBody.includes("Lトラックを正") &&
      messageBody.includes("悪戯や不正などを除く全承認") &&
      messageBody.includes("まとまりました") &&
      messageBody.includes("ミコクラウド切り替え後のCV") &&
      messageBody.includes("含まれております") &&
      messageBody.includes("今月と同様の認識で問題ございません")
    ),
    reviewReason: "06/16 19:10-19:12のやり取りで、7月の成果確認はLトラックを正とし、Lステップ追加ユーザーがミコクラウド切替後にCVした場合も含めて、悪戯・不正などを除く全承認で問題ないと確認できたため"
  }
];

const categories = [
  { name: "ミチガエルへの確認", words: ["ミチガエル", "PG", "先方", "ASP", "確認お願いします"] },
  { name: "ABC側への確認", words: ["ABC側", "クリニック側", "院", "ドクター", "ABC確認"] },
  { name: "社内運用部への確認", words: ["運用", "配信", "媒体", "アカウント", "CR", "クリエイティブ担当"] },
  { name: "条件交渉", words: ["単価", "CPA", "特単", "条件", "交渉", "成果条件", "上限"] },
  { name: "成果・承認まわりの確認", words: ["成果", "承認", "否認", "CV", "重複", "成果数", "承認率"] },
  { name: "クリエイティブ/LP/訴求確認", words: ["LP", "記事", "訴求", "表現", "バナー", "動画", "クリエイティブ", "審査"] },
  { name: "計測・リンク確認", words: ["計測", "リンク", "URL", "タグ", "ポストバック", "CATS", "AFAD", "リダイレクト"] },
  { name: "返答待ちの管理", words: ["返答待ち", "確認中", "先方確認", "社内確認中", "保留", "回答待ち"] }
];

const abcWords = ["ABC", "abc", "ABCクリニック", "ミチガエル", "エックスラボ", "Xラボ", "YA", "ワイエージェンシー", "長径", "包茎", "メンズクリニック", "PG", "ミコクラウド", "ミコ", "Lステップ", "Lトラック", "pangle", "Pangle", "レギュレーション", "横山の本編", "成果承認"];
const taskSignals = [
  "お願いします",
  "お願い",
  "お願いいたします",
  "確認",
  "ご確認",
  "ご確認となります",
  "対応",
  "送付",
  "明文化",
  "作成",
  "修正",
  "追加",
  "調整",
  "相談",
  "進捗",
  "提出",
  "可否",
  "結論",
  "承認",
  "承認体制",
  "否認",
  "停止",
  "再開",
  "切り替え",
  "切替",
  "後追い",
  "MTG",
  "日程",
  "ください",
  "いただきたい",
  "教えていただきたい",
  "追いかけます",
  "後ほど送ります",
  "進捗シート",
  "まとめ",
  "ほしい",
  "欲しい",
  "できますか",
  "本日",
  "今日",
  "明日",
  "今週",
  "来週",
  "まで"
];
const weakSignals = new Set(["お願いします", "お願い", "確認", "ご確認", "ください", "できますか"]);
const doneSignals = ["完了", "対応済", "確認済", "解決", "反映済", "送付済", "停止済み", "対策済み"];
const waitingSignals = ["確認中", "先方確認", "返答待ち", "社内確認中", "保留", "回答待ち", "戻し待ち"];
const noiseSignals = ["共有します", "共有です", "ありがとうございます", "ありがとう", "承知", "了解", "お疲れ様です"];
const nonTaskSignals = ["飯", "飲み", "休みですか", "人いないですか", "壁打ち", "電話できるタイミング", "お話させていただきたく存じます", "他ご依頼させていただいている事項", "ご依頼させていただいている事項"];
const strongTaskSignals = ["お願い", "お願いいたします", "対応", "調整", "可否", "結論", "承認", "承認体制", "否認", "停止", "再開", "切り替え", "切替", "後追い", "進捗", "FIX", "戻し", "明文化", "確認依頼", "いただきたい", "教えていただきたい", "追いかけます", "後ほど送ります", "進捗シート", "NG", "請求"];
const genericPoliteSignals = ["ご確認のほど、よろしくお願いいたします。", "ご確認のほどよろしくお願いいたします。", "何卒よろしくお願いいたします。"];
const legacyMinagawaResultPath = "/Users/matsuzakiharuki/Documents/Codex/2026-06-04/new-chat/work/chatwork_minagawa_result.json";
const manualJudgmentsPath = join(process.cwd(), "public", "data", "manual-judgments.json");

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeForMatch(text) {
  return String(text || "").replace(/\s/g, "");
}

function splitMessageIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(",").map((id) => id.trim()).filter(Boolean);
}

function parseChatworkUrl(value) {
  const match = String(value || "").match(/rid(\d+)(?:-(\d+))?/);
  if (!match) return {};
  return {
    roomId: Number(match[1]),
    messageId: match[2] || null
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function forcedTargetMessageIds(target) {
  return uniqueValues([
    ...(target.messageIds || []),
    target.messageId
  ].filter(Boolean).map(String));
}

function candidateMessageIds(candidate) {
  const fromUrl = parseChatworkUrl(candidate.chatworkUrl);
  return uniqueValues([
    ...splitMessageIds(candidate.messageId),
    ...splitMessageIds(candidate.mergedMessageIds),
    fromUrl.messageId
  ]);
}

function judgmentMessageIds(judgment) {
  const fromUrl = parseChatworkUrl(judgment.href);
  return uniqueValues([
    ...splitMessageIds(judgment.messageId),
    ...splitMessageIds(judgment.mergedMessageIds),
    fromUrl.messageId
  ]);
}

function hasMessageOverlap(candidate, judgment) {
  const candidateIds = new Set(candidateMessageIds(candidate));
  return judgmentMessageIds(judgment).some((messageId) => candidateIds.has(messageId));
}

function pickCategory(text) {
  if (["承認", "承認体制", "重複CV", "Lステップ", "ミコクラウド"].some((word) => text.includes(word))) {
    return "成果・承認まわりの確認";
  }
  const found = categories.find((category) => includesAny(text, category.words));
  return found?.name || "返答待ちの管理";
}

function pickStatus(text) {
  if (includesAny(text, doneSignals)) return "完了候補";
  if (includesAny(text, waitingSignals)) return "相手待ち候補";
  return "未判定";
}

function stripChatworkMarkup(body) {
  return body
    .replace(/\[qt(?:=[^\]]*)?\][\s\S]*?\[\/qt\]/g, "")
    .replace(/^[\s\S]*?\[\/qt\]\s*/g, "")
    .replace(/\[qtmeta[^\]]+\]/g, "")
    .replace(/\[To:\d+\]/g, "")
    .replace(/\[rp aid=\d+ to=\d+-\d+\]/g, "")
    .replace(/\[info\]|\[\/info\]|\[title\]|\[\/title\]|\[hr\]|\[toall\]|\[\/qt\]/g, "")
    .trim();
}

function formatDate(seconds) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function isPersonalChatRoom(room) {
  return personalRoomIds.has(room.id);
}

function isMatsuzakiScoped(message, room) {
  const body = message.body || "";
  return isPersonalChatRoom(room) || message.account?.account_id === matsuzakiAccountId || body.includes(`[To:${matsuzakiAccountId}]`) || body.includes(`[rp aid=${matsuzakiAccountId}`);
}

function pickScopeReason(message, room) {
  const body = message.body || "";
  if (message.account?.account_id === matsuzakiAccountId) return "松﨑から送信";
  if (body.includes(`[rp aid=${matsuzakiAccountId}`)) return "松﨑への返信";
  if (body.includes(`[To:${matsuzakiAccountId}]`)) return "松﨑宛てTo";
  if (isPersonalChatRoom(room)) return "個人チャット";
  return "";
}

function splitActionParts(text) {
  return text
    .split(/\n(?=・|　?∟|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫])|\n{2,}|(?<=。)|(?<=！)|(?<=？)|(?<=!|\?)/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (part.length < 220) return [part];
      return part
        .split(/\n|。|！|？|!|\?/g)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    });
}

function scoreTask(text) {
  let score = 0;
  const hits = [];
  for (const signal of taskSignals) {
    if (!text.includes(signal)) continue;
    score += weakSignals.has(signal) ? 0.5 : 1;
    hits.push(signal);
  }
  if (/(\d{1,2}日|\d{1,2}\/\d{1,2}|\d{1,2}時|\d{1,2}:\d{2}|月|火|水|木|金|土|日)/.test(text)) score += 1;
  if (/[？?]/.test(text)) score += 0.8;
  if (noiseSignals.some((signal) => text.includes(signal))) score -= 1;
  if (nonTaskSignals.some((signal) => text.includes(signal))) score -= 2;
  if (text.length > 500) score -= 1;
  return { score, hits };
}

function isStrongTaskLike(text, hits) {
  const normalizedText = text.replace(/\s/g, "");
  if (nonTaskSignals.some((signal) => text.includes(signal))) return false;
  if (genericPoliteSignals.some((signal) => normalizedText === signal.replace(/\s/g, ""))) return false;
  if (genericPoliteSignals.some((signal) => normalizedText.endsWith(signal.replace(/\s/g, ""))) && normalizedText.length < 70) return false;
  if (text.length < 24 && hits.every((signal) => weakSignals.has(signal))) return false;
  if (strongTaskSignals.some((signal) => text.includes(signal))) return true;
  if (/[？?]/.test(text) && hits.some((signal) => ["確認", "ご確認", "進捗", "今日", "本日", "まで"].includes(signal))) return true;
  return false;
}

function isExplicitTaskText(text) {
  return [
    "レギュレーションの明文化",
    "NGを出さない握り",
    "サイレントにレギュが変更されることが無いよう調整",
    "制作料、キャスティング費用の請求",
    "pangleサーバー対策",
    "承認体制の確認"
  ].some((signal) => text.includes(signal));
}

const mergeTopics = [
  {
    key: "approval-overlap-mico-lstep",
    title: "7月以降のLステップ重複CV・ミコクラウド新規友だち追加CVの承認体制を確定する",
    category: "成果・承認まわりの確認",
    words: ["承認", "Lステップ", "ミコクラウド", "重複", "CV", "承認体制"]
  },
  {
    key: "cap-stop-overrun",
    title: "デイCAP・停止タイミング・超過対策を調整する",
    category: "成果・承認まわりの確認",
    words: ["CAP", "キャップ", "停止", "超過", "150件", "140件", "後着火"]
  },
  {
    key: "line-scenario-cpf",
    title: "LINEシナリオ/CPF介入の条件・開始時期を確認する",
    category: "条件交渉",
    words: ["LINE", "シナリオ", "CPF", "予約率", "数値開示", "介入"]
  },
  {
    key: "cr-regulation-ng",
    title: "CRレギュレーション・NG戻し・制作費請求条件を整理する",
    category: "クリエイティブ/LP/訴求確認",
    words: ["CR", "レギュ", "NG", "戻し", "制作料", "キャスティング", "横山の本編"]
  },
  {
    key: "link-redirect-mico",
    title: "ミコクラウド対応リンク・リダイレクト可否を確認する",
    category: "計測・リンク確認",
    words: ["リンク", "リダイレクト", "ミコクラウド", "FB", "Tik", "URL"]
  }
];

function pickMergeTopic(text) {
  const normalized = text.toLowerCase();
  let best = null;
  for (const topic of mergeTopics) {
    const hits = topic.words.filter((word) => normalized.includes(word.toLowerCase())).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { ...topic, hits };
  }
  return best;
}

function shouldMergeCandidates(a, b) {
  if (!a.mergeTopic || !b.mergeTopic || a.mergeTopic !== b.mergeTopic) return false;
  if (a.roomId !== b.roomId) return false;
  const diffMs = Math.abs(new Date(a.sentAt) - new Date(b.sentAt));
  return diffMs <= 1000 * 60 * 90;
}

function mergeCandidateGroup(group) {
  if (group.length === 1) return group[0];
  const sorted = [...group].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const topic = mergeTopics.find((item) => item.key === sorted[0].mergeTopic);
  const body = topic?.title || sorted[0].body;
  const first = sorted[0];
  const last = sorted.at(-1);

  return {
    ...last,
    id: `merged-${sorted.map((candidate) => candidate.messageId || candidate.id).join("-")}-${hashText(body)}`,
    messageId: sorted.map((candidate) => candidate.messageId).filter(Boolean).join(",") || null,
    sentAt: first.sentAt,
    category: topic?.category || first.category,
    decision: sorted.some((candidate) => candidate.decision === "タスク候補") ? "タスク候補" : sorted.some((candidate) => candidate.decision === "確認必要") ? "確認必要" : "不要",
    body,
    originalBody: sorted.map((candidate) => `${formatDate(Date.parse(candidate.sentAt) / 1000)}\n${candidate.originalBody || candidate.body}`).join("\n\n---\n\n"),
    score: Math.max(...sorted.map((candidate) => candidate.score || 0)),
    signals: [...new Set(sorted.flatMap((candidate) => candidate.signals || []))],
    reason: "同一文脈の重複候補を統合",
    contextBefore: first.contextBefore || [],
    contextAfter: last.contextAfter || [],
    contextRange: `統合: ${sorted.length}件`,
    reviewReason: `同じ論点（${topic?.title || sorted[0].mergeTopic}）の近接メッセージを統合`,
    mergedFromIds: sorted.map((candidate) => candidate.id),
    mergedMessageIds: sorted.map((candidate) => candidate.messageId).filter(Boolean),
    chatworkUrl: first.chatworkUrl
  };
}

function compactContextMessage(message) {
  return {
    messageId: message.message_id,
    accountName: message.account?.name || "",
    sentAt: new Date((message.send_time || 0) * 1000).toISOString(),
    timeLabel: formatDate(message.send_time || 0),
    body: stripChatworkMarkup(message.body || "").slice(0, 800)
  };
}

function createForcedTargetCandidates(messagesByRoom) {
  const items = [];
  for (const target of forcedTargetMessages) {
    const roomMessages = messagesByRoom.get(target.roomId) || [];
    const messageIds = forcedTargetMessageIds(target);
    const indexes = messageIds
      .map((messageId) => roomMessages.findIndex(({ message }) => String(message.message_id) === messageId))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    if (!indexes.length) continue;

    const firstIndex = indexes[0];
    const lastIndex = indexes.at(-1);
    const { room, message } = roomMessages[firstIndex];
    const targetMessages = indexes.map((index) => roomMessages[index].message);
    const body = targetMessages
      .map((targetMessage) => `${formatDate(targetMessage.send_time || 0)} / ${targetMessage.account?.name || ""}\n${stripChatworkMarkup(targetMessage.body || "")}`)
      .join("\n\n---\n\n");
    const before = roomMessages.slice(Math.max(0, firstIndex - 20), firstIndex).map(({ message: contextMessage }) => compactContextMessage(contextMessage));
    const after = roomMessages.slice(lastIndex + 1, lastIndex + 21).map(({ message: contextMessage }) => compactContextMessage(contextMessage));
    const rawBody = message.body || "";
    const scopeReason = message.account?.account_id === matsuzakiAccountId
      ? "松﨑から送信"
      : rawBody.includes(`[rp aid=${matsuzakiAccountId}`)
        ? "松﨑への返信"
        : rawBody.includes(`[To:${matsuzakiAccountId}]`)
          ? "松﨑宛てTo"
          : "指定リンク";

    items.push({
      id: `${room.id}-${message.message_id}-${hashText(target.title)}`,
      roomId: room.id,
      roomName: room.name,
      sourceConfidence: room.confidence,
      messageId: messageIds.join(","),
      mergedMessageIds: messageIds,
      accountName: message.account?.name || "",
      sentAt: new Date((message.send_time || 0) * 1000).toISOString(),
      category: target.category,
      statusSuggestion: "相手待ち候補",
      decision: "タスク候補",
      body: target.title,
      originalBody: body,
      score: 99,
      signals: ["指定リンク"],
      mergeTopic: null,
      reason: "ユーザー指定リンクを対象に追加",
      scopeReason,
      contextBefore: before,
      contextAfter: after,
      contextRange: `前${before.length}件 / 後${after.length}件`,
      reviewReason: target.reviewReason,
      chatworkUrl: `https://www.chatwork.com/#!rid${room.id}-${message.message_id}`,
      forcedTarget: true
    });
  }
  return items;
}

async function loadLegacyMinagawaCandidates() {
  try {
    const data = JSON.parse(await readFile(legacyMinagawaResultPath, "utf8"));
    return (data.tasks || []).slice(0, 12).map((task, index) => {
      const body = stripChatworkMarkup(task.text || "");
      return {
        id: `legacy-minagawa-${index + 1}-${hashText(body)}`,
        roomId: 423224639,
        roomName: "皆川心人【】",
        sourceConfidence: "reference",
        messageId: null,
        accountName: task.account || "",
        sentAt: new Date(task.time.replace(/\//g, "-")).toISOString(),
        category: pickCategory(body),
        statusSuggestion: task.status || "未対応候補",
        decision: "確認必要",
        body,
        originalBody: body,
        score: task.score || 0,
        signals: ["参照元プロジェクト"],
        mergeTopic: pickMergeTopic(body)?.key || null,
        reason: "皆川心人のタスクを一覧化プロジェクト参照",
        scopeReason: "保存済み参照データ",
        contextBefore: [],
        contextAfter: [],
        contextRange: "参照元保存データ",
        reviewReason: "Chatwork API最新100件の範囲外のため、参照元プロジェクトの保存結果から復元。要/不要は人間確認が必要",
        chatworkUrl: "https://www.chatwork.com/#!rid423224639"
      };
    });
  } catch {
    return [];
  }
}

async function loadManualJudgments() {
  try {
    const data = JSON.parse(await readFile(manualJudgmentsPath, "utf8"));
    return (data.judgments || []).filter((judgment) => judgment?.decision && judgment.decision !== "未判断");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`manual judgments could not be loaded: ${error.message}`);
    }
    return [];
  }
}

function appendReviewReason(candidate, note) {
  if (!note) return candidate.reviewReason;
  if (!candidate.reviewReason) return note;
  if (candidate.reviewReason.includes(note)) return candidate.reviewReason;
  return `${candidate.reviewReason} / ${note}`;
}

function normalizeTaskStatus(status) {
  if (!status || typeof status !== "object") return { type: "", other: "" };
  return {
    type: status.type || "",
    other: status.other || ""
  };
}

function candidateIdMatches(candidate, judgment) {
  return [candidate.id, ...(candidate.mergedFromIds || [])].includes(judgment.candidateId);
}

function sameRoom(candidate, judgment) {
  const fromUrl = parseChatworkUrl(judgment.href);
  const judgmentRoomId = Number(judgment.roomId || fromUrl.roomId || 0);
  return Number(candidate.roomId) === judgmentRoomId;
}

function findManualJudgment(candidate, manualJudgments) {
  const bodyKey = normalizeForMatch(candidate.body);
  const exactId = manualJudgments.find((judgment) => candidateIdMatches(candidate, judgment));
  if (exactId) return { judgment: exactId, matchedBy: "id" };

  const exactBody = manualJudgments.find((judgment) => (
    sameRoom(candidate, judgment) &&
    normalizeForMatch(judgment.body) === bodyKey
  ));
  if (exactBody) return { judgment: exactBody, matchedBy: "body" };

  const exactUrlBody = manualJudgments.find((judgment) => (
    judgment.href === candidate.chatworkUrl &&
    normalizeForMatch(judgment.body) === bodyKey
  ));
  if (exactUrlBody) return { judgment: exactUrlBody, matchedBy: "url+body" };

  const messageMatches = manualJudgments.filter((judgment) => (
    sameRoom(candidate, judgment) && hasMessageOverlap(candidate, judgment)
  ));
  if (messageMatches.length === 1) return { judgment: messageMatches[0], matchedBy: "message" };

  if (messageMatches.length > 1) {
    const decisions = uniqueValues(messageMatches.map((judgment) => judgment.decision));
    if (decisions.length === 1) return { judgment: messageMatches[0], matchedBy: "message-group" };
  }

  return null;
}

const learnedDecisionRules = [
  {
    decision: "不要",
    label: "周知・社内一斉連絡は単独タスクにしない",
    matches: (candidate) => candidate.roomName.includes("情報共有") && ["周知", "リソース振り分け", "各事業部"].some((word) => candidate.body.includes(word))
  },
  {
    decision: "不要",
    label: "後続で停止済み・対策済みのものは残さない",
    matches: (candidate) => ["停止済み", "対策済み", "調整をお願いできれば"].some((word) => candidate.body.includes(word))
  },
  {
    decision: "不要",
    label: "請求確認・移管状態確認だけの過去確認は残さない",
    matches: (candidate) => ["ミコクラウド移管されてない状態", "5月の請求はLステップ", "ドグマアド"].some((word) => candidate.body.includes(word))
  },
  {
    decision: "不要",
    label: "交渉材料メモ・構想メモはタスクにしない",
    matches: (candidate) => ["制作済みCR分を踏まえたデイキャップ増枠交渉材料", "クリエイターリスト", "専用レギュ作成予定"].some((word) => candidate.body.includes(word))
  },
  {
    decision: "タスク候補",
    label: "LINEシナリオ/CPF介入の回答待ちは残す",
    matches: (candidate) => ["CPF/LINEシナリオ介入条件", "LINEシナリオ介入開始時期"].some((word) => candidate.body.includes(word))
  },
  {
    decision: "タスク候補",
    label: "皆川さんへの複合確認は残す",
    matches: (candidate) => ["レギュ明文化・pangleサーバー対策", "レギュ明文化・pangle対策", "CR戻し・YT用LPレギュ"].some((word) => candidate.body.includes(word))
  }
];

function applyLearnedDecisionRules(candidate) {
  const rule = learnedDecisionRules.find((item) => item.matches(candidate));
  if (!rule) return candidate;
  return {
    ...candidate,
    decision: rule.decision,
    learnedDecisionRule: rule.label,
    reviewReason: appendReviewReason(candidate, `手動判断から学習: ${rule.label}`)
  };
}

function applyManualJudgments(items, manualJudgments) {
  let matchedCount = 0;
  const candidates = items.map((candidate) => {
    const match = findManualJudgment(candidate, manualJudgments);
    if (!match) return candidate;
    matchedCount += 1;
    return {
      ...candidate,
      decision: match.judgment.decision,
      manualDecision: true,
      manualJudgmentMatchedBy: match.matchedBy,
      manualTaskStatus: normalizeTaskStatus(match.judgment.taskStatus),
      reviewReason: appendReviewReason(candidate, `手動判断を反映: ${match.judgment.decision}`)
    };
  });

  return {
    candidates,
    summary: {
      totalJudgments: manualJudgments.length,
      matchedCandidates: matchedCount,
      unmatchedJudgments: Math.max(0, manualJudgments.length - matchedCount)
    }
  };
}

function assessWithContext(candidate) {
  const text = candidate.body;
  const beforeText = candidate.contextBefore.map((message) => message.body).join("\n");
  const afterText = candidate.contextAfter.map((message) => message.body).join("\n");
  const nearAfterText = candidate.contextAfter.slice(0, 8).map((message) => message.body).join("\n");
  const allText = `${beforeText}\n${text}\n${afterText}`;

  const resolvedByFollowup = [
    "停止済み",
    "対策済み",
    "上記ご対応いただきありがとうございます",
    "クライアント側には連携済み",
    "修正完了"
  ].some((signal) => nearAfterText.includes(signal));

  const isBroadcastInstruction = candidate.roomName.includes("情報共有") && (
    text.includes("切り替えていただくようにお願いします") ||
    text.includes("リソース振り分けお願いします") ||
    text.includes("停止するよう停止してもらいます")
  );

  const isProposalMemo = (
    text.includes("交渉したい項目") ||
    text.includes("デイのキャップを500件に増やす") ||
    text.includes("進行したいので、クリエイターリスト") ||
    text.includes("専用レギュ作成予定")
  );

  const isAbstractRequestReference = [
    "他ご依頼させていただいている事項",
    "ご依頼させていただいている事項",
    "他ご依頼",
    "他依頼"
  ].some((signal) => text.includes(signal));

  const isExplicitMinagawaRequest = candidate.roomId === 423224639 && [
    "レギュレーションの明文化",
    "NGを出さない握り",
    "サイレントにレギュが変更されることが無いよう調整",
    "制作料、キャスティング費用の請求",
    "pangleサーバー対策",
    "承認体制の確認"
  ].some((signal) => text.includes(signal));

  const hasWaitingContext = [
    "回答待ち",
    "返答待ち",
    "確認中",
    "進捗",
    "ステータス確認",
    "連携いただけますと幸い",
    "先方回答待ち",
    "再度追いかけます",
    "後ほど送ります",
    "戻し"
  ].some((signal) => allText.includes(signal));

  const hasOpenRequest = [
    "進捗どうですか",
    "調整しちゃっていいですか",
    "連携いただけますと幸い",
    "ご確認となります",
    "教えていただきたい",
    "進捗シート",
    "NGになる可能性のある訴求",
    "まとめもお願いします",
    "可否"
  ].some((signal) => text.includes(signal) || nearAfterText.includes(signal));

  if (isExplicitMinagawaRequest) {
    return {
      decision: "タスク候補",
      reviewReason: "指定された皆川さん宛て依頼本文内の明確な依頼事項のため"
    };
  }

  if (resolvedByFollowup || isBroadcastInstruction || isProposalMemo || isAbstractRequestReference) {
    return {
      decision: "不要",
      reviewReason: resolvedByFollowup
        ? "前後文脈上、後続で対応・連携・承知が確認できるため"
        : isBroadcastInstruction
          ? "周知・指示として既に流れており、個別の未対応タスクではないため"
          : isAbstractRequestReference
            ? "抽象的な既存依頼への言及であり、単独タスク内容を特定できないため"
            : "交渉材料・提案メモであり、単独タスクではないため"
    };
  }

  if (hasOpenRequest && hasWaitingContext) {
    return {
      decision: "タスク候補",
      reviewReason: "前後文脈上、回答待ち・進捗確認・次アクション待ちが残っているため"
    };
  }

  if (hasOpenRequest) {
    return {
      decision: "確認必要",
      reviewReason: "依頼・確認には見えるが、前後20件だけでは未対応か完了済みか断定できないため"
    };
  }

  return {
    decision: "不要",
    reviewReason: "前後20件を見ても未対応タスクとして残す根拠が弱いため"
  };
}

async function fetchRoomMessages(room) {
  const url = new URL(`https://api.chatwork.com/v2/rooms/${room.id}/messages`);
  url.searchParams.set("force", "1");
  const messages = await fetchJsonWithRetry(
    url,
    { headers: { "X-ChatWorkToken": token } },
    room.name
  );
  return messages.map((message) => ({ room, message }));
}

async function fetchSingleMessage(room, messageId) {
  const message = await fetchJsonWithRetry(
    `https://api.chatwork.com/v2/rooms/${room.id}/messages/${messageId}`,
    { headers: { "X-ChatWorkToken": token } },
    `${room.name} ${messageId}`
  );
  return { room, message };
}

const allMessages = [];
for (const room of rooms) {
  try {
    const messages = await fetchRoomMessages(room);
    const sorted = messages.sort((a, b) => a.message.send_time - b.message.send_time);
    allMessages.push(...sorted);
  } catch (error) {
    fetchErrors.push({
      roomId: room.id,
      roomName: room.name,
      scope: "room",
      message: error.message
    });
    if (room.confidence === "high") {
      throw new Error(`required room fetch failed: ${error.message}`);
    }
    console.warn(`optional room skipped: ${error.message}`);
  }
}

const candidates = [];
const messagesByRoom = new Map();
for (const item of allMessages) {
  const list = messagesByRoom.get(item.room.id) || [];
  list.push(item);
  messagesByRoom.set(item.room.id, list);
}

for (const target of forcedTargetMessages) {
  const room = rooms.find((item) => item.id === target.roomId);
  if (!room) continue;
  const list = messagesByRoom.get(room.id) || [];
  for (const messageId of forcedTargetMessageIds(target)) {
    if (!list.some((item) => String(item.message.message_id) === messageId)) {
      try {
        list.push(await fetchSingleMessage(room, messageId));
      } catch (error) {
        fetchErrors.push({
          roomId: room.id,
          roomName: room.name,
          scope: "forced-target",
          messageId,
          message: error.message
        });
        console.warn(`forced target skipped: ${error.message}`);
      }
    }
  }
  list.sort((a, b) => a.message.send_time - b.message.send_time);
  messagesByRoom.set(room.id, list);
}

for (const target of completionEvidenceTargets) {
  const room = rooms.find((item) => item.id === target.roomId);
  if (!room) continue;
  const list = messagesByRoom.get(room.id) || [];
  for (const messageId of target.messageIds || [target.messageId]) {
    if (!list.some((item) => String(item.message.message_id) === String(messageId))) {
      try {
        list.push(await fetchSingleMessage(room, messageId));
      } catch (error) {
        fetchErrors.push({
          roomId: room.id,
          roomName: room.name,
          scope: "completion-evidence",
          messageId,
          message: error.message
        });
        console.warn(`completion evidence skipped: ${error.message}`);
      }
    }
  }
  list.sort((a, b) => a.message.send_time - b.message.send_time);
  messagesByRoom.set(room.id, list);
}

for (const roomMessages of messagesByRoom.values()) {
  for (let index = 0; index < roomMessages.length; index += 1) {
    const { room, message } = roomMessages[index];
    const body = stripChatworkMarkup(message.body || "");
    const matsuzakiScoped = isMatsuzakiScoped(message, room);
    const abcRelated = room.confidence === "high" || isPersonalChatRoom(room) || includesAny(body, abcWords);
    if (!matsuzakiScoped || !abcRelated) continue;

    for (const part of splitActionParts(body)) {
      const scored = scoreTask(part);
      const explicitTask = isExplicitTaskText(part);
      if (scored.score < 1.8 && !explicitTask) continue;
      if (!explicitTask && !isStrongTaskLike(part, scored.hits)) continue;

      const before = roomMessages.slice(Math.max(0, index - 20), index).map(({ message: contextMessage }) => compactContextMessage(contextMessage));
      const after = roomMessages.slice(index + 1, index + 21).map(({ message: contextMessage }) => compactContextMessage(contextMessage));
      const nearAfterText = after.slice(0, 5).map((contextMessage) => contextMessage.body).join("\n");
      const statusSuggestion = doneSignals.some((signal) => nearAfterText.includes(signal))
        ? "後続で完了/対応済みの可能性"
        : pickStatus(part);

      const candidate = {
        id: `${room.id}-${message.message_id}-${hashText(part)}`,
        roomId: room.id,
        roomName: room.name,
        sourceConfidence: room.confidence,
        messageId: message.message_id,
        accountName: message.account?.name || "",
        sentAt: new Date((message.send_time || 0) * 1000).toISOString(),
        category: pickCategory(part),
        statusSuggestion,
        decision: "未判断",
        body: part,
        originalBody: body,
        score: scored.score,
        signals: scored.hits,
        mergeTopic: pickMergeTopic(part)?.key || null,
        reason: room.confidence === "high" ? "ABC専用ルーム" : "ABC関連キーワードに一致",
        scopeReason: pickScopeReason(message, room),
        contextBefore: before,
        contextAfter: after,
        contextRange: `前${before.length}件 / 後${after.length}件`,
        chatworkUrl: `https://www.chatwork.com/#!rid${room.id}-${message.message_id}`
      };
      const assessment = assessWithContext(candidate);
      candidate.decision = assessment.decision;
      candidate.reviewReason = assessment.reviewReason;
      candidates.push(candidate);
    }
  }
}

const deduped = [];
const seen = new Set();
const forcedCandidates = createForcedTargetCandidates(messagesByRoom);
const forcedMessageKeys = new Set(
  forcedCandidates.flatMap((candidate) => candidateMessageIds(candidate).map((messageId) => `${candidate.roomId}:${messageId}`))
);
const autoCandidates = candidates.filter((candidate) => {
  const messageIds = candidateMessageIds(candidate);
  if (!messageIds.length) return true;
  return !messageIds.some((messageId) => forcedMessageKeys.has(`${candidate.roomId}:${messageId}`));
});
const legacyCandidates = await loadLegacyMinagawaCandidates();
for (const candidate of [...forcedCandidates, ...autoCandidates, ...legacyCandidates].sort((a, b) => b.sentAt.localeCompare(a.sentAt))) {
  const key = `${candidate.roomId}:${candidate.body.replace(/\s/g, "").slice(0, 80)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(candidate);
}

function referencedContext(candidate, messageIds) {
  const idSet = new Set(messageIds.map(String));
  return [...(candidate.contextBefore || []), ...(candidate.contextAfter || [])]
    .filter((message) => idSet.has(String(message.messageId)))
    .map((message) => `${message.timeLabel} / ${message.accountName}\n${message.body}`)
    .join("\n\n---\n\n");
}

function applySpecificTitleCorrections(items) {
  return items.map((candidate) => {
    if (
      (candidate.body.includes("レギュ変更告知なし") || (candidate.originalBody || "").includes("レギュレーション変更告知")) &&
      (candidate.body.includes("制作料金請求") || (candidate.originalBody || "").includes("制作料金請求"))
    ) {
      return {
        ...candidate,
        category: "条件交渉",
        decision: "タスク候補",
        body: "レギュ変更告知なしのNGに対する制作料金請求を調整する",
        reviewReason: "過去OK後のNG化に対する制作料金請求を皆川さんが調整する文脈のため。体制整備の具体内容は元本文から断定しない",
        reason: "手動判断から学習: 元本文から断定できる制作料金請求のみ残す"
      };
    }

    if (candidate.roomId === 423224639 && String(candidate.messageId) === "2114297539091238912") {
      return {
        ...candidate,
        category: "ミチガエルへの確認",
        decision: "タスク候補",
        body: "CR戻し・YT用LPレギュ・CRチェック進捗・交通費訴求・NDA進捗を皆川さんに確認する",
        reviewReason: "06/04 17:23の1メッセージ内にある複数確認事項を、皆川さんへの複合依頼として統合",
        reason: "同一チャット内の複数確認事項を統合"
      };
    }

    if (candidate.roomId === 417896756 && String(candidate.messageId) === "2117098623111270400") {
      const references = referencedContext(candidate, ["2117103993292587008", "2117114871081603072"]);
      return {
        ...candidate,
        category: "条件交渉",
        decision: "タスク候補",
        body: "CPF/LINEシナリオ介入条件のクリニック回答を確認する",
        originalBody: [
          candidate.originalBody || candidate.body,
          references ? `参照したやり取り\n${references}` : ""
        ].filter(Boolean).join("\n\n---\n\n"),
        reviewReason: "06/12 11:15・11:58のやり取りを踏まえ、ミコ権限・シナリオ反映速度・単価/件数/レギュ優遇・LINE数値開示の回答待ちとして補正",
        reason: "後続やり取りを参照してタスク内容を補正"
      };
    }

    if (candidate.roomId === 421365894 && candidate.body.includes("ABCのLINEシナリオ介入って最短で調整しちゃっていいですか")) {
      return {
        ...candidate,
        category: "社内運用部への確認",
        body: "ABCのLINEシナリオ介入開始時期と社内リソースを確認する",
        reviewReason: "開始時期と社内リソース確認の文脈に補正"
      };
    }

    if (candidate.body.includes("ABCのCAP停止件数") && candidate.body.includes("120件に変更")) {
      return {
        ...candidate,
        category: "成果・承認まわりの確認",
        body: "ABCのCAP停止件数を120件へ変更できるか確認する",
        reviewReason: "CAP停止件数変更の確認としてタイトルを補正"
      };
    }

    if (candidate.body.includes("各事業部") && candidate.body.includes("確認の上対応お願いします")) {
      return {
        ...candidate,
        category: "社内運用部への確認",
        body: "各事業部へABC対応方針の確認・対応を周知する",
        reviewReason: "社内周知依頼としてタイトルを補正"
      };
    }

    if (candidate.body.includes("制作してしまったCR") && candidate.body.includes("予算調整")) {
      return {
        ...candidate,
        category: "条件交渉",
        body: "制作済みCR分を踏まえたデイキャップ増枠交渉材料を整理する",
        reviewReason: "交渉材料メモとしてタイトルを補正"
      };
    }

    return candidate;
  });
}

function mergeSameMessageRequests(items) {
  const compositeMessageIds = new Set(["2116100348807741440"]);
  const grouped = new Map();
  const passthrough = [];

  for (const candidate of items) {
    const messageId = String(candidate.messageId || "");
    if (!compositeMessageIds.has(messageId)) {
      passthrough.push(candidate);
      continue;
    }
    const key = `${candidate.roomId}:${messageId}`;
    const group = grouped.get(key) || [];
    group.push(candidate);
    grouped.set(key, group);
  }

  const merged = [];
  for (const group of grouped.values()) {
    if (group.length < 2) {
      merged.push(...group);
      continue;
    }

    const sorted = group.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const first = sorted[0];
    const title = "レギュ明文化・pangleサーバー対策・重複CV承認体制を皆川さんに確認する";
    merged.push({
      ...first,
      id: `merged-message-${first.roomId}-${first.messageId}-${hashText(title)}`,
      category: "ミチガエルへの確認",
      decision: sorted.some((candidate) => candidate.decision === "タスク候補") ? "タスク候補" : "確認必要",
      body: title,
      originalBody: first.originalBody || sorted.map((candidate) => candidate.body).join("\n"),
      score: Math.max(...sorted.map((candidate) => candidate.score || 0)),
      signals: [...new Set(sorted.flatMap((candidate) => candidate.signals || []))],
      reason: "同一チャット内の複数候補を統合",
      contextRange: `統合: 同一チャット内${sorted.length}件`,
      reviewReason: "06/09 16:47の1メッセージ内にある複数依頼を、皆川さんへの複合依頼として統合",
      mergedFromIds: sorted.map((candidate) => candidate.id),
      mergedMessageIds: [first.messageId],
      mergeTopic: null
    });
  }

  return [...passthrough, ...merged].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

function mergeRelatedCandidates(items) {
  const sorted = [...items].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const groups = [];

  for (const candidate of sorted) {
    const group = groups.find((candidateGroup) => shouldMergeCandidates(candidateGroup.at(-1), candidate));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }

  return groups.map(mergeCandidateGroup).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

function completionEvidenceByTarget(messagesByRoom) {
  const map = new Map();
  for (const target of completionEvidenceTargets) {
    const messageIds = (target.messageIds || [target.messageId]).map(String).filter(Boolean);
    const items = messageIds
      .map((messageId) => (messagesByRoom.get(target.roomId) || []).find(({ message }) => String(message.message_id) === messageId))
      .filter(Boolean);
    if (items.length !== messageIds.length) continue;
    const body = items.map(({ message }) => stripChatworkMarkup(message.body || "")).join("\n\n---\n\n");
    if (!target.matchesEvidence(body)) continue;
    const first = items[0];
    const last = items.at(-1);
    map.set(target.key, {
      roomId: target.roomId,
      messageId: messageIds[0],
      messageIds,
      chatworkUrl: `https://www.chatwork.com/#!rid${target.roomId}-${messageIds[0]}`,
      chatworkUrls: messageIds.map((messageId) => `https://www.chatwork.com/#!rid${target.roomId}-${messageId}`),
      accountName: uniqueValues(items.map(({ message }) => message.account?.name || "")).join(" / "),
      sentAt: new Date((last.message.send_time || 0) * 1000).toISOString(),
      timeLabel: `${formatDate(first.message.send_time || 0)} - ${formatDate(last.message.send_time || 0)}`,
      body
    });
  }
  return map;
}

function applyCompletionEvidence(candidate, evidenceMap) {
  const target = completionEvidenceTargets.find((item) => item.matchesCandidate(candidate) && evidenceMap.has(item.key));
  if (!target) return candidate;
  return {
    ...candidate,
    statusSuggestion: "完了済みの可能性",
    completionStatus: "done-possible",
    completionLabel: target.label,
    completionScopes: target.scopes,
    completionEvidence: evidenceMap.get(target.key),
    reviewReason: appendReviewReason(candidate, target.reviewReason)
  };
}

const correctedCandidates = applySpecificTitleCorrections(deduped);
const sameMessageMergedCandidates = mergeSameMessageRequests(correctedCandidates);
const mergedCandidates = mergeRelatedCandidates(sameMessageMergedCandidates);
const learnedCandidates = mergedCandidates.map(applyLearnedDecisionRules);
const manualJudgments = await loadManualJudgments();
const manualResult = applyManualJudgments(learnedCandidates, manualJudgments);
const completionEvidenceMap = completionEvidenceByTarget(messagesByRoom);
const completionAwareCandidates = manualResult.candidates.map((candidate) => applyCompletionEvidence(candidate, completionEvidenceMap));
const visibleCandidates = completionAwareCandidates.filter((candidate) => candidate.decision !== "不要");
const excludedCandidateCount = manualResult.candidates.length - visibleCandidates.length;

const output = {
  generatedAt: new Date().toISOString(),
  scope: {
    accountId: matsuzakiAccountId,
    rule: "個人チャットは全投稿対象。その他ルームは松﨑からの送信、松﨑宛てTo、または松﨑への返信のうち、ABC/ミチガエル/エックスラボ/Xラボ/YA/ワイエージェンシー/長径/包茎などの関連語を含む投稿を対象"
  },
  rooms,
  syncWarnings: fetchErrors,
  categories: categories.map((category) => category.name),
  manualJudgments: manualResult.summary,
  excludedCandidates: {
    decision: "不要",
    count: excludedCandidateCount
  },
  candidates: visibleCandidates
};

await mkdir(join(process.cwd(), "public", "data"), { recursive: true });
await writeFile(join(process.cwd(), "public", "data", "candidates.json"), JSON.stringify(output, null, 2));
if (process.env.WRITE_AUDIT === "1") {
  await mkdir(join(process.cwd(), "work"), { recursive: true });
  await writeFile(join(process.cwd(), "work", "abc-chatwork-audit.json"), JSON.stringify({
    ...output,
    audit: {
      totalCandidatesBeforeVisibilityFilter: manualResult.candidates.length,
      visibleCandidates: visibleCandidates.length,
      excludedCandidates: excludedCandidateCount
    },
    allCandidates: manualResult.candidates
  }, null, 2));
}
console.log(`wrote ${visibleCandidates.length} candidates to public/data/candidates.json`);
console.log(`excluded unnecessary candidates: ${excludedCandidateCount}`);
if (manualJudgments.length) {
  console.log(`applied manual judgments: ${manualResult.summary.matchedCandidates}/${manualJudgments.length}`);
}
