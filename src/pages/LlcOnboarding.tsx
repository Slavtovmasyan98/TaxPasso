// Новый онбординг LLC в стиле Doola (тестовая версия, адрес /app/start).
// Старая анкета /app/new не затронута. Чтобы убрать тест — удалите этот файл и маршрут "start" в main.tsx.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Building2, Check, CircleCheck, FileText,
  Info, Layers, Plus, Star, Trash2, Upload, Landmark,
} from "lucide-react";
import { supabase, demoMode, uploadDocument, recordConsent } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useI18n } from "../i18n";
import { countryList } from "../lib/countries";
import { Button } from "../components/ui/button";

type Owner = { id?: string; first: string; last: string; pct: string; responsible: boolean; passport?: string };
type Svc = "" | "llc" | "bundle" | "itin";
type State = "" | "WY" | "DE";

const PRICE = { WY: 349, DE: 449 };
const RENEW = { WY: 149, DE: 199 };
const STATE_FEE = { WY: 60, DE: 400 };
const CATEGORIES = [
  ["it_online", "IT и онлайн-сервисы", "IT and online services"],
  ["retail", "Онлайн-торговля", "E-commerce"],
  ["real_estate", "Недвижимость", "Real estate"],
  ["finance_insurance", "Финансы", "Finance"],
  ["other", "Другое (консалтинг и т. п.)", "Other (consulting, etc.)"],
] as const;

const box: CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
  border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px",
  background: "var(--bg)", marginBottom: 10, cursor: "pointer", color: "var(--ink)",
};
const boxOn: CSSProperties = { ...box, border: "2px solid var(--accent)", background: "var(--tint)" };

