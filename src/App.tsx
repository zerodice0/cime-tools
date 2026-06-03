import {
  useAction,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  LinkIcon,
  LogOut,
  PauseCircle,
  Radio,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/clerk-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../convex/_generated/api";
import {
  formatDateTime,
  formatDiscordDateTime,
  formatDuration,
  formatMaybeDate,
  formatRelativeTime,
} from "./lib/format";
import { ClerkOAuthCallback, GoogleSignInButton } from "./auth";

type Notice = {
  type: "success" | "error" | "info";
  message: string;
};

type NavigateOptions = {
  replace?: boolean;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => void;
};

type LinkedCimeAccount = {
  channelId: string;
  channelName: string;
  channelHandle?: string;
  channelImageUrl?: string;
};

const DEFAULT_LIVE_MESSAGE_TEMPLATE =
  "{channelName} 라이브가 시작되었습니다.";
const DEFAULT_STALE_MESSAGE_TEMPLATE =
  "{channelName} 채널이 30일 이상 오프라인 상태라 라이브 알림을 일시 중지했습니다. 대시보드에서 다시 요청하면 재개됩니다.";
const MESSAGE_TEMPLATE_VARIABLES = [
  "{channelName}",
  "{channelHandle}",
  "{channelUrl}",
  "{liveTitle}",
  "{startedAt}",
];
const DISCORD_WEBHOOK_GUIDE_URL =
  "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks";
const DISCORD_WEBHOOK_DOCS_URL =
  "https://docs.discord.com/developers/resources/webhook";

export default function App() {
  const { path, navigate } = useBrowserPath();
  const isCallback = path === "/cime/callback";
  const isClerkCallback = path === "/sso-callback";
  const { isLoaded, isSignedIn } = useUser();
  const pageKey = getPageKey({
    isCallback,
    isClerkCallback,
    isLoaded,
    isSignedIn,
  });

  let page: ReactNode;

  if (isClerkCallback) {
    page = <ClerkOAuthCallback />;
  } else if (!isLoaded) {
    page = <div className="loading-panel">로그인 상태 확인 중</div>;
  } else if (!isSignedIn) {
    page = <SignedOutScreen />;
  } else {
    page = (
      <SignedInScreen
        isCallback={isCallback}
        onCimeLinkComplete={() => navigate("/", { replace: true })}
      />
    );
  }

  return (
    <main className="app-shell">
      <DemoBanner />
      <div className="page-transition" key={pageKey}>
        {page}
      </div>
    </main>
  );
}

function DemoBanner() {
  return (
    <aside className="demo-banner" aria-label="운영 상태">
      <span>현재 데모 버전으로 운영 중입니다.</span>
      <strong>설정과 기록이 초기화되거나 서비스가 중단될 수 있습니다.</strong>
    </aside>
  );
}

function useBrowserPath() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    function syncPath() {
      setPath(window.location.pathname);
    }

    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    runWithViewTransition(() => {
      if (options.replace) {
        window.history.replaceState({}, "", to);
      } else {
        window.history.pushState({}, "", to);
      }
      setPath(window.location.pathname);
    });
  }, []);

  return { path, navigate };
}

function runWithViewTransition(update: () => void) {
  const transitionDocument = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!transitionDocument.startViewTransition || reduceMotion) {
    update();
    return;
  }

  transitionDocument.startViewTransition(update);
}

function getPageKey({
  isCallback,
  isClerkCallback,
  isLoaded,
  isSignedIn,
}: {
  isCallback: boolean;
  isClerkCallback: boolean;
  isLoaded: boolean;
  isSignedIn?: boolean;
}) {
  if (isClerkCallback) {
    return "clerk-callback";
  }
  if (!isLoaded) {
    return "auth-loading";
  }
  if (!isSignedIn) {
    return "signed-out";
  }
  if (isCallback) {
    return "cime-callback";
  }
  return "dashboard";
}

