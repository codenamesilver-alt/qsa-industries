import Link from "next/link";
import { getProfile, roleLabel } from "../../lib/auth";
import { homeForRole, portalConfig, portalForRole } from "../../lib/portal-config";

// Where requireProfile sends a signed-in user whose role is not allowed on the
// page they asked for. It states the reason and returns them to their own
// workspace, instead of dropping them on the public homepage.
export default async function UnauthorizedPage() {
  const profile = await getProfile();
  const home = profile ? homeForRole(profile.role) : "/login";
  const portal = profile ? portalForRole(profile.role) : null;

  return (
    <main className="min-h-screen bg-[#f5f7f2] px-5 py-8 text-[#15221b] sm:px-8">
      <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col justify-center">
        <Link className="inline-flex items-center gap-3 text-sm font-bold tracking-[0.18em]" href="/">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f35b] text-xl">
            Q
          </span>
          QSA INDUSTRIES
        </Link>

        <p className="mt-20 text-xs font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">
          Restricted area
        </p>
        <h1 className="mt-5 text-5xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">
          That page is outside your role.
        </h1>

        {profile ? (
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5d6b60]">
            You are signed in as <span className="font-semibold text-[#15221b]">{profile.full_name}</span> with
            the {roleLabel(profile.role)} role. That role does not have access to the page you requested, so
            access was stopped here. Nothing is wrong with your account.
          </p>
        ) : (
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5d6b60]">
            Sign in with a provisioned account to reach the workspace your role allows.
          </p>
        )}

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            className="rounded-2xl bg-[#15221b] px-6 py-3 text-sm font-bold text-[#d8f35b] transition hover:bg-[#263a2d]"
            href={home}
          >
            {profile && portal ? `Back to ${portalConfig[portal].title}` : "Go to sign in"}
          </Link>
          <Link className="text-sm font-semibold text-[#4f6254] hover:text-[#15221b]" href="/login">
            Choose another portal
          </Link>
        </div>
      </div>
    </main>
  );
}
