import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Navigate,
  useOutletContext,
} from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  FileText,
  CalendarDays,
  LayoutDashboard,
  Plus,
  LogOut,
  Clock3,
  LockKeyhole,
} from "lucide-react";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import {
  supabase,
  demoMode,
  uploadDocument,
  documentUrl,
  type Order,
} from "../lib/supabase";
import { Button } from "../components/ui/button";
export const llcCodes = [
  "application",
  "review",
  "filed_state",
  "registered",
  "ein_requested",
  "ein_received",
];
export const itinCodes = [
  "documents",
  "caa_interview",
  "sent_irs",
  "itin_received",
];
const sample: Order = {
  id: "demo-order",
  product: "llc_wy",
  status: "ein_requested",
  created_at: "2026-09-14T12:00:00Z",
  applicant: { company: "Northway Studio LLC" },
  eligibility: "pending",
  order_status_history: llcCodes
    .slice(0, 5)
    .map((status, i) => ({
      status,
      created_at: `2026-09-${14 + i * 2}T12:00:00Z`,
      expected_by: null,
    })),
};
type AppContext = { orders: Order[]; refresh: () => void; role: string };
export function AppLayout() {
  const { t } = useI18n();
  const { session, loading, role } = useAuth();
  const [orders, setOrders] = useState<Order[]>(demoMode ? [sample] : []);
  const [error, setError] = useState("");
  function refresh() {
    if (!supabase || !session) return;
    supabase
      .from("orders")
      .select("*,order_status_history(*)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(t.error);
        else {
          setOrders(data || []);
          setError("");
        }
      });
  }
  useEffect(() => {
    if (!supabase || !session) return;
    refresh();
    const channel = supabase
      .channel("order-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        refresh,
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel);
    };
  }, [session]);
  if (loading) return <p className="container page">{t.loading}</p>;
  if (!demoMode && !session) return <Navigate to="/login" replace />;
  return (
    <div className="app-shell">
      <div className="container">
        <div className="app-top">
          <div>
            <span className="eyebrow">
              WORKSPACE / {demoMode ? "DEMO" : role.toUpperCase()}
            </span>
            <h1>{t.welcome}</h1>
            <p className="muted">{t.dashSub}</p>
          </div>
          <Button asChild>
            <Link to="/app/new">
              {t.newOrder}
              <Plus size={17} />
            </Link>
          </Button>
        </div>
        {demoMode && (
          <div className="demo-banner">
            <InfoIcon />
            {t.demo}
          </div>
        )}
        <div className="app-nav">
          <NavLink to="/app" end>
            <LayoutDashboard size={17} />
            {t.dashboard}
          </NavLink>
          <NavLink to="/app/documents">
            <FileText size={17} />
            {t.documents}
          </NavLink>
          <NavLink to="/app/deadlines">
            <CalendarDays size={17} />
            {t.deadlines}
          </NavLink>
          {session && (
            <button onClick={() => supabase?.auth.signOut()}>
              <LogOut size={17} />
              {t.signOut}
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <Outlet context={{ orders, refresh, role } satisfies AppContext} />
      </div>
    </div>
  );
}
function operationMessage(error: { message?: string } | null, lang: string, fallback: string) { if (!error) return fallback; if (error.message === "Payment required") return lang === "ru" ? "Сначала нужна оплата" : "Payment required first"; if (error.message === "Eligibility approval required") return lang === "ru" ? "Сначала подтвердите основание ITIN" : "Approve ITIN eligibility first"; return fallback; }
function InfoIcon() {
  return <LockKeyhole size={16} />;
}
export function OrderTracker({ order }: { order: Order }) {
  const { t, lang } = useI18n();
  const isItin = order.product.startsWith("itin");
  const codes = isItin ? itinCodes : llcCodes;
  const labels = isItin ? t.itinStatuses : t.llcStatuses;
  const current = codes.indexOf(order.status);
  const paymentLabel = order.payment_status === "paid" ? (lang === "ru" ? "Оплачено" : "Paid") : (lang === "ru" ? "Ожидает оплаты" : "Awaiting payment");
  return (
    <article className="panel tracker">
      <div className="tracker-head">
        <div>
          <span className="eyebrow">
            {order.product.replaceAll("_", " ").toUpperCase()}
          </span>
          <h2>
            {order.applicant.company || order.applicant.name || t.progress}
          </h2>
          <span className="muted">#{order.id.slice(0, 8)}</span>
        </div>
        <span className="badge">{labels[current] || t.draft}</span>
      </div>
      <div className="button-row"><span className={"badge " + (order.payment_status === "paid" ? "success" : "neutral")}>{paymentLabel}</span>{order.payment_marked_manually && <span className="fineprint">{lang === "ru" ? "Оплата отмечена вручную" : "Payment marked manually"}</span>}</div>
      {order.eligibility === "rejected" && <p className="notice" role="alert">{lang === "ru" ? "ITIN отклонён" : "ITIN rejected"}{order.eligibility_note ? ": " + order.eligibility_note : ""}</p>}
      {order.eligibility === "pending" && (order.product.startsWith("itin") || order.product.startsWith("bundle")) && <p className="notice">{lang === "ru" ? "ITIN на проверке партнёром" : "ITIN under partner review"}</p>}
      <ol className="timeline">
        {codes.map((s, i) => {
          const history = order.order_status_history?.find(
            (h) => h.status === s,
          );
          return (
            <li
              className={
                i < current ? "complete" : i === current ? "active" : ""
              }
              key={s}
            >
              <span className="timeline-icon">
                {i < current ? <Check size={16} /> : i + 1}
              </span>
              <div>
                <b>{labels[i]}</b>
                <small>
                  {history
                    ? new Date(history.created_at).toLocaleDateString(
                        lang === "ru" ? "ru-RU" : "en-US",
                      )
                    : t.pending}
                </small>
                {i === current && (
                  <p>
                    {t.current}
                    {history?.expected_by
                      ? " · " +
                        t.eta +
                        ": " +
                        new Date(history.expected_by).toLocaleDateString()
                      : ""}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="notice">
        <Clock3 size={18} />
        {isItin ? t.faqItems[6][1] : t.einTiming}
      </p>
      {order.product.startsWith("bundle") && (
        <p className="fineprint">{t.itinGate}</p>
      )}
    </article>
  );
}
export function Dashboard() {
  const { t, lang } = useI18n();
  const { orders, role, refresh } = useOutletContext<AppContext>();
  const [msg, setMsg] = useState("");
  async function advance(order: Order) {
    if (!supabase) return;
    const codes = order.product.startsWith("itin") ? itinCodes : llcCodes;
    const next = codes[codes.indexOf(order.status) + 1];
    if (!next) return;
    const { error } = await supabase.rpc("advance_order", {
      p_order: order.id,
      p_status: next,
    });
    setMsg(error ? (error.message === "Payment required" ? (lang === "ru" ? "Сначала нужна оплата" : "Payment required first") : t.error) : t.saved);
    refresh();
  }
  return (
    <>
      <div className="dashboard-metrics">
        <div>
          <span>{t.orders}</span>
          <strong>{orders.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>{t.current}</span>
          <strong className="metric-text">
            {orders.length ? t.progress : "—"}
          </strong>
        </div>
        <div>
          <span>{t.documents}</span>
          <Link to="/app/documents">
            {lang === "ru" ? "Открыть хранилище" : "Open storage"}
            <ArrowUpRight size={20} />
          </Link>
        </div>
      </div>
      {!orders.length ? (
        <div className="panel empty">
          <FileText size={38} />
          <h2>{t.emptyOrders}</h2>
          <Button asChild>
            <Link to="/app/new">{t.newOrder}</Link>
          </Button>
        </div>
      ) : (
        orders.map((o) => (
          <div key={o.id}>
            <OrderTracker order={o} />
            {o.itin_status && (
              <OrderTracker
                order={{
                  ...o,
                  product: "itin_standard",
                  status: o.itin_status,
                  applicant: { ...o.applicant, company: "" },
                }}
              />
            )}
            {["partner", "admin"].includes(role) && (
              <div className="button-row">
                {role === "admin" && o.payment_status !== "paid" && <Button variant="outline" onClick={async () => { const note = window.prompt(lang === "ru" ? "Комментарий к ручной оплате (необязательно)" : "Manual payment note (optional)") || null; const { error } = await supabase!.rpc("mark_order_paid_manually", { p_order: o.id, p_note: note }); setMsg(operationMessage(error, lang, t.error)); refresh(); }}>{lang === "ru" ? "Отметить оплату" : "Mark paid"}</Button>}
                <Button onClick={() => advance(o)}>
                  {t.next} · {o.product.startsWith("itin") ? "ITIN" : "LLC"}
                </Button>
                {o.itin_status && o.itin_status !== "itin_received" && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const { error } = await supabase!.rpc(
                        "advance_bundle_itin",
                        { p_order: o.id },
                      );
                      setMsg(error ? t.error : t.saved);
                      refresh();
                    }}
                  >
                    {t.next} · ITIN
                  </Button>
                )}
                {o.eligibility === "pending" &&
                  (o.product.startsWith("itin") ||
                    o.product.startsWith("bundle")) && (
                    <><Button
                      variant="outline"
                      onClick={async () => {
                        const { error } = await supabase!.rpc("approve_eligibility", { p_order: o.id });
                        setMsg(error ? t.error : t.saved); refresh();
                      }}
                    >
                      {lang === "ru" ? "Одобрить ITIN" : "Approve ITIN"}
                    </Button><Button
                      variant="outline"
                      onClick={async () => {
                        const reason = window.prompt(lang === "ru" ? "Причина отказа ITIN" : "ITIN rejection reason");
                        if (!reason?.trim()) return;
                        const { error } = await supabase!.rpc("reject_eligibility", { p_order: o.id, p_reason: reason });
                        setMsg(error ? t.error : t.saved); refresh();
                      }}
                    >
                      {lang === "ru" ? "Отклонить ITIN" : "Reject ITIN"}
                    </Button></>
                  )}
              </div>
            )}
          </div>
        ))
      )}
      <p role="status">{msg}</p>
      <div className="support-card">
        <ShieldIcon />
        <div>
          <h3>
            {lang === "ru"
              ? "Не оставайтесь с вопросами"
              : "You do not have to figure it out alone"}
          </h3>
          <p>{t.support}</p>
        </div>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <LockKeyhole size={26} />;
}
type Doc = {
  id: string;
  name: string;
  path: string;
  order_id: string;
  created_at: string;
  review_status?: "pending" | "accepted" | "rejected";
  review_comment?: string | null;
};
export function Documents() {
  const { t, lang } = useI18n();
  const { orders, role } = useOutletContext<AppContext>();
  const [docs, setDocs] = useState<Doc[]>([]);
  // Готовые документы от партнёра, которые администратор передал клиенту
  const [readyDocs, setReadyDocs] = useState<
    { id: string; name: string; path: string; order_id: string; created_at: string; published_at: string | null }[]
  >([]);
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function load() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setMsg(t.error);
    else setDocs(data || []);
    const { data: ready } = await supabase
      .from("partner_documents")
      .select("id,name,path,order_id,created_at,published_at")
      .eq("visibility", "published")
      .order("published_at", { ascending: false });
    setReadyDocs(ready || []);
  }
  useEffect(() => {
    load();
  }, []);
  async function upload(file?: File) {
    if (!file || !orderId) return;
    setBusy(true);
    try {
      await uploadDocument(orderId, file);
      await load();
      setMsg(t.saved);
    } catch {
      setMsg(t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <span className="eyebrow">PRIVATE STORAGE</span>
          <h2>{t.documents}</h2>
          <p className="muted">{t.uploadHint}</p>
        </div>
        <LockKeyhole size={28} />
      </div>
      <label>
        {t.orders}
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">—</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.applicant.company || o.product} · {o.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <label className={"upload-zone " + (demoMode ? "disabled" : "")}>
        <Plus size={24} />
        <b>{t.upload}</b>
        <span>PDF / JPG / PNG · 10 MB</span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          disabled={demoMode || !orderId || busy}
          id="document-upload"
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p role="status">{busy ? t.loading : msg}</p>
      {readyDocs.length > 0 && (
        <div className="ready-docs" style={{ marginTop: 24 }}>
          <span className="eyebrow">{lang === "ru" ? "ГОТОВЫЕ ДОКУМЕНТЫ ОТ TAXPASSO" : "READY DOCUMENTS FROM TAXPASSO"}</span>
          {readyDocs.map((d) => (
            <div className="document-row" key={d.id}>
              <FileText />
              <div>
                <b>{d.name}</b>
                <small>
                  {new Date(d.published_at || d.created_at).toLocaleDateString(
                    lang === "ru" ? "ru-RU" : "en-US",
                  )}
                  {" · "}
                  {orders.find((o) => o.id === d.order_id)?.applicant.company ||
                    d.order_id.slice(0, 8)}
                </small>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const url = await documentUrl(d.path);
                    window.open(url, "_blank", "noopener,noreferrer");
                  } catch {
                    setMsg(t.error);
                  }
                }}
              >
                {t.download}
                <ArrowUpRight size={16} />
              </Button>
            </div>
          ))}
          <span className="eyebrow" style={{ display: "block", marginTop: 28 }}>
            {lang === "ru" ? "ВАШИ ДОКУМЕНТЫ" : "YOUR DOCUMENTS"}
          </span>
        </div>
      )}
      {!docs.length ? (
        <p className="empty muted">{t.emptyDocs}</p>
      ) : (
        docs.map((d) => (
          <div className="document-row" key={d.id}>
            <FileText />
            <div>
              <b>{d.name}</b>
              <small>
                {new Date(d.created_at).toLocaleDateString(
                  lang === "ru" ? "ru-RU" : "en-US",
                )}
              </small>
            </div>
            <div className="button-row">
            {role === "admin" && <><Button variant="outline" onClick={async () => { const { error } = await supabase!.rpc("review_document", { p_document: d.id, p_status: "accepted", p_comment: null }); setMsg(error ? t.error : t.saved); load(); }}>{lang === "ru" ? "Принять" : "Accept"}</Button><Button variant="outline" onClick={async () => { const reason = window.prompt(lang === "ru" ? "Причина отклонения документа" : "Document rejection reason"); if (!reason?.trim()) return; const { error } = await supabase!.rpc("review_document", { p_document: d.id, p_status: "rejected", p_comment: reason }); setMsg(error ? t.error : t.saved); load(); }}>{lang === "ru" ? "Отклонить" : "Reject"}</Button></>}
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const url = await documentUrl(d.path);
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch {
                  setMsg(t.error);
                }
              }}
            >
              {t.download}
              <ArrowUpRight size={16} />
            </Button></div>
            {d.review_status === "rejected" && <Button variant="outline" onClick={() => { setOrderId(d.order_id); document.getElementById("document-upload")?.click(); }}>{lang === "ru" ? "Загрузить заново" : "Upload again"}</Button>}
            <span className="fineprint">{d.review_status === "accepted" ? (lang === "ru" ? "Принят" : "Accepted") : d.review_status === "rejected" ? (lang === "ru" ? "Отклонён" : "Rejected") : (lang === "ru" ? "На проверке" : "Under review")}{d.review_comment ? ` · ${d.review_comment}` : ""}</span>
          </div>
        ))
      )}
    </section>
  );
}
export function Deadlines() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<
    { id: string; kind: string; due_date: string; completed: boolean }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (supabase)
      supabase
        .from("deadlines")
        .select("*")
        .order("due_date")
        .then(({ data, error }) =>
          error ? setError(t.error) : setRows(data || []),
        );
  }, []);
  const demoRows = [
    { id: "1", kind: "ra_renewal", due_date: "2027-09-18", completed: false },
    { id: "2", kind: "state_report", due_date: "2027-09-01", completed: false },
    { id: "3", kind: "form_5472", due_date: "2027-04-15", completed: false },
  ];
  const names: Record<string, string> = {
    ra_renewal: t.deadlineNames[0],
    state_report: t.deadlineNames[1],
    form_5472: t.deadlineNames[2],
  };
  return (
    <section className="panel">
      <span className="eyebrow">COMPLIANCE CALENDAR</span>
      <h2>{t.deadlines}</h2>
      {demoMode && (
        <p className="muted">
          {lang === "ru"
            ? "Пример для Wyoming LLC с календарным налоговым годом. Реальные даты подтверждает специалист."
            : "Example for a Wyoming LLC with a calendar tax year. A specialist confirms actual dates."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!(demoMode ? demoRows : rows).length && <p>{t.emptyDeadlines}</p>}
      {(demoMode ? demoRows : rows).map((d) => (
        <div className="deadline-row" key={d.id}>
          <CalendarDays size={24} />
          <div>
            <h3>{names[d.kind] || d.kind}</h3>
            <span className="muted">{d.completed ? t.done : t.pending}</span>
          </div>
          <time>
            {new Date(d.due_date + "T12:00:00").toLocaleDateString(
              lang === "ru" ? "ru-RU" : "en-US",
              { day: "numeric", month: "long", year: "numeric" },
            )}
          </time>
        </div>
      ))}
    </section>
  );
}
