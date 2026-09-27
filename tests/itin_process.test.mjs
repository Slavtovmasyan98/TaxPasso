// Тесты миграций 013–014: партнёр не видит денег, решение по ITIN через админа,
// правила оплаты, «ITIN + подготовка декларации», отказ IRS с бесплатной повторной подачей, номер ITIN.
// Запуск: node --test tests/itin_process.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");

const PASS = "Test-Passw0rd!";
const run = Date.now();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
let svc, client, adm, caa, cpaOnly, both, caaId, cpaOnlyId, bothId;

const op = () => crypto.randomUUID();
const err = (r) => r.error?.message ?? null;
const rpc = async (u, fn, args) => (await u.c.rpc(fn, args)).error?.message ?? null;

async function makeUser(tag, role) {
  const email = `qa14+${tag}-${run}@taxpasso.test`;
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
async function newOrder(product) {
  const { data, error } = await client.c.from("orders").insert({
    client_id: client.id, product, status: "draft",
    applicant: { name: "QA", country: "AM", company: "QA LLC", activity: "IT" },
  }).select("id").single();
  assert.equal(error, null, error?.message);
  assert.equal(await rpc(client, "record_consent", { p_order: data.id, p_terms_version: "qa", p_refund_version: "qa" }), null);
  assert.equal(await rpc(client, "submit_order", { p_order: data.id }), null);
  return data.id;
}
const propose = (u, o, to, stream = "main") => u.c.rpc("propose_status", { p_order: o, p_stream: stream, p_to: to, p_op: op() });
const confirm = (u, o, to, stream = "main") => u.c.rpc("confirm_status", { p_order: o, p_stream: stream, p_to: to, p_op: op() });
async function step(o, to, stream = "main", partner = both) {
  assert.equal(err(await propose(partner, o, to, stream)), null, `partner → ${to}`);
  assert.equal(err(await confirm(adm, o, to, stream)), null, `admin → ${to}`);
}
async function upload(partnerUser, partnerId, o, type) {
  const path = `${o}/${run}-${type}-${crypto.randomUUID()}.pdf`;
  const up = await partnerUser.c.storage.from("documents").upload(path, new Blob(["%PDF qa"], { type: "application/pdf" }), { contentType: "application/pdf" });
  assert.equal(up.error, null, up.error?.message);
  const { data, error } = await partnerUser.c.from("partner_documents").insert({
    order_id: o, partner_id: partnerId, uploaded_by: partnerUser.id, path, name: `${type}.pdf`,
    mime_type: "application/pdf", size_bytes: 7, doc_type: type,
  }).select("id").single();
  assert.equal(error, null, error?.message);
  assert.equal(await rpc(partnerUser, "submit_partner_doc_for_review", { p_doc: data.id }), null);
  return data.id;
}

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client");
  adm = await makeUser("admin", "admin");
  caa = await makeUser("caa", "partner");
  cpaOnly = await makeUser("cpa", "partner");
  both = await makeUser("both", "partner");
  caaId = await makePartner(caa, "CAA");
  cpaOnlyId = await makePartner(cpaOnly, "CPA");
  bothId = await makePartner(both, "CAA/CPA");
});

test("партнёр не видит денег: нет доступа к orders, заказы только через partner_orders()", { skip }, async () => {
  const o = await newOrder("llc_wy");
  assert.equal(await rpc(adm, "assign_partner", { p_order: o, p_partner: caaId }), null);
  assert.equal((await caa.c.from("orders").select("id").eq("id", o)).data.length, 0);
  const { data } = await caa.c.rpc("partner_orders");
  const row = data.find((r) => r.id === o);
  assert.ok(row, "назначенный заказ виден через partner_orders");
  assert.equal(row.in_work, false);
  for (const key of ["payment_status", "payment_note", "amount_cents", "paid_at", "payment_marked_manually"]) {
    assert.ok(!(key in row), `в partner_orders не должно быть поля ${key}`);
  }
  assert.match(err(await propose(caa, o, "review")) ?? "", /Not released/);
  assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: o, p_note: "qa" }), null);
  const after = (await caa.c.rpc("partner_orders")).data.find((r) => r.id === o);
  assert.equal(after.in_work, true);
});

test("оплата: LLC и пакет сразу, ITIN только после одобрения основания", { skip }, async () => {
  for (const p of ["llc_de", "bundle_wy", "bundle_de"]) {
    const o = await newOrder(p);
    assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: o, p_note: "qa" }), null, p);
  }
  for (const p of ["itin_standard", "itin_return"]) {
    const o = await newOrder(p);
    assert.match(await rpc(adm, "mark_order_paid_manually", { p_order: o, p_note: "qa" }) ?? "", /Eligibility approval required/, p);
  }
});

test("основание ITIN: партнёр предлагает, клиент видит после подтверждения админа", { skip }, async () => {
  const o = await newOrder("itin_standard");
  assert.equal(await rpc(adm, "assign_partner", { p_order: o, p_partner: caaId }), null);
  assert.notEqual(await rpc(caa, "approve_eligibility", { p_order: o }), null, "партнёр не решает сам");
  assert.notEqual(await rpc(caa, "reject_eligibility", { p_order: o, p_reason: "нет" }), null, "партнёр не решает сам");
  assert.equal((await caa.c.rpc("propose_eligibility", { p_order: o, p_decision: "reject", p_reason: "нет налогового основания", p_op: op() })).error, null);
  let row = (await client.c.from("orders").select("eligibility").eq("id", o).single()).data;
  assert.equal(row.eligibility, "pending", "клиент ещё не видит решения");
  assert.equal((await adm.c.rpc("confirm_eligibility", { p_order: o, p_op: op() })).error, null);
  row = (await client.c.from("orders").select("eligibility,eligibility_note").eq("id", o).single()).data;
  assert.equal(row.eligibility, "rejected");
  assert.equal(row.eligibility_note, "нет налогового основания");
});

