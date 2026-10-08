"use client";
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { DOCUMENT_LOGO_PNG, DUITNOW_QR_PNG } from "../lib/document-assets";

type Role = "manager" | "sales" | "account";
type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  sales_code: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
};
type Order = {
  id: string;
  pi_number: string;
  team_number: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  currency: "MYR" | "SGD";
  booking_type: "new" | "existing";
  customer_type: "personal" | "company";
  company_registration_new: string | null;
  company_registration_old: string | null;
  tax_identification_number: string | null;
  sst_number: string | null;
  msic_code: string | null;
  business_activity: string | null;
  package_name: string | null;
  trip_category: string | null;
  resort_name: string | null;
  tour_name: string | null;
  trip_name: string;
  departure_date: string;
  return_date: string | null;
  pax: number;
  adult_count: number;
  child_count: number;
  infant_count: number;
  subtotal: number;
  discount: number;
  total_amount: number;
  paid_amount: number;
  actual_cost: number;
  actual_profit: number;
  status: string;
  bank_slip_path: string | null;
  urgent: boolean;
  urgent_marked_at: string | null;
  last_reminded_at: string | null;
  urgent_reminder_count: number;
  account_processing_at: string | null;
  account_processing_by: string | null;
  created_at: string;
  sales_user_id: string;
  profiles?: { full_name: string } | null;
};
type View =
  | "dashboard"
  | "orders"
  | "my-orders"
  | "new"
  | "notifications"
  | "account"
  | "costing"
  | "commission"
  | "staff"
  | "pi-settings"
  | "customer-base"
  | "receipt"
  | "security";
