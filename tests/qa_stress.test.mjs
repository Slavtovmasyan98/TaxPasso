// QA stress tests. Куда: tests/qa_stress.test.mjs. Запуск: node --test tests/qa_stress.test.mjs
// Нужны ключи ТЕСТОВОЙ базы (как в остальных тестах); на рабочей базе отказывается работать.
//
// ВАЖНО про параллельность: node --test запускает файлы параллельно в одной базе. Поэтому этот файл НЕ меняет
// глобальное состояние (каталог доп. услуг, переключатель enforce_order_setup, цены) — такие проверки живут
// в addons.test.mjs или проверены разовым прогоном (см. QA_STRESS_TEST_MATRIX.md).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
const DAY = 86400000;
let svc, client, client2, adm, partnerA, partnerB, partnerAId, partnerBId;
const op = () => crypto.randomUUID();
const err = (r) => r.error?.message ?? null;
const pdf = () => new Blob(["%PDF qa"], { type: "application/pdf" });

async function makeUser(tag, role) {
  const email = `qastress+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
async function makePartner(u, q) {
  const { data, error } = await svc.from("partners").insert({ profile_id: u.id, display_name: q, qualification: q }).select("id").single();
  if (error) throw error;
  return data.id;
}
async function newOrder(product = "llc_wy", who = client, applicant) {
  const a = applicant ?? (product.startsWith("itin")
    ? { name: "QA", country: "AM" } : { name: "QA", country: "AM", company: "QA LLC", activity: "IT" });
  const { data, error } = await who.c.from("orders").insert({ client_id: who.id, product, status: "draft", applicant: a }).select("id").single();
  assert.equal(error, null, error?.message);
  return data.id;
}
const submit = (o, who = client) => who.c.rpc("submit_order", { p_order: o });
async function submitted(product = "llc_wy") { const o = await newOrder(product); assert.equal(err(await submit(o)), null); return o; }
async function paid(product = "llc_wy") {
  const o = await submitted(product);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "qa" })), null);
  return o;
}
async function paidAssigned(partnerId, product = "llc_wy") {
  const o = await paid(product);
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: partnerId })), null);
  return o;
}
const cancel = async (o, reason = "клиент отказался") => assert.equal(err(await adm.c.rpc("cancel_order", { p_order: o, p_reason: reason, p_op: op() })), null);
async function uploadPassport(o, memberId) {
  const path = `${o}/${run}-${memberId ?? "x"}-${crypto.randomUUID()}.pdf`;
  assert.equal((await client.c.storage.from("documents").upload(path, pdf(), { contentType: "application/pdf" })).error, null);
  const { data, error } = await client.c.from("documents").insert({
    order_id: o, uploaded_by: client.id, path, name: "p.pdf", mime_type: "application/pdf", size_bytes: 7, kind: "passport", member_id: memberId ?? null,
  }).select("id").single();
  assert.equal(error, null, error?.message);
  return data.id;
}

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client"); client2 = await makeUser("client2");
  adm = await makeUser("admin", "admin");
  partnerA = await makeUser("pa", "partner"); partnerB = await makeUser("pb", "partner");
  partnerAId = await makePartner(partnerA, "CAA/CPA"); partnerBId = await makePartner(partnerB, "CAA/CPA");
});

// ═══ РЕГРЕСС-ЗАЩИТА ═════════════════════════════════════════════════════════════════════════════════

test("R1 админ-функции недоступны партнёру и клиенту (26 функций)", { skip }, async () => {
  const z = crypto.randomUUID();
  const calls = [
    ["approve_company", { p_order: z }], ["publish_partner_doc", { p_doc: z }], ["return_partner_doc", { p_doc: z, p_note: "x" }],
    ["approve_itin", { p_order: z }], ["approve_eligibility", { p_order: z }], ["reject_eligibility", { p_order: z, p_reason: "reason" }],
    ["confirm_eligibility", { p_order: z, p_op: op() }], ["return_eligibility_proposal", { p_order: z }],
    ["confirm_status", { p_order: z, p_stream: "main", p_to: "review", p_op: op() }], ["reject_status_proposal", { p_order: z, p_stream: "main" }],
    ["review_document", { p_document: z, p_status: "accepted", p_comment: "x" }], ["confirm_document_review", { p_document: z, p_op: op() }],
    ["return_document_review", { p_document: z }], ["confirm_specialist_plan", { p_order: z, p_op: op() }],
    ["reject_specialist_plan", { p_order: z, p_reason: "reason", p_op: op() }], ["set_service_years", { p_order: z, p_years: 2 }],
    ["mark_addon_paid", { p_order_addon: z, p_note: "x", p_op: op() }], ["record_refund", { p_order: z, p_amount_cents: 100, p_scope: "order", p_reason: "reason", p_op: op() }],
    ["cancel_order", { p_order: z, p_reason: "reason", p_op: op() }], ["record_irs_event", { p_order: z, p_stream: "main", p_kind: "request", p_note: "note", p_op: op() }],
    ["assign_partner", { p_order: z, p_partner: z }], ["set_addon_active", { p_code: "BUSINESS_ADDRESS", p_active: true }],
    ["set_addon_price", { p_code: "BUSINESS_ADDRESS", p_price_cents: 1 }], ["approve_partner_application", { p_app: z }],
    ["reject_partner_application", { p_app: z, p_reason: "x" }], ["mark_order_paid_manually", { p_order: z, p_note: "x" }],
    ["mark_order_paid_manually", { p_order: z, p_note: "x", p_amount_cents: 1 }], ["set_product_price", { p_product: "llc_wy", p_price_cents: 1 }],
    ["set_order_setup_enforcement", { p_on: true }],
  ];
  for (const [who, name] of [[partnerA, "partner"], [client, "client"]]) {
    for (const [fn, args] of calls) {
      const r = await who.c.rpc(fn, args);
      assert.ok(r.error, `${fn} как ${name} не должна выполняться`);
      assert.match(r.error.message, /Admin only|Not permitted|MFA required/, `${fn} как ${name}: ${r.error.message}`);
    }
  }
});

test("R2 прямые записи клиента закрыты (оплата, роль, партнёры, услуги, цены, анкета после отправки)", { skip }, async () => {
  const o = await submitted();
  assert.ok((await client.c.from("orders").update({ payment_status: "paid" }).eq("id", o)).error, "payment_status");
  assert.ok((await client.c.from("orders").update({ amount_cents: 1 }).eq("id", o)).error, "amount_cents");
  assert.ok((await client.c.from("profiles").update({ role: "admin" }).eq("id", client.id)).error, "profiles.role");
  assert.equal((await svc.from("profiles").select("role").eq("id", client.id).single()).data.role, "client");
  assert.ok((await client.c.from("partners").insert({ profile_id: client.id, display_name: "x", qualification: "CAA" })).error, "self-made partner");
  assert.ok((await client.c.from("product_prices").update({ price_cents: 1 }).eq("product", "llc_wy")).error, "product_prices");
  assert.ok((await client.c.from("orders").delete().eq("id", o)).error, "delete orders");
  const u = await client.c.from("orders").update({ applicant: { name: "HACK", country: "AM" } }).eq("id", o).select("id");
  assert.ok(u.error || u.data.length === 0, "анкета после отправки не редактируется");
});

test("R3 идемпотентность того же действия на том же заказе работает", { skip }, async () => {
  const o = await paidAssigned(partnerAId);
  const k = op();
  assert.equal((await partnerA.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "review", p_op: k })).data, "ok");
  assert.equal((await partnerA.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "review", p_op: k })).data, "already_done");
});

// ═══ ИСПРАВЛЕННЫЕ НАХОДКИ (миграции 019–020) ═════════════════════════════════════════════════════════

test("F-01 возврат: только по оплаченному, scope по продукту, без дублей, не больше оплаченного", { skip }, async () => {
  const unpaid = await submitted();
  assert.match(err(await adm.c.rpc("record_refund", { p_order: unpaid, p_amount_cents: 1000, p_scope: "order", p_reason: "qa refund", p_op: op() })) ?? "", /Order not paid/);
  const o = await paid();
  const refund = (args) => adm.c.rpc("record_refund", { p_order: o, p_scope: "order", p_reason: "qa refund", p_op: op(), ...args });
  assert.match(err(await refund({ p_amount_cents: 34901 })) ?? "", /exceeds amount paid/);
  assert.match(err(await refund({ p_amount_cents: 1000, p_scope: "itin" })) ?? "", /Scope does not match/);
  assert.equal(err(await refund({ p_amount_cents: 20000 })), null);
  assert.match(err(await refund({ p_amount_cents: 20000 })) ?? "", /Duplicate refund/);
  assert.match(err(await refund({ p_amount_cents: 14901 })) ?? "", /exceeds amount paid/);
  assert.equal(err(await refund({ p_amount_cents: 14900 })), null, "остаток 349.00 − 200.00 = 149.00 возвращается");
});

test("F-09 сумма оплаты: должная сумма на сервере, несовпадение отклоняется, старая форма совместима", { skip }, async () => {
  const o = await submitted();
  const due = (await adm.c.rpc("order_payment_due", { p_order: o })).data[0];
  assert.deepEqual([due.base_cents, due.addons_cents, due.total_cents], [34900, 0, 34900]);
  assert.equal((await client.c.rpc("order_payment_due", { p_order: o })).data[0].total_cents, 34900);
  assert.notEqual(err(await client2.c.rpc("order_payment_due", { p_order: o })), null, "чужой клиент");
  assert.notEqual(err(await partnerA.c.rpc("order_payment_due", { p_order: o })), null, "партнёр не видит сумм");
  assert.match(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x", p_amount_cents: 30000 })) ?? "", /Amount mismatch/);
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "x", p_amount_cents: 34900 })), null);
  assert.equal((await client.c.from("orders").select("amount_cents").eq("id", o).single()).data.amount_cents, 34900);

  const oCompat = await submitted("llc_de");
  assert.equal(err(await adm.c.rpc("mark_order_paid_manually", { p_order: oCompat, p_note: "старая форма" })), null, "форма без суммы работает, пока нет ожидающих услуг");
  assert.equal((await client.c.from("orders").select("amount_cents").eq("id", oCompat).single()).data.amount_cents, 44900);

  const oStripe = await submitted();
  assert.ok((await svc.rpc("mark_order_paid", { p_order: oStripe, p_session: `sess_${run}`, p_amount_cents: 1 })).error, "Stripe-путь: неверная сумма");
  assert.equal((await svc.rpc("mark_order_paid", { p_order: oStripe, p_session: `sess_${run}`, p_amount_cents: 34900 })).error, null);
  assert.ok((await client.c.rpc("mark_order_paid", { p_order: oStripe, p_session: "x", p_amount_cents: 34900 })).error, "клиент не вызывает Stripe-путь");
});

test("F-04/F-08 партнёр не видит отменённый заказ, причину отмены; доступ к завершённому — 30 дней", { skip }, async () => {
  const o = await paidAssigned(partnerAId);
  const seen = async (id) => (await partnerA.c.rpc("partner_orders")).data?.some((r) => r.id === id);
  assert.equal(await seen(o), true);
  await cancel(o, "клиент отказался, вернуть $349");
  assert.equal(await seen(o), false, "отменённый заказ пропадает у партнёра");
  const all = (await partnerA.c.rpc("partner_orders")).data ?? [];
  assert.ok(all.every((r) => !r.cancel_reason), "cancel_reason не отдаётся партнёру");
  const ins = await partnerA.c.from("partner_documents").insert({ order_id: o, partner_id: partnerAId, uploaded_by: partnerA.id, path: `${o}/late-${run}.pdf`, name: "late.pdf", mime_type: "application/pdf", size_bytes: 5, doc_type: "other" });
  assert.ok(ins.error, "в отменённый заказ партнёр документы не добавляет");

  const oDone = await paidAssigned(partnerAId);
  await svc.from("orders").update({ closed_at: new Date(Date.now() - 5 * DAY).toISOString() }).eq("id", oDone);
  assert.equal(await seen(oDone), true, "завершён 5 дней назад — доступ ещё есть");
  await svc.from("orders").update({ closed_at: new Date(Date.now() - 40 * DAY).toISOString() }).eq("id", oDone);
  assert.equal(await seen(oDone), false, "завершён 40 дней назад — доступа нет");
});

test("F-05 смена партнёра сбрасывает предложения по документам", { skip }, async () => {
  const o = await paidAssigned(partnerAId);
  const doc = await uploadPassport(o);
  assert.equal((await partnerA.c.rpc("propose_document_review", { p_document: doc, p_status: "rejected", p_comment: "blurry", p_op: op() })).error, null);
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: o, p_partner: partnerBId })), null);
  assert.equal((await adm.c.from("document_review_proposals").select("document_id").eq("order_id", o)).data.length, 0);
});

test("F-06 один op_id нельзя молча переиспользовать для другого заказа", { skip }, async () => {
  const o1 = await paidAssigned(partnerAId), o2 = await paidAssigned(partnerAId);
  const k = op();
  assert.equal((await partnerA.c.rpc("propose_status", { p_order: o1, p_stream: "main", p_to: "review", p_op: k })).data, "ok");
  assert.match(err(await partnerA.c.rpc("propose_status", { p_order: o2, p_stream: "main", p_to: "review", p_op: k })) ?? "", /Operation id reused/);
  assert.equal((await partnerA.c.rpc("propose_status", { p_order: o1, p_stream: "main", p_to: "review", p_op: k })).data, "already_done", "честный повтор остаётся повтором");
});

test("F-07 полнота анкеты: order_setup_complete; переключатель — только админ", { skip }, async () => {
  const o = await submitted();
  assert.equal((await adm.c.rpc("order_setup_complete", { p_order: o })).data, false, "пустая анкета");
  const { data: m1 } = await client.c.from("order_members").insert({ order_id: o, first_name: "Ann", last_name: "One", ownership_pct: 60, is_responsible: true }).select("id").single();
  const { data: m2 } = await client.c.from("order_members").insert({ order_id: o, first_name: "Bob", last_name: "Two", ownership_pct: 40, is_responsible: false }).select("id").single();
  assert.equal((await client.c.from("order_company").insert({ order_id: o, activity_category: "other", activity_other: "x", activity_description: "Consulting" })).error, null);
  assert.equal((await adm.c.rpc("order_setup_complete", { p_order: o })).data, false, "нет паспортов");
  await uploadPassport(o, m1.id);
  assert.equal((await adm.c.rpc("order_setup_complete", { p_order: o })).data, false, "паспорт только у одного владельца");
  await uploadPassport(o, m2.id);
  assert.equal((await adm.c.rpc("order_setup_complete", { p_order: o })).data, true, "владельцы 100%, компания, паспорта");
  assert.equal((await client.c.from("order_members").select("id").eq("order_id", o)).data.length, 2);
  assert.notEqual(err(await client.c.rpc("set_order_setup_enforcement", { p_on: true })), null);
  assert.notEqual(err(await partnerA.c.rpc("set_order_setup_enforcement", { p_on: true })), null);
});

test("F-10 пределы полей анкеты", { skip }, async () => {
  const bad = async (applicant, re, msg) => {
    const o = await newOrder("itin_standard", client, applicant);
    assert.match(err(await submit(o)) ?? "", re, msg);
  };
  await bad({ name: "a".repeat(201), country: "AM" }, /Field too long/, "имя 201");
  await bad({ name: "Ann", country: "x".repeat(101) }, /Field too long/, "страна 101");
  await bad({ name: "Ann", country: "AM<b>" }, /Invalid characters/, "HTML в стране");
  await bad({ name: "<script>", country: "AM" }, /Invalid characters/, "HTML в имени");
  const ok = await newOrder("itin_standard", client, { name: "a".repeat(200), country: "Armenia" });
  assert.equal(err(await submit(ok)), null, "ровно 200 символов допустимо");
});

test("F-15 файлы: в открытый свой заказ можно, в отменённый и чужой — нет", { skip }, async () => {
  const open = await submitted(), cancelled = await submitted();
  await cancel(cancelled);
  const up = (who, o) => who.c.storage.from("documents").upload(`${o}/${run}-${crypto.randomUUID()}.pdf`, pdf(), { contentType: "application/pdf" });
  assert.equal((await up(client, open)).error, null);
  assert.ok((await up(client, cancelled)).error, "в отменённый заказ загружать нельзя");
  assert.ok((await up(client2, open)).error, "в чужой заказ загружать нельзя");
});

test("F-16 админ-действия над отменённым заказом отклоняются", { skip }, async () => {
  const o = await submitted();
  await cancel(o);
  assert.match(err(await adm.c.rpc("set_service_years", { p_order: o, p_years: 3 })) ?? "", /Order cancelled/);
  assert.match(err(await adm.c.rpc("approve_company", { p_order: o })) ?? "", /Order cancelled/);
});

test("F-18 контакт консультации: без HTML и переводов строк, изменение попадает в журнал", { skip }, async () => {
  const o = await newOrder("itin_consult", client, { name: "Ann", country: "AM" });
  const contact = (v, t = "18:00") => client.c.rpc("record_consult_contact", { p_order: o, p_method: "telegram", p_value: v, p_preferred_time: t });
  assert.match(err(await contact("@a\nb")) ?? "", /Invalid contact value/);
  assert.match(err(await contact("<b>@a</b>")) ?? "", /Invalid contact value/);
  assert.match(err(await contact("@ok", "18:00\r\n<i>")) ?? "", /Invalid preferred time/);
  assert.equal(err(await contact("@valid_handle", "завтра после 18:00")), null);
  const rows = (await adm.c.from("audit_log").select("entity").eq("order_id", o).eq("entity", "order_contact")).data;
  assert.equal(rows.length, 1, "изменение контакта записано в журнал");
});

// ═══ ГОНКИ ═══════════════════════════════════════════════════════════════════════════════════════════

test("X1 параллельные confirm_status с РАЗНЫМИ op_id продвигают заказ ровно один раз", { skip }, async () => {
  const o = await paidAssigned(partnerAId);
  assert.equal(err(await partnerA.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "review", p_op: op() })), null);
  const res = await Promise.all([1, 2, 3].map(() => adm.c.rpc("confirm_status", { p_order: o, p_stream: "main", p_to: "review", p_op: op() })));
  assert.equal(res.filter((r) => r.data === "ok").length, 1, `ровно одно ok, сейчас: ${res.map((r) => r.data ?? r.error?.message)}`);
  assert.equal((await client.c.from("orders").select("status").eq("id", o).single()).data.status, "review");
});

test("X2 параллельные cancel_order и confirm_status: не зависают, состояние согласовано", { skip }, async () => {
  const o = await paidAssigned(partnerAId);
  await partnerA.c.rpc("propose_status", { p_order: o, p_stream: "main", p_to: "review", p_op: op() });
  const res = await Promise.all([
    adm.c.rpc("cancel_order", { p_order: o, p_reason: "клиент отказался", p_op: op() }),
    adm.c.rpc("confirm_status", { p_order: o, p_stream: "main", p_to: "review", p_op: op() }),
  ]);
  assert.ok(res.every((r) => r.data || r.error), "обе операции завершились");
  const row = (await adm.c.from("orders").select("status,cancelled_at,closed_at").eq("id", o).single()).data;
  assert.ok(["application", "review"].includes(row.status), `допустимо application|review, сейчас ${row.status}`);
  if (row.cancelled_at) assert.ok(row.closed_at, "отменённый заказ обязан быть закрыт");
});

test("X3 двойной клик «Оплачено»: второй вызов — ошибка, сумма записана один раз", { skip }, async () => {
  const o = await submitted();
  const res = await Promise.all([1, 2].map(() => adm.c.rpc("mark_order_paid_manually", { p_order: o, p_note: "qa", p_amount_cents: 34900 })));
  assert.equal(res.filter((r) => !r.error).length, 1, `ровно один успех: ${res.map((r) => r.error?.message ?? "ok")}`);
  assert.equal((await client.c.from("orders").select("amount_cents").eq("id", o).single()).data.amount_cents, 34900);
});

// ═══ ОСОЗНАННО НЕ ЧИНИЛОСЬ ═══════════════════════════════════════════════════════════════════════════

test("F-11 двойной клик «создать заказ» не создаёт два одинаковых черновика", { skip, todo: "РЕШЕНИЕ: принято как есть — черновики безвредны, защита на уровне интерфейса; уникальный индекс сломал бы «начать заново»" }, async () => {
  const count = async () => (await client.c.from("orders").select("id").eq("product", "bundle_de").eq("status", "draft")).data.length;
  const before = await count();
  const a = { name: "D", country: "AM", company: "D", activity: "IT" };
  await Promise.all([1, 2].map(() => client.c.from("orders").insert({ client_id: client.id, product: "bundle_de", status: "draft", applicant: a })));
  assert.ok((await count()) - before <= 1);
});
