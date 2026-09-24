import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, ShieldCheck, Info } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";
import { Steps, FAQBlock, CTA } from "./Home";
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
            <Link to="/app/new?product=llc_wy">
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
            <Link to="/app/new?product=llc_de">
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
export function ITINQuiz() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const requested = params.get("product");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(["", "", "", ""]);
  const [result, setResult] = useState(false);
  const choices = [
    [t.no, t.yes, t.unsure],
    t.basisOptions,
    [t.yes, t.no, t.unsure],
    t.countries,
  ];
  const eligible = answers[0] === "0" && ["0", "1", "2"].includes(answers[1]);
  return (
    <section className="quiz panel" id="quiz">
      <div>
        <span className="eyebrow">ITIN / ELIGIBILITY</span>
        <h2>{t.quizTitle}</h2>
        <p className="muted">{t.quizSub}</p>
        <div className="quiz-progress">
          {[0, 1, 2, 3].map((x) => (
            <span key={x} className={x <= step ? "filled" : ""} />
          ))}
        </div>
      </div>
      <div>
        {!result ? (
          <>
            <span className="eyebrow">0{step + 1} / 04</span>
            <h3>{t.quizQuestions[step]}</h3>
            <div className="quiz-options">
              {choices[step].map((c, i) => (
                <label
                  className={answers[step] === String(i) ? "chosen" : ""}
                  key={c}
                >
                  <input
                    type="radio"
                    name={"q" + step}
                    value={i}
                    checked={answers[step] === String(i)}
                    onChange={() =>
                      setAnswers((a) =>
                        a.map((v, n) => (n === step ? String(i) : v)),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
            <div className="button-row">
              {step > 0 && (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  {t.back}
                </Button>
              )}
              <Button
                disabled={!answers[step]}
                onClick={() =>
                  step === 3 ? setResult(true) : setStep(step + 1)
                }
              >
                {step === 3 ? t.check : t.next}
                <ArrowRight size={17} />
              </Button>
            </div>
          </>
        ) : (
          <>
            <ShieldCheck size={34} />
            <h3>
              {answers[0] === "1"
                ? t.quizBlocked
                : eligible
                  ? t.quizEligible
                  : t.quizReview}
            </h3>
            <p>{t.quizResult}</p>
            <p className="muted">{t.multiNote}</p>
            <div className="button-row">
              <Button
                variant="outline"
                onClick={() => {
                  setResult(false);
                  setStep(0);
                }}
              >
                {t.back}
              </Button>
              {answers[0] !== "1" && (
                <Button asChild>
                  <Link
                    to={
                      "/app/new?product=" +
                      (["bundle_wy", "bundle_de"].includes(requested || "")
                        ? requested
                        : answers[1] === "2"
                          ? "itin_return"
                          : "itin_standard")
                    }
                  >
                    {t.apply}
                  </Link>
                </Button>
              )}
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
export function Legal({ kind }: { kind: "terms" | "privacy" | "refund" }) {
  const { t } = useI18n();
  const index = { terms: 0, privacy: 1, refund: 2 }[kind];
  return (
    <div className="container page legal-page">
      <span className="eyebrow">TAXPASSO / LEGAL</span>
      <h1>{t.legal[index]}</h1>
      <p className="notice">
        <Info />
        {t.legalDraft}
      </p>
      <p>{[t.termsBody, t.privacyBody, t.refundBody][index]}</p>
      <p className="muted">{t.footer}</p>
    </div>
  );
}
