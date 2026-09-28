import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useOutletContext, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Info, LockKeyhole, MessageCircle, XCircle } from "lucide-react";
import { useI18n } from "../i18n";
import { supabase, demoMode, recordConsent, type Order } from "../lib/supabase";
import { SPECIALIST_CONSULT_ENABLED } from "../lib/config";
import { countryList } from "../lib/countries";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";

// Консультация специалиста (UI_SPEC_016_017): заказ itin_consult для ответов опросника
// «Не знаю» / «Налоговой причины, похоже, нет». ITIN Standard/Return клиенту до решения
// администратора не назначается, оплата недоступна.

export type ContactMethod = "telegram" | "whatsapp";
export type ConsultContact = { method: ContactMethod | ""; value: string; time: string };

const QUIZ_SSN = ["no", "unsure"];
const QUIZ_BASIS = ["unknown", "none"];

// Та же валидация, что в record_consult_contact: контакт 2–200 символов, время до 200.
export function contactErrors(c: ConsultContact, ru: boolean) {
  const e: Partial<Record<keyof ConsultContact, string>> = {};
  if (!c.method) e.method = ru ? "Выберите Telegram или WhatsApp" : "Choose Telegram or WhatsApp";
  const v = c.value.trim().length;
  if (v < 2 || v > 200) e.value = ru ? "Укажите контакт: от 2 до 200 символов" : "Enter a contact: 2–200 characters";
  if (c.time.trim().length > 200) e.time = ru ? "Не больше 200 символов" : "200 characters maximum";
  return e;
}

// Сообщения по ошибкам сервера — из раздела «Состояния и сообщения» спецификации.
export function consultErrorMessage(message: string | undefined, ru: boolean) {
  const map: Record<string, [string, string]> = {
    "Not a consult order": ["Этот заказ уже перешёл на другой этап. Обновите страницу.", "This order has already moved to another stage. Please refresh the page."],
    "Order closed": ["Заказ уже закрыт или отменён.", "The order is already closed or cancelled."],
    "Eligibility approval required": ["Оплата доступна после подтверждения основания администратором.", "Payment is available once an administrator confirms the basis."],
    "Invalid contact value": ["Укажите контакт: от 2 до 200 символов.", "Enter a contact: 2–200 characters."],
    "Invalid preferred time": ["Удобное время — не больше 200 символов.", "Preferred time: 200 characters maximum."],
  };
  const hit = message && map[message];
  if (hit) return ru ? hit[0] : hit[1];
  return ru ? "Не удалось сохранить. Попробуйте ещё раз." : "Could not save. Please try again.";
}

