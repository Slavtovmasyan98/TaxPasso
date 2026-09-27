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
const op = () => crypto.randomUUID();
const propose = (u, o, to, stream = "main", p_op = op()) =>
  u.c.rpc("propose_status", { p_order: o, p_stream: stream, p_to: to, p_op });
const confirm = (u, o, to, stream = "main", p_op = op()) =>
  u.c.rpc("confirm_status", { p_order: o, p_stream: stream, p_to: to, p_op });
const err = (r) => r.error?.message ?? null;

async function newPaidAssignedOrder(product = "llc_wy") {
  const { data, error } = await client.c.from("orders").insert({
    client_id: client.id, product, status: "draft",
    applicant: { name: "QA Client", country: "AM", company: "QA LLC", activity: "IT" },
  }).select("id").single();
  assert.equal(error, null);
  assert.equal(await rpc(client, "record_consent", { p_order: data.id, p_terms_version: "qa", p_refund_version: "qa" }), null);
  assert.equal(await rpc(client, "submit_order", { p_order: data.id }), null);
  if (product.startsWith("itin") || product.startsWith("bundle")) {
    assert.equal(await rpc(adm, "approve_eligibility", { p_order: data.id }), null);
  }
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
  assert.match(err(await confirm(adm, o, "review")) ?? "", /Waiting for partner/);
  assert.equal(err(await propose(partner, o, "review")), null);
  assert.equal(err(await propose(partner, o, "filed_state")), null);

  const seen = await client.c.from("orders").select("status").eq("id", o).single();
  assert.equal(seen.data.status, "application");
  const leak = await client.c.from("status_proposals").select("*");
  assert.equal(leak.data.length, 0, "клиент не должен видеть прогресс партнёра");

  assert.equal(err(await confirm(adm, o, "review")), null);
  assert.equal(err(await confirm(adm, o, "filed_state")), null);
  assert.match(err(await confirm(adm, o, "registered")) ?? "", /Waiting for partner/);
  const after = await client.c.from("orders").select("status").eq("id", o).single();
  assert.equal(after.data.status, "filed_state");
});

test("идемпотентность: повтор и двойной клик не продвигают заказ дважды", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const k = op();
  assert.equal((await propose(partner, o, "review", "main", k)).data, "ok");
  assert.equal((await propose(partner, o, "review", "main", k)).data, "already_done");
  assert.equal((await propose(partner, o, "review")).data, "already_done");
  assert.match(err(await propose(partner, o, "registered")) ?? "", /Status changed/);
  assert.equal(err(await propose(partner, o, "filed_state")), null);

  const k2 = op();
  const [a, b] = await Promise.all([confirm(adm, o, "review", "main", k2), confirm(adm, o, "review", "main", k2)]);
  assert.deepEqual([a.data, b.data].sort(), ["already_done", "ok"]);
  const st = await client.c.from("orders").select("status").eq("id", o).single();
  assert.equal(st.data.status, "review", "двойной клик не должен перескочить этап");
});

test("посторонние не видят чужой заказ и не могут его двигать", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const a = await other.c.from("orders").select("id").eq("id", o);
  assert.equal(a.data.length, 0);
  const b = await stranger.c.from("orders").select("id").eq("id", o);
  assert.equal(b.data.length, 0);
  assert.notEqual(err(await propose(stranger, o, "review")), null);
  assert.equal(err(await propose(partner, o, "review")), null);
  assert.notEqual(err(await confirm(partner, o, "review")), null, "партнёр не может подтверждать клиенту");
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
  for (const to of ["review", "filed_state", "registered", "ein_requested"]) {
    assert.equal(err(await propose(partner, o, to)), null);
    assert.equal(err(await confirm(adm, o, to)), null);
  }
  assert.match(err(await propose(partner, o, "ein_received")) ?? "", /Partner EIN required/);
  assert.match(await rpc(partner, "record_company", { p_order: o, p_name: "QA LLC", p_ein: "123456789", p_registered_on: "2026-09-20" }) ?? "", /EIN format/);
  assert.equal(await rpc(partner, "record_company", { p_order: o, p_name: "QA LLC", p_ein: "12-3456789", p_registered_on: "2026-09-20" }), null);
  assert.equal((await client.c.from("companies").select("order_id").eq("order_id", o)).data.length, 0);

  const docs = [];
  for (const t of ["articles", "ein_letter", "operating_agreement"]) {
    const d = await partnerUpload(o, t, t);
    assert.equal(await rpc(partner, "submit_partner_doc_for_review", { p_doc: d.id }), null);
    docs.push(d);
  }
  assert.equal(err(await propose(partner, o, "ein_received")), null);
  assert.match(err(await confirm(adm, o, "ein_received")) ?? "", /Company EIN required/);

  assert.equal(await rpc(adm, "approve_company", { p_order: o }), null);
  for (const d of docs) assert.equal(await rpc(adm, "publish_partner_doc", { p_doc: d.id }), null);
  assert.equal(await rpc(adm, "set_service_years", { p_order: o, p_years: 2 }), null);
  assert.equal(err(await confirm(adm, o, "ein_received")), null);

  const fin = await client.c.from("orders").select("status,closed_at,service_until").eq("id", o).single();
  assert.equal(fin.data.status, "ein_received");
  assert.ok(fin.data.closed_at, "заказ должен закрыться");
  assert.equal(fin.data.service_until, "2028-09-20");
  assert.equal((await client.c.from("companies").select("order_id").eq("order_id", o)).data.length, 1);
  assert.equal((await client.c.from("deadlines").select("id").eq("order_id", o)).data.length, 3);
  assert.match(err(await propose(partner, o, "ein_received")) ?? "", /Order closed/);
});

