// Тесты миграции 021: срок обслуживания, госсбор штата как строка заказа, состав суммы.
// Файл не меняет глобальное состояние (цены, каталог) — безопасен при параллельном запуске файлов.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, client, client2, adm, partner;
const err = (r) => r.error?.message ?? null;

async function makeUser(tag, role) {
  const email = `svc21+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function order(product = "llc_wy", years) {
  const a = product.startsWith("itin") ? { name: "QA", country: "AM" } : { name: "QA", country: "AM", company: "QA LLC", activity: "IT" };
  const { data, error } = await client.c.from("orders").insert({ client_id: client.id, product, status: "draft", applicant: a }).select("id").single();
  assert.equal(error, null, error?.message);
  if (years) assert.equal(err(await client.c.rpc("set_order_service_years", { p_order: data.id, p_years: years })), null);
  return data.id;
}
const due = async (o, who = adm) => (await who.c.rpc("order_payment_due", { p_order: o })).data[0];
const submit = async (o) => assert.equal(err(await client.c.rpc("submit_order", { p_order: o })), null);

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client"); client2 = await makeUser("client2");
  adm = await makeUser("admin", "admin"); partner = await makeUser("partner", "partner");
  await svc.from("partners").insert({ profile_id: partner.id, display_name: "P", qualification: "CAA/CPA" });
});

test("расчёт по срокам: пакет + продления + госсбор", { skip }, async () => {
  const wy = await order("llc_wy");
  let d = await due(wy);
  assert.deepEqual([d.base_cents, d.renewals_cents, d.state_fee_cents, d.addons_cents, d.total_cents, d.years], [34900, 0, 0, 0, 34900, 1]);
  assert.equal(err(await client.c.rpc("set_order_service_years", { p_order: wy, p_years: 2 })), null);
  d = await due(wy);
  assert.deepEqual([d.renewals_cents, d.state_fee_cents, d.total_cents], [14900, 6000, 55800], "Wyoming, 2 года = $558");
  const de = await order("llc_de", 3);
  d = await due(de, client);
  assert.deepEqual([d.base_cents, d.renewals_cents, d.state_fee_cents, d.total_cents], [44900, 39800, 80000, 164700], "Delaware, 3 года");
  assert.equal(err(await client.c.rpc("set_order_service_years", { p_order: de, p_years: 1 })), null);
  assert.equal((await due(de)).total_cents, 44900, "срок можно уменьшить до оплаты");
});

test("выбор срока: границы, продукты, чужие и партнёр", { skip }, async () => {
  const o = await order("llc_wy");
  for (const y of [0, 4, null]) assert.match(err(await client.c.rpc("set_order_service_years", { p_order: o, p_years: y })) ?? "", /Invalid service term/, `срок ${y}`);
  const itin = await order("itin_standard");
  assert.match(err(await client.c.rpc("set_order_service_years", { p_order: itin, p_years: 2 })) ?? "", /Not available for this order/);
  assert.match(err(await client2.c.rpc("set_order_service_years", { p_order: o, p_years: 2 })) ?? "", /Not permitted/);
  assert.match(err(await partner.c.rpc("set_order_service_years", { p_order: o, p_years: 2 })) ?? "", /Not permitted/);
  assert.notEqual(err(await client2.c.rpc("order_payment_due", { p_order: o })), null, "чужой клиент не видит сумму");
  assert.notEqual(err(await partner.c.rpc("order_payment_due", { p_order: o })), null, "партнёр не видит сумм");
});

test("оплата с продлением: сумма обязательна, состав фиксируется, приватность", { skip }, async () => {
  const o = await order("llc_wy", 2); await submit(o);
  assert.match(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "без суммы" })) ?? "", /Amount required/);
  assert.match(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "пакет", p_amount_cents: 34900 })) ?? "", /Amount mismatch/);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "полная", p_amount_cents: 55800 })), null);
  assert.equal((await client.c.from("orders").select("amount_cents").eq("id", o).single()).data.amount_cents, 55800);

  const lines = (await adm.c.from("order_payment_lines").select("kind,period_number,amount_cents").eq("order_id", o)).data;
  const byKind = Object.fromEntries(lines.map((l) => [l.kind, l.amount_cents]));
  assert.deepEqual([byKind.package, byKind.service_year, byKind.state_fee], [34900, 14900, 6000]);
  assert.equal(lines.reduce((s, l) => s + l.amount_cents, 0), 55800, "строки дают сумму оплаты");
  assert.equal((await client.c.from("order_payment_lines").select("id").eq("order_id", o)).data.length, 3, "клиент видит состав");
  assert.equal((await client2.c.from("order_payment_lines").select("id").eq("order_id", o)).data.length, 0);
  assert.equal((await partner.c.from("order_payment_lines").select("id").eq("order_id", o)).data.length, 0);
  assert.match(err(await client.c.rpc("set_order_service_years", { p_order: o, p_years: 3 })) ?? "", /Order already paid/);
});

test("совместимость: один год — старая форма оплаты без суммы, одна строка", { skip }, async () => {
  const o = await order("llc_de"); await submit(o);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "старая форма" })), null);
  assert.equal((await client.c.from("orders").select("amount_cents").eq("id", o).single()).data.amount_cents, 44900);
  const lines = (await adm.c.from("order_payment_lines").select("kind").eq("order_id", o)).data;
  assert.deepEqual(lines.map((l) => l.kind), ["package"]);
});

test("возврат учитывает госсбор; путь Stripe сверяет полную сумму", { skip }, async () => {
  const o = await order("llc_wy", 2); await submit(o);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x", p_amount_cents: 55800 })), null);
  const refund = (cents) => adm.c.rpc("record_refund", { p_order: o, p_amount_cents: cents, p_scope: "order", p_reason: "возврат в тесте", p_op: crypto.randomUUID() });
  assert.equal(err(await refund(55800)), null, "возвращается вся оплаченная сумма, включая госсбор");
  assert.match(err(await refund(1)) ?? "", /exceeds amount paid/);

  const s = await order("llc_wy", 2); await submit(s);
  assert.ok((await svc.rpc("mark_order_paid", { p_order: s, p_session: `sess_${run}`, p_amount_cents: 34900 })).error, "только пакет — отказ");
  assert.equal((await svc.rpc("mark_order_paid", { p_order: s, p_session: `sess_${run}`, p_amount_cents: 55800 })).error, null);
  assert.equal((await adm.c.from("order_payment_lines").select("id").eq("order_id", s)).data.length, 3);
});

test("цены продлений и срок: только админ", { skip }, async () => {
  for (const who of [client, partner]) {
    assert.match(err(await who.c.rpc("set_renewal_price", { p_state: "WY", p_renewal_cents: 1, p_state_fee_cents: 1 })) ?? "", /Admin only|Not permitted/);
  }
  assert.equal((await client.c.from("renewal_prices").select("state")).data.length, 2, "клиент видит цены");
  assert.equal((await partner.c.from("renewal_prices").select("state")).data.length, 0, "партнёр — нет");
});
