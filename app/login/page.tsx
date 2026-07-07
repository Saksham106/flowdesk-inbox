"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { getAuthSuccessPath } from "@/lib/client-navigation";

export const dynamic = "force-dynamic";

// Ghostly email-card fragments drifting in the periphery
const FRAGMENTS = [
  { id: 0,  x: 3,   y: 8,   w: 88,  h: 58, anim: "fd-ne", delay: 0,  dur: 30 },
  { id: 1,  x: 83,  y: 16,  w: 66,  h: 44, anim: "fd-sw", delay: 5,  dur: 25 },
  { id: 2,  x: 6,   y: 68,  w: 92,  h: 62, anim: "fd-ne", delay: 9,  dur: 34 },
  { id: 3,  x: 86,  y: 60,  w: 54,  h: 36, anim: "fd-nw", delay: 12, dur: 27 },
  { id: 4,  x: 16,  y: 84,  w: 78,  h: 52, anim: "fd-ne", delay: 15, dur: 31 },
  { id: 5,  x: 73,  y: 78,  w: 60,  h: 40, anim: "fd-se", delay: 18, dur: 23 },
  { id: 6,  x: 1,   y: 36,  w: 82,  h: 55, anim: "fd-se", delay: 21, dur: 36 },
  { id: 7,  x: 87,  y: 30,  w: 70,  h: 46, anim: "fd-sw", delay: 24, dur: 28 },
  { id: 8,  x: 40,  y: 2,   w: 86,  h: 58, anim: "fd-sw", delay: 7,  dur: 32 },
  { id: 9,  x: 54,  y: 88,  w: 68,  h: 46, anim: "fd-nw", delay: 13, dur: 29 },
  { id: 10, x: 26,  y: 3,   w: 56,  h: 38, anim: "fd-se", delay: 17, dur: 26 },
  { id: 11, x: 68,  y: 5,   w: 74,  h: 50, anim: "fd-sw", delay: 3,  dur: 33 },
];

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: "#09090b", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#94a3b8", fontSize: "13px" }}>Loading…</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
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
  const [signInError, setSignInError] = useState(false);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);

  async function onSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSignInError(false);

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/inbox",
      redirect: false,
    });

    setIsSubmitting(false);

    if (result?.ok) {
      router.replace(getAuthSuccessPath(result.url));
      return;
    }

    setSignInError(true);
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
        callbackUrl: "/inbox",
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

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "11px",
    fontWeight: "600",
    color: "#9ca3af",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#09090b",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      {/* ── Styles ── */}
      <style suppressHydrationWarning>{`
        /* Fragment drift directions */
        @keyframes fd-ne {
          0%   { opacity: 0; transform: translate(0, 0) rotate(-5deg); }
          12%  { opacity: 0.7; }
          88%  { opacity: 0.7; }
          100% { opacity: 0; transform: translate(26px, -30px) rotate(-1deg); }
        }
        @keyframes fd-nw {
          0%   { opacity: 0; transform: translate(0, 0) rotate(7deg); }
          12%  { opacity: 0.7; }
          88%  { opacity: 0.7; }
          100% { opacity: 0; transform: translate(-22px, -26px) rotate(11deg); }
        }
        @keyframes fd-se {
          0%   { opacity: 0; transform: translate(0, 0) rotate(4deg); }
          12%  { opacity: 0.7; }
          88%  { opacity: 0.7; }
          100% { opacity: 0; transform: translate(20px, 28px) rotate(0deg); }
        }
        @keyframes fd-sw {
          0%   { opacity: 0; transform: translate(0, 0) rotate(-11deg); }
          12%  { opacity: 0.7; }
          88%  { opacity: 0.7; }
          100% { opacity: 0; transform: translate(-24px, 22px) rotate(-7deg); }
        }
        /* Card entrance */
        @keyframes fd-enter {
          from { opacity: 0; transform: translateY(14px) scale(0.997); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* One-shot shimmer across card */
        @keyframes fd-shimmer {
          from { transform: translateX(-100%); }
          to   { transform: translateX(300%); }
        }
        /* Orb drift animations */
        @keyframes orb-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%       { transform: translate(60px, -40px) scale(1.06); }
          66%       { transform: translate(-30px, 30px) scale(0.97); }
        }
        @keyframes orb-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40%       { transform: translate(-70px, 40px) scale(1.04); }
          75%       { transform: translate(40px, -25px) scale(0.96); }
        }
        /* Shared input styles */
        .fd-input {
          width: 100%;
          background: #fafafa;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
          color: #111827;
          outline: none;
          margin-top: 7px;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
          font-family: inherit;
        }
        .fd-input:focus {
          background: #ffffff;
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
        }
        .fd-input::placeholder { color: #b8bec8; }
        /* Submit button */
        .fd-submit {
          width: 100%;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          background: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%);
          color: #ffffff;
          border: none;
          cursor: pointer;
          margin-top: 6px;
          transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s;
          letter-spacing: 0.025em;
          box-shadow: 0 2px 12px rgba(99,102,241,0.35);
          font-family: inherit;
        }
        .fd-submit:not(:disabled):hover {
          opacity: 0.9;
          transform: translateY(-1.5px);
          box-shadow: 0 8px 24px rgba(99,102,241,0.4);
        }
        .fd-submit:not(:disabled):active { transform: translateY(0); }
        .fd-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        /* Tab */
        .fd-tab { transition: all 0.22s ease; }
        .fd-tab:not([data-active="true"]):hover {
          color: #374151 !important;
          background: rgba(17,24,39,0.05) !important;
        }
        /* Account type card */
        .fd-acct:not([data-active="true"]):hover {
          border-color: rgba(99,102,241,0.3) !important;
          background: #f9fafb !important;
        }
        /* Footer link */
        .fd-link:hover { color: #4f46e5 !important; }
      `}</style>

      {/* ── Layer 1: dot grid (white, like hero) ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── Layer 2: indigo center glow ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(99,102,241,0.1) 0%, transparent 70%)",
        }}
      />

      {/* ── Layer 3: dark edge vignette ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(9,9,11,0.7) 100%)",
        }}
      />

      {/* ── Animated orbs ── */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "10%",
          width: "420px",
          height: "420px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.13) 0%, transparent 70%)",
          animation: "orb-1 28s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "12%",
          right: "8%",
          width: "320px",
          height: "320px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.11) 0%, transparent 70%)",
          animation: "orb-2 34s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      {/* ── Floating email-card fragments ── */}
      {FRAGMENTS.map((f) => (
        <div
          key={f.id}
          style={{
            position: "absolute",
            left: `${f.x}%`,
            top: `${f.y}%`,
            width: `${f.w}px`,
            height: `${f.h}px`,
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "9px",
            background: "rgba(255,255,255,0.025)",
            animation: `${f.anim} ${f.dur}s ${f.delay}s ease-in-out infinite`,
            pointerEvents: "none",
          }}
        >
          {/* Avatar circle */}
          <div
            style={{
              position: "absolute",
              left: "10px",
              top: "10px",
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.11)",
            }}
          />
          {/* Subject line */}
          <div
            style={{
              position: "absolute",
              left: "36px",
              top: "11px",
              right: "10px",
              height: "6px",
              background: "rgba(255,255,255,0.09)",
              borderRadius: "3px",
            }}
          />
          {/* Sender name */}
          <div
            style={{
              position: "absolute",
              left: "36px",
              top: "22px",
              width: "52%",
              height: "4px",
              background: "rgba(255,255,255,0.06)",
              borderRadius: "2px",
            }}
          />
          {/* Body preview lines */}
          {f.h > 44 && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "40px",
                  right: "10px",
                  height: "4px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "2px",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50px",
                  width: "68%",
                  height: "4px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: "2px",
                }}
              />
            </>
          )}
        </div>
      ))}

      {/* ── SVG email-flow arcs ── */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.12,
          pointerEvents: "none",
        }}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M60 180 Q350 60 720 450 Q1040 820 1380 280"
          stroke="#6366f1"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M0 630 Q280 210 720 450 Q1120 710 1440 185"
          stroke="#6366f1"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M185 900 Q475 490 720 450 Q965 415 1255 40"
          stroke="#6366f1"
          strokeWidth="1"
          fill="none"
        />
      </svg>

      {/* ── Card ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "390px",
          background: "#ffffff",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "20px",
          padding: "38px 36px",
          boxShadow:
            "0 0 0 1px rgba(99,102,241,0.08), 0 24px 64px rgba(0,0,0,0.5), 0 0 48px rgba(99,102,241,0.07)",
          animation: "fd-enter 0.48s cubic-bezier(0.22,1,0.36,1) both",
          overflow: "hidden",
        }}
      >
        {/* One-shot shimmer on card load */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "35%",
            height: "100%",
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
            animation: "fd-shimmer 1.1s 0.5s ease forwards",
            pointerEvents: "none",
          }}
        />

        {/* Brand */}
        <div style={{ marginBottom: "28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "9px",
                background: "#111827",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="17" height="13" viewBox="0 0 17 13" fill="none">
                <rect
                  x="0.75"
                  y="0.75"
                  width="15.5"
                  height="11.5"
                  rx="2.25"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth="1.1"
                />
                <path
                  d="M1.5 2L8.5 7.5L15.5 2"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1
              style={{
                fontFamily: "var(--font-playfair)",
                fontSize: "24px",
                fontWeight: "700",
                color: "#111827",
                letterSpacing: "-0.015em",
                margin: 0,
              }}
            >
              flowdesk
            </h1>
          </div>
          <p style={{ color: "#9ca3af", fontSize: "13px", margin: 0 }}>
            {mode === "signin" ? "Your AI email agent" : "Create your account"}
          </p>
        </div>

        {/* Tab switcher */}
        <div
          style={{
            display: "flex",
            background: "#f3f4f6",
            borderRadius: "11px",
            padding: "3px",
            marginBottom: "24px",
            gap: "2px",
          }}
        >
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              className="fd-tab"
              data-active={mode === m ? "true" : "false"}
              onClick={() => {
                setMode(m);
                setSignupError(null);
                setSignInError(false);
              }}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "9px",
                fontSize: "13px",
                fontWeight: "500",
                background: mode === m ? "#6366f1" : "transparent",
                color: mode === m ? "#ffffff" : "#9ca3af",
                border: "none",
                cursor: "pointer",
                letterSpacing: "0.01em",
                fontFamily: "inherit",
              }}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {/* ── Sign-in form ── */}
        {mode === "signin" ? (
          <form
            onSubmit={onSignIn}
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="fd-input"
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="fd-input"
              />
            </div>

            {(authError || signInError) && (
              <div
                style={{
                  background: "#fff1f2",
                  border: "1px solid #fecdd3",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  color: "#e11d48",
                }}
              >
                Invalid email or password.
              </div>
            )}

            <button type="submit" disabled={isSubmitting} className="fd-submit">
              {isSubmitting ? "Signing in…" : "Sign in →"}
            </button>
          </form>
        ) : (
          /* ── Sign-up form ── */
          <form
            onSubmit={onSignUp}
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                required
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="you@company.com"
                className="fd-input"
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="fd-input"
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="fd-input"
              />
            </div>

            {signupError && (
              <div
                style={{
                  background: "#fff1f2",
                  border: "1px solid #fecdd3",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  color: "#e11d48",
                }}
              >
                {signupError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSigningUp}
              className="fd-submit"
            >
              {isSigningUp ? "Creating account…" : "Create account →"}
            </button>
          </form>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: "22px",
            paddingTop: "18px",
            borderTop: "1px solid #f3f4f6",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
            {mode === "signin"
              ? "Don't have an account? "
              : "Already have an account? "}
            <button
              type="button"
              className="fd-link"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setSignupError(null);
                setSignInError(false);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#6b7280",
                fontSize: "12px",
                cursor: "pointer",
                padding: 0,
                fontWeight: "500",
                textDecoration: "underline",
                textUnderlineOffset: "2px",
                fontFamily: "inherit",
                transition: "color 0.15s",
              }}
            >
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
