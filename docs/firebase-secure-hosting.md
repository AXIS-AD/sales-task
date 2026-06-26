# Firebase保護構成メモ

## 方針

- GitHub PagesにはChatwork本文や候補JSONを置かない
- 画面はFirebase Hostingで配信する
- GoogleログインはFirebase Authで行う
- タスク候補、判断、ステータス、備考はFirestoreに保存する
- Firestore Security Rulesで `@shibuya-ad.com` の認証済みユーザーだけ許可する

## Firestoreの想定パス

- `salesTaskApps/abcClinic/data/current`
  - `public/data/candidates.json` と同じ形の候補データ
- `salesTaskApps/abcClinic/data/manualJudgments`
  - `public/data/manual-judgments.json` と同じ形の手動判断データ
- `salesTaskApps/abcClinic/state/shared`
  - 画面操作で更新される判断、ステータス、備考、依頼、学習ルール

## Firebase設定

`public/config.js` の `firebaseConfig` にFirebase Webアプリ設定を入れる。

```js
window.ABC_TASK_AUTH_CONFIG = {
  allowedDomain: "shibuya-ad.com",
  dataSource: "firestore",
  firestoreAppPath: ["salesTaskApps", "abcClinic"],
  firebaseConfig: {
    apiKey: "...",
    authDomain: "...firebaseapp.com",
    projectId: "...",
    appId: "..."
  }
};
```

## 注意

Firebaseの設定値自体は公開されても問題ない前提の識別子。ただし、Chatwork APIトークン、サービスアカウントJSON、Chatwork本文JSONはrepoに置かない。

## 自動同期

GitHub Actionsで毎日 JST 09:00 / 19:00 に `npm run sync:chatwork-firestore` を実行する。

必要なGitHub Secrets:

- `CHATWORK_API_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

同期処理:

1. Firestoreの `data/manualJudgments` を取得してローカル一時ファイル化
2. Chatwork APIから対象ルームを取得して候補を再生成
3. `salesTaskApps/abcClinic/data/current` に候補データを書き込み
4. `salesTaskApps/abcClinic/data/manualJudgments` は既存判断を維持

GitHub ActionsのcronはUTC指定のため、`0 0,10 * * *` が JST 09:00 / 19:00 に該当する。