test("смена партнёра: прогресс сброшен, факт подачи сохранён, старый теряет доступ", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  assert.equal(err(await propose(partner, o, "review")), null);
  assert.equal(err(await propose(partner, o, "filed_state")), null);
  const { data: strangerRow } = await svc.from("partners").select("id").eq("profile_id", stranger.id).single();
  assert.equal(await rpc(adm, "assign_partner", { p_order: o, p_partner: strangerRow.id }), null);

  assert.equal((await partner.c.from("orders").select("id").eq("id", o)).data.length, 0, "старый партнёр теряет доступ");
  assert.equal((await stranger.c.from("status_proposals").select("*").eq("order_id", o)).data.length, 0, "прогресс сброшен");
  const ms = await stranger.c.from("order_milestones").select("milestone").eq("order_id", o);
  assert.deepEqual(ms.data.map((m) => m.milestone), ["state_filed"], "новый партнёр видит факт подачи");
});

test("отмена: только до подачи (учитывая прогресс партнёра), с причиной, деньги отдельно", { skip }, async () => {
  const filed = await newPaidAssignedOrder();
  assert.equal(err(await propose(partner, filed, "review")), null);
  assert.equal(err(await propose(partner, filed, "filed_state")), null);
  assert.match(await rpc(adm, "cancel_order", { p_order: filed, p_reason: "клиент передумал", p_op: op() }) ?? "", /Already filed/);

  const o = await newPaidAssignedOrder();
  assert.match(await rpc(adm, "cancel_order", { p_order: o, p_reason: "", p_op: op() }) ?? "", /Reason required/);
  assert.notEqual(await rpc(partner, "cancel_order", { p_order: o, p_reason: "попытка", p_op: op() }), null);
  assert.equal(await rpc(adm, "cancel_order", { p_order: o, p_reason: "клиент отказался", p_op: op() }), null);
  const row = await client.c.from("orders").select("cancelled_at,cancel_reason,payment_status").eq("id", o).single();
  assert.ok(row.data.cancelled_at);
  assert.equal(row.data.payment_status, "paid", "отмена сама по себе деньги не возвращает");

  assert.equal(await rpc(adm, "record_refund", { p_order: o, p_amount_cents: 20000, p_scope: "order", p_reason: "за вычетом оказанных услуг", p_op: op() }), null);
  assert.equal((await client.c.from("order_refunds").select("id").eq("order_id", o)).data.length, 1);
  assert.equal((await other.c.from("order_refunds").select("id").eq("order_id", o)).data.length, 0);
  assert.notEqual(err(await propose(partner, o, "review")), null, "отменённый заказ нельзя двигать");
});

test("пакет LLC+ITIN: отказ по ITIN останавливает только ITIN", { skip }, async () => {
  const b = await newPaidAssignedOrder("bundle_wy");
  assert.equal(await rpc(partner, "reject_eligibility", { p_order: b, p_reason: "нет налогового основания" }), null);
  assert.notEqual(err(await propose(partner, b, "caa_interview", "itin")), null);
  assert.equal(err(await propose(partner, b, "review")), null, "LLC продолжается");
  const row = await client.c.from("orders").select("eligibility,eligibility_note,closed_at").eq("id", b).single();
  assert.equal(row.data.eligibility, "rejected");
  assert.equal(row.data.closed_at, null);
});

