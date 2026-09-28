// Тесты миграций 016–017: консультация специалиста (опросник: "Не знаю" / "Нет основания").
// Запуск: node --test tests/specialist_consult.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, client, adm, specialist, caaOnly, dual, specialistId, caaOnlyId, dualId;
const op = () => crypto.randomUUID();
const err = (r) => r.error?.message ?? null;

async function makeUser(tag, role) {
  const email = `qa17+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function makePartner(u, qualification) {
  const { data, error } = await svc.from("partners").insert({ profile_id: u.id, display_name: qualification, qualification }).select("id").single();
  if (error) throw error;
  return data.id;
}
async function newConsultOrder() {
  const { data, error } = await client.c.from("orders").insert({
    client_id: client.id, product: "itin_consult", status: "draft",
    applicant: { name: "QA", country: "AM" },
  }).select("id").single();
  assert.equal(error, null, error?.message);
  assert.equal((await client.c.rpc("record_consult_contact", {
    p_order: data.id, p_method: "telegram", p_value: "@qa_client", p_preferred_time: "завтра после 18:00",
  })).error, null);
  assert.equal(await err(await client.c.rpc("submit_order", { p_order: data.id })), null);
  return data.id;
}

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client");
  adm = await makeUser("admin", "admin");
  specialist = await makeUser("specialist", "partner");
  caaOnly = await makeUser("caa", "partner");
  dual = await makeUser("dual", "partner");
  specialistId = await makePartner(specialist, "SPECIALIST");
  caaOnlyId = await makePartner(caaOnly, "CAA");
  dualId = await makePartner(dual, "CAA/CPA");
});

test("контакт и старт консультации", { skip }, async () => {
  const o = await newConsultOrder();
  const row = (await adm.c.from("orders").select("status,applicant").eq("id", o).single()).data;
  assert.equal(row.status, "consult_interview");
  assert.equal(row.applicant.contact_method, "telegram");
  assert.equal(row.applicant.preferred_time, "завтра после 18:00");
});

test("назначить можно только Specialist, пока продукт itin_consult", { skip }, async () => {
  const o = await newConsultOrder();
  assert.match(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: caaOnlyId })) ?? "", /Specialist/);
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
});

test("оплата заблокирована на всех шагах, кроме как после подтверждения админом", { skip }, async () => {
  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
  assert.match(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x" })) ?? "", /Eligibility approval required/);

  assert.equal(err(await specialist.c.rpc("propose_specialist_plan", {
    p_order: o, p_decision: "approve", p_recommended_product: "itin_standard", p_reason: null, p_op: op(),
  })), null);
  assert.match(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x" })) ?? "", /Eligibility approval required/);
  assert.equal((await client.c.from("orders").select("product,eligibility").eq("id", o).single()).data.product, "itin_consult");

  assert.equal((await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })).data, "ok");
  const row = (await client.c.from("orders").select("product,status,eligibility").eq("id", o).single()).data;
  assert.deepEqual([row.product, row.status, row.eligibility], ["itin_standard", "documents", "approved"]);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x" })), null);
});

test("отказ специалиста закрывает заказ клиенту, причина видна", { skip }, async () => {
  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
  assert.match(err(await specialist.c.rpc("propose_specialist_plan", {
    p_order: o, p_decision: "reject", p_recommended_product: null, p_reason: "", p_op: op(),
  })) ?? "", /Reason required/);
  assert.equal(err(await specialist.c.rpc("propose_specialist_plan", {
    p_order: o, p_decision: "reject", p_recommended_product: null, p_reason: "Нет ни SSN, ни налоговой причины", p_op: op(),
  })), null);
  assert.equal((await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })).data, "ok");
  const row = (await client.c.from("orders").select("eligibility,eligibility_note,closed_at").eq("id", o).single()).data;
  assert.equal(row.eligibility, "rejected");
  assert.equal(row.eligibility_note, "Нет ни SSN, ни налоговой причины");
  assert.ok(row.closed_at);
});

test("админ может переопределить специалиста своим отказом", { skip }, async () => {
  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
  assert.equal(err(await specialist.c.rpc("propose_specialist_plan", {
    p_order: o, p_decision: "approve", p_recommended_product: "itin_standard", p_reason: null, p_op: op(),
  })), null);
  assert.equal((await adm.c.rpc("reject_specialist_plan", { p_order: o, p_reason: "Админ считает основание недостаточным", p_op: op() })).data, "ok");
  const row = (await client.c.from("orders").select("eligibility,closed_at").eq("id", o).single()).data;
  assert.equal(row.eligibility, "rejected");
  assert.ok(row.closed_at);
});

test("после одобрения: специалист виден до переназначения, теряет доступ после CAA/CPA", { skip }, async () => {
  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
  assert.equal(err(await specialist.c.rpc("propose_specialist_plan", {
    p_order: o, p_decision: "approve", p_recommended_product: "itin_return", p_reason: null, p_op: op(),
  })), null);
  assert.equal((await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })).data, "ok");

  assert.ok((await specialist.c.rpc("partner_orders")).data.find((r) => r.id === o), "специалист ещё видит заказ");
  assert.match(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: caaOnlyId })) ?? "", /CAA\/CPA/, "itin_return требует именно CAA/CPA");
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: dualId })), null);

  assert.ok(!(await specialist.c.rpc("partner_orders")).data.find((r) => r.id === o), "специалист теряет доступ после переназначения");
  assert.ok((await dual.c.rpc("partner_orders")).data.find((r) => r.id === o), "новый CAA/CPA видит заказ");
});

test("партнёр не видит денег даже в консультационном заказе", { skip }, async () => {
  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specialistId })), null);
  assert.equal((await specialist.c.from("orders").select("id").eq("id", o)).data.length, 0, "нет прямого доступа к orders");
  const row = (await specialist.c.rpc("partner_orders")).data.find((r) => r.id === o);
  for (const key of ["payment_status", "payment_note", "amount_cents"]) assert.ok(!(key in row), key);
});

test("consult RPC не меняют обычные и закрытые заказы", { skip }, async () => {
  const { data: llc, error } = await client.c.from("orders").insert({
    client_id: client.id, product: "llc_wy", status: "draft",
    applicant: { name: "QA", country: "AM", company: "QA LLC", activity: "Tests" },
  }).select("id").single();
  assert.equal(error, null, error?.message);
  assert.match(err(await adm.c.rpc("reject_specialist_plan", {
    p_order: llc.id, p_reason: "Не консультация", p_op: op(),
  })) ?? "", /Not a consult order/);
  assert.match(err(await client.c.rpc("record_consult_contact", {
    p_order: llc.id, p_method: "telegram", p_value: "@qa", p_preferred_time: "18:00",
  })) ?? "", /Not a consult order/);

  const o = await newConsultOrder();
  assert.equal(err(await adm.c.rpc("reject_specialist_plan", {
    p_order: o, p_reason: "Основание не подтверждено", p_op: op(),
  })), null);
  assert.match(err(await client.c.rpc("record_consult_contact", {
    p_order: o, p_method: "telegram", p_value: "@changed", p_preferred_time: "19:00",
  })) ?? "", /Order closed/);
  assert.match(err(await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })) ?? "", /Order closed/);
});