export function LlcOnboarding() {
  const { lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const { session } = useAuth();
  const { refresh } = useOutletContext<{ refresh: () => void }>();
  const countries = useMemo(() => countryList(lang), [lang]);

  const [step, setStep] = useState(0);
  const [svc, setSvc] = useState<Svc>("");
  const [country, setCountry] = useState("AM");
  const [st, setSt] = useState<State>("");
  const [name, setName] = useState("");
  const [ending, setEnding] = useState("LLC");
  const [consent, setConsent] = useState(false);
  const [owners, setOwners] = useState<Owner[]>([{ first: "", last: "", pct: "100", responsible: true }]);
  const [cat, setCat] = useState("");
  const [other, setOther] = useState("");
  const [desc, setDesc] = useState("");
  const [orderId, setOrderId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const labels = ru
    ? ["Услуга", "Страна", "Штат", "Название", "Оплата", "Владельцы", "Компания"]
    : ["Service", "Country", "State", "Name", "Payment", "Owners", "Company"];
  const total = st ? PRICE[st] + (svc === "bundle" ? 200 : 0) : 0;
  const yearly = st ? RENEW[st] + STATE_FEE[st] : 0;
  const pctSum = owners.reduce((a, o) => a + (Number(o.pct) || 0), 0);

  function fail(msg: string) { setErr(msg); return false; }

  // Шаг 5: создаём черновик заказа и сохраняем согласие. Оплату отмечает админ (до подключения Stripe).
  async function createDraft() {
    if (demoMode || !supabase || !session) return true;
    const { data, error } = await supabase.from("orders").insert({
      client_id: session.user.id,
      product: svc === "bundle" ? (st === "DE" ? "bundle_de" : "bundle_wy") : st === "DE" ? "llc_de" : "llc_wy",
      applicant: { country, company: `${name.trim()} ${ending}` },
      status: "draft",
    }).select("id").single();
    if (error || !data) return fail(T("Не удалось создать заказ. Попробуйте ещё раз.", "Could not create the order. Try again."));
    setOrderId(data.id);
    try { await recordConsent(data.id); } catch { return fail(T("Не удалось сохранить согласие.", "Could not save consent.")); }
    refresh();
    return true;
  }

  // Шаг 6: сохраняем владельцев (перезаписываем набор целиком).
  async function saveOwners() {
    if (demoMode || !supabase || !orderId) return true;
    await supabase.from("order_members").delete().eq("order_id", orderId);
    const rows = owners.map((o) => ({
      order_id: orderId, first_name: o.first.trim(), last_name: o.last.trim(),
      ownership_pct: Number(o.pct), is_responsible: o.responsible, country,
    }));
    const { data, error } = await supabase.from("order_members").insert(rows).select("id");
    if (error || !data) return fail(T("Не удалось сохранить владельцев.", "Could not save owners."));
    // Новые id владельцев: паспорта нужно загрузить заново, если владельцев пересохранили
    setOwners((prev) => prev.map((o, k) => ({ ...o, id: data[k]?.id, passport: undefined })));
    return true;
  }

  // Шаг 7: данные компании + отправка заявки.
  async function submitAll() {
    if (demoMode || !supabase || !orderId) { setDone(true); return true; }
    const { error: cErr } = await supabase.from("order_company").upsert({
      order_id: orderId, activity_category: cat,
      activity_other: cat === "other" ? other.trim() : null,
      activity_description: desc.trim(),
    });
    if (cErr) return fail(T("Не удалось сохранить данные компании.", "Could not save company details."));
    const resp = owners.find((o) => o.responsible) || owners[0];
    const { error: aErr } = await supabase.from("orders").update({
      applicant: {
        name: `${resp.first.trim()} ${resp.last.trim()}`, country,
        company: `${name.trim()} ${ending}`, activity: desc.trim().slice(0, 1000),
      },
    }).eq("id", orderId);
    if (aErr) return fail(T("Не удалось обновить заявку.", "Could not update the application."));
    const { error: sErr } = await supabase.rpc("submit_order", { p_order: orderId });
    if (sErr) return fail(T("Не удалось отправить заявку.", "Could not submit the application."));
    refresh();
    setDone(true);
    return true;
  }

  async function uploadPassport(k: number, file?: File) {
    const o = owners[k];
    if (!file || !orderId || !o.id || demoMode) return;
    setBusy(true); setErr("");
    try {
      await uploadDocument(orderId, file, "passport", o.id);
      setOwners((prev) => prev.map((x, i) => (i === k ? { ...x, passport: file.name } : x)));
    } catch {
      setErr(T("Файл не загрузился. PDF, JPG или PNG до 10 МБ.", "Upload failed. PDF, JPG or PNG up to 10 MB."));
    } finally { setBusy(false); }
  }

  async function next() {
    setErr("");
    if (step === 0 && (!svc || svc === "itin")) return fail(svc === "itin" ? T("Для ITIN будет отдельная анкета.", "ITIN has a separate form.") : T("Выберите услугу", "Choose a service"));
    if (step === 1 && !country) return fail(T("Выберите страну", "Choose a country"));
    if (step === 2 && !st) return fail(T("Выберите штат", "Choose a state"));
    if (step === 3 && name.trim().length < 2) return fail(T("Введите название компании", "Enter a company name"));
    if (step === 4) {
      if (!consent) return fail(T("Отметьте согласие с условиями", "Accept the terms to continue"));
      setBusy(true); const ok = await createDraft(); setBusy(false); if (!ok) return;
    }
    if (step === 5) {
      if (owners.some((o) => !o.first.trim() || !o.last.trim())) return fail(T("Заполните имя и фамилию всех владельцев", "Enter every owner's first and last name"));
      if (Math.round(pctSum * 100) / 100 !== 100) return fail(T(`Сумма долей должна быть 100%, сейчас ${Math.round(pctSum)}%`, `Ownership must total 100%, now ${Math.round(pctSum)}%`));
      if (owners.filter((o) => o.responsible).length !== 1) return fail(T("Выберите одно ответственное лицо", "Choose one responsible party"));
      setBusy(true); const ok = await saveOwners(); setBusy(false); if (!ok) return;
    }
    if (step === 6) {
      if (!cat) return fail(T("Выберите категорию", "Choose a category"));
      if (cat === "other" && !other.trim()) return fail(T("Уточните вид деятельности", "Specify the business type"));
      if (!desc.trim()) return fail(T("Опишите деятельность компании", "Describe the business"));
      if (!demoMode && owners.some((o) => !o.passport)) return fail(T("Загрузите паспорт каждого владельца", "Upload a passport for every owner"));
      setBusy(true); await submitAll(); setBusy(false); return;
    }
    setStep((s) => s + 1);
  }

  const opt = (on: boolean, onClick: () => void, icon: ReactNode, title: string, sub: string) => (
    <button type="button" style={on ? boxOn : box} onClick={() => { onClick(); setErr(""); }}>
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <b style={{ display: "block", fontWeight: 600 }}>{title}</b>
        <small style={{ color: "var(--muted)" }}>{sub}</small>
      </span>
      {on && <Check size={18} color="var(--accent)" />}
    </button>
  );

  if (done) {
    return (
      <section className="panel wizard" style={{ textAlign: "center" }}>
        <CircleCheck size={44} color="var(--accent)" />
        <h2>{T("Заявка отправлена", "Application submitted")}</h2>
        <p className="muted">{T("Мы проверим данные и начнём регистрацию после подтверждения оплаты. Статус — в кабинете.", "We'll review your details and start after payment is confirmed. Track the status in your account.")}</p>
        <Button asChild style={{ marginTop: 20 }}><Link to="/app">{T("В кабинет", "Go to dashboard")}</Link></Button>
      </section>
    );
  }

  return (
    <section className="panel wizard">
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {labels.map((_, k) => (
          <div key={k} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= step ? "var(--accent)" : "var(--line)" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {labels.map((l, k) => (
          <div key={l} style={{ flex: 1, fontSize: 11, textAlign: "center", color: k === step ? "var(--accent)" : "var(--muted)" }}>{l}</div>
        ))}
      </div>
      <span className="eyebrow">
        {T(`Шаг ${step + 1} из 7`, `Step ${step + 1} of 7`)}{step >= 5 ? T(" · после оплаты", " · after payment") : ""}
        {demoMode ? " · DEMO" : ""}
      </span>

      {step === 0 && <>
        <h2>{T("Что вам нужно?", "What do you need?")}</h2>
        {opt(svc === "llc", () => setSvc("llc"), <Building2 />, "LLC + EIN", T("Компания и её налоговый номер", "Company and its tax ID"))}
        {opt(svc === "bundle", () => setSvc("bundle"), <Layers />, "LLC + EIN + ITIN", T("Плюс ваш личный налоговый номер", "Plus your personal tax ID"))}
        {opt(svc === "itin", () => setSvc("itin"), <FileText />, T("Только ITIN", "ITIN only"), T("Отдельная услуга", "Separate service"))}
        {svc === "itin" && <p className="notice"><Info size={16} />{T("Для ITIN есть отдельная анкета с проверкой основания.", "ITIN has its own form with an eligibility check.")} <Link to="/itin">{T("Перейти", "Open")}</Link></p>}
      </>}

      {step === 1 && <>
        <h2>{T("Где вы живёте?", "Where do you live?")}</h2>
        <label>{T("Страна проживания", "Country of residence")}
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <p className="muted">{T("Нужно для регистрации и налоговых форм. Паспорт попросим после оплаты.", "Needed for formation and tax forms. We'll ask for a passport after payment.")}</p>
      </>}

      {step === 2 && <>
        <h2>{T("В каком штате открыть компанию?", "Which state?")}</h2>
        {opt(st === "WY", () => setSt("WY"), <Star />, `Wyoming · $${PRICE.WY}`, T(`Рекомендуем. Продление $${RENEW.WY}/год, штату от $${STATE_FEE.WY}/год`, `Recommended. Renewal $${RENEW.WY}/yr, state from $${STATE_FEE.WY}/yr`))}
        {opt(st === "DE", () => setSt("DE"), <Landmark />, `Delaware · $${PRICE.DE}`, T(`Для инвесторов. Продление $${RENEW.DE}/год, штату $${STATE_FEE.DE}/год`, `For investors. Renewal $${RENEW.DE}/yr, state $${STATE_FEE.DE}/yr`))}
      </>}

      {step === 3 && <>
        <h2>{T("Как назовём компанию?", "Name your company")}</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <input style={{ flex: 1 }} maxLength={120} placeholder="Northway Studio" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
          <select style={{ width: 120 }} value={ending} onChange={(e) => setEnding(e.target.value)}>
            <option>LLC</option><option>L.L.C.</option>
          </select>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          <Info size={14} style={{ verticalAlign: -2 }} /> {T(`Проверим, свободно ли название в ${st === "DE" ? "Delaware" : "Wyoming"}, и предложим варианты, если занято.`, `We'll check availability in ${st === "DE" ? "Delaware" : "Wyoming"} and suggest alternatives if it's taken.`)}
        </p>
      </>}

      {step === 4 && <>
        <h2>{T("Ваш план", "Your plan")}</h2>
        <div className="cost-row"><span>{name.trim()} {ending} · {st === "DE" ? "Delaware" : "Wyoming"}{svc === "bundle" ? " + ITIN" : ""}</span><strong>${total}</strong></div>
        <div className="cost-row"><span className="muted">{T("Входит: госпошлина, агент на год, EIN, operating agreement", "Includes: state fee, agent for a year, EIN, operating agreement")}</span><span /></div>
        <div className="cost-row"><span className="muted">{T("Со второго года: продление + платёж штату", "From year two: renewal + state payment")}</span><strong>${yearly}/{T("год", "yr")}</strong></div>
        <label className="checkbox" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErr(""); }} />
          <span>{T("Принимаю ", "I accept the ")}<Link to="/terms" target="_blank">{T("условия", "terms")}</Link>, <Link to="/privacy" target="_blank">{T("политику конфиденциальности", "privacy policy")}</Link> {T("и", "and")} <Link to="/refund" target="_blank">{T("возврата", "refund policy")}</Link></span>
        </label>
        <p className="fineprint">{T("Онлайн-оплата подключается. Сейчас мы свяжемся с вами для оплаты, заказ сохранится.", "Online payment is being connected. We'll contact you to pay; your order is saved.")}</p>
      </>}

      {step === 5 && <>
        <h2>{T("Кто владельцы компании?", "Who owns the company?")}</h2>
        <p className="notice"><CircleCheck size={16} />{T("Заказ создан. Осталось 2 шага.", "Order created. Two steps left.")}</p>
        {owners.map((o, k) => (
          <div key={k} className="panel" style={{ padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input style={{ flex: "1 1 140px" }} placeholder={T("Имя латиницей", "First name")} value={o.first}
                onChange={(e) => setOwners((p) => p.map((x, i) => i === k ? { ...x, first: e.target.value } : x))} />
              <input style={{ flex: "1 1 140px" }} placeholder={T("Фамилия латиницей", "Last name")} value={o.last}
                onChange={(e) => setOwners((p) => p.map((x, i) => i === k ? { ...x, last: e.target.value } : x))} />
              <input style={{ width: 80 }} type="number" min={1} max={100} value={o.pct}
                onChange={(e) => setOwners((p) => p.map((x, i) => i === k ? { ...x, pct: e.target.value } : x))} />
              <span style={{ alignSelf: "center" }}>%</span>
              {owners.length > 1 && (
                <button type="button" className="icon-button" aria-label={T("Удалить", "Remove")}
                  onClick={() => setOwners((p) => { const n = p.filter((_, i) => i !== k); if (!n.some((x) => x.responsible)) n[0].responsible = true; return n; })}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <label className="checkbox" style={{ margin: "10px 0 0" }}>
              <input type="radio" name="responsible" checked={o.responsible}
                onChange={() => setOwners((p) => p.map((x, i) => ({ ...x, responsible: i === k })))} />
              {T("Ответственное лицо для EIN (форма SS-4)", "Responsible party for EIN (Form SS-4)")}
            </label>
          </div>
        ))}
        <Button variant="outline" onClick={() => setOwners((p) => [...p, { first: "", last: "", pct: "0", responsible: false }])}>
          <Plus size={16} /> {T("Добавить владельца", "Add owner")}
        </Button>
        <p className="muted" style={{ marginTop: 10 }}>{T(`Сумма долей: ${Math.round(pctSum)}%`, `Total: ${Math.round(pctSum)}%`)}</p>
      </>}

      {step === 6 && <>
        <h2>{T("Чем будет заниматься компания?", "What will the company do?")}</h2>
        <label>{T("Категория", "Category")}
          <select value={cat} onChange={(e) => { setCat(e.target.value); setErr(""); }}>
            <option value="">—</option>
            {CATEGORIES.map(([v, r, e]) => <option key={v} value={v}>{ru ? r : e}</option>)}
          </select>
        </label>
        {cat === "other" && <input maxLength={100} placeholder={T("Например, консалтинг", "E.g. consulting")} value={other} onChange={(e) => setOther(e.target.value)} />}
        <label>{T("Описание", "Description")}
          <textarea maxLength={500} rows={3} placeholder={T("Разрабатываем мобильные приложения для малого бизнеса", "We build mobile apps for small businesses")}
            value={desc} onChange={(e) => { setDesc(e.target.value); setErr(""); }} />
        </label>
        <span className="eyebrow" style={{ display: "block", marginTop: 18 }}>{T("ПАСПОРТА ВЛАДЕЛЬЦЕВ", "OWNER PASSPORTS")}</span>
        {owners.map((o, k) => (
          <label key={k} className="upload-zone" style={{ marginTop: 10 }}>
            {o.passport ? <CircleCheck size={22} /> : <Upload size={22} />}
            <b>{o.first} {o.last}</b>
            <span>{o.passport || "PDF / JPG / PNG · 10 MB"}</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy || demoMode}
              onChange={(e) => { uploadPassport(k, e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        ))}
      </>}

      <p role="alert" style={{ color: "#b42318", minHeight: 22, marginTop: 12 }}>{err}</p>
      <div className="button-row">
        {step > 0 && step !== 5 && (
          <Button variant="ghost" disabled={busy} onClick={() => { setErr(""); setStep((s) => s - 1); }}>
            <ArrowLeft size={16} /> {T("Назад", "Back")}
          </Button>
        )}
        <Button disabled={busy} onClick={next}>
          {busy ? T("Сохраняем…", "Saving…")
            : step === 4 ? T(`Оформить за $${total}`, `Order for $${total}`)
            : step === 6 ? T("Отправить на регистрацию", "Submit for formation")
            : T("Продолжить", "Continue")}
          <ArrowRight size={16} />
        </Button>
      </div>
    </section>
  );
}
