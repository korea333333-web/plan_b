"use client";

import { useEffect, useState } from "react";
import {
  getSupabaseClient,
  getSupabaseConfigurationError,
} from "@/lib/supabase";

let pendingOAuthErrorMessage = "";

function toKoreanOAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("provider is not enabled") ||
    normalized.includes("unsupported provider")
  ) {
    return "Google 로그인이 아직 연결되지 않았습니다. 관리자에게 알려 주세요.";
  }
  if (normalized.includes("rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }

  return "Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function AuthGate() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const configurationError = getSupabaseConfigurationError();

  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const oauthError =
      hashParams.get("error") ?? url.searchParams.get("error");
    const errorCode =
      hashParams.get("error_code") ?? url.searchParams.get("error_code");
    const errorDescription =
      hashParams.get("error_description") ??
      url.searchParams.get("error_description");

    if (oauthError || errorCode || errorDescription) {
      const normalized =
        `${oauthError ?? ""} ${errorCode ?? ""} ${errorDescription ?? ""}`.toLowerCase();
      pendingOAuthErrorMessage =
        normalized.includes("denied") || normalized.includes("cancel")
          ? "Google 로그인이 취소되었습니다. 다시 시도해 주세요."
          : toKoreanOAuthError(
              errorDescription ?? errorCode ?? oauthError ?? "",
            );

      ["error", "error_code", "error_description", "error_uri"].forEach(
        (key) => url.searchParams.delete(key),
      );
      url.hash = "";
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }

    if (!pendingOAuthErrorMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setErrorMessage(pendingOAuthErrorMessage);
      pendingOAuthErrorMessage = "";
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleGoogleSignIn = async () => {
    setErrorMessage("");

    const supabase = getSupabaseClient();
    if (!supabase) {
      setErrorMessage(
        configurationError ?? "로그인 기능을 준비하지 못했습니다.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });

      if (error) {
        setErrorMessage(toKoreanOAuthError(error.message));
        setIsSubmitting(false);
      }
    } catch {
      setErrorMessage("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page site-shell">
      <section
        className="auth-card paper-card"
        aria-labelledby="auth-title"
        aria-busy={isSubmitting}
      >
        <header className="auth-heading">
          <p className="auth-eyebrow">매일 한 송이씩 피워 내는 계획</p>
          <h1 id="auth-title">매화수련록</h1>
          <p>
            Google 계정으로 로그인하면 어느 기기에서든 내 계획과 수련 기록을
            이어 볼 수 있습니다.
          </p>
        </header>

        <div className="auth-action">
          {configurationError ? (
            <p className="auth-message is-error" role="alert">
              {configurationError}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="auth-message is-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            className="google-auth-button"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting || Boolean(configurationError)}
            aria-describedby="google-auth-note"
          >
            <svg
              className="google-auth-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="#4285f4"
                d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.01v2.53h3.25c1.9-1.75 2.97-4.34 2.97-7.38Z"
              />
              <path
                fill="#34a853"
                d="M12 22c2.7 0 4.98-.9 6.63-2.4l-3.25-2.52c-.9.6-2.05.97-3.38.97-2.61 0-4.82-1.76-5.61-4.13H3.03v2.6A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#fbbc05"
                d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.92v-2.6H3.03A10 10 0 0 0 2 12c0 1.61.39 3.14 1.03 4.52l3.36-2.6Z"
              />
              <path
                fill="#ea4335"
                d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.97 5.48l3.36 2.6C7.18 7.71 9.39 5.95 12 5.95Z"
              />
            </svg>
            <span>
              {isSubmitting ? "Google 로그인으로 이동 중…" : "Google로 계속하기"}
            </span>
          </button>

          <p id="google-auth-note" className="auth-note">
            처음 로그인하면 계정이 자동으로 만들어집니다.
          </p>
        </div>
      </section>
    </main>
  );
}
