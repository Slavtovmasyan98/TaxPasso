// Анкета ITIN (данные для формы IRS W-7), адрес /app/itin/:orderId. Миграция 024.
// Открывается после одобрения основания ITIN (специалистом после консультации или администратором).
// Шаги повторяют разделы W-7: причина подачи → о вас → адреса → паспорт и виза → документы → проверка.
// Черновик сохраняется на сервере при каждом «Продолжить»; полноту и паспорт проверяет сервер при отправке.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CircleCheck, FileText, Info, Upload } from "lucide-react";
import { supabase, demoMode, uploadDocument, type DocumentKind, type Order } from "../lib/supabase";
import { useI18n } from "../i18n";
import { countryList } from "../lib/countries";
import { Button } from "../components/ui/button";

type Data = Record<string, string>;
type AppStatus = "draft" | "submitted" | "returned";
type Doc = { id: string; name: string; kind: string; review_status: string };

const ITIN_PRODUCTS = ["itin_standard", "itin_return", "bundle_wy", "bundle_de"];
const LATIN = /^[A-Za-z][A-Za-z '.-]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const REASONS: [string, string, string][] = [
  ["b", "Нерезидент, подающий налоговую декларацию США (1040-NR)", "Nonresident alien filing a U.S. federal tax return (1040-NR)"],
  ["a", "Нерезидент, претендующий на льготу по налоговому соглашению", "Nonresident alien claiming a tax treaty benefit"],
  ["h", "Другое: исключение из требования подавать декларацию", "Other: an exception to the tax return requirement"],
  ["c", "Резидент США по числу дней, подающий декларацию", "U.S. resident alien (based on days present) filing a U.S. tax return"],
  ["e", "Супруг(а) гражданина или резидента США", "Spouse of a U.S. citizen or resident alien"],
  ["d", "Иждивенец гражданина или резидента США", "Dependent of a U.S. citizen or resident alien"],
  ["g", "Супруг(а) или иждивенец нерезидента с визой США", "Spouse or dependent of a nonresident alien holding a U.S. visa"],
  ["f", "Студент, преподаватель или исследователь-нерезидент", "Nonresident alien student, professor or researcher"],
];
const EXCEPTIONS: [string, string, string][] = [
  ["1", "1 — удержание налога с пассивного дохода (проценты, дивиденды, партнёрство, пенсии, роялти)", "1 — Third-party withholding on passive income (interest, dividends, partnership, pensions, royalties)"],
  ["2", "2 — льгота по соглашению: зарплата, стипендия, грант, выигрыш", "2 — Treaty benefit: wages, scholarship, grant, gambling winnings"],
  ["3", "3 — проценты по ипотеке в США", "3 — Third-party reporting of U.S. mortgage interest"],
  ["4", "4 — продажа недвижимости в США (FIRPTA)", "4 — Disposition of U.S. real property (FIRPTA)"],
  ["5", "5 — отчётность по Treasury Decision 9363", "5 — Treasury Decision 9363 reporting obligations"],
  ["other", "Другое — опишите", "Other — describe"],
];
const VISAS = ["B-1", "B-2", "F-1", "J-1", "H-1B", "L-1", "O-1", "E-2", "Other"];

// Код поля из ответа сервера → шаг анкеты и текст ошибки.
const PROBLEM_STEP: Record<string, number> = {
  reason: 0, treaty: 0, relationship: 0, exception_code: 0, school: 0,
  name: 1, dob: 1, date: 1, birth: 1, gender: 1, citizenship: 1,
  home_address: 2, mail_address: 2, passport: 3, passport_expired: 3, passport_file: 4,
};

