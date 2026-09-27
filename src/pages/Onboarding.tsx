import { useMemo, useState } from "react";
import { Link, useSearchParams, useOutletContext } from "react-router-dom";
import { Check, ArrowRight, Upload, LockKeyhole } from "lucide-react";
import { useI18n } from "../i18n";
import {
  supabase,
  demoMode,
  uploadDocument,
  recordConsent,
} from "../lib/supabase";
import { countryList } from "../lib/countries";
import { useAuth } from "../lib/auth";
import { products } from "./Pricing";
import { Button } from "../components/ui/button";
export function Onboarding() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const { refresh } = useOutletContext<{ refresh: () => void }>();
  const [params] = useSearchParams();
  const [product, setProduct] = useState(
    products.some((p) => p.id === params.get("product"))
      ? params.get("product")!
      : "llc_wy",
  );
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    company: "",
    country: "",
    activity: "",
  });
  const [id, setId] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const itin = product.startsWith("itin");
  const needsGate = itin || product.startsWith("bundle");
  const [submitted, setSubmitted] = useState(false);
  const countries = useMemo(() => countryList(lang), [lang]);
  // Ответы опросника ITIN — сохраняются в анкете, чтобы специалист видел их в заказе.
  const quiz: Record<string, string> = {};
  const qs = params.get("quiz_ssn");
  const qb = params.get("quiz_basis");
  if (qs && ["no", "unsure"].includes(qs)) quiz.quiz_ssn = qs;
  if (qb && ["prepare_return", "return_ready", "irs_exception", "unknown", "none"].includes(qb)) quiz.quiz_basis = qb;

  // Возвращает номер черновика: состояние id обновляется асинхронно и сразу после setId ещё пустое.
  async function ensureDraft(): Promise<string> {
    if (id || demoMode) {
      if (demoMode && !id) setId("demo-new");
      return id || "demo-new";
    }
    if (!supabase || !session) throw new Error("Sign in required");
    const { data, error } = await supabase
      .from("orders")
      .insert({
        client_id: session.user.id,
        product,
        applicant: quiz,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw error;
    setId(data.id);
    refresh();
    return data.id as string;
  }
  async function next() {
    setMessage("");
    if (step === 0) {
      setBusy(true);
      try {
        await ensureDraft();
        setStep(1);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t.error);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 1) {
      if (
        !form.name.trim() ||
        !form.country.trim() ||
        (!itin && (!form.company.trim() || !form.activity.trim())) ||
        !consent
      ) {
        setMessage(t.required);
        return;
      }
      if (demoMode) {
        setId("demo-new");
        setStep(2);
        return;
      }
      setBusy(true);
      try {
        const orderId = await ensureDraft();
        const { error } = await supabase!
          .from("orders")
          .update({ applicant: { ...form, ...quiz } })
          .eq("id", orderId);
        if (error) throw error;
        setStep(2);
        refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t.error);
      } finally {
        setBusy(false);
      }
    }
    if (step === 2) {
      setStep(3);
    }
  }
  async function upload(file?: File) {
    if (!file || demoMode) return;
    setBusy(true);
    try {
      await uploadDocument(id, file, "passport");
      setFiles((a) => [...a, file.name]);
      setMessage(t.saved);
    } catch {
      setMessage(t.error);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (demoMode) {
      setSubmitted(true);
      return;
    }
    setBusy(true);
    try {
      // Согласие сохраняется в базе вместе с версией условий — до отправки заявки.
      await recordConsent(id);
      const { error } = await supabase!.rpc("submit_order", { p_order: id });
      if (error) throw error;
      setSubmitted(true);
      refresh();
    } catch {
      setMessage(t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel wizard">
      <div className="wizard-steps">
        {t.wizard.map((s, i) => (
          <div className={i <= step ? "active" : ""} key={s}>
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {s}
          </div>
        ))}
      </div>
      <h2>{t.wizard[step]}</h2>
      {step === 0 && (
        <div className="product-options">
          {products.map((p) => (
            <label key={p.id} className={product === p.id ? "chosen" : ""}>
              <input
                type="radio"
                name="product"
                disabled={!!id}
                checked={product === p.id}
                onChange={() => setProduct(p.id)}
              />
              <span>{p.name}</span>
              <b>${p.price}</b>
            </label>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="form-grid">
          {(
            [
              "name",
              ...(!itin ? ["company", "activity"] : []),
              "country",
            ] as (keyof typeof form)[]
          ).map((k) => (
            <label key={k}>
              {
                {
                  name: t.fullName,
                  company: t.company,
                  country: t.residence,
                  activity: t.activity,
                }[k]
              }{" "}
              *
              {k === "country" ? (
                <select
                  required
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                >
                  <option value="">—</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  maxLength={k === "activity" ? 1000 : 160}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              )}
            </label>
          ))}
          <label className="checkbox wide">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t.consent}
          </label>
          <div className="wide">
            <Link to="/terms" target="_blank">
              {t.legal[0]}
            </Link>{" "}
            ·{" "}
            <Link to="/privacy" target="_blank">
              {t.legal[1]}
            </Link>
          </div>
        </div>
      )}
      {step === 2 && (
        <>
          <p>{t.uploadHint}</p>
          <label className="upload-zone">
            <Upload size={30} />
            <b>{t.upload}</b>
            <span>{demoMode ? t.demo : "PDF / JPG / PNG · 10 MB"}</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={demoMode || busy}
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {files.map((f, i) => (
            <p key={i}>
              <Check size={16} />
              {f}
            </p>
          ))}
        </>
      )}
      {step === 3 && (
        <div className="payment-summary">
          <LockKeyhole size={30} />
          <h3>{products.find((p) => p.id === product)?.name}</h3>
          <div className="price">
            ${products.find((p) => p.id === product)?.price}
          </div>
          {needsGate && <p className="notice">{t.itinGate}</p>}
          <p>{t.paymentNote}</p>
          <Button disabled>{t.payment}</Button>
          <div className="button-row">
            {!submitted ? (
              <Button variant="outline" disabled={busy} onClick={submit}>
                {t.save}
              </Button>
            ) : (
              <>
                <span role="status">
                  <Check size={17} />
                  {t.saved}
                  {demoMode ? " · DEMO" : ""}
                </span>
                <Button variant="outline" asChild>
                  <Link to="/app">{t.dashboard}</Link>
                </Button>
              </>
            )}
          </div>
          <p className="fineprint">
            {lang === "ru"
              ? "Отправка заявки не запускает платные услуги."
              : "Submitting an application does not start paid services."}
          </p>
        </div>
      )}
      <p role="alert">{message}</p>
      <div className="button-row">
        {step > 0 && !submitted && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setStep(step - 1)}
          >
            {t.back}
          </Button>
        )}
        {step < 3 && (
          <Button disabled={busy} onClick={next}>
            {busy ? t.loading : t.next}
            <ArrowRight size={18} />
          </Button>
        )}
      </div>
    </section>
  );
}
