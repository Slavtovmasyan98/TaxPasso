// Тесты миграции 023: специалист работает только с консультациями.
// Запуск: node --test tests/specialist_scope.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { submitItinApplication } from "./helpers/itin.mjs";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, adm, client, spec, caa, specId, caaId;
const err = (r) => r.error?.message ?? null;
const op = () => crypto.randomUUID();

async function makeUser(tag, role) {
  const email = `qa23+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function consultOrder(name) {
  const o = (await client.c.from("orders").insert({ client_id: client.id, product: "itin_consult", status: "draft",
    applicant: { name, country: "AM" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("record_consult_contact", { p_order: o, p_method: "telegram", p_value: "@qa23client", p_preferred_time: "" })), null);
  assert.equal(err(await client.c.rpc("submit_order", { p_order: o })), null);
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specId })), null);
  return o;
}
async function clientDoc(order) {
  const path = `${order}/${crypto.randomUUID()}.pdf`;
  const up = await client.c.storage.from("documents").upload(path, new Blob(["%PDF-1.4 qa23"], { type: "application/pdf" }), { contentType: "application/pdf" });
  assert.equal(err(up), null, err(up));
  const d = await client.c.from("documents").insert({ order_id: order, uploaded_by: client.id, path, name: "passport.pdf", mime_type: "application/pdf", size_bytes: 13 }).select("id").single();
  assert.equal(err(d), null, err(d));
  return { path, id: d.data.id };
}
const seesOrder = async (u, order) => ((await u.c.rpc("partner_orders")).data || []).some((o) => o.id === order);
const readsDocs = async (u, order) => ((await u.c.from("documents").select("id").eq("order_id", order)).data || []).length > 0;
const signs = async (u, path) => !(await u.c.storage.from("documents").createSignedUrl(path, 60)).error;

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  adm = await makeUser("admin", "admin");
  client = await makeUser("client");
  spec = await makeUser("spec", "partner");
  caa = await makeUser("caa", "partner");
  specId = (await svc.from("partners").insert({ profile_id: spec.id, display_name: "QA23 Spec", qualification: "SPECIALIST" }).select("id").single()).data.id;
  caaId = (await svc.from("partners").insert({ profile_id: caa.id, display_name: "QA23 CAA", qualification: "CAA/CPA" }).select("id").single()).data.id;
});

test("специалист ведёт консультацию: видит её и отправляет предложение", { skip }, async () => {
  const o = await consultOrder("QA23 consult");
  assert.equal(await seesOrder(spec, o), true);
  assert.equal(err(await spec.c.rpc("propose_specialist_plan", { p_order: o, p_decision: "approve",
    p_recommended_product: "itin_standard", p_reason: null, p_op: op() })), null);
});

test("одобрение плана снимает специалиста; документы клиента ему недоступны", { skip }, async () => {
  const o = await consultOrder("QA23 approve");
  assert.equal(err(await spec.c.rpc("propose_specialist_plan", { p_order: o, p_decision: "approve",
    p_recommended_product: "itin_return", p_reason: null, p_op: op() })), null);
  assert.equal(err(await adm.c.rpc("confirm_specialist_plan", { p_order: o, p_op: op() })), null);
  const row = (await svc.from("orders").select("product,status,eligibility,partner_id").eq("id", o).single()).data;
  assert.deepEqual(row, { product: "itin_return", status: "documents", eligibility: "approved", partner_id: null });
  const doc = await clientDoc(o);
  assert.equal(await seesOrder(spec, o), false, "заказ пропал из списка специалиста");
  assert.equal(await readsDocs(spec, o), false, "документы клиента не читаются");
  assert.equal(await signs(spec, doc.path), false, "паспорт не открывается");
  // админ передаёт CAA/CPA — у него всё работает
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: caaId })), null);
  assert.equal(await readsDocs(caa, o), true);
  assert.equal(await signs(caa, doc.path), true);
});

test("специалист, назначенный на обычный заказ в обход assign_partner, ничего не видит и не делает", { skip }, async () => {
  const o = (await client.c.from("orders").insert({ client_id: client.id, product: "itin_standard", status: "draft",
    applicant: { name: "QA23 forced", country: "AM" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("submit_order", { p_order: o })), null);
  assert.equal(err(await adm.c.rpc("approve_eligibility", { p_order: o })), null);
  const due = (await adm.c.rpc("order_payment_due", { p_order: o })).data[0];
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "QA", p_amount_cents: due.total_cents })), null);
  const doc = await clientDoc(o);
  // assign_partner не даёт: специалист только на консультации
  assert.match(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: specId })) ?? "", /Invalid partner/);
  // имитируем ошибочное назначение напрямую в базе
  assert.equal(err(await svc.from("orders").update({ partner_id: specId }).eq("id", o)), null);
  assert.equal(await seesOrder(spec, o), false, "нет в списке заказов");
  assert.equal(await readsDocs(spec, o), false, "документы не читаются");
  assert.equal(await signs(spec, doc.path), false, "файл не открывается");
  assert.notEqual(err(await spec.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "caa_interview", p_op: op() })), null, "этап не двигается");
  assert.notEqual(err(await spec.c.rpc("propose_document_review", { p_document: doc.id, p_status: "accepted", p_comment: null, p_op: op() })), null, "документ не проверяется");
  assert.notEqual(err(await spec.c.rpc("record_itin", { p_order: o, p_itin: "912-34-5678", p_assigned_on: null })), null, "ITIN не вносится");
  const ins = await spec.c.from("partner_documents").insert({ order_id: o, partner_id: specId, uploaded_by: spec.id,
    path: `${o}/x.pdf`, name: "x.pdf", mime_type: "application/pdf", size_bytes: 1, doc_type: "other" });
  assert.notEqual(err(ins), null, "документ партнёра не загружается");
  // тот же заказ у CAA/CPA работает
  assert.equal(err(await svc.from("orders").update({ partner_id: caaId }).eq("id", o)), null);
  assert.equal(await readsDocs(caa, o), true);
  assert.equal(await submitItinApplication(client, o), "ok");
  assert.equal(err(await caa.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "caa_interview", p_op: op() })), null);
});
