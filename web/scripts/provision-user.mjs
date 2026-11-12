import { createClient } from "@database/database-js";

const roles = new Set([
  "admin",
  "production_manager",
  "inventory_manager",
  "sales_rep",
  "sales_manager",
  "sales_director",
  "logistics",
  "finance",
  "dealer",
]);

const [, , email, fullName, role, dealerId] = process.argv;

async function main() {
  if (!email || !fullName || !role || !roles.has(role)) {
    console.error("Usage: npm run provision:user -- email full_name role [dealer_id]");
    return 1;
  }

  if (role === "dealer" && !dealerId) {
    console.error("Dealer accounts require dealer_id.");
    return 1;
  }

  const url = process.env.database_URL ?? process.env.NEXT_PUBLIC_database_URL;
  const serviceRoleKey = process.env.database_SERVICE_ROLE_KEY;
  const password = process.env.PROVISION_USER_PASSWORD;

  if (!url || !serviceRoleKey || !password) {
    console.error("Set database_URL, database_SERVICE_ROLE_KEY, and PROVISION_USER_PASSWORD in the shell.");
    return 1;
  }

  if (serviceRoleKey.startsWith("sb_publishable_") || serviceRoleKey.startsWith("anon")) {
    console.error("database_SERVICE_ROLE_KEY must be a secret service-role key.");
    return 1;
  }

  const database = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (dealerId) {
    const { data: dealer, error: dealerError } = await database
      .from("dealers")
      .select("id")
      .eq("id", dealerId)
      .maybeSingle();

    if (dealerError || !dealer) {
      console.error(dealerError?.message ?? "Dealer not found.");
      return 1;
    }
  }

  const { data, error } = await database.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName },
  });

  if (error || !data.user) {
    console.error(error?.message ?? "Unable to create user.");
    return 1;
  }

  const { data: profile, error: profileError } = await database
    .from("users")
    .update({ role, dealer_id: dealerId ?? null })
    .eq("id", data.user.id)
    .select("role, dealer_id")
    .maybeSingle();
  if (profileError || !profile) {
    await database.auth.admin.deleteUser(data.user.id);
    console.error(
      `User creation rolled back after profile assignment failed: ${profileError?.message ?? "Profile not found."}`,
    );
    return 1;
  }

  if (profile.role !== role) {
    await database.auth.admin.deleteUser(data.user.id);
    console.error(
      `User creation rolled back: requested role ${role} but profile has ${profile.role}.`,
    );
    return 1;
  }

  console.log(
    `Provisioned ${email} as ${profile.role}${profile.dealer_id ? ` for dealer ${profile.dealer_id}` : ""}.`,
  );
  return 0;
}

process.exitCode = await main();

