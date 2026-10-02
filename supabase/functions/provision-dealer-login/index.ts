// Create the auth login for a dealer being onboarded, and attach it to the
// onboarding record.
//
// Why this is an edge function and not a database function. auth.users is written
// through the Auth admin API, which needs the service role key. That key must
// never reach a browser, and it must never be a value the database can be asked
// for by anyone who can reach a public function. So the key lives in this
// function's environment, set as an edge function secret, and the browser holds
// nothing but a session.
//
// The authorisation decision is made in the database, not here. This function
// reads the caller's role from public.users with the service role client and
// refuses anyone who is not an active admin, and then calls
// public.admin_link_dealer_login, which re-reads the caller id out of public.users
// and refuses again. That function is granted to service_role alone and to nobody
// else, so a browser cannot name a caller id and have it believed.
//
// The consequence worth stating: this file is not a security boundary. A future
// edit that removed the check below would not let a non-admin through, because
// admin_link_dealer_login still refuses. The check here exists so a non-admin
// cannot create a stray auth user on the way to being refused, and so the refusal
// arrives before anything is written.
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
// Supabase's own floor is 6 characters. Longer is required here because this is a
// shared secret for a business account, and the screen is an admin typing on a
// new dealer's behalf rather than a person choosing their own.
const MIN_PASSWORD_LENGTH = 8;

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
    return json(401, { error: "Sign in to provision a dealer login." });
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

  // The check the migration comment means by "verifies the caller is an admin in
  // the database rather than in the edge runtime". It happens before anything is
  // written, so a non-admin cannot leave a stray auth user behind.
  const { data: callerProfile, error: profileError } = await admin
    .from("users")
    .select("id, role, is_active")
    .eq("id", callerId)
    .maybeSingle();

  if (profileError) {
    return json(500, { error: "Could not read your account." });
  }
  if (callerProfile?.role !== "admin" || callerProfile.is_active !== true) {
    return json(403, { error: "Only an admin can provision a dealer login." });
  }

  let payload: {
    dealer_id?: unknown;
    email?: unknown;
    password?: unknown;
    full_name?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "That request body was not readable JSON." });
  }

  const dealerId = typeof payload.dealer_id === "string" ? payload.dealer_id.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const fullName = typeof payload.full_name === "string" ? payload.full_name.trim() : "";

  if (!uuidPattern.test(dealerId)) {
    return json(400, { error: "A dealer id is required." });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "A login email address is required." });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(400, { error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  // The onboarding record is checked before the auth user is created, not after.
  // admin_link_dealer_login refuses a declined record and refuses one that already
  // has a login, and discovering that after creating an auth user would leave the
  // admin holding an account they cannot attach from the browser, which is the
  // exact state the idempotent path below exists to clean up.
  const { data: onboarding, error: onboardingError } = await admin
    .from("dealer_onboardings")
    .select("dealer_id, login_user_id, declined_at")
    .eq("dealer_id", dealerId)
    .maybeSingle();

  if (onboardingError) {
    return json(500, { error: "Could not read the onboarding record." });
  }
  if (!onboarding) {
    return json(404, { error: "No onboarding record for that dealer." });
  }
  if (onboarding.declined_at !== null) {
    return json(409, { error: "This onboarding has been declined, so there is nothing to attach a login to." });
  }
  if (onboarding.login_user_id !== null) {
    return json(409, { error: "This dealer already has a login." });
  }

  // Create the user, or find the one a previous attempt already made.
  //
  // The lookup is what makes the whole function retry safe. A network failure
  // between creating the auth user and linking it leaves an auth user with a
  // profile and no dealer, and an admin cannot repair that from the browser: the
  // only writer of users.dealer_id for a login is admin_link_dealer_login, which
  // is granted to service_role alone. So a retry that hits "email already
  // registered" looks the user up and links that one instead, and the retry
  // finishes the job rather than reporting a second failure.
  let userId: string | null = null;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The role is read by private.handle_new_user from raw_app_meta_data, which is
    // what writes the public.users row. Without it the profile is created as a
    // rep by the trigger's default and admin_link_dealer_login refuses it with
    // "A dealer login must carry the dealer role".
    app_metadata: { role: "dealer" },
    user_metadata: { full_name: fullName || email.split("@")[0] },
  });

  if (createError) {
    const alreadyRegistered = /already|registered|exists/i.test(createError.message);
    if (!alreadyRegistered) {
      // Never echoed verbatim to the browser beyond the message Supabase gave:
      // it can carry an email address, which is the admin's business, but it
      // cannot carry the key.
      return json(400, { error: createError.message });
    }

    const { data: listed, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listError) {
      return json(409, {
        error: "That email already has an account, and it could not be read back. Check the user directory.",
      });
    }
    const existing = listed.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (!existing) {
      return json(409, {
        error: "That email already has an account, and it is not one this onboarding can use.",
      });
    }
    userId = existing.id;
  } else {
    userId = created.user?.id ?? null;
  }

  if (!userId) {
    return json(500, { error: "The account was created but no id came back." });
  }

  // The one path from a created auth user to a linked dealer login. It re-checks
  // that the caller is an active admin, so the decision is made in the database
  // even though the key in this process is the one making the call.
  const { error: linkError } = await admin.rpc("admin_link_dealer_login", {
    p_caller_id: callerId,
    p_dealer_id: dealerId,
    p_user_id: userId,
  });

  if (linkError) {
    return json(409, { error: linkError.message });
  }

  return json(200, {
    ok: true,
    user_id: userId,
    email,
    // The password is not returned and was never stored here. It exists in the
    // admin's hands and in Auth's hash, and the onboarding record keeps only the
    // fact that a login was provisioned and when.
    message: "Login provisioned and attached to the onboarding record.",
  });
});