test("журнал действий: только админ читает, изменить нельзя никому", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  assert.equal(err(await propose(partner, o, "review")), null);
  assert.equal((await client.c.from("audit_log").select("id").eq("order_id", o)).data.length, 0);
  assert.equal((await partner.c.from("audit_log").select("id").eq("order_id", o)).data.length, 0);
  const rows = await adm.c.from("audit_log").select("id,entity,action").eq("order_id", o);
  assert.ok(rows.data.length >= 3, "должны быть записи о создании, оплате, назначении и шаге партнёра");
  const upd = await adm.c.from("audit_log").update({ reason: "x" }).eq("order_id", o).select("id");
  assert.ok(upd.error || upd.data.length === 0, "журнал нельзя изменить");
  const del = await adm.c.from("audit_log").delete().eq("order_id", o).select("id");
  assert.ok(del.error || del.data.length === 0, "журнал нельзя удалить");
});

test("служебные функции прав не вызываются через API", { skip }, async () => {
  for (const fn of ["current_role", "can_read_order", "can_manage_order", "set_user_role"]) {
    const r = await client.c.rpc(fn, fn === "current_role" ? {} : { p_order: crypto.randomUUID() });
    assert.ok(r.error, `${fn} не должна быть доступна`);
  }
});

test("повторная загрузка заменяет отклонённый документ", { skip }, async () => {
  const o = await newPaidAssignedOrder();
  const up = async (name) => {
    const path = `${o}/${run}-${name}.pdf`;
    const u = await client.c.storage.from("documents").upload(path, new Blob(["%PDF qa"], { type: "application/pdf" }), { contentType: "application/pdf" });
    assert.equal(u.error, null, u.error?.message);
    return path;
  };
  const p1 = await up("pass1");
  const { data: d1 } = await client.c.from("documents").insert({
    order_id: o, uploaded_by: client.id, path: p1, name: "pass1.pdf", mime_type: "application/pdf", size_bytes: 7, kind: "passport",
  }).select("id").single();
  const p2 = await up("pass2");
  const { data: d2, error } = await client.c.from("documents").insert({
    order_id: o, uploaded_by: client.id, path: p2, name: "pass2.pdf", mime_type: "application/pdf", size_bytes: 7, replaces_document_id: d1.id,
  }).select("id,kind").single();
  assert.equal(error, null, error?.message);
  assert.equal(d2.kind, "passport");
  const old = await client.c.from("documents").select("superseded_at").eq("id", d1.id).single();
  assert.ok(old.data.superseded_at, "старая версия помечена как заменённая");
});

test("оплата ITIN требует одобрения, пакет LLC+ITIN оплачивается сразу", { skip }, async () => {
  for (const product of ["itin_standard", "itin_return"]) {
    const { data, error } = await client.c.from("orders").insert({
      client_id: client.id, product, status: "draft",
      applicant: { name: "QA", country: "AM", company: "QA LLC", activity: "IT", quiz_ssn: "no", quiz_basis: "unknown" },
    }).select("id").single();
    assert.equal(error, null);
    assert.equal(await rpc(client, "record_consent", { p_order: data.id, p_terms_version: "qa", p_refund_version: "qa" }), null);
    assert.equal(await rpc(client, "submit_order", { p_order: data.id }), null);
    assert.match(await rpc(adm, "mark_order_paid_manually", { p_order: data.id, p_note: "x" }) ?? "", /Eligibility approval required/, product);
    assert.equal(await rpc(adm, "reject_eligibility", { p_order: data.id, p_reason: "QA no basis" }), null);
    assert.match(await rpc(adm, "mark_order_paid_manually", { p_order: data.id, p_note: "x" }) ?? "", /Eligibility approval required/, product);
    assert.equal(await rpc(adm, "approve_eligibility", { p_order: data.id }), null);
    assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: data.id, p_note: "x" }), null, product);
  }

  for (const product of ["bundle_wy", "bundle_de"]) {
    const { data, error } = await client.c.from("orders").insert({
      client_id: client.id, product, status: "draft",
      applicant: { name: "QA", country: "AM", company: "QA LLC", activity: "IT", quiz_ssn: "no", quiz_basis: "unknown" },
    }).select("id").single();
    assert.equal(error, null);
    assert.equal(await rpc(client, "record_consent", { p_order: data.id, p_terms_version: "qa", p_refund_version: "qa" }), null);
    assert.equal(await rpc(client, "submit_order", { p_order: data.id }), null);
    assert.equal(await rpc(adm, "mark_order_paid_manually", { p_order: data.id, p_note: "bundle paid before ITIN decision" }), null, product);
    assert.equal(await rpc(adm, "reject_eligibility", { p_order: data.id, p_reason: "QA no basis" }), null);
    const row = await client.c.from("orders").select("payment_status,eligibility").eq("id", data.id).single();
    assert.equal(row.data.payment_status, "paid", product);
    assert.equal(row.data.eligibility, "rejected", product);
  }
});
