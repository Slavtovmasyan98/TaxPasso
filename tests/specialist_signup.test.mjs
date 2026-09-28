// Тесты миграции 022: заявка специалиста через Partners → одобрение → назначение на консультацию.
// Запуск: node --test tests/specialist_signup.test.mjs (нужны ключи ТЕСТОВОЙ базы, как в security.test.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !URL || !ANON || !SERVICE ? "нет ключей тестовой базы" : false;
if (URL && /mhjxjxteorjwkvqbznfl/.test(URL)) throw new Error("Тесты нельзя запускать на рабочей базе");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = Date.now(), PASS = "Test-Passw0rd!";
let svc, adm, client;
const err = (r) => r.error?.message ?? null;

async function makeUser(tag, role) {
  const email = `qa22+${tag}-${run}@taxpasso.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw error;
  if (role) await svc.from("profiles").update({ role }).eq("id", data.user.id);
  const c = createClient(URL, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
const apply = (u, qualification) =>
  u.c.from("partner_applications").insert({ user_id: u.id, full_name: "QA Applicant", qualification }).select("id").single();

before(async () => {
  if (skip) return;
  svc = createClient(URL, SERVICE, opts);
  adm = await makeUser("admin", "admin");
  client = await makeUser("client");
});

test("заявка SPECIALIST принимается, неизвестная квалификация — нет", { skip }, async () => {
  const bad = await makeUser("bad");
  assert.notEqual(err(await apply(bad, "LAWYER")), null, "произвольная квалификация отклоняется");
  const spec = await makeUser("spec");
  const r = await apply(spec, "SPECIALIST");
  assert.equal(err(r), null, err(r));
});

test("одобрение делает специалиста партнёром SPECIALIST, он назначается только на консультацию", { skip }, async () => {
  const spec = await makeUser("spec2");
  const app = await apply(spec, "SPECIALIST");
  assert.equal(err(app), null);
  assert.equal(err(await adm.c.rpc("approve_partner_application", { p_app: app.data.id })), null);
  const partner = (await svc.from("partners").select("id,qualification").eq("profile_id", spec.id).single()).data;
  assert.equal(partner.qualification, "SPECIALIST");
  assert.equal((await svc.from("profiles").select("role").eq("id", spec.id).single()).data.role, "partner");

  const consult = (await client.c.from("orders").insert({ client_id: client.id, product: "itin_consult", status: "draft",
    applicant: { name: "QA", country: "AM" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("record_consult_contact", { p_order: consult, p_method: "telegram", p_value: "@qa22", p_preferred_time: "" })), null);
  assert.equal(err(await client.c.rpc("submit_order", { p_order: consult })), null);
  assert.equal(err(await adm.c.rpc("assign_partner", { p_order: consult, p_partner: partner.id })), null, "специалист назначается на консультацию");

  const llc = (await client.c.from("orders").insert({ client_id: client.id, product: "llc_wy", status: "draft",
    applicant: { name: "QA", country: "AM", company: "QA22 LLC", activity: "IT" } }).select("id").single()).data.id;
  assert.equal(err(await client.c.rpc("submit_order", { p_order: llc })), null);
  assert.match(err(await adm.c.rpc("assign_partner", { p_order: llc, p_partner: partner.id })) ?? "", /Invalid partner/, "но не на LLC");
});

test("клиент не может сам стать специалистом без одобрения администратора", { skip }, async () => {
  const self = await makeUser("self");
  assert.equal(err(await apply(self, "SPECIALIST")), null);
  const app = (await svc.from("partner_applications").select("id").eq("user_id", self.id).single()).data;
  assert.notEqual(err(await self.c.rpc("approve_partner_application", { p_app: app.id })), null, "одобряет только админ");
  assert.equal((await svc.from("partners").select("id").eq("profile_id", self.id)).data.length, 0);
});
