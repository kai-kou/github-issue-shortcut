import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { loadRecentRepos, recordRecentRepo } from "./recentRepos";
import { loadReposCache, saveReposCache, type Repo } from "./reposCache";
import { buildRepoIndex } from "./repoIndex";
import { IssueForm, type IssueInput } from "../issues/IssueForm";
import { loadDraft, clearDraft } from "../issues/draft";
import { HighlightedTextInput } from "../issues/HighlightedTextInput";
import { findTokens, isTokenMatched, stripTokens } from "../issues/smartInput";
import type { PrefillParams } from "../issues/prefillParams";
import type { ShortcutPreset } from "../shortcuts/launchUrl";
import { submitErrorCode, submitErrorMessage } from "../issues/submitError";
import { useOfflineQueueSync } from "../issues/useOfflineQueueSync";
import { OfflineQueueList } from "../issues/OfflineQueueList";

type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };

/** ローカルキャッシュ（#101・SWR）が現在ユーザーのものであれば起動直後から ready で表示し、
 * fetch 完了を待たせない（別ユーザーのキャッシュは userId 不一致で無視され loading 初期化になる）。 */
function initialReposState(userId: number): ReposState {
  const cached = loadReposCache(userId);
  return cached ? { status: "ready", repos: cached } : { status: "loading" };
}
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; number: number; htmlUrl: string }
  | { status: "queued" }
  | { status: "error"; code: string };

/** アプリ内起動で受け取るプリセット（ShortcutPreset のうち起票に必要な項目のみ）。 */
type LaunchablePreset = Pick<ShortcutPreset, "repo" | "labels" | "title">;

/** 保存済みショートカット一覧（ShortcutList）から、ページ遷移せずに起票シートを開くための命令的 API。 */
export interface RepoPickerHandle {
  /** プリセットを適用して起票シートを開き、タイトル欄へフォーカスする。
   * 呼び出し元のクリックハンドラ内（＝ユーザージェスチャ内）で同期的に完了するため、
   * モバイル Chrome でもソフトキーボードが開く（#135）。
   * リポジトリを持たないプリセットは選択 UI が必要なため false を返し、呼び出し元の
   * 通常のリンク遷移（`/new?labels=&title=`）へフォールバックさせる。 */
  openWithPreset: (preset: LaunchablePreset) => boolean;
}

interface RepoPickerProps {
  /** URL パラメータ起動（B1-2・FR-15）の初期値。下書き（B5-1）が存在する場合はそちらを優先する。 */
  prefill?: PrefillParams | null;
  /** ログイン中ユーザーの GitHub ユーザー ID。SWR キャッシュの所有者照合に使う（#101・別アカウント混入防止）。 */
  userId: number;
  ref?: Ref<RepoPickerHandle>;
}

