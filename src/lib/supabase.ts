import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const demoMode = !supabase;
export type Order = {
  id: string;
  product: string;
  status: string;
  itin_status?: string;
  created_at: string;
  applicant: Record<string, string>;
  eligibility: string;
  partner_id?: string;
  order_status_history?: {
    status: string;
    created_at: string;
    expected_by: string | null;
  }[];
};
export async function uploadDocument(orderId: string, file: File) {
  if (!supabase) throw Error("Demo");
  if (
    file.size > 10 * 1024 * 1024 ||
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
  )
    throw Error("PDF, JPG, PNG ≤ 10 MB");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw Error("Sign in");
  const path = `${orderId}/${crypto.randomUUID()}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`;
  const { error } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { error: dbError } = await supabase
    .from("documents")
    .insert({
      order_id: orderId,
      uploaded_by: user.id,
      path,
      name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    });
  if (dbError) {
    await supabase.storage.from("documents").remove([path]);
    throw dbError;
  }
}
export async function documentUrl(path: string) {
  if (!supabase) throw Error("Demo");
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
