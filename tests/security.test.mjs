// Тесты безопасности и процесса Taxpasso. Запуск: npm run test:security
// Нужны SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — ТОЛЬКО тестовой/локальной базы.
// В GitHub Actions база поднимается с нуля из supabase/migrations (см. .github/workflows/ci.yml).
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
let svc, client, other, adm, partner, stranger, partnerId;

async function makeUser(tag, role) {
  const email = `qa+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) {
    const { error: e } = await svc.from("profiles").update({ role }).eq("id", data.user.id);
    if (e) throw e;
  }
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
const rpc = async (u, fn, args) => (await u.c.rpc(fn, args)).error?.message ?? null;

async function newPaidAssignedOrder(product = "llc_wy") {
  const { data, error } = await client.c.from("orders").insert({
    client_id: client.id, product, status: "draft",
    applicant: { name: "QA Client", country: "AM", company: "QA LLC", activity: "IT" },
  }).select("id").single();
  assert.equal(error, null);
  assert.equal(await rpc(client, "record_consent", { p_order: data.id, p_terms_version: "qa", p_refund_version: "qa" }), null);
  assert.equal(await rpc(client, "submit_order", { p_order: data.id }), null);
  assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: data.id, p_note: "qa" }), null);
  assert.equal(await rpc(adm, "assign_partner", { p_order: data.id, p_partner: partnerId }), null);
  return data.id;
}
async function partnerUpload(orderId, name, docType) {
  const path = `${orderId}/${run}-${name}.pdf`;
  const up = await partner.c.storage.from("documents")
    .upload(path, new Blob(["%PDF-1.4 qa"], { type: "application/pdf" }), { contentType: "application/pdf" });
  assert.equal(up.error, null, up.error?.message);
  const { data, error } = await partner.c.from("partner_documents").insert({
    order_id: orderId, partner_id: partnerId, uploaded_by: partner.id, path,
    name: `${name}.pdf`, mime_type: "application/pdf", size_bytes: 11, doc_type: docType,
  }).select("id").single();
  assert.equal(error, null, error?.message);
  return { id: data.id, path };
}

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client");
  other = await makeUser("other");
  adm = await makeUser("admin", "admin");
  partner = await makeUser("partner", "partner");
  stranger = await makeUser("stranger", "partner");
  const { data, error } = await svc.from("partners")
    .insert({ profile_id: partner.id, display_name: "QA CAA", qualification: "CAA" }).select("id").single();
  if (error) throw error;
  partnerId = data.id;
  await svc.from("partners").insert({ profile_id: stranger.id, display_name: "QA CPA", qualification: "CPA" });
});

test("прямой перевод статуса закрыт для всех", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  assert.match(await rpc(partner, "advance_order", { p_order: o, p_status: "review" }) ?? "", /permission denied/i);
  assert.match(await rpc(adm, "advance_order", { p_order: o, p_status: "review" }) ?? "", /permission denied/i);
});

test("два ключа: клиент видит только подтверждённое админом", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  assert.match(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }) ?? "", /Waiting for partner/);
  assert.equal(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }), null);
  assert.equal(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }), null);

  const seen = await client.c.from("orders").select("status").eq("id", o).single();
  assert.equal(seen.data.status, "application");
  const leak = await client.c.from("status_proposals").select("*");
  assert.equal(leak.data.length, 0, "клиент не должен видеть прогресс партнёра");

  assert.equal(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }), null);
  assert.equal(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }), null);
  assert.match(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }) ?? "", /Waiting for partner/);
  const after = await client.c.from("orders").select("status").eq("id", o).single();
  assert.equal(after.data.status, "filed_state");
});

test("посторонние не видят чужой заказ и не могут его двигать", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const a = await other.c.from("orders").select("id").eq("id", o);
  assert.equal(a.data.length, 0);
  const b = await stranger.c.from("orders").select("id").eq("id", o);
  assert.equal(b.data.length, 0);
  assert.notEqual(await rpc(stranger, "propose_status", { p_order: o, p_stream: "main" }), null);
  assert.notEqual(await rpc(partner, "confirm_status", { p_order: o, p_stream: "main" }), null);
  assert.notEqual(await rpc(client, "mark_order_paid_manually", { p_order: o, p_note: "x" }), null);
});

test("файлы партнёра: клиент видит только опубликованные", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const d = await partnerUpload(o, "draft", "other");

  const s1 = await client.c.storage.from("documents").createSignedUrl(d.path, 60);
  assert.ok(!s1.data?.signedUrl, "черновик партнёра не должен открываться клиенту");
  assert.equal((await client.c.from("partner_documents").select("id").eq("id", d.id)).data.length, 0);

  assert.equal(await rpc(partner, "submit_partner_doc_for_review", { p_doc: d.id }), null);
  const s2 = await client.c.storage.from("documents").createSignedUrl(d.path, 60);
  assert.ok(!s2.data?.signedUrl, "файл на проверке у админа не должен открываться клиенту");

  assert.equal(await rpc(adm, "publish_partner_doc", { p_doc: d.id }), null);
  const s3 = await client.c.storage.from("documents").createSignedUrl(d.path, 60);
  assert.ok(s3.data?.signedUrl, "опубликованный файл должен открываться клиенту");

  const s4 = await other.c.storage.from("documents").createSignedUrl(d.path, 60);
  assert.ok(!s4.data?.signedUrl, "чужой клиент не должен открывать файл");
});

test("партнёр не может писать в документы клиента и подписываться чужим именем", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const path = `${o}/${run}-fake.pdf`;
  await partner.c.storage.from("documents")
    .upload(path, new Blob(["%PDF qa"], { type: "application/pdf" }), { contentType: "application/pdf" });
  const r1 = await partner.c.from("documents").insert({
    order_id: o, uploaded_by: partner.id, path, name: "fake.pdf", mime_type: "application/pdf", size_bytes: 7,
  });
  assert.notEqual(r1.error, null, "партнёр не должен добавлять документы клиента");

  const { data: strangerRow } = await svc.from("partners").select("id").eq("profile_id", stranger.id).single();
  const r2 = await partner.c.from("partner_documents").insert({
    order_id: o, partner_id: strangerRow.id, uploaded_by: partner.id, path,
    name: "spoof.pdf", mime_type: "application/pdf", size_bytes: 7,
  });
  assert.notEqual(r2.error, null, "партнёр не должен подписываться чужим partner_id");
});

test("данные компании видны клиенту только после одобрения; финал и закрытие", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  for (let i = 0; i < 4; i++) {
    assert.equal(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }), null);
    assert.equal(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }), null);
  }
  assert.match(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }) ?? "", /Partner EIN required/);
  assert.match(await rpc(partner, "record_company", { p_order: o, p_name: "QA LLC", p_ein: "123456789", p_registered_on: "2026-09-20" }) ?? "", /EIN format/);
  assert.equal(await rpc(partner, "record_company", { p_order: o, p_name: "QA LLC", p_ein: "12-3456789", p_registered_on: "2026-09-20" }), null);
  assert.equal((await client.c.from("companies").select("order_id").eq("order_id", o)).data.length, 0);

  const docs = [];
  for (const t of ["articles", "ein_letter", "operating_agreement"]) {
    const d = await partnerUpload(o, t, t);
    assert.equal(await rpc(partner, "submit_partner_doc_for_review", { p_doc: d.id }), null);
    docs.push(d);
  }
  assert.equal(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }), null);
  assert.match(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }) ?? "", /Company EIN required/);

  assert.equal(await rpc(adm, "approve_company", { p_order: o }), null);
  for (const d of docs) assert.equal(await rpc(adm, "publish_partner_doc", { p_doc: d.id }), null);
  assert.equal(await rpc(adm, "set_service_years", { p_order: o, p_years: 2 }), null);
  assert.equal(await rpc(adm, "confirm_status", { p_order: o, p_stream: "main" }), null);

  const fin = await client.c.from("orders").select("status,closed_at,service_until").eq("id", o).single();
  assert.equal(fin.data.status, "ein_received");
  assert.ok(fin.data.closed_at, "заказ должен закрыться");
  assert.equal(fin.data.service_until, "2028-09-20");
  assert.equal((await client.c.from("companies").select("order_id").eq("order_id", o)).data.length, 1);
  assert.equal((await client.c.from("deadlines").select("id").eq("order_id", o)).data.length, 3);
  assert.match(await rpc(partner, "propose_status", { p_order: o, p_stream: "main" }) ?? "", /Order closed/);
});
