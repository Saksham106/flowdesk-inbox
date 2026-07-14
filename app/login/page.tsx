"use client";

import { signIn } from "next-auth/react";
import Logo from "@/app/components/landing/Logo";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { getAuthSuccessPath } from "@/lib/client-navigation";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <p className="text-sm text-[#6b6f76]">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

const inputClass =
  "w-full rounded-lg border border-black/10 bg-white px-3.5 py-2.5 text-sm text-[#1a1a1a] placeholder:text-[#a8a29e] outline-none transition focus:border-black/40 focus:ring-2 focus:ring-black/5";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3f4145]">{label}</span>
      {children}
    </label>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-[#e7c8c1] bg-[#f9efec] px-3.5 py-2.5 text-[13px] text-[#8a4a3d]">
      {children}
    </p>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("signup") ? "signup" : "signin"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const authError = searchParams.get("error");
  const [signInError, setSignInError] = useState<
    "invalid" | "unavailable" | null
  >(null);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);

  async function onSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSignInError(null);

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/home",
      redirect: false,
    });

    setIsSubmitting(false);

    if (result?.ok) {
      router.replace(getAuthSuccessPath(result.url));
      return;
    }

    // "CredentialsSignin" is NextAuth's code for a null return (bad email or
    // password); anything else means authorize threw (e.g. database down).
    setSignInError(result?.error === "CredentialsSignin" ? "invalid" : "unavailable");
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
        body: JSON.stringify({ email: signupEmail, password: signupPassword }),
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

      const result = await signIn("credentials", {
        email: signupEmail,
        password: signupPassword,
        // New accounts go through the onboarding wizard; sign-in stays /home.
        callbackUrl: "/onboarding",
        redirect: false,
      });

      if (result?.ok) {
        router.replace(getAuthSuccessPath(result.url));
        return;
      }

      setSignupError("Account created, but sign-in failed. Please sign in.");
    } catch {
      setSignupError("Something went wrong. Please try again.");
    } finally {
      setIsSigningUp(false);
    }
  }

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setSignupError(null);
    setSignInError(null);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-5 py-12">
      {/* The landing hero's scene, full bleed: aurora sky, lighthouse right. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/images/landing/hero-bg.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "70% 22%" }}
        />
        {/* Lighthouse beam — turns slowly behind the card; parked when motion is reduced. */}
        <div className="login-beam absolute" />
        {/* Veil keeps the form area calm without washing out the edges. */}
        <div className="login-veil absolute inset-0" />
      </div>

      <style>{`
        .login-beam {
          top: -32vh;
          left: 60%;
          width: 42vmin;
          height: 175vh;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 228, 168, 0.5) 45%,
            rgba(255, 228, 168, 0.5) 55%,
            transparent
          );
          clip-path: polygon(44% 0, 56% 0, 86% 100%, 14% 100%);
          -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.9), transparent 90%);
          mask-image: linear-gradient(180deg, rgba(0,0,0,0.9), transparent 90%);
          transform: rotate(14deg);
          transform-origin: 50% 0;
        }
        .login-veil {
          background: radial-gradient(
            ellipse 52% 70% at 50% 55%,
            rgba(255, 255, 255, 0.66),
            rgba(255, 255, 255, 0.2) 60%,
            transparent 82%
          );
        }
        @media (min-width: 1024px) {
          .login-veil {
            background: radial-gradient(
              ellipse 40% 78% at 37% 55%,
              rgba(255, 255, 255, 0.66),
              rgba(255, 255, 255, 0.2) 60%,
              transparent 82%
            );
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes login-enter {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .login-enter { animation: login-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
          @keyframes login-beam-sweep {
            0%, 100% { transform: rotate(2deg); }
            50% { transform: rotate(26deg); }
          }
          .login-beam { animation: login-beam-sweep 13s ease-in-out infinite; }
        }
      `}</style>

      <div className="login-enter relative z-10 w-full max-w-[400px] lg:mr-[26vw]">
        {/* Brand */}
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-black/[0.08] bg-white/85 p-8 shadow-[0_24px_64px_-32px_rgba(122,74,18,0.4)] backdrop-blur-md">
          <div className="mb-6 text-center">
            <h1 className="font-serif text-[26px] font-normal leading-tight text-[#1a1a1a]">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-1.5 text-sm text-[#6b6f76]">
              {mode === "signin"
                ? "Sign in to your FlowDesk inbox."
                : "Start putting your inbox on autopilot."}
            </p>
          </div>

          {/* Mode switch */}
          <div className="mb-6 flex rounded-lg bg-[#f5f5f4] p-1" role="tablist" aria-label="Sign in or create account">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                  mode === m
                    ? "bg-white text-black shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                    : "text-[#6b6f76] hover:text-black"
                }`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "signin" ? (
            <form onSubmit={onSignIn} className="flex flex-col gap-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </Field>

              {(authError || signInError) && (
                <ErrorNote>
                  {signInError === "unavailable" ||
                  (authError && authError !== "CredentialsSignin")
                    ? "Sign-in is temporarily unavailable. Please try again in a few minutes."
                    : "Invalid email or password."}
                </ErrorNote>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 w-full rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={onSignUp} className="flex flex-col gap-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClass}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={8}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className={inputClass}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </Field>

              {signupError && <ErrorNote>{signupError}</ErrorNote>}

              <button
                type="submit"
                disabled={isSigningUp}
                className="mt-1 w-full rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSigningUp ? "Creating account…" : "Create account"}
              </button>

              <p className="text-center text-xs leading-relaxed text-[#6b6f76]">
                By creating an account, you agree to the{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-black"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-black"
                >
                  Privacy Policy
                </a>
                .
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[13px] text-[#6b6f76]">
          {mode === "signin" ? "Don’t have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-black underline underline-offset-2"
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