/** 起票先リポジトリの検索/選択 UI（B2-1/B2-2）。最近使用したリポジトリを先頭に表示する。 */
export function RepoPicker({ prefill = null, userId, ref }: RepoPickerProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<ReposState>(() => initialReposState(userId));
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecentRepos());
  // 送信失敗・中断時の下書き（B5-1）があれば、そのリポジトリを再訪時に自動選択して復元する。
  // 下書きがなければ URL パラメータ起動（B1-2）の repo を初期選択に使う。
  const [selected, setSelected] = useState<string | null>(() => loadDraft()?.repo ?? prefill?.repo ?? null);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [formKey, setFormKey] = useState(0);
  // URL パラメータ起動（B1-2）で受け取ったプリフィルと、保存済みショートカットのタップで
  // アプリ内適用したプリセット（#135）を同じ経路で扱うための実効プリフィル。props の `prefill` は
  // 「この文書がどの URL で起動されたか」の入力であり、アプリ内で別のショートカットを開いた場合は
  // こちらが新しいプリセットで上書きされる。
  const [activePrefill, setActivePrefill] = useState<PrefillParams | null>(prefill);
  // ショートカット起動のたびに IssueForm を作り直すための連番（#135）。同じリポジトリの別プリセットを
  // 続けて開いても、タイトル雛形・ラベルが確実に新しいプリセットへ切り替わるようにする。
  const [launchSeq, setLaunchSeq] = useState(0);
  // スマート入力（B3-3・#repo）でリポジトリを選んだ際、検索欄に残っていた自由文をタイトルの
  // 初期値として引き継ぐ（quickAddTitle）。一覧タップ経由の選択では null になる。
  const [quickAddTitle, setQuickAddTitle] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // タイトル欄の実体 input。ショートカットのタップ（ユーザージェスチャ）内で同期的に focus する（#135）。
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** 起動（長押しメニュー・URL 直叩き・共有シート・下書き復元）でシートが自動で開いたときに
   * 立てるフラグ。この経路はユーザー活性化がないためキーボードを自動表示できない
   * （`navigator.virtualKeyboard.show()` の sticky activation はナビゲーションで失われる・#138）。
   * 起動後の最初のタップをジェスチャとして使い、シート内のどこを叩いてもキーボードを開く。 */
  const pendingLaunchFocusRef = useRef(false);

  // オフラインキュー（B4-2・FR-22）: ネットワーク到達不能時の起票を保持し、オンライン復帰後に自動再送する。
  const {
    pendingCount,
    failedCount,
    failedItems,
    enqueue: enqueueOffline,
    resend: resendOffline,
    discard: discardOffline,
  } = useOfflineQueueSync();

  /** dialog がまだ開いていなければ開く（二重 showModal() は例外になるためガードする）。 */
  function openDialog() {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  /** 起票シートを開き、タイトル欄へフォーカスする。呼び出し元のクリックハンドラ内で同期的に
   * 完了させることで、モバイル Chrome でもソフトキーボードが開く（#135・B1-3）。 */
  function openSheetAndFocusTitle() {
    openDialog();
    // `showModal()` は autoFocus 要素へ既にフォーカスを移しているため、そのまま focus() を
    // 呼んでもフォーカス変化が起きず、Android Chrome はキーボードを開かない。
    // 明示的に blur → focus と踏んでフォーカス変化を発生させる（#143）。
    const input = titleInputRef.current;
    input?.blur();
    input?.focus();
    // ジェスチャ内で開いた（＝キーボードも開く）のでシート内タップの肩代わりは不要。
    pendingLaunchFocusRef.current = false;
  }

  /** 起動直後の最初のタップでタイトル欄へフォーカスを移す（#138）。
   * blur → focus と踏むのは、既にフォーカス済みの要素へ focus() してもキーボードが開かないため。 */
  function handleSheetClick(e: ReactMouseEvent<HTMLDialogElement>) {
    if (!pendingLaunchFocusRef.current) return;
    const target = e.target as HTMLElement;
    // backdrop（dialog 要素そのもの）へのタップと、他の操作対象へのタップは横取りしない。
    if (target === dialogRef.current) return;
    // ラベル選択は <details><summary>（LabelPicker）なので summary も除外する。
    if (target.closest("input, textarea, button, a, select, label, summary, [role='button']")) {
      pendingLaunchFocusRef.current = false;
      return;
    }
    pendingLaunchFocusRef.current = false;
    const input = titleInputRef.current;
    if (!input) return;
    input.blur();
    input.focus();
  }

  // `selected` の初期値（上記 useState）は RepoPicker の初回マウント時点の prefill しか見ないため、
  // 認証/インストール確認（App.tsx）が終わって RepoPicker が先にマウントされた後に launchQueue
  // 経由で prefill が届くケース（WebAPK 再利用起動・#98）を取りこぼす。`navigate-existing` は同一
  // アプリインスタンスを繰り返し再利用するため、既に一度別の起動で選択済みの状態から更に別の
  // ショートカットで再起動された場合も新しい prefill.repo に切り替える必要がある。そのため
  // 「未選択のときだけ適用」ではなく「直近に適用済みの repo と異なる新しい起動か」で判定する
  // （ユーザーが手動で別リポジトリへ切り替えた場合は prefill.repo 自体が変わらないため上書きしない）。
  const appliedPrefillRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill?.repo || prefill.repo === appliedPrefillRepoRef.current) return;
    appliedPrefillRepoRef.current = prefill.repo;
    setActivePrefill(prefill);
    // 一度送信した後（formKey > 0）に別のショートカットで再起動された場合も、新しい起動の
    // プリセットは適用する（連続起票で同じ雛形が復活するのを防ぐ formKey の役割は保ったまま、
    // 「新しい起動」だけリセットする）。
    setFormKey(0);
    if (selected !== prefill.repo) setSelected(prefill.repo);
  }, [prefill, selected]);

  // 下書き（B5-1）/ URL パラメータ起動（B1-2）でリポジトリが初期選択済みの場合も、
  // ユーザー操作を待たずボトムシートを自動的に開く（B1-3）。state.status も依存に含めるのは、
  // API 取得中（loading）は dialog 自体が早期 return で未レンダリングなため、
  // ready 化で dialog が初めて DOM に現れたタイミングでも再評価する必要があるため。
  useLayoutEffect(() => {
    if (!selected) return;
    // この効果は起動経由（下書き復元・URL パラメータ・launchQueue）でも、ジェスチャ経由
    // （selectRepo / openWithPreset の flushSync 内）でも走る。ジェスチャ経由は直後に
    // openSheetAndFocusTitle がフラグを下ろすため、ここでは一律に立てておけばよい（#138）。
    const wasClosed = !dialogRef.current?.open;
    if (wasClosed) pendingLaunchFocusRef.current = true;
    openDialog();
  }, [selected, state.status]);

  useEffect(() => {
    let active = true;
    fetch("/api/repos", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const data = (await res.json()) as { repos: Repo[] };
        return data.repos;
      })
      .then((repos) => {
        if (!active) return;
        saveReposCache(userId, repos);
        setState({ status: "ready", repos });
      })
      .catch(() => {
        // キャッシュ由来で既に ready なら、fetch 失敗（オフライン等）で表示を壊さず維持する
        // （SWR: revalidate 失敗時は stale データを見せ続ける・#101）。
        if (active) setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      });
    return () => {
      active = false;
    };
  }, [userId]);

  // スマート入力（B3-3・FR-20）: 検索欄に混ざった自由文の中から `#repo` トークンをインライン認識する。
  // 複数トークンは非対応（最初の1件のみ使う・YAGNI）。
  const repoIndex = useMemo(() => buildRepoIndex(state.status === "ready" ? state.repos : []), [state]);
  const queryTokens = useMemo(() => findTokens(query, "#"), [query]);
  const repoToken = queryTokens[0] ?? null;
  const displayQueryTokens = useMemo(
    () => queryTokens.map((tok) => ({ ...tok, matched: isTokenMatched(tok, repoIndex) })),
    [queryTokens, repoIndex],
  );
  const matchedRepoToken = repoToken && isTokenMatched(repoToken, repoIndex) ? repoToken : null;

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = (repoToken ? repoToken.name : query).trim().toLowerCase();
    const matches = q ? state.repos.filter((r) => r.fullName.toLowerCase().includes(q)) : state.repos;
    const byFullName = new Map(matches.map((r) => [r.fullName, r]));
    const recentFirst = recent
      .map((name) => byFullName.get(name))
      .filter((r): r is Repo => Boolean(r));
    const recentNames = new Set(recentFirst.map((r) => r.fullName));
    const rest = matches.filter((r) => !recentNames.has(r.fullName));
    return [...recentFirst, ...rest];
  }, [state, query, recent, repoToken]);

  const selectedPushAccess = useMemo(() => {
    if (state.status !== "ready" || !selected) return false;
    return state.repos.find((r) => r.fullName === selected)?.pushAccess ?? false;
  }, [state, selected]);

  // URL パラメータ起動（B1-2）のタイトル/ラベルは、まだ一度も送信していない・かつプレフィルが
  // 指定したリポジトリのままである場合のみ適用する。ユーザーが別リポジトリへ手動で切り替えた
  // 場合や、一度送信して連続起票に入った場合は引き継がない。
  const appliesPrefill = formKey === 0 && (!activePrefill?.repo || activePrefill.repo === selected);
  // プレフィルがなければスマート入力（B3-3）由来の quickAddTitle にフォールバックする
  // （selectRepo のたびに常に上書きされるため formKey 等での追加ガードは不要）。
  const resolvedInitialTitle = (appliesPrefill ? activePrefill?.title : undefined) ?? quickAddTitle ?? undefined;

  /** `prefillTitle`: スマート入力（B3-3）の `#repo` トークンタップ経由の選択時、検索欄に残っていた
   * 自由文（トークンを取り除いたもの）をタイトルの初期値として引き継ぐ。一覧タップ経由では null。 */
  /** 起票先の確定に伴う共通の状態更新（一覧タップ・ショートカット起動で共有する）。
   * flushSync の中から呼ぶ前提（呼び出し側がジェスチャ内での同期反映を担保する）。 */
  function applyRepoSelection(fullName: string, prefillTitle: string | null) {
    setSelected(fullName);
    setRecent(recordRecentRepo(fullName));
    setSubmitState({ status: "idle" });
    setQuickAddTitle(prefillTitle);
  }

  function selectRepo(fullName: string, prefillTitle: string | null = null) {
    // クリックハンドラ内（＝ユーザージェスチャ内）で IssueForm のマウントまで同期的に終わらせてから
    // dialog を開き focus する。React の既定のバッチ更新ではマウント（と autoFocus）がジェスチャの
    // 外へずれ、Android Chrome がソフトキーボードを開かない（#135・research/mobile-ux-pwa §2）。
    flushSync(() => {
      applyRepoSelection(fullName, prefillTitle);
    });
    openSheetAndFocusTitle();
  }

  /** 保存済みショートカット（ShortcutList）のタップからページ遷移せずに起票シートを開く（#135）。
   * リポジトリを持たないプリセットはリポジトリ選択 UI が必要なため false を返し、
   * 呼び出し元の通常のリンク遷移へフォールバックさせる。 */
  function openWithPreset(preset: LaunchablePreset): boolean {
    // リポジトリ一覧の取得前（loading / error）は dialog 自体が未レンダリングでシートを開けないため、
    // アプリ内起動を引き受けずリンク遷移へ委ねる。
    if (!preset.repo || state.status !== "ready") return false;
    flushSync(() => {
      setActivePrefill({ repo: preset.repo, labels: preset.labels, title: preset.title || null, body: null });
      setFormKey(0);
      setLaunchSeq((n) => n + 1);
      applyRepoSelection(preset.repo, null);
    });
    openSheetAndFocusTitle();
    return true;
  }

  useImperativeHandle(ref, () => ({ openWithPreset }));

  /** 一覧タップ時: 検索欄に確定済みの `#repo` トークンがあれば、残りの自由文をタイトルへ引き継ぐ。 */
  function handleSelectFromList(fullName: string) {
    const remaining = repoToken ? stripTokens(query, [repoToken]) : "";
    selectRepo(fullName, remaining.length > 0 ? remaining : null);
  }

  /** 検索欄のトークンをタップで解除する（B3-3 Done Criteria）。 */
  function removeQueryToken() {
    if (!repoToken) return;
    setQuery(stripTokens(query, [repoToken]));
  }

  async function submitIssue(input: IssueInput) {
    if (!selected) return;
    setSubmitState({ status: "submitting" });
    // オフラインキューへ積む場合に SW 側 Background Sync 再送との重複防止キーとして使い回すため、
    // 最初の送信試行の時点で発行する（失敗後に生成すると SW が既に再送した元リクエストと id が
    // 揃わなくなる・B4-4）。
    const clientRequestId = crypto.randomUUID();
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selected, title: input.title, body: input.body, labels: input.labels, clientRequestId }),
      });
      if (!res.ok) {
        const code = await submitErrorCode(res);
        // duplicate_submission は直前の同一内容の送信が既に GitHub 側で成功済みであることを意味する
        // （サーバー側は成功記録との照合でのみこのコードを返す）。取り残された下書きが後の
        // ウィンドウ外での二重作成を招かないよう、下書きはクリアする（B5-1 と整合）。
        if (code === "duplicate_submission") clearDraft();
        setSubmitState({ status: "error", code });
        return;
      }
      const data = (await res.json()) as { number: number; htmlUrl: string };
      clearDraft();
      setSubmitState({ status: "success", number: data.number, htmlUrl: data.htmlUrl });
      // 送信成功のたびにフォームを再マウントして入力内容をクリアする（連続起票を想定）。
      // formKey>0 は「1 回送信済み」を意味し、URL パラメータ起動のプレフィルを以降の
      // 連続起票へ引き継がない判定にも流用する（同じ雛形が繰り返し復活しないように）。
      setFormKey((k) => k + 1);
    } catch {
      // fetch 自体の失敗（オフライン・ネットワーク断）はオフラインキュー（B4-2・FR-22）へ積む。
      // 下書き（B5-1）は再送が確定するまで消さずに残す（再送失敗時の手動復旧経路として機能する）。
      // フォームはクリアしない（D-7・入力は絶対に失わせない）: formKey を進めて再マウントしても
      // 下書きから同じ内容が復元されるだけで、見た目上クリアされない意図しない状態になるため。
      enqueueOffline({ id: clientRequestId, repo: selected, title: input.title, body: input.body, labels: input.labels });
      setSubmitState({ status: "queued" });
    }
  }

  if (state.status === "loading") return <p className="status-note">{t.repoPicker.loading}</p>;
  if (state.status === "error") return <p className="status-note">{t.repoPicker.loadError}</p>;

  return (
    <div className="card">
      {pendingCount > 0 ? (
        <p className="status-note offline-queue-status">
          {t.repoPicker.offlineQueuePending} {pendingCount}
        </p>
      ) : null}
      {failedCount > 0 ? (
        <>
          <p className="status-note offline-queue-status offline-queue-status-failed">
            {t.repoPicker.offlineQueueFailed} {failedCount}
          </p>
          <OfflineQueueList items={failedItems} onResend={resendOffline} onDiscard={discardOffline} />
        </>
      ) : null}
      <label className="repo-search">
        <span className="field-label">{t.repoPicker.searchLabel}</span>
        <HighlightedTextInput
          value={query}
          onChange={setQuery}
          tokens={displayQueryTokens}
          placeholder={t.repoPicker.searchPlaceholder}
          enterKeyHint="search"
        />
      </label>
      {matchedRepoToken ? (
        <ul className="smart-token-chips" aria-label={t.repoPicker.smartTokenListLabel}>
          <li>
            <button
              type="button"
              aria-label={`${t.repoPicker.removeSmartTokenLabel}: ${matchedRepoToken.raw}`}
              onClick={removeQueryToken}
            >
              {matchedRepoToken.raw} <span aria-hidden="true">✕</span>
            </button>
          </li>
        </ul>
      ) : null}
      {filtered.length === 0 ? (
        <p className="status-note">{t.repoPicker.empty}</p>
      ) : (
        <ul className="repo-list">
          {filtered.map((repo) => (
            <li key={repo.id}>
              <button type="button" onClick={() => handleSelectFromList(repo.fullName)} aria-pressed={selected === repo.fullName}>
                {repo.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* ボトムシート（B1-3）: リポジトリ選択と同時に開き、起動直後の 1 タップで
          IssueForm 内タイトル欄へネイティブ autofocus 連携させる（interactive-widget=resizes-content
          は index.html の viewport meta で設定済み・キーボード表示時も送信ボタンが隠れない）。 */}
      <dialog ref={dialogRef} className="issue-sheet" aria-label={t.issueForm.targetRepoLabel} onClick={handleSheetClick}>
        {selected ? (
          <>
            <div className="issue-sheet-header">
              <button
                type="button"
                className="issue-sheet-close"
                onClick={() => dialogRef.current?.close()}
                aria-label={t.issueForm.closeButton}
                disabled={submitState.status === "submitting"}
              >
                ✕
              </button>
            </div>
            <IssueForm
              key={`${selected}-${formKey}-${launchSeq}`}
              repoFullName={selected}
              pushAccess={selectedPushAccess}
              onSubmit={submitIssue}
              submitting={submitState.status === "submitting"}
              initialTitle={resolvedInitialTitle}
              initialLabels={appliesPrefill ? activePrefill?.labels : undefined}
              initialBody={appliesPrefill ? activePrefill?.body : undefined}
              titleInputRef={titleInputRef}
            >
              {submitState.status === "success" ? (
                <p className="submit-result success">
                  {t.issueForm.successMessage} #{submitState.number}{" "}
                  <a href={submitState.htmlUrl} target="_blank" rel="noreferrer">
                    {t.issueForm.viewIssueLink}
                  </a>
                </p>
              ) : null}
              {submitState.status === "queued" ? (
                <p className="submit-result queued">{t.issueForm.queuedMessage}</p>
              ) : null}
              {submitState.status === "error" ? (
                <p className="submit-result error">
                  {submitErrorMessage(submitState.code, t)}
                  {submitState.code === "reauth_required" ? (
                    <>
                      {" "}
                      <a href="/auth/login">{t.auth.loginButton}</a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </IssueForm>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
