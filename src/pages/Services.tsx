import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, ShieldCheck, Info } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";
import { Steps, FAQBlock, CTA } from "./Home";
import { SPECIALIST_CONSULT_ENABLED } from "../lib/config";
export function LLC() {
  const { t, lang } = useI18n();
  return (
    <div className="container page">
      <div className="page-heading">
        <span className="eyebrow">LLC + EIN</span>
        <h1>{t.llcTitle}</h1>
        <p>{t.llcSub}</p>
      </div>
      <div className="two-col">
        <article className="panel">
          <span className="badge">{t.recommended}</span>
          <h2>Wyoming</h2>
          <p>{t.wyDesc}</p>
          <div className="price">$349</div>
          <p>
            {t.renewal}: $149/{t.year}
          </p>
          <p>
            {t.separate}: {t.from} $60/{t.year}
          </p>
          <Button asChild>
            <Link to="/app/start?product=llc_wy">
              {t.open}
              <ArrowRight size={18} />
            </Link>
          </Button>
        </article>
        <article className="panel">
          <h2>Delaware</h2>
          <p>{t.deDesc}</p>
          <div className="price">$449</div>
          <p>
            {t.renewal}: $199/{t.year}
          </p>
          <p>
            {t.separate}: $400/{t.year}
          </p>
          <Button asChild variant="outline">
            <Link to="/app/start?product=llc_de">
              {t.open}
              <ArrowRight size={18} />
            </Link>
          </Button>
        </article>
      </div>
      <p className="notice">
        <Info />
        {t.llcNote}
      </p>
      <Steps />
      <div className="two-col section">
        <article className="panel">
          <h3>{t.llcScope}</h3>
          <ul className="check-list">
            {t.llcItems.map((x) => (
              <li key={x}>
                <Check size={18} />
                {x}
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <h3>{t.llcOutside}</h3>
          <p>{t.llcOutText}</p>
          <p className="notice">{t.einTiming}</p>
        </article>
      </div>
      <p className="fineprint">
        {lang === "ru"
          ? "Размер платежа Delaware и минимум Wyoming:"
          : "Delaware fee and Wyoming minimum:"}{" "}
        <a href="https://corp.delaware.gov/alt-entitytaxinstructions/">
          Delaware Division of Corporations
        </a>{" "}
        ·{" "}
        <a href="https://sos.wyo.gov/business/docs/businessfees.pdf">
          Wyoming Secretary of State
        </a>
      </p>
      <CTA />
    </div>
  );
}
// Опросник ITIN: 2 вопроса, у каждого ответа — понятный итог и следующий шаг.
// Итог не подтверждает право на ITIN окончательно: основание проверяет партнёр до оплаты.
type QuizOutcome =
  | { kind: "has_ssn" }
  | { kind: "no_basis" }
  | { kind: "consult" }
  | { kind: "apply"; product: string; review: boolean; note?: string; alt?: string };

// Коды ответов передаются в анкету, чтобы специалист видел их в заказе.
const SSN_CODES = ["no", "yes", "unsure"];
const BASIS_CODES = ["prepare_return", "return_ready", "irs_exception", "unknown", "none"];

export function ITINQuiz() {
  const { t, lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const [params] = useSearchParams();
  const requested = params.get("product");
  const fromBundle = requested === "bundle_wy" || requested === "bundle_de";
  // Если пришли из пакета Delaware — LLC тоже предлагаем в Delaware.
  const llcProduct = requested === "bundle_de" ? "llc_de" : "llc_wy";
  const [step, setStep] = useState(0);
  const [ssn, setSsn] = useState("");
  const [basis, setBasis] = useState("");
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);

  const questions = [
    {
      q: T("Есть ли у вас номер SSN или право на него?", "Do you have an SSN or are you eligible for one?"),
      hint: T("SSN — номер социального страхования США. Его выдают, например, при праве на работу в США. Если у вас есть SSN или право на него, IRS не принимает заявление на ITIN (W-7).",
              "An SSN is a US Social Security Number, issued for example to people authorised to work in the US. If you have an SSN or are eligible for one, the IRS does not accept an ITIN application (W-7)."),
      options: [T("Нет", "No"), T("Да, есть SSN или право на него", "Yes, I have one or I'm eligible"), T("Не уверен(а)", "Not sure")],
      value: ssn, set: setSsn,
    },
    {
      q: T("Зачем вам ITIN? Есть ли налоговая причина?", "Why do you need an ITIN? Is there a tax reason?"),
      hint: T("ITIN выдают при налоговой причине: чаще всего — обязанность подать налоговую декларацию США. Реже — одно из исключений IRS с подтверждающими документами. Обычная просьба банка «предоставить ITIN» сама по себе не является основанием.",
              "An ITIN is issued for a tax reason: most often a requirement to file a US tax return, less often one of the IRS exceptions backed by supporting documents. A bank simply asking for an ITIN is not a reason on its own."),
      options: [
        T("Нужно подать налоговую декларацию США, и её нужно подготовить", "I must file a US tax return and need it prepared"),
        T("Налоговая декларация уже готова", "My tax return is already prepared"),
        T("Подхожу под исключение IRS и есть подтверждающие документы", "I qualify for an IRS exception and have supporting documents"),
        T("Не знаю", "I don't know"),
        T("Налоговой причины, похоже, нет", "There seems to be no tax reason"),
      ],
      value: basis, set: setBasis,
    },
  ];

  function decide(): QuizOutcome {
    if (ssn === "1") return { kind: "has_ssn" };
    if (basis === "4") return { kind: "no_basis" };
    // «Не знаю» — отдельный заказ itin_consult: тариф ITIN до решения администратора не назначаем.
    if (basis === "3" && SPECIALIST_CONSULT_ENABLED) return { kind: "consult" };
    const review = ssn === "2" || basis === "3";
    const formNote = T("Это предварительная рекомендация: налоговый статус и нужную форму декларации (1040-NR или 1040) подтвердит специалист.",
                       "This is a preliminary recommendation: a specialist will confirm your tax status and the right return form (1040-NR or 1040).");
    if (basis === "0") {
      return fromBundle
        ? { kind: "apply", product: requested!, review, alt: "itin_return",
            note: T("В пакет входит ITIN Standard без подготовки декларации. Если декларацию нужно подготовить, выберите «ITIN + подготовка декларации» отдельно.",
                    "The bundle includes ITIN Standard without tax return preparation. If you need a return prepared, choose “ITIN + tax return” separately.") }
        : { kind: "apply", product: "itin_return", review, note: formNote };
    }
    if (basis === "3") {
      return { kind: "apply", product: fromBundle ? requested! : "itin_standard", review: true,
               note: T("Сначала специалист проверит, есть ли основание. Тариф предварительный: если понадобится подготовка декларации, предложим «ITIN + подготовка декларации».",
                       "First a specialist checks whether there is a basis. The plan is preliminary: if a return must be prepared, we'll offer “ITIN + tax return”.") };
    }
    return { kind: "apply", product: fromBundle ? requested! : "itin_standard", review };
  }

  function next() {
    if (step === 0 && ssn === "1") { setOutcome({ kind: "has_ssn" }); return; }
    if (step < questions.length - 1) { setStep(step + 1); return; }
    setOutcome(decide());
  }
  function restart() { setOutcome(null); setStep(0); setSsn(""); setBasis(""); }
  // Ссылка в анкету с ответами опросника
  const applyLink = (product: string, basisCode = BASIS_CODES[Number(basis)] || "") =>
    `${product.startsWith("bundle") ? "/app/start" : "/app/new"}?product=${product}&quiz_ssn=${SSN_CODES[Number(ssn)] || ""}&quiz_basis=${basisCode}`;

  // Консультация специалиста (016–017): вместо заказа ITIN создаётся заказ itin_consult.
  const consultLink = () =>
    `/app/consult?quiz_ssn=${SSN_CODES[Number(ssn)] || ""}&quiz_basis=${BASIS_CODES[Number(basis)] || ""}`;
  const consultNote = T("Специалист свяжется с вами в Telegram или WhatsApp и проверит основание. Консультация не гарантирует выдачу ITIN, оплату до подтверждения основания мы не берём.",
                        "A specialist will contact you on Telegram or WhatsApp to check your basis. A consultation does not guarantee an ITIN; we don't take payment before the basis is confirmed.");
  const productName = (id: string) =>
    ({ itin_standard: "ITIN Standard · $259", itin_return: T("ITIN + подготовка декларации · $400", "ITIN + tax return · $400"),
       bundle_wy: T("Старт в США · WY · $549", "US Launch · WY · $549"), bundle_de: T("Старт в США · DE · $649", "US Launch · DE · $649") } as Record<string, string>)[id] || id;

  const cur = questions[step];
  return (
    <section className="quiz panel" id="quiz">
      <div>
        <span className="eyebrow">ITIN / ELIGIBILITY</span>
        <h2>{t.quizTitle}</h2>
        <p className="muted">{T("2 вопроса до оплаты. Итог подтверждает специалист, а не автоматический опрос.",
                                "2 questions before payment. A specialist confirms the outcome, not an automated quiz.")}</p>
        <div className="quiz-progress">
          {questions.map((_, x) => <span key={x} className={x <= step || outcome ? "filled" : ""} />)}
        </div>
      </div>
      <div>
        {!outcome ? (
          <>
            <span className="eyebrow">0{step + 1} / 0{questions.length}</span>
            <h3>{cur.q}</h3>
            <p className="muted" style={{ fontSize: 14 }}>{cur.hint}</p>
            <div className="quiz-options">
              {cur.options.map((c, i) => (
                <label className={cur.value === String(i) ? "chosen" : ""} key={c}>
                  <input type="radio" name={"q" + step} value={i} checked={cur.value === String(i)}
                    onChange={() => cur.set(String(i))} />
                  {c}
                </label>
              ))}
            </div>
            <div className="button-row">
              {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>{t.back}</Button>}
              <Button disabled={!cur.value} onClick={next}>
                {step === questions.length - 1 || (step === 0 && ssn === "1") ? t.check : t.next}
                <ArrowRight size={17} />
              </Button>
            </div>
          </>
        ) : outcome.kind === "has_ssn" ? (
          <>
            <ShieldCheck size={34} />
            <h3>{T("ITIN вам не нужен", "You don't need an ITIN")}</h3>
            <p>{T("IRS не принимает заявление на ITIN, если у вас есть SSN или право на него. Если право есть, но номер ещё не получен, обратитесь за SSN в Social Security Administration. Компанию и EIN можно оформить с SSN, без ITIN.",
                  "The IRS does not accept an ITIN application if you have an SSN or are eligible for one. If you are eligible but have not received it yet, apply for an SSN with the Social Security Administration. You can form a company and get an EIN with an SSN, without an ITIN.")}</p>
            <div className="button-row">
              <Button variant="outline" onClick={restart}>{t.back}</Button>
              <Button asChild><Link to={`/app/start?product=${llcProduct}`}>{T("Открыть LLC + EIN", "Form an LLC + EIN")}</Link></Button>
            </div>
          </>
        ) : outcome.kind === "no_basis" ? (
          <>
            <Info size={34} />
            <h3>{T("По вашим ответам основание для ITIN не видно", "Your answers don't show a basis for an ITIN")}</h3>
            <p>{T("Это предварительный вывод. IRS выдаёт ITIN только при налоговой причине. LLC и EIN можно оформить без ITIN. Если вы не уверены, специалист проверит основание бесплатно, до оплаты.",
                  "This is a preliminary conclusion. The IRS issues an ITIN only for a tax reason. You can form an LLC and get an EIN without an ITIN. If you're unsure, a specialist will check the basis free of charge, before payment.")}</p>
            {SPECIALIST_CONSULT_ENABLED ? (
              <>
                <p className="muted">{consultNote}</p>
                <div className="button-row">
                  <Button variant="outline" onClick={restart}>{t.back}</Button>
                  <Button variant="outline" asChild><Link to={`/app/start?product=${llcProduct}`}>{T("Открыть LLC + EIN", "Form an LLC + EIN")}</Link></Button>
                  <Button asChild><Link to={consultLink()}>{T("Проверить у специалиста", "Ask a specialist to check")}<ArrowRight size={17} /></Link></Button>
                </div>
              </>
            ) : (
              <div className="button-row">
                <Button variant="outline" onClick={restart}>{t.back}</Button>
                <Button variant="outline" asChild><Link to={applyLink(fromBundle ? requested! : "itin_standard", "none")}>{T("Проверить у специалиста", "Ask a specialist to check")}</Link></Button>
                <Button asChild><Link to={`/app/start?product=${llcProduct}`}>{T("Открыть LLC + EIN", "Form an LLC + EIN")}</Link></Button>
              </div>
            )}
          </>
        ) : outcome.kind === "consult" ? (
          <>
            <Info size={34} />
            <h3>{T("Основание проверит специалист", "A specialist will check your basis")}</h3>
            <p>{T("Если вы не знаете, есть ли у вас налоговая причина для ITIN, начнём с бесплатной консультации. После интервью Taxpasso подтвердит подходящий тариф или объяснит, почему ITIN не нужен.",
                  "If you don't know whether you have a tax reason for an ITIN, we start with a free consultation. After the interview Taxpasso confirms the right plan or explains why you don't need an ITIN.")}</p>
            <p className="muted">{consultNote}</p>
            <div className="button-row">
              <Button variant="outline" onClick={restart}>{t.back}</Button>
              {fromBundle && (
                <Button variant="outline" asChild><Link to={`/app/start?product=${llcProduct}`}>{T("Открыть LLC + EIN без ITIN", "Form an LLC + EIN without an ITIN")}</Link></Button>
              )}
              <Button asChild><Link to={consultLink()}>{T("Проверить у специалиста", "Ask a specialist to check")}<ArrowRight size={17} /></Link></Button>
            </div>
          </>
        ) : (
          <>
            <ShieldCheck size={34} />
            <h3>{outcome.review ? t.quizReview : t.quizEligible}</h3>
            <p><b>{T("Подходящий пакет: ", "Suggested package: ")}</b>{productName(outcome.product)}</p>
            {outcome.note && <p className="muted">{outcome.note}</p>}
            <p className="muted">
              {outcome.product.startsWith("bundle")
                ? T("Пакет оплачивается сразу. Если специалист не подтвердит основание для ITIN, вернём $100, а LLC и EIN оформим как обычно.",
                    "The bundle is paid upfront. If a specialist does not confirm the ITIN basis, we will refund $100 and continue the LLC and EIN work.")
                : T("Оплата — после того, как специалист Taxpasso подтвердит основание. Если IRS откажет, следующая подача — бесплатно. Решение IRS мы гарантировать не можем.",
                    "Payment is due after a Taxpasso specialist confirms the basis. If the IRS rejects the application, the next submission is free. We cannot guarantee the IRS decision.")}
            </p>
            <div className="button-row">
              <Button variant="outline" onClick={restart}>{t.back}</Button>
              {outcome.alt && (
                <Button variant="outline" asChild><Link to={applyLink(outcome.alt)}>{productName(outcome.alt)}</Link></Button>
              )}
              <Button asChild><Link to={applyLink(outcome.product)}>{outcome.review ? T("Отправить на проверку основания", "Send for basis check") : t.apply}</Link></Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
export function ITIN() {
  const { t } = useI18n();
  return (
    <div className="container page">
      <div className="page-heading">
        <span className="eyebrow">
          INDIVIDUAL TAXPAYER IDENTIFICATION NUMBER
        </span>
        <h1>{t.itinTitle}</h1>
        <p>{t.itinSub}</p>
      </div>
      <ITINQuiz />
      <section className="section two-col">
        <div>
          <span className="eyebrow">CAA / IRS</span>
          <h2>{t.itinProcess}</h2>
        </div>
        <div>
          <p>{t.itinProcessText}</p>
          <a
            className="text-link"
            href="https://www.irs.gov/individuals/itin-acceptance-agent-program"
            target="_blank"
            rel="noreferrer"
          >
            IRS Acceptance Agent Program ↗
          </a>
        </div>
      </section>
      <FAQBlock />
    </div>
  );
}
export function FAQ() {
  return (
    <div className="container">
      <FAQBlock all />
      <CTA />
    </div>
  );
}
export { LegalDraft as Legal } from "./LegalDraft";