export function ItinApplication() {
  const { lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const { orderId = "" } = useParams();
  const { orders, refresh } = useOutletContext<{ orders: Order[]; refresh: () => void }>();
  const order = orders.find((o) => o.id === orderId);
  const countries = useMemo(() => countryList(lang), [lang]);
  const country = (code?: string) => countries.find((c) => c.code === code)?.name || code || "—";

  const [d, setD] = useState<Data>({});
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(demoMode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [agree, setAgree] = useState(false);

  async function loadDocs() {
    if (!supabase) return;
    const { data } = await supabase.from("documents").select("id,name,kind,review_status")
      .eq("order_id", orderId).is("superseded_at", null).order("created_at");
    setDocs((data as Doc[]) || []);
  }
  useEffect(() => {
    if (!supabase || !orderId) return;
    let active = true;
    supabase.from("itin_applications").select("data,status,returned_note").eq("order_id", orderId).maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const saved = (data?.data as Data) || {};
        // Новая анкета: причина «b» для ITIN + декларации, страна — из заказа.
        setD(Object.keys(saved).length ? saved : {
          ...(order?.product === "itin_return" ? { reason: "b" } : {}),
          ...(order?.applicant?.country ? { citizenship: order.applicant.country, home_country: order.applicant.country !== "US" ? order.applicant.country : "" } : {}),
          mail_same: "yes",
        });
        setStatus((data?.status as AppStatus) || null);
        setNote(data?.returned_note || null);
        setLoaded(true);
      });
    loadDocs();
    return () => { active = false; };
  }, [orderId, order?.id]);

  if (!demoMode && orders.length && !order) return <Navigate to="/app" replace />;
  if (!loaded || (!order && !demoMode)) return <p className="container page">{T("Загрузка…", "Loading…")}</p>;
  if (order && (!ITIN_PRODUCTS.includes(order.product) || order.eligibility !== "approved")) {
    return (
      <section className="panel wizard">
        <h2>{T("Анкета ITIN пока недоступна", "The ITIN application is not available yet")}</h2>
        <p className="muted">{T("Анкета откроется после того, как мы подтвердим основание для ITIN.", "The application opens once we confirm your ITIN eligibility.")}</p>
        <Button asChild variant="outline"><Link to="/app">{T("В кабинет", "Back to dashboard")}</Link></Button>
      </section>
    );
  }

  const set = (k: string, v: string) => { setD((x) => ({ ...x, [k]: v })); setErr(""); };
  const v = (k: string) => d[k] || "";
  const passportDocs = docs.filter((x) => x.kind === "passport" && x.review_status !== "rejected");
  const r = d.reason;

  function stepError(s: number): string {
    const today = new Date().toISOString().slice(0, 10);
    if (s === 0) {
      if (!r) return T("Выберите причину подачи", "Choose the reason for applying");
      if (r === "a" && (!d.treaty_country || !d.treaty_article)) return T("Укажите страну соглашения и статью", "Enter the treaty country and article");
      if (["d", "e", "g"].includes(r) && (!d.relationship || !d.us_person_name)) return T("Укажите, кем вы приходитесь, и имя этого человека", "Enter your relationship and that person's name");
      if (r === "h" && (!d.exception_code || (d.exception_code === "other" && !d.exception_detail))) return T("Выберите исключение и при необходимости опишите его", "Choose the exception and describe it if needed");
      if (r === "f" && (!d.school_name || !d.school_city)) return T("Укажите учебное заведение или организацию и город", "Enter the school or institution and its city");
    }
    if (s === 1) {
      if (!LATIN.test(v("first_name")) || !LATIN.test(v("last_name")) || (d.middle_name && !LATIN.test(d.middle_name)))
        return T("Имя и фамилия — латиницей, как в паспорте", "First and last name in Latin letters, as in your passport");
      if (!ISO.test(v("dob")) || v("dob") >= today || v("dob") < "1900-01-01") return T("Укажите дату рождения", "Enter your date of birth");
      if (!d.birth_country || !d.birth_city) return T("Укажите страну и город рождения", "Enter your country and city of birth");
      if (!["male", "female"].includes(v("gender"))) return T("Укажите пол, как в паспорте", "Select your sex as shown in your passport");
      if (!d.citizenship) return T("Укажите гражданство", "Select your citizenship");
    }
    if (s === 2) {
      if (!d.home_street || !d.home_city || !d.home_country) return T("Заполните адрес проживания за пределами США", "Fill in your address outside the U.S.");
      if (d.home_country === "US") return T("Адрес проживания должен быть за пределами США", "The residence address must be outside the U.S.");
      if (v("mail_same") !== "yes" && (!d.mail_street || !d.mail_city || !d.mail_country)) return T("Заполните почтовый адрес", "Fill in the mailing address");
    }
    if (s === 3) {
      if (!d.passport_country || !d.passport_number || !ISO.test(v("passport_expiry"))) return T("Заполните данные паспорта", "Fill in your passport details");
      if (v("passport_expiry") <= today) return T("Срок действия паспорта истёк — нужен действующий паспорт", "Your passport has expired — a valid passport is required");
    }
    if (s === 4 && !passportDocs.length) return T("Загрузите скан паспорта", "Upload a scan of your passport");
    if (s === 5 && !agree) return T("Подтвердите, что данные верны", "Confirm the information is correct");
    return "";
  }

  async function save(): Promise<boolean> {
    if (demoMode || !supabase) return true;
    const { error } = await supabase.rpc("save_itin_application", { p_order: orderId, p_data: d });
    if (error) { setErr(serverError(error.message)); return false; }
    return true;
  }
  function serverError(m: string): string {
    const map: Record<string, [string, string]> = {
      "Field too long": ["Слишком длинное значение (до 200 символов)", "Value too long (max 200 characters)"],
      "Invalid characters": ["Уберите символы < и >", "Remove the < and > characters"],
      "Application submitted": ["Анкета уже отправлена", "The application has already been submitted"],
      "Eligibility approval required": ["Анкета откроется после подтверждения основания ITIN", "The application opens after your ITIN eligibility is confirmed"],
      "Order closed": ["Заказ закрыт", "The order is closed"],
    };
    return map[m] ? T(...map[m]) : T("Не удалось сохранить. Попробуйте ещё раз.", "Could not save. Please try again.");
  }
  async function next() {
    const e = stepError(step);
    if (e) { setErr(e); return; }
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) { setErr(""); setStep((s) => s + 1); window.scrollTo({ top: 0 }); }
  }
  async function submit() {
    const e = stepError(5);
    if (e) { setErr(e); return; }
    if (demoMode || !supabase) { setStatus("submitted"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("submit_itin_application", { p_order: orderId, p_data: d });
    setBusy(false);
    if (error) {
      const field = (error.details || "").replace("field=", "");
      if (error.message === "Application incomplete" && field in PROBLEM_STEP) {
        setStep(PROBLEM_STEP[field]);
        setErr(T("Проверьте этот шаг: не все данные заполнены верно.", "Check this step: some details are missing or incorrect."));
      } else setErr(serverError(error.message));
      return;
    }
    setStatus("submitted"); setNote(null); refresh();
  }
  async function upload(kind: DocumentKind, file?: File) {
    if (!file || demoMode) return;
    setBusy(true); setErr("");
    try { await uploadDocument(orderId, file, kind); await loadDocs(); }
    catch { setErr(T("Не удалось загрузить: только PDF, JPG или PNG до 10 МБ", "Upload failed: PDF, JPG or PNG up to 10 MB only")); }
    finally { setBusy(false); }
  }

  const field = (k: string, label: string, opts: { req?: boolean; type?: string; hint?: string; max?: number } = {}) => (
    <label key={k}>{label}{opts.req ? " *" : ""}
      <input type={opts.type || "text"} value={v(k)} maxLength={opts.max || 200} onChange={(e) => set(k, e.target.value)}
        autoComplete="off" aria-required={opts.req || undefined} />
      {opts.hint && <small className="muted">{opts.hint}</small>}
    </label>
  );
  const select = (k: string, label: string, options: [string, string][], req = false) => (
    <label key={k}>{label}{req ? " *" : ""}
      <select value={v(k)} onChange={(e) => set(k, e.target.value)} aria-required={req || undefined}>
        <option value="">—</option>
        {options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
      </select>
    </label>
  );
  const countrySelect = (k: string, label: string, req = false, noUS = false) =>
    select(k, label, countries.filter((c) => !noUS || c.code !== "US").map((c) => [c.code, c.name]), req);
  const grid = (children: ReactNode) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 16px" }}>{children}</div>;
  const uploadZone = (kind: DocumentKind, title: string, have: Doc[]) => (
    <label className="upload-zone" style={{ marginTop: 10 }}>
      {have.length ? <CircleCheck size={22} /> : <Upload size={22} />}
      <b>{title}</b>
      <span>{have.length ? have.map((x) => x.name).join(", ") : "PDF / JPG / PNG · 10 MB"}</span>
      <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy || demoMode}
        onChange={(e) => { upload(kind, e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );

  const labels = [T("Причина", "Reason"), T("О вас", "About you"), T("Адреса", "Addresses"), T("Паспорт", "Passport"), T("Документы", "Documents"), T("Проверка", "Review")];
  const reasonLabel = REASONS.find((x) => x[0] === r);
  const summary: [string, [string, string][]][] = [
    [T("Причина подачи (W-7, a–h)", "Reason for applying (W-7, a–h)"), [
      [T("Причина", "Reason"), reasonLabel ? `${r}) ${T(reasonLabel[1], reasonLabel[2])}` : "—"],
      ...(r === "h" ? [[T("Исключение", "Exception"), `${d.exception_code || "—"}${d.exception_detail ? " · " + d.exception_detail : ""}`] as [string, string]] : []),
      ...(r === "a" ? [[T("Соглашение", "Treaty"), `${country(d.treaty_country)} · ${d.treaty_article || "—"}`] as [string, string]] : []),
      ...(["d", "e", "g"].includes(r || "") ? [[T("Связь", "Relationship"), `${d.relationship || "—"} · ${d.us_person_name || "—"}${d.us_person_tin ? " · " + d.us_person_tin : ""}`] as [string, string]] : []),
      ...(r === "f" ? [[T("Учёба / работа", "School / institution"), `${d.school_name || "—"}, ${d.school_city || "—"}${d.stay_length ? " · " + d.stay_length : ""}`] as [string, string]] : []),
    ]],
    [T("О вас (строки 1, 4–6)", "About you (lines 1, 4–6)"), [
      [T("Имя", "Name"), [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ") || "—"],
      ...(d.birth_first_name || d.birth_last_name ? [[T("Имя при рождении", "Name at birth"), [d.birth_first_name, d.birth_last_name].filter(Boolean).join(" ")] as [string, string]] : []),
      [T("Дата и место рождения", "Date and place of birth"), `${d.dob || "—"} · ${d.birth_city || "—"}, ${country(d.birth_country)}`],
      [T("Пол", "Sex"), d.gender === "male" ? T("Мужской", "Male") : d.gender === "female" ? T("Женский", "Female") : "—"],
      [T("Гражданство", "Citizenship"), [country(d.citizenship), d.citizenship2 && country(d.citizenship2)].filter(Boolean).join(", ")],
      ...(d.foreign_tin ? [[T("Иностранный налоговый номер", "Foreign tax ID"), d.foreign_tin] as [string, string]] : []),
    ]],
    [T("Адреса (строки 2–3)", "Addresses (lines 2–3)"), [
      [T("Адрес за пределами США", "Address outside the U.S."), [d.home_street, d.home_city, d.home_region, d.home_postal, country(d.home_country)].filter(Boolean).join(", ")],
      [T("Почтовый адрес", "Mailing address"), v("mail_same") === "yes" ? T("Совпадает с адресом выше", "Same as above") : [d.mail_street, d.mail_city, d.mail_region, d.mail_postal, country(d.mail_country)].filter(Boolean).join(", ")],
      ...(d.phone ? [[T("Телефон", "Phone"), d.phone] as [string, string]] : []),
    ]],
    [T("Паспорт и виза (строка 6)", "Passport and visa (line 6)"), [
      [T("Паспорт", "Passport"), `${country(d.passport_country)} · ${d.passport_number || "—"} · ${T("до", "expires")} ${d.passport_expiry || "—"}`],
      ...(d.visa_type ? [[T("Виза США", "U.S. visa"), `${d.visa_type}${d.visa_number ? " · " + d.visa_number : ""}${d.visa_expiry ? " · " + T("до", "expires") + " " + d.visa_expiry : ""}`] as [string, string]] : []),
      ...(d.us_entry_date ? [[T("Дата въезда в США", "Date of entry to the U.S."), d.us_entry_date] as [string, string]] : []),
      ...(d.prev_itin || d.prev_irsn ? [[T("Прежний ITIN / IRSN", "Previous ITIN / IRSN"), [d.prev_itin, d.prev_irsn, d.prev_name].filter(Boolean).join(" · ")] as [string, string]] : []),
    ]],
    [T("Документы", "Documents"), [[T("Паспорт", "Passport"), passportDocs.map((x) => x.name).join(", ") || "—"],
      ...docs.filter((x) => x.kind !== "passport").map((x) => [x.kind === "tax_return" ? T("Декларация", "Tax return") : T("Подтверждение исключения", "Exception evidence"), x.name] as [string, string])]],
  ];
  const summaryView = (
    <div>
      {summary.map(([title, rows]) => (
        <div key={title} className="panel" style={{ padding: 16, marginBottom: 10 }}>
          <span className="eyebrow">{title}</span>
          {rows.map(([k, val]) => <div className="w7-row" key={k}><span className="muted">{k}</span><strong>{val}</strong></div>)}
        </div>
      ))}
    </div>
  );

  if (status === "submitted") {
    return (
      <section className="panel wizard">
        <span className="eyebrow">{T("Анкета ITIN · форма W-7", "ITIN application · Form W-7")}</span>
        <h2>{T("Анкета отправлена", "Application submitted")}</h2>
        <p className="notice"><CircleCheck size={16} />{T("Специалист CAA проверит данные и подготовит форму W-7. Подпишете её на видеоинтервью. Если что-то нужно исправить, мы вернём анкету с комментарием.", "A CAA will review your details and prepare Form W-7. You will sign it at the video interview. If anything needs fixing, we will return the application with a comment.")}</p>
        {summaryView}
        <Button asChild variant="outline"><Link to="/app">{T("В кабинет", "Back to dashboard")}</Link></Button>
      </section>
    );
  }

  return (
    <section className="panel wizard">
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {labels.map((_, k) => <div key={k} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= step ? "var(--accent)" : "var(--line)" }} />)}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {labels.map((l, k) => <div key={l} style={{ flex: 1, fontSize: 11, textAlign: "center", color: k === step ? "var(--accent)" : "var(--muted)" }}>{l}</div>)}
      </div>
      <span className="eyebrow">{T(`Анкета ITIN · шаг ${step + 1} из 6`, `ITIN application · step ${step + 1} of 6`)}{demoMode ? " · DEMO" : ""}</span>
      {status === "returned" && note && <p className="notice" role="alert"><Info size={16} />{T("Анкета возвращена на исправление: ", "Returned for correction: ")}{note}</p>}

      {step === 0 && <>
        <h2>{T("Почему вам нужен ITIN?", "Why do you need an ITIN?")}</h2>
        <p className="muted">{T("Это раздел «Reason for applying» формы W-7. Основание уже подтвердил наш специалист; выберите подходящий вариант. CAA проверит его на интервью.", "This is the “Reason for applying” section of Form W-7. Our specialist has already confirmed your eligibility; choose the matching option. The CAA will check it at the interview.")}</p>
        <div role="radiogroup" aria-label={T("Причина подачи", "Reason for applying")}>
          {REASONS.map(([code, rr, ee]) => (
            <label key={code} className="checkbox" style={{ alignItems: "flex-start", marginBottom: 8 }}>
              <input type="radio" name="reason" checked={r === code} onChange={() => set("reason", code)} />
              <span><b>{code})</b> {T(rr, ee)}</span>
            </label>
          ))}
        </div>
        {r === "a" && grid(<>{countrySelect("treaty_country", T("Страна соглашения", "Treaty country"), true)}{field("treaty_article", T("Статья соглашения", "Treaty article number"), { req: true })}</>)}
        {["d", "e", "g"].includes(r || "") && grid(<>
          {select("relationship", T("Кем вы приходитесь", "Your relationship"), [["spouse", T("Супруг(а)", "Spouse")], ["child", T("Ребёнок", "Child")], ["parent", T("Родитель", "Parent")], ["other", T("Другое", "Other")]], true)}
          {field("us_person_name", r === "g" ? T("Имя владельца визы", "Visa holder's full name") : T("Имя гражданина или резидента США", "U.S. citizen or resident's full name"), { req: true })}
          {field("us_person_tin", T("Его SSN или ITIN", "Their SSN or ITIN"))}
        </>)}
        {r === "h" && <>
          {select("exception_code", T("Исключение", "Exception"), EXCEPTIONS.map(([c, rr, ee]) => [c, T(rr, ee)]), true)}
          {field("exception_detail", T("Описание (кто платит доход, вид дохода)", "Details (who pays the income, type of income)"), { req: d.exception_code === "other" })}
        </>}
        {r === "f" && grid(<>
          {field("school_name", T("Учебное заведение / организация", "School or institution"), { req: true })}
          {field("school_city", T("Город и штат", "City and state"), { req: true })}
          {field("stay_length", T("Срок пребывания", "Length of stay"))}
        </>)}
      </>}

      {step === 1 && <>
        <h2>{T("О вас", "About you")}</h2>
        <p className="muted">{T("Латиницей, точно как в паспорте.", "In Latin letters, exactly as in your passport.")}</p>
        {grid(<>
          {field("first_name", T("Имя", "First name"), { req: true })}
          {field("middle_name", T("Второе имя", "Middle name"))}
          {field("last_name", T("Фамилия", "Last name"), { req: true })}
        </>)}
        {grid(<>
          {field("birth_first_name", T("Имя при рождении (если менялось)", "First name at birth (if different)"))}
          {field("birth_last_name", T("Фамилия при рождении (если менялась)", "Last name at birth (if different)"))}
        </>)}
        {grid(<>
          {field("dob", T("Дата рождения", "Date of birth"), { req: true, type: "date" })}
          {countrySelect("birth_country", T("Страна рождения", "Country of birth"), true)}
          {field("birth_city", T("Город (и область) рождения", "City (and state/province) of birth"), { req: true })}
        </>)}
        <div role="radiogroup" aria-label={T("Пол", "Sex")} style={{ display: "flex", gap: 20, margin: "6px 0 10px" }}>
          <span>{T("Пол", "Sex")} *</span>
          <label className="checkbox"><input type="radio" name="gender" checked={d.gender === "male"} onChange={() => set("gender", "male")} />{T("Мужской", "Male")}</label>
          <label className="checkbox"><input type="radio" name="gender" checked={d.gender === "female"} onChange={() => set("gender", "female")} />{T("Женский", "Female")}</label>
        </div>
        {grid(<>
          {countrySelect("citizenship", T("Гражданство", "Country of citizenship"), true)}
          {countrySelect("citizenship2", T("Второе гражданство", "Second citizenship"))}
          {field("foreign_tin", T("Налоговый номер в вашей стране", "Foreign tax ID number"), { hint: T("Если есть", "If you have one") })}
        </>)}
      </>}

      {step === 2 && <>
        <h2>{T("Адреса", "Addresses")}</h2>
        <span className="eyebrow">{T("Постоянный адрес за пределами США (строка 3)", "Permanent address outside the U.S. (line 3)")}</span>
        <p className="muted">{T("Без абонентских ящиков. IRS требует адрес страны проживания.", "No P.O. boxes. The IRS requires your address in your country of residence.")}</p>
        {grid(<>
          {field("home_street", T("Улица, дом, квартира", "Street, building, apartment"), { req: true })}
          {field("home_city", T("Город", "City"), { req: true })}
          {field("home_region", T("Область / регион", "State / province"))}
          {field("home_postal", T("Индекс", "Postal code"))}
          {countrySelect("home_country", T("Страна", "Country"), true, true)}
        </>)}
        <label className="checkbox" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={v("mail_same") === "yes"} onChange={(e) => set("mail_same", e.target.checked ? "yes" : "no")} />
          {T("Письмо IRS с номером ITIN присылать на этот же адрес", "Send the IRS letter with my ITIN to this same address")}
        </label>
        {v("mail_same") !== "yes" && <>
          <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>{T("Почтовый адрес для письма IRS (строка 2)", "Mailing address for the IRS letter (line 2)")}</span>
          {grid(<>
            {field("mail_street", T("Улица, дом, квартира", "Street, building, apartment"), { req: true })}
            {field("mail_city", T("Город", "City"), { req: true })}
            {field("mail_region", T("Штат / регион", "State / province"))}
            {field("mail_postal", T("Индекс", "Postal code"))}
            {countrySelect("mail_country", T("Страна", "Country"), true)}
          </>)}
        </>}
        {grid(field("phone", T("Телефон для связи", "Phone number"), { type: "tel" }))}
      </>}

      {step === 3 && <>
        <h2>{T("Паспорт и виза", "Passport and visa")}</h2>
        <p className="muted">{T("Паспорт — единственный документ, который подтверждает и личность, и иностранный статус. Он должен быть действующим.", "A passport is the only document that proves both identity and foreign status. It must be valid.")}</p>
        {grid(<>
          {countrySelect("passport_country", T("Страна выдачи", "Issuing country"), true)}
          {field("passport_number", T("Номер паспорта", "Passport number"), { req: true })}
          {field("passport_expiry", T("Действителен до", "Expiration date"), { req: true, type: "date" })}
        </>)}
        <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>{T("Виза США и въезд — если есть", "U.S. visa and entry — if any")}</span>
        {grid(<>
          {select("visa_type", T("Тип визы", "Visa type"), VISAS.map((x) => [x, x === "Other" ? T("Другая", "Other") : x]))}
          {field("visa_number", T("Номер визы", "Visa number"))}
          {field("visa_expiry", T("Виза до", "Visa expiration"), { type: "date" })}
          {field("us_entry_date", T("Дата въезда в США", "Date of entry to the U.S."), { type: "date" })}
        </>)}
        <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>{T("Раньше получали ITIN или IRSN?", "Ever received an ITIN or IRSN?")}</span>
        {grid(<>
          {field("prev_itin", "ITIN", { hint: "9XX-XX-XXXX" })}
          {field("prev_irsn", "IRSN")}
          {field("prev_name", T("Имя, на которое выдан", "Name it was issued under"))}
        </>)}
      </>}

      {step === 4 && <>
        <h2>{T("Документы", "Documents")}</h2>
        <p className="muted">{T("Скан всех страниц паспорта с данными и фото, цветной и чёткий. Оригинал или заверенную копию CAA проверит на видеоинтервью — отправлять паспорт в IRS не нужно.", "A clear colour scan of all passport pages with your details and photo. The CAA verifies the original on the video interview — you don't mail your passport to the IRS.")}</p>
        {uploadZone("passport", T("Паспорт *", "Passport *"), passportDocs)}
        {r === "b" && uploadZone("tax_return", T("Налоговая декларация (если уже готова)", "Tax return (if already prepared)"), docs.filter((x) => x.kind === "tax_return"))}
        {r === "h" && uploadZone("exception_evidence", T("Подтверждение исключения (письмо банка, договор и т. п.)", "Exception evidence (bank letter, contract, etc.)"), docs.filter((x) => x.kind === "exception_evidence"))}
        {order?.product === "itin_return" && <p className="notice"><FileText size={16} />{T("Декларацию 1040-NR подготовим мы — загружать её не нужно.", "We prepare the 1040-NR — you don't need to upload it.")}</p>}
      </>}

      {step === 5 && <>
        <h2>{T("Проверьте данные", "Review your details")}</h2>
        {summaryView}
        <label className="checkbox" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErr(""); }} />
          {T("Подтверждаю, что данные верны и полны. Понимаю, что форму W-7 подписываю под ответственность за ложные сведения (penalties of perjury) — подпишу её на интервью с CAA.", "I confirm the information is true and complete. I understand Form W-7 is signed under penalties of perjury — I will sign it at the CAA interview.")}
        </label>
      </>}

      <p role="alert" style={{ color: "#b42318", minHeight: 22, marginTop: 12 }}>{err}</p>
      <div className="button-row">
        {step > 0 && <Button variant="ghost" disabled={busy} onClick={() => { setErr(""); setStep((s) => s - 1); }}><ArrowLeft size={16} /> {T("Назад", "Back")}</Button>}
        {step < 5
          ? <Button disabled={busy} onClick={next}>{busy ? T("Сохраняем…", "Saving…") : T("Продолжить", "Continue")}<ArrowRight size={16} /></Button>
          : <Button disabled={busy} onClick={submit}>{busy ? T("Отправляем…", "Submitting…") : T("Отправить анкету", "Submit application")}<ArrowRight size={16} /></Button>}
      </div>
      <p className="fineprint">{T("Черновик сохраняется при каждом «Продолжить» — можно вернуться позже.", "Your draft is saved at every “Continue” — you can come back later.")}</p>
    </section>
  );
}
