import {
  AuthenticateWithRedirectCallback,
  useSignIn,
} from "@clerk/clerk-react";
import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";
import { LinkIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

const oauthCallbackPath = "/sso-callback";
const authCompletePath = "/";

type GoogleSignInButtonProps = {
  children?: ReactNode;
  className?: string;
  iconSize?: number;
};

export function GoogleSignInButton({
  children = "Google로 로그인",
  className = "primary-button",
  iconSize = 18,
}: GoogleSignInButtonProps) {
  const { isLoaded, signIn } = useSignIn();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function startGoogleSignIn() {
    if (!isLoaded || !signIn || isSubmitting) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: oauthCallbackPath,
        redirectUrlComplete: authCompletePath,
      });
    } catch (error) {
      setErrorMessage(toClerkErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-action">
      <button
        className={className}
        type="button"
        disabled={!isLoaded || isSubmitting}
        aria-busy={!isLoaded || isSubmitting}
        onClick={startGoogleSignIn}
      >
        <LinkIcon size={iconSize} />
        {isSubmitting ? "Google로 이동 중" : children}
      </button>
      {errorMessage ? (
        <p className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function ClerkOAuthCallback() {
  return (
    <section className="auth-panel auth-callback">
      <div className="loading-panel inline">로그인 완료 중</div>
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl={authCompletePath}
        signUpFallbackRedirectUrl={authCompletePath}
        afterSignInUrl={authCompletePath}
        afterSignUpUrl={authCompletePath}
        transferable
      />
    </section>
  );
}

function toClerkErrorMessage(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    const clerkError = error.errors[0];
    return (
      clerkError?.longMessage ??
      clerkError?.message ??
      "Google 로그인을 시작하지 못했습니다."
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Google 로그인을 시작하지 못했습니다.";
}
