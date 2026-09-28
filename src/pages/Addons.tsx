import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "../i18n";
import { supabase, type Order } from "../lib/supabase";
import { ADDONS_ENABLED } from "../lib/config";
import { Button } from "../components/ui/button";

// Доп. услуги к LLC и пакетам (docs/ADDONS_RULES.md, миграция 018).
// Запрос ≠ выдача: request_addon ставит pending_payment, активирует услугу только оплата.
// Что предлагать, решает сервер (available_addons): выключенные услуги (active=false) клиент не видит,
// поэтому пока админ не подтвердил цену и не включил услугу, блок не отображается вовсе.

type Available = { code: string; name: string; description: string | null; billing_type: "one_time" | "yearly"; price_cents: number };
type Requested = {
  id: string;
  status: "pending_payment" | "active" | "cancelled" | "expired";
  price_cents_at_purchase: number;
  period_end: string | null;
  addon: { code: string; name: string; billing_type: "one_time" | "yearly" } | null;
};

const ADDON_PRODUCTS = ["llc_wy", "llc_de", "bundle_wy", "bundle_de"];

function addonError(message: string | undefined, ru: boolean) {
  const map: Record<string, [string, string]> = {
    "Addon not available": ["Эта услуга сейчас недоступна.", "This service is not available right now."],
    "Addon not available for this order": ["Эта услуга не подходит к вашему заказу.", "This service does not apply to your order."],
    "Addon locked: milestone already reached": ["Поздно: документы уже поданы в штат.", "Too late: the documents have already been filed with the state."],
    "Addon only available during checkout": ["Эту услугу можно добавить только до оплаты заказа.", "This service can only be added before the order is paid."],
    "Addon only available after checkout": ["Эту услугу можно добавить после оплаты заказа.", "This service can be added after the order is paid."],
    "Order cancelled": ["Заказ отменён.", "The order is cancelled."],
    "Only unpaid requests can be cancelled": ["Оплаченную услугу можно отменить только через поддержку.", "A paid service can only be cancelled via support."],
  };
  const hit = message && map[message];
  if (hit) return ru ? hit[0] : hit[1];
  return ru ? "Не удалось выполнить действие. Попробуйте ещё раз." : "Something went wrong. Please try again.";
}

export function OrderAddons({ order }: { order: Order }) {
  const { lang } = useI18n();
  const ru = lang !== "en";
  const T = (r: string, e: string) => (ru ? r : e);
  const eligible = ADDONS_ENABLED && !!supabase && ADDON_PRODUCTS.includes(order.product) && !order.cancelled_at;
  const [available, setAvailable] = useState<Available[]>([]);
  const [requested, setRequested] = useState<Requested[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  // Один ключ идемпотентности на операцию: повтор после сетевой ошибки не создаст второй запрос.
  const ops = useRef<Record<string, string>>({});

  function load() {
    if (!eligible) return;
    Promise.all([
      supabase!.rpc("available_addons", { p_order: order.id }),
      supabase!.from("order_addons")
        .select("id,status,price_cents_at_purchase,period_end,addon:addons(code,name,billing_type)")
        .eq("order_id", order.id).neq("status", "cancelled").order("requested_at"),
    ]).then(([a, r]) => {
      // Если база окружения ещё без 018, обе выборки вернут ошибку — блок просто не показывается.
      setAvailable(a.error ? [] : ((a.data as Available[]) || []));
      setRequested(r.error ? [] : ((r.data as unknown as Requested[]) || []));
    });
  }
  useEffect(load, [order.id, order.payment_status, eligible]);

  if (!eligible || (!available.length && !requested.length)) return null;

  const money = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
  const period = (b: string) => (b === "yearly" ? T(" / год", " / year") : "");
  const paid = order.payment_status === "paid";

  async function request(code: string) {
    setMsg("");
    setBusy(code);
    ops.current[code] ||= crypto.randomUUID();
    const { data, error } = await supabase!.rpc("request_addon", { p_order: order.id, p_addon_code: code, p_op: ops.current[code] });
    setBusy("");
    if (error) { setMsg(addonError(error.message, ru)); load(); return; }
    delete ops.current[code];
    setMsg(data === "already_requested" ? T("Эта услуга уже запрошена.", "This service is already requested.") : T("Услуга добавлена в заказ.", "Service added to your order."));
    load();
  }
  async function cancel(id: string) {
    setMsg("");
    setBusy(id);
    const { error } = await supabase!.rpc("cancel_addon_request", { p_order_addon: id });
    setBusy("");
    setMsg(error ? addonError(error.message, ru) : T("Запрос отменён.", "Request cancelled."));
    load();
  }

  const statusText = (s: Requested["status"]) =>
    ({
      pending_payment: paid
        ? T("Ожидает оплаты — Taxpasso свяжется с вами", "Awaiting payment — Taxpasso will contact you")
        : T("Будет оплачена вместе с заказом", "Paid together with the order"),
      active: T("Подключена", "Active"),
      cancelled: T("Отменена", "Cancelled"),
      expired: T("Срок истёк", "Expired"),
    })[s];

  return (
    <section className="panel order-addons" aria-labelledby={"addons-" + order.id}>
      <span className="eyebrow">{T("ДОПОЛНИТЕЛЬНО", "ADD-ONS")}</span>
      <h3 id={"addons-" + order.id}>{T("Дополнительные услуги", "Additional services")}</h3>
      {requested.length > 0 && (
        <ul className="addon-list">
          {requested.map((r) => (
            <li key={r.id}>
              <div>
                <b>{r.addon?.name || "—"}</b>
                <small className="muted">
                  {money(r.price_cents_at_purchase)}{period(r.addon?.billing_type || "")} · {statusText(r.status)}
                  {r.status === "active" && r.period_end ? " · " + T("до ", "until ") + new Date(r.period_end + "T12:00:00").toLocaleDateString(ru ? "ru-RU" : "en-US") : ""}
                </small>
              </div>
              {r.status === "pending_payment" && (
                <Button variant="ghost" disabled={!!busy} aria-busy={busy === r.id} onClick={() => cancel(r.id)}
                  aria-label={T("Отменить запрос: ", "Cancel request: ") + (r.addon?.name || "")}>
                  <X size={16} />{T("Отменить", "Cancel")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <ul className="addon-list">
          {available.map((a) => (
            <li key={a.code}>
              <div>
                <b>{a.name}</b>
                {a.description && <small className="muted">{a.description}</small>}
                <small className="muted">{money(a.price_cents)}{period(a.billing_type)}</small>
              </div>
              <Button variant="outline" disabled={!!busy} aria-busy={busy === a.code} onClick={() => request(a.code)}>
                <Plus size={16} />{busy === a.code ? T("Добавляем…", "Adding…") : T("Добавить", "Add")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="fineprint">{T("Услуга включается только после оплаты. Цену фиксируем в момент запроса.",
                                  "A service starts only after payment. The price is fixed at the time of the request.")}</p>
      <p role="status" className="muted">{msg}</p>
    </section>
  );
}
