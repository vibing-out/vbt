import { CenteredCard } from "../official/shell";
import { LoginForm } from "./login-form";

// Official sign-in (T-09). Outside /official, so the proxy lets everyone reach it.
export default function LoginPage() {
  return (
    <CenteredCard
      title="Official sign-in"
      description="For poll workers and county and state election officials. Voters do not need an account."
    >
      <LoginForm
        url={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
        publishableKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""}
      />
    </CenteredCard>
  );
}
