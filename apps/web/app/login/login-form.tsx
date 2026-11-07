"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { Button } from "@vbt/ui/components/button";
import { Input } from "@vbt/ui/components/input";
import { type FormEvent, useState } from "react";

// Official sign-in (T-09, on T-20's foundation): password, then the TOTP code, which raises the session to
// aal2 (Supabase MFA: listFactors -> challenge -> verify). Voters never sign in. @supabase/ssr keeps the
// session in cookies, which proxy.ts and requireRole read on the server.
export function LoginForm({ url, publishableKey }: { url: string; publishableKey: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "code">("password");
  const [message, setMessage] = useState<string | null>(null);
  const supabase = url && publishableKey ? createBrowserClient(url, publishableKey) : null;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return setMessage("Sign-in is not configured.");
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) return setMessage("Sign-in failed.");
    setMessage(null);
    setStep("code");
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp.find((f) => f.status === "verified");
    if (factors.error || !factor) return setMessage("This account has no authenticator app enrolled.");
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error) return setMessage("Could not start the code check.");
    const verified = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
    if (verified.error) return setMessage("That code did not work.");
    router.push("/official");
    router.refresh();
  }

  const alert = message ? (
    <p role="alert" className="text-body text-status-discarded">
      {message}
    </p>
  ) : null;

  return step === "password" ? (
    <form onSubmit={signIn} data-testid="login-password" className="flex flex-col gap-4">
      <Input id="login-email" name="email" type="email" label="Email" mode="admin" autoComplete="username" required />
      <Input id="login-password" name="password" type="password" label="Password" mode="admin" autoComplete="current-password" required />
      <Button type="submit" mode="admin">
        Continue
      </Button>
      {alert}
    </form>
  ) : (
    <form onSubmit={verify} data-testid="login-code" className="flex flex-col gap-4">
      <Input
        id="login-code-input"
        name="code"
        label="Code from your authenticator app"
        hint="The 6-digit code for VBT."
        mode="admin"
        variant="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        autoFocus
      />
      <Button type="submit" mode="admin">
        Sign in
      </Button>
      {alert}
    </form>
  );
}
