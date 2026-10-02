// Create the auth login for a member of staff, and set its profile.
//
// Why this is an edge function and not a database function. auth.users is written
// through the Auth admin API, which needs the service role key. That key must
// never reach a browser, and it must never be a value the database can be asked
// for by anyone who can reach a public function. So the key lives in this
// function's environment, set as an edge function secret, and the browser holds
// nothing but a session.
//
// Where this differs from provision-dealer-login, and why. Three differences, all
// forced by the shape of the job rather than by taste:
//
//   * The profile is applied through the *caller's* client, not the service role
//     one. admin_upsert_user_profile authorises on private.current_user_role(),
//     which reads auth.uid(), and under the service role key auth.uid() is null,
//     so the call would be refused by the function it is supposed to be using.
//     Calling it with the admin's own token means the database still decides who
//     the actor is, from the JWT, and the guard is the one that was already there.
//     This is why no new service_role-only RPC was written for staff logins.
//
//   * An email that is already registered is refused rather than adopted. The
//     dealer path can adopt, because it knows exactly which account it means: a
//     fresh onboarding with no login yet, and the role it adopts is checked to be
//     dealer. Here there is no such anchor, and adopting would mean that an admin
//     who mistypes an email silently overwrites somebody's profile with a role of
//     their choosing. Refusing sends them to the user directory instead, which is
//     where changing an existing account already happens.
//
//   * The check for an existing email runs *before* the create, not after. If the
//     create succeeds and the profile call then fails, the account exists with the
//     role and name that were asked for, and a retry lands on the same refusal. So
//     the retry path tells the admin to finish on the user directory, which can
//     apply the reporting line, and the stranded state is repairable from the
//     browser. A half-made staff login is a nuisance; a hijacked one is not.
//
// The authorisation decision is still made in the database, not here. This file
// reads the caller's role with the service role client and refuses anyone who is
// not an active admin before writing anything, so a non-admin cannot leave a stray
// auth user behind on the way to being refused.
//
// Deployment. This project cannot be driven by the Supabase CLI (see README,
// "Migration history"), so this is deployed from the dashboard or by
// `supabase functions deploy` against a project that accepts it. It needs one
// secret, which is supplied at deploy time and never committed:
//
//   SUPABASE_SERVICE_ROLE_KEY   the service role key, as an edge function secret
//
// The service role key is deliberately not in .env.example, not in this file, and
// not in any migration. If it ever reaches the repository, every row in the
// database is exposed and rotating it is the only remedy.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

// The publishable key is enough to verify a bearer token, so the caller is
// identified without the service role key being involved in reading their
// identity. It is a public value by design; the service role key is not.
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Supabase's own floor is 6 characters. Longer is required here for the reason
// provision-dealer-login gives: this is an admin typing a shared secret on behalf
// of a colleague, not a person choosing their own password, and a business login
// is worth the extra two characters.
const MIN_PASSWORD_LENGTH = 8;

