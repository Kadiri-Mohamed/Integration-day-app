import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouPulse — Day of Integration",
  description: "Meet, play, and make something together at the BDE Day of Integration.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="min-h-screen antialiased">{children}</body></html>;
}