function SignedOutScreen() {
  return (
    <section className="auth-landing" aria-labelledby="auth-title">
      <div className="auth-copy">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Radio size={16} />
          </span>
          <span>CI.ME Live Discord</span>
        </div>
        <div className="hero-status-row" aria-hidden="true">
          <span className="live-badge">LIVE</span>
          <span>Discord Alert</span>
        </div>
        <h1 id="auth-title">
          내 채널
          <span>라이브 알림</span>
        </h1>
        <GoogleSignInButton />
      </div>

      <div className="auth-visual" aria-hidden="true">
        <LiveCardPreview />
        <div className="notification-preview">
          <Radio size={17} />
          <div>
            <strong>채널 라이브 ON</strong>
            <span>#discord</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignedInScreen({
  isCallback,
  onCimeLinkComplete,
}: {
  isCallback: boolean;
  onCimeLinkComplete: () => void;
}) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const convexAuth = useConvexAuth();
  const userLabel =
    user?.primaryEmailAddress?.emailAddress ??
    user?.fullName ??
    "로그인됨";

  async function handleSignOut() {
    await signOut({ redirectUrl: "/" });
  }

  if (convexAuth.isLoading) {
    return (
      <DashboardShell
        userLabel={userLabel}
        onSignOut={handleSignOut}
        contentKey="server-auth-loading"
      >
        <SetupChecklist mode="loading" />
        <SettingsUnavailable
          title="설정 정보를 연결하는 중"
          message="Clerk 로그인은 완료되었습니다. Discord 설정과 CI.ME 계정 연동을 불러오기 위해 서버 인증을 확인하고 있습니다."
        />
      </DashboardShell>
    );
  }

  if (!convexAuth.isAuthenticated) {
    return (
      <DashboardShell
        userLabel={userLabel}
        onSignOut={handleSignOut}
        contentKey="server-auth-blocked"
      >
        <SetupChecklist mode="blocked" />
        <SettingsUnavailable
          title="서버 인증 연결 필요"
          message="Clerk 세션은 확인됐지만 Convex 인증 토큰이 아직 유효하지 않습니다. Clerk JWT 템플릿 이름과 aud가 convex인지 확인해야 합니다."
        />
      </DashboardShell>
    );
  }

  if (isCallback) {
    return (
      <DashboardShell
        userLabel={userLabel}
        onSignOut={handleSignOut}
        contentKey="cime-callback"
      >
        <CimeCallback onComplete={onCimeLinkComplete} />
      </DashboardShell>
    );
  }

  return <Dashboard userLabel={userLabel} onSignOut={handleSignOut} />;
}

function DashboardShell({
  userLabel,
  onSignOut,
  contentKey = "dashboard-content",
  children,
}: {
  userLabel: string;
  onSignOut: () => void | Promise<void>;
  contentKey?: string;
  children: ReactNode;
}) {
  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">CI.ME Live Discord</p>
          <h1>라이브 알림 설정</h1>
        </div>
        <div className="topbar-actions">
          <span className="user-chip">{userLabel}</span>
          <button className="secondary-button" type="button" onClick={onSignOut}>
            <LogOut size={17} />
            로그아웃
          </button>
        </div>
      </header>
      <div className="dashboard-content" key={contentKey}>
        {children}
      </div>
    </div>
  );
}

