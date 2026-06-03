import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  useClerk,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import App from "./App";
import { ClerkOAuthCallback, GoogleSignInButton } from "./auth";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!clerkPublishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY가 필요합니다.");
}

const root = createRoot(document.getElementById("root")!);

if (convexUrl) {
  const convex = new ConvexReactClient(convexUrl);
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
        <AuthOnlyApp />
      </ClerkProvider>
    </StrictMode>,
  );
}

function AuthOnlyApp() {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const isClerkCallback = window.location.pathname === "/sso-callback";

  if (isClerkCallback) {
    return (
      <main className="app-shell">
        <ClerkOAuthCallback />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="auth-panel auth-only">
        <div>
          <p className="eyebrow">Clerk Google Auth</p>
          <h1>로그인 확인</h1>
          {isSignedIn ? (
            <p className="auth-result">
              {user?.primaryEmailAddress?.emailAddress ?? "로그인됨"}
            </p>
          ) : null}
        </div>
        {!isSignedIn ? <GoogleSignInButton /> : null}
        {isSignedIn ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            로그아웃
          </button>
        ) : null}
      </section>
    </main>
  );
}
