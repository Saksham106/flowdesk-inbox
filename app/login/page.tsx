"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  // Sign-in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const authError = searchParams.get("error");

  // Sign-up state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);

  async function onSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    await signIn("credentials", {
      email,
      password,
      callbackUrl: "/inbox",
    });

    setIsSubmitting(false);
  }

  async function onSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignupError(null);

    if (signupPassword.length < 8) {
      setSignupError("Password must be at least 8 characters.");
      return;
    }
    if (signupPassword !== confirmPassword) {
      setSignupError("Passwords do not match.");
      return;
    }

    setIsSigningUp(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signupEmail, password: signupPassword, accountType }),
      });

      if (res.status === 409) {
        setSignupError("An account with this email already exists.");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSignupError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      await signIn("credentials", {
        email: signupEmail,
        password: signupPassword,
        callbackUrl: "/inbox",
      });
    } catch {
      setSignupError("Something went wrong. Please try again.");
    } finally {
      setIsSigningUp(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">flowdesk</h1>
        <p className="mt-2 text-sm text-slate-500">
          {mode === "signin" ? "Your AI email agent" : "Create your account"}
        </p>

        {mode === "signin" ? (
          <form className="mt-6 space-y-4" onSubmit={onSignIn}>
            <label className="block text-sm font-medium text-slate-600">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            {authError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Invalid credentials.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
            <p className="text-center text-xs text-slate-500">
              No account?{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-medium text-slate-700 underline hover:text-slate-900"
              >
                Create one
              </button>
            </p>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSignUp}>
            <label className="block text-sm font-medium text-slate-600">
              Email
              <input
                type="email"
                required
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              Password
              <input
                type="password"
                required
                minLength={8}
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              Confirm Password
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </label>

            {/* Account type selector */}
            <div>
              <p className="mb-2 text-sm font-medium text-slate-600">Account type</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAccountType("personal")}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    accountType === "personal"
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800">Personal</p>
                  <p className="mt-1 text-xs text-slate-500">
                    For managing your own inbox and drafting personal replies
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("business")}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    accountType === "business"
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800">Business</p>
                  <p className="mt-1 text-xs text-slate-500">
                    For a business with team members, policies, and appointment booking
                  </p>
                </button>
              </div>
            </div>

            {signupError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {signupError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSigningUp}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSigningUp ? "Creating account..." : "Create account"}
            </button>
            <p className="text-center text-xs text-slate-500">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setSignupError(null); }}
                className="font-medium text-slate-700 underline hover:text-slate-900"
              >
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
