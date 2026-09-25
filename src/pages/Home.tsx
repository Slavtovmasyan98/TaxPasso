import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ShieldCheck,
  FileCheck2,
  Globe2,
  ChevronDown,
  CornerRightUp,
} from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";
import { PricingCards } from "./Pricing";
export function Steps() {
  const { t } = useI18n();
  return (
    <section className="section" id="how">
      <div className="section-header">
        <div>
          <span className="eyebrow">{t.route}</span>
          <h2>{t.routeTitle}</h2>
        </div>
        <p>{t.routeSub}</p>
      </div>
      <div className="steps">
        {t.steps.map((s, i) => (
          <article key={s}>
            <div className="step-heading">
              <span>0{i + 1}</span>
            </div>
            <h3>{s}</h3>
            <p>{t.stepText[i]}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
export function FAQBlock({ all = false }: { all?: boolean }) {
  const { t } = useI18n();
  return (
    <section className="section faq-grid">
      <div>
        <span className="eyebrow">FAQ</span>
        <h2>{t.faq}</h2>
        <p className="muted">{t.faqSub}</p>
        {!all && (
          <Link className="text-link" to="/faq">
            {t.nav[3]} <ArrowUpRight size={18} />
          </Link>
        )}
      </div>
      <div>
        {t.faqItems.slice(0, all ? undefined : 5).map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <ChevronDown size={18} />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
export function CTA() {
  const { t } = useI18n();
  return (
    <section className="cta">
      <div>
        <span className="eyebrow">LET’S TAKE THE FIRST STEP</span>
        <h2>{t.cta}</h2>
        <p>{t.ctaSub}</p>
      </div>
      <Button asChild>
        <Link to="/app/new">
          {t.start}
          <ArrowRight size={20} />
        </Link>
      </Button>
    </section>
  );
}
export function Home() {
  const { t, lang } = useI18n();
  return (
    <>
      <div className="hero-wrap">
        <section className="container hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="tiny-line" />
              {t.heroLabel}
            </div>
            <h1>
              {t.hero.split("\n")[0]}
              <br />
              <span>{t.hero.split("\n")[1]}</span>
            </h1>
            <p className="hero-sub">{t.sub}</p>
            <div className="hero-buttons">
              <Button asChild>
                <Link to="/app/new?product=llc_wy">
                  {t.open}
                  <ArrowRight size={19} />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/itin">
                  {t.get}
                  <ArrowRight size={18} />
                </Link>
              </Button>
            </div>
            <div className="hero-proof">
              <ShieldCheck size={18} />
              <span>{t.trust[0]}</span>
              <span className="proof-divider" />
              <span>{t.trust[1]}</span>
            </div>
          </div>
          <div className="journey-visual">
            <div className="journey-top">
              <span>TAXPASSO / ROADMAP</span>
              <Globe2 size={21} />
            </div>
            <div className="journey-caption">
              {lang === "ru" ? "От вашей идеи —" : "From your idea —"}
              <br />
              {lang === "ru" ? "к бизнесу в США." : "to your US business."}
            </div>
            <div className="journey-stairs">
              <div className="journey-tile tile-1">
                <span>01 / LLC</span>
                <b>{lang === "ru" ? "Ваша компания" : "Your company"}</b>
                <small>Wyoming / Delaware</small>
              </div>
              <div className="journey-tile tile-2">
                <span>02 / EIN</span>
                <b>{lang === "ru" ? "Номер компании" : "Your business ID"}</b>
                <small>Internal Revenue Service</small>
                <ArrowUpRight />
              </div>
              <div className="journey-tile tile-3">
                <span>03 / ITIN</span>
                <b>{lang === "ru" ? "Ваш налоговый ID" : "Your tax ID"}</b>
                <small>
                  {lang === "ru"
                    ? "При наличии основания"
                    : "Subject to eligibility"}
                </small>
                <ArrowUpRight />
              </div>
            </div>
            <div className="journey-bottom">
              <span>
                <ShieldCheck size={15} />
                {lang === "ru"
                  ? "С поддержкой на каждом шаге"
                  : "Support at every step"}
              </span>
              <span>01 — 03</span>
            </div>
          </div>
        </section>
      </div>
      <div className="benefit-strip">
        <div className="container">
          <span>
            <FileCheck2 size={20} />
            {t.trust[2]}
          </span>
          <span>
            <ShieldCheck size={20} />
            {lang === "ru"
              ? "Работа с партнёрами CAA / CPA"
              : "CAA / CPA partner services"}
          </span>
          <span>
            <Globe2 size={20} />
            {lang === "ru"
              ? "Для фаундеров по всему миру"
              : "For founders around the world"}
          </span>
        </div>
      </div>
      <div className="container">
        <Steps />
        <section className="section">
          <div className="section-header">
            <div>
              <span className="eyebrow">{t.pricingLabel}</span>
              <h2>{t.pricingTitle}</h2>
            </div>
            <p>{t.pricingSub}</p>
          </div>
          <PricingCards />
          <div className="center">
            <Link className="text-link" to="/pricing">
              {t.allPlans}
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
        <section className="section">
          <div className="section-header">
            <div>
              <span className="eyebrow">{lang === "ru" ? "TAXPASSO И ДРУГИЕ" : "TAXPASSO & OTHERS"}</span>
              <h2>{t.compare}</h2>
            </div>
            <p>{t.compareSub}</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.provider}</th>
                  <th>{t.initial}</th>
                  <th>{t.renew}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="our-row">
                  <td>
                    <b>Taxpasso</b> <Check size={15} />
                  </td>
                  <td>$349 · WY / $449 · DE</td>
                  <td>
                    $149 / $199 +{" "}
                    {lang === "ru" ? "платежи штату" : "state obligations"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <a
                      href="https://www.doola.com/pricing/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Doola <ArrowUpRight size={15} />
                    </a>
                  </td>
                  <td>
                    {lang === "ru"
                      ? "По тарифу провайдера"
                      : "Provider pricing"}
                  </td>
                  <td>
                    {lang === "ru"
                      ? "Подписка; проверьте пошлины и состав"
                      : "Subscription; check state fees and scope"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <a
                      href="https://www.firstbase.io/pricing"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Firstbase <ArrowUpRight size={15} />
                    </a>
                  </td>
                  <td>
                    {lang === "ru"
                      ? "По тарифу провайдера"
                      : "Provider pricing"}
                  </td>
                  <td>
                    {lang === "ru"
                      ? "Проверьте RA и дополнительные подписки"
                      : "Check RA and additional subscriptions"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <a
                      href="https://stripe.com/atlas"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Stripe Atlas <ArrowUpRight size={15} />
                    </a>
                  </td>
                  <td>$500</td>
                  <td>
                    {lang === "ru"
                      ? "Delaware; продления и налоги отдельно"
                      : "Delaware; renewals and taxes separate"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="fineprint">{t.comparisonNote}</p>
          <p className="fineprint">{lang === "ru" ? "Данные проверены: [ДАТА]" : "Data checked: [DATE]"}</p>
        </section>
        <section className="section review-section">
          <span className="eyebrow">{lang === "ru" ? "ДАННЫЕ И БЕЗОПАСНОСТЬ" : "DATA & SECURITY"}</span>
          <h2>{lang === "ru" ? "Как мы работаем с вашими данными" : "How we work with your data"}</h2>
          <div className="steps">
            <article><h3>{lang === "ru" ? "Партнёр CAA / CPA" : "CAA / CPA partner"}</h3><p>{lang === "ru" ? "Подаёт документы в IRS в рамках согласованного заказа." : "Submits documents to the IRS within the agreed scope."}</p></article>
            <article><h3>{lang === "ru" ? "Файлы зашифрованы" : "Encrypted files"}</h3><p>{lang === "ru" ? "Документы хранятся в приватном хранилище." : "Documents are stored in private storage."}</p></article>
            <article><h3>{lang === "ru" ? "Ограниченный доступ" : "Restricted access"}</h3><p>{lang === "ru" ? "Доступ только у вас, назначенного партнёра и администратора." : "Access is limited to you, your assigned partner and an administrator."}</p></article>
          </div>
        </section>
        <section className="section"><div className="section-header"><div><span className="eyebrow">{lang === "ru" ? "СРОКИ" : "TIMELINES"}</span><h2>{lang === "ru" ? "Ориентиры по срокам" : "Estimated timelines"}</h2></div></div><div className="steps"><article><h3>LLC</h3><p>[СРОК / ESTIMATE]</p></article><article><h3>EIN</h3><p>{t.einTiming}</p></article><article><h3>ITIN</h3><p>{lang === "ru" ? "После проверки CAA; срок определяет IRS." : "After CAA review; timing is controlled by the IRS."}</p></article></div></section>
        <FAQBlock />
        <CTA />
      </div>
    </>
  );
}
