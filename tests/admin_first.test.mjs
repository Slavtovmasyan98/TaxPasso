// Тест миграции 015: партнёр не решает по документам клиента и не меняет анкету клиента.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, client, adm, partner, partnerId;
const op = () => crypto.randomUUID();

async function makeUser(tag, role) {
  const email = `qa15+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  client = await makeUser("client"); adm = await makeUser("admin", "admin"); partner = await makeUser("partner", "partner");
  partnerId = (await svc.from("partners").insert({ profile_id: partner.id, display_name: "CAA", qualification: "CAA" }).select("id").single()).data.id;
});

test("админ первый: документы клиента и анкета — только через админа", { skip }, async () => {
  const { data: o } = await client.c.from("orders").insert({
    client_id: client.id, product: "llc_wy", status: "draft",
    applicant: { name: "QA", country: "AM", company: "QA LLC", activity: "IT" },
  }).select("id").single();
  const { data: m } = await client.c.from("order_members").insert({
    order_id: o.id, first_name: "Ann", last_name: "Client", ownership_pct: 100, is_responsible: true,
  }).select("id").single();
  const path = `${o.id}/${run}-pass.pdf`;
  assert.equal((await client.c.storage.from("documents").upload(path, new Blob(["%PDF"], { type: "application/pdf" }), { contentType: "application/pdf" })).error, null);
  const { data: d } = await client.c.from("documents").insert({
    order_id: o.id, uploaded_by: client.id, path, name: "pass.pdf", mime_type: "application/pdf", size_bytes: 4, kind: "passport",
  }).select("id").single();
  assert.equal((await client.c.rpc("submit_order", { p_order: o.id })).error, null);
  assert.equal((await adm.c.rpc("assign_partner", { p_order: o.id, p_partner: partnerId })).error, null);

  assert.ok((await partner.c.rpc("review_document", { p_document: d.id, p_status: "rejected", p_comment: "размыто" })).error);
  const upd = await partner.c.from("order_members").update({ first_name: "Hacked" }).eq("id", m.id).select("id");
  assert.ok(upd.error || upd.data.length === 0, "партнёр не меняет анкету");

  assert.equal((await partner.c.rpc("propose_document_review", { p_document: d.id, p_status: "rejected", p_comment: "Фото размыто", p_op: op() })).data, "ok");
  assert.equal((await client.c.from("documents").select("review_status").eq("id", d.id).single()).data.review_status, "pending");
  assert.equal((await adm.c.rpc("confirm_document_review", { p_document: d.id, p_op: op() })).data, "ok");
  const after = (await client.c.from("documents").select("review_status,review_comment").eq("id", d.id).single()).data;
  assert.deepEqual([after.review_status, after.review_comment], ["rejected", "Фото размыто"]);
});
