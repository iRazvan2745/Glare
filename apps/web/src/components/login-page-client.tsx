"use client";

import { useEffect, useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPageClient() {
  const [showSignIn, setShowSignIn] = useState(true);
  const [signupsEnabled, setSignupsEnabled] = useState(true);

  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/+$/, "");
    fetch(`${base}/api/public/signup-status`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: unknown) => {
        const enabled = (data as { signupsEnabled?: boolean }).signupsEnabled;
        setSignupsEnabled(enabled ?? true);
        if (enabled === false) setShowSignIn(true);
      })
      .catch(() => {
        /* keep default */
      });
  }, []);

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={signupsEnabled ? () => setShowSignIn(false) : undefined} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
  );
}
