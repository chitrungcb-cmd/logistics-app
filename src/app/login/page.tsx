import LoginClient from "./LoginClient";

// Login HTML must never be cached by the CDN across deployments. A stale
// prerendered page can reference hashed CSS/JS assets that no longer exist.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient />;
}
