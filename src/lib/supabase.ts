import { createClient } from "@supabase/supabase-js";
import {
  DEMO_MODE,
  CONFIG_ERROR,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  LEGAL_VERSIONS,
} from "./config";
export const supabase =
  DEMO_MODE || CONFIG_ERROR
    ? null
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const demoMode = DEMO_MODE;
export type DocumentKind =
  | "passport"
  | "selfie"
  | "tax_return"
  | "exception_evidence"
  | "llc_agreement"
  | "articles"
  | "ein_letter"
  | "itin_letter"
  | "other";
export type Order = {
  id: string;
  product: string;
  status: string;
  itin_status?: string;
  created_at: string;
  applicant: Record<string, string>;
  eligibility: string;
  eligibility_note?: string | null;
  payment_status?: "unpaid" | "paid" | "refunded";
  payment_note?: string | null;
  payment_marked_manually?: boolean;
  partner_id?: string;
  order_status_history?: {
    status: string;
    created_at: string;
    expected_by: string | null;
  }[];
};
export async function uploadDocument(
  orderId: string,
  file: File,
  kind: DocumentKind = "other",
  memberId?: string,
) {
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
      kind,
      ...(memberId ? { member_id: memberId } : {}),
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

// Сохраняет согласие клиента с текущими версиями Terms и Refund Policy.
export async function recordConsent(orderId: string) {
  if (!supabase) throw Error("Demo");
  const { error } = await supabase.rpc("record_consent", {
    p_order: orderId,
    p_terms_version: LEGAL_VERSIONS.terms,
    p_refund_version: LEGAL_VERSIONS.refund,
    p_user_agent: navigator.userAgent.slice(0, 500),
  });
  if (error) throw error;
}