function Dashboard({
  userLabel,
  onSignOut,
}: {
  userLabel: string;
  onSignOut: () => void | Promise<void>;
}) {
  const setup = useQuery(api.accounts.getSetup);
  const beginCimeLink = useAction(api.cime.beginLink);
  const saveDiscordWebhook = useAction(api.discord.saveWebhook);
  const testDiscordWebhook = useAction(api.discord.testWebhook);
  const removeCimeAccount = useMutation(api.accounts.removeCimeAccount);
  const removeDiscordWebhook = useMutation(api.accounts.removeDiscordWebhook);
  const reactivateMonitor = useMutation(api.accounts.reactivateMonitor);
  const updateDiscordNotificationSettings = useMutation(
    api.accounts.updateDiscordNotificationSettings,
  );

  const [webhookUrl, setWebhookUrl] = useState("");
  const [liveMessageTemplate, setLiveMessageTemplate] = useState(
    DEFAULT_LIVE_MESSAGE_TEMPLATE,
  );
  const [staleMessageTemplate, setStaleMessageTemplate] = useState(
    DEFAULT_STALE_MESSAGE_TEMPLATE,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [discordActionNotice, setDiscordActionNotice] = useState<Notice | null>(null);
  const [isDiscordGuideOpen, setDiscordGuideOpen] = useState(false);
  const [isWebhookVisible, setWebhookVisible] = useState(false);

  const monitorState = useMemo(() => getMonitorState(setup), [setup]);
  const previewData = useMemo(
    () => getPreviewData(setup?.account),
    [setup?.account],
  );

  useEffect(() => {
    if (!setup?.webhook) {
      return;
    }
    setLiveMessageTemplate(
      setup.webhook.liveMessageTemplate ?? DEFAULT_LIVE_MESSAGE_TEMPLATE,
    );
    setStaleMessageTemplate(
      setup.webhook.staleMessageTemplate ?? DEFAULT_STALE_MESSAGE_TEMPLATE,
    );
  }, [
    setup?.webhook?._id,
    setup?.webhook?.liveMessageTemplate,
    setup?.webhook?.staleMessageTemplate,
  ]);

  async function startCimeLink() {
    setBusy("cime");
    setNotice(null);
    try {
      const result = await beginCimeLink({});
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setNotice(toErrorNotice(error));
      setBusy(null);
    }
  }

  function updateLiveMessageTemplate(value: string) {
    setLiveMessageTemplate(value);
    setDiscordActionNotice(null);
  }

  function updateStaleMessageTemplate(value: string) {
    setStaleMessageTemplate(value);
    setDiscordActionNotice(null);
  }

  async function submitDiscordWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("discord");
    setNotice(null);
    setDiscordActionNotice({
      type: "info",
      message: "Discord에서 webhook URL을 확인하고 저장 중입니다.",
    });
    try {
      await saveDiscordWebhook({
        webhookUrl,
        liveMessageTemplate,
        staleMessageTemplate,
      });
      setWebhookUrl("");
      setWebhookVisible(false);
      const successNotice = {
        type: "success",
        message: setup?.account
          ? "Discord webhook을 저장했고 라이브 알림이 활성화되었습니다."
          : "Discord webhook을 저장했습니다. CI.ME 계정을 연동하면 라이브 알림이 활성화됩니다.",
      } satisfies Notice;
      setNotice(successNotice);
      setDiscordActionNotice(successNotice);
    } catch (error) {
      const errorNotice = toErrorNotice(error);
      setNotice(errorNotice);
      setDiscordActionNotice(errorNotice);
    } finally {
      setBusy(null);
    }
  }

  async function sendDiscordTestMessage() {
    setBusy("discord-test");
    setNotice(null);
    setDiscordActionNotice({
      type: "info",
      message: "Discord로 테스트 메시지를 전송 중입니다. 이 작업은 URL을 저장하지 않습니다.",
    });
    try {
      const result = await testDiscordWebhook({
        webhookUrl: setup?.webhook ? undefined : webhookUrl,
        liveMessageTemplate,
      });
      const successNotice = {
        type: "success",
        message: result.webhookName
          ? `${result.webhookName} webhook으로 테스트 메시지를 보냈습니다.`
          : "Discord로 테스트 메시지를 보냈습니다.",
      } satisfies Notice;
      setNotice(successNotice);
      setDiscordActionNotice(successNotice);
    } catch (error) {
      const errorNotice = toErrorNotice(error);
      setNotice(errorNotice);
      setDiscordActionNotice(errorNotice);
    } finally {
      setBusy(null);
    }
  }

  async function submitNotificationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("notification-settings");
    setNotice(null);
    setDiscordActionNotice({
      type: "info",
      message: "Discord 알림 메시지를 저장 중입니다.",
    });
    try {
      await updateDiscordNotificationSettings({
        liveMessageTemplate,
        staleMessageTemplate,
      });
      const successNotice = {
        type: "success",
        message: "Discord 알림 메시지를 저장했습니다.",
      } satisfies Notice;
      setNotice(successNotice);
      setDiscordActionNotice(successNotice);
    } catch (error) {
      const errorNotice = toErrorNotice(error);
      setNotice(errorNotice);
      setDiscordActionNotice(errorNotice);
    } finally {
      setBusy(null);
    }
  }

  async function runMutation(name: string, task: () => Promise<unknown>) {
    setBusy(name);
    setNotice(null);
    try {
      await task();
      setNotice({ type: "success", message: "변경사항을 저장했습니다." });
    } catch (error) {
      setNotice(toErrorNotice(error));
    } finally {
      setBusy(null);
    }
  }

  if (setup === undefined) {
    return (
      <DashboardShell
        userLabel={userLabel}
        onSignOut={onSignOut}
        contentKey="setup-loading"
      >
        <SetupChecklist mode="loading" />
        <div className="loading-panel">설정 정보 불러오는 중</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      userLabel={userLabel}
      onSignOut={onSignOut}
      contentKey="setup-ready"
    >
      {notice ? (
        <div className={`notice ${notice.type}`}>{notice.message}</div>
      ) : null}
      {isDiscordGuideOpen ? (
        <DiscordWebhookGuideModal onClose={() => setDiscordGuideOpen(false)} />
      ) : null}

      <SetupChecklist setup={setup} />

      <section className="dashboard-grid">
        <div className="panel-stack">
          <PanelHeader
            icon={<Unplug size={18} />}
            title="Discord 설정"
            action={
              <div className="panel-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => setDiscordGuideOpen(true)}
                >
                  <HelpCircle size={17} />
                  설정 방법
                </button>
                {setup.webhook ? (
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Discord 연결 해제"
                    disabled={busy === "remove-discord"}
                    onClick={() =>
                      runMutation("remove-discord", () => removeDiscordWebhook({}))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            }
          />
          <div className="panel-body">
            <p className="panel-copy">
              Webhook URL은 비밀번호처럼 취급하세요. 저장 버튼을 누르면 Discord에서 URL을 확인한 뒤 이 계정에 저장합니다. 테스트 전송은 저장하지 않습니다.
            </p>
            {setup.webhook ? (
              <div className="webhook-settings">
                <div className="webhook-summary">
                  <div>
                    <strong>{setup.webhook.name ?? "Discord webhook"} 저장됨</strong>
                    <span>Webhook URL은 보안상 숨김 처리되었습니다.</span>
                  </div>
                  <CheckCircle2 className="success-icon" size={20} />
                </div>
                <form
                  className="notification-template-form"
                  onSubmit={submitNotificationSettings}
                >
                  <MessageTemplateFields
                    liveMessageTemplate={liveMessageTemplate}
                    staleMessageTemplate={staleMessageTemplate}
                    onLiveChange={updateLiveMessageTemplate}
                    onStaleChange={updateStaleMessageTemplate}
                  />
                  <DiscordMessagePreview
                    liveMessageTemplate={liveMessageTemplate}
                    staleMessageTemplate={staleMessageTemplate}
                    previewData={previewData}
                  />
                  <div className="form-action-row">
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={busy === "discord-test"}
                      onClick={sendDiscordTestMessage}
                    >
                      <Send size={17} />
                      {busy === "discord-test" ? "전송 중" : "테스트 전송"}
                    </button>
                    <button
                      className="secondary-button compact"
                      type="submit"
                      disabled={busy === "notification-settings"}
                    >
                      <Save size={17} />
                      {busy === "notification-settings" ? "저장 중" : "메시지 저장"}
                    </button>
                  </div>
                  {discordActionNotice ? (
                    <p
                      className={`inline-status ${discordActionNotice.type}`}
                      aria-live="polite"
                    >
                      {discordActionNotice.message}
                    </p>
                  ) : null}
                </form>
              </div>
            ) : (
              <form className="webhook-form" onSubmit={submitDiscordWebhook}>
                <label htmlFor="webhookUrl">Webhook URL</label>
                <div className="input-row secret-input-row">
                  <input
                    id="webhookUrl"
                    type={isWebhookVisible ? "text" : "password"}
                    value={webhookUrl}
                    onChange={(event) => {
                      setWebhookUrl(event.target.value);
                      setDiscordActionNotice(null);
                    }}
                    placeholder="https://discord.com/api/webhooks/..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="icon-button"
                    type="button"
                    title={isWebhookVisible ? "Webhook URL 숨기기" : "Webhook URL 보기"}
                    aria-label={isWebhookVisible ? "Webhook URL 숨기기" : "Webhook URL 보기"}
                    onClick={() => setWebhookVisible((value) => !value)}
                  >
                    {isWebhookVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <p className="input-hint">
                  Discord 서버 설정의 연동 메뉴에서 만든 Incoming Webhook URL을 붙여넣으세요. 테스트 전송은 메시지만 보내고 URL을 저장하지 않습니다.
                </p>
                <MessageTemplateFields
                  liveMessageTemplate={liveMessageTemplate}
                  staleMessageTemplate={staleMessageTemplate}
                  onLiveChange={updateLiveMessageTemplate}
                  onStaleChange={updateStaleMessageTemplate}
                />
                <DiscordMessagePreview
                  liveMessageTemplate={liveMessageTemplate}
                  staleMessageTemplate={staleMessageTemplate}
                  previewData={previewData}
                />
                <div className="form-action-row">
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={
                      !webhookUrl.trim() ||
                      busy === "discord-test" ||
                      busy === "discord"
                    }
                    onClick={sendDiscordTestMessage}
                  >
                    <Send size={17} />
                    {busy === "discord-test" ? "전송 중" : "테스트 전송"}
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      !webhookUrl.trim() ||
                      busy === "discord" ||
                      busy === "discord-test"
                    }
                  >
                    <Save size={17} />
                    {busy === "discord" ? "저장 중" : "Webhook URL 저장"}
                  </button>
                </div>
                {discordActionNotice ? (
                  <p
                    className={`inline-status ${discordActionNotice.type}`}
                    aria-live="polite"
                  >
                    {discordActionNotice.message}
                  </p>
                ) : null}
              </form>
            )}
          </div>
        </div>

        <div className="panel-stack">
          <PanelHeader
            icon={<LinkIcon size={18} />}
            title="CI.ME 계정 연동"
            action={
              setup.account ? (
                <button
                  className="icon-button danger"
                  type="button"
                  title="CI.ME 연동 해제"
                  disabled={busy === "remove-cime"}
                  onClick={() =>
                    runMutation("remove-cime", () => removeCimeAccount({}))
                  }
                >
                  <Trash2 size={17} />
                </button>
              ) : null
            }
          />
          <div className="panel-body account-row">
            {setup.account ? (
              <>
                <LinkedAccountAvatar account={setup.account} />
                <div className="account-copy">
                  <strong>{setup.account.channelName}</strong>
                  <span>{setup.account.channelHandle ?? setup.account.channelId}</span>
                </div>
                <CheckCircle2 className="success-icon" size={20} />
              </>
            ) : (
              <div className="setting-action-block">
                <p className="panel-copy">
                  CI.ME OAuth로 본인 채널을 확인하고 라이브 상태를 가져옵니다.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy === "cime"}
                  onClick={startCimeLink}
                >
                  <ExternalLink size={18} />
                  CI.ME 연동
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="panel-stack wide">
          <PanelHeader icon={<Activity size={18} />} title="라이브 감지 상태" />
          <div className="panel-body monitor-layout">
            <div className="monitor-main">
              <p className="panel-copy monitor-copy">
                Discord와 CI.ME 연동이 끝나면 내 채널의 라이브 시작 여부를 주기적으로 확인하고, 새 라이브가 감지될 때 Discord로 알림을 보냅니다.
              </p>
              <span className={`status-pill ${monitorState.tone}`}>
                {monitorState.icon}
                {monitorState.label}
              </span>
              <div className="monitor-detail-grid">
                <Detail label="감지된 라이브 상태" value={formatLiveValue(setup.monitor)} />
                <Detail
                  label="최근 라이브 시작"
                  value={formatMaybeDate(setup.monitor?.lastOpenedAt)}
                />
                <Detail
                  label="최근 Discord 알림"
                  value={formatRelativeTime(setup.monitor?.lastLiveNotifiedAt)}
                />
                <Detail
                  label="다음 알림 대기"
                  value={formatCooldown(setup.monitor?.cooldownUntil)}
                />
                <Detail
                  label="오프라인 시작"
                  value={formatDateTime(setup.monitor?.offlineSince)}
                />
                <Detail
                  label="오프라인 확인 주기"
                  value={formatDuration(setup.policy.baseIntervalMs)}
                />
              </div>
            </div>
            {setup.monitor?.status === "stalePaused" ||
            setup.monitor?.status === "errored" ? (
              <button
                className="secondary-button"
                type="button"
                disabled={busy === "reactivate"}
                onClick={() =>
                  runMutation("reactivate", () => reactivateMonitor({}))
                }
              >
                <RefreshCw size={17} />
                다시 요청
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="history-section">
        <h2>전송 기록</h2>
        <div className="history-list">
          {setup.deliveries.length > 0 ? (
            setup.deliveries.map((delivery: any) => (
              <div className="history-row" key={delivery._id}>
                <span className={`dot ${delivery.status}`} />
                <div>
                  <strong>{delivery.type === "liveStarted" ? "라이브 시작" : "오프라인 정지"}</strong>
                  <span>{delivery.error ?? formatDateTime(delivery.createdAt)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-history">기록 없음</div>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

function MessageTemplateFields({
  liveMessageTemplate,
  staleMessageTemplate,
  onLiveChange,
  onStaleChange,
}: {
  liveMessageTemplate: string;
  staleMessageTemplate: string;
  onLiveChange: (value: string) => void;
  onStaleChange: (value: string) => void;
}) {
  return (
    <div className="template-fields">
      <label>
        라이브 시작 메시지
        <textarea
          value={liveMessageTemplate}
          onChange={(event) => onLiveChange(event.target.value)}
          maxLength={280}
          rows={3}
        />
      </label>
      <label>
        장기 오프라인 정지 안내
        <textarea
          value={staleMessageTemplate}
          onChange={(event) => onStaleChange(event.target.value)}
          maxLength={280}
          rows={3}
        />
      </label>
      <div className="template-variable-list" aria-label="사용 가능한 변수">
        {MESSAGE_TEMPLATE_VARIABLES.map((variable) => (
          <code key={variable}>{variable}</code>
        ))}
      </div>
    </div>
  );
}

function DiscordMessagePreview({
  liveMessageTemplate,
  staleMessageTemplate,
  previewData,
}: {
  liveMessageTemplate: string;
  staleMessageTemplate: string;
  previewData: MessagePreviewData;
}) {
  return (
    <div className="discord-preview">
      <div className="preview-header">
        <h3>전송될 메시지 미리보기</h3>
        <span>멘션 비활성화</span>
      </div>
      <div className="discord-message">
        <strong>
          {renderMessageTemplate(liveMessageTemplate, previewData)}
        </strong>
        <div className="discord-embed">
          <b>{previewData.liveTitle}</b>
          <dl>
            <div>
              <dt>CI.ME 채널</dt>
              <dd>{previewData.channelName}</dd>
            </div>
            <div>
              <dt>시작 시간</dt>
              <dd>{previewData.startedAt}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="discord-message muted">
        <strong>
          {renderMessageTemplate(staleMessageTemplate, previewData)}
        </strong>
      </div>
      <p className="preview-trigger-copy">
        라이브가 새로 시작될 때 알림을 보내고, 같은 라이브에는 1시간 동안 다시 보내지 않습니다. 30일 이상 오프라인이면 정지 안내를 한 번 보냅니다.
      </p>
    </div>
  );
}

function SetupChecklist({
  setup,
  mode = "ready",
}: {
  setup?: any;
  mode?: "ready" | "loading" | "blocked";
}) {
  const isLoading = mode === "loading";
  const isBlocked = mode === "blocked";
  const discordDone = Boolean(setup?.webhook);
  const cimeDone = Boolean(setup?.account);
  const settingsReady = discordDone && cimeDone;

  return (
    <section className="setup-summary" aria-label="설정 항목">
      <SetupStep
        icon={<Unplug size={18} />}
        title="Discord 설정"
        value={getStepValue(discordDone, isLoading, isBlocked)}
        tone={getStepTone(discordDone, isLoading, isBlocked)}
      />
      <SetupStep
        icon={<LinkIcon size={18} />}
        title="CI.ME 계정 연동"
        value={getStepValue(cimeDone, isLoading, isBlocked)}
        tone={getStepTone(cimeDone, isLoading, isBlocked)}
      />
      <SetupStep
        icon={<Activity size={18} />}
        title="라이브 알림 활성화"
        value={getReadinessValue(discordDone, cimeDone, isLoading, isBlocked)}
        tone={getStepTone(settingsReady, isLoading, isBlocked)}
      />
    </section>
  );
}

function SetupStep({
  icon,
  title,
  value,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`setup-step ${tone}`}>
      {icon}
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsUnavailable({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="dashboard-grid">
      <DisabledSettingPanel icon={<Unplug size={18} />} title="Discord 설정" />
      <DisabledSettingPanel icon={<LinkIcon size={18} />} title="CI.ME 계정 연동" />
      <div className="panel-stack wide auth-status-panel">
        <PanelHeader icon={<AlertTriangle size={18} />} title={title} />
        <div className="panel-body">
          <p className="panel-copy">{message}</p>
        </div>
      </div>
    </section>
  );
}

function DisabledSettingPanel({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="panel-stack disabled-panel">
      <PanelHeader icon={icon} title={title} />
      <div className="panel-body">
        <p className="panel-copy">서버 인증 연결 후 설정할 수 있습니다.</p>
        <button className="secondary-button compact" type="button" disabled>
          대기 중
        </button>
      </div>
    </div>
  );
}

function DiscordWebhookGuideModal({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-webhook-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="guide-modal-header">
          <div>
            <HelpCircle size={18} />
            <h2 id="discord-webhook-guide-title">Discord Webhook 설정</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            title="닫기"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="guide-modal-body">
          <ol className="guide-step-list">
            <li>Discord 왼쪽 서버 목록에서 알림을 받을 서버를 선택합니다.</li>
            <li>서버 이름 옆 아래쪽 화살표를 누르고 서버 설정을 엽니다.</li>
            <li>서버 설정 화면의 왼쪽 목록에서 연동을 클릭합니다. 보통 접근 권한 아래, App 디렉터리 위에 있습니다.</li>
            <li>연동 화면 안에서 Webhooks 또는 웹후크 섹션을 열고 새 Webhook을 만듭니다.</li>
            <li>메시지를 받을 텍스트 채널을 선택한 뒤 Webhook URL을 복사합니다.</li>
            <li>복사한 URL을 이 화면의 입력칸에 붙여넣습니다.</li>
            <li>테스트 전송으로 채널에 메시지가 도착하는지 확인한 뒤 저장합니다.</li>
          </ol>
          <p className="guide-note">
            Webhook URL은 비밀번호처럼 취급하세요. 외부에 공유했다면 Discord에서 해당 webhook을 삭제하고 새로 만드세요. 서버 설정이나 Webhooks 메뉴가 보이지 않으면 Webhook 관리 권한이 필요할 수 있습니다.
          </p>
        </div>
        <footer className="guide-modal-actions">
          <a
            className="secondary-button compact"
            href={DISCORD_WEBHOOK_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={17} />
            공식 가이드
          </a>
          <a
            className="secondary-button compact"
            href={DISCORD_WEBHOOK_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={17} />
            개발 문서
          </a>
        </footer>
      </section>
    </div>
  );
}

function CimeCallback({ onComplete }: { onComplete: () => void }) {
  const completeLink = useAction(api.cime.completeLink);
  const didRun = useRef(false);
  const [notice, setNotice] = useState<Notice>({
    type: "success",
    message: "CI.ME 연동 완료 중",
  });

  useEffect(() => {
    if (didRun.current) {
      return;
    }
    didRun.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setNotice({ type: "error", message: "CI.ME 인증 응답이 올바르지 않습니다." });
      return;
    }

    completeLink({ code, state })
      .then(() => {
        onComplete();
      })
      .catch((error) => setNotice(toErrorNotice(error)));
  }, [completeLink, onComplete]);

  return (
    <section className="panel-stack wide callback-panel">
      <PanelHeader icon={<LinkIcon size={18} />} title="CI.ME 계정 연동" />
      <div className="panel-body">
        <div className={`notice ${notice.type}`}>{notice.message}</div>
      </div>
    </section>
  );
}

function LiveCardPreview({ account }: { account?: LinkedCimeAccount | null }) {
  return (
    <div className="stream-preview">
      <div className="stream-preview-top">
        <span className="live-badge">LIVE</span>
        <span>ci.me</span>
      </div>
      <div className="signal-frame">
        <AvatarSignal account={account} />
        <div className="signal-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="chat-preview">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function AvatarSignal({ account }: { account?: LinkedCimeAccount | null }) {
  if (account?.channelImageUrl) {
    return (
      <img
        className="signal-avatar"
        src={account.channelImageUrl}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="signal-mark">
      {account?.channelName.slice(0, 1) || "CI.ME"}
    </div>
  );
}

function LinkedAccountAvatar({ account }: { account: LinkedCimeAccount }) {
  if (account.channelImageUrl) {
    return (
      <img
        className="account-avatar"
        src={account.channelImageUrl}
        alt={`${account.channelName} 채널 아바타`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="account-avatar fallback" aria-hidden="true">
      {account.channelName.trim().slice(0, 1) || "C"}
    </span>
  );
}

type MessagePreviewData = {
  channelName: string;
  channelHandle: string;
  channelUrl: string;
  liveTitle: string;
  startedAt: string;
};

function getPreviewData(account?: LinkedCimeAccount | null): MessagePreviewData {
  const channelHandle = account?.channelHandle?.replace(/^@/, "") || "my-channel";
  return {
    channelName: account?.channelName || "내 채널",
    channelHandle,
    channelUrl: `https://ci.me/${channelHandle}`,
    liveTitle: "오늘의 라이브",
    startedAt: formatDiscordDateTime("2026-06-03T12:00:00+09:00"),
  };
}

function renderMessageTemplate(template: string, data: MessagePreviewData) {
  const values: Record<string, string> = {
    channelName: data.channelName,
    channelHandle: data.channelHandle,
    channelUrl: data.channelUrl,
    liveTitle: data.liveTitle,
    startedAt: data.startedAt,
  };

  return template.replace(
    /\{(channelName|channelHandle|channelUrl|liveTitle|startedAt)\}/g,
    (_, key: string) => values[key] ?? "",
  );
}

function PanelHeader({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getStepValue(done: boolean, isLoading: boolean, isBlocked: boolean) {
  if (isLoading) {
    return "연결 중";
  }
  if (isBlocked) {
    return "확인 필요";
  }
  return done ? "완료" : "필요";
}

function getReadinessValue(
  discordDone: boolean,
  cimeDone: boolean,
  isLoading: boolean,
  isBlocked: boolean,
) {
  if (isLoading) {
    return "확인 중";
  }
  if (isBlocked) {
    return "연결 오류";
  }
  if (!discordDone) {
    return "Discord 필요";
  }
  if (!cimeDone) {
    return "CI.ME 필요";
  }
  return "활성화됨";
}

function getStepTone(
  done: boolean,
  isLoading: boolean,
  isBlocked: boolean,
): "neutral" | "success" | "warning" | "danger" {
  if (isBlocked) {
    return "danger";
  }
  if (isLoading) {
    return "warning";
  }
  return done ? "success" : "neutral";
}

function getMonitorState(setup: any) {
  const monitor = setup?.monitor;
  if (!setup?.account || !setup?.webhook) {
    return {
      label: "연동 필요",
      tone: "neutral" as const,
      icon: <Clock size={16} />,
    };
  }
  if (!monitor) {
    return {
      label: "모니터 준비 중",
      tone: "neutral" as const,
      icon: <Clock size={16} />,
    };
  }
  if (monitor.status === "stalePaused") {
    return {
      label: "장기 오프라인 정지",
      tone: "warning" as const,
      icon: <PauseCircle size={16} />,
    };
  }
  if (monitor.status === "errored") {
    return {
      label: "조치 필요",
      tone: "danger" as const,
      icon: <AlertTriangle size={16} />,
    };
  }
  if (monitor.lastIsLive) {
    return {
      label: "라이브 감지됨",
      tone: "success" as const,
      icon: <Radio size={16} />,
    };
  }
  return {
    label: "라이브 감지 중",
    tone: "neutral" as const,
    icon: <Activity size={16} />,
  };
}

function formatLiveValue(monitor: any) {
  if (!monitor || monitor.lastIsLive === undefined) {
    return "기준 없음";
  }
  return monitor.lastIsLive ? "ON" : "OFF";
}

function formatCooldown(cooldownUntil?: number) {
  if (!cooldownUntil || cooldownUntil <= Date.now()) {
    return "없음";
  }
  return formatRelativeTime(cooldownUntil);
}

function toErrorNotice(error: unknown): Notice {
  const message = error instanceof Error ? error.message : String(error);
  const isDiscordWebhookVerificationError =
    message.includes("Discord webhook 확인 실패") ||
    message.includes("Discord webhook 응답을 해석할 수 없습니다.") ||
    message.includes("Discord webhook URL 형식이 올바르지 않습니다.") ||
    message.includes("Discord webhook URL만 저장할 수 있습니다.");
  const isMissingConvexFunction =
    message.includes("testWebhook") &&
    (message.includes("Could not find") ||
      message.includes("not found") ||
      message.includes("doesn't exist"));

  if (isDiscordWebhookVerificationError) {
    return {
      type: "error",
      message:
        "Discord에서 webhook URL을 확인하지 못했습니다. URL을 다시 복사했는지, webhook이 삭제되지 않았는지 확인하세요.",
    };
  }

  if (isMissingConvexFunction) {
    return {
      type: "error",
      message:
        "테스트 전송 기능이 아직 Convex 서버에 반영되지 않았습니다. Convex dev 또는 배포를 갱신한 뒤 다시 시도하세요.",
    };
  }

  return {
    type: "error",
    message,
  };
}
