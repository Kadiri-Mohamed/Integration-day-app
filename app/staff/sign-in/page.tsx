"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Activity, ArrowLeft, LockKeyhole } from "lucide-react";

export default function StaffSignIn() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function submit(form: FormData) {
    setPending(true); setError("");
    const result = await signIn("credentials", { email: form.get("email"), password: form.get("password"), redirect: false, redirectTo: "/staff" });
    setPending(false);
    if (result?.error) setError("Email or password is incorrect."); else router.push("/staff");
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f7f2] px-5 py-10 text-[#172118]"><div className="w-full max-w-[430px]"><Link href="/" className="mb-9 inline-flex items-center gap-2 text-xs font-bold text-[#75816c]"><ArrowLeft size={15}/> Back to event</Link><div className="rounded-[28px] border border-[#e6e9e0] bg-white p-8 shadow-[0_20px_70px_-45px_rgba(31,51,28,.3)] sm:p-10"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#c3f169]"><Activity size={21}/></span><h1 className="mt-7 text-3xl font-black tracking-[-.05em]">Staff sign in</h1><p className="mt-2 text-sm text-[#768073]">Manage the event or run your assigned stations.</p><form action={submit} className="mt-8 space-y-4"><label className="block text-xs font-bold">Work email<input required name="email" type="email" autoComplete="username" className="mt-2 w-full rounded-xl border border-[#e1e5db] bg-[#fbfcf9] px-4 py-3.5 text-sm outline-none focus:border-[#91b456]" placeholder="you@bde.org"/></label><label className="block text-xs font-bold">Password<input required name="password" type="password" autoComplete="current-password" className="mt-2 w-full rounded-xl border border-[#e1e5db] bg-[#fbfcf9] px-4 py-3.5 text-sm outline-none focus:border-[#91b456]" placeholder="Your password"/></label>{error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}<button disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#172118] px-4 py-3.5 text-sm font-bold text-white disabled:opacity-60"><LockKeyhole size={15}/>{pending ? "Signing in…" : "Sign in"}</button></form></div><p className="mt-5 text-center text-[11px] text-[#959d91]">Access is available to authorized BDE staff.</p></div></main>;
}
