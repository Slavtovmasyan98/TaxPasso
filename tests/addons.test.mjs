// Тесты миграции 018: доп. услуги (addons / addon_products / order_addons).
// Тесты меняют каталог (цены, active) — состояние ВОССТАНАВЛИВАЕТСЯ в after(), повторный запуск чист.
// Запуск: node --test tests/addons.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
const CODES = ["BUSINESS_ADDRESS", "FORM_5472_1120", "DE_EXPEDITED"];
let svc, client, other, adm, original;
const op = () => crypto.randomUUID();
const err = (r) => r.error?.message ?? null;

async function makeUser(tag, role) {
  const email = `qa18+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function newOrder(product) {
  const applicant = product.startsWith("itin")
    ? { name: "QA", country: "AM" }
    : { name: "QA", country: "AM", company: "QA LLC", activity: "IT" };
  const { data, error } = await client.c.from("orders").insert({ client_id: client.id, product, status: "draft", applicant }).select("id").single();
  assert.equal(error, null, error?.message);
  return data.id;
}
async function activateAll() {
  for (const code of CODES) {
    const price = original.find((a) => a.code === code).price_cents;
    assert.equal(err(await adm.c.rpc("set_addon_price", { p_code: code, p_price_cents: price })), null);
    assert.equal(err(await adm.c.rpc("set_addon_active", { p_code: code, p_active: true })), null);
  }
}
const available = async (o) => (await client.c.rpc("available_addons", { p_order: o })).data.map((a) => a.code).sort();

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  original = (await svc.from("addons").select("code,price_cents,price_confirmed,active").in("code", CODES)).data;
  assert.equal(original.length, 3, "каталог должен содержать 3 услуги (миграция 018)");
  // Чистое стартовое состояние независимо от прошлых запусков
  for (const a of original) await svc.from("addons").update({ active: false }).eq("code", a.code);
  client = await makeUser("client"); other = await makeUser("other"); adm = await makeUser("admin", "admin");
});

after(async () => {
  if (skip || !original) return;
  for (const a of original) {
    await svc.from("addons").update({ active: false }).eq("code", a.code);
    await svc.from("addons").update({ price_cents: a.price_cents, price_confirmed: a.price_confirmed, active: a.active }).eq("code", a.code);
  }
});

test("услугу с неподтверждённой ценой включить нельзя; клиент не видит выключенные", { skip }, async () => {
  for (const a of original) await svc.from("addons").update({ active: false, price_confirmed: false }).eq("code", a.code);
  assert.match(err(await adm.c.rpc("set_addon_active", { p_code: "BUSINESS_ADDRESS", p_active: true })) ?? "", /Price not confirmed/);
  assert.equal((await client.c.from("addons").select("code")).data.length, 0);
  assert.equal((await adm.c.from("addons").select("code")).data.length, 3);
  const direct = await svc.from("addons").update({ active: true }).eq("code", "BUSINESS_ADDRESS");
  assert.notEqual(direct.error, null, "CHECK-ограничение не даёт включить даже напрямую");
});

test("применимость по продуктам: ITIN никогда не получает add-ons", { skip }, async () => {
  await activateAll();
  const oWy = await newOrder("llc_wy"), oDe = await newOrder("llc_de"), oItin = await newOrder("itin_standard");
  assert.deepEqual(await available(oWy), ["BUSINESS_ADDRESS", "FORM_5472_1120"]);
  assert.deepEqual(await available(oDe), ["BUSINESS_ADDRESS", "DE_EXPEDITED", "FORM_5472_1120"]);
  assert.deepEqual(await available(oItin), []);
  assert.match(err(await client.c.rpc("request_addon", { p_order: oItin, p_addon_code: "BUSINESS_ADDRESS", p_op: op() })) ?? "", /not available for this order/);
  assert.match(err(await client.c.rpc("request_addon", { p_order: oWy, p_addon_code: "DE_EXPEDITED", p_op: op() })) ?? "", /not available for this order/);
});

test("запрос ≠ выдача: pending → active только после оплаты", { skip }, async () => {
  await activateAll();
  const o = await newOrder("llc_wy");
  const k = op();
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "BUSINESS_ADDRESS", p_op: k })).data, "ok");
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "BUSINESS_ADDRESS", p_op: k })).data, "already_done");
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "BUSINESS_ADDRESS", p_op: op() })).data, "already_requested");
  const row = () => client.c.from("order_addons").select("id,status,period_end").eq("order_id", o).single().then((r) => r.data);
  assert.equal((await row()).status, "pending_payment", "услуга не выдана до оплаты");
  assert.notEqual(err(await client.c.rpc("mark_addon_paid", { p_order_addon: (await row()).id, p_note: "я заплатил", p_op: op() })), null, "клиент сам не подтверждает оплату");

  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "перевод получен" })), null);
  const paid = await row();
  assert.equal(paid.status, "active", "оплата заказа активирует запрошенные при оформлении услуги");
  assert.ok(paid.period_end, "у годовой услуги есть конец периода");
});

test("отмена неоплаченного запроса, повторный запрос, оплаченную отменить нельзя", { skip }, async () => {
  await activateAll();
  const o = await newOrder("llc_wy");
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "FORM_5472_1120", p_op: op() })).data, "ok");
  const id = (await client.c.from("order_addons").select("id").eq("order_id", o).single()).data.id;
  assert.equal(err(await client.c.rpc("cancel_addon_request", { p_order_addon: id })), null);
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "FORM_5472_1120", p_op: op() })).data, "ok");
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x" })), null);
  assert.match(err(await client.c.rpc("cancel_addon_request", { p_order_addon: id })) ?? "", /Only unpaid/);
});

test("докупка после оплаты заказа — отдельная оплата услуги (идемпотентно)", { skip }, async () => {
  await activateAll();
  const o = await newOrder("llc_wy");
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x" })), null);
  assert.equal((await client.c.rpc("request_addon", { p_order: o, p_addon_code: "FORM_5472_1120", p_op: op() })).data, "ok");
  const id = (await client.c.from("order_addons").select("id,status").eq("order_id", o).single()).data;
  assert.equal(id.status, "pending_payment");
  const k = op();
  assert.equal((await adm.c.rpc("mark_addon_paid", { p_order_addon: id.id, p_note: "оплата 5472", p_op: k })).data, "ok");
  assert.equal((await adm.c.rpc("mark_addon_paid", { p_order_addon: id.id, p_note: "оплата 5472", p_op: k })).data, "already_done");
  assert.equal((await client.c.from("order_addons").select("status").eq("id", id.id).single()).data.status, "active");
});

test("снимок цены и продления: цена не меняется задним числом, схема допускает 2-й период", { skip }, async () => {
  await activateAll();
  const o = await newOrder("llc_wy");
  await client.c.rpc("request_addon", { p_order: o, p_addon_code: "BUSINESS_ADDRESS", p_op: op() });
  const before = (await client.c.from("order_addons").select("price_cents_at_purchase").eq("order_id", o).single()).data.price_cents_at_purchase;
  assert.equal(err(await adm.c.rpc("set_addon_price", { p_code: "BUSINESS_ADDRESS", p_price_cents: 99900 })), null);
  assert.equal((await client.c.from("order_addons").select("price_cents_at_purchase").eq("order_id", o).single()).data.price_cents_at_purchase, before);

  const addonId = (await svc.from("addons").select("id").eq("code", "BUSINESS_ADDRESS").single()).data.id;
  assert.equal((await svc.from("order_addons").insert({ order_id: o, addon_id: addonId, period_number: 2, price_cents_at_purchase: 99900 })).error, null);
  assert.notEqual((await svc.from("order_addons").insert({ order_id: o, addon_id: addonId, period_number: 2, price_cents_at_purchase: 99900 })).error, null);
});

test("DE expedited блокируется после подачи в штат; чужой клиент и права", { skip }, async () => {
  await activateAll();
  const oDe = await newOrder("llc_de");
  assert.equal((await client.c.rpc("request_addon", { p_order: oDe, p_addon_code: "DE_EXPEDITED", p_op: op() })).data, "ok");
  const oLocked = await newOrder("llc_de");
  await svc.from("order_milestones").insert({ order_id: oLocked, milestone: "state_filed" });
  assert.ok(!(await available(oLocked)).includes("DE_EXPEDITED"));
  assert.match(err(await client.c.rpc("request_addon", { p_order: oLocked, p_addon_code: "DE_EXPEDITED", p_op: op() })) ?? "", /milestone already reached/);

  assert.equal((await other.c.from("order_addons").select("id").eq("order_id", oDe)).data.length, 0);
  assert.notEqual(err(await other.c.rpc("request_addon", { p_order: oDe, p_addon_code: "BUSINESS_ADDRESS", p_op: op() })), null);
  assert.notEqual(err(await client.c.rpc("set_addon_price", { p_code: "BUSINESS_ADDRESS", p_price_cents: 1 })), null);
  assert.notEqual(err(await client.c.rpc("set_addon_active", { p_code: "BUSINESS_ADDRESS", p_active: false })), null);
});