export function ConsultContactFields({
  value, onChange, errors, disabled, idPrefix,
}: {
  value: ConsultContact;
  onChange: (c: ConsultContact) => void;
  errors: Partial<Record<keyof ConsultContact, string>>;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { lang } = useI18n();
  const ru = lang !== "en";
  const placeholder = value.method === "whatsapp" ? "+1 555 123 4567" : "@username";
  return (
    <>
      <fieldset className="consult-method wide" disabled={disabled} aria-describedby={errors.method ? idPrefix + "-method-error" : undefined}>
        <legend>{ru ? "Как с вами связаться" : "How should we contact you"} *</legend>
        <div className="quiz-options consult-method-options">
          {(["telegram", "whatsapp"] as const).map((m) => (
            <label key={m} className={value.method === m ? "chosen" : ""}>
              <input type="radio" name={idPrefix + "-method"} value={m} checked={value.method === m}
                onChange={() => onChange({ ...value, method: m })} />
              {m === "telegram" ? "Telegram" : "WhatsApp"}
            </label>
          ))}
        </div>
        {errors.method && <small className="field-error" id={idPrefix + "-method-error"}>{errors.method}</small>}
      </fieldset>
      <label htmlFor={idPrefix + "-value"}>
        {value.method === "whatsapp" ? (ru ? "Номер WhatsApp" : "WhatsApp number") : (ru ? "Telegram или номер телефона" : "Telegram username or phone")} *
        <input id={idPrefix + "-value"} required maxLength={200} disabled={disabled} placeholder={placeholder}
          value={value.value} aria-invalid={!!errors.value}
          aria-describedby={errors.value ? idPrefix + "-value-error" : undefined}
          onChange={(e) => onChange({ ...value, value: e.target.value })} />
        {errors.value && <small className="field-error" id={idPrefix + "-value-error"}>{errors.value}</small>}
      </label>
      <label htmlFor={idPrefix + "-time"}>
        {ru ? "Удобное время (необязательно)" : "Preferred time (optional)"}
        <input id={idPrefix + "-time"} maxLength={200} disabled={disabled}
          placeholder={ru ? "Например, будни после 18:00 по Еревану" : "e.g. weekdays after 6 pm Yerevan time"}
          value={value.time} aria-invalid={!!errors.time}
          aria-describedby={errors.time ? idPrefix + "-time-error" : undefined}
          onChange={(e) => onChange({ ...value, time: e.target.value })} />
        {errors.time && <small className="field-error" id={idPrefix + "-time-error"}>{errors.time}</small>}
      </label>
    </>
  );
}

export function ConsultOnboarding() {
  const { t, lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const { session } = useAuth();
  const { refresh } = useOutletContext<{ refresh: () => void }>();
  const [params] = useSearchParams();
  const countries = useMemo(() => countryList(lang), [lang]);
  const [form, setForm] = useState({ name: "", country: "" });
  const [contact, setContact] = useState<ConsultContact>({ method: "", value: "", time: "" });
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [id, setId] = useState("");
  const [done, setDone] = useState(false);

  // Ответы опросника сохраняются в анкете: специалист видит, с чем пришёл клиент.
  const quiz: Record<string, string> = {};
  const qs = params.get("quiz_ssn");
  const qb = params.get("quiz_basis");
  if (qs && QUIZ_SSN.includes(qs)) quiz.quiz_ssn = qs;
  if (qb && QUIZ_BASIS.includes(qb)) quiz.quiz_basis = qb;

  if (!SPECIALIST_CONSULT_ENABLED) return <Navigate to="/itin#quiz" replace />;

  const errors = contactErrors(contact, ru);
  const baseErrors = {
    name: !form.name.trim() ? T("Укажите имя", "Enter your name") : "",
    country: !form.country ? T("Выберите страну", "Choose a country") : "",
    consent: !consent ? T("Нужно согласие с условиями", "Consent is required") : "",
  };
  const shown = touched ? errors : {};
  const invalid = Object.keys(errors).length > 0 || Object.values(baseErrors).some(Boolean);

  async function submit() {
    setTouched(true);
    setMessage("");
    if (invalid || busy) return;
    if (demoMode) { setDone(true); return; }
    if (!supabase || !session) { setMessage(t.error); return; }
    setBusy(true);
    try {
      // Черновик создаётся один раз: при повторной отправке после ошибки используем тот же заказ.
      let orderId = id;
      if (!orderId) {
        const { data, error } = await supabase.from("orders")
          .insert({ client_id: session.user.id, product: "itin_consult", status: "draft",
                    applicant: { name: form.name.trim(), country: form.country, ...quiz } })
          .select("id").single();
        if (error) throw error;
        orderId = data.id as string;
        setId(orderId);
      } else {
        const { error } = await supabase.from("orders")
          .update({ applicant: { name: form.name.trim(), country: form.country, ...quiz } }).eq("id", orderId);
        if (error) throw error;
      }
      const { error: contactError } = await supabase.rpc("record_consult_contact", {
        p_order: orderId, p_method: contact.method, p_value: contact.value.trim(), p_preferred_time: contact.time.trim(),
      });
      if (contactError) throw contactError;
      await recordConsent(orderId);
      const { error: submitError } = await supabase.rpc("submit_order", { p_order: orderId });
      if (submitError) throw submitError;
      setDone(true);
      refresh();
    } catch (error) {
      setMessage(consultErrorMessage((error as { message?: string })?.message, ru));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="panel wizard" aria-live="polite">
        <MessageCircle size={32} />
        <h2>{T("Заявка на консультацию отправлена", "Consultation request sent")}</h2>
        <p>{T("Специалист свяжется с вами в выбранном мессенджере. После интервью решение принимает Taxpasso — вы увидите его в кабинете.",
              "A specialist will contact you in the messenger you chose. After the interview Taxpasso makes the decision — you'll see it in your dashboard.")}</p>
        <p className="notice"><LockKeyhole size={16} />{T("Оплата сейчас не нужна: она откроется, только если основание для ITIN подтвердится.",
                                                            "No payment now: it opens only if the ITIN basis is confirmed.")}{demoMode ? " · DEMO" : ""}</p>
        <div className="button-row">
          <Button asChild><Link to="/app">{t.dashboard}<ArrowRight size={17} /></Link></Button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel wizard consult-form">
      <span className="eyebrow">ITIN / {T("КОНСУЛЬТАЦИЯ", "CONSULTATION")}</span>
      <h2>{T("Проверить основание у специалиста", "Have a specialist check your basis")}</h2>
      <p className="muted">{T("Коротко поговорим в Telegram или WhatsApp, выясним, есть ли у вас налоговая причина для ITIN, и предложим подходящий вариант.",
                               "We'll have a short chat on Telegram or WhatsApp, find out whether you have a tax reason for an ITIN, and suggest the right option.")}</p>
      <p className="notice"><Info size={16} />
        {T("Консультация не гарантирует выдачу ITIN. Оплату до подтверждения основания мы не берём: если основание не подтвердится, вы ничего не платите.",
           "A consultation does not guarantee an ITIN. We don't take payment before the basis is confirmed: if it isn't, you pay nothing.")}
      </p>
      <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="consult-name">
          {t.fullName} *
          <input id="consult-name" required maxLength={160} disabled={busy} value={form.name}
            aria-invalid={touched && !!baseErrors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {touched && baseErrors.name && <small className="field-error">{baseErrors.name}</small>}
        </label>
        <label htmlFor="consult-country">
          {t.residence} *
          <select id="consult-country" required disabled={busy} value={form.country}
            aria-invalid={touched && !!baseErrors.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}>
            <option value="">—</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          {touched && baseErrors.country && <small className="field-error">{baseErrors.country}</small>}
        </label>
        <ConsultContactFields idPrefix="consult" value={contact} onChange={setContact} errors={shown} disabled={busy} />
        <label className="checkbox wide">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={touched && !!baseErrors.consent} />
          {t.consent}
        </label>
        {touched && baseErrors.consent && <small className="field-error wide">{baseErrors.consent}</small>}
        <div className="wide">
          <Link to="/terms" target="_blank">{t.legal[0]}</Link> · <Link to="/privacy" target="_blank">{t.legal[1]}</Link>
        </div>
        <p role="alert" className="wide field-error">{message}</p>
        <div className="button-row wide">
          <Button variant="ghost" type="button" asChild><Link to="/itin#quiz">{t.back}</Link></Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t.loading : T("Отправить заявку", "Send request")}
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </section>
  );
}

// Трекер консультации в кабинете клиента. До решения администратора — только этапы,
// без предложения специалиста и внутренних комментариев. После одобрения заказ
// сам становится itin_standard / itin_return и показывается обычным трекером ITIN.
export function ConsultTracker({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const rejected = order.eligibility === "rejected";
  const cancelled = !!order.cancelled_at;
  const draft = order.status === "draft";
  const open = !rejected && !cancelled && !order.closed_at && !draft;
  const submittedAt = order.order_status_history?.find((h) => h.status === "consult_interview")?.created_at;
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(ru ? "ru-RU" : "en-US") : t.pending);

  const steps = [
    T("Заявка отправлена", "Request sent"),
    T("Интервью", "Interview"),
    T("Решение Taxpasso", "Taxpasso decision"),
    rejected ? T("Основание не подтверждено", "Basis not confirmed") : T("Документы и оплата", "Documents and payment"),
  ];
  // Клиент не видит, отправил ли специалист предложение: пока решения нет, активен этап «Интервью».
  const current = draft ? 0 : rejected ? 3 : 1;

  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ConsultContact>({
    method: (order.applicant.contact_method as ContactMethod) || "",
    value: order.applicant.contact_value || "",
    time: order.applicant.preferred_time || "",
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (!open) setEditing(false); }, [open]);
  const errors = contactErrors(contact, ru);

  async function saveContact() {
    setTouched(true);
    setMsg("");
    if (Object.keys(errors).length || busy || !supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc("record_consult_contact", {
      p_order: order.id, p_method: contact.method, p_value: contact.value.trim(), p_preferred_time: contact.time.trim(),
    });
    setBusy(false);
    if (error) { setMsg(consultErrorMessage(error.message, ru)); onChanged(); return; }
    setEditing(false);
    setTouched(false);
    setMsg(t.saved);
    onChanged();
  }

  const methodName = order.applicant.contact_method === "whatsapp" ? "WhatsApp" : order.applicant.contact_method === "telegram" ? "Telegram" : "";
  return (
    <article className="panel tracker">
      <div className="tracker-head">
        <div>
          <span className="eyebrow">ITIN / {T("КОНСУЛЬТАЦИЯ СПЕЦИАЛИСТА", "SPECIALIST CONSULTATION")}</span>
          <h2>{order.applicant.name || T("Консультация специалиста", "Specialist consultation")}</h2>
          <span className="muted">#{order.id.slice(0, 8)}</span>
        </div>
        <span className={"badge" + (rejected || cancelled ? " neutral" : "")}>
          {cancelled ? T("Отменён", "Cancelled") : draft ? t.draft : steps[current]}
        </span>
      </div>
      <div className="button-row">
        <span className="badge neutral">{T("Без оплаты до решения", "No payment before the decision")}</span>
      </div>
      {rejected && (
        <p className="notice consult-rejected" role="alert">
          <XCircle size={18} />
          <span>
            <b>{T("Основание для ITIN не подтверждено. Заказ закрыт, оплата не требуется.", "The ITIN basis was not confirmed. The order is closed and no payment is due.")}</b>
            {order.eligibility_note && <><br />{T("Причина: ", "Reason: ")}{order.eligibility_note}</>}
          </span>
        </p>
      )}
      {draft && (
        <p className="notice"><Info size={16} />
          <span>{T("Заявка не отправлена.", "The request has not been sent.")}{" "}
            <Link className="text-link" to="/app/consult">{T("Заполнить заново", "Start again")}</Link>
          </span>
        </p>
      )}
      {open && <p className="notice"><Info size={16} />{T("Специалист свяжется с вами, проведёт короткое интервью и передаст итог в Taxpasso. Решение появится здесь.",
                                                          "A specialist will contact you for a short interview and pass the outcome to Taxpasso. The decision will appear here.")}</p>}
      <ol className="timeline timeline-4">
        {steps.map((label, i) => {
          const state = i < current ? "complete" : i === current ? (rejected ? "active failed" : "active") : "";
          return (
            <li className={state} key={label}>
              <span className="timeline-icon">{i < current ? <Check size={16} /> : rejected && i === 3 ? <XCircle size={16} /> : i + 1}</span>
              <div>
                <b>{label}</b>
                <small>{i === 0 ? fmt(submittedAt) : rejected && i === 3 ? fmt(order.closed_at) : i < current ? "" : t.pending}</small>
                {i === current && !rejected && !draft && <p>{t.current}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {!draft && (
        <div className="consult-contact">
          <div>
            <small className="muted">{T("Контакт для связи", "Contact")}</small>
            <div><b>{methodName}{methodName && order.applicant.contact_value ? " · " : ""}{order.applicant.contact_value || "—"}</b></div>
            {order.applicant.preferred_time && <small className="muted">{T("Удобное время: ", "Preferred time: ")}{order.applicant.preferred_time}</small>}
          </div>
          {open && !editing && (
            <Button variant="outline" onClick={() => { setEditing(true); setMsg(""); }}>{T("Изменить контакт", "Change contact")}</Button>
          )}
        </div>
      )}
      {open && editing && (
        <form className="form-grid consult-edit" noValidate onSubmit={(e) => { e.preventDefault(); saveContact(); }}>
          <ConsultContactFields idPrefix={"consult-" + order.id.slice(0, 8)} value={contact} onChange={setContact}
            errors={touched ? errors : {}} disabled={busy} />
          <div className="button-row wide">
            <Button variant="ghost" type="button" disabled={busy} onClick={() => { setEditing(false); setTouched(false); }}>{t.back}</Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? t.loading : t.save}</Button>
          </div>
        </form>
      )}
      <p role="status" className="muted">{msg}</p>
    </article>
  );
}
