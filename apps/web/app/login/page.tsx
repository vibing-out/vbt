import { LoginForm } from "./login-form";

// Official sign-in (T-09). Outside /official, so the proxy lets everyone reach it.
export default function LoginPage() {
  return (
    <main>
      <h1>Official sign-in</h1>
      <p>For poll workers and county and state election officials. Voters do not need an account.</p>
      <LoginForm
        url={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
        publishableKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""}
      />
    </main>
  );
}