test("пакет: отказ по ITIN после оплаты останавливает только ITIN", { skip }, async () => {
  const b = await newOrder("bundle_de");
  assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: b, p_note: "qa" }), null);
  assert.equal(await rpc(adm, "assign_partner", { p_order: b, p_partner: caaId }), null);
  assert.equal((await caa.c.rpc("propose_eligibility", { p_order: b, p_decision: "reject", p_reason: "нет основания", p_op: op() })).error, null);
  assert.equal((await adm.c.rpc("confirm_eligibility", { p_order: b, p_op: op() })).error, null);
  assert.equal(err(await propose(caa, b, "review")), null, "LLC продолжается");
  assert.notEqual(err(await propose(caa, b, "caa_interview", "itin")), null, "ITIN остановлен");
  assert.equal(await rpc(adm, "record_refund", { p_order: b, p_amount_cents: 10000, p_scope: "itin", p_reason: "Отказ в основании ITIN — возврат по правилу пакета", p_op: op() }), null);
});

test("назначение: ITIN + декларация — только CAA/CPA; ITIN и пакеты — CAA", { skip }, async () => {
  const r = await newOrder("itin_return");
  assert.match(await rpc(adm, "assign_partner", { p_order: r, p_partner: caaId }) ?? "", /CAA\/CPA/);
  assert.equal(await rpc(adm, "assign_partner", { p_order: r, p_partner: bothId }), null);
  const s = await newOrder("itin_standard");
  assert.match(await rpc(adm, "assign_partner", { p_order: s, p_partner: cpaOnlyId }) ?? "", /Partner must be CAA/);
  const l = await newOrder("llc_wy");
  assert.equal(await rpc(adm, "assign_partner", { p_order: l, p_partner: cpaOnlyId }), null, "LLC — любой партнёр");
});

test("ITIN + декларация: этапы, отказ IRS → повторная подача бесплатно, номер ITIN, финал", { skip }, async () => {
  const o = await newOrder("itin_return");
  assert.equal(await rpc(adm, "assign_partner", { p_order: o, p_partner: bothId }), null);
  assert.equal((await both.c.rpc("propose_eligibility", { p_order: o, p_decision: "approve", p_reason: null, p_op: op() })).error, null);
  assert.equal((await adm.c.rpc("confirm_eligibility", { p_order: o, p_op: op() })).error, null);
  assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: o, p_note: "qa" }), null);

  assert.match(err(await propose(both, o, "caa_interview")) ?? "", /Status changed/, "сначала подготовка декларации");
  for (const to of ["return_prep", "client_signed", "caa_interview", "sent_irs"]) await step(o, to);

  assert.equal((await adm.c.rpc("record_irs_event", { p_order: o, p_stream: "main", p_kind: "request", p_note: "IRS просит документ", p_op: op() })).error, null);
  assert.equal((await adm.c.rpc("record_irs_event", { p_order: o, p_stream: "main", p_kind: "rejection", p_note: "Отказ IRS", p_op: op() })).error, null);
  let row = (await client.c.from("orders").select("status,itin_attempt,payment_status").eq("id", o).single()).data;
  assert.deepEqual([row.status, row.itin_attempt, row.payment_status], ["documents", 2, "paid"], "повторная подача без новой оплаты");
  assert.equal((await client.c.from("itin_irs_events").select("kind").eq("order_id", o)).data.length, 2);

  for (const to of ["return_prep", "client_signed", "caa_interview", "sent_irs"]) await step(o, to);
  assert.match(err(await propose(both, o, "itin_received")) ?? "", /Partner ITIN required/);
  assert.match(await rpc(both, "record_itin", { p_order: o, p_itin: "123-45-6789", p_assigned_on: null }) ?? "", /9XX-XX-XXXX/);
  assert.equal(await rpc(both, "record_itin", { p_order: o, p_itin: "912-34-5678", p_assigned_on: null }), null);
  assert.equal((await client.c.from("order_itin").select("itin").eq("order_id", o)).data.length, 0, "клиент не видит неодобренный номер");
  assert.match(err(await propose(both, o, "itin_received")) ?? "", /Partner ITIN letter required/);
  const letter = await upload(both, bothId, o, "itin_letter");
  assert.equal(err(await propose(both, o, "itin_received")), null);
  assert.match(err(await confirm(adm, o, "itin_received")) ?? "", /ITIN required/);
  assert.equal(await rpc(adm, "approve_itin", { p_order: o }), null);
  assert.match(err(await confirm(adm, o, "itin_received")) ?? "", /ITIN letter required/);
  assert.equal(await rpc(adm, "publish_partner_doc", { p_doc: letter }), null);
  assert.equal(err(await confirm(adm, o, "itin_received")), null);

  row = (await client.c.from("orders").select("status,closed_at").eq("id", o).single()).data;
  assert.equal(row.status, "itin_received");
  assert.ok(row.closed_at);
  assert.equal((await client.c.from("order_itin").select("itin").eq("order_id", o).single()).data.itin, "912-34-5678");
});
