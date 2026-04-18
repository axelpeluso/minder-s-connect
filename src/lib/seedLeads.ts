import { supabase } from "./supabase";

const FAKE_LEADS = [
  { full_name: "Sofia Martinez", email: "sofia.martinez@gmail.com", phone: "+1 305 555 0142", preferred_language: "es", lead_score: 88, intent: "buy_kit", nail_shape: "almond", color_family: "nude", finish: "gloss", experience_level: "intermediate", occasion: "wedding", urgency_days: 7, budget_range: "20-40", lead_status: "new" },
  { full_name: "Isabella Chen", email: "bella.chen@outlook.com", phone: "+1 305 555 0188", preferred_language: "en", lead_score: 72, intent: "browse", nail_shape: "coffin", color_family: "pink", finish: "matte", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "20-40", lead_status: "contacted" },
  { full_name: "Camila Rodriguez", email: "camila.r@yahoo.com", phone: "+1 786 555 0211", preferred_language: "es", lead_score: 95, intent: "buy_kit", nail_shape: "square", color_family: "red", finish: "gloss", experience_level: "advanced", occasion: "date_night", urgency_days: 2, budget_range: "40+", lead_status: "in_progress" },
  { full_name: "Emma Thompson", email: "emma.t@gmail.com", phone: "+1 305 555 0309", preferred_language: "en", lead_score: 45, intent: "info", nail_shape: "oval", color_family: "neutral", finish: "satin", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "0-20", lead_status: "new" },
  { full_name: "Valentina Lopez", email: "vale.lopez@hotmail.com", phone: "+1 786 555 0144", preferred_language: "es", lead_score: 81, intent: "buy_refill", nail_shape: "almond", color_family: "pink", finish: "gloss", experience_level: "intermediate", occasion: "vacation", urgency_days: 5, budget_range: "20-40", lead_status: "contacted" },
  { full_name: "Olivia Bennett", email: "olivia.bennett@gmail.com", phone: "+1 305 555 0277", preferred_language: "en", lead_score: 67, intent: "buy_kit", nail_shape: "coffin", color_family: "burgundy", finish: "gloss", experience_level: "advanced", occasion: "wedding", urgency_days: 14, budget_range: "40+", lead_status: "in_progress" },
  { full_name: "Daniela Garcia", email: "dani.garcia@gmail.com", phone: "+1 786 555 0455", preferred_language: "es", lead_score: 38, intent: "browse", nail_shape: "square", color_family: "nude", finish: "matte", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "0-20", lead_status: "new" },
  { full_name: "Mia Patel", email: "mia.patel@gmail.com", phone: "+1 305 555 0612", preferred_language: "en", lead_score: 91, intent: "buy_kit", nail_shape: "almond", color_family: "red", finish: "gloss", experience_level: "intermediate", occasion: "party", urgency_days: 3, budget_range: "40+", lead_status: "contacted" },
  { full_name: "Lucia Fernandez", email: "lucia.f@outlook.com", phone: "+1 786 555 0721", preferred_language: "es", lead_score: 59, intent: "info", nail_shape: "oval", color_family: "pink", finish: "satin", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "20-40", lead_status: "new" },
  { full_name: "Ava Williams", email: "ava.williams@gmail.com", phone: "+1 305 555 0833", preferred_language: "en", lead_score: 76, intent: "buy_refill", nail_shape: "coffin", color_family: "neutral", finish: "matte", experience_level: "advanced", occasion: "everyday", urgency_days: 10, budget_range: "20-40", lead_status: "done" },
  { full_name: "Gabriela Silva", email: "gabi.silva@gmail.com", phone: "+1 786 555 0944", preferred_language: "pt", lead_score: 84, intent: "buy_kit", nail_shape: "almond", color_family: "burgundy", finish: "gloss", experience_level: "intermediate", occasion: "wedding", urgency_days: 6, budget_range: "40+", lead_status: "in_progress" },
  { full_name: "Charlotte Davis", email: "charlotte.d@yahoo.com", phone: "+1 305 555 0156", preferred_language: "en", lead_score: 52, intent: "browse", nail_shape: "square", color_family: "nude", finish: "satin", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "0-20", lead_status: "new" },
  { full_name: "Renata Morales", email: "renata.m@gmail.com", phone: "+1 786 555 0289", preferred_language: "es", lead_score: 89, intent: "buy_kit", nail_shape: "coffin", color_family: "red", finish: "gloss", experience_level: "advanced", occasion: "date_night", urgency_days: 4, budget_range: "40+", lead_status: "contacted" },
  { full_name: "Amelia Brooks", email: "amelia.brooks@gmail.com", phone: "+1 305 555 0398", preferred_language: "en", lead_score: 41, intent: "info", nail_shape: "oval", color_family: "pink", finish: "matte", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "0-20", lead_status: "new" },
  { full_name: "Natalia Vega", email: "natalia.vega@hotmail.com", phone: "+1 786 555 0417", preferred_language: "es", lead_score: 73, intent: "buy_refill", nail_shape: "almond", color_family: "burgundy", finish: "gloss", experience_level: "intermediate", occasion: "vacation", urgency_days: 8, budget_range: "20-40", lead_status: "done" },
  { full_name: "Harper Reed", email: "harper.reed@gmail.com", phone: "+1 305 555 0526", preferred_language: "en", lead_score: 64, intent: "buy_kit", nail_shape: "square", color_family: "neutral", finish: "satin", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "20-40", lead_status: "in_progress" },
  { full_name: "Ximena Castro", email: "ximena.c@gmail.com", phone: "+1 786 555 0635", preferred_language: "es", lead_score: 92, intent: "buy_kit", nail_shape: "coffin", color_family: "red", finish: "gloss", experience_level: "advanced", occasion: "wedding", urgency_days: 1, budget_range: "40+", lead_status: "contacted" },
  { full_name: "Ella Nguyen", email: "ella.nguyen@gmail.com", phone: "+1 305 555 0744", preferred_language: "en", lead_score: 58, intent: "browse", nail_shape: "oval", color_family: "pink", finish: "matte", experience_level: "beginner", occasion: "everyday", urgency_days: null, budget_range: "20-40", lead_status: "new" },
  { full_name: "Paola Jimenez", email: "paola.j@outlook.com", phone: "+1 786 555 0853", preferred_language: "es", lead_score: 78, intent: "buy_refill", nail_shape: "almond", color_family: "nude", finish: "gloss", experience_level: "intermediate", occasion: "everyday", urgency_days: 12, budget_range: "20-40", lead_status: "in_progress" },
  { full_name: "Zoe Mitchell", email: "zoe.mitchell@gmail.com", phone: "+1 305 555 0962", preferred_language: "en", lead_score: 86, intent: "buy_kit", nail_shape: "coffin", color_family: "burgundy", finish: "gloss", experience_level: "advanced", occasion: "party", urgency_days: 5, budget_range: "40+", lead_status: "contacted" },
];

const SEED_FLAG = "minders.leads.seeded.v1";

export async function seedLeadsIfEmpty() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SEED_FLAG)) return;

  // Check if any seeded customers already exist
  const { data: existing } = await supabase
    .from("customers")
    .select("id, metadata")
    .limit(50);
  const alreadySeeded = (existing ?? []).some(
    (c: { metadata: Record<string, unknown> | null }) =>
      c.metadata && (c.metadata as Record<string, unknown>).seeded === true,
  );
  if (alreadySeeded) {
    localStorage.setItem(SEED_FLAG, "1");
    return;
  }

  const rows = FAKE_LEADS.map((l) => {
    const { full_name, lead_status, ...rest } = l;
    return {
      ...rest,
      metadata: { full_name, lead_status, seeded: true },
    };
  });

  const { error } = await supabase.from("customers").insert(rows);
  if (!error) {
    localStorage.setItem(SEED_FLAG, "1");
  } else {
    // Don't block the app on seed failures (RLS, etc.)
    console.warn("[seedLeads] insert failed:", error.message);
  }
}