type PiOption = {
  id: string;
  option_group: "island_package" | "resort" | "day_trip";
  label: string;
  sort_order: number;
  active: boolean;
};
type CalendarColorSetting = { setting_key: string; label: string; color: string };
type PaymentSchedule = {
  id?: string;
  stage_name: string;
  custom_name?: string;
  amount: number;
  due_date: string;
};
const money = (n: number | string) =>
  `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const displayDate = (value: string) => {
  const [year, month, day] = (value || "").split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
};
const renderMultilineText = (value: string) =>
  String(value || "").split("\n").map((line, index, lines) => (
    <Fragment key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ));
async function materializeImagesForPdf(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (img) => {
    try {
      await img.decode();
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) return;
      const bounds = img.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.className = img.className;
      canvas.style.cssText = img.style.cssText;
      canvas.style.width = `${bounds.width || img.width}px`;
      canvas.style.height = `${bounds.height || img.height}px`;
      canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
      img.replaceWith(canvas);
    } catch {
      // Keep the original image if the browser cannot decode it.
    }
  }));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function alignPdfKeepTogether(root: HTMLElement) {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const rootRect = root.getBoundingClientRect();
  if (!rootRect.width) return;
  const pageHeight = (rootRect.width * 277) / 190;
  root.querySelectorAll<HTMLElement>(".pdf-keep-together").forEach((block) => {
    block.style.marginTop = "";
    const blockRect = block.getBoundingClientRect();
    if (!blockRect.height || blockRect.height >= pageHeight) return;
    const top = blockRect.top - rootRect.top;
    const available = pageHeight - (top % pageHeight);
    if (blockRect.height > available) {
      block.style.marginTop = `${available + 18}px`;
    }
  });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function downloadInvoicePdf(root: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const pdfWidth = 190;
  const pdfHeight = 277;
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const singlePageNaturalLimit = 318;

  const captureNode = async (node: HTMLDivElement) => {
    document.body.appendChild(node);
    await materializeImagesForPdf(node);
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: "#ffffff",
      windowWidth: 1100,
      ignoreElements: (element) => element.classList.contains("pdf-ignore"),
    });
    node.remove();
    return canvas;
  };

  const natural = root.cloneNode(true) as HTMLDivElement;
  natural.classList.add("pdf-capture-mode");
  natural.querySelectorAll<HTMLElement>(".pdf-keep-together").forEach((node) => {
    node.style.marginTop = "";
  });
  const naturalCanvas = await captureNode(natural);
  const naturalHeightMm = (naturalCanvas.height * pdfWidth) / naturalCanvas.width;
  const pdf = new jsPDF("p", "mm", "a4");

  // A small overflow is more readable as one slightly reduced page than a nearly-empty page 2.
  if (naturalHeightMm <= singlePageNaturalLimit) {
    const scale = Math.min(pdfWidth / naturalCanvas.width, pdfHeight / naturalCanvas.height);
    const width = naturalCanvas.width * scale;
    const height = naturalCanvas.height * scale;
    pdf.addImage(
      naturalCanvas.toDataURL("image/jpeg", 0.96),
      "JPEG",
      (pageWidthMm - width) / 2,
      (pageHeightMm - height) / 2,
      width,
      height,
    );
    pdf.save(filename);
    return;
  }

  const sourceTable = root.querySelector<HTMLTableElement>(".pi-items-table");
  const sourceRows = sourceTable
    ? Array.from(sourceTable.querySelectorAll<HTMLTableRowElement>("tbody > tr"))
    : [];
  const sourcePiNumber = root.querySelector<HTMLElement>(".pi-meta span")?.textContent?.trim() || "Proforma Invoice";
  const pageHeightCss = 850 * (pdfHeight / pdfWidth);

  const makePage = (
    start: number,
    count: number,
    pageIndex: number,
    isLast: boolean,
    pageNumber?: number,
    pageCount?: number,
  ) => {
    const page = root.cloneNode(true) as HTMLDivElement;
    page.classList.add("pdf-capture-mode", "pdf-page-mode");
    if (pageIndex > 0) {
      page.classList.add("pi-continuation-page");
      page.querySelector(".bill")?.remove();
      const metaValue = page.querySelector<HTMLElement>(".pi-meta span");
      if (metaValue) metaValue.textContent = `${sourcePiNumber} · CONTINUED`;
    }
    const pageTable = page.querySelector<HTMLTableElement>(".pi-items-table");
    const body = pageTable?.querySelector("tbody");
    if (body) {
      body.replaceChildren(
        ...sourceRows.slice(start, start + count).map((row) => row.cloneNode(true)),
      );
    }
    if (!isLast) {
      page.querySelector(".total")?.remove();
      page.querySelector(".pi-payment-schedule")?.remove();
      page.querySelector(".pi-bank")?.remove();
      page.querySelector(".pdf-keep-together")?.remove();
    }
    page.querySelectorAll<HTMLElement>(".pdf-keep-together").forEach((node) => {
      node.style.marginTop = "";
    });
    const footer = document.createElement("div");
    footer.className = "pi-page-footer";
    footer.innerHTML = `<b>HAPPY EXPRESS TRAVEL SDN BHD</b><span>${sourcePiNumber}${pageNumber && pageCount ? ` · Page ${pageNumber} of ${pageCount}` : ""}</span>`;
    page.appendChild(footer);
    page.style.height = `${pageHeightCss}px`;
    page.style.minHeight = `${pageHeightCss}px`;
    return page;
  };

  const pageFits = async (page: HTMLDivElement, isLast: boolean) => {
    document.body.appendChild(page);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rootTop = page.getBoundingClientRect().top;
    const lastContent = isLast
      ? page.querySelector<HTMLElement>(".pdf-keep-together") || page.querySelector<HTMLElement>(".pi-bank")
      : page.querySelector<HTMLElement>(".pi-items-table");
    const bottom = lastContent ? lastContent.getBoundingClientRect().bottom - rootTop : 0;
    const fits = bottom <= pageHeightCss - 55;
    page.remove();
    return fits;
  };

  const definitions: Array<{ start: number; count: number; isLast: boolean }> = [];
  let cursor = 0;
  while (cursor < sourceRows.length) {
    const remaining = sourceRows.length - cursor;
    const finalCandidate = makePage(cursor, remaining, definitions.length, true);
    if (await pageFits(finalCandidate, true)) {
      definitions.push({ start: cursor, count: remaining, isLast: true });
      cursor = sourceRows.length;
      break;
    }
    let best = 0;
    for (let count = 1; count <= remaining; count += 1) {
      const candidate = makePage(cursor, count, definitions.length, false);
      if (await pageFits(candidate, false)) best = count;
      else break;
    }
    best = Math.max(1, best);
    definitions.push({ start: cursor, count: best, isLast: false });
    cursor += best;
  }
  if (!definitions.length || !definitions[definitions.length - 1].isLast) {
    definitions.push({ start: cursor, count: 0, isLast: true });
  }

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const page = makePage(
      definition.start,
      definition.count,
      index,
      definition.isLast,
      index + 1,
      definitions.length,
    );
    const canvas = await captureNode(page);
    if (index > 0) pdf.addPage();
    const scale = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.96),
      "JPEG",
      (pageWidthMm - width) / 2,
      10,
      width,
      height,
    );
  }
  pdf.save(filename);
}

const labels: Record<string, string> = {
  draft: "Draft",
  on_hold: "On Hold · 等待付款",
  awaiting_invoice: "Account 开票中",
  invoiced: "Invoice Ready",
  completed: "已完成",
  cancelled: "已取消",
};

export default function Home() {
  const [ready, setReady] = useState(false),
    [profile, setProfile] = useState<Profile | null>(null),
    [recoveringPassword, setRecoveringPassword] = useState(false),
    [initError, setInitError] = useState("");
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) {
        setInitError("连接时间较长，请刷新页面重试。");
        setReady(true);
      }
    }, 8000);
    async function load(id: string) {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            "id,email,full_name,role,sales_code,must_change_password,password_changed_at",
          )
          .eq("id", id)
          .eq("active", true)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          await supabase.auth.signOut();
          throw new Error("这个员工账号已被停用，请联系Management。");
        }
        if (active) setProfile(data);
      } catch (e) {
        if (active)
          setInitError(e instanceof Error ? e.message : "无法读取员工资料");
      } finally {
        if (active) {
          window.clearTimeout(timeout);
          setReady(true);
        }
      }
    }
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return data.session ? load(data.session.user.id) : undefined;
      })
      .catch((e) => {
        if (active)
          setInitError(e instanceof Error ? e.message : "无法检查登录状态");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      window.setTimeout(() => {
        if (!active) return;
        if (event === "PASSWORD_RECOVERY") setRecoveringPassword(true);
        if (s) void load(s.user.id);
        else {
          setProfile(null);
          setReady(true);
        }
      }, 0);
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <div className="auth-page">
        <div className="auth-card">正在连接系统…</div>
      </div>
    );
  return profile && recoveringPassword ? (
    <ResetPassword
      done={async () => {
        await supabase.auth.signOut();
        setRecoveringPassword(false);
        setProfile(null);
      }}
    />
  ) : profile ? (
    <SecurityGate profile={profile} updateProfile={setProfile}>
      <System profile={profile} />
    </SecurityGate>
  ) : (
    <Login initialMessage={initError} />
  );
}

function ResetPassword({ done }: { done: () => void }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setMessage("新密码最少需要6个字符。");
    if (password !== confirm) return setMessage("两次输入的密码不一致。");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage(error.message);
    else done();
  }
  return (
    <div className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo">H</div>
        <small>HAPPY EXPRESS TRAVEL</small>
        <h1>重新设置登录密码</h1>
      </section>
      <form className="auth-card" onSubmit={save}>
        <small>PASSWORD RECOVERY</small>
        <h2>建立新密码</h2>
        <p>新密码最少6个字符，设置完成后请重新登录。</p>
        <label>New Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>Confirm Password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {message && <div className="auth-message">{message}</div>}
        <button className="primary auth-submit" disabled={busy}>{busy ? "Updating…" : "更新密码"}</button>
      </form>
    </div>
  );
}

function SecurityGate({
  profile,
  updateProfile,
  children,
}: {
  profile: Profile;
  updateProfile: (profile: Profile) => void;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<
      "checking" | "password" | "enroll" | "challenge" | "ready"
    >("checking"),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [factorId, setFactorId] = useState(""),
    [qrCode, setQrCode] = useState(""),
    [verifyCode, setVerifyCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);

  async function assessMfa() {
    setMode("checking");
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setMessage(error.message);
      return;
    }
    const verified = data.totp.find((factor) => factor.status === "verified");
    if (!verified) {
      setMode("enroll");
      return;
    }
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.data?.currentLevel === "aal2") setMode("ready");
    else {
      setFactorId(verified.id);
      setMode("challenge");
    }
  }

  useEffect(() => {
    setMode("ready");
  }, [profile.id]);

  async function changeTemporaryPassword() {
    setMessage("");
    if (newPassword.length < 6) {
      setMessage("新密码最少需要6个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    updateProfile({
      ...profile,
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    });
    setNewPassword("");
    setConfirmPassword("");
    setMode("ready");
  }

  async function beginEnrollment() {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Happy Express Travel",
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
  }

  async function verifyMfa() {
    if (verifyCode.trim().length !== 6) {
      setMessage("请输入验证器显示的6位数字。");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: verifyCode.trim(),
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setVerifyCode("");
    setMode("ready");
  }

  if (mode === "ready") return <>{children}</>;
  return (
    <div className="security-gate">
      <div className="security-card">
        <img src="/happy-express-logo.svg" alt="Happy Express Travel" />
        <small>SECURE STAFF ACCESS</small>
        {mode === "checking" && <h2>正在检查账号安全…</h2>}
        {mode === "password" && (
          <>
            <h2>首次登录，请更换临时密码</h2>
            <p>
              新密码只有你本人知道。更换完成后，Management只会收到更改通知。
            </p>
            <label>
              New Password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm New Password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={changeTemporaryPassword}
            >
              {busy ? "Updating…" : "更换密码并继续"}
            </button>
          </>
        )}
        {mode === "enroll" && (
          <>
            <h2>设置双重验证</h2>
            <p>
              使用Google Authenticator或Microsoft Authenticator扫描QR
              Code，登录时需要额外输入6位验证码。
            </p>
            {!qrCode ? (
              <button
                className="primary"
                disabled={busy}
                onClick={beginEnrollment}
              >
                {busy ? "Preparing…" : "开始设置双重验证"}
              </button>
            ) : (
              <>
                <img className="mfa-qr" src={qrCode} alt="MFA QR Code" />
                <label>
                  6-digit Verification Code
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(e) =>
                      setVerifyCode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                </label>
                <button className="primary" disabled={busy} onClick={verifyMfa}>
                  {busy ? "Verifying…" : "确认并启用"}
                </button>
              </>
            )}
          </>
        )}
        {mode === "challenge" && (
          <>
            <h2>双重验证</h2>
            <p>请输入验证器应用目前显示的6位验证码。</p>
            <label>
              Verification Code
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) =>
                  setVerifyCode(e.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <button className="primary" disabled={busy} onClick={verifyMfa}>
              {busy ? "Verifying…" : "验证并进入系统"}
            </button>
          </>
        )}
        {message && <div className="auth-message">{message}</div>}
        <button className="auth-switch" onClick={() => supabase.auth.signOut()}>
          退出账号
        </button>
      </div>
    </div>
  );
}

function Login({ initialMessage = "" }: { initialMessage?: string }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [forgotMode, setForgotMode] = useState(false),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(initialMessage);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const r = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setMsg(r.error ? r.error.message : "");
  }
  async function sendReset(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setMsg("请先输入员工Email。");
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    setMsg(error ? error.message : "密码重设邮件已发送，请检查Gmail收件箱和Spam。邮件链接只可使用一次。");
  }
  return (
    <div className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo">H</div>
        <small>HAPPY EXPRESS TRAVEL</small>
        <h1>订单管理，从一张整齐的 PI 开始。</h1>
        <p>
          Sales、Account
          与管理层共用一个入口，登录后只显示各自有权限查看的资料。
        </p>
        <div className="auth-flow">
          <span>
            PI
            <br />
            <b>On Hold</b>
          </span>
          <i>→</i>
          <span>
            收款
            <br />
            <b>成单</b>
          </span>
          <i>→</i>
          <span>
            Account
            <br />
            <b>正式开票</b>
          </span>
        </div>
      </section>
      <form className="auth-card" onSubmit={forgotMode ? sendReset : submit}>
        <div className="auth-logo small">H</div>
        <small>SECURE STAFF PORTAL</small>
        <h2>{forgotMode ? "忘记密码" : "欢迎回来"}</h2>
        <p>{forgotMode ? "输入员工Email，我们会发送密码重设链接。" : "请使用Management建立的员工Email及临时密码登录。"}</p>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {!forgotMode && <label>
          密码
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>}
        {msg && <div className="auth-message">{msg}</div>}
        <button className="primary auth-submit" disabled={busy}>
          {busy ? "处理中…" : forgotMode ? "发送重设密码邮件" : "登录系统"}
        </button>
        <button type="button" className="auth-switch" onClick={() => { setForgotMode((v) => !v); setMsg(""); }}>
          {forgotMode ? "← 返回登录" : "Forgot Password?"}
        </button>
        <small className="security-note">
          首次使用请向Management索取临时密码
        </small>
        <small className="security-note">
          Supabase Auth + Row Level Security
        </small>
      </form>
    </div>
  );
}

function System({ profile }: { profile: Profile }) {
  const [view, setView] = useState<View>("dashboard"),
    [viewVersion, setViewVersion] = useState(0),
    [dashboardOrderId, setDashboardOrderId] = useState<string | null>(null),
    [calendarMonth, setCalendarMonth] = useState(() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }),
    [orders, setOrders] = useState<Order[]>([]),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState(""),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 3000);
  };
  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*,profiles!orders_sales_user_id_fkey(full_name)")
      .order("created_at", { ascending: false });
    error ? notify(error.message) : setOrders((data || []) as Order[]);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);
  const menu: Record<Role, [View, string, string][]> = {
    sales: [
      ["dashboard", "▦", "我的 Dashboard"],
      ["orders", "◫", "我的 PI／订单"],
      ["receipt", "▧", "Receipt"],
      ["notifications", "♧", "通知"],
      ["commission", "↗", "我的业绩"],
      ["security", "⌾", "密码设置"],
    ],
    account: [
      ["dashboard", "▦", "Account Dashboard"],
      ["notifications", "♧", "新成单通知"],
      ["account", "✓", "正式开票"],
      ["receipt", "▧", "Receipt"],
      ["orders", "◫", "订单查询"],
      ["security", "⌾", "密码设置"],
    ],
    manager: [
      ["dashboard", "▦", "管理层 Dashboard"],
      ["my-orders", "◫", "我的 Booking"],
      ["orders", "▤", "全部订单"],
      ["receipt", "▧", "Receipt"],
      ["notifications", "♧", "通知中心"],
      ["costing", "◒", "Costing"],
      ["commission", "%", "Commission"],
      ["staff", "◎", "员工权限"],
      ["pi-settings", "⚙", "PI 选项设置"],
      ["customer-base", "♙", "Customer Base"],
      ["security", "⌾", "密码设置"],
    ],
  };
  const go = (next: View) => {
    if (next === "orders" || next === "my-orders") {
      setDashboardOrderId(null);
      setViewVersion((value) => value + 1);
    }
    setView(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const mobileMenu: Record<Role, [View, string, string][]> = {
    sales: [["dashboard", "⌂", "首页"], ["orders", "▤", "订单"], ["new", "＋", "开PI"], ["notifications", "♧", "通知"]],
    account: [["dashboard", "⌂", "首页"], ["notifications", "♧", "通知"], ["account", "✓", "开票"], ["orders", "▤", "查询"]],
    manager: [["dashboard", "⌂", "首页"], ["my-orders", "◫", "我的"], ["orders", "▤", "全部"], ["new", "＋", "开PI"], ["receipt", "▧", "Receipt"]],
  };
  return (
    <div className="shell">
      <aside className={`side${mobileMenuOpen ? " mobile-open" : ""}`}>
        <div className="brand">
          <img src="/happy-express-logo.svg" alt="Happy Express Travel logo" />
          <span>
            <b>HAPPY EXPRESS</b>
            <small>ORDER MANAGEMENT</small>
          </span>
        </div>
        {profile.role !== "account" && (
          <button className="create" onClick={() => go("new")}>
            ＋ 新建 Proforma Invoice
          </button>
        )}
        <p>{profile.role.toUpperCase()} WORKSPACE</p>
        {menu[profile.role].map((m) => (
          <button
            key={m[0]}
            className={view === m[0] ? "nav active" : "nav"}
            onClick={() => go(m[0])}
          >
            <i>{m[1]}</i>
            {m[2]}
          </button>
        ))}
        <div className="profile">
          <i>{profile.full_name.slice(0, 2).toUpperCase()}</i>
          <span>
            <b>{profile.full_name}</b>
            <small>{profile.role}</small>
          </span>
          <button onClick={() => supabase.auth.signOut()}>↪</button>
        </div>
      </aside>
      <main>
        <header className="top">
          <button className="mobile-menu-button" aria-label="打开菜单" onClick={() => setMobileMenuOpen(true)}>☰</button>
          <b>Happy Express Travel</b>
          <div>
            <mark>LIVE DATABASE</mark>
            <span className="role-pill">{profile.role}</span>
            <button onClick={() => supabase.auth.signOut()}>退出</button>
          </div>
        </header>
        <div className="content">
          {loading ? (
            <div className="empty">正在读取资料…</div>
          ) : (
            <>
              {view === "dashboard" && (
                <Dashboard profile={profile} orders={orders} go={go} managerMonth={calendarMonth} setManagerMonth={setCalendarMonth} openOrder={(order) => {
                  setDashboardOrderId(order.id);
                  setViewVersion((value) => value + 1);
                  setView("orders");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }} />
              )}{" "}
              {view === "orders" && (
                <Orders
                  key={`orders-${viewVersion}`}
                  orders={orders}
                  profile={profile}
                  refresh={refresh}
                  notify={notify}
                  scope="all"
                  initialOrderId={dashboardOrderId}
                  onBackToCalendar={() => {
                    setDashboardOrderId(null);
                    setView("dashboard");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}{" "}
              {view === "my-orders" && (
                <Orders
                  key={`my-orders-${viewVersion}`}
                  orders={orders.filter((order) => order.sales_user_id === profile.id)}
                  profile={profile}
                  refresh={refresh}
                  notify={notify}
                  scope="mine"
                />
              )}{" "}
              {view === "new" && (
                <NewPI
                  profile={profile}
                  done={() => {
                    refresh();
                    setView("orders");
                  }}
                  notify={notify}
                />
              )}{" "}
              {view === "notifications" && <Notifications goToOrders={() => go("orders")} />}{" "}
              {view === "account" && (
                <Account
                  orders={orders.filter((o) =>
                    ["awaiting_invoice", "invoiced", "completed"].includes(o.status),
                  )}
                  refresh={refresh}
                  notify={notify}
                />
              )}{" "}
              {view === "costing" && (
                <Costing orders={orders} refresh={refresh} notify={notify} />
              )}{" "}
              {view === "commission" && (
                <Commission orders={orders} profile={profile} />
              )}{" "}
              {view === "staff" && <Staff profile={profile} notify={notify} />}
              {view === "pi-settings" && <PiSettings notify={notify} />}
              {view === "customer-base" && <CustomerBase orders={orders} />}
              {view === "receipt" && <StandaloneReceipts profile={profile} notify={notify} />}
              {view === "security" && <SecuritySettings profile={profile} />}
            </>
          )}
        </div>
      </main>
      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="关闭菜单" onClick={() => setMobileMenuOpen(false)} />}
      <nav className="mobile-tabs" aria-label="手机快捷导航">
        {mobileMenu[profile.role].map((item) => (
          <button key={item[0]} className={view === item[0] ? "active" : ""} onClick={() => go(item[0])}>
            <i>{item[1]}</i><span>{item[2]}</span>
          </button>
        ))}
      </nav>
      {toast && <div className="toast">✓　{toast}</div>}
    </div>
  );
}
function Head({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {children}
    </div>
  );
}
function Kpi({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="kpi">
      <span>
        {label}
        <i>↗</i>
      </span>
      <b>{value}</b>
      <small>{note}</small>
    </article>
  );
}
function Dashboard({
  profile,
  orders,
  go,
  openOrder,
  managerMonth,
  setManagerMonth,
}: {
  profile: Profile;
  orders: Order[];
  go: (v: View) => void;
  openOrder: (order: Order) => void;
  managerMonth: Date;
  setManagerMonth: React.Dispatch<React.SetStateAction<Date>>;
}) {
  const [dashboardNotifications, setDashboardNotifications] = useState<any[]>([]);
  const [calendarColors, setCalendarColors] = useState<CalendarColorSetting[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(4),
      supabase.from("calendar_color_settings").select("setting_key,label,color"),
    ]).then(([notices, colors]) => {
      setDashboardNotifications(notices.data || []);
      setCalendarColors((colors.data || []) as CalendarColorSetting[]);
    });
  }, []);
  const done = orders.filter(
      (o) => !["draft", "on_hold", "cancelled"].includes(o.status),
    ),
    sales = done.reduce((s, o) => s + Number(o.total_amount), 0),
    profit = done.reduce((s, o) => s + Number(o.actual_profit), 0);
  if (profile.role !== "account") {
    const year = managerMonth.getFullYear();
    const month = managerMonth.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const visibleOrders = profile.role === "manager" ? done : done.filter((o) => o.sales_user_id === profile.id);
    const salesMonthOrders = visibleOrders.filter((o) => o.departure_date?.startsWith(monthKey));
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
    const monthOrders = visibleOrders.filter((o) => {
      const end = o.return_date || o.departure_date;
      return Boolean(o.departure_date && o.departure_date <= monthEnd && end && end >= monthStart);
    });
    const monthSales = salesMonthOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const monthProfit = salesMonthOrders.reduce((sum, o) => sum + Number(o.actual_profit), 0);
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calendarDays: Array<number | null> = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
    while (calendarDays.length % 7) calendarDays.push(null);
    const calendarWeeks = Array.from({ length: calendarDays.length / 7 }, (_, index) => calendarDays.slice(index * 7, index * 7 + 7));
    const today = new Date();
    const changeMonth = (offset: number) =>
      setManagerMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    return (
      <>
        <Head
          eyebrow={profile.role === "manager" ? "MANAGER" : "SALES"}
          title={`早安，${profile.full_name}`}
          sub={profile.role === "manager" ? "查看每月 Sales、Profit 与团队出发安排。" : "查看你自己的每月 Sales、Profit 与出发安排。"}
        >
          <button className="primary" onClick={() => go("new")}>＋ 新建 PI</button>
        </Head>
        <div className="manager-month-kpis">
          <Kpi label={`${year}年${month + 1}月 Sales`} value={money(monthSales)} note={`${salesMonthOrders.length} 个已确认 Booking`} />
          <Kpi label={`${year}年${month + 1}月 Profit`} value={money(monthProfit)} note="Sales - Costing" />
        </div>
        <section className="panel dashboard-notifications">
          <div className="panel-head"><span><h2>最新通知</h2><small>Invoice完成与需要处理的事项</small></span><button className="secondary" onClick={() => go("notifications")}>查看全部</button></div>
          {dashboardNotifications.length ? <div className="dashboard-notification-list">{dashboardNotifications.map((notice) => (
            <button key={notice.id} className={notice.read_at ? "" : "unread"} onClick={() => {
              const relatedOrder = notice.order_id ? orders.find((order) => order.id === notice.order_id) : null;
              if (relatedOrder) openOrder(relatedOrder); else go("notifications");
            }}>
              <i>{notice.kind === "invoice_ready" ? "IV" : notice.kind === "bank_slip_rejected" ? "!" : "●"}</i>
              <span><b>{notice.title}</b><small>{notice.message}</small></span>
              <time>{new Date(notice.created_at).toLocaleDateString("en-MY")}</time>
            </button>
          ))}</div> : <div className="empty compact-empty">暂时没有新通知</div>}
        </section>
        <section className="panel manager-calendar-panel">
          <div className="manager-calendar-head">
            <span><h2>{year}年 {month + 1}月 Calendar</h2><small>{profile.role === "manager" ? "查看每天出发的 Sales、Booking Person 与 Tour" : "只显示你自己的 Booking；点击可查看订单详情"}</small></span>
            <div className="calendar-nav">
              <button className="secondary" onClick={() => changeMonth(-1)}>← 上个月</button>
              <button className="secondary" onClick={() => setManagerMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>本月</button>
              <button className="secondary" onClick={() => changeMonth(1)}>下个月 →</button>
            </div>
          </div>
          <div className="manager-calendar-scroll">
            <div className="manager-calendar">
              <div className="calendar-weekdays">{["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => <b className="calendar-weekday" key={day}>{day}</b>)}</div>
              {calendarWeeks.map((week, weekIndex) => {
                const weekDates = week.map((day) => day ? `${monthKey}-${String(day).padStart(2, "0")}` : "");
                const positioned = monthOrders.map((order) => {
                  const end = order.return_date || order.departure_date;
                  const startColumn = weekDates.findIndex((date) => Boolean(date && order.departure_date <= date && end >= date));
                  let endColumn = -1;
                  weekDates.forEach((date, column) => { if (date && order.departure_date <= date && end >= date) endColumn = column; });
                  return { order, startColumn, endColumn };
                }).filter((event) => event.startColumn >= 0).sort((a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn);
                const laneEnds: number[] = [];
                const events = positioned.map((event) => {
                  let lane = laneEnds.findIndex((endColumn) => endColumn < event.startColumn);
                  if (lane < 0) lane = laneEnds.length;
                  laneEnds[lane] = event.endColumn;
                  return { ...event, lane };
                });
                return <div className="calendar-week" key={weekIndex} style={{ gridTemplateRows: `46px repeat(${Math.max(laneEnds.length, 1)}, 27px) minmax(24px, 1fr)` }}>
                  {week.map((day, column) => {
                    const isToday = day && year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                    return <div key={`${weekIndex}-${column}`} className={`calendar-day${day ? "" : " empty-day"}${isToday ? " today" : ""}`} style={{ gridColumn: column + 1, gridRow: `1 / span ${Math.max(laneEnds.length, 1) + 2}` }}>
                      {day && <span className="calendar-date">{day}</span>}
                    </div>;
                  })}
                  {events.map(({ order, startColumn, endColumn, lane }) => {
                    const key = order.resort_name ? `resort:${order.resort_name}` : order.tour_name ? `route:${order.tour_name}` : `series:${order.trip_category || "custom"}`;
                    const configuredColor = calendarColors.find((setting) => setting.setting_key === key)?.color;
                    const eventColor = configuredColor || "#8B929A";
                    return <button key={order.id} type="button" className="calendar-booking" style={{ gridColumn: `${startColumn + 1} / ${endColumn + 2}`, gridRow: lane + 2, backgroundColor: eventColor }} onClick={() => openOrder(order)} title={`查看 ${order.customer_name} 的订单`}>
                      <span>{order.trip_name || order.package_name || "Tour"} · {order.customer_name}</span>
                    </button>;
                  })}
                </div>;
              })}
            </div>
          </div>
        </section>
      </>
    );
  }
  return (
    <>
      <Head
        eyebrow={profile.role.toUpperCase()}
        title={`早安，${profile.full_name}`}
        sub="审核Bank Slip并上传正式Invoice。"
      />
      <div className="kpis">
        <Kpi
          label="On Hold"
          value={String(orders.filter((o) => o.status === "on_hold").length)}
          note="未计入成交"
        />
        <Kpi
          label="已确认 Sales"
          value={money(sales)}
          note={`${done.length} 个成单`}
        />
        <Kpi
          label="Actual Profit"
          value={money(profit)}
          note="Sales - Costing"
        />
        <Kpi
          label="待正式开票"
          value={String(orders.filter((o) => o.status === "awaiting_invoice").length)}
          note="已收到Bank Slip"
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <span>
            <h2>近期订单</h2>
            <small>真实数据库资料</small>
          </span>
        </div>
        <Table orders={orders.slice(0, 6)} />
      </section>
    </>
  );
}
function Table({
  orders,
  action,
  onTourOpen,
}: {
  orders: Order[];
  action?: (o: Order) => React.ReactNode;
  onTourOpen?: (o: Order) => void;
}) {
  const orderMoney = (order: Order, amount: number | string) =>
    `${order.currency || "MYR"} ${Number(amount || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
  return (
    <div className="table">
      <table>
        <thead>
          <tr>
            <th>PI／团队号</th>
            <th>Booking Person／行程</th>
            <th>出发</th>
            <th>Sales</th>
            <th>金额／收款</th>
            <th>状态</th>
            {action && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {orders.length ? (
            orders.map((o) => (
              <tr
                key={o.id}
                className={onTourOpen ? "clickable-order-row" : ""}
                onClick={onTourOpen ? () => onTourOpen(o) : undefined}
              >
                <td data-label="Tour Code / PI">
                  <b className="team">{o.team_number || "尚未生成"}</b>
                  <small>{o.pi_number}</small>
                </td>
                <td data-label="Booking Person / Trip">
                  <b>{o.customer_name}</b>
                  <small>
                    {o.trip_name} · {Number(o.adult_count || 0) + Number(o.child_count || 0) + Number(o.infant_count || 0)} pax
                  </small>
                </td>
                <td data-label="Departure">{displayDate(o.departure_date)}</td>
                <td data-label="Sales">{o.profiles?.full_name || "—"}</td>
                <td data-label="Amount / Paid">
                  <b>{orderMoney(o, o.total_amount)}</b>
                  <small>已收 {orderMoney(o, o.paid_amount)}</small>
                </td>
                <td data-label="Status">
                  <mark
                    className={
                      o.status === "on_hold"
                        ? "amber"
                        : o.status === "invoiced"
                          ? "green"
                          : "blue"
                    }
                  >
                    {labels[o.status] || o.status}
                  </mark>
                </td>
                {action && <td data-label="Actions">{action(o)}</td>}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7}>
                <div className="empty">暂时没有订单</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function StandaloneReceipts({ profile, notify }: { profile: Profile; notify: (s: string) => void }) {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const emptyForm = () => ({ received_from: "", receipt_date: new Date().toISOString().slice(0,10), currency: "MYR", amount: "", payment_method: "Bank Transfer", reference_no: "", tour_code: "", description: "Travel payment", notes: "" });
  function startEdit(r: any) {
    setSelected(null); setEditingId(r.id);
    setForm({ received_from:r.received_from || "", receipt_date:r.receipt_date || "", currency:r.currency || "MYR", amount:String(r.amount), payment_method:r.payment_method || "", reference_no:r.reference_no || "", tour_code:r.tour_code || "", description:r.description || "", notes:r.notes || "" });
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function cancelEdit() { setEditingId(null); setForm(emptyForm()); }
  const filtered = receipts.filter(r => {
    const term = search.trim().toLowerCase();
    return (!month || String(r.receipt_date).startsWith(month)) &&
      (!term || [r.receipt_number,r.received_from,r.tour_code,r.reference_no,r.description].some(v=>String(v||"").toLowerCase().includes(term)));
  });
  const pages = Math.max(1,Math.ceil(filtered.length/pageSize));
  const currentPage = Math.min(page,pages);
  const visible = filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const receiptRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ received_from: "", receipt_date: new Date().toISOString().slice(0,10), currency: "MYR", amount: "", payment_method: "Bank Transfer", reference_no: "", tour_code: "", description: "Travel payment", notes: "" });
  async function loadReceipts() {
    setLoading(true);
    const { data, error } = await supabase.from("standalone_receipts").select("*").eq("created_by",profile.id).order("created_at",{ascending:false});
    if (error) notify(error.message); else setReceipts(data || []);
    setLoading(false);
  }
  useEffect(()=>{ loadReceipts(); },[]);
  const update=(key:string,value:string)=>setForm(old=>({...old,[key]:value}));
  async function createReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!form.received_from.trim() || !form.description.trim() || Number(form.amount)<=0) { notify("Please complete Received From, Description and Amount"); return; }
    setSaving(true);
    const payload = {
      received_from: form.received_from.trim(), receipt_date: form.receipt_date, currency: form.currency, amount: Number(form.amount),
      payment_method: form.payment_method.trim() || null, reference_no: form.reference_no.trim() || null, tour_code: form.tour_code.trim() || null,
      description: form.description.trim(), notes: form.notes.trim() || null
    };
    const { data, error } = editingId
      ? await supabase.from("standalone_receipts").update(payload).eq("id",editingId).select().single()
      : await supabase.from("standalone_receipts").insert({...payload,created_by:profile.id}).select().single();
    setSaving(false);
    if (error) { notify(error.message); return; }
    notify(`Receipt ${data.receipt_number} ${editingId ? "updated" : "created"}`);
    setForm(old=>({...old,received_from:"",amount:"",reference_no:"",tour_code:"",description:"Travel payment",notes:""}));
    setEditingId(null); setSelected(data); loadReceipts();
  }
  const money=(r:any)=>`${r.currency} ${Number(r.amount||0).toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  async function downloadStandaloneReceipt() {
    if (!receiptRef.current || !selected) return;
    setPdfBusy(true);
    try {
      const [{default:html2canvas},{jsPDF}] = await Promise.all([import("html2canvas"),import("jspdf")]);
      const capture=receiptRef.current.cloneNode(true) as HTMLDivElement;
      capture.querySelectorAll(".pdf-ignore").forEach(node=>node.remove());
      capture.style.position="fixed"; capture.style.left="-10000px"; capture.style.top="0"; capture.style.width="794px"; capture.style.maxWidth="794px"; capture.style.background="#fff";
      document.body.appendChild(capture);
      const canvas=await html2canvas(capture,{scale:2,backgroundColor:"#ffffff",useCORS:true}); capture.remove();
      const pdf=new jsPDF("p","mm","a4"), width=190, height=(canvas.height*width)/canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg",0.96),"JPEG",10,10,width,Math.min(height,277));
      const safe=String(selected.received_from).replace(/[\\/:*?"<>|]/g,"-");
      pdf.save(`${selected.receipt_number} - ${safe}.pdf`);
    } finally { setPdfBusy(false); }
  }
  if (selected) return <div className="modal-back receipt-viewer"><div className="modal receipt-document" ref={receiptRef}>
    <button className="modal-x pdf-ignore" onClick={()=>setSelected(null)}>×</button>
    <div className="receipt-brand"><img src={DOCUMENT_LOGO_PNG} alt="Happy Express Travel"/><span><b>HAPPY EXPRESS TRAVEL SDN BHD</b><small>[2014401022292] (1098378-X)</small><small>14-01, JALAN ROSMERAH 2/13, TAMAN JOHOR JAYA 81100, JOHOR BAHRU, JOHOR.</small></span></div>
    <h1>OFFICIAL RECEIPT</h1>
    <div className="receipt-number"><b>Receipt No.</b><span>{selected.receipt_number}</span><b>Date</b><span>{selected.receipt_date}</span></div>
    <div className="receipt-lines"><span>Received From<b>{selected.received_from}</b></span>{selected.tour_code && <span>Tour Code<b>{selected.tour_code}</b></span>}<strong>Amount Received<b>{money(selected)}</b></strong></div>
    <section className="receipt-travel-details"><h3>PAYMENT DETAILS</h3><div><span><small>Description</small><b>{selected.description}</b></span><span><small>Payment Method</small><b>{selected.payment_method || "—"}</b></span></div></section>
    <div className="receipt-payment-summary"><span><small>Reference No.</small><b>{selected.reference_no || "—"}</b></span><span><small>Amount Paid</small><b>{money(selected)}</b></span></div>
    {selected.notes && <p><b>Remarks:</b> {selected.notes}</p>}<p>Payment received with thanks.</p><div className="receipt-sign">Prepared by Happy Express Travel Sdn Bhd</div>
    <div className="modal-actions pdf-ignore"><button className="secondary" onClick={()=>setSelected(null)}>Back</button><button className="secondary" onClick={()=>startEdit(selected)}>Edit Receipt</button><button className="primary" disabled={pdfBusy} onClick={downloadStandaloneReceipt}>{pdfBusy?"Generating PDF…":"Download Receipt PDF"}</button></div>
  </div></div>;
  return <>
    <Head eyebrow="DIRECT RECEIPT" title="Receipt" sub="无需先开 PI 或 Invoice，可直接开收据。" />
    <section className="panel"><div className="panel-head"><span><h2>{editingId ? "Edit Receipt" : "New Receipt"}</h2><small>{editingId ? "Edit saved receipt · receipt number stays unchanged" : "Direct receipt entry"}</small></span>{editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel Edit</button>}</div>
      <form onSubmit={createReceipt} className="fields" style={{padding:22}}>
        <label>Received From *<input value={form.received_from} onChange={e=>update("received_from",e.target.value)} placeholder="Customer / Company name"/></label>
        <label>Receipt Date *<input type="date" value={form.receipt_date} onChange={e=>update("receipt_date",e.target.value)}/></label>
        <label>Currency<select value={form.currency} onChange={e=>update("currency",e.target.value)}><option>MYR</option><option>SGD</option></select></label>
        <label>Amount *<input type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>update("amount",e.target.value)} placeholder="0.00"/></label>
        <label>Payment Method<input value={form.payment_method} onChange={e=>update("payment_method",e.target.value)}/></label>
        <label>Reference No.<input value={form.reference_no} onChange={e=>update("reference_no",e.target.value)}/></label>
        <label>Tour Code (Optional)<input value={form.tour_code} onChange={e=>update("tour_code",e.target.value)} placeholder="Can be left blank"/></label>
        <label className="wide">Description *<textarea value={form.description} onChange={e=>update("description",e.target.value)}/></label>
        <label className="wide">Remarks<textarea value={form.notes} onChange={e=>update("notes",e.target.value)}/></label>
        <div className="wide"><button className="primary" disabled={saving} type="submit">{saving?"Saving…":editingId?"Save Changes":"Create Receipt"}</button></div>
      </form>
    </section>
    <section className="panel" style={{marginTop:24}}>
      <div className="panel-head"><span><h2>Receipt Management</h2><small>Search, filter, view and edit saved receipts</small></span><b>{filtered.length} Receipts</b></div>
      <div style={{padding:22}}>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
          <input aria-label="Search receipts" placeholder="Search Receipt No., Customer, Tour Code, Reference..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{flex:"1 1 320px",padding:12,border:"1px solid #d7e0e6",borderRadius:9}}/>
          <input aria-label="Filter month" type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}} style={{padding:12,border:"1px solid #d7e0e6",borderRadius:9}}/>
          <button type="button" className="secondary" onClick={()=>{setSearch("");setMonth("");setPage(1);}}>Clear</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:700,textAlign:"left"}}>
            <thead><tr style={{borderBottom:"2px solid #dce4e9"}}>
              {["Receipt No.","Date","Received From","Tour Code","Amount","Actions"].map(h=><th key={h} style={{padding:"12px 10px",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{loading?<tr><td colSpan={6} style={{padding:18}}>Loading…</td></tr>:visible.length?visible.map(r=><tr key={r.id} style={{borderBottom:"1px solid #e5ebef"}}>
              <td style={{padding:"14px 10px",fontWeight:700,whiteSpace:"nowrap"}}>{r.receipt_number}</td>
              <td style={{padding:"14px 10px",whiteSpace:"nowrap"}}>{r.receipt_date}</td>
              <td style={{padding:"14px 10px"}}>{r.received_from}</td>
              <td style={{padding:"14px 10px"}}>{r.tour_code || "—"}</td>
              <td style={{padding:"14px 10px",whiteSpace:"nowrap"}}>{money(r)}</td>
              <td style={{padding:"14px 10px",whiteSpace:"nowrap"}}><button type="button" className="row-action" onClick={()=>setSelected(r)}>View / PDF</button>{" "}<button type="button" className="row-action" onClick={()=>startEdit(r)}>Edit</button></td>
            </tr>):<tr><td colSpan={6} style={{padding:18}}>No matching receipts.</td></tr>}</tbody>
          </table>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginTop:18}}>
          <small>Showing {filtered.length?((currentPage-1)*pageSize+1):0}–{Math.min(currentPage*pageSize,filtered.length)} of {filtered.length}</small>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button type="button" className="secondary" disabled={currentPage===1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
            <span>Page {currentPage} / {pages}</span>
            <button type="button" className="secondary" disabled={currentPage===pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Next</button>
          </div>
        </div>
      </div>
    </section>
  </>;
}

function Orders({
  orders,
  profile,
  refresh,
  notify,
  scope = "all",
  initialOrderId = null,
  onBackToCalendar,
}: {
  orders: Order[];
  profile: Profile;
  refresh: () => void;
  notify: (s: string) => void;
  scope?: "all" | "mine";
  initialOrderId?: string | null;
  onBackToCalendar?: () => void;
}) {
  const [chosen, setChosen] = useState<Order | null>(null),
    [previewOrder, setPreviewOrder] = useState<Order | null>(null),
    [editOrder, setEditOrder] = useState<Order | null>(null),
    [selectedTour, setSelectedTour] = useState<Order[] | null>(null),
    [selectedBooking, setSelectedBooking] = useState<Order | null>(null),
    [listStatus, setListStatus] = useState<"on_hold" | "processing" | "completed">("on_hold"),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (!initialOrderId) return;
    const target = orders.find((order) => order.id === initialOrderId);
    if (!target) return;
    const bookings = (target.team_number ? orders.filter((order) => order.team_number === target.team_number) : [target])
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setSelectedTour(bookings);
    setSelectedBooking(target);
  }, [initialOrderId, orders]);
  async function cancelOrder(order: Order) {
    const reason = window.prompt("Cancellation reason / 顾客取消原因");
    if (!reason) return;
    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelled", cancellation_reason: reason })
      .eq("id", order.id);
    if (error) notify(error.message);
    else {
      notify("PI已标记为Cancelled，记录会保留给Management分析");
      refresh();
    }
  }
  const orderActions = (o: Order) => (
    <div className="staff-actions">
      <button className="row-action" onClick={() => setPreviewOrder(o)}>Preview PI</button>
      {profile.role !== "account" && o.status !== "cancelled" && <button className="row-action" onClick={() => setEditOrder(o)}>Edit / Amendment</button>}
      {o.sales_user_id === profile.id && o.status !== "cancelled" && Number(o.paid_amount) < Number(o.total_amount) && <button className="text-action" onClick={() => setChosen(o)}>Upload Bank Slip</button>}
      {profile.role !== "account" && o.status === "on_hold" && <button className="danger-action" onClick={() => cancelOrder(o)}>Cancel</button>}
    </div>
  );
  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    const statusFiltered = orders.filter((o) =>
      listStatus === "on_hold"
        ? o.status === "on_hold"
        : listStatus === "processing"
          ? ["awaiting_invoice", "invoiced"].includes(o.status)
          : ["completed", "cancelled"].includes(o.status),
    );
    return !query
      ? statusFiltered
      : statusFiltered.filter((o) =>
          [o.team_number, o.pi_number, o.customer_name, o.phone, o.trip_name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        );
  }, [orders, search, listStatus]);
  const tourGroups = useMemo(() => {
    const groups = new Map<string, Order[]>();
    filteredOrders.forEach((order) => {
      const key = order.team_number || `PI:${order.pi_number}`;
      groups.set(key, [...(groups.get(key) || []), order]);
    });
    return [...groups.entries()].map(([key, bookings]) => ({
      key,
      bookings: [...bookings].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    }));
  }, [filteredOrders]);
  const openTourPage = (bookings: Order[]) => {
    setSelectedTour(bookings);
    setSelectedBooking(bookings[0]);
  };
  return (
    <>
      {selectedTour ? (
        <>
          <div className="tour-page-heading">
            <button className="secondary floating-back-button" onClick={() => {
              if (initialOrderId && onBackToCalendar) onBackToCalendar();
              else { setSelectedTour(null); setSelectedBooking(null); }
            }}>← {initialOrderId && onBackToCalendar ? "返回 Calendar" : scope === "mine" ? "返回我的 Booking" : "返回全部订单"}</button>
            <Head
              eyebrow="INDIVIDUAL ORDER DETAILS"
              title={selectedTour[0].customer_name}
              sub={`${selectedBooking?.team_number || "Tour Code Pending"} · ${selectedBooking?.pi_number || ""} · ${selectedBooking?.trip_name || ""}`}
            />
          </div>
          <section className="panel pi-selector-panel">
            <div className="panel-head"><span><h2>PI under this Tour Code</h2><small>选择 Booking Person 查看个别 PI 详情</small></span><b>{selectedTour.length} PI</b></div>
            <div className="booking-person-tabs">
              {selectedTour.map((o) => (
                <button key={o.id} className={selectedBooking?.id === o.id ? "active" : ""} onClick={() => setSelectedBooking(o)}>
                  <b>{o.customer_name}</b>
                  <small>{o.pi_number} · {o.currency} {Number(o.total_amount).toFixed(2)}</small>
                </button>
              ))}
            </div>
          </section>
          {selectedBooking && (
            <>
              <div className="individual-order-kpis">
                <span><small>PI Total</small><b>{selectedBooking.currency} {Number(selectedBooking.total_amount).toLocaleString("en-MY",{minimumFractionDigits:2})}</b></span>
                <span><small>Internal Tour Code</small><b>{selectedBooking.team_number || "Pending"}</b></span>
                <span><small>Status</small><mark className={selectedBooking.status === "on_hold" ? "amber" : selectedBooking.status === "completed" ? "green" : "blue"}>{labels[selectedBooking.status] || selectedBooking.status}</mark></span>
                <span><small>Pax</small><b>{Number(selectedBooking.adult_count||0)+Number(selectedBooking.child_count||0)+Number(selectedBooking.infant_count||0)}</b></span>
              </div>
              <section className="panel individual-contact-card">
                <h3>Billing & Contact</h3>
                <div>
                  <span><small>Booking Person</small><b>{selectedBooking.customer_name}</b></span>
                  <span><small>Phone</small><b>{selectedBooking.phone || "—"}</b></span>
                  <span><small>Email</small><b>{selectedBooking.email || "—"}</b></span>
                  <span><small>Billing Address</small><b>{selectedBooking.billing_address || "—"}</b></span>
                </div>
              </section>
              <div className="booking-page-actions">{orderActions(selectedBooking)}</div>
              <PIHistoryPreview
                key={selectedBooking.id}
                order={selectedBooking}
                profile={profile}
                notify={notify}
                changed={refresh}
                close={() => undefined}
                pageMode
              />
            </>
          )}
        </>
      ) : (
        <>
          <Head
            eyebrow="PI & ORDER MANAGEMENT"
            title={profile.role === "sales" || scope === "mine" ? "我的 Booking" : "全部订单"}
            sub="PI先On Hold；收到款和Bank Slip后才确认成单。"
          />
          <div className="order-status-tabs">
            <button className={listStatus==="on_hold"?"active":""} onClick={()=>setListStatus("on_hold")}><b>On Hold</b><small>{orders.filter(o=>o.status==="on_hold").length}</small></button>
            <button className={listStatus==="processing"?"active":""} onClick={()=>setListStatus("processing")}><b>已确认 · 待完成</b><small>{orders.filter(o=>["awaiting_invoice","invoiced"].includes(o.status)).length}</small></button>
            <button className={listStatus==="completed"?"active":""} onClick={()=>setListStatus("completed")}><b>已完成</b><small>{orders.filter(o=>["completed","cancelled"].includes(o.status)).length}</small></button>
          </div>
          <div className="order-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Tour Code, PI No., Booking Person or phone..."
            />
            <b>{tourGroups.length} Tour Codes</b>
          </div>
          <section className="panel orders-list-table">
            <div className="table">
              <table>
                <thead><tr><th>Tour Code</th><th>Booking Person</th><th>行程 / PI</th><th>出发</th><th>Sales</th><th>金额 / 收款</th></tr></thead>
                <tbody>
                  {tourGroups.length ? tourGroups.map(({key,bookings}) => {
                    const lead=bookings[0], total=bookings.reduce((s,o)=>s+Number(o.total_amount),0), paid=bookings.reduce((s,o)=>s+Number(o.paid_amount),0);
                    const names=[...new Set(bookings.map(o=>o.customer_name))];
                    const pax=bookings.reduce((s,o)=>s+Number(o.adult_count||0)+Number(o.child_count||0)+Number(o.infant_count||0),0);
                    const sales=[...new Set(bookings.map(o=>o.profiles?.full_name||"—"))];
                    return <tr key={key} className="clickable-order-row" onClick={()=>openTourPage(bookings)}>
                      <td data-label="Tour Code"><b className="team">{lead.team_number||lead.pi_number}</b><small>{bookings.length} PI</small></td>
                      <td data-label="Booking Person"><b>{names.slice(0,2).join(" · ")}</b>{names.length>2&&<small>+{names.length-2} more</small>}</td>
                      <td data-label="Trip / PI"><b>{lead.trip_name}</b><small>{bookings.length} PI · {pax} pax</small></td>
                      <td data-label="Departure">{displayDate(lead.departure_date)}</td>
                      <td data-label="Sales">{sales.join(" · ")}</td>
                      <td data-label="Amount / Paid"><b>{lead.currency} {total.toLocaleString("en-MY",{minimumFractionDigits:2})}</b><small>已收 {lead.currency} {paid.toLocaleString("en-MY",{minimumFractionDigits:2})}</small></td>
                    </tr>;
                  }) : <tr><td colSpan={6}><div className="empty">暂时没有订单</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {previewOrder && (
        <PIHistoryPreview
          order={previewOrder}
          profile={profile}
          notify={notify}
          changed={refresh}
          close={() => setPreviewOrder(null)}
        />
      )}
      {editOrder && (
        <EditPI
          order={editOrder}
          close={() => setEditOrder(null)}
          done={() => {
            setEditOrder(null);
            refresh();
          }}
          notify={notify}
        />
      )}
      {chosen && (
        <Booking
          order={chosen}
          close={() => setChosen(null)}
          done={() => {
            setChosen(null);
            refresh();
          }}
          notify={notify}
        />
      )}
    </>
  );
}
function PIHistoryPreview({
  order,
  profile,
  notify,
  changed,
  close,
  pageMode = false,
}: {
  order: Order;
  profile?: Profile;
  notify?: (s: string) => void;
  changed?: () => void;
  close: () => void;
  pageMode?: boolean;
}) {
  const [items, setItems] = useState<any[]>([]),
    [schedules, setSchedules] = useState<any[]>([]),
    [payments, setPayments] = useState<any[]>([]),
    [receipts, setReceipts] = useState<any[]>([]),
    [invoices, setInvoices] = useState<any[]>([]),
    [officialReceipts, setOfficialReceipts] = useState<any[]>([]),
    [documentUrls, setDocumentUrls] = useState<Record<string,string>>({}),
    [selectedReceipt, setSelectedReceipt] = useState<any | null>(null),
    [receiptBusy, setReceiptBusy] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null),
    receiptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.all([
      supabase
        .from("order_items")
        .select("*")
        .eq("order_id", order.id)
        .order("sort_order"),
      supabase
        .from("payment_schedules")
        .select("*")
        .eq("order_id", order.id)
        .order("sort_order"),
      supabase
        .from("payments")
        .select("*")
        .eq("order_id", order.id)
        .order("payment_date"),
      supabase
        .from("receipts")
        .select("*")
        .eq("order_id", order.id)
        .order("issued_at"),
      supabase.from("invoices").select("*").eq("order_id", order.id).order("created_at"),
      supabase.from("account_official_receipts").select("*").eq("order_id", order.id).order("created_at"),
    ]).then(async ([a, b, c, d, e, f]) => {
      setItems(a.data || []);
      setSchedules(b.data || []);
      setPayments(c.data || []);
      setReceipts(d.data || []);
      setInvoices(e.data || []);
      setOfficialReceipts(f.data || []);
      const entries = await Promise.all([
        ...(e.data || []).map(async (doc:any) => {
          const { data } = await supabase.storage.from("official-invoices").createSignedUrl(doc.file_path,3600);
          return data ? [`invoice:${doc.id}`,data.signedUrl] as const : null;
        }),
        ...(f.data || []).map(async (doc:any) => {
          const { data } = await supabase.storage.from("official-receipts").createSignedUrl(doc.file_path,3600);
          return data ? [`or:${doc.id}`,data.signedUrl] as const : null;
        }),
      ]);
      setDocumentUrls(Object.fromEntries(entries.filter(Boolean) as [string,string][]));
    });
  }, [order.id]);
  async function remindAccount() {
    const { error } = await supabase.rpc("remind_account", { p_order_id: order.id });
    if (error) notify?.(error.message);
    else { notify?.("Urgent reminder已发送，订单已重新置顶"); changed?.(); }
  }
  const fmt = (n: number) =>
    `${order.currency || "MYR"} ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
  const paidFor = (id: string) =>
    payments
      .filter((p) => p.schedule_id === id)
      .reduce((sum, p) => sum + Number(p.amount), 0);
  async function downloadPI() {
    if (!historyRef.current) return;
    await downloadInvoicePdf(
      historyRef.current,
      `${order.pi_number} - ${order.customer_name.replace(/[\\/:*?"<>|]/g, "-")}.pdf`,
    );
  }
  async function downloadReceipt() {
    if (!receiptRef.current || !selectedReceipt) return;
    setReceiptBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const capture = receiptRef.current.cloneNode(true) as HTMLDivElement;
      capture.classList.add("pdf-capture-mode");
      document.body.appendChild(capture);
      await materializeImagesForPdf(capture);
      const canvas = await html2canvas(capture, {
        scale: 2,
        backgroundColor: "#ffffff",
        windowWidth: 1100,
        ignoreElements: (element) => element.classList.contains("pdf-ignore"),
      });
      capture.remove();
      const pdf = new jsPDF("p", "mm", "a4"),
        maxWidth = 190,
        maxHeight = 277,
        scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height),
        width = canvas.width * scale,
        height = canvas.height * scale,
        x = (210 - width) / 2,
        y = (297 - height) / 2;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", x, y, width, height);
      const safeCustomer = order.customer_name.replace(/[\\/:*?"<>|]/g, "-");
      pdf.save(`${selectedReceipt.receipt_number} - ${safeCustomer}.pdf`);
    } finally {
      setReceiptBusy(false);
    }
  }
  if (selectedReceipt) {
    const payment = payments.find((p) => p.id === selectedReceipt.payment_id);
    return (
      <div className="modal-back receipt-viewer">
        <div className="modal receipt-document" ref={receiptRef}>
          <button className="modal-x pdf-ignore" onClick={() => setSelectedReceipt(null)}>
            ×
          </button>
          <div className="receipt-brand">
            <img src={DOCUMENT_LOGO_PNG} alt="Happy Express Travel" />
            <span>
              <b>HAPPY EXPRESS TRAVEL SDN BHD</b>
              <small>[2014401022292] (1098378-X)</small>
              <small>
                14-01, JALAN ROSMERAH 2/13, TAMAN JOHOR JAYA 81100, JOHOR BAHRU,
                JOHOR.
              </small>
            </span>
          </div>
          <h1>OFFICIAL RECEIPT</h1>
          <div className="receipt-number">
            <b>Receipt No.</b>
            <span>{selectedReceipt.receipt_number}</span>
            <b>Date</b>
            <span>{payment?.payment_date}</span>
          </div>
          <div className="receipt-lines">
            <span>
              Received From<b>{order.customer_name}</b>
            </span>
            <span>
              Proforma Invoice No.<b>{order.pi_number}</b>
            </span>
            <strong>
              Amount Received<b>{fmt(payment?.amount || 0)}</b>
            </strong>
          </div>
          <section className="receipt-travel-details">
            <h3>TRAVEL / PACKAGE DETAILS</h3>
            <div><span><small>Travel Date</small><b>{displayDate(order.departure_date)}{order.return_date ? ` — ${displayDate(order.return_date)}` : ""}</b></span><span><small>Package</small><b>{order.trip_name || order.package_name}</b></span></div>
          </section>
          <table className="receipt-item-table"><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
            {items.map((item)=><tr key={item.id}><td>{item.item_type}</td><td className="preserve-space">{renderMultilineText(item.description)}</td><td>{item.quantity}</td><td>{fmt(item.line_total || Number(item.quantity)*Number(item.unit_price))}</td></tr>)}
          </tbody></table>
          <div className="receipt-payment-summary">
            <span><small>Payment Stage</small><b>{schedules.find((s)=>s.id===payment?.schedule_id)?.stage_name || "Payment"}</b></span>
            <span><small>Total Paid</small><b>{fmt(order.paid_amount)}</b></span>
            <span><small>Remaining Balance</small><b>{fmt(Math.max(0,Number(order.total_amount)-Number(order.paid_amount)))}</b></span>
          </div>
          <p>Payment received with thanks.</p>
          <div className="receipt-sign">
            Prepared by Happy Express Travel Sdn Bhd
          </div>
          <div className="modal-actions pdf-ignore">
            <button
              className="secondary"
              onClick={() => setSelectedReceipt(null)}
            >
              Back
            </button>
            <button className="primary" disabled={receiptBusy} onClick={downloadReceipt}>
              {receiptBusy ? "Generating PDF…" : "Download Receipt PDF"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={pageMode ? "booking-detail-page" : "modal-back"}>
      <div className={pageMode ? "booking-detail-content" : "modal wide-modal"}>
        {!pageMode && <button className="modal-x pdf-ignore" onClick={close}>
          ×
        </button>}
        <div className="customer-pi-offscreen invoice-preview pdf-capture-mode" ref={historyRef}>
          <div className="pi-head">
            <img
              src={DOCUMENT_LOGO_PNG}
              alt="Happy Express Travel logo"
            />
            <span>
              <b>HAPPY EXPRESS TRAVEL SDN BHD</b>
              <small>[2014401022292] (1098378-X)</small>
              <small>
                14-01, JALAN ROSMERAH 2/13, TAMAN JOHOR JAYA 81100, JOHOR BAHRU,
                JOHOR.
              </small>
              <small>HOTLINE: +6012-538 2254 / +07-288 6639</small>
            </span>
            <h2>
              PROFORMA
              <br />
              INVOICE
            </h2>
          </div>
          <div className="pi-meta">
            <b>Proforma Invoice No:</b>
            <span>{order.pi_number}</span>
          </div>
          <div className="bill">
            <span>
              <small>BILL TO</small>
              <b>{order.customer_name}</b>
              {order.phone && <small>{order.phone}</small>}
              {order.email && <small>{order.email}</small>}
              {order.billing_address && (
                <small className="billing-copy">{order.billing_address}</small>
              )}
              {order.customer_type === "company" && (
                <>
                  <small>
                    Registration No. (NEW):{" "}
                    {order.company_registration_new || "Pending"}
                  </small>
                  {order.company_registration_old && (
                    <small>
                      Registration No. (OLD): {order.company_registration_old}
                    </small>
                  )}
                  <small>
                    TIN: {order.tax_identification_number || "Pending"}
                  </small>
                  {order.sst_number && <small>SST: {order.sst_number}</small>}
                  <small>MSIC: {order.msic_code || "Pending"}</small>
                  {order.business_activity && (
                    <small>Business Activity: {order.business_activity}</small>
                  )}
                </>
              )}
            </span>
            <span>
              <small>TRAVEL DETAILS</small>
              <b className="preserve-space">{order.trip_name || order.package_name}</b>
              <small className="travel-date-line"><b>Travel Date:</b> {displayDate(order.departure_date)}{order.return_date ? ` — ${displayDate(order.return_date)}` : ""}</small>
            </span>
          </div>
          <table className="pi-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.item_type}</td>
                  <td className="preserve-space">{renderMultilineText(i.description)}</td>
                  <td>{i.quantity}</td>
                  <td>{fmt(i.unit_price)}</td>
                  <td>{fmt(i.line_total || i.quantity * i.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="total">
            <strong>
              Total <b>{fmt(order.total_amount)}</b>
            </strong>
          </div>
          {schedules.length > 0 && <section className="pi-payment-schedule">
            <h3>PAYMENT SCHEDULE</h3>
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Due Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                    const paid = paidFor(s.id);
                    return (
                      <tr key={s.id}>
                        <td>{s.stage_name}</td>
                        <td>{fmt(s.amount)}</td>
                        <td>{s.due_date || "—"}</td>
                        <td>
                          {paid >= Number(s.amount) ? "PAID" : "OUTSTANDING"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>}
          <section className="pi-bank">
            <div>
              <h3>PAYMENT METHOD</h3>
              {(order.currency || "MYR") === "MYR" ? (
                <>
                  <p>
                    <b>Bank Name:</b> Public Bank Berhad
                  </p>
                  <p>
                    <b>Beneficiary Name:</b> Happy Express Travel Sdn. Bhd.
                  </p>
                  <p>
                    <b>Bank Account:</b> 319 154 1222
                  </p>
                  <p>
                    <b>Bank Address:</b> 17-19, Jalan Molek, 1/5A Taman Molek,
                    81100, Johor Bahru, Johor.
                  </p>
                  <p>
                    <b>Swift Code:</b> PBBEMYKL
                  </p>
                  <p>
                    <b>Business Registration Number:</b> 1098378-X
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <b>Bank Name:</b> Maybank Singapore Limited
                  </p>
                  <p>
                    <b>Beneficiary Name:</b> Happy Express Travel Sdn. Bhd.
                  </p>
                  <p>
                    <b>Bank Account:</b> 0407 1092 493
                  </p>
                  <p>
                    <b>Swift Code:</b> MBBESGS2
                  </p>
                </>
              )}
            </div>
            {(order.currency || "MYR") === "MYR" && (
              <img src={DUITNOW_QR_PNG} alt="DuitNow QR payment" />
            )}
          </section>
          <div className="pdf-keep-together">
            <section className="pi-terms">
              <h3>TERMS & CONDITIONS</h3>
              <p>
                • Happy Express Travel Sdn. Bhd. does not issue refunds or allow
                cancellations once a booking is confirmed.
              </p>
              <p>
                • No refund will be made with respect to accommodation, meals,
                sightseeing tours or any other services included in the tour fare
                but not utilised by the customer, either in part or in full, or
                when the customer amends, cancels or otherwise changes any
                arrangements after commencement of the tour.
              </p>
            </section>
            <div className="pi-note">
              <span>
                This Proforma Invoice is prepared for payment arrangement and is
                not an official tax invoice.
              </span>
              <b>
                Prepared by: {order.profiles?.full_name || "Happy Express Travel"}
              </b>
            </div>
          </div>
        </div>
        <small>PROFORMA INVOICE RECORD</small>
        <h2>{order.pi_number}</h2>
        <div className="history-meta">
          <span>
            <small>Tour Code</small>
            <b>{order.team_number}</b>
          </span>
          <span>
            <small>Customer</small>
            <b>{order.customer_name}</b>
          </span>
          <span>
            <small>Travel</small>
            <b className="preserve-space">{order.trip_name}</b>
          </span>
          <span>
            <small>Dates</small>
            <b>
              {order.departure_date}{order.return_date ? ` — ${order.return_date}` : ""}
            </b>
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.item_type}</td>
                <td>{i.description}</td>
                <td>{i.quantity}</td>
                <td>{fmt(i.line_total || i.quantity * i.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {schedules.length > 0 && <><h3 className="section-label">PAYMENT SCHEDULE & STATUS</h3>
        <table>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Scheduled</th>
              <th>Paid</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
                const paid = paidFor(s.id);
                return (
                  <tr key={s.id}>
                    <td>{s.stage_name}</td>
                    <td>{fmt(s.amount)}</td>
                    <td>{fmt(paid)}</td>
                    <td>
                      <mark
                        className={paid >= Number(s.amount) ? "green" : "amber"}
                      >
                        {paid >= Number(s.amount) ? "PAID" : "OUTSTANDING"}
                      </mark>
                    </td>
                    <td>{s.due_date || "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table></>}
        <div className="receipt-list">
          <h3>RECEIPTS</h3>
          {receipts.length ? (
            receipts.map((r) => {
              const p = payments.find((x) => x.id === r.payment_id);
              return (
                <article key={r.id}>
                  <b>{r.receipt_number}</b>
                  <span>
                    {p?.payment_date} · {fmt(p?.amount || 0)}
                  </span>
                  <button
                    className="row-action"
                    onClick={() => setSelectedReceipt(r)}
                  >
                    Preview / Print
                  </button>
                </article>
              );
            })
          ) : (
            <p>No payment receipt yet.</p>
          )}
        </div>
        <section className="booking-documents">
          <div className="copy-heading"><span><h3>DOCUMENTS</h3><small>正式Invoice完成后会成为主要文件；Proforma仍保留作记录。</small></span>{invoices.length > 0 && <mark className="green">INVOICE READY</mark>}</div>
          <div className="document-card-grid">
            <article><span><small>Proforma Invoice</small><b>{order.pi_number}</b></span><button className="row-action" onClick={downloadPI}>Download PI</button></article>
            {invoices.map((doc)=><article className="primary-document" key={doc.id}><span><small>Official Invoice</small><b>{doc.invoice_number}</b></span><button className="primary" onClick={()=>window.open(documentUrls[`invoice:${doc.id}`],"_blank")}>View / Download Invoice</button></article>)}
            {officialReceipts.map((doc)=><article key={doc.id}><span><small>Official Receipt</small><b>{doc.or_number}</b></span><button className="row-action" onClick={()=>window.open(documentUrls[`or:${doc.id}`],"_blank")}>View / Download OR</button></article>)}
          </div>
        </section>
        {profile && profile.role !== "account" && <PassengerDetails order={order} profile={profile} notify={notify || (()=>undefined)} />}
        {profile && order.sales_user_id === profile.id && order.status === "awaiting_invoice" && order.urgent && !order.account_processing_at && <section className="urgent-reminder-panel"><div><b>Urgent Invoice · Waiting for Account</b><small>如果Account遗漏，可每30分钟再次提醒一次并重新置顶。</small></div><button className="danger-action" onClick={remindAccount}>🔔 Remind Account Again</button></section>}
        {order.account_processing_at && <div className="onhold-note"><b>Account Processing</b><span>Account已开始处理，不需要再次提醒。</span></div>}
        <div className="modal-actions pdf-ignore">
          <button className="primary" onClick={downloadPI}>
            Download PI PDF
          </button>
          {!pageMode && <button className="secondary" onClick={close}>Close</button>}
        </div>
      </div>
    </div>
  );
}

type PassengerRow = {
  passenger_no: number;
  passenger_type: "adult" | "child" | "infant";
  full_name: string;
  gender: string;
  date_of_birth: string;
  nationality: string;
  passport_number: string;
  passport_expiry: string;
  contact_number: string;
  age: string;
};
function normalisePassengerDate(value: string) {
  const clean = value.trim();
  const match = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}` : clean;
}
function parsePassengerText(raw: string): PassengerRow[] {
  const normalized = raw.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const blocks = normalized.split(/(?=^(?:(?:adult|child|infant)\s*#?\s*\d+|(?:passenger|pax)\s*\d+)\b)/im).filter((x)=>x.trim());
  const usable = blocks.length > 1 ? blocks : normalized.split(/\n\s*\n(?=\s*(?:\d+[.)]|(?:adult|child|infant)\b))/i).filter((x)=>x.trim());
  const aliases = {
    full_name: /^(?:full\s*english\s*name\s*\(as\s*per\s*ic\)|full\s*name(?:\s*as\s*per\s*passport)?|name)\s*[:\-]\s*(.+)$/im,
    gender: /^(?:gender|sex)\s*[:\-]\s*(.+)$/im,
    date_of_birth: /^(?:date\s*of\s*birth|dob|birth\s*date)\s*[:\-]\s*(.+)$/im,
    nationality: /^(?:nationality|citizenship)\s*[:\-]\s*(.+)$/im,
    passport_number: /^(?:ic\s*\/\s*passport\s*(?:no\.?|number)|passport\s*(?:no\.?|number)|ic\s*(?:no\.?|number)|pp\s*no\.?)\s*[:\-]\s*(.+)$/im,
    passport_expiry: /^(?:passport\s*(?:expiry|expiration)(?:\s*date)?|expiry\s*date)\s*[:\-]\s*(.+)$/im,
    contact_number: /^(?:contact\s*(?:no\.?|number)|phone(?:\s*number)?|mobile)\s*[:\-]\s*(.+)$/im,
    age: /^age\s*[:\-]\s*(.+)$/im,
  };
  return usable.map((block,index) => {
    const typeValue = block.match(/(?:passenger\s*type\s*[:\-]\s*)?\b(adult|child|infant)\b/i)?.[1]?.toLowerCase() || "adult";
    const value = (key:keyof typeof aliases) => block.match(aliases[key])?.[1]?.trim() || "";
    return {
      passenger_no:index+1,
      passenger_type:typeValue as PassengerRow["passenger_type"],
      full_name:value("full_name"), gender:value("gender"),
      date_of_birth:normalisePassengerDate(value("date_of_birth")),
      nationality:value("nationality"), passport_number:value("passport_number"),
      passport_expiry:normalisePassengerDate(value("passport_expiry")),
      contact_number:value("contact_number"), age:value("age"),
    };
  }).filter((row)=>row.full_name || row.passport_number);
}
function serializePassengerRows(rows: PassengerRow[]) {
  const typeCount = { adult: 0, child: 0, infant: 0 };
  return rows.map((row) => {
    typeCount[row.passenger_type] += 1;
    const type = row.passenger_type.charAt(0).toUpperCase() + row.passenger_type.slice(1);
    return `${type} #${typeCount[row.passenger_type]}\nFull English name (as per IC): ${row.full_name}\nIC/Passport number: ${row.passport_number}\nNationality: ${row.nationality}\nAge: ${row.age}\nGender: ${row.gender}`;
  }).join("\n\n");
}
function PassengerDetails({order,profile,notify}:{order:Order;profile:Profile;notify:(s:string)=>void}) {
  const [rows,setRows]=useState<PassengerRow[]>([]), [raw,setRaw]=useState(""), [showPaste,setShowPaste]=useState(false), [busy,setBusy]=useState(false);
  const expected=Number(order.adult_count||0)+Number(order.child_count||0)+Number(order.infant_count||0);
  async function load() {
    const {data,error}=await supabase.from("passengers").select("passenger_no,passenger_type,full_name,gender,date_of_birth,nationality,passport_number,passport_expiry,contact_number,raw_text").eq("order_id",order.id).eq("active",true).order("passenger_no");
    if(error) notify(error.message); else {
      const parsed = data?.[0]?.raw_text ? parsePassengerText(data[0].raw_text) : [];
      setRows((data||[]).map((row:any,index:number)=>({...row,age:parsed[index]?.age||""})) as PassengerRow[]);
    }
  }
  useEffect(()=>{void load();},[order.id]);
  const template=Array.from({length:expected||1},(_,index)=>{
    const type=index<Number(order.adult_count||0)?"Adult":index<Number(order.adult_count||0)+Number(order.child_count||0)?"Child":"Infant";
    const sameTypeNo = index < Number(order.adult_count||0)
      ? index + 1
      : index < Number(order.adult_count||0) + Number(order.child_count||0)
        ? index - Number(order.adult_count||0) + 1
        : index - Number(order.adult_count||0) - Number(order.child_count||0) + 1;
    return `${type} #${sameTypeNo}\nFull English name (as per IC):\nIC/Passport number:\nNationality:\nAge:\nGender:`;
  }).join("\n\n");
  async function copyTemplate(){await navigator.clipboard.writeText(template);notify("Passenger Template已复制，可发送给顾客");}
  function parse(){const parsed=parsePassengerText(raw);setRows(parsed);notify(`已读取 ${parsed.length} 位乘客，请检查红色资料`);}
  function edit(index:number,key:keyof PassengerRow,value:string){setRows(list=>list.map((row,i)=>i===index?{...row,[key]:value}:row));}
  async function save(){
    if(rows.length!==expected){notify(`人数不一致：PI预计 ${expected} 位，目前读取 ${rows.length} 位`);return;}
    const actual={adult:rows.filter(r=>r.passenger_type==="adult").length,child:rows.filter(r=>r.passenger_type==="child").length,infant:rows.filter(r=>r.passenger_type==="infant").length};
    if(actual.adult!==Number(order.adult_count||0)||actual.child!==Number(order.child_count||0)||actual.infant!==Number(order.infant_count||0)){notify(`分类不一致：需要 ${order.adult_count||0} Adult、${order.child_count||0} Child、${order.infant_count||0} Infant`);return;}
    if(rows.some((row)=>!row.full_name.trim())){notify("每位乘客必须填写护照姓名");return;}
    if(rows.some((row)=>row.passport_expiry && row.passport_expiry < order.departure_date)){notify("有乘客的Passport Expiry早于出发日期，请检查红色资料");return;}
    setBusy(true);
    const {data:auth}=await supabase.auth.getUser();
    const deactivate=await supabase.from("passengers").update({active:false}).eq("order_id",order.id);
    const savedRaw = serializePassengerRows(rows);
    const result=deactivate.error?deactivate:await supabase.from("passengers").upsert(rows.map(({age,...row},index)=>({
      ...row, passenger_no:index+1, order_id:order.id, created_by:auth.user!.id, raw_text:savedRaw, active:true, updated_at:new Date().toISOString(),
    })),{onConflict:"order_id,passenger_no"});
    setBusy(false); if(result.error) notify(result.error.message); else {notify("Passenger Details已保存");setShowPaste(false);void load();}
  }
  return <section className="passenger-panel">
    <div className="copy-heading"><span><h3>PASSENGER DETAILS</h3><small>{order.adult_count||0} Adult · {order.child_count||0} Child · {order.infant_count||0} Infant</small></span><b className={rows.length===expected?"complete-count":"incomplete-count"}>{rows.length}/{expected} Completed</b></div>
    <div className="passenger-actions"><button className="secondary" onClick={copyTemplate}>Copy Passenger Template</button><button className="primary" onClick={()=>setShowPaste(v=>!v)}>Bulk Paste / Edit</button></div>
    {showPaste&&<><label className="wide">Paste the complete customer reply<textarea rows={12} value={raw} onChange={(e)=>setRaw(e.target.value)} placeholder="Paste Passenger 1, Passenger 2... here" /></label><button className="secondary" onClick={parse}>Read & Split Passenger Data</button></>}
    {rows.length>0&&<div className="passenger-table-wrap"><table className="passenger-table"><thead><tr><th>No.</th><th>Type</th><th>Full English Name</th><th>IC / Passport</th><th>Nationality</th><th>Age</th><th>Gender</th></tr></thead><tbody>{rows.map((row,index)=><tr key={index} className={!row.full_name||!row.passport_number?"incomplete-row":""}><td>{index+1}</td><td><select value={row.passenger_type} onChange={(e)=>edit(index,"passenger_type",e.target.value)}><option value="adult">Adult</option><option value="child">Child</option><option value="infant">Infant</option></select></td><td><input value={row.full_name} onChange={(e)=>edit(index,"full_name",e.target.value)} /></td><td><input value={row.passport_number} onChange={(e)=>edit(index,"passport_number",e.target.value)} /></td><td><input value={row.nationality} onChange={(e)=>edit(index,"nationality",e.target.value)} /></td><td><input inputMode="numeric" value={row.age} onChange={(e)=>edit(index,"age",e.target.value)} /></td><td><input value={row.gender} onChange={(e)=>edit(index,"gender",e.target.value)} /></td></tr>)}</tbody></table></div>}
    {rows.length>0&&<div className="modal-actions"><button className="confirm" disabled={busy} onClick={save}>{busy?"Saving…":"Confirm & Save Passenger Details"}</button></div>}
  </section>;
}

function EditPI({
  order,
  close,
  done,
  notify,
}: {
  order: Order;
  close: () => void;
  done: () => void;
  notify: (s: string) => void;
}) {
  const [customer, setCustomer] = useState(order.customer_name),
    [phone, setPhone] = useState(order.phone || ""),
    [email, setEmail] = useState(order.email || ""),
    [billing, setBilling] = useState(order.billing_address || ""),
    [trip, setTrip] = useState(order.trip_name),
    [departureDate, setDepartureDate] = useState(order.departure_date || ""),
    [returnDate, setReturnDate] = useState(order.return_date || order.departure_date || ""),
    [adultCount, setAdultCount] = useState(Number(order.adult_count || order.pax || 1)),
    [childCount, setChildCount] = useState(Number(order.child_count || 0)),
    [infantCount, setInfantCount] = useState(Number(order.infant_count || 0)),
    [amendmentReason, setAmendmentReason] = useState("Travel date / booking details changed"),
    [regNew, setRegNew] = useState(order.company_registration_new || ""),
    [regOld, setRegOld] = useState(order.company_registration_old || ""),
    [tin, setTin] = useState(order.tax_identification_number || ""),
    [sst, setSst] = useState(order.sst_number || ""),
    [msic, setMsic] = useState(order.msic_code || ""),
    [activity, setActivity] = useState(order.business_activity || ""),
    [tourCode, setTourCode] = useState(order.team_number || ""),
    [tourCodes, setTourCodes] = useState<string[]>([]),
    [items, setItems] = useState<any[]>([]),
    [schedules, setSchedules] = useState<any[]>([]),
    [paidScheduleIds, setPaidScheduleIds] = useState<Set<string>>(new Set()),
    [hasPayments, setHasPayments] = useState(Number(order.paid_amount) > 0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      supabase
        .from("order_items")
        .select("*")
        .eq("order_id", order.id)
        .order("sort_order"),
      supabase
        .from("payment_schedules")
        .select("*")
        .eq("order_id", order.id)
        .order("sort_order"),
      supabase.from("payments").select("id,schedule_id,review_status").eq("order_id", order.id).neq("review_status", "rejected"),
      supabase.from("orders").select("team_number").not("team_number", "is", null),
    ]).then(([a, b, c, d]) => {
      setItems(a.data || []);
      setSchedules(b.data || []);
      setHasPayments(Boolean(c.data?.length));
      setPaidScheduleIds(new Set((c.data || []).map((row: any) => row.schedule_id).filter(Boolean)));
      setTourCodes([...new Set((d.data || []).map((row: any) => row.team_number as string).filter(Boolean))].sort());
    });
  }, [order.id]);
  const total = items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
    0,
  );
  const scheduleTotal = schedules.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  async function save() {
    if (!departureDate) {
      notify("请选择 Departure Date");
      return;
    }
    if (returnDate && returnDate < departureDate) {
      notify("Return Date 不可以早于 Departure Date");
      return;
    }
    if (
      schedules.length > 0 &&
      Math.abs(scheduleTotal - total) > 0.01
    ) {
      const difference = scheduleTotal - total;
      notify(
        difference > 0
          ? `Payment Schedule exceeds PI Total by ${order.currency || "MYR"} ${difference.toFixed(2)}. Please reduce the payment amount.`
          : `Payment Schedule is short by ${order.currency || "MYR"} ${Math.abs(difference).toFixed(2)}. Please complete the Balance amount.`,
      );
      return;
    }
    if (hasPayments) {
      setBusy(true);
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("amendment_requests").insert({
        order_id: order.id,
        requested_by: auth.user!.id,
        reason: amendmentReason.trim(),
        original_values: {
          customer_name: order.customer_name, phone: order.phone, email: order.email,
          billing_address: order.billing_address, trip_name: order.trip_name,
          departure_date: order.departure_date, return_date: order.return_date,
          adult_count: order.adult_count, child_count: order.child_count, infant_count: order.infant_count,
          pax: order.pax, subtotal: order.subtotal,
        },
        proposed_values: {
          customer_name: customer, phone, email, billing_address: billing, trip_name: trip,
          departure_date: departureDate, return_date: returnDate || null,
          adult_count: adultCount, child_count: childCount, infant_count: infantCount,
          pax: adultCount + childCount + infantCount, subtotal: total,
          items: items.map((item) => ({id:item.id,item_type:item.item_type,description:item.description,quantity:item.quantity,unit_price:item.unit_price})),
          schedules: schedules.map((schedule) => ({id:schedule.id,stage_name:schedule.stage_name,amount:schedule.amount,due_date:schedule.due_date || null})),
        },
      });
      setBusy(false);
      if (error) notify(error.message); else { notify("Amendment已提交，Account已收到前后差异通知"); done(); }
      return;
    }
    setBusy(true);
    const base = await supabase
      .from("orders")
      .update({
        customer_name: customer,
        phone: phone || null,
        email: email || null,
        billing_address: billing || null,
        trip_name: trip,
        departure_date: departureDate,
        return_date: returnDate || null,
        company_registration_new:
          order.customer_type === "company" ? regNew || null : null,
        company_registration_old:
          order.customer_type === "company" ? regOld || null : null,
        tax_identification_number:
          order.customer_type === "company" ? tin || null : null,
        sst_number: order.customer_type === "company" ? sst || null : null,
        msic_code: order.customer_type === "company" ? msic || null : null,
        business_activity:
          order.customer_type === "company" ? activity || null : null,
        team_number: order.status === "on_hold" ? (tourCode === "__new__" ? null : tourCode || order.team_number) : order.team_number,
        booking_type: order.status === "on_hold" ? (tourCode === "__new__" ? "new" : tourCode !== order.team_number ? "existing" : order.booking_type) : order.booking_type,
        adult_count: adultCount,
        child_count: childCount,
        infant_count: infantCount,
        pax: adultCount + childCount + infantCount,
        subtotal: hasPayments ? order.subtotal : total,
      })
      .eq("id", order.id);
    if (base.error) {
      notify(base.error.message);
      setBusy(false);
      return;
    }
    if (!hasPayments) {
      const [di, ds] = await Promise.all([
        supabase.from("order_items").delete().eq("order_id", order.id),
        supabase.from("payment_schedules").delete().eq("order_id", order.id),
      ]);
      if (di.error || ds.error) {
        notify((di.error || ds.error)!.message);
        setBusy(false);
        return;
      }
      const [ii, ss] = await Promise.all([
        supabase.from("order_items").insert(
          items.map((i, n) => ({
            order_id: order.id,
            item_type: i.item_type,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
            sort_order: n,
          })),
        ),
        schedules.length
          ? supabase.from("payment_schedules").insert(
              schedules.map((s, n) => ({
                order_id: order.id,
                stage_name: s.stage_name,
                amount: s.amount,
                due_date: s.due_date || null,
                sort_order: n,
              })),
            )
          : Promise.resolve({ error: null }),
      ]);
      if (ii.error || ss.error) {
        notify((ii.error || ss.error)!.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    notify("Proforma Invoice已更新");
    done();
  }
  return (
    <div className="modal-back">
      <div className="modal wide-modal">
        <button className="modal-x" onClick={close}>
          ×
        </button>
        <small>EDIT PROFORMA INVOICE</small>
        <h2>{order.pi_number}</h2>
        {hasPayments && (
          <div className="onhold-note">
            <b>Payment already recorded</b>
            <span>
              Bank Slip已经提交。修改不会直接覆盖资料，而会发送Amendment给Account确认。
            </span>
          </div>
        )}
        <div className="edit-grid">
          {order.status === "on_hold" && !hasPayments && (
            <label className="wide tour-code-correction">
              Tour Code／团队号
              <select value={tourCode} onChange={(e) => setTourCode(e.target.value)}>
                <option value={order.team_number || ""}>保留目前：{order.team_number || "尚未生成"}</option>
                <option value="__new__">拆分为 New Booking（自动生成新 Tour Code）</option>
                {tourCodes.filter((code) => code !== order.team_number).map((code) => <option key={code} value={code}>并入 Existing Tour Code：{code}</option>)}
              </select>
              <small>只限 On Hold、尚未收款的 PI。可并入 Existing，也可拆分为 New Booking 并自动生成新 Tour Code。</small>
            </label>
          )}
          <label>
            Customer / Company
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Billing Address
            <input
              value={billing}
              onChange={(e) => setBilling(e.target.value)}
            />
          </label>
          <label className="wide">
            Travel Description
            <input value={trip} onChange={(e) => setTrip(e.target.value)} />
          </label>
          <label>
            Departure Date *
            <input
              type="date"
              value={departureDate}
              onChange={(e) => {
                const value = e.target.value;
                setDepartureDate(value);
                if (!returnDate || returnDate < value) setReturnDate(value);
              }}
            />
          </label>
          <label>
            Return Date
            <input
              type="date"
              min={departureDate}
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </label>
          <label>Adult<input type="number" min="0" value={adultCount} onChange={(e)=>setAdultCount(+e.target.value)} /></label>
          <label>Child<input type="number" min="0" value={childCount} onChange={(e)=>setChildCount(+e.target.value)} /></label>
          <label>Infant<input type="number" min="0" value={infantCount} onChange={(e)=>setInfantCount(+e.target.value)} /></label>
          {hasPayments && <label className="wide">Amendment Reason *<textarea value={amendmentReason} onChange={(e)=>setAmendmentReason(e.target.value)} /></label>}
          {order.customer_type === "company" && (
            <>
              <label>
                Registration No. (NEW) *
                <input
                  value={regNew}
                  onChange={(e) => setRegNew(e.target.value)}
                />
              </label>
              <label>
                Registration No. (OLD)
                <input
                  value={regOld}
                  onChange={(e) => setRegOld(e.target.value)}
                />
              </label>
              <label>
                TIN *
                <input value={tin} onChange={(e) => setTin(e.target.value)} />
              </label>
              <label>
                SST
                <input value={sst} onChange={(e) => setSst(e.target.value)} />
              </label>
              <label>
                MSIC Code *
                <input value={msic} onChange={(e) => setMsic(e.target.value)} />
              </label>
              <label>
                Business Activity *
                <input
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <>
            <div className="edit-items-heading">
              <div>
                <h3 className="section-label">ITEMS</h3>
                {hasPayments && <small>新增或修改项目会作为 Amendment 交给 Account 审核。</small>}
              </div>
              <button
                type="button"
                className="secondary add-item-button"
                onClick={() => setItems((rows) => [...rows, { item_type: "Package", description: "", quantity: 1, unit_price: 0 }])}
              >
                ＋ Add Item
              </button>
            </div>
            {items.map((i, n) => (
              <div className="edit-money-row" key={i.id || n}>
                <input
                  value={i.item_type}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, item_type: e.target.value } : x,
                      ),
                    )
                  }
                />
                <textarea
                  rows={3}
                  value={i.description}
                  placeholder="Description（可按 Enter 换行／保留空行）"
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  value={i.quantity}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, quantity: +e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  value={i.unit_price === 0 ? "" : i.unit_price}
                  placeholder="0.00"
                  inputMode="decimal"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, unit_price: +e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="remove-item-button"
                  disabled={items.length <= 1}
                  onClick={() => setItems((rows) => rows.filter((_, index) => index !== n))}
                  aria-label={`Remove item ${n + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
        </>
        <>
            <div className="edit-items-heading payment-schedule-heading">
              <div>
                <h3 className="section-label">PAYMENT SCHEDULE</h3>
                {hasPayments && <small>已收款阶段会锁定；只可修改后续未付款阶段，并交给 Account 批准。</small>}
              </div>
              <button
                type="button"
                className="secondary add-item-button"
                onClick={() => setSchedules((rows) => [...rows, { stage_name: `Payment ${rows.length + 1}`, amount: 0, due_date: "" }])}
              >
                ＋ Add Payment Stage
              </button>
            </div>
            {schedules.map((s, n) => (
              <div className="edit-money-row schedule-edit" key={s.id || n}>
                <input
                  disabled={Boolean(s.id && paidScheduleIds.has(s.id))}
                  value={s.stage_name}
                  onChange={(e) =>
                    setSchedules((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, stage_name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  disabled={Boolean(s.id && paidScheduleIds.has(s.id))}
                  value={s.amount === 0 ? "" : s.amount}
                  placeholder="0.00"
                  inputMode="decimal"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) =>
                    setSchedules((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, amount: +e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  type="date"
                  disabled={Boolean(s.id && paidScheduleIds.has(s.id))}
                  value={s.due_date || ""}
                  onChange={(e) =>
                    setSchedules((rows) =>
                      rows.map((x, j) =>
                        j === n ? { ...x, due_date: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="remove-item-button"
                  disabled={schedules.length <= 1 || Boolean(s.id && paidScheduleIds.has(s.id))}
                  onClick={() => setSchedules((rows) => rows.filter((_, index) => index !== n))}
                >
                  {s.id && paidScheduleIds.has(s.id) ? "Paid · Locked" : "Remove"}
                </button>
              </div>
            ))}
            {schedules.length > 0 && Math.abs(scheduleTotal - total) > 0.01 && (
              <div className="schedule-error-message">
                {scheduleTotal > total
                  ? `Payment Schedule exceeds PI Total by ${order.currency || "MYR"} ${(scheduleTotal - total).toFixed(2)}.`
                  : `Payment Schedule is short by ${order.currency || "MYR"} ${(total - scheduleTotal).toFixed(2)}.`}
              </div>
            )}
        </>
        <div className="modal-actions">
          <button className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="confirm"
            disabled={busy || !customer || !trip || !departureDate || Boolean(returnDate && returnDate < departureDate) || adultCount + childCount + infantCount <= 0 || (hasPayments && !amendmentReason.trim())}
            onClick={save}
          >
            {busy ? "Saving…" : hasPayments ? "Submit Amendment to Account" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Booking({
  order,
  close,
  done,
  notify,
}: {
  order: Order;
  close: () => void;
  done: () => void;
  notify: (s: string) => void;
}) {
  const companyComplete =
    order.customer_type !== "company" ||
    Boolean(
      order.company_registration_new &&
        order.tax_identification_number &&
        order.msic_code &&
        order.business_activity,
    );
  const [file, setFile] = useState<File | null>(null),
    [filePreviewUrl, setFilePreviewUrl] = useState(""),
    [reviewingSlip, setReviewingSlip] = useState(false),
    [amount, setAmount] = useState(Number(order.total_amount)),
    [paymentDate, setPaymentDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [scheduleRows, setScheduleRows] = useState<PaymentSchedule[]>([]),
    [scheduleId, setScheduleId] = useState(""),
    [urgent, setUrgent] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    },
    [filePreviewUrl],
  );
  useEffect(() => {
    Promise.all([
      supabase
        .from("payment_schedules")
        .select("id,stage_name,amount,due_date")
        .eq("order_id", order.id)
        .order("sort_order"),
      supabase
        .from("payments")
        .select("schedule_id,amount")
        .eq("order_id", order.id)
        .neq("review_status", "rejected"),
    ]).then(([scheduleResult, paymentResult]) => {
      const paidIds = new Set(
        (paymentResult.data || []).map((p) => p.schedule_id).filter(Boolean),
      );
      const rows = ((scheduleResult.data || []) as PaymentSchedule[]).filter(
        (row) => !paidIds.has(row.id),
      );
      setScheduleRows(rows);
      if (rows[0]) {
        setScheduleId(rows[0].id || "");
        setAmount(Number(rows[0].amount));
      } else {
        setAmount(
          Math.max(0, Number(order.total_amount) - Number(order.paid_amount)),
        );
      }
    });
  }, [order.id]);
  async function confirm() {
    if (!file) return;
    setBusy(true);
    const path = `${order.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage.from("bank-slips").upload(path, file);
    if (up.error) {
      notify(up.error.message);
      setBusy(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const p = await supabase.from("payments").insert({
      order_id: order.id,
      amount,
      payment_date: paymentDate,
      schedule_id: scheduleId || null,
      slip_path: path,
      uploaded_by: user!.id,
      urgent,
    });
    if (p.error) {
      notify(p.error.message);
      setBusy(false);
      return;
    }
    const u = await supabase
      .from("orders")
      .update({
        bank_slip_path: path,
        status: "awaiting_invoice",
        urgent,
        urgent_marked_at: urgent ? new Date().toISOString() : null,
        last_reminded_at: urgent ? new Date().toISOString() : null,
        urgent_reminder_count: 0,
        account_processing_at: null,
        account_processing_by: null,
      })
      .eq("id", order.id);
    setBusy(false);
    if (u.error) notify(u.error.message);
    else {
      notify(
        order.status === "on_hold"
          ? "成单成功，Account已收到通知，Receipt已生成"
          : "Payment已记录，Receipt已生成",
      );
      done();
    }
  }
  return (
    <div className="modal-back">
      <div className="modal booking-confirm-modal">
        <button className="modal-x" onClick={close}>
          ×
        </button>
        <small>CONFIRM BOOKING</small>
        <h2>收款并确认成单</h2>
        <p>
          {order.pi_number} · {order.customer_name}
        </p>
        <div className="number-rule">
          <b>团队号</b>
          <strong>{order.team_number || "确认后自动生成"}</strong>
        </div>
        <label>
          Payment Stage
          <select
            value={scheduleId}
            onChange={(e) => {
              const id = e.target.value;
              setScheduleId(id);
              const row = scheduleRows.find((item) => item.id === id);
              if (row) setAmount(Number(row.amount));
            }}
          >
            <option value="">Unscheduled Payment</option>
            {scheduleRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.stage_name} · {order.currency || "MYR"}{" "}
                {Number(row.amount).toFixed(2)}
              </option>
            ))}
          </select>
        </label>
        <label>
          收款金额
          <input type="number" value={amount} readOnly />
          <small>
            Amount follows the selected PI payment schedule and cannot be
            edited.
          </small>
        </label>
        <label>
          Payment Date
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </label>
        <label className="upload">
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => {
              const selected = e.target.files?.[0] || null;
              if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
              setFile(selected);
              setFilePreviewUrl(selected ? URL.createObjectURL(selected) : "");
            }}
          />
          <b>{file ? file.name : "＋ Upload Bank Slip"}</b>
          <small>JPG、PNG或PDF，最多10MB</small>
        </label>
        {file && filePreviewUrl && (
          <div className="slip-review-card">
            {file.type.startsWith("image/") ? (
              <img src={filePreviewUrl} alt="Selected Bank Slip" />
            ) : (
              <div className="pdf-file-icon">PDF</div>
            )}
            <span>
              <b>{file.name}</b>
              <small>请在提交前确认照片及付款资料正确。</small>
            </span>
            <button className="secondary" onClick={() => setReviewingSlip(true)}>
              Review Bank Slip
            </button>
          </div>
        )}
        {!companyComplete && (
          <div className="auth-message">
            Company billing details are incomplete. Edit the PI before
            submitting this Bank Slip to Account.
          </div>
        )}
        <label className={`urgent-choice ${urgent ? "selected" : ""}`}>
          <input type="checkbox" checked={urgent} onChange={(e)=>setUrgent(e.target.checked)} />
          <span><b>Urgent – Invoice required today</b><small>Account会立即收到红色通知，此订单会插队到待处理列表最上方。</small></span>
        </label>
        <div className="modal-actions">
          <button className="secondary" onClick={close}>
            取消
          </button>
          <button
            className="confirm"
            disabled={
              !file ||
              busy ||
              !companyComplete ||
              (scheduleRows.length > 0 && !scheduleId)
            }
            onClick={confirm}
          >
            {busy ? "处理中…" : "确认成单"}
          </button>
        </div>
        {reviewingSlip && filePreviewUrl && (
          <div className="slip-lightbox">
            <button className="modal-x" onClick={() => setReviewingSlip(false)}>×</button>
            <small>BANK SLIP REVIEW</small>
            <h3>{file?.name}</h3>
            {file?.type.startsWith("image/") ? (
              <img src={filePreviewUrl} alt="Bank Slip full preview" />
            ) : (
              <iframe src={filePreviewUrl} title="Bank Slip PDF preview" />
            )}
            <button className="confirm" onClick={() => setReviewingSlip(false)}>照片正确 · 返回提交</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPI({
  profile,
  done,
  notify,
}: {
  profile: Profile;
  done: () => void;
  notify: (s: string) => void;
}) {
  const [customer, setCustomer] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [billingAddress, setBillingAddress] = useState(""),
    [currency, setCurrency] = useState<"MYR" | "SGD">("MYR"),
    [bookingType, setBookingType] = useState<"new" | "existing">("new"),
    [existingTourCode, setExistingTourCode] = useState(""),
    [tourCodes, setTourCodes] = useState<{ code: string; names: string[] }[]>(
      [],
    ),
    [customerType, setCustomerType] = useState<"personal" | "company">(
      "personal",
    ),
    [regNew, setRegNew] = useState(""),
    [regOld, setRegOld] = useState(""),
    [tin, setTin] = useState(""),
    [sst, setSst] = useState(""),
    [msic, setMsic] = useState(""),
    [businessActivity, setBusinessActivity] = useState(""),
    [category, setCategory] = useState("island"),
    [packageName, setPackageName] = useState(""),
    [customPackage, setCustomPackage] = useState(""),
    [resortName, setResortName] = useState(""),
    [customResort, setCustomResort] = useState(""),
    [tourName, setTourName] = useState(""),
    [customTour, setCustomTour] = useState(""),
    [customTrip, setCustomTrip] = useState(""),
    [departure, setDeparture] = useState(""),
    [ret, setRet] = useState(""),
    [adultCount, setAdultCount] = useState(1),
    [childCount, setChildCount] = useState(0),
    [infantCount, setInfantCount] = useState(0),
    [schedules, setSchedules] = useState<PaymentSchedule[]>([]),
    [options, setOptions] = useState<PiOption[]>([]),
    [previewing, setPreviewing] = useState(false),
    [issuedNumber, setIssuedNumber] = useState(""),
    [validationErrors, setValidationErrors] = useState<string[]>([]),
    [items, setItems] = useState([
      {
        item_type: "Room",
        custom_type: "",
        description: "",
        quantity: 1,
        unit_price: 0,
      },
    ]),
    [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const formatAmount = (n: number) =>
    `${currency} ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
  const days =
    departure && ret
      ? Math.round(
          (new Date(`${ret}T00:00:00`).getTime() -
            new Date(`${departure}T00:00:00`).getTime()) /
            86400000,
        ) + 1
      : 0;
  const filteredPackages = options.filter((o) => {
    if (o.option_group !== "island_package" || !o.active) return false;
    if (!days) return true;
    if (days === 1) return /day trip/i.test(o.label);
    const match = o.label.match(/^(\d+)D/i);
    return match ? Number(match[1]) === days : true;
  });
  const finalPackage = packageName === "CUSTOM" ? customPackage : packageName;
  const isDayTrip = /day trip/i.test(finalPackage) || days === 1;
  const returnRequired = category === "island" && packageName !== "CUSTOM" && !isDayTrip;
  const finalStay = isDayTrip
    ? tourName === "CUSTOM"
      ? customTour
      : tourName
    : resortName === "CUSTOM"
      ? customResort
      : resortName;
  const categoryLabel: Record<string, string> = {
    island: "Island Tour",
    outbound: "Outbound Package",
    inbound: "Inbound Package",
  };
  const trip =
    category === "island"
      ? [finalPackage, finalStay].filter(Boolean).join(" · ")
      : customTrip;
  useEffect(() => {
    supabase
      .from("pi_options")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) notify(error.message);
        else setOptions((data || []) as PiOption[]);
      });
    supabase
      .from("orders")
      .select("team_number,customer_name")
      .not("team_number", "is", null)
      .then(({ data }) => {
        const grouped = new Map<string, Set<string>>();
        (data || []).forEach((row) => {
          const code = row.team_number as string;
          if (!grouped.has(code)) grouped.set(code, new Set());
          grouped.get(code)!.add(row.customer_name);
        });
        setTourCodes(
          [...grouped.entries()]
            .map(([code, names]) => ({ code, names: [...names] }))
            .sort((a, b) => a.code.localeCompare(b.code)),
        );
      });
  }, []);
  useEffect(() => {
    if (ret && departure && ret < departure) setRet(departure);
  }, [departure]);
  function edit(n: number, k: string, v: string | number) {
    setItems((x) => x.map((i, j) => (j === n ? { ...i, [k]: v } : i)));
  }
  function editSchedule(
    n: number,
    key: keyof PaymentSchedule,
    value: string | number,
  ) {
    setSchedules((rows) =>
      rows.map((row, index) => (index === n ? { ...row, [key]: value } : row)),
    );
  }
  const scheduleTotal = schedules.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  function getValidationIssues() {
    const issues: { key: string; label: string }[] = [];
    if (bookingType === "existing" && !existingTourCode) issues.push({ key: "tour-code", label: "Existing Tour Code" });
    if (!customer.trim()) issues.push({ key: "customer", label: customerType === "company" ? "Company Full Name" : "Customer Name" });
    if (!departure) issues.push({ key: "departure", label: "Departure Date" });
    if (returnRequired && !ret) issues.push({ key: "return", label: "Return Date" });
    if (ret && departure && ret < departure) issues.push({ key: "return", label: "Return Date cannot be earlier than Departure Date" });
    if (adultCount + childCount + infantCount <= 0) issues.push({ key: "pax", label: "Passenger Count" });
    if (category === "island" && !packageName) issues.push({ key: "package", label: "Island Package" });
    if (category === "island" && packageName === "CUSTOM" && !customPackage.trim()) issues.push({ key: "custom-package", label: "Custom Package" });
    if (category === "island" && finalPackage && isDayTrip && !tourName) issues.push({ key: "stay", label: "Day Trip Route" });
    if (category === "island" && finalPackage && isDayTrip && tourName === "CUSTOM" && !customTour.trim()) issues.push({ key: "custom-stay", label: "Custom Day Trip Route" });
    if (category === "island" && finalPackage && !isDayTrip && !resortName) issues.push({ key: "stay", label: "Resort" });
    if (category === "island" && finalPackage && !isDayTrip && resortName === "CUSTOM" && !customResort.trim()) issues.push({ key: "custom-stay", label: "Custom Resort" });
    if (category !== "island" && !customTrip.trim()) issues.push({ key: "trip", label: "Tour / Hotel Booking Details" });
    items.forEach((item, index) => {
      if (item.item_type === "Other" && !item.custom_type.trim()) issues.push({ key: `item-${index}`, label: `Item ${index + 1} Custom Name` });
      if (!item.description.trim()) issues.push({ key: `item-${index}`, label: `Item ${index + 1} Description` });
      if (item.quantity <= 0) issues.push({ key: `item-${index}`, label: `Item ${index + 1} Quantity` });
    });
    schedules.forEach((row, index) => {
      if (row.amount <= 0) issues.push({ key: `schedule-${index}`, label: `Payment ${index + 1} Amount` });
      if (row.stage_name === "Custom" && !row.custom_name?.trim()) issues.push({ key: `schedule-${index}`, label: `Payment ${index + 1} Name` });
    });
    return issues;
  }
  function openPreview() {
    const issues = getValidationIssues();
    if (issues.length) {
      const keys = [...new Set(issues.map((issue) => issue.key))];
      setValidationErrors(keys);
      notify(`请填写以下必填资料：${issues.map((issue) => issue.label).join("、")}`);
      window.setTimeout(() => {
        document.querySelector(`[data-field="${keys[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
      return;
    }
    setValidationErrors([]);
    if (schedules.length && Math.abs(scheduleTotal - subtotal) > 0.01) {
      const difference = scheduleTotal - subtotal;
      notify(
        difference > 0
          ? `Payment Schedule exceeds PI Total by ${formatAmount(difference)}. Please reduce the Balance or other payment amount.`
          : `Payment Schedule is short by ${formatAmount(Math.abs(difference))}. Please complete the Balance amount.`,
      );
      return;
    }
    setPreviewing(true);
  }
  async function downloadPdf(piNumber: string) {
    if (!previewRef.current) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
    const safeCustomer = customer.replace(/[\\/:*?"<>|]/g, "-").trim();
    await downloadInvoicePdf(previewRef.current, `${piNumber} - ${safeCustomer}.pdf`);
  }
  async function issue() {
    if (getValidationIssues().length) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("orders")
      .insert({
        pi_number: "",
        team_number: bookingType === "existing" ? existingTourCode : null,
        booking_type: bookingType,
        sales_user_id: profile.id,
        customer_name: customer,
        customer_type: customerType,
        phone,
        email: email || null,
        billing_address: billingAddress || null,
        company_registration_new: customerType === "company" ? regNew : null,
        company_registration_old:
          customerType === "company" ? regOld || null : null,
        tax_identification_number: customerType === "company" ? tin : null,
        sst_number: customerType === "company" ? sst || null : null,
        msic_code: customerType === "company" ? msic : null,
        business_activity: customerType === "company" ? businessActivity : null,
        currency,
        trip_category: category,
        package_name: category === "island" ? finalPackage : null,
        resort_name: category === "island" && !isDayTrip ? finalStay : null,
        tour_name: category === "island" && isDayTrip ? finalStay : null,
        trip_name: trip,
        departure_date: departure,
        return_date: ret || null,
        adult_count: adultCount,
        child_count: childCount,
        infant_count: infantCount,
        pax: adultCount + childCount + infantCount,
        subtotal,
        discount: 0,
        status: "on_hold",
      })
      .select()
      .single();
    if (error) {
      notify(error.message);
      setBusy(false);
      return;
    }
    const [itemsResult, schedulesResult] = await Promise.all([
      supabase.from("order_items").insert(
        items.map((i, n) => ({
          item_type:
            i.item_type === "Other" ? i.custom_type.trim() : i.item_type,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
          order_id: data.id,
          sort_order: n,
        })),
      ),
      schedules.length
        ? supabase.from("payment_schedules").insert(
            schedules.map((row, n) => ({
              order_id: data.id,
              stage_name:
                row.stage_name === "Custom"
                  ? row.custom_name!.trim()
                  : row.stage_name,
              amount: row.amount,
              due_date: row.due_date || null,
              sort_order: n,
            })),
          )
        : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    if (itemsResult.error || schedulesResult.error)
      notify((itemsResult.error || schedulesResult.error)!.message);
    else {
      setIssuedNumber(data.pi_number);
      try {
        await downloadPdf(data.pi_number);
        notify(
          `${data.pi_number} · ${data.team_number} 已进入On Hold，PDF已下载`,
        );
      } catch {
        notify(`${data.pi_number} 已进入On Hold，但PDF下载失败，请再预览下载`);
      }
      done();
    }
  }
  if (previewing) {
    return (
      <>
        <Head
          eyebrow="STEP 2 · PREVIEW"
          title="确认 Proforma Invoice"
          sub="检查版面与资料，确认后进入On Hold并自动下载PDF。"
        />
        <div className="preview-workspace">
          <div className="pi-preview-scroll">
          <div className="preview invoice-preview pi-desktop-layout" ref={previewRef}>
            <div className="pi-head">
              <img
                src={DOCUMENT_LOGO_PNG}
                alt="Happy Express Travel logo"
              />
              <span>
                <b>HAPPY EXPRESS TRAVEL SDN BHD</b>
                <small>[2014401022292] (1098378-X)</small>
                <small>
                  14-01, JALAN ROSMERAH 2/13, TAMAN JOHOR JAYA 81100, JOHOR
                  BAHRU, JOHOR.
                </small>
                <small>HOTLINE: +6012-538 2254 / +07-288 6639</small>
              </span>
              <h2>
                PROFORMA
                <br />
                INVOICE
              </h2>
            </div>
            <div className="pi-meta">
              <b>Proforma Invoice No:</b>
              <span>{issuedNumber || "Auto-generated when confirmed"}</span>
            </div>
            <div className="bill">
              <span>
                <small>BILL TO</small>
                <b>{customer}</b>
                {phone && <small>{phone}</small>}
                {email && <small>{email}</small>}
                {billingAddress && (
                  <small className="billing-copy">{billingAddress}</small>
                )}
                {customerType === "company" && (
                  <>
                    <small>Registration No. (NEW): {regNew || "Pending"}</small>
                    {regOld && <small>Registration No. (OLD): {regOld}</small>}
                    <small>TIN: {tin || "Pending"}</small>
                    {sst && <small>SST: {sst}</small>}
                    <small>MSIC: {msic || "Pending"}</small>
                    {businessActivity && (
                      <small>Business Activity: {businessActivity}</small>
                    )}
                  </>
                )}
              </span>
              <span>
                <small>TRAVEL DETAILS</small>
                <b className="preserve-space">{trip || finalPackage || categoryLabel[category]}</b>
                <small className="travel-date-line"><b>Travel Date:</b> {displayDate(departure)}{ret ? ` — ${displayDate(ret)}` : ""}</small>
              </span>
            </div>
            <table className="pi-items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td>
                      {i.item_type === "Other" ? i.custom_type : i.item_type}
                    </td>
                    <td className="preserve-space">{renderMultilineText(i.description)}</td>
                    <td>{i.quantity}</td>
                    <td>{formatAmount(i.unit_price)}</td>
                    <td>{formatAmount(i.quantity * i.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="total">
              <strong>
                Total <b>{formatAmount(subtotal)}</b>
              </strong>
            </div>
            {schedules.length > 0 && (
              <section className="pi-payment-schedule">
                <h3>PAYMENT SCHEDULE</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Amount</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((row, n) => (
                      <tr key={n}>
                        <td>
                          {row.stage_name === "Custom"
                            ? row.custom_name
                            : row.stage_name}
                        </td>
                        <td>{formatAmount(row.amount)}</td>
                        <td>{row.due_date || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            <section className="pi-bank">
              <div>
                <h3>PAYMENT METHOD</h3>
                {currency === "MYR" ? (
                  <>
                    <p>
                      <b>Bank Name:</b> Public Bank Berhad
                    </p>
                    <p>
                      <b>Beneficiary Name:</b> Happy Express Travel Sdn. Bhd.
                    </p>
                    <p>
                      <b>Bank Account:</b> 319 154 1222
                    </p>
                    <p>
                      <b>Bank Address:</b> 17-19, Jalan Molek, 1/5A Taman Molek,
                      81100, Johor Bahru, Johor.
                    </p>
                    <p>
                      <b>Swift Code:</b> PBBEMYKL
                    </p>
                    <p>
                      <b>Business Registration Number:</b> 1098378-X
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <b>Bank Name:</b> Maybank Singapore Limited
                    </p>
                    <p>
                      <b>Beneficiary Name:</b> Happy Express Travel Sdn. Bhd.
                    </p>
                    <p>
                      <b>Bank Account:</b> 0407 1092 493
                    </p>
                    <p>
                      <b>Swift Code:</b> MBBESGS2
                    </p>
                  </>
                )}
              </div>
              {currency === "MYR" && (
                <img src={DUITNOW_QR_PNG} alt="DuitNow QR payment" />
              )}
            </section>
            <div className="pdf-keep-together">
              <section className="pi-terms">
                <h3>TERMS & CONDITIONS</h3>
                <p>
                  • Happy Express Travel Sdn. Bhd. does not issue refunds or allow
                  cancellations once a booking is confirmed.
                </p>
                <p>
                  • No refund will be made with respect to accommodation, meals,
                  sightseeing tours or any other services included in the tour
                  fare but not utilised by the customer, either in part or in
                  full, or when the customer amends, cancels or otherwise changes
                  any arrangements after commencement of the tour.
                </p>
              </section>
              <div className="pi-note">
                <span>
                  This Proforma Invoice is prepared for payment arrangement and is
                  not an official tax invoice.
                </span>
                <b>Prepared by: {profile.full_name}</b>
              </div>
            </div>
          </div>
          </div>
          <div className="preview-buttons">
            <button className="secondary" onClick={() => setPreviewing(false)}>
              ← 返回修改
            </button>
            <button className="confirm" disabled={busy} onClick={issue}>
              {busy ? "生成中…" : "确认 On Hold · 下载 PDF"}
            </button>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <Head
        eyebrow="SALES · NEW DOCUMENT"
        title="新建 Proforma Invoice"
        sub="发出PI只是准备向顾客收款，不会自动成为订单。"
      />
      <div className="form-layout">
        <section className="panel form">
          <div className="form-title">
            <h2>顾客与行程</h2>
            <p>填写PI抬头、行程分类、日期与Items。</p>
          </div>
          <div className="booking-choice">
            <label>
              <input
                type="radio"
                checked={bookingType === "new"}
                onChange={() => {
                  setBookingType("new");
                  setExistingTourCode("");
                }}
              />{" "}
              New Booking <small>Generate a new Tour Code</small>
            </label>
            <label>
              <input
                type="radio"
                checked={bookingType === "existing"}
                onChange={() => setBookingType("existing")}
              />{" "}
              Existing Booking <small>Use an existing Tour Code</small>
            </label>
          </div>
          {bookingType === "existing" && (
            <label className={`wide ${validationErrors.includes("tour-code") ? "field-invalid" : ""}`} data-field="tour-code">
              Existing Tour Code *
              <select
                value={existingTourCode}
                onChange={(e) => setExistingTourCode(e.target.value)}
              >
                <option value="">Select Tour Code</option>
                {tourCodes.map((tour) => (
                  <option key={tour.code} value={tour.code}>
                    {tour.code} — {tour.names.join(" / ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="customer-type">
            <button
              className={customerType === "personal" ? "on" : ""}
              onClick={() => setCustomerType("personal")}
            >
              Personal
            </button>
            <button
              className={customerType === "company" ? "on" : ""}
              onClick={() => setCustomerType("company")}
            >
              Company
            </button>
          </div>
          <div className="fields">
            <label className={validationErrors.includes("customer") ? "field-invalid" : ""} data-field="customer">
              {customerType === "company"
                ? "Company Full Name *"
                : "Customer Name *"}
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>
            <label>
              电话号码（Optional）
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="例如 +60 12-345 6789"
              />
            </label>
            <label>
              Email Address（Optional）
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Billing Address（Optional）
              <textarea
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Currency *
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "MYR" | "SGD")}
              >
                <option value="MYR">MYR — Malaysian Ringgit</option>
                <option value="SGD">SGD — Singapore Dollar</option>
              </select>
            </label>
            <label>
              行程选择 *
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPackageName("");
                }}
              >
                <option value="island">Island Tour</option>
                <option value="outbound">Outbound Package</option>
                <option value="inbound">Inbound Package</option>
              </select>
            </label>
            <label className={validationErrors.includes("departure") ? "field-invalid" : ""} data-field="departure">
              出发日期 *
              <input
                type="date"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
              />
            </label>
            <label className={validationErrors.includes("return") ? "field-invalid" : ""} data-field="return">
              回程日期 {returnRequired ? "*" : "（Optional）"}
              <input
                type="date"
                value={ret}
                min={departure}
                onChange={(e) => setRet(e.target.value)}
              />
              {!returnRequired && <small>Day Trip、Custom、Outbound及Inbound行程可不填写。</small>}
            </label>
          </div>
          <div className={`pax-selector ${validationErrors.includes("pax") ? "field-invalid" : ""}`} data-field="pax">
            <div><b>Passenger Count *</b><small>先确认人数，Proforma完成后再补Passenger Details。</small></div>
            <label>Adult<input type="number" min="0" value={adultCount} onChange={(e)=>setAdultCount(Math.max(0,+e.target.value))} /></label>
            <label>Child<input type="number" min="0" value={childCount} onChange={(e)=>setChildCount(Math.max(0,+e.target.value))} /></label>
            <label>Infant<input type="number" min="0" value={infantCount} onChange={(e)=>setInfantCount(Math.max(0,+e.target.value))} /></label>
            <strong>Total {adultCount + childCount + infantCount} Pax</strong>
          </div>
          {customerType === "company" && (
            <div className="company-fields">
              <div className="company-later">
                <b>Company billing details can be added later.</b>
                <span>
                  They become mandatory only before submitting a Bank Slip to
                  Account.
                </span>
              </div>
              <label>
                Business Registration No. (NEW)
                <input
                  value={regNew}
                  onChange={(e) => setRegNew(e.target.value)}
                />
              </label>
              <label>
                Business Registration No. (OLD)
                <input
                  value={regOld}
                  onChange={(e) => setRegOld(e.target.value)}
                />
              </label>
              <label>
                Tax Identification Number (TIN)
                <input value={tin} onChange={(e) => setTin(e.target.value)} />
              </label>
              <label>
                Sales & Service Tax Number (SST)
                <input value={sst} onChange={(e) => setSst(e.target.value)} />
              </label>
              <label>
                MSIC Code
                <input value={msic} onChange={(e) => setMsic(e.target.value)} />
              </label>
              <label className="wide">
                Business Activity
                <input
                  value={businessActivity}
                  onChange={(e) => setBusinessActivity(e.target.value)}
                />
              </label>
            </div>
          )}
          {category === "island" ? (
            <div className="selection-card">
              <label className={validationErrors.includes("package") ? "field-invalid" : ""} data-field="package">
                海岛配套 *
                <select
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                >
                  <option value="">请选择配套</option>
                  {filteredPackages.map((o) => (
                    <option key={o.id}>{o.label}</option>
                  ))}
                  <option value="CUSTOM">其他／Custom</option>
                </select>
              </label>
              {packageName === "CUSTOM" && (
                <label className={validationErrors.includes("custom-package") ? "field-invalid" : ""} data-field="custom-package">
                  自定义配套 *
                  <input
                    value={customPackage}
                    onChange={(e) => setCustomPackage(e.target.value)}
                  />
                </label>
              )}
              {finalPackage &&
                (isDayTrip ? (
                  <>
                    <label className={validationErrors.includes("stay") ? "field-invalid" : ""} data-field="stay">
                      一日游路线 *
                      <select
                        value={tourName}
                        onChange={(e) => setTourName(e.target.value)}
                      >
                        <option value="">请选择路线</option>
                        {options
                          .filter(
                            (o) => o.option_group === "day_trip" && o.active,
                          )
                          .map((o) => (
                            <option key={o.id}>{o.label}</option>
                          ))}
                        <option value="CUSTOM">其他／Custom</option>
                      </select>
                    </label>
                    {tourName === "CUSTOM" && (
                      <label className={validationErrors.includes("custom-stay") ? "field-invalid" : ""} data-field="custom-stay">
                        自定义路线 *
                        <input
                          value={customTour}
                          onChange={(e) => setCustomTour(e.target.value)}
                        />
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label className={validationErrors.includes("stay") ? "field-invalid" : ""} data-field="stay">
                      Resort *
                      <select
                        value={resortName}
                        onChange={(e) => setResortName(e.target.value)}
                      >
                        <option value="">请选择Resort</option>
                        {options
                          .filter(
                            (o) => o.option_group === "resort" && o.active,
                          )
                          .map((o) => (
                            <option key={o.id}>{o.label}</option>
                          ))}
                        <option value="CUSTOM">其他／Custom</option>
                      </select>
                    </label>
                    {resortName === "CUSTOM" && (
                      <label className={validationErrors.includes("custom-stay") ? "field-invalid" : ""} data-field="custom-stay">
                        自定义Resort *
                        <input
                          value={customResort}
                          onChange={(e) => setCustomResort(e.target.value)}
                        />
                      </label>
                    )}
                  </>
                ))}
              {days > 0 && <small>已按 {days} 天行程筛选合适配套</small>}
            </div>
          ) : (
            <label className={`wide ${validationErrors.includes("trip") ? "field-invalid" : ""}`} data-field="trip">
              行程／Hotel Booking详情 *
              <textarea
                value={customTrip}
                onChange={(e) => setCustomTrip(e.target.value)}
                placeholder="例如：4D3N Bangkok Private Tour / Hotel Booking..."
              />
            </label>
          )}
          <div className="form-title item-title">
            <h2>项目与价格</h2>
            <p>可加入不同房型、交通、门票或自定义项目。</p>
          </div>
          <div className="line-builder">
            {items.map((i, n) => (
              <div className={`line-edit ${validationErrors.includes(`item-${n}`) ? "field-invalid" : ""}`} data-field={`item-${n}`} key={n}>
                <div className="item-type-cell">
                  <select
                    value={i.item_type}
                    onChange={(e) => edit(n, "item_type", e.target.value)}
                  >
                    <option>Room</option>
                    <option>Package</option>
                    <option>Activities</option>
                    <option>Transport</option>
                    <option>Ticket</option>
                    <option>Other</option>
                  </select>
                  {i.item_type === "Other" && (
                    <input
                      value={i.custom_type}
                      onChange={(e) => edit(n, "custom_type", e.target.value)}
                      placeholder="Custom item name"
                    />
                  )}
                </div>
                <textarea
                  placeholder="Description"
                  value={i.description}
                  onChange={(e) => edit(n, "description", e.target.value)}
                />
                <input
                  type="number"
                  value={i.quantity}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => edit(n, "quantity", +e.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  value={i.unit_price === 0 ? "" : i.unit_price}
                  placeholder="0.00"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => edit(n, "unit_price", +e.target.value)}
                />
                <b>{formatAmount(i.quantity * i.unit_price)}</b>
                <button
                  onClick={() => setItems((x) => x.filter((_, j) => j !== n))}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="add-line"
              onClick={() =>
                setItems((x) => [
                  ...x,
                  {
                    item_type: "Other",
                    custom_type: "",
                    description: "",
                    quantity: 1,
                    unit_price: 0,
                  },
                ])
              }
            >
              ＋ 增加 Item／房型
            </button>
            <div className="discount-line">
              <strong>Total　{formatAmount(subtotal)}</strong>
            </div>
          </div>
          <div className="form-title item-title">
            <h2>Payment Schedule</h2>
            <p>Optional — only add this when the customer pays by Deposit or instalments. For Full Payment, leave this section empty. Due Date is optional.</p>
          </div>
          <div className="schedule-builder">
            <div className="schedule-head">
              <span>Payment</span>
              <span>Amount</span>
              <span>Due Date (Optional)</span>
              <span />
            </div>
            {schedules.map((row, n) => (
              <div className={`schedule-row ${validationErrors.includes(`schedule-${n}`) ? "field-invalid" : ""}`} data-field={`schedule-${n}`} key={n}>
                <div>
                  <select
                    value={row.stage_name}
                    onChange={(e) =>
                      editSchedule(n, "stage_name", e.target.value)
                    }
                  >
                    <option>Deposit</option>
                    <option>2nd Payment</option>
                    <option>3rd Payment</option>
                    <option>Balance</option>
                    <option>Custom</option>
                  </select>
                  {row.stage_name === "Custom" && (
                    <input
                      value={row.custom_name || ""}
                      onChange={(e) =>
                        editSchedule(n, "custom_name", e.target.value)
                      }
                      placeholder="Payment name"
                    />
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={row.amount === 0 ? "" : row.amount}
                  placeholder="0.00"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => editSchedule(n, "amount", +e.target.value)}
                />
                <input
                  type="date"
                  value={row.due_date}
                  onChange={(e) => editSchedule(n, "due_date", e.target.value)}
                />
                <button
                  onClick={() =>
                    setSchedules((list) =>
                      list.filter((_, index) => index !== n),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="schedule-foot">
              <button
                className="add-line"
                onClick={() =>
                  setSchedules((list) => [
                    ...list,
                    {
                      stage_name: list.length ? "2nd Payment" : "Deposit",
                      amount: 0,
                      due_date: "",
                    },
                  ])
                }
              >
                ＋ Add Payment
              </button>
              {schedules.length > 0 && (
                <span
                  className={
                    Math.abs(scheduleTotal - subtotal) < 0.01
                      ? "schedule-ok"
                      : "schedule-warn"
                  }
                >
                  Scheduled {formatAmount(scheduleTotal)} / Total{" "}
                  {formatAmount(subtotal)}
                </span>
              )}
            </div>
            {schedules.length > 0 && scheduleTotal > subtotal + 0.01 && (
              <div className="schedule-error-message">
                Payment Schedule exceeds PI Total by{" "}
                {formatAmount(scheduleTotal - subtotal)}. Please reduce the
                Balance or another payment amount before continuing.
              </div>
            )}
          </div>
          <div className="actions">
            <span />
            <button
              className="primary"
              disabled={busy}
              onClick={openPreview}
            >
              下一步 · Preview Invoice →
            </button>
          </div>
        </section>
        <section className="panel summary">
          <h3>PI Summary</h3>
          <span>
            Sales<b>{profile.full_name}</b>
          </span>
          <span>
            Departure Month<b>{departure.slice(5, 7) || "—"}</b>
          </span>
          <span>
            Items<b>{items.length}</b>
          </span>
          <hr />
          <span>
            Subtotal<b>{formatAmount(subtotal)}</b>
          </span>
          <strong>
            Total<b>{formatAmount(subtotal)}</b>
          </strong>
          {schedules.map((row, n) => (
            <span key={n}>
              {row.stage_name === "Custom"
                ? row.custom_name || "Custom"
                : row.stage_name}
              <b>{formatAmount(row.amount)}</b>
            </span>
          ))}
          {schedules.length > 0 && <span
            className={Math.abs(subtotal - scheduleTotal) < 0.01 ? "good" : "warn"}
          >
            Remaining to allocate<b>{formatAmount(subtotal - scheduleTotal)}</b>
          </span>}
          <p>
            New Booking will generate its Tour Code when this PI enters On Hold.
          </p>
        </section>
      </div>
    </>
  );
}

function Notifications({ goToOrders }: { goToOrders: () => void }) {
  const [list, setList] = useState<any[]>([]),
    [selected, setSelected] = useState<any | null>(null),
    [invoiceRecord, setInvoiceRecord] = useState<any | null>(null),
    [invoiceUrl, setInvoiceUrl] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("notifications").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setList(data || []));
  }, []);
  async function markRead(notification: any) {
    if (!notification.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id);
      setList((rows) => rows.map((n) => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n));
    }
  }
  async function openNotification(notification: any) {
    setSelected(notification);
    setInvoiceRecord(null);
    setInvoiceUrl("");
    await markRead(notification);
    if (notification.kind !== "invoice_ready" || !notification.order_id) return;
    setBusy(true);
    const { data, error } = await supabase.from("invoices").select("*")
      .eq("order_id", notification.order_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) {
      setBusy(false);
      return;
    }
    if (data) {
      setInvoiceRecord(data);
      const signed = await supabase.storage.from("official-invoices").createSignedUrl(data.file_path, 3600);
      if (signed.data) setInvoiceUrl(signed.data.signedUrl);
    }
    setBusy(false);
  }
  async function downloadInvoice() {
    if (!invoiceUrl || !invoiceRecord) return;
    const response = await fetch(invoiceUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Invoice - ${invoiceRecord.invoice_number}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <Head eyebrow="NOTIFICATIONS" title="通知中心" sub="点击通知可查看正式Invoice或处理退回的Bank Slip任务。" />
    <section className="panel notification-list">
      {list.length ? list.map((n) => (
        <article key={n.id} className={n.read_at ? "" : "unread"}>
          <i>{n.kind === "invoice_ready" ? "IV" : n.kind === "bank_slip_rejected" ? "!" : "$"}</i>
          <div><small>{n.kind}</small><h3>{n.title}</h3><p>{n.message}</p><time>{new Date(n.created_at).toLocaleString("zh-MY")}</time></div>
          {(n.kind === "invoice_ready" || n.kind === "bank_slip_rejected") ? (
            <button className={n.kind === "bank_slip_rejected" ? "danger-action" : "primary"} onClick={() => openNotification(n)}>
              {n.kind === "invoice_ready" ? "View Invoice" : "处理 Task"}
            </button>
          ) : !n.read_at ? <button className="secondary" onClick={() => markRead(n)}>标记已读</button> : null}
        </article>
      )) : <div className="empty">暂时没有通知</div>}
    </section>
    {selected && <div className="modal-back"><div className="modal notification-detail">
      <button className="modal-x" onClick={() => setSelected(null)}>×</button>
      <small>{selected.kind === "invoice_ready" ? "INVOICE READY" : "ACTION REQUIRED"}</small>
      <h2>{selected.title}</h2><p>{selected.message}</p>
      {selected.kind === "invoice_ready" ? <>
        {busy ? <div className="empty">正在读取Invoice…</div> : invoiceRecord ? <div className="notification-file"><span><small>Invoice Number</small><b>{invoiceRecord.invoice_number}</b></span><button className="row-action" onClick={() => window.open(invoiceUrl, "_blank", "noopener,noreferrer")}>Preview</button><button className="primary" onClick={downloadInvoice}>Download Invoice</button></div> : <div className="auth-message">暂时找不到正式Invoice文件，请联系Account。</div>}
      </> : <>
        <div className="task-reason"><b>Account退回原因</b><span>{selected.message?.split(" · ").slice(1).join(" · ") || selected.message}</span></div>
        <button className="primary" onClick={() => { setSelected(null); goToOrders(); }}>前往我的订单重新上传</button>
      </>}
    </div></div>}
  </>;
}

function NotificationsLegacy() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setList(data || []));
  }, []);
  async function read(id: string) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    setList((x) => x.map((n) => (n.id === id ? { ...n, read_at: true } : n)));
  }
  return (
    <>
      <Head
        eyebrow="NOTIFICATIONS"
        title="通知中心"
        sub="成单与正式Invoice会自动传到相关岗位。"
      />
      <section className="panel notification-list">
        {list.length ? (
          list.map((n) => (
            <article key={n.id} className={n.read_at ? "" : "unread"}>
              <i>{n.kind === "invoice_ready" ? "IV" : "$"}</i>
              <div>
                <small>{n.kind}</small>
                <h3>{n.title}</h3>
                <p>{n.message}</p>
                <time>{new Date(n.created_at).toLocaleString("zh-MY")}</time>
              </div>
              {!n.read_at && (
                <button className="secondary" onClick={() => read(n.id)}>
                  标记已读
                </button>
              )}
            </article>
          ))
        ) : (
          <div className="empty">暂时没有通知</div>
        )}
      </section>
    </>
  );
}
function Account({
  orders,
  refresh,
  notify,
}: {
  orders: Order[];
  refresh: () => void;
  notify: (s: string) => void;
}) {
  type AccountTab = "todo" | "pending" | "completed";
  const [tab, setTab] = useState<AccountTab>("todo"),
    [selected, setSelected] = useState<Order | null>(null),
    [payments, setPayments] = useState<any[]>([]),
    [invoices, setInvoices] = useState<any[]>([]),
    [officialReceipts, setOfficialReceipts] = useState<any[]>([]),
    [amendments, setAmendments] = useState<any[]>([]),
    [accountItems, setAccountItems] = useState<any[]>([]),
    [bankSlipUrl, setBankSlipUrl] = useState(""),
    [documentUrls, setDocumentUrls] = useState<Record<string, string>>({}),
    [previewOrder, setPreviewOrder] = useState<Order | null>(null),
    [invoiceNumber, setInvoiceNumber] = useState(""),
    [invoiceFile, setInvoiceFile] = useState<File | null>(null),
    [orNumber, setOrNumber] = useState(""),
    [orFile, setOrFile] = useState<File | null>(null),
    [rejecting, setRejecting] = useState(false),
    [rejectReason, setRejectReason] = useState("Bank Slip amount does not match"),
    [customRejectReason, setCustomRejectReason] = useState(""),
    [busy, setBusy] = useState(false);

  const urgentSort = (a:Order,b:Order) => Number(Boolean(b.urgent))-Number(Boolean(a.urgent)) || new Date(b.last_reminded_at || b.urgent_marked_at || 0).getTime()-new Date(a.last_reminded_at || a.urgent_marked_at || 0).getTime();
  const categorized = {
    todo: orders.filter((o) => o.status === "awaiting_invoice").sort(urgentSort),
    pending: orders.filter(
      (o) => o.status === "invoiced" && Number(o.paid_amount) < Number(o.total_amount),
    ),
    completed: orders.filter(
      (o) => o.status === "completed" ||
        (o.status === "invoiced" && Number(o.paid_amount) >= Number(o.total_amount)),
    ),
  };

  async function refreshRecords() {
    if (!orders.length) {
      setPayments([]);
      setInvoices([]);
      setOfficialReceipts([]);
      setAmendments([]);
      return;
    }
    const ids = orders.map((o) => o.id);
    const [p, i, r, a] = await Promise.all([
      supabase.from("payments").select("*").in("order_id", ids).order("created_at"),
      supabase.from("invoices").select("*").in("order_id", ids).order("created_at"),
      supabase.from("account_official_receipts").select("*").in("order_id", ids).order("created_at"),
      supabase.from("amendment_requests").select("*").in("order_id",ids).order("created_at",{ascending:false}),
    ]);
    const error = p.error || i.error || r.error || a.error;
    if (error) notify(error.message);
    else {
      setPayments(p.data || []);
      setInvoices(i.data || []);
      setOfficialReceipts(r.data || []);
      setAmendments(a.data || []);
    }
  }

  useEffect(() => {
    void refreshRecords();
  }, [orders.map((o) => `${o.id}:${o.status}:${o.paid_amount}`).join("|")]);

  useEffect(() => {
    const queue = categorized[tab];
    if (!selected || !queue.some((o) => o.id === selected.id))
      setSelected(queue[0] || null);
  }, [tab, orders.map((o) => `${o.id}:${o.status}:${o.paid_amount}`).join("|")]);

  useEffect(() => {
    setAccountItems([]);
    setBankSlipUrl("");
    setDocumentUrls({});
    setInvoiceNumber("");
    setInvoiceFile(null);
    setOrNumber("");
    setOrFile(null);
    if (!selected) return;
    supabase
      .from("order_items")
      .select("id,item_type,description,quantity,unit_price,sort_order")
      .eq("order_id", selected.id)
      .order("sort_order")
      .then(({ data, error }) =>
        error ? notify(error.message) : setAccountItems(data || []),
      );
    if (selected.bank_slip_path)
      supabase.storage
        .from("bank-slips")
        .createSignedUrl(selected.bank_slip_path, 3600)
        .then(({ data, error }) =>
          error ? notify(error.message) : setBankSlipUrl(data.signedUrl),
        );
    const selectedInvoices = invoices.filter((i) => i.order_id === selected.id);
    const selectedORs = officialReceipts.filter((r) => r.order_id === selected.id);
    Promise.all([
      ...selectedInvoices.map(async (doc) => {
        const { data } = await supabase.storage.from("official-invoices").createSignedUrl(doc.file_path, 3600);
        return data ? [`invoice:${doc.id}`, data.signedUrl] as const : null;
      }),
      ...selectedORs.map(async (doc) => {
        const { data } = await supabase.storage.from("official-receipts").createSignedUrl(doc.file_path, 3600);
        return data ? [`or:${doc.id}`, data.signedUrl] as const : null;
      }),
    ]).then((entries) => setDocumentUrls(Object.fromEntries(entries.filter(Boolean) as any)));
  }, [selected?.id, invoices.length, officialReceipts.length]);

  const selectedPayments = payments.filter((p) => p.order_id === selected?.id);
  const activeSelectedPayments = selectedPayments.filter((p) => p.review_status !== "rejected");
  const processedPaymentIds = new Set([
    ...invoices.map((i) => i.payment_id).filter(Boolean),
    ...officialReceipts.map((r) => r.payment_id).filter(Boolean),
  ]);
  const currentPayment = [...activeSelectedPayments]
    .reverse()
    .find((p) => !processedPaymentIds.has(p.id)) || activeSelectedPayments.at(-1);

  async function copyDescription(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Description已复制，可以直接Paste到正式Invoice");
    } catch {
      notify("无法自动复制，请长按文字手动Copy");
    }
  }
  async function copyCustomerField(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label}已复制`);
    } catch {
      notify("无法自动复制，请选中文字手动Copy");
    }
  }

  async function downloadUrl(url: string, filename: string) {
    const response = await fetch(url);
    const blob = await response.blob();
    const localUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = localUrl;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
  }

  async function uploadDocuments() {
    if (!selected || !currentPayment || !invoiceFile || !orFile || !invoiceNumber.trim() || !orNumber.trim()) return;
    setBusy(true);
    const stamp = Date.now();
    const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const invoicePath = `${selected.id}/${stamp}-${safe(invoiceFile.name)}`;
    const orPath = `${selected.id}/${stamp}-${safe(orFile.name)}`;
    const [invoiceUpload, orUpload] = await Promise.all([
      supabase.storage.from("official-invoices").upload(invoicePath, invoiceFile),
      supabase.storage.from("official-receipts").upload(orPath, orFile),
    ]);
    if (invoiceUpload.error || orUpload.error) {
      notify((invoiceUpload.error || orUpload.error)!.message);
      setBusy(false);
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user!.id;
    let invoice = invoices.find((i) => i.payment_id === currentPayment.id);
    if (!invoice) {
      const result = await supabase.from("invoices").insert({
        order_id: selected.id,
        payment_id: currentPayment.id,
        invoice_number: invoiceNumber.trim(),
        file_path: invoicePath,
        uploaded_by: userId,
      }).select().single();
      if (result.error) {
        notify(result.error.message);
        setBusy(false);
        return;
      }
      invoice = result.data;
    }
    if (!officialReceipts.some((r) => r.payment_id === currentPayment.id)) {
      const result = await supabase.from("account_official_receipts").insert({
        order_id: selected.id,
        payment_id: currentPayment.id,
        invoice_id: invoice.id,
        or_number: orNumber.trim(),
        file_path: orPath,
        recorded_by: userId,
      });
      if (result.error) {
        notify(result.error.message);
        setBusy(false);
        return;
      }
    }
    const reviewResult = await supabase.rpc("review_bank_slip", {
      p_payment_id: currentPayment.id,
      p_status: "accepted",
      p_reason: null,
    });
    if (reviewResult.error) {
      notify(reviewResult.error.message);
      setBusy(false);
      return;
    }
    const fullyPaid = Number(selected.paid_amount) >= Number(selected.total_amount);
    const invoiceReadyUpdate = await supabase
      .from("orders")
      .update({ status: "invoiced" })
      .eq("id", selected.id);
    const completionUpdate = fullyPaid && !invoiceReadyUpdate.error
      ? await supabase.from("orders").update({ status: "completed" }).eq("id", selected.id)
      : null;
    setBusy(false);
    if (invoiceReadyUpdate.error || completionUpdate?.error)
      notify((invoiceReadyUpdate.error || completionUpdate?.error)!.message);
    else {
      notify(fullyPaid ? "Invoice与OR已完成，订单移至已完成" : "Deposit Invoice与OR已完成，订单移至等待Balance");
      setSelected(null);
      await refreshRecords();
      refresh();
    }
  }

  async function rejectBankSlip() {
    if (!currentPayment) return;
    const reason = rejectReason === "Other" ? customRejectReason.trim() : rejectReason;
    if (!reason) {
      notify("请填写退回原因");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("review_bank_slip", {
      p_payment_id: currentPayment.id,
      p_status: "rejected",
      p_reason: reason,
    });
    setBusy(false);
    if (error) notify(error.message);
    else {
      notify("Bank Slip已退回，Sales已收到待处理Task");
      setRejecting(false);
      setSelected(null);
      await refreshRecords();
      refresh();
    }
  }
  async function startProcessing() {
    if(!selected) return;
    const {data:auth}=await supabase.auth.getUser();
    const {error}=await supabase.from("orders").update({account_processing_at:new Date().toISOString(),account_processing_by:auth.user!.id}).eq("id",selected.id);
    if(error) notify(error.message); else {notify("已标记Account Processing，Sales将不能继续催单");refresh();}
  }
  async function reviewAmendment(request:any,status:"approved"|"rejected") {
    const note=window.prompt(status==="approved"?"Approval note（Optional）":"Reason for rejection") || "";
    if(status==="rejected"&&!note.trim()) return;
    const {error}=await supabase.rpc("review_amendment",{p_request_id:request.id,p_status:status,p_note:note||null});
    if(error) notify(error.message); else {notify(status==="approved"?"Amendment已批准并更新订单":"Amendment已退回给Sales");await refreshRecords();refresh();}
  }

  const selectedInvoices = invoices.filter((i) => i.order_id === selected?.id);
  const selectedORs = officialReceipts.filter((r) => r.order_id === selected?.id);
  const selectedAmendments = amendments.filter((a)=>a.order_id===selected?.id && a.status==="pending");
  const customerCopyFields: [string, string | null | undefined][] = selected
    ? [
        [selected.customer_type === "company" ? "Company Full Name" : "Customer Name", selected.customer_name],
        ["Phone Number", selected.phone],
        ["Email Address", selected.email],
        ["Billing Address", selected.billing_address],
        ...(selected.customer_type === "company"
          ? ([
              ["Business Registration No. (NEW)", selected.company_registration_new],
              ["Business Registration No. (OLD)", selected.company_registration_old],
              ["Tax Identification Number (TIN)", selected.tax_identification_number],
              ["Sales & Service Tax Number (SST)", selected.sst_number],
              ["MSIC Code", selected.msic_code],
              ["Business Activity", selected.business_activity],
            ] as [string, string | null | undefined][])
          : []),
      ]
    : [];
  return (
    <>
      <Head eyebrow="ACCOUNT WORKSPACE" title="正式开票" sub="审核收款，为每次Payment上传正式Invoice和Official Receipt。" />
      <div className="account-tabs">
        <button className={tab === "todo" ? "active" : ""} onClick={() => setTab("todo")}>未处理 <b>{categorized.todo.length}</b></button>
        <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>等待Balance <b>{categorized.pending.length}</b></button>
        <button className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>已完成 <b>{categorized.completed.length}</b></button>
      </div>
      <div className="account-grid">
        <section className="panel queue">
          <h3>{tab === "todo" ? "完全未处理" : tab === "pending" ? "Deposit已处理" : "Full Payment已完成"} · {categorized[tab].length}</h3>
          {categorized[tab].map((o) => (
            <button className={`${selected?.id === o.id ? "on" : ""} ${o.urgent ? "urgent-queue-item" : ""}`} key={o.id} onClick={() => setSelected(o)}>
              <span><b>{o.team_number}</b><small>{o.customer_name}</small>{o.urgent && <mark className="urgent-badge">URGENT</mark>}</span>
              <b>{o.currency || "MYR"} {Number(o.paid_amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</b>
              <small>{Number(o.paid_amount) >= Number(o.total_amount) ? "Full Payment" : `Balance ${o.currency || "MYR"} ${(Number(o.total_amount) - Number(o.paid_amount)).toFixed(2)}`}</small>
            </button>
          ))}
          {!categorized[tab].length && <div className="empty">这个分类暂时没有订单</div>}
        </section>
        <section className="panel review">
          {selected ? <>
            <div className="review-head"><div><mark className={tab === "completed" ? "green" : tab === "pending" ? "amber" : "blue"}>{tab === "completed" ? "COMPLETED" : tab === "pending" ? "WAITING BALANCE" : "ACTION REQUIRED"}</mark><h2>{selected.team_number}</h2><small>{selected.pi_number} · {selected.customer_name}</small></div><strong>{selected.currency || "MYR"} {Number(selected.paid_amount).toFixed(2)}</strong></div>
            <div className="payment"><span><small>出发日期</small><b>{selected.departure_date}</b></span><span><small>Sales</small><b>{selected.profiles?.full_name}</b></span><span><small>Total</small><b>{selected.currency || "MYR"} {Number(selected.total_amount).toFixed(2)}</b></span><span><small>Balance</small><b>{selected.currency || "MYR"} {Math.max(0, Number(selected.total_amount) - Number(selected.paid_amount)).toFixed(2)}</b></span></div>
            <section className="account-customer-copy">
              <div className="copy-heading"><span><h3>Customer / Company Billing Details</h3><small>点击个别资料即可复制到Account系统。</small></span><b>{selected.customer_type === "company" ? "COMPANY" : "PERSONAL"}</b></div>
              <div className="account-copy-fields">
                {customerCopyFields.filter(([, value]) => Boolean(value)).map(([label, value]) => (
                  <article key={label} className={label === "Billing Address" || label === "Business Activity" ? "wide-copy-field" : ""}>
                    <span><small>{label}</small><b>{value}</b></span>
                    <button className="row-action" onClick={() => copyCustomerField(label, String(value))}>Copy</button>
                  </article>
                ))}
              </div>
            </section>
            <div className="account-document-tools">
              {tab === "todo" && !selected.account_processing_at && <button className="primary" onClick={startProcessing}>Start Processing</button>}
              {selected.account_processing_at && <mark className="green">ACCOUNT PROCESSING</mark>}
              <button className="row-action" onClick={() => setPreviewOrder(selected)}>Preview Proforma Invoice</button>
              {bankSlipUrl && <><button className="row-action" onClick={() => window.open(bankSlipUrl, "_blank", "noopener,noreferrer")}>Preview / Print Bank Slip</button><button className="text-action" onClick={() => downloadUrl(bankSlipUrl, `Bank Slip - ${selected.pi_number}`)}>Download Bank Slip</button></>}
              {tab === "todo" && currentPayment && <button className="danger-action" onClick={() => setRejecting(true)}>退回 Bank Slip</button>}
            </div>
            {selectedAmendments.length>0&&<section className="amendment-review"><div className="copy-heading"><span><h3>AMENDMENT REQUEST</h3><small>Sales在Bank Slip后修改资料，批准前不会覆盖订单。</small></span><mark className="amber">ACTION REQUIRED</mark></div>{selectedAmendments.map((request)=><article key={request.id}><b>{request.reason}</b><div className="amendment-compare"><pre><small>BEFORE</small>{JSON.stringify(request.original_values,null,2)}</pre><pre><small>PROPOSED</small>{JSON.stringify(request.proposed_values,null,2)}</pre></div><div className="review-actions"><button className="danger-action" onClick={()=>reviewAmendment(request,"rejected")}>Reject</button><button className="confirm" onClick={()=>reviewAmendment(request,"approved")}>Approve & Update</button></div></article>)}</section>}
            <section className="copy-descriptions"><div className="copy-heading"><span><h3>Copy Invoice Description</h3><small>每个Item可以独立复制到正式Invoice。</small></span><b>{accountItems.length} Columns</b></div><div className="copy-description-grid">
              {accountItems.map((item, index) => { const text = index === 0 ? `Date: ${selected.departure_date}${selected.return_date ? ` - ${selected.return_date}` : ""}\nPackage: ${selected.package_name || selected.trip_name}\n${item.description}` : item.description; return <article key={item.id}><small>Column {index + 1} · {item.item_type}</small><pre>{text}</pre><button className="secondary" onClick={() => copyDescription(text)}>Copy Column {index + 1}</button></article>; })}
            </div></section>
            {(selectedInvoices.length > 0 || selectedORs.length > 0) && <section className="uploaded-account-docs"><h3>已上传的Account文件</h3>{selectedPayments.map((payment) => { const inv = selectedInvoices.find((i) => i.payment_id === payment.id); const receipt = selectedORs.find((r) => r.payment_id === payment.id); if (!inv && !receipt) return null; return <article key={payment.id}><span><small>{payment.payment_date}</small><b>{selected.currency || "MYR"} {Number(payment.amount).toFixed(2)}</b></span>{inv && <button onClick={() => window.open(documentUrls[`invoice:${inv.id}`], "_blank")}>Invoice {inv.invoice_number}</button>}{receipt && <button onClick={() => window.open(documentUrls[`or:${receipt.id}`], "_blank")}>OR {receipt.or_number}</button>}</article>; })}</section>}
            {tab === "todo" && <section className="account-issue-docs"><h3>本次收款开票</h3><p>{currentPayment ? `${currentPayment.payment_date} · ${selected.currency || "MYR"} ${Number(currentPayment.amount).toFixed(2)}` : "正在读取本次Payment…"}</p><div className="account-doc-grid"><label>Invoice Number<input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Invoice No." /></label><label>Official Receipt (OR) Number<input value={orNumber} onChange={(e) => setOrNumber(e.target.value)} placeholder="OR No." /></label><label className="document-upload"><input type="file" accept=".pdf,image/*" onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} /><b>{invoiceFile ? invoiceFile.name : "＋ Upload Official Invoice"}</b></label><label className="document-upload"><input type="file" accept=".pdf,image/*" onChange={(e) => setOrFile(e.target.files?.[0] || null)} /><b>{orFile ? orFile.name : "＋ Upload Official Receipt (OR)"}</b></label></div><div className="review-actions"><button className="confirm" disabled={!currentPayment || !invoiceFile || !orFile || !invoiceNumber.trim() || !orNumber.trim() || busy} onClick={uploadDocuments}>{busy ? "上传中…" : "完成Invoice与OR"}</button></div></section>}
          </> : <div className="empty">请选择订单</div>}
        </section>
      </div>
      {previewOrder && <PIHistoryPreview order={previewOrder} close={() => setPreviewOrder(null)} />}
      {rejecting && <div className="modal-back"><div className="modal reject-slip-modal">
        <button className="modal-x" onClick={() => setRejecting(false)}>×</button>
        <small>RETURN BANK SLIP</small><h2>退回给Sales重新处理</h2>
        <p>退回后，此次收款不会计入Paid Amount；Sales会收到一项待处理通知。</p>
        <label>退回原因<select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
          <option>Bank Slip amount does not match</option><option>Bank Slip image is unclear</option><option>Wrong Bank Slip uploaded</option><option>Duplicate Bank Slip</option><option>Other</option>
        </select></label>
        {rejectReason === "Other" && <label>Other Reason<textarea value={customRejectReason} onChange={(e) => setCustomRejectReason(e.target.value)} placeholder="填写退回原因" /></label>}
        <div className="review-actions"><button className="secondary" onClick={() => setRejecting(false)}>取消</button><button className="danger-action" disabled={busy || (rejectReason === "Other" && !customRejectReason.trim())} onClick={rejectBankSlip}>{busy ? "处理中…" : "确认退回"}</button></div>
      </div></div>}
    </>
  );
}

function AccountLegacy({
  orders,
  refresh,
  notify,
}: {
  orders: Order[];
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState<Order | null>(orders[0] || null),
    [iv, setIv] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [accountItems, setAccountItems] = useState<any[]>([]),
    [slipUrl, setSlipUrl] = useState(""),
    [previewOrder, setPreviewOrder] = useState<Order | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setAccountItems([]);
    setSlipUrl("");
    if (!selected) return;
    supabase
      .from("order_items")
      .select("id,item_type,description,quantity,unit_price,sort_order")
      .eq("order_id", selected.id)
      .order("sort_order")
      .then(({ data, error }) =>
        error ? notify(error.message) : setAccountItems(data || []),
      );
    if (selected.bank_slip_path)
      supabase.storage
        .from("bank-slips")
        .createSignedUrl(selected.bank_slip_path, 3600)
        .then(({ data, error }) =>
          error ? notify(error.message) : setSlipUrl(data.signedUrl),
        );
  }, [selected?.id]);
  async function copyDescription(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Description已复制，可以直接Paste到正式Invoice");
    } catch {
      notify("无法自动复制，请长按文字手动Copy");
    }
  }
  async function downloadSlip() {
    if (!slipUrl || !selected) return;
    const response = await fetch(slipUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Bank Slip - ${selected.pi_number}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload() {
    if (!selected || !file) return;
    setBusy(true);
    const path = `${selected.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage
      .from("official-invoices")
      .upload(path, file);
    if (up.error) {
      notify(up.error.message);
      setBusy(false);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const r = await supabase.from("invoices").insert({
      order_id: selected.id,
      invoice_number: iv,
      file_path: path,
      uploaded_by: user!.id,
    });
    if (!r.error)
      await supabase
        .from("orders")
        .update({ status: "invoiced" })
        .eq("id", selected.id);
    setBusy(false);
    r.error
      ? notify(r.error.message)
      : (notify("正式Invoice已上传，Sales已收到通知"),
        refresh(),
        setSelected(null));
  }
  return (
    <>
      <Head
        eyebrow="ACCOUNT WORKSPACE"
        title="正式开票"
        sub="审核成单资料并上传正式Invoice。"
      />
      <div className="account-grid">
        <section className="panel queue">
          <h3>等待开票 · {orders.length}</h3>
          {orders.map((o) => (
            <button
              className={selected?.id === o.id ? "on" : ""}
              key={o.id}
              onClick={() => {
                setSelected(o);
                setIv("");
                setFile(null);
              }}
            >
              <span>
                <b>{o.team_number}</b>
                <small>{o.customer_name}</small>
              </span>
              <b>{money(o.total_amount)}</b>
            </button>
          ))}
        </section>
        <section className="panel review">
          {selected ? (
            <>
              <div className="review-head">
                <div>
                  <mark className="blue">BANK SLIP RECEIVED</mark>
                  <h2>{selected.team_number}</h2>
                  <small>
                    {selected.pi_number} · {selected.customer_name}
                  </small>
                </div>
                <strong>{money(selected.paid_amount)}</strong>
              </div>
              <div className="payment">
                <span>
                  <small>出发日期</small>
                  <b>{selected.departure_date}</b>
                </span>
                <span>
                  <small>Sales</small>
                  <b>{selected.profiles?.full_name}</b>
                </span>
                <span>
                  <small>总额</small>
                  <b>{money(selected.total_amount)}</b>
                </span>
                <span>
                  <small>已收</small>
                  <b>{money(selected.paid_amount)}</b>
                </span>
              </div>
              <div className="account-document-tools">
                <button className="row-action" onClick={() => setPreviewOrder(selected)}>
                  Preview Proforma Invoice
                </button>
                {slipUrl && (
                  <>
                    <button className="row-action" onClick={() => window.open(slipUrl, "_blank", "noopener,noreferrer")}>
                      Preview / Print Bank Slip
                    </button>
                    <button className="text-action" onClick={downloadSlip}>
                      Download Bank Slip
                    </button>
                  </>
                )}
              </div>
              <section className="copy-descriptions">
                <div className="copy-heading">
                  <span>
                    <h3>Copy Invoice Description</h3>
                    <small>每个Item可以独立复制到正式Invoice。</small>
                  </span>
                  <b>{accountItems.length} Columns</b>
                </div>
                <div className="copy-description-grid">
                  {accountItems.map((item, index) => {
                    const text = index === 0
                      ? `Date: ${selected.departure_date}${selected.return_date ? ` - ${selected.return_date}` : ""}\nPackage: ${selected.package_name || selected.trip_name}\n${item.description}`
                      : item.description;
                    return (
                      <article key={item.id}>
                        <small>Column {index + 1} · {item.item_type}</small>
                        <pre>{text}</pre>
                        <button className="secondary" onClick={() => copyDescription(text)}>
                          Copy Column {index + 1}
                        </button>
                      </article>
                    );
                  })}
                  {!accountItems.length && <div className="empty">正在读取PI Items…</div>}
                </div>
              </section>
              <div className="invoice">
                <label className="wide">
                  Invoice Number
                  <input
                    value={iv}
                    onChange={(e) => setIv(e.target.value)}
                    placeholder="IV-2608-001"
                  />
                </label>
                <label>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <b>{file ? file.name : "＋ 选择正式Invoice"}</b>
                  <small>PDF、JPG或PNG</small>
                </label>
              </div>
              <div className="review-actions">
                <button
                  className="confirm"
                  disabled={!file || !iv || busy}
                  onClick={upload}
                >
                  {busy ? "上传中…" : "完成开票并通知Sales"}
                </button>
              </div>
            </>
          ) : (
            <div className="empty">请选择订单</div>
          )}
        </section>
      </div>
      {previewOrder && (
        <PIHistoryPreview order={previewOrder} close={() => setPreviewOrder(null)} />
      )}
    </>
  );
}
function Costing({
  orders,
  refresh,
  notify,
}: {
  orders: Order[];
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [order, setOrder] = useState(orders[0]?.id || ""),
    [cat, setCat] = useState("Hotel"),
    [desc, setDesc] = useState(""),
    [amount, setAmount] = useState(0);
  async function add() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("costs").insert({
      order_id: order,
      category: cat,
      description: desc,
      amount,
      recorded_by: user!.id,
    });
    error
      ? notify(error.message)
      : (notify("Costing已记录，Profit与Commission已更新"), refresh());
  }
  return (
    <>
      <Head
        eyebrow="MANAGEMENT"
        title="Costing／开销"
        sub="记录实际成本后自动更新Profit与Commission。"
      />
      <section className="panel">
        <div className="inline-add">
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            {orders.map((o) => (
              <option value={o.id} key={o.id}>
                {o.team_number || o.pi_number} · {o.customer_name}
              </option>
            ))}
          </select>
          <input
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            placeholder="Category"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description"
          />
          <input
            type="number"
            inputMode="decimal"
            value={amount === 0 ? "" : amount}
            placeholder="0.00"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setAmount(+e.target.value)}
          />
          <button className="primary" onClick={add}>
            ＋ 记录开销
          </button>
        </div>
        <Table orders={orders} />
      </section>
    </>
  );
}
function Commission({
  orders,
  profile,
}: {
  orders: Order[];
  profile: Profile;
}) {
  const months = useMemo(() => {
    const m = new Map<
      string,
      { sales: number; profit: number; count: number }
    >();
    orders
      .filter((o) => !["draft", "on_hold", "cancelled"].includes(o.status))
      .forEach((o) => {
        const k = o.departure_date.slice(0, 7),
          v = m.get(k) || { sales: 0, profit: 0, count: 0 };
        v.sales += +o.total_amount;
        v.profit += +o.actual_profit;
        v.count++;
        m.set(k, v);
      });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [orders]);
  return (
    <>
      <Head
        eyebrow={profile.role === "manager" ? "MANAGEMENT" : "MY PERFORMANCE"}
        title={profile.role === "manager" ? "Commission 总览" : "我的每月业绩"}
        sub="按出发月份区分，Commission = Actual Profit × 10%。"
      />
      <div className="month-grid">
        {months.map(([k, v]) => (
          <article className="panel month-card" key={k}>
            <small>{k}</small>
            <h2>{v.count} 单</h2>
            <span>
              Sales <b>{money(v.sales)}</b>
            </span>
            <span>
              Profit <b>{money(v.profit)}</b>
            </span>
            <strong>
              Commission <b>{money(v.profit * 0.1)}</b>
            </strong>
          </article>
        ))}
        {!months.length && <div className="empty">还没有已确认订单</div>}
      </div>
    </>
  );
}
function CustomerBase({ orders }: { orders: Order[] }) {
  const [tab, setTab] = useState<"personal" | "company">("personal"),
    [search, setSearch] = useState("");
  const unique = [
    ...new Map(
      orders
        .filter((o) => o.customer_type === tab)
        .map((o) => [`${o.customer_name}|${o.phone || ""}`, o]),
    ).values(),
  ].filter((o) =>
    [o.customer_name, o.phone, o.email].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <Head
        eyebrow="MANAGEMENT · CRM"
        title="Customer Base"
        sub="Personal customers for future promotions and company clients for annual follow-up."
      />
      <div className="customer-kpis">
        <article className="kpi">
          <span>Personal Customers</span>
          <b>{orders.filter((o) => o.customer_type === "personal").length}</b>
          <small>PI records</small>
        </article>
        <article className="kpi">
          <span>Company Travel</span>
          <b>
            {
              orders.filter(
                (o) =>
                  o.customer_type === "company" && o.status !== "cancelled",
              ).length
            }
          </b>
          <small>Active / converted records</small>
        </article>
        <article className="kpi">
          <span>Cancelled PI</span>
          <b>{orders.filter((o) => o.status === "cancelled").length}</b>
          <small>Retained for conversion analysis</small>
        </article>
      </div>
      <section className="panel">
        <div className="customer-toolbar">
          <div>
            <button
              className={tab === "personal" ? "on" : ""}
              onClick={() => setTab("personal")}
            >
              Personal
            </button>
            <button
              className={tab === "company" ? "on" : ""}
              onClick={() => setTab("company")}
            >
              Company
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or email"
          />
        </div>
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Name / Company</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Tour Code</th>
                <th>Travel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {unique.map((o) => (
                <tr key={o.id}>
                  <td>
                    <b>{o.customer_name}</b>
                    {tab === "company" && (
                      <small>
                        {o.tax_identification_number || "TIN pending"}
                      </small>
                    )}
                  </td>
                  <td>{o.phone || "—"}</td>
                  <td>{o.email || "—"}</td>
                  <td>{o.team_number}</td>
                  <td>{o.trip_name}</td>
                  <td>
                    <mark
                      className={o.status === "cancelled" ? "grey" : "green"}
                    >
                      {labels[o.status] || o.status}
                    </mark>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function SecuritySettings({ profile }: { profile: Profile }) {
  const [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function changePassword() {
    setMessage("");
    if (newPassword.length < 6) {
      setMessage("新密码最少需要6个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    const login = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });
    if (login.error) {
      setBusy(false);
      setMessage("Current Password不正确。");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("密码已更新。Management已收到安全通知，但无法查看密码内容。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }
  return (
    <>
      <Head
        eyebrow="ACCOUNT SECURITY"
        title="密码设置"
        sub="使用邮箱及密码登录；每次更新密码都会留下安全通知。"
      />
      <section className="panel security-settings">
        <div className="security-status">
          <mark className="green">PASSWORD ACTIVE</mark>
          <span>
            <b>密码保护已启用</b>
            <small>所有账号均不再要求输入双重验证码。</small>
          </span>
        </div>
        <h2>Change Password</h2>
        <label>
          Current Password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label>
          New Password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm New Password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {message && <div className="auth-message">{message}</div>}
        <button
          className="primary"
          disabled={
            busy || !currentPassword || !newPassword || !confirmPassword
          }
          onClick={changePassword}
        >
          {busy ? "Updating…" : "更新密码"}
        </button>
      </section>
    </>
  );
}

type StaffRow = {
  id: string | null;
  email: string;
  full_name: string;
  role: Role;
  sales_code: string | null;
  active: boolean | null;
  must_change_password: boolean | null;
  password_changed_at: string | null;
};
function PiSettings({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<PiOption[]>([]),
    [colorRows, setColorRows] = useState<CalendarColorSetting[]>([]),
    [group, setGroup] = useState<PiOption["option_group"]>("island_package"),
    [label, setLabel] = useState(""),
    [editing, setEditing] = useState<PiOption | null>(null),
    [editLabel, setEditLabel] = useState("");
  const groupLabels = {
    island_package: "海岛配套",
    resort: "Resort",
    day_trip: "一日游路线",
  };
  async function refresh() {
    const [optionsResult, colorsResult] = await Promise.all([
      supabase.from("pi_options").select("*").order("option_group").order("sort_order"),
      supabase.from("calendar_color_settings").select("setting_key,label,color").order("label"),
    ]);
    if (optionsResult.error || colorsResult.error) notify((optionsResult.error || colorsResult.error)!.message);
    else {
      setRows((optionsResult.data || []) as PiOption[]);
      setColorRows((colorsResult.data || []) as CalendarColorSetting[]);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function add() {
    const max = Math.max(
      0,
      ...rows.filter((r) => r.option_group === group).map((r) => r.sort_order),
    );
    const { error } = await supabase.from("pi_options").insert({
      option_group: group,
      label: label.trim(),
      sort_order: max + 10,
    });
    if (error) notify(error.message);
    else {
      if ((group === "resort" || group === "day_trip") && label.trim().toUpperCase() !== "CUSTOM") {
        const settingKey = `${group === "resort" ? "resort" : "route"}:${label.trim()}`;
        await supabase.from("calendar_color_settings").upsert({ setting_key: settingKey, label: `${group === "resort" ? "海岛" : "本地／一日游"} · ${label.trim()}`, color: group === "resort" ? "#0B84D8" : "#68A62F" });
      }
      setLabel("");
      notify("PI选项已添加");
      refresh();
    }
  }
  async function save() {
    if (!editing) return;
    const { error } = await supabase
      .from("pi_options")
      .update({ label: editLabel.trim(), updated_at: new Date().toISOString() })
      .eq("id", editing.id);
    if (error) notify(error.message);
    else {
      if ((editing.option_group === "resort" || editing.option_group === "day_trip") && editing.label.toUpperCase() !== "CUSTOM") {
        const prefix = editing.option_group === "resort" ? "resort" : "route";
        await supabase.from("calendar_color_settings").update({ setting_key: `${prefix}:${editLabel.trim()}`, label: `${editing.option_group === "resort" ? "海岛" : "本地／一日游"} · ${editLabel.trim()}`, updated_at: new Date().toISOString() }).eq("setting_key", `${prefix}:${editing.label}`);
      }
      setEditing(null);
      notify("选项已更新");
      refresh();
    }
  }
  async function toggle(row: PiOption) {
    const { error } = await supabase
      .from("pi_options")
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) notify(error.message);
    else refresh();
  }
  async function updateCalendarColor(row: CalendarColorSetting, color: string) {
    setColorRows((current) => current.map((item) => item.setting_key === row.setting_key ? { ...item, color } : item));
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("calendar_color_settings").update({ color, updated_at: new Date().toISOString(), updated_by: auth.user?.id || null }).eq("setting_key", row.setting_key);
    if (error) { notify(error.message); void refresh(); } else notify(`${row.label} 的Calendar颜色已更新`);
  }
  return (
    <>
      <Head
        eyebrow="MANAGER ONLY"
        title="PI 选项设置"
        sub="这里的内容会即时成为Sales开PI时的选择；停用不会影响旧订单。"
      />
      <section className="panel option-manager">
        <div className="option-add">
          <select
            value={group}
            onChange={(e) =>
              setGroup(e.target.value as PiOption["option_group"])
            }
          >
            <option value="island_package">海岛配套</option>
            <option value="resort">Resort</option>
            <option value="day_trip">一日游路线</option>
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="输入新选项名称"
          />
          <button className="primary" disabled={!label.trim()} onClick={add}>
            ＋ 添加
          </button>
        </div>
        <div className="option-columns">
          {(["island_package", "resort", "day_trip"] as const).map((g) => (
            <div key={g}>
              <h3>{groupLabels[g]}</h3>
              {rows
                .filter((r) => r.option_group === g)
                .map((r) => (
                  <article
                    key={r.id}
                    className={r.active ? "" : "disabled-option"}
                  >
                    <span>
                      <b>{r.label}</b>
                      <small>{r.active ? "Sales可选择" : "已停用"}</small>
                    </span>
                    <button
                      className="row-action"
                      onClick={() => {
                        setEditing(r);
                        setEditLabel(r.label);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className={r.active ? "danger-action" : "text-action"}
                      onClick={() => toggle(r)}
                    >
                      {r.active ? "停用" : "启用"}
                    </button>
                  </article>
                ))}
            </div>
          ))}
        </div>
      </section>
      <section className="panel calendar-color-manager">
        <div className="panel-head"><span><h2>Calendar 颜色设置</h2><small>Manager设定后，Manager与Sales的Calendar会使用相同颜色。</small></span></div>
        <div className="calendar-color-grid">
          {colorRows.map((row) => <label key={row.setting_key}>
            <input type="color" value={row.color} onChange={(event) => updateCalendarColor(row, event.target.value)} />
            <span><b>{row.label}</b><small>{row.setting_key.startsWith("resort:") ? "Resort" : row.setting_key.startsWith("route:") ? "本地／一日游路线" : "旅游系列"}</small></span>
            <code>{row.color.toUpperCase()}</code>
          </label>)}
          <label className="fixed-custom-color"><input type="color" value="#8B929A" disabled /><span><b>Custom</b><small>固定灰色，不可修改</small></span><code>#8B929A</code></label>
        </div>
      </section>
      {editing && (
        <div className="modal-back">
          <div className="modal">
            <button className="modal-x" onClick={() => setEditing(null)}>
              ×
            </button>
            <small>EDIT PI OPTION</small>
            <h2>编辑{groupLabels[editing.option_group]}</h2>
            <label>
              显示名称
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="confirm"
                disabled={!editLabel.trim()}
                onClick={save}
              >
                储存更改
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function Staff({
  profile,
  notify,
}: {
  profile: Profile;
  notify: (s: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<Role>("sales"),
    [code, setCode] = useState(""),
    [temporaryPassword, setTemporaryPassword] = useState(""),
    [createdCredentials, setCreatedCredentials] = useState<{
      email: string;
      password: string;
    } | null>(null),
    [rows, setRows] = useState<StaffRow[]>([]),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<StaffRow | null>(null),
    [editName, setEditName] = useState(""),
    [editEmail, setEditEmail] = useState(""),
    [editCode, setEditCode] = useState(""),
    [editTemporaryPassword, setEditTemporaryPassword] = useState(""),
    [formError, setFormError] = useState(""),
    [saving, setSaving] = useState(false);
  async function refresh() {
    setLoading(true);
    const [{ data: invites, error: iErr }, { data: profiles, error: pErr }] =
      await Promise.all([
        supabase
          .from("staff_invites")
          .select("email,full_name,role,sales_code")
          .order("created_at"),
        supabase
          .from("profiles")
          .select(
            "id,email,full_name,role,sales_code,active,must_change_password,password_changed_at",
          )
          .order("created_at"),
      ]);
    if (iErr || pErr) {
      notify((iErr || pErr)!.message);
      setLoading(false);
      return;
    }
    const merged = new Map<string, StaffRow>();
    (profiles || []).forEach((p) => merged.set(p.email.toLowerCase(), {
      id: p.id, email: p.email, full_name: p.full_name, role: p.role as Role,
      sales_code: p.sales_code, active: p.active,
      must_change_password: p.must_change_password,
      password_changed_at: p.password_changed_at,
    }));
    (invites || []).forEach((i) => {
      const key = i.email.toLowerCase();
      if (!merged.has(key)) merged.set(key, {
        id: null, email: i.email, full_name: i.full_name, role: i.role as Role,
        sales_code: i.sales_code, active: null,
        must_change_password: null, password_changed_at: null,
      });
    });
    setRows([...merged.values()]);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);
  async function add() {
    setFormError("");
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanName) {
      setFormError("请填写员工姓名。");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError("请输入正确的员工Email Address。");
      return;
    }
    if (role !== "account" && !cleanCode) {
      setFormError("请填写Sales / Manager Code，例如J、S或C。");
      return;
    }
    if (temporaryPassword.length < 6) {
      setFormError("Temporary Password最少需要6个字符。");
      return;
    }
    setSaving(true);
    const createdEmail = cleanEmail;
    const createdPassword = temporaryPassword;
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: {
        action: "create",
        email: createdEmail,
        full_name: cleanName,
        role,
        sales_code: role !== "account" ? cleanCode : null,
        temporary_password: createdPassword,
      },
    });
    setSaving(false);
    if (error || data?.error) {
      const reason = data?.error || error?.message || "无法建立员工账号";
      setFormError(reason);
      notify(reason);
    }
    else {
      notify("员工账号已建立，不需要Email验证");
      setCreatedCredentials({
        email: createdEmail,
        password: createdPassword,
      });
      setEmail("");
      setName("");
      setCode("");
      setTemporaryPassword("");
      refresh();
    }
  }
  async function toggle(row: StaffRow) {
    if (!row.id) return;
    const next = !row.active;
    const { error } = await supabase
      .from("profiles")
      .update({ active: next })
      .eq("id", row.id);
    if (error) notify(error.message);
    else {
      notify(next ? "员工账号已重新启用" : "员工账号已停用，历史订单仍然保留");
      refresh();
    }
  }
  async function withdraw(row: StaffRow) {
    const { error } = await supabase
      .from("staff_invites")
      .delete()
      .eq("email", row.email);
    if (error) notify(error.message);
    else {
      notify("尚未启用的员工邀请已撤回");
      refresh();
    }
  }
  function openEdit(row: StaffRow) {
    setEditing(row);
    setEditName(row.full_name);
    setEditEmail(row.email);
    setEditCode(row.sales_code || "");
    setEditTemporaryPassword("");
  }
  async function saveEdit() {
    if (!editing) return;
    if (!editing.id && !editTemporaryPassword) {
      notify("请设置最少6个字符的登录密码，才能建立正式账号。");
      return;
    }
    if (editTemporaryPassword && editTemporaryPassword.length < 6) {
      notify("Temporary Password最少需要6个字符。");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: {
        action: editing.id ? "update" : "create",
        id: editing.id,
        old_email: editing.email,
        email: editEmail,
        full_name: editName,
        role: editing.role,
        sales_code: editing.role !== "account" ? editCode : null,
        temporary_password: editTemporaryPassword || undefined,
      },
    });
    setSaving(false);
    if (error || data?.error) {
      notify(data?.error || error?.message || "无法更新员工资料");
      return;
    }
    notify(
      !editing.id
        ? "正式员工账号已建立，可直接使用新密码登录"
        : editTemporaryPassword
        ? "员工资料与登录密码已更新，可直接使用新密码登录"
        : "员工姓名、Email和Sales Code已更新",
    );
    setEditing(null);
    refresh();
  }
  return (
    <>
      <Head
        eyebrow="MANAGER ONLY"
        title="员工登录权限"
        sub="查看已添加员工、账号状态，并随时停用。"
      />
      <section className="panel staff-list">
        <div className="panel-head">
          <span>
            <h2>员工名单</h2>
            <small>密码经过加密，Management和系统都无法查看原密码</small>
          </span>
          <b>{rows.length} 人</b>
        </div>
        {loading ? (
          <div className="empty">正在读取员工…</div>
        ) : (
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>员工</th>
                  <th>Email</th>
                  <th>岗位</th>
                  <th>Sales Code</th>
                  <th>账号状态</th>
                  <th>密码安全</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email}>
                    <td>
                      <b>{r.full_name}</b>
                    </td>
                    <td>{r.email}</td>
                    <td>
                      <span className="role-pill">{r.role}</span>
                    </td>
                    <td>
                      <b>{r.sales_code || "—"}</b>
                    </td>
                    <td>
                      {r.active === null ? (
                        <mark className="amber">尚未启用</mark>
                      ) : r.active ? (
                        <mark className="green">使用中</mark>
                      ) : (
                        <mark className="grey">已停用</mark>
                      )}
                    </td>
                    <td>
                      {r.active === null ? (
                        <small>尚未建立登录账号</small>
                      ) : r.must_change_password ? (
                        <mark className="amber">等待更换临时密码</mark>
                      ) : r.password_changed_at ? (
                        <span>
                          <b>已更换</b>
                          <small>
                            {new Date(r.password_changed_at).toLocaleString(
                              "zh-MY",
                            )}
                          </small>
                        </span>
                      ) : (
                        <small>现有账号</small>
                      )}
                    </td>
                    <td>
                      <div className="staff-actions">
                        <button
                          className="row-action"
                          onClick={() => openEdit(r)}
                        >
                          {r.id ? "Manage / Reset" : "Create Account"}
                        </button>
                        {r.id ? (
                          <button
                            className={
                              r.active ? "danger-action" : "row-action"
                            }
                            disabled={r.id === profile.id}
                            onClick={() => toggle(r)}
                          >
                            {r.id === profile.id
                              ? "当前账号"
                              : r.active
                                ? "停用账号"
                                : "重新启用"}
                          </button>
                        ) : (
                          <button
                            className="danger-action"
                            onClick={() => withdraw(r)}
                          >
                            撤回邀请
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <div className="modal-back">
          <div className="modal">
            <button className="modal-x" onClick={() => setEditing(null)}>
              ×
            </button>
            <small>MANAGEMENT · EDIT STAFF</small>
            <h2>{editing.id ? "管理员工账号" : "建立员工登录账号"}</h2>
            <p>{editing.active === null ? "尚未启用账号" : "已启用账号"}</p>
            <label>
              员工姓名
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label>
              Email Address
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </label>
            {editing.role !== "account" && (
              <label>
                Sales / Manager Code
                <input
                  maxLength={3}
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                />
              </label>
            )}
            <label>
                {editing.id ? "Reset Login Password (Optional)" : "Create Login Password *"}
                <input
                  type="text"
                  minLength={6}
                  value={editTemporaryPassword}
                  onChange={(e) => setEditTemporaryPassword(e.target.value)}
                  placeholder={editing.id ? "留空代表不更改密码" : "最少6个字符"}
                />
                <small>
                  {editing.id ? "设置后旧密码会立即失效；员工可直接使用这里的新密码登录，不会被强制再次更改。" : "这条记录目前只有员工邀请、没有登录账号。设置密码并储存后才会建立正式账号。"}
                </small>
              </label>
            <div className="onhold-note">
              <b>修改Email后</b>
              <span>员工下一次登录必须使用新的Email，原本密码保持不变。</span>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="confirm"
                disabled={
                  saving ||
                  !editName ||
                  !editEmail ||
                  (!editing.id && editTemporaryPassword.length < 6) ||
                  (editing.role !== "account" && !editCode)
                }
                onClick={saveEdit}
              >
                {saving ? "储存中…" : "储存更改"}
              </button>
            </div>
          </div>
        </div>
      )}
      <section className="panel staff-form">
        <h2>添加新员工</h2>
        {createdCredentials && (
          <div className="credential-once">
            <b>账号建立成功 · 临时密码只显示这一次</b>
            <span>Email: {createdCredentials.email}</span>
            <span>Temporary Password: {createdCredentials.password}</span>
            <button
              className="secondary"
              onClick={() => setCreatedCredentials(null)}
            >
              我已经安全地交给员工
            </button>
          </div>
        )}
        <label>
          员工姓名
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          岗位
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="sales">Sales</option>
            <option value="account">Account</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        {role !== "account" && (
          <label>
            Sales / Manager Code
            <input
              maxLength={3}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="例如 S / C / M"
            />
          </label>
        )}
        <label>
          Temporary Password
          <input
            type="text"
            minLength={6}
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            placeholder="至少6个字符"
          />
          <small>员工首次登录后必须立即更换，不会发送验证Email。</small>
        </label>
        {formError && <div className="auth-message staff-form-error">{formError}</div>}
        <button
          className="primary"
          disabled={saving}
          onClick={add}
        >
          {saving ? "正在建立…" : "建立员工账号"}
        </button>
      </section>
    </>
  );
}