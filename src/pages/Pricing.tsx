import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ArrowUpRight, Plus, ArrowRight, Info } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "../components/ui/button";
export const products = [
  {
    id: "llc_wy",
    name: "LLC Wyoming + EIN",
    price: 349,
    renew: 149,
    state: 60,
  },
  {
    id: "llc_de",
    name: "LLC Delaware + EIN",
    price: 449,
    renew: 199,
    state: 400,
  },
  {
    id: "itin_standard",
    name: "ITIN Standard",
    price: 259,
    renew: 0,
    state: 0,
  },
  { id: "itin_return", name: "ITIN + 1040-NR", price: 400, renew: 0, state: 0 },
  {
    id: "bundle_wy",
    name: "Bundle Wyoming",
    price: 549,
    renew: 149,
    state: 60,
  },
  {
    id: "bundle_de",
    name: "Bundle Delaware",
    price: 649,
    renew: 199,
    state: 400,
  },
];
export function PricingCards({ full = false }: { full?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <div className={"pricing-grid " + (full ? "full" : "")}>
      {products.slice(0, full ? 6 : 3).map((p, i) => (
        <article
          className={"price-card " + (i === 0 ? "featured" : "")}
          key={p.id}
        >
          {(i === 0 || i === 3) && (
            <span className="badge">{i === 0 ? t.recommended : t.popular}</span>
          )}
          <div className="price-top">
            <span className="card-number">0{i + 1}</span>
            <ArrowUpRight size={22} />
          </div>
          <h3>{i > 3 ? t.bundle + " · " + (i === 4 ? "WY" : "DE") : p.name}</h3>
          <p className="price-desc">
            {
              [
                t.wyDesc,
                t.deDesc,
                t.itinDesc,
                t.itinFullDesc,
                t.bundleDesc,
                t.bundleDesc,
              ][i]
            }
          </p>
          <div className="price">
            ${p.price}
            <span>USD</span>
          </div>
          <div className="price-context">
            {p.renew
              ? `${t.renewal} $${p.renew}/${t.year}`
              : lang === "ru"
                ? "Разовая услуга"
                : "One-time service"}
          </div>
          <Button variant={i === 0 ? "default" : "outline"} asChild>
            <Link
              to={
                p.id.includes("itin") || p.id.includes("bundle")
                  ? "/itin?product=" + p.id + "#quiz"
                  : "/app/new?product=" + p.id
              }
            >
              {t.choose}
              <ArrowRight size={16} />
            </Link>
          </Button>
          {(p.id==="itin_standard"||p.id==="itin_return")&&<p className="fineprint">{lang==="ru"?"При отказе IRS — повторная подача бесплатно":"If the IRS rejects the application, the next submission is free"}</p>}
          <div className="price-divider" />
          <span className="eyebrow small">{t.included}</span>
          <ul className="check-list">
            {(i < 2
              ? t.llcItems
              : i < 4
                ? [...t.itinItems, ...(i === 3 ? ["1040-NR"] : [])]
                : [
                    ...t.llcItems,
                    "ITIN Standard",
                    lang === "ru"
                      ? "Консультация 30 минут"
                      : "30-minute consultation",
                  ]
            ).map((x) => (
              <li key={x}>
                <Check size={15} />
                {x}
              </li>
            ))}
          </ul>
          <p className="price-extra">
            <b>{t.separate}: </b>
            {p.state
              ? `${lang === "ru" ? "ежегодный платёж штату" : "annual state obligation"} ${p.state === 60 ? t.from + " " : ""}$${p.state}; ${lang === "ru" ? "налоговая отчётность" : "tax filings"}`
              : lang === "ru"
                ? "доставка оригиналов, при необходимости"
                : "original document shipping, if needed"}
          </p>
        </article>
      ))}
    </div>
  );
}
export function Calculator() {
  const { t, lang } = useI18n();
  const [id, setId] = useState("llc_wy");
  const [years, setYears] = useState(2);
  const [tax, setTax] = useState(false);
  const [mail, setMail] = useState(false);
  const p = products.find((p) => p.id === id)!;
  // Платёж штату впервые наступает на второй год: пошлина за регистрацию уже в цене пакета,
  // годовой отчёт WY — в месяц регистрации следующего года, налог DE — до 1 июня следующего года.
  const state = p.state * (years - 1);
  const renewal = p.renew * (years - 1);
  const extras = (tax ? 349 * years : 0) + (mail ? 99 * years : 0);
  return (
    <section className="calculator" id="calculator">
      <div className="calc-left">
        <span className="eyebrow">{t.pricingLabel}</span>
        <h2>{t.calc}</h2>
        <p className="muted">{t.calcSub}</p>
        <label>
          {lang === "ru" ? "Пакет" : "Package"}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {products
              .filter((p) => p.state)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>{t.horizon}</label>
        <div className="segmented">
          {[1, 2, 3].map((n, i) => (
            <button
              aria-pressed={years === n}
              className={years === n ? "selected" : ""}
              onClick={() => setYears(n)}
              key={n}
            >
              {t.years[i]}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={tax}
            onChange={(e) => setTax(e.target.checked)}
          />
          Form 5472 + 1120 · $349/{t.year}{" "}
          <span className="muted">
            ({lang === "ru" ? "для LLC с одним владельцем" : "single-member LLC"})
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={mail}
            onChange={(e) => setMail(e.target.checked)}
          />
          {t.addNames[1]} · {t.from} $99/{t.year}
        </label>
      </div>
      <div className="calc-result">
        <span className="eyebrow">
          {t.total} · {t.years[years - 1]}
        </span>
        <div className="calc-total">
          ${p.price + renewal + state + extras}
          <small>USD</small>
        </div>
        {[
          [t.formation, p.price],
          [t.serviceRenew, renewal],
          [t.stateTax, state],
          [t.addons, extras],
        ].map(([k, v]) => (
          <div className="cost-row" key={k}>
            <span>{k}</span>
            <strong>${v}</strong>
          </div>
        ))}
        <p className="fineprint">
          <Info size={15} />
          {t.calcNote}
        </p>
      </div>
    </section>
  );
}
export function Pricing() {
  const { t } = useI18n();
  return (
    <div className="container page">
      <div className="page-heading">
        <span className="eyebrow">{t.pricingLabel}</span>
        <h1>{t.pricingTitle}</h1>
        <p>{t.pricingSub}</p>
      </div>
      <PricingCards full />
      <section className="section">
        <h2>{t.addons}</h2>
        <div className="addons">
          {t.addNames.map((n, i) => (
            <div key={n}>
              <Plus size={20} />
              <span>{n}</span>
              <b>{["$349/" + t.year, t.from + " $99/" + t.year, "+$75"][i]}</b>
            </div>
          ))}
        </div>
      </section>
      <Calculator />
    </div>
  );
}