// A message shim, not a second copy of the rule. public.user_role is the authority
// and the argument to admin_upsert_user_profile is typed as the enum, so an unknown
// role is refused by the database whatever this list says. Without the list the
// admin would read "invalid input value for enum user_role: ceo", which does not
// tell them that a post is not a permission.
const STAFF_ROLES = [
  "admin",
  "production_manager",
  "inventory_manager",
  "qc_staff",
  "sales_director",
  "sales_manager",
  "sales_rep",
  "logistics",
  "finance",
];

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  if (!SERVICE_ROLE_KEY || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    // Deliberately not naming which one. This function is not deployed properly
    // and the operator needs to know that, not what to fix.
    return json(500, { error: "This function is not configured. Check its environment settings." });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    return json(401, { error: "Sign in to provision a staff login." });
  }

  // Verify the JWT with the publishable client. A self asserted role claim in a
  // decoded token would be worthless, so the token is checked against Auth rather
  // than decoded here.
  const callerClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData?.user) {
    return json(401, { error: "Your session has expired. Sign in again." });
  }
  const callerId = callerData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Before anything is written, so a non-admin cannot leave a stray auth user.
  const { data: callerProfile, error: profileError } = await admin
    .from("users")
    .select("id, role, is_active")
    .eq("id", callerId)
    .maybeSingle();

  if (profileError) {
    return json(500, { error: "Could not read your account." });
  }
  if (callerProfile?.role !== "admin" || callerProfile.is_active !== true) {
    return json(403, { error: "Only an admin can provision a staff login." });
  }

  let payload: {
    full_name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
    manager_id?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "That request body was not readable JSON." });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const fullName = typeof payload.full_name === "string" ? payload.full_name.trim() : "";
  const role = typeof payload.role === "string" ? payload.role.trim() : "";
  const managerId =
    typeof payload.manager_id === "string" && payload.manager_id.trim() !== ""
      ? payload.manager_id.trim()
      : null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "A login email address is required." });
  }
  if (fullName === "") {
    return json(400, { error: "A name is required. It is what the org chart will show." });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(400, { error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (!STAFF_ROLES.includes(role)) {
    return json(400, {
      error:
        role === "dealer"
          ? "A dealer login is created from dealer onboarding, not from the staff list."
          : "Choose a role for this account.",
    });
  }
  if (managerId !== null && !uuidPattern.test(managerId)) {
    return json(400, { error: "The reporting line needs a user id." });
  }

  // The reporting line is checked before the create, for the same reason the dealer
  // path checks its onboarding record: a rep with no manager is refused by
  // admin_upsert_user_profile, and discovering that afterwards would leave an
  // account the admin cannot repair from this screen.
  //
  // Which manager a role may name is not restated here. It is the rule in
  // admin_upsert_user_profile, and the screen derives the same picker from it, so
  // this path only has to make sure the id is a real one.
  if (managerId !== null) {
    const { data: manager, error: managerError } = await admin
      .from("users")
      .select("id, role, is_active")
      .eq("id", managerId)
      .maybeSingle();

    if (managerError) {
      return json(500, { error: "Could not read the reporting line." });
    }
    if (!manager || manager.is_active !== true) {
      return json(400, { error: "That reporting line is not an active account." });
    }
  }

  // The email is looked for before the create, and the answer is always a refusal.
  // Two reasons, and the second is the one that matters. First, a retry after a
  // failed profile call lands here instead of creating a second account. Second,
  // adopting an existing account would let a mistyped email overwrite a colleague's
  // profile, and a colleague who happens to be a dealer login would find their
  // account quietly turned into a staff account. A refusal costs one extra step on
  // the user directory, which is already where an existing account is changed.
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) {
    return json(500, { error: "Could not read the user list." });
  }
  if (listed.users.some((candidate) => candidate.email?.toLowerCase() === email)) {
    return json(409, {
      error:
        "That email already has an account. Open the user directory to change its role or reporting line instead of creating it again.",
    });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The role is read by private.handle_new_user from raw_app_meta_data, which is
    // what writes the public.users row. Without it the profile is created as a rep
    // by the trigger's default, and a rep is the one role whose profile cannot
    // stand on its own: admin_upsert_user_profile refuses it without a manager.
    app_metadata: { role },
    user_metadata: { full_name: fullName },
  });

  if (createError) {
    // Never echoed verbatim beyond the message Supabase gave, and the one thing it
    // can carry is the email, which is the admin's own business. It cannot carry the
    // key. The already-registered case is handled above, so anything arriving here
    // is a real failure rather than the retry.
    return json(400, { error: createError.message });
  }

  const userId = created.user?.id ?? null;
  if (!userId) {
    return json(500, { error: "The account was created but no id came back." });
  }

  // The profile call, made as the admin rather than as the service role, so the
  // database authorises it on the JWT and applies the same guards it applies to the
  // user directory form: an admin may not edit their own role, the last active
  // admin may not be demoted, and an account that active accounts still report to
  // may not be demoted or suspended. All three apply to a new login too, so the
  // guards are not a second version of this function's checks.
  const { error: profileWriteError } = await callerClient.rpc("admin_upsert_user_profile", {
    p_user_id: userId,
    p_full_name: fullName,
    p_role: role,
    p_is_active: true,
    p_dealer_id: null,
    p_manager_id: managerId,
  });

  if (profileWriteError) {
    return json(409, {
      error: `${profileWriteError.message} The login exists with the name and role you entered; finish it on the user directory.`,
    });
  }

  return json(200, {
    ok: true,
    user_id: userId,
    email,
    // The password is not returned and was never stored here. It exists in the
    // admin's hands and in Auth's hash, and nothing in this database records it.
    message: "Staff login created.",
  });
});
