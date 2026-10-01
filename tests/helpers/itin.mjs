// Общий помощник тестов (миграция 024): клиент загружает паспорт и отправляет полную анкету ITIN (W-7).
export const W7 = {
  reason: "b", first_name: "Anna", last_name: "Petrosyan", dob: "1990-05-17",
  birth_country: "AM", birth_city: "Yerevan", gender: "female", citizenship: "AM",
  home_street: "1 Abovyan St", home_city: "Yerevan", home_postal: "0001", home_country: "AM", mail_same: "yes",
  passport_country: "AM", passport_number: "AN1234567", passport_expiry: "2033-01-31",
};

export async function uploadPassport(user, order) {
  const path = `${order}/${crypto.randomUUID()}.pdf`;
  const up = await user.c.storage.from("documents").upload(path, new Blob(["%PDF-1.4 passport"], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up.error) throw up.error;
  const { data, error } = await user.c.from("documents").insert({
    order_id: order, uploaded_by: user.id, path, name: "passport.pdf", mime_type: "application/pdf", size_bytes: 17, kind: "passport",
  }).select("id").single();
  if (error) throw error;
  return { path, id: data.id };
}

export async function submitItinApplication(user, order, data = W7) {
  await uploadPassport(user, order);
  const { data: res, error } = await user.c.rpc("submit_itin_application", { p_order: order, p_data: data });
  if (error) throw new Error("submit_itin_application: " + error.message + " " + (error.details || ""));
  return res;
}
