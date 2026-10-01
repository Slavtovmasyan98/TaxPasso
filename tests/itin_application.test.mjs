// Тесты миграции 024: анкета ITIN (W-7).
// Запуск: node --test tests/itin_application.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { W7, uploadPassport } from "./helpers/itin.mjs";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, adm, client, other, caa, spec, caaId, specId;
const err = (r) => r.error?.message ?? null;
const op = () => crypto.randomUUID();

async function makeUser(tag, role) {
  const email = `qa24+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function itinOrder(product = "itin_standard") {
  const o = (await client.c.from("orders").insert({ client_id: client.id, product, status: "draft",
    applicant: { name: "QA24", country: "AM" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("submit_order", { p_order: o })), null);
  return o;
}
const save = (u, o, d) => u.c.rpc("save_itin_application", { p_order: o, p_data: d });
const submit = (u, o, d) => u.c.rpc("submit_itin_application", { p_order: o, p_data: d });
const field = (r) => (r.error?.details || "").replace("field=", "");

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  adm = await makeUser("admin", "admin");
  client = await makeUser("client");
  other = await makeUser("other");
  caa = await makeUser("caa", "partner");
  spec = await makeUser("spec", "partner");
  caaId = (await svc.from("partners").insert({ profile_id: caa.id, display_name: "QA24 CAA", qualification: "CAA/CPA" }).select("id").single()).data.id;
  specId = (await svc.from("partners").insert({ profile_id: spec.id, display_name: "QA24 Spec", qualification: "SPECIALIST" }).select("id").single()).data.id;
});

test("анкету нельзя заполнять до одобрения основания и чужому клиенту", { skip }, async () => {
  const o = await itinOrder();
  assert.match(err(await save(client, o, { reason: "b" })) ?? "", /Eligibility approval required/);
  assert.equal(err(await adm.c.rpc("approve_eligibility", { p_order: o })), null);
  assert.equal(err(await save(client, o, { reason: "b" })), null);
  assert.match(err(await save(other, o, { reason: "b" })) ?? "", /Not permitted/);
  assert.equal((await other.c.from("itin_applications").select("order_id").eq("order_id", o)).data.length, 0, "чужой не читает");
  const llc = (await client.c.from("orders").insert({ client_id: client.id, product: "llc_wy", status: "draft",
    applicant: { name: "QA", country: "AM", company: "QA24 LLC", activity: "IT" } }).select("id").single()).data.id;
  assert.match(err(await save(client, llc, { reason: "b" })) ?? "", /Not an ITIN order/);
});

test("черновик по шагам, лишние поля отбрасываются, проверки полей и паспорта при отправке", { skip }, async () => {
  const o = await itinOrder();
  assert.equal(err(await adm.c.rpc("approve_eligibility", { p_order: o })), null);
  assert.equal(err(await save(client, o, { reason: "b", first_name: "Anna", hacker: "x", nested: { a: 1 } })), null);
  const row = (await client.c.from("itin_applications").select("data,status").eq("order_id", o).single()).data;
  assert.deepEqual(row, { data: { reason: "b", first_name: "Anna" }, status: "draft" });
  assert.match(err(await save(client, o, { first_name: "x".repeat(201) })) ?? "", /Field too long/);
  assert.match(err(await save(client, o, { first_name: "<b>" })) ?? "", /Invalid characters/);

  const cases = [
    [{ reason: "z" }, "reason"],
    [{ last_name: "Петросян" }, "name"],
    [{ dob: "2999-01-01" }, "dob"],
    [{ gender: "x" }, "gender"],
    [{ home_country: "US" }, "home_address"],
    [{ mail_same: "no" }, "mail_address"],
    [{ passport_expiry: "2020-01-01" }, "passport_expired"],
    [{ reason: "h" }, "exception_code"],
    [{ reason: "h", exception_code: "other" }, "exception_code"],
    [{ reason: "a" }, "treaty"],
    [{ reason: "e" }, "relationship"],
    [{ reason: "f" }, "school"],
  ];
  for (const [patch, want] of cases) {
    const r = await submit(client, o, { ...W7, ...patch });
    assert.equal(err(r), "Application incomplete", JSON.stringify(patch));
    assert.equal(field(r), want, JSON.stringify(patch));
  }
  const noFile = await submit(client, o, W7);
  assert.equal(field(noFile), "passport_file", "без загруженного паспорта нельзя");
  await uploadPassport(client, o);
  assert.equal((await submit(client, o, { ...W7, reason: "h", exception_code: "2" })).data, "ok");
  assert.equal((await submit(client, o, { ...W7, reason: "h", exception_code: "2" })).data, "already_done", "повтор того же — без ошибки");
  assert.match(err(await save(client, o, W7)) ?? "", /Application submitted/, "отправленную анкету не меняют");
  assert.equal((await client.c.from("itin_applications").select("status").eq("order_id", o).single()).data.status, "submitted");
});

test("этап после «Документы» — только с анкетой; CAA/CPA читает, специалист нет; возврат на исправление", { skip }, async () => {
  const o = await itinOrder("itin_standard");
  assert.equal(err(await adm.c.rpc("approve_eligibility", { p_order: o })), null);
  const due = (await adm.c.rpc("order_payment_due", { p_order: o })).data[0];
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "QA", p_amount_cents: due.total_cents })), null);
  assert.match(err(await adm.c.rpc("confirm_status", { p_order: o, p_stream: "main", p_to: "caa_interview", p_op: op() })) ?? "", /ITIN application required/, "админ без партнёра тоже не переводит");
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: caaId })), null);
  const prop = () => caa.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "caa_interview", p_op: op() });
  assert.match(err(await prop()) ?? "", /ITIN application required/);

  await uploadPassport(client, o);
  assert.equal((await submit(client, o, W7)).data, "ok");
  const seen = (await caa.c.from("itin_applications").select("data,status").eq("order_id", o).single()).data;
  assert.equal(seen.status, "submitted");
  assert.equal(seen.data.passport_number, W7.passport_number, "CAA/CPA видит данные W-7");
  // специалист, назначенный в обход (023), анкету не читает
  assert.equal(err(await svc.from("orders").update({ partner_id: specId }).eq("id", o)), null);
  assert.equal((await spec.c.from("itin_applications").select("order_id").eq("order_id", o)).data.length, 0, "специалист не читает W-7");
  assert.equal(err(await svc.from("orders").update({ partner_id: caaId }).eq("id", o)), null);

  // вернуть может только админ, с причиной
  assert.notEqual(err(await caa.c.rpc("return_itin_application", { p_order: o, p_note: "Уточните адрес" })), null, "партнёр не возвращает");
  assert.match(err(await adm.c.rpc("return_itin_application", { p_order: o, p_note: "" })) ?? "", /Reason required/);
  assert.equal(err(await adm.c.rpc("return_itin_application", { p_order: o, p_note: "Уточните адрес" })), null);
  const back = (await client.c.from("itin_applications").select("status,returned_note").eq("order_id", o).single()).data;
  assert.deepEqual(back, { status: "returned", returned_note: "Уточните адрес" });
  assert.match(err(await prop()) ?? "", /ITIN application required/, "возвращённая анкета снова закрывает этап");
  assert.equal(err(await save(client, o, { ...W7, home_street: "2 Abovyan St" })), null, "клиент исправляет");
  assert.equal((await submit(client, o, { ...W7, home_street: "2 Abovyan St" })).data, "ok");
  assert.equal(err(await prop()), null, "после отправки этап открывается");

  // аудит без персональных данных
  const audit = (await svc.from("audit_log").select("new_value").eq("order_id", o).eq("entity", "itin_applications")).data;
  assert.ok(audit.length >= 3);
  assert.ok(audit.every((a) => JSON.stringify(a.new_value) === JSON.stringify({ status: a.new_value.status })), "в журнале только статус");
});

test("после консультации: заказ ITIN, анкета доступна сразу после подтверждения плана", { skip }, async () => {
  const o = (await client.c.from("orders").insert({ client_id: client.id, product: "itin_consult", status: "draft",
    applicant: { name: "QA24 consult", country: "AM" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("record_consult_contact", { p_order: o, p_method: "telegram", p_value: "@qa24client", p_preferred_time: "" })), null);
  assert.equal(err(await client.c.rpc("submit_order", { p_order: o })), null);
  assert.match(err(await save(client, o, { reason: "b" })) ?? "", /Not an ITIN order/, "в консультации анкеты нет");
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specId })), null);
  assert.equal(err(await spec.c.rpc("propose_specialist_plan", { p_order: o, p_decision: "approve", p_recommended_product: "itin_return", p_reason: null, p_op: op() })), null);
  assert.equal(err(await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })), null);
  assert.equal(err(await save(client, o, { reason: "b", first_name: "Anna" })), null, "сразу после одобрения");
});
